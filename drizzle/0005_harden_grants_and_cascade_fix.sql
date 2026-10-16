-- ═══════════════════════════════════════════════════════════════════════
--  0005  真实 Supabase 体检打回来的两个修正
-- ═══════════════════════════════════════════════════════════════════════
--
--  这两个问题都不是「迁移报错」，所以前面 55 项 PGlite 断言全过也没抓到 ——
--  它们是【装上去之后才暴露】的，只有对着真库做体检才会现形。
--  这正是 npm run check:remote 存在的理由。
--
--  ── 问题 1：删用户会失败 ──────────────────────────────────────────────
--  现象（真库上实测）：
--      delete from auth.users where id = '...';
--      → insert or update on table "daily_summary" violates
--        foreign key constraint "daily_summary_user_id_fkey"
--
--  链路：auth.users 级联删 → daily_summary 行被删 → 同时 meal_items 行被删
--        → meal_items 的 AFTER DELETE 触发器调用 refresh_daily_summary()
--        → 它 INSERT ... ON CONFLICT 往 daily_summary 里写
--        → 但此刻 auth.users 里的那一行已经没了，外键当场拒绝。
--
--  为什么平时发现不了：只有「删掉一个用户」才会触发。注册、记录、改数据
--  全都正常。所以它会一直潜伏到「用户想注销账号」的那一天 —— 而那一天
--  通常也是你最不想 debug 的一天。
--
--  ── 问题 2：authenticated 手里有不该有的权限 ──────────────────────────
--  Supabase 默认会给 public schema 的新表 GRANT 一大串权限给 anon/authenticated，
--  其中包含 **TRUNCATE**。0001 的 §4.1 收回了 anon 的，但 §4.2 只对
--  authenticated 做「增量 GRANT」—— 而 **GRANT 是加法，永远删不掉已有权限**。
--  结果 authenticated 一直留着 Supabase 给的 REFERENCES / TRIGGER / TRUNCATE。
--
--  为什么 TRUNCATE 值得单独说：
--      **RLS 管不了 TRUNCATE。** 行级策略只在 SELECT/INSERT/UPDATE/DELETE 上生效；
--      TRUNCATE 是表级操作，一旦有权限就是「一条语句清空所有用户的数据」。
--      走 PostgREST 打不到它（REST 只暴露 CRUD），所以不是现成的漏洞；
--      但它把「万一有个注入点」的后果从「泄露一个用户」放大成「全库蒸发」。
--      不该有的权限就该收掉，这是纵深防御，不是洁癖。
--
--  修法：先 REVOKE ALL 把地板清干净，再按白名单重新 GRANT。
--  **顺序很重要** —— 反过来写（先 grant 后 revoke）会把刚给的权限又删掉。


-- ── 1. 修：删用户时的级联外键冲突 ─────────────────────────────────────
--
--  在聚合查询上加 HAVING 来做「用户还在吗」的守卫。
--  为什么不能用 WHERE：
--      WHERE 在【聚合之前】过滤行。meal_items 里没有匹配行时，
--      带聚合函数的 SELECT 仍然会返回【整整一行】（全 0 的 SUM），
--      于是照样 INSERT，照样撞外键。
--      HAVING 在【聚合之后】过滤组。用户不存在时返回 0 行，
--      什么都不写 —— 这正是我们要的。
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
  HAVING EXISTS (SELECT 1 FROM auth.users WHERE auth.users.id = p_user)
  ON CONFLICT (user_id, log_date) DO UPDATE SET
    intake_kcal = EXCLUDED.intake_kcal,
    protein_g   = EXCLUDED.protein_g,
    fat_g       = EXCLUDED.fat_g,
    carb_g      = EXCLUDED.carb_g,
    item_count  = EXCLUDED.item_count,
    updated_at  = now();
$$;

--  注意上面 ON CONFLICT DO UPDATE 里依然【不写】weight_kg 和 target_kcal
--  （0001 里解释过：写上会用 EXCLUDED 的 NULL 把它们清空）。


-- ── 2. 修：把 authenticated 的权限收敛到白名单 ────────────────────────
--
--  先清地板。
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

--  再把「将来新建的对象」也堵上，否则下一张表又会带着 Supabase 的默认授权出生。
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;

--  然后按白名单重新给。这一份清单就是 authenticated 能做的【全部】事情 ——
--  和 0001 §4.2 的意图完全一致，只是这次地板是干净的，给出去多少就是多少。
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA auth   TO authenticated;  -- auth.uid() 需要

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.foods          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_servings  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_items     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurements   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_favorites TO authenticated;

--  只读：派生数据只能由触发器维护
GRANT SELECT ON public.daily_summary TO authenticated;

--  invite_codes：仍然什么都不给（RLS 开着 + 无策略 + 无 GRANT = 三不沾）


-- ── 3. 顺带确认函数权限仍然收着 ───────────────────────────────────────
--  上面的 REVOKE ALL ON ALL FUNCTIONS 已经把 authenticated 的 EXECUTE 清掉了，
--  这里再对 PUBLIC 收一次，保证 SECURITY DEFINER 函数不能被任意角色直接调用。
REVOKE ALL ON FUNCTION public.refresh_daily_summary(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_one_weight(uuid, date)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user()                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_updated_at()                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_meal_items_sync_summary()     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_measurements_sync_weight()    FROM PUBLIC;
