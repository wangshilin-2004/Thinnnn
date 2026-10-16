import { defineConfig } from 'drizzle-kit';

// ──────────────────────────────────────────────────────────────
// Node 22+ 内置了 process.loadEnvFile()，所以不需要 dotenv 包。
// 文件不存在时会抛错，用 try/catch 包起来当作「可选覆盖」。
// 加载顺序有意为之：.env.local 先加载，它优先于 .env —— 与 Next.js 的约定一致。
// ──────────────────────────────────────────────────────────────
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // 文件不存在 → 跳过，下面统一报错
  }
}

// 迁移要改表结构，必须走「直连」而不是连接池。
// Supabase 的连接池（Supavisor）在 transaction 模式下会把同一个事务分配到不同后端，
// DDL 语句在这种环境下不可靠。所以这里优先用 DIRECT_URL。
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

// generate 是纯离线操作：它只拿 src/db/schema.ts 和 drizzle/meta/ 里的快照做
// diff，产出一个新的 .sql 文件，全程不连数据库。
// 所以这里不能因为「还没填连接串」就拦住它 —— 否则项目刚 clone 下来连
// 生成迁移都做不了。只有真正需要连库的命令（migrate / push / studio）才强制要求。
const OFFLINE_COMMANDS = new Set(['generate', 'up', 'check']);
const command = process.argv[2] ?? '';
const isOffline = OFFLINE_COMMANDS.has(command);

if (!url && !isOffline) {
  throw new Error(
    `命令 "${command}" 需要数据库连接串。\n` +
      '请复制 .env.example 为 .env.local，填入 DIRECT_URL（Supabase 设置的直连串）。',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: url ?? '' },

  // 只管理 public schema。Supabase 的 auth / storage / realtime 等
  // schema 由 Supabase 自己管，我们绝不去 diff 它们。
  schemaFilter: ['public'],

  // verbose: 打印每条执行的 SQL（调试期很有用）
  // strict: 执行前要求确认（防止误删列这类不可逆操作）
  verbose: true,
  strict: true,
});
