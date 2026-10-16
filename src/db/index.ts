import 'server-only';

import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

/* 数据库连接层。
 *
 * 这个文件只允许在服务端被 import（'server-only' 会在客户端构建时报错）。
 * 数据库连接串绝不能进客户端包 —— 那等于把库的钥匙贴到浏览器里。
 * anon key 可以公开，数据库连接串不可以，这是两回事。
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    '缺少 DATABASE_URL。复制 .env.example 为 .env.local 并填入 Supabase 的值；' +
      '若要本地离线开发，先跑 `npm run db:dev` 再填它打印出来的地址。',
  );
}

/* 为什么在开发环境把连接数压到 1：
 * Next.js 开发模式每次热更新都会重新求值模块，如果每次都新建连接池，
 * 改十次代码就攒下十个池，很快把 Supabase 免费档的连接数吃满。
 * 用 globalThis 缓存，跨 HMR 复用同一个客户端。
 *
 * 生产环境给 5：Vercel 上每个 Serverless 实例各有一条池，
 * 而 Supabase 免费档的直连上限是 60 —— 实例数 × 池大小不能超。
 * 这也是为什么生产必须用连接池（6543 端口）而不是直连。 */
const globalForDb = globalThis as unknown as { __slimSql?: postgres.Sql };

export const sql =
  globalForDb.__slimSql ??
  postgres(connectionString, {
    max: process.env.NODE_ENV === 'production' ? 5 : 1,
    /* prepare: false 是**必须**的，不是优化。
     * Supabase 的连接池（Supavisor）在 transaction 模式下会把同一个会话的
     * 不同语句分到不同后端，而 prepared statement 绑定在某个具体连接上，
     * 于是出现「昨天还好，今天报 prepared statement "s1" already exists」。
     * 关掉它，代价只是每次多解析一次 SQL。 */
    prepare: false,
    // Supabase 要求 TLS；本地 PGlite 没有 TLS，给了 ssl 反而连不上
    ssl: connectionString.includes('supabase.') ? 'require' : undefined,
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== 'production') globalForDb.__slimSql = sql;

export const db = drizzle(sql, { schema });

export type Db = typeof db;

/** 事务里的 drizzle 实例类型。
 *  从 db.transaction 的签名推导，而不是手写一长串泛型 —— 手写的那个
 *  一旦 drizzle 升级就会悄悄不对，推导出来的永远是对的。 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/* ─────────────────────────────────────────────────────────────────────────
 * 以「某个登录用户」的身份执行查询
 *
 * 为什么必须这么做，而不是在 SQL 里手写 where user_id = ?：
 *
 *   Postgres 有**两道独立的门**：
 *     GRANT  —— 角色能不能碰这张表（缺了报 42501）
 *     POLICY —— 能看见表里的哪些行（缺了静默返回 0 行）
 *
 *   平时连库用的 postgres 角色是**表属主，直接绕过 RLS**。
 *   也就是说，如果所有查询都用它跑，RLS 策略写了等于没写 ——
 *   测试全绿，但线上任何一个漏写的 where 都会泄露全部用户数据。
 *
 *   所以业务查询一律走这里：切成 authenticated 角色 + 塞入 JWT claims，
 *   让数据库自己去过滤。应用层写错 where 也不会越权，这是纵深防御。
 *
 * 为什么用 db.transaction() 而不是 sql.begin()：
 *   postgres.js 的 sql.begin() 回调拿到的是 TransactionSql，它不是一个
 *   完整的 Sql 实例（缺 parsers 等字段），drizzle() 包上去会直接抛
 *   「Cannot read properties of undefined (reading 'parsers')」。
 *   drizzle 自己的 transaction() 会正确构造事务内的查询构造器。
 *   —— 这个错我们真的踩过一次，2026-10-16。
 * ───────────────────────────────────────────────────────────────────────── */
export async function withUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    /* set_config 的第三个参数 true = 只在本事务内有效（等价于 SET LOCAL）。
     * 如果写成 false，这个设置会留在连接上 —— 而连接是要还回池子里给
     * 下一个请求复用的，于是「张三的身份」会泄漏给「李四的请求」。
     * 这是连接池场景下最危险的一类 bug，且只在并发下偶发。 */
    await tx.execute(
      dsql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`,
    );
    await tx.execute(dsql`set local role authenticated`);
    return fn(tx);
  });
}

/** 匿名身份（未登录访客）。用来读内置食物库这类公共数据。 */
export async function withAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(dsql`set local role anon`);
    return fn(tx);
  });
}

/* 管理员连接：绕过 RLS。用于后台脚本（建邀请码、重算历史汇总）。
 * 名字里带 admin 是为了让 code review 时一眼看见 ——
 * 业务代码里出现它就该被质疑。 */
export function adminDb() {
  return db;
}
