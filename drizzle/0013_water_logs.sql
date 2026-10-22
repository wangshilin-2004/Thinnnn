-- ═══════════════════════════════════════════════════════════════════
--  0013: 喝水记录
-- ═══════════════════════════════════════════════════════════════════
--
--  【为什么单独建表，不往 measurements 里塞 metric='water_ml'】
--    measurements 是「体重 / 围度」这类低频、可编辑、要画趋势的
--    *点测量*，一天一条；喝水是 *一天多条、只增不删的流水*。
--    混进去会立刻撞上 measurements 的
--    unique (user_id, metric, measured_on) —— 一天只能记一次水。
--    而且之后每次查体重都要多带一个 metric 过滤条件，早晚有人忘。
--
--  【为什么只存 mL 整数】
--    L 是显示层的事：1800 mL 显示成 1.8 L。库里存 L 就得用 numeric
--    带着小数，写进去 0.25 再读出来 0.250，四舍五入的账永远算不清。
--    毫升是整数，加减乘除都精确，而且和国际惯例一致（饮水建议都以
--    mL 计：成人约 1500–2000 mL/天）。
--
--  【为什么单独存 log_date，不靠 logged_at 推导】
--    用户时区是 Asia/Shanghai。深夜 23:50 和凌晨 00:10 是两天，
--    如果按 UTC 或服务器时区从 logged_at 推导，这两个会被算进同一天。
--    「今天是几号」永远由服务端按用户时区算好再写进来 ——
--    和 meal_items / strength_entries 的做法一致。
--
--  【amount_ml 的上下限】
--    1 ~ 3000。上限不是营养学判断，是防手滑：一次喝 3 L 不现实，
--    真出现基本都是少打了一位或单位混了。脏数据进去会让进度条爆表。
--
--  【RLS 与权限】
--    四道策略 + REVOKE anon + 只 GRANT authenticated。
--    和 0011 的训练表一样：anon 连表都看不见，写权限只给已登录用户。

CREATE TABLE IF NOT EXISTS public.water_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  log_date   date NOT NULL,
  amount_ml  integer NOT NULL,
  logged_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT water_logs_amount_check CHECK (amount_ml BETWEEN 1 AND 3000)
);
--> statement-breakpoint

-- 主查询是「某用户某天」和「某用户最近 N 天」，这个复合索引两条都服务。
CREATE INDEX IF NOT EXISTS water_logs_user_date_idx
  ON public.water_logs (user_id, log_date);
--> statement-breakpoint

ALTER TABLE public.water_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY water_logs_select_own ON public.water_logs
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY water_logs_insert_own ON public.water_logs
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY water_logs_update_own ON public.water_logs
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY water_logs_delete_own ON public.water_logs
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint

REVOKE ALL ON public.water_logs FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.water_logs TO authenticated;
--> statement-breakpoint

-- ── 每日目标 ───────────────────────────────────────────────────────
-- 可空。NULL 表示「用户没改过」，由 src/lib/water.ts 按体重现算
-- （约 33 mL/kg）。存下来之后用户改过一次就一直是那个值，
-- 不会再被体重的波动带着跳。
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS water_goal_ml integer;
--> statement-breakpoint
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_water_goal_check;
--> statement-breakpoint
ALTER TABLE public.profiles ADD CONSTRAINT profiles_water_goal_check
  CHECK (water_goal_ml IS NULL OR water_goal_ml BETWEEN 500 AND 6000);
