-- ═══════════════════════════════════════════════════════════════════════
--  0007 · 让账号真的能被删除
--
--  现象：只要用户记过一次体重，账号就删不掉。
--        Supabase 面板（Authentication → Users → Delete）和
--        admin API（auth.admin.deleteUser）都会失败，
--        只回一句含糊的 "Database error deleting user"。
--
--  真实报错（在线上库上复现，事务内 DELETE 后回滚）：
--
--    insert or update on table "daily_summary" violates foreign key
--    constraint "daily_summary_user_id_fkey"
--    code    : 23503
--    detail  : Key (user_id)=(f902a698-…) is not present in table "users".
--    where   : SQL function "sync_one_weight" statement 1
--              SQL statement "SELECT public.sync_one_weight(OLD.user_id,
--                            OLD.measured_on)"
--              PL/pgSQL function public.trg_measurements_sync_weight() line 5
--
--  为什么会这样：
--    删 auth.users 会级联删 measurements（外键 ON DELETE CASCADE），
--    而 measurements 上挂着 AFTER DELETE 触发器 trg_measurements_sync_weight，
--    它会调 sync_one_weight 去 upsert daily_summary。
--    但此时父行 auth.users 已经处于删除中，daily_summary.user_id 的外键
--    校验必然失败 —— 于是整个注销事务被拖垮、全部回滚。
--
--  修法与既有写法保持一致：
--    refresh_daily_summary 早在 0006 里就有这道守护
--      （HAVING EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user)），
--    同一个作者、同一个隐患，当时只补了一半 —— 漏掉了 sync_one_weight。
--    这里补上另外一半，用同一种「父行不在就不写」的表达。
--
--  为什么是「不写」而不是「写别的」：
--    用户都没了，daily_summary 里属于他的行也正在被级联删除。
--    这时候既不该、也不可能给他补一行汇总。
-- ═══════════════════════════════════════════════════════════════════════

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
  /* 父行不在（正在注销账号）→ 一条都不产生 → 不会去碰 daily_summary 的外键。
   * 正常记体重时这个条件恒为真，不影响任何既有行为。 */
  WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user)
  ON CONFLICT (user_id, log_date) DO UPDATE SET
    weight_kg  = EXCLUDED.weight_kg,
    updated_at = now();
$$;

-- 与 0001 / 0005 / 0006 保持一致的显式写法：万一这次是全新创建，
-- 默认 ACL 会给 PUBLIC 授 EXECUTE —— SECURITY DEFINER 函数被任意角色
-- 直接调用，等于把定义者的权限借出去。
REVOKE ALL ON FUNCTION public.sync_one_weight(uuid, date) FROM PUBLIC;
