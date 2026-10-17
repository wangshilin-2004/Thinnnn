/* 邀请码 —— 注册门槛。
 *
 * 为什么需要这一步
 *   登录走魔法链接，`shouldCreateUser: true` 的含义是：任何一个知道域名的人，
 *   填上自己的邮箱就能把账号建出来。项目规模是「我 + 1-2 个朋友」，
 *   流量和存储都是自己兜底，所以需要一道门。
 *
 * 门槛只挡「第一次注册」，不挡老用户登录
 *   老用户（已有账号）走「邮件链接」或「密码」两条路都能进，不需要码。
 *   只有「这个邮箱还没注册过」这一种情况会被要求填码。
 *   这样日常使用完全不受影响，摩擦只发生在「拉新人」这一刻。
 *
 * 想放开注册时只改一个地方（比如以后想多加几个用户）
 *   把下面的 INVITE_REQUIRED 改成 false，重新部署，就完了。
 *   登录页那个输入框由同一个常量控制是否渲染，会自己消失；
 *   服务端的校验整段被跳过；数据库和已经发出去的码都不用动，
 *   它们只是不再被检查。
 *   （把开关放在这个纯模块里、而不是读环境变量，就是因为它要同时被
 *   服务端 action 和客户端表单读到 —— 环境变量在客户端拿不到。）
 *
 * 一个诚实的边界
 *   这道门是应用层（登录页）的，不是 Supabase 那一层的：
 *  `shouldCreateUser` 由我们自己的 Server Action 决定，所以走网站的人一定会被拦。
 *   但如果谁拿到了 Supabase 的 anon key 并直接打 GoTrue 的 /otp 接口，
 *   可以在项目设置里把「允许注册」关掉来堵住 —— 那需要改用 admin API 建号，
 *   对这个规模的工具不值得，因此没做。记在这里，免得以后误以为它是硬防线。
 */

/** 是否要求邀请码。这是唯一的开关，见文件头「想放开注册时的两步操作」。 */
export const INVITE_REQUIRED = true;

/* 码的字母表：去掉了 0/O/1/I/L 这几个。
 * 理由很具体 —— 这个码是要用微信发给朋友的，对方可能会看着截图手打。
 * 少一个易混字符，就少一次「我明明输对了却提示码错」的来回。 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** 码的规范形式：去掉所有空白、转大写。
 *
 * 前后空格是常态（从聊天窗口复制）、全角空格偶尔也会有，所以用 \s
 * 连中间一起清掉：用户可能把它抄成「7K3M 9QRT」。转大写则是因为
 * 输入法、手机键盘都可能在不知不觉中给出小写。
 *
 * 数据库那一层还会再做一次 upper(btrim())，两边都做是故意的：
 * 前端归一化管交互，SQL 归一化管「任何人直接调 RPC」。
 */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** 生成一个新码，形如 `7K3M-9QRT`。
 *
 * 用 crypto.getRandomValues 而不是 Math.random：后者可预测，
 * 而码本身就是「注册凭据」，能被猜到就等于没有门槛。
 *
 * 32 个字符的字母表正好整除 256（256 / 32 = 8），所以 `% 32` 没有模偏置 ——
 * 8 个字符是均匀的 32^8 ≈ 1.1 万亿种组合。
 */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if (i === 3) out += '-';
  }
  return out;
}

/** 码当前是否还能用（未用尽、未过期）。
 *
 * 这是**展示用**的判断，真正的裁决在数据库的 invite_code_is_valid()
 * 和 consume_invite_code() 里 —— 前者查、后者原子扣减。
 * 两处必须一致，否则会出现「界面说能用，提交却说码无效」。
 */
export function inviteStatusLabel(row: {
  usedCount: number;
  maxUses: number;
  expiresAt: string | null;
  now?: Date;
}): 'active' | 'exhausted' | 'expired' {
  if (row.usedCount >= row.maxUses) return 'exhausted';
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= (row.now ?? new Date()).getTime()) {
    return 'expired';
  }
  return 'active';
}

/** 判断某个邮箱是不是「码的管理员」。
 *
 * 允许列表来自环境变量 OWNER_EMAILS（逗号分隔），抽成纯函数是为了能单测 ——
 * 直接读 process.env 的版本在 invite-admin.ts 里，只有那一个 export 碰环境变量。
 *
 * 为什么用环境变量而不是数据库里的一个 is_admin 列：
 *   这个项目没有角色系统，也不需要。管理员就是一个（或两个）具体的邮箱，
 *   放在部署配置里改起来比加一张表、加一列、加一组 RLS 策略都便宜。
 */
export function isOwnerEmail(email: string | null | undefined, allowList: string): boolean {
  if (!email) return false;
  const wanted = email.trim().toLowerCase();
  return allowList
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(wanted);
}
