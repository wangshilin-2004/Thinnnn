import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateInviteCode,
  inviteStatusLabel,
  isOwnerEmail,
  normalizeInviteCode,
} from '../src/lib/invite.ts';

/* 邀请码的纯逻辑。
 *
 * 「校验能不能通」那部分在数据库（invite_code_is_valid / consume_invite_code），
 * 已由 tests/verify-migrations.mjs 的【L】组 13 条断言覆盖。
 * 这里只测这一层 —— 归一化、生成、展示状态、管理员判断。 */

test('normalizeInviteCode 去掉所有空白并转大写', () => {
  assert.equal(normalizeInviteCode(' 7k3m-9qrt '), '7K3M-9QRT');
  assert.equal(normalizeInviteCode('7K3M 9QRT'), '7K3M9QRT');
  assert.equal(normalizeInviteCode('7k3m\t9qrt\n'), '7K3M9QRT');
  /* 全角空格也要清掉 —— 中文输入法下从聊天窗口复制时真的会出现。 */
  assert.equal(normalizeInviteCode('7K3M\u30009QRT'), '7K3M9QRT');
  assert.equal(normalizeInviteCode(''), '');
});

test('normalizeInviteCode 不改变内容本身', () => {
  /* 这条是防止有人以后「顺手」把 '-' 也去掉 ——
   * 库里存的码是带连字符的，两处不一致会导致明明对却提示码无效。 */
  assert.equal(normalizeInviteCode('7K3M-9QRT'), '7K3M-9QRT');
});

test('generateInviteCode 的形状：8 个有效字符 + 中间一个连字符', () => {
  /* 字母表刻意去掉了 0/O/1/I/L —— 这个码可能是对着截图手打的。 */
  const alphabet = new Set('23456789ABCDEFGHJKLMNPQRSTUVWXYZ');

  for (let i = 0; i < 200; i += 1) {
    const code = generateInviteCode();
    assert.equal(code.length, 9, `长度不对：${code}`);
    assert.equal(code[4], '-', `第 5 位该是连字符：${code}`);

    for (const [index, ch] of [...code].entries()) {
      if (index === 4) continue;
      assert.ok(alphabet.has(ch), `出现了不该出现的字符 ${ch}（${code}）`);
    }
  }
});

test('generateInviteCode 不产生重复', () => {
  /* 200 个太少，撞了也不说明问题 —— 但真撞上一定说明随机源坏了
   * （比如退化成了常量或时间种子）。这条是免费的健康检查。 */
  const seen = new Set<string>();
  for (let i = 0; i < 500; i += 1) seen.add(generateInviteCode());
  assert.equal(seen.size, 500);
});

test('inviteStatusLabel：可用 / 用尽 / 过期', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const future = '2026-11-17T12:00:00Z';
  const past = '2026-10-01T12:00:00Z';

  assert.equal(
    inviteStatusLabel({ usedCount: 0, maxUses: 1, expiresAt: future, now }),
    'active',
  );
  assert.equal(
    inviteStatusLabel({ usedCount: 1, maxUses: 1, expiresAt: future, now }),
    'exhausted',
  );
  assert.equal(inviteStatusLabel({ usedCount: 0, maxUses: 1, expiresAt: past, now }), 'expired');
  /* 用完 + 过期 → 报「用尽」。两者都成立时报哪个都算对，
   * 但必须固定一个，否则同一行在不同地方显示不同状态。 */
  assert.equal(inviteStatusLabel({ usedCount: 1, maxUses: 1, expiresAt: past, now }), 'exhausted');
});

test('inviteStatusLabel：刚好到期的那一刻算过期', () => {
  /* 边界用 <=，与数据库里 invite_code_is_valid() 的
   * `expires_at > now()` （严格大于）互补 —— 两边对同一时刻的判断一致。 */
  const at = new Date('2026-10-17T12:00:00Z');
  assert.equal(
    inviteStatusLabel({ usedCount: 0, maxUses: 1, expiresAt: '2026-10-17T12:00:00Z', now: at }),
    'expired',
  );
});

test('inviteStatusLabel：没设过期时间就是永不过期', () => {
  assert.equal(inviteStatusLabel({ usedCount: 0, maxUses: 3, expiresAt: null }), 'active');
});

test('isOwnerEmail 匹配允许列表', () => {
  const list = 'wangshilin@tju.edu.cn';

  assert.equal(isOwnerEmail('wangshilin@tju.edu.cn', list), true);
  /* 大小写不该决定权限 —— 登录时邮箱已经被转成小写，
   * 但环境变量是手写的，不能指望人手写时也小写。 */
  assert.equal(isOwnerEmail('WangShiLin@TJU.edu.cn', list), true);
  assert.equal(isOwnerEmail('someone@else.com', list), false);
});

test('isOwnerEmail 支持逗号分隔的多个管理员', () => {
  const list = ' a@x.com , b@y.com ,, ';

  assert.equal(isOwnerEmail('a@x.com', list), true);
  assert.equal(isOwnerEmail('b@y.com', list), true);
  assert.equal(isOwnerEmail('c@z.com', list), false);
});

test('isOwnerEmail 在空值下必须是 false 而不是抛错', () => {
  /* 这一条有实际风险：没配 OWNER_EMAILS 时列表是空字符串。
   * 如果这里返回 true（比如空列表被当成「不限制」），
   * 任何一个登录用户都会变成管理员。 */
  assert.equal(isOwnerEmail('a@x.com', ''), false);
  assert.equal(isOwnerEmail('a@x.com', '   '), false);
  assert.equal(isOwnerEmail(null, 'a@x.com'), false);
  assert.equal(isOwnerEmail(undefined, 'a@x.com'), false);
  assert.equal(isOwnerEmail('', 'a@x.com'), false);
});
