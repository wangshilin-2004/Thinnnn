-- ═══════════════════════════════════════════════════════════════════════
--  0001 · 安全与触发器（手写）
-- ═══════════════════════════════════════════════════════════════════════
--
--  为什么这个文件是手写的：
--    0000_init_tables.sql 由 `drizzle-kit generate` 从 src/db/schema.ts
--    自动生成，它认识表、列、类型、CHECK、索引 —— 但**不认识**
--    RLS 策略、触发器函数、SECURITY DEFINER、GRANT。
--
--    那些必须手写。但注意：它是通过 `drizzle-kit generate --custom` 加进
--    同一套迁移流水线的，所以和 0000 共享同一个 meta/_journal.json，
--    `npm run db:migrate` 一次全跑完 —— 不存在"忘记跑第二遍"的可能。
--
--  内容分四节：
--    1. 行级安全（RLS）策略
--    2. 指向 auth.users 的外键（为什么不在 schema.ts 里声明见其注释）
--    3. 触发器与函数
--    4. GRANT / REVOKE —— RLS 之外的另一道门
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  1. 行级安全（RLS）
-- ═══════════════════════════════════════════════════════════════════════
--
--  【先建立一个正确的心理模型】
--  RLS 不是"更安全一点"，它是「多用户系统里唯一能防住越权的地方」。
--
--  如果只靠应用层写 `WHERE user_id = $1`，那么任何一处忘了写，
--  就是一次数据泄露。而且它防不住「用户自己伪造请求参数」——
--  只要有一个接口忘了校验，整个数据库就对他敞开了。
--
--  开了 RLS，数据库自己会拦。应用层写错顶多是查不到数据，
--  而不是查到别人的数据。**这是纵深防御，不是重复劳动。**
--
--  【USING 和 WITH CHECK 的区别 —— 最容易搞混的地方】
--    USING      : "这一行你能不能【看见】"  （SELECT / UPDATE / DELETE 的过滤）
--    WITH CHECK : "你写进去的这行【合不合法】"（INSERT / UPDATE 的校验）
--
--    所以 INSERT 没有 USING（还没有旧行），DELETE 没有 WITH CHECK（没有新行）。
--
--  【性能细节：为什么要多写一层括号 (SELECT auth.uid())】
--    auth.uid() 是一个读取 request.jwt.claims 并解析 JSON 的函数。
--    直接写 `user_id = auth.uid()`，Postgres 可能在【每一行】上都调用它一次
--    —— 一万行的表就是一万次 JSON 解析。
--
--    包成 `(SELECT auth.uid())` 之后，它变成一个不相关子查询，
--    优化器会把它提升成常量（InitPlan），整个查询只求值一次。
--    Supabase 官方文档明确推荐这个写法。
--
--    一对"看起来毫无意义的括号，实际上决定性能"的典型案例。


-- ── 1.1 profiles ──────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- 故意不建 DELETE 策略：删账号要走管理端（service_role）。
-- "不建策略" ≠ "忘了建"，这是有意的 deny-by-default。


-- ── 1.2 foods：混合可见性 ─────────────────────────────────────────────
--  foods 同时装着「全局内置数据」（owner_id IS NULL）和「用户自建数据」，
--  所以策略要表达：内置的大家都能看，自建的只有自己能看能改。
ALTER TABLE public.foods ENABLE ROW LEVEL SECURITY;

-- 读：内置的 + 自己的
CREATE POLICY foods_select_visible ON public.foods
  FOR SELECT TO authenticated
  USING (owner_id IS NULL OR owner_id = (SELECT auth.uid()));

-- 写：只能写自己的，且 owner_id 必须是自己
-- （WITH CHECK 会挡住「把 owner_id 设成 NULL 来伪造内置食物」这种攻击）
CREATE POLICY foods_insert_own ON public.foods
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- 注意 USING 里【没有】owner_id IS NULL —— 所以内置食物对客户端是只读的。
-- 这正是我们想要的：没人能通过 API 篡改公共食物库。
CREATE POLICY foods_update_own ON public.foods
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY foods_delete_own ON public.foods
  FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));


-- ── 1.3 food_servings：可见性"跟随父表" ───────────────────────────────
--  这张表自己没有 owner_id，它的权限继承自 foods。
ALTER TABLE public.food_servings ENABLE ROW LEVEL SECURITY;

