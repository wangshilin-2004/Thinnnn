/**
 * 安全响应头的回归守卫。
 *
 * ── 为什么需要这个文件 ──
 * 引擎里最危险的退化不是「写错」，是「悄悄少了一层」。
 * 你把 next.config.ts 里的 headers() 整段删掉，`tsc` 不报错、
 * `eslint` 不报错、单元测试全绿、页面看起来一模一样 ——
 * 只有线上少了一层防护，而没有任何人会收到通知。
 *
 * 所以用一个断言把它钉住：配置里必须声明这几个头，且覆盖面是全部路径。
 *
 * ── 它检查什么、不检查什么 ──
 * 检查：配置项存在、值符合预期、source 覆盖所有路径。
 * 不检查：线上真的返回了它们（那需要发请求，属于部署后验收的事，
 *         见 docs/05-部署.md 3.4 节）。
 * 这个分工是故意的 —— 这个脚本要能在**没有网络**的情况下跑。
 */

const REQUIRED = [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
    why: '不禁止嗅探的话，一个内容为 HTML 的响应可能被当页面执行',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
    why: '不设的话别的站点可以把本站嵌进 iframe 做点击劫持',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
    why: '跨站跳转时别把带 token 的完整路径漏给第三方',
  },
  {
    key: 'Permissions-Policy',
    value: /camera=\(\).*microphone=\(\).*geolocation=\(\)/,
    why: '用不到的浏览器能力要显式关掉，不声明等于没限制',
  },
];

let failures = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures += 1;
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

/* ── 载入配置 ──
 * 直接 import 真实的 next.config.ts，而不是去扫源码文本。
 * 扫文本的老毛病：只要注释里提一句这个头名，检查就会假通过。
 */
let config;
try {
  const mod = await import('../next.config.ts');
  config = mod.default ?? mod;
} catch (err) {
  console.error('  ✗ 载入 next.config.ts 失败 ——', err.message);
  process.exit(1);
}

/* ── 1. headers() 必须存在且能调用 ── */
if (typeof config.headers !== 'function') {
  fail('next.config.ts 里没有 headers() —— 安全响应头全都没了');
} else {
  pass('headers() 已声明');

  const rules = await config.headers();

  if (!Array.isArray(rules) || rules.length === 0) {
    fail('headers() 返回空数组，等于没有');
  } else {
    /* ── 2. 必须有一条覆盖全部路径的规则 ── */
    const catchAll = rules.find(
      (r) => r && (r.source === '/:path*' || r.source === '/(.*)' || r.source === '/'),
    );
    if (!catchAll) {
      fail(
        `没有覆盖全部路径的规则（找到的 source：${
          rules.map((r) => r?.source ?? '(空)').join(', ') || '无'
        }）`,
      );
    } else {
      pass(`覆盖面 ${catchAll.source}`);

      /* ── 3. 逐个核对需要的头 ── */
      const declared = new Map(
        (catchAll.headers ?? []).map((h) => [h.key, h.value]),
      );

      for (const { key, value, why } of REQUIRED) {
        const actual = declared.get(key);

        if (actual === undefined) {
          fail(`${key} 缺失 —— ${why}`);
          continue;
        }

        const ok =
          value instanceof RegExp ? value.test(actual) : actual === value;

        if (ok) {
          pass(`${key}: ${actual}`);
        } else {
          fail(
            `${key} 值不对\n      期望: ${value}\n      实际: ${actual}`,
          );
        }
      }
    }
  }
}

/* ── 4. 反向断言：CSP 不该出现 ──
 * 这是有意的「反向」检查。next.config.ts 里写了长注释解释为什么
 * 现在不上 CSP（没有 nonce 机制时只能开 unsafe-inline，是自欺欺人）。
 * 如果有人图省事随手加了一条宽松的 CSP，那比没有更糟 —— 它会让人
 * 以为有防护。真上了合规的 CSP（带 nonce），就把这条改成正向断言。
 */
if (typeof config.headers === 'function') {
  const rules = await config.headers();
  const csp = rules
    .flatMap((r) => r?.headers ?? [])
    .find((h) => h.key.toLowerCase() === 'content-security-policy');

  if (csp) {
    console.warn(
      `  ! 检测到 CSP: ${String(csp.value).slice(0, 80)}…\n` +
        '    如果这条 CSP 带 nonce 且验证过，是好事 —— 请把本检查改成正向断言。\n' +
        '    如果是图省事加的宽松 CSP，建议删掉。',
    );
  } else {
    pass('CSP 有意未启用（无 nonce 机制，见 next.config.ts 注释）');
  }
}

console.log();
if (failures > 0) {
  console.error(`安全响应头检查失败：${failures} 项`);
  process.exit(1);
}
console.log('安全响应头检查通过。');
