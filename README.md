# 轻记 · 体重与饮食可视化

把「体重趋势」和「热量摄入」画在同一条时间轴上，让你看清到底发生了什么。

这不是又一个记账 App。做它的起点是一个具体的空白：**开源的健康记录项目里，没有一个是把体重和饮食打通看的。** 体重存在「身体测量」模块，饮食存在「营养」模块，两边的界面互不相认 —— 而「我这三周少吃了吗、体重动了吗、对得上吗」恰恰是减脂期最想回答的问题。

> **线上地址：[https://thinnnn.top](https://thinnnn.top)**
>
> 密码登录取代了「必须收得到邮件」，开箱可用。邮箱登录链接还需要先在 Supabase 里把正式域名加进回跳白名单 —— 一次性的，步骤见 [`docs/05-部署.md`](docs/05-部署.md) 3.5 节。
>
> **注册要邀请码**：新邮箱第一次登录时得填一个。站长在「设置 → 邀请码」里生成，一个码默认用一次。

## 它凭什么不一样

| | 常见做法 | 这里 |
|---|---|---|
| 看体重 | 今天比昨天重了 0.3 kg → 焦虑 | **7 日移动平均**（粗线）当主线，每日实测（细线）只做背景。一晚的盐分、水分、糖原就能让体重浮动 1–2 kg，单日数字判断成败只会让人放弃 |
| 食物库 | 改一条食物的热量，历史记录跟着变 | 食物库统一按**每 100 克**存营养值，每条日志存**吃了多少克**。改食物库 → 全部历史自动重算；同时每条日志又留一份**当时算出的快照**，所以你第 30 天回看看到的东西不会变样 |
| 记录摩擦 | 功能堆得多 | 第一优先级是**每次录入都快**。有研究显示所有热量记录 App 的坚持率都会随时间下降 —— 问题不在意志力，在于每次录入的摩擦（[JMIR mHealth 2026](https://mhealth.jmir.org/2026/1/e64139/)） |

## 技术栈

| 层 | 选型 | 为什么 |
|---|---|---|
| 框架 | Next.js 16（App Router） | 前后端一体。Server Component 直接查库，不需要为「给自己的 3 人工具」额外扛一层 REST API |
| 数据库 | PostgreSQL（Supabase 托管） | 趋势图全靠聚合 SQL，纯前端直连 BaaS 永远写不出真正想要的查询 |
| ORM | Drizzle | SQL-like、无 codegen、原生窗口函数。Prisma 的复杂聚合容易退化成 `$queryRaw` |
| 权限 | **RLS（行级安全）** | 每条查询都在事务里 `set local role authenticated`，越权由**数据库**拦，不靠应用层记得写 `where user_id = ?` |
| 样式 | Tailwind v4 + CSS 自定义属性 | 设计 token 只有一个来源（`src/app/globals.css`），组件里不写死颜色 |
| 图表 | 手写 SVG | 苹果风图表的关键是圆角柱、渐变面积、圆头细线 —— 这些在 SVG 里是原生属性，在 Canvas 里要自己画 |
| 认证 | Supabase Auth（邮箱魔法链接 **+** 密码），注册需邀请码 | 默认不存密码。但发信这条路会坏 —— 免费档对自带发信有每小时几封的硬限制，GitHub 的 noreply 地址更是压根收不到信 —— 所以密码是不依赖第三方的备用通道。邀请码的扣减放在数据库函数里（迁移 0008），应用层「先查再写」在并发下会把一个 1 次的码用成 2 次 |

## 本地跑起来

```bash
npm install

# 1) 起一个本地数据库（不需要 Docker、不需要装 Postgres）
npm run db:dev          # PGlite：把 PostgreSQL 编译成 WASM 直接跑在 Node 里，监听 55432

# 2) 灌开发数据
npm run seed:dev

# 3) 起开发服务器
npm run dev             # http://localhost:3000
```

不想连云端也能开发：`npm run db:dev` 会在**项目目录内**跑一个真的 PostgreSQL（WASM 版），
迁移、RLS、触发器全都是真的，只是没有 Supabase 的 Auth。

想连真 Supabase：把 `.env.example` 复制成 `.env.local` 并填上值，然后

```bash
npm run db:migrate      # 把 drizzle/ 下的迁移推到真库
rm .env.development.local   # 让 dev 也走 .env.local
```

## 验收

```bash
npm run verify
```

一条命令跑完六层检查：

```
typecheck       →  tsc --noEmit
lint            →  eslint
test            →  124 项单测（营养计算 / 时区 / 份量 / 日历排布 / CSV 转义 / 邀请码）
actions:verify  →  'use server' 文件里没有非法导出（非 async 导出会让页面 500）
headers:verify  →  四个安全响应头都在，且没有「有等于没有」的 CSP
db:verify       →  87 项数据库断言（在内存 Postgres 上跑真实迁移文件）
```

`db:verify` 值得单独说：它**不是**验证「我以为的 schema」，而是把 `drizzle/*.sql`
这九个真实迁移文件按序跑在 PGlite 上，然后以真正的 `authenticated` 角色 + 伪造 JWT
去撞 RLS。所以它能抓到「策略写错」和「GRANT 漏配」这两类只在真库上才会暴露的问题。

**还有两层刻意不进的验证**（都需要额外前提，混进日常检查就会变成噪音）：

```bash
npm run db:verify:hosted   # 17 项，需要完整 .env.local（含 service_role key）
npm run auth:verify        # 10 项，需要先构建
```

`db:verify:hosted` 验的是 PGlite 造不出来的四件事：`SET LOCAL ROLE authenticated`
在真实连接上成不成立、`auth.users` 触发器有没有权限建档、**两种连接池（会话 5432 /
事务 6543）下 `SET LOCAL` 是否都成立**、以及 RLS 的端到端双账号隔离（DoD 硬指标）。
写它时踩的两个「把假阳性当通过」的坑记在 [docs/04-数据模型.md §11.4](docs/04-数据模型.md)。

`auth:verify` 补的是**另一个方向**的缺口：上面那些全是数据库层断言，
证明「数据库不会把别人的行给我」，但证明不了「未登录的请求打不开这个页面」。
它会真的起一个生产服务、发**不带 cookie** 的请求，断言 5 个受保护路径返回 307。
少了这一层，某个 `page.tsx` 漏写 `requireUser()` 就是静默的公开页面。

```bash
NEXT_DIST_DIR=.next-build npx next build   # 先构建（改了代码要重来）
npm run auth:verify                        # 再验
```

## 看页面

```bash
node scripts/devtools/cdp.mjs shot 390 1560 2 /tmp/m.png /dashboard
node scripts/devtools/cdp.mjs diag 390 /dashboard
```

走 Chrome DevTools Protocol，约 2 秒一次。**比目测截图可靠** —— 它量的是真实盒模型。
踩过的坑记在 [scripts/devtools/README.md](scripts/devtools/README.md)。

## 文档

| 文件 | 内容 |
|---|---|
| [docs/01-需求分析.md](docs/01-需求分析.md) | 用户画像、痛点、MoSCoW 功能范围、验收标准 |
| [docs/02-技术选型.md](docs/02-技术选型.md) | 8 条 ADR，每条都写了「为什么不用另一个」 |
| [docs/03-设计系统.md](docs/03-设计系统.md) | 配色、字阶、圆角、玻璃配方、中英混排约束 |
| [docs/04-数据模型.md](docs/04-数据模型.md) | 表结构、RLS、触发器、以及那两道独立的门（GRANT vs POLICY） |
| [docs/05-部署.md](docs/05-部署.md) | 从零到上线的完整步骤 |
| [docs/06-代码地图.md](docs/06-代码地图.md) | **想改代码先看这份**：先读哪五个文件、一次请求怎么流过去、三条铁律与它们的守卫 |
| [research/](research/) | 前期调研：13 个同类项目对比、Apple 视觉语言、技术栈与部署、营养计算依据 |

## 许可

本项目的设计**参考**了 [wger](https://github.com/wger-project/wger) 的数据模型思路
（营养值统一按每 100g 存、日志只存份量、通用指标表），但**没有复制任何代码** ——
wger 是 AGPL-3.0，抄代码会让整个项目必须跟着 AGPL 开源。
参考的是设计与思路，这部分不受版权保护。