CREATE POLICY food_servings_select ON public.food_servings
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.foods f
    WHERE f.id = food_servings.food_id
      AND (f.owner_id IS NULL OR f.owner_id = (SELECT auth.uid()))
  ));

CREATE POLICY food_servings_insert ON public.food_servings
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.foods f
    WHERE f.id = food_servings.food_id
      AND f.owner_id = (SELECT auth.uid())
  ));

CREATE POLICY food_servings_update ON public.food_servings
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.foods f
    WHERE f.id = food_servings.food_id
      AND f.owner_id = (SELECT auth.uid())
  ));

CREATE POLICY food_servings_delete ON public.food_servings
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.foods f
    WHERE f.id = food_servings.food_id
      AND f.owner_id = (SELECT auth.uid())
  ));

--  ⚠️ 关于「策略递归」这个经典地雷：
--  子查询里的 foods 本身也受 RLS 约束（策略是查询的一部分）。
--  但 foods 的策略【不引用】food_servings，所以链条在这里终止。
--  如果两张表的策略互相引用，Postgres 会直接报
--      ERROR: infinite recursion detected in policy for relation "xxx"
--  设计多表策略时务必画一下依赖方向，保证它是无环的。


-- ── 1.4 meal_items ────────────────────────────────────────────────────
ALTER TABLE public.meal_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY meal_items_select_own ON public.meal_items
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- WITH CHECK 是关键：它挡住「用户 A 插入一条 user_id = 用户 B 的记录」
CREATE POLICY meal_items_insert_own ON public.meal_items
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY meal_items_update_own ON public.meal_items
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY meal_items_delete_own ON public.meal_items
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));


-- ── 1.5 measurements ──────────────────────────────────────────────────
ALTER TABLE public.measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY measurements_select_own ON public.measurements
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY measurements_insert_own ON public.measurements
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY measurements_update_own ON public.measurements
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY measurements_delete_own ON public.measurements
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));


-- ── 1.6 daily_summary：只读 ───────────────────────────────────────────
--  这是派生数据，只能由触发器（SECURITY DEFINER）维护。
--  如果允许客户端写，就会出现「汇总值和明细对不上」的脏数据 ——
--  而且这种脏数据非常难发现，因为两边的数字单独看都"合法"。
ALTER TABLE public.daily_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_summary_select_own ON public.daily_summary
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 故意不建 INSERT / UPDATE / DELETE 策略。


-- ── 1.7 food_favorites ────────────────────────────────────────────────
ALTER TABLE public.food_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY food_favorites_select_own ON public.food_favorites
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY food_favorites_insert_own ON public.food_favorites
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY food_favorites_delete_own ON public.food_favorites
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
-- 收藏没有"修改"语义（要么收藏要么取消），所以不建 UPDATE 策略。


-- ── 1.8 invite_codes：三不沾 ──────────────────────────────────────────
--  RLS 开着 + 一条策略都不建 + 一个 GRANT 都不给。
--  这是 Postgres RLS 的默认拒绝（deny by default）语义最直接的示范：
--  没有策略 = 谁都不许访问。
--  只有服务端用 postgres 角色（表所有者，绕过 RLS）能读写它。
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
-- 下面什么都不写，这就是全部的策略。


-- ═══════════════════════════════════════════════════════════════════════
--  2. 指向 auth.users 的外键
-- ═══════════════════════════════════════════════════════════════════════
--
--  src/db/schema.ts 里所有 user 相关的列都只是普通 uuid，没有 .references()。
--  原因见那个文件顶部的长注释（简单说：让 drizzle-kit 以为 auth.users
--  归它管，会在 push 时尝试 DROP 掉 Supabase 认证系统的列 —— 灾难）。
--
--  所以外键在这里手动补。**以后新增任何带 user_id 的表，必须在这里补上。**
--
--  ⚠️ 外键清单（新增表时对照更新）：
--     profiles.id           → auth.users(id) CASCADE
--     foods.owner_id        → auth.users(id) CASCADE
--     meal_items.user_id    → auth.users(id) CASCADE
--     measurements.user_id  → auth.users(id) CASCADE
--     daily_summary.user_id → auth.users(id) CASCADE
--     food_favorites.user_id→ auth.users(id) CASCADE

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.foods
  ADD CONSTRAINT foods_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.meal_items
  ADD CONSTRAINT meal_items_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.measurements
  ADD CONSTRAINT measurements_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.daily_summary
  ADD CONSTRAINT daily_summary_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.food_favorites
  ADD CONSTRAINT food_favorites_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════
