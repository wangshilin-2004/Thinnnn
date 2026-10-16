-- 0006：让 daily_summary.target_kcal 真的有值
--
-- ── 背景：一个「列存在但永远是 NULL」的真 bug（实测发现）────────────
-- 建表时 daily_summary 就留了 target_kcal 列，设计意图是：
--   把「当时的目标热量」随当天汇总一起快照下来，
--   这样用户以后改了目标，历史曲线不会跟着变形。
--
-- 但实测 `select count(*) from daily_summary where target_kcal is not null`
-- 在 18 行业务数据上返回 **0**。原因是有意与无意各占一半：
--   ① 有意：ON CONFLICT DO UPDATE 分支里【故意不写】target_kcal 和 weight_kg
--      —— 那是快照语义，重算时必须保持行内已有的值。
--   ② 无意：两个会「创建」汇总行的函数，INSERT 列表里都没写 target_kcal：
--        · refresh_daily_summary  ← 饮食变化时触发
--        · sync_one_weight        ← 体重变化时触发
--      而 weight_kg 由 sync_one_weight 自己补上了，target_kcal 却谁都没补。
-- 结果就是这一列永远是 NULL。
-- 用户可见的表现：趋势页画不出「目标热量」虚线，也就标不出
-- 「高于此线的日子」（那正是减肥的人最需要一眼看到的对比）。
--
-- ── 修法 ──────────────────────────────────────────────────────────
-- 在两个函数的 INSERT 列表里补上 target_kcal，取值是【当下】的
-- public.profiles.target_kcal。行一旦建出来，后续任何重算都不会覆盖它
-- （DO UPDATE 里依然没有它），于是 ① 的快照语义保持成立，
-- 而「历史行有值」这件事终于成立。
--
-- 注意 SET search_path = '' —— 函数里所有对象必须写全 schema 限定名。
-- 另外 ON CONFLICT 分支里【依然不写】target_kcal / weight_kg，这是刻意的，
-- 不是漏写；改动这一段前请先读 0005 里同一处的注释。

CREATE OR REPLACE FUNCTION public.refresh_daily_summary(p_user uuid, p_date date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.daily_summary
    (user_id, log_date, intake_kcal, protein_g, fat_g, carb_g, item_count, target_kcal)
  SELECT
    p_user,
    p_date,
    COALESCE(SUM(mi.kcal), 0),
    COALESCE(SUM(mi.protein_g), 0),
    COALESCE(SUM(mi.fat_g), 0),
    COALESCE(SUM(mi.carb_g), 0),
    COUNT(*),
    -- 标量子查询：本查询是聚合查询，这里没有 GROUP BY，
    -- 所以它只求值一次，且结果与 p_user 一一对应。
    (SELECT p.target_kcal FROM public.profiles p WHERE p.id = p_user)
  FROM public.meal_items mi
  WHERE mi.user_id = p_user AND mi.log_date = p_date
  -- HAVING 而不是 WHERE：WHERE 在聚合【之前】过滤，
  -- 而 COUNT(*) 在没有匹配行时仍会返回一行 0 —— 那样就绕过了这个守卫，
  -- 在用户已被删除、auth.users 行已不存在的时刻插出一条外键违规。
  -- 这段是 0005 修的级联删除 bug，改动时务必保留。
  HAVING EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user)
  ON CONFLICT (user_id, log_date) DO UPDATE SET
    intake_kcal = EXCLUDED.intake_kcal,
    protein_g   = EXCLUDED.protein_g,
    fat_g       = EXCLUDED.fat_g,
    carb_g      = EXCLUDED.carb_g,
    item_count  = EXCLUDED.item_count,
    updated_at  = now();
$$;

CREATE OR REPLACE FUNCTION public.sync_one_weight(p_user uuid, p_date date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.daily_summary (user_id, log_date, weight_kg, target_kcal)
  SELECT
    p_user,
    p_date,
    (
      SELECT m.value FROM public.measurements m
      WHERE m.user_id = p_user AND m.metric = 'weight' AND m.measured_on = p_date
      LIMIT 1
    ),
    (SELECT p.target_kcal FROM public.profiles p WHERE p.id = p_user)
  ON CONFLICT (user_id, log_date) DO UPDATE SET
    weight_kg  = EXCLUDED.weight_kg,
    updated_at = now();
$$;

-- ── 回填已经存在的历史行 ────────────────────────────────────────────
-- 光改函数只能让【以后】新产生的行有值；已经被 bug 写成 NULL 的行得单独补。
--
-- 为什么可以安全地补：这些行的 target_kcal 是 NULL，意味着它们【没有】快照
-- 可保护。用当下的 profiles.target_kcal 回填是这里唯一合理的取值 ——
-- 比继续留着 NULL（趋势图画不出目标线）有用，也比留 NULL 更接近本意。
-- 真正的快照语义从这一行往下才开始生效，WHERE 子句保证绝不覆盖已有值。
--
-- 迁移以数据库属主身份执行，不受 RLS 限制，因此能一次覆盖所有用户。
UPDATE public.daily_summary AS ds
SET target_kcal = p.target_kcal
FROM public.profiles AS p
WHERE p.id = ds.user_id
  AND ds.target_kcal IS NULL
  AND p.target_kcal IS NOT NULL;

-- CREATE OR REPLACE FUNCTION 会保留原 ACL，照理不需要重授。
-- 仍然显式写一遍，一是与 0001/0005 的写法保持一致便于审查，
-- 二是万一某个函数因故不存在、这次是全新创建，默认 ACL 会给 PUBLIC 授 EXECUTE
-- —— SECURITY DEFINER 函数被任意角色直接调用，等于把定义者的权限借出去。
REVOKE ALL ON FUNCTION public.refresh_daily_summary(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_one_weight(uuid, date)       FROM PUBLIC;