--  3. 触发器与函数
-- ═══════════════════════════════════════════════════════════════════════
--
--  【为什么用触发器而不是应用代码维护派生数据】
--  应用代码会漏。你哪天直接在 SQL 控制台改了一条记录、或者写了个
--  一次性导入脚本、或者以后加了个定时任务 —— 任何一条绕过应用的路径
--  都会让 daily_summary 和明细对不上。触发器在数据库层，绕不过去。
--
--  【SECURITY DEFINER 是什么，为什么需要它】
--  触发 daily_summary 写入的是普通用户，而 ordinary user 没有
--  daily_summary 的写权限（见 1.6，只给了 SELECT）。
--  SECURITY DEFINER 让函数以"定义者"（表的属主）身份运行，
--  从而有权限写这张表。
--
--  ⚠️ SECURITY DEFINER 有个经典安全陷阱：
--  如果 search_path 能被调用者控制，攻击者可以创建一个同名的恶意函数
--  来劫持函数体内的调用（比如你写 `SELECT * FROM foods`，他造一个
--  他自己的 `foods` 表放在 search_path 前面）。
--
--  【标准防御】= 固定 search_path = '' + 函数体内全部写全限定名。
--  下面每个函数这两件事都做了，一个都不能省。


-- ── 3.1 重算某一天的饮食汇总 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_daily_summary(p_user uuid, p_date date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.daily_summary
    (user_id, log_date, intake_kcal, protein_g, fat_g, carb_g, item_count)
  SELECT
    p_user,
    p_date,
    COALESCE(SUM(kcal), 0),
    COALESCE(SUM(protein_g), 0),
    COALESCE(SUM(fat_g), 0),
    COALESCE(SUM(carb_g), 0),
    COUNT(*)
  FROM public.meal_items
  WHERE user_id = p_user AND log_date = p_date
  ON CONFLICT (user_id, log_date) DO UPDATE SET
    intake_kcal = EXCLUDED.intake_kcal,
    protein_g   = EXCLUDED.protein_g,
    fat_g       = EXCLUDED.fat_g,
    carb_g      = EXCLUDED.carb_g,
    item_count  = EXCLUDED.item_count,
    updated_at  = now();
$$;

--  三个关键点，每一个都是踩过的坑：
--
--  ① 源表为空时，`INSERT ... SELECT` 带聚合函数【仍然返回一行】（全 0）。
--     所以删光某天的记录后，汇总行会被更新成全 0 而不是消失 ——
--     折线图不会突然断一个洞。
--
--  ② `DO UPDATE` 里【故意不写】weight_kg 和 target_kcal。
--     它们是别的来源（measurements 触发器、目标设置）写进去的。
--     如果写上 `weight_kg = EXCLUDED.weight_kg`，EXCLUDED 里是 NULL，
--     每次记一顿饭就会把当天的体重和目标清空。
--     **这是整个文件里最容易写错的一行。**
--
--  ③ SECURITY DEFINER + SET search_path = ''，见上面的说明。


-- ── 3.2 meal_items 的触发器入口 ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_meal_items_sync_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 旧行对应的那一天需要重算（改日期 / 改用户 / 删除都会影响它）
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.refresh_daily_summary(OLD.user_id, OLD.log_date);
  END IF;

  -- 新行对应的那一天
  IF TG_OP = 'INSERT' THEN
    PERFORM public.refresh_daily_summary(NEW.user_id, NEW.log_date);
  ELSIF TG_OP = 'UPDATE' THEN
    -- 只有日期或用户真的变了才需要重算新行那一天；
    -- 没变的话上面第一次调用已经算过了，再算一遍纯属浪费。
    IF NEW.log_date <> OLD.log_date OR NEW.user_id <> OLD.user_id THEN
      PERFORM public.refresh_daily_summary(NEW.user_id, NEW.log_date);
    END IF;
  END IF;

  RETURN NULL;  -- AFTER 触发器的返回值被忽略
END $$;

CREATE TRIGGER meal_items_sync_summary
  AFTER INSERT OR UPDATE OR DELETE ON public.meal_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_meal_items_sync_summary();

--  【为什么用 IF/ELSIF 分开写，而不是一行 `TG_OP = 'INSERT' OR NEW.log_date <> OLD.log_date`】
--  在 INSERT 时 OLD 是 NULL，那个比较会返回 NULL 而不是 false。
--  SQL 的 OR 又【不保证】短路求值，所以那种写法是碰运气。
--  拆开写，逻辑上就没有这个前提了。
--
--  【为什么 UPDATE 要重算两天】
--  用户把一条记录从 10 月 16 日改到 10 月 17 日 —— 这两天都变了。
--  只重算新的那天，16 号就会永远多算一条。这是最容易漏的地方。


-- ── 3.3 体重同步到 daily_summary ──────────────────────────────────────
--  从 measurements 的 weight 记录同步 weight_kg 到 daily_summary。
--  这样「热量 × 体重」双轴图只需要扫一张表。
CREATE OR REPLACE FUNCTION public.sync_one_weight(p_user uuid, p_date date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.daily_summary (user_id, log_date, weight_kg)
  SELECT p_user, p_date, (
    SELECT value FROM public.measurements
    WHERE user_id = p_user AND metric = 'weight' AND measured_on = p_date
    LIMIT 1
  )
  ON CONFLICT (user_id, log_date) DO UPDATE SET
    weight_kg  = EXCLUDED.weight_kg,
    updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.trg_measurements_sync_weight()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 旧日期：删除或改期后，原来那天的体重可能不再存在了
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.metric = 'weight' THEN
    PERFORM public.sync_one_weight(OLD.user_id, OLD.measured_on);
  END IF;

  -- 新日期
  IF TG_OP = 'INSERT' AND NEW.metric = 'weight' THEN
    PERFORM public.sync_one_weight(NEW.user_id, NEW.measured_on);
  ELSIF TG_OP = 'UPDATE' AND NEW.metric = 'weight' THEN
    IF NEW.measured_on <> OLD.measured_on
       OR NEW.value IS DISTINCT FROM OLD.value
       OR NEW.metric <> OLD.metric THEN
      PERFORM public.sync_one_weight(NEW.user_id, NEW.measured_on);
    END IF;
  END IF;

  RETURN NULL;
END $$;

CREATE TRIGGER measurements_sync_weight
  AFTER INSERT OR UPDATE OR DELETE ON public.measurements
  FOR EACH ROW EXECUTE FUNCTION public.trg_measurements_sync_weight();

--  注意 `NEW.value IS DISTINCT FROM OLD.value` —— 而不是 `<>`。
--  value 是可空列（虽然这里 NOT NULL，但养成的习惯更重要）：
--  普通 `<>` 遇到 NULL 会返回 NULL，`IF NULL THEN` 走 else 分支，
--  于是"把体重从 NULL 改成 70"这种修改【不会】触发同步。
--  IS DISTINCT FROM 把 NULL 当作一个普通值比较，没有这个坑。
--  这是 SQL 三值逻辑最常见的陷阱之一。


-- ── 3.4 updated_at 自动维护 ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

--  为什么不能只靠列上的 `DEFAULT now()`：
--  DEFAULT 只在 INSERT 时生效。UPDATE 时如果你没显式写 updated_at，
--  它会永远停在创建时间 —— 于是 updated_at 变成了 created_at 的同义词，
--  完全失去意义。

CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER foods_touch_updated_at
  BEFORE UPDATE ON public.foods
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER meal_items_touch_updated_at
  BEFORE UPDATE ON public.meal_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ── 3.5 新用户注册时自动建档 ──────────────────────────────────────────
--  用户注册成功后必须有一行 profiles，否则后面所有查询都会撞空。
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, timezone)
  VALUES (NEW.id, 'Asia/Shanghai')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

--  【为什么不写在注册的 Server Action 里】
--  注册路径不止一条：邮箱密码、魔法链接、将来可能的 OAuth、
--  管理端 admin.createUser()、甚至你在 SQL 控制台手插一个用户。
--  写在触发器里，【任何】路径都会自动建档，不可能漏。
--  ON CONFLICT DO NOTHING 保证重复触发也安全（幂等）。
--
--  ⚠️ auth.users 在 Supabase 里属于 supabase_auth_admin。
--  建这个触发器需要足够权限，Supabase 官方文档给出的就是这个模式，
--  但必须在本项目的真实 Supabase 上实测（docs/04 §11.3 的 V2）。


-- ═══════════════════════════════════════════════════════════════════════
--  4. GRANT / REVOKE —— RLS 之外的另一道门
-- ═══════════════════════════════════════════════════════════════════════
--
--  ⚠️ 这一节是整个文档【第一版漏掉、被实测打回来】的部分。
--     漏掉它，第一条 RLS 查询就直接死：
--         error: permission denied for table meal_items
--         code: '42501'  routine: 'aclcheck_error'
--
--  Postgres 的访问控制是【两道门串联】，两道都过才放行：
--
--      客户端查询
--         │
--         ├─ 门 1：GRANT   "这个角色能不能碰这张表？" ── ✗ → 报错 42501
--         │
--         └─ 门 2：POLICY  "能看见表里的哪些行？"     ── ✗ → 不报错，静默 0 行
--
--  CREATE POLICY 完全不管第一道门。
--
--  这个坑最阴险的地方：Supabase 会给 public schema 下的新表【自动 GRANT】
--  给 anon / authenticated，所以在 Supabase 上开发时你永远碰不到这个错。
--  但一旦换到自建 Postgres（比如 ADR-007 的迁移演练），
--  同样的迁移脚本会全线 42501。
--
--  【两种失败的"手感"完全不同，值得记住】
--    缺 GRANT  → 报错，你会立刻发现
--    缺 POLICY → 静默 0 行，看起来像"今天还没记录"，
--                可能上线几周都没人发现
--  后者才是安全设计里真正危险的失败模式。

-- ── 4.1 收回 anon 的全部权限 ──────────────────────────────────────────
--  anon = 未登录访客。他没有任何理由碰业务表。
--  注意 Supabase 默认【会】把新表授权给 anon，所以必须显式收回。
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON SCHEMA public FROM anon;

-- 光 REVOKE 现有表还不够：以后新建的表会再次拿到 Supabase 的默认授权。
-- ALTER DEFAULT PRIVILEGES 改的是"将来创建的对象"的默认权限。
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- ── 4.2 authenticated 按需授权 ────────────────────────────────────────
--  原则：给刚好够用的权限，不多给一个。
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA auth   TO authenticated;  -- auth.uid() 需要

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.foods          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_servings  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_items     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurements   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_favorites TO authenticated;

-- 只读：派生数据只能由触发器维护（与 1.6 的策略一致，两道门都只开 SELECT）
GRANT SELECT ON public.daily_summary TO authenticated;

-- invite_codes：不给任何权限。
-- RLS 开着 + 策略不建 + GRANT 不给 = 三不沾，只有服务端能碰。

-- ── 4.3 函数执行权限 ──────────────────────────────────────────────────
--  触发器函数不需要客户端 EXECUTE 权限（触发器是数据库自己调的），
--  所以这里【不给】authenticated 任何 EXECUTE。
--  REVOKE ... FROM PUBLIC 是更彻底的做法：Postgres 默认给 PUBLIC
--  授予函数 EXECUTE 权限，而 SECURITY DEFINER 函数被任意用户直接调用
--  是危险的（等于把定义者的权限借出去）。
REVOKE ALL ON FUNCTION public.refresh_daily_summary(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_one_weight(uuid, date)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user()                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_updated_at()                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_meal_items_sync_summary()     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_measurements_sync_weight()    FROM PUBLIC;


-- ═══════════════════════════════════════════════════════════════════════
--  迁移完成
-- ═══════════════════════════════════════════════════════════════════════
--  验证方式：npm run db:verify
--  （跑 tests/verify-migrations.mjs，用 PGlite 起一个真 Postgres，
--    依次执行 0000 / 0001 / 0002，然后跑 38 项断言 —— 其中包括
--    以真实 authenticated 角色实测 RLS 隔离与 GRANT 权限）
