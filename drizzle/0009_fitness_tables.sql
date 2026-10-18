-- ═══════════════════════════════════════════════════════════════════════
--  0009 · 训练记录：有氧一张表，无氧一张表
--
--  为什么分开
--    有氧是「项目 + 时长（+ 可选距离）」，无氧是「动作 + 组数 × 次数
--    （+ 可选重量）」。塞进一张表，一半的列对另一半的行永远为 NULL，
--    CHECK 也得写成互斥的一团 —— 那不是简化，是把错误藏得更深。
--
--  为什么存名字快照
--    动作目录是 src/content/exercises.ts 这个内容文件，不是数据库表。
--    删掉/改名一条动作，不能让三年前的训练记录跟着变空白或者变名字。
--    activity_name / exercise_name 是写入当时的快照。
--
--  RLS 与 GRANT
--    与 meal_items 完全同构（见 0001 §1.4 与 §4）：四道策略各管一个动作，
--    authenticated 拿到增删改查，anon 什么都不给。
--
--    这里显式 REVOKE 再 GRANT，是因为 Supabase 对 public schema 下
--    新建的表会【自动授权】给 anon 和 authenticated。
--    0001 里已经用 ALTER DEFAULT PRIVILEGES 收掉了 anon 的默认授权，
--    但靠「默认值对不对」来保证安全太脆，写死一遍更实在。
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. 有氧 ────────────────────────────────────────────────────────────
CREATE TABLE public.cardio_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  log_date      date NOT NULL,

  activity_id   text NOT NULL,
  activity_name text NOT NULL,

  minutes       integer NOT NULL,
  intensity     text NOT NULL DEFAULT 'moderate',
  distance_km   numeric(6, 2),

  note          text,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT cardio_sessions_minutes_check
    CHECK (minutes > 0 and minutes <= 600),
  CONSTRAINT cardio_sessions_intensity_check
    CHECK (intensity in ('easy', 'moderate', 'hard')),
  CONSTRAINT cardio_sessions_distance_check
    CHECK (distance_km is null or (distance_km >= 0 and distance_km <= 500))
);

CREATE INDEX cardio_sessions_user_date_idx
  ON public.cardio_sessions (user_id, log_date desc);

-- ── 2. 无氧 ────────────────────────────────────────────────────────────
CREATE TABLE public.strength_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  log_date      date NOT NULL,

  exercise_id   text NOT NULL,
  exercise_name text NOT NULL,
  part          text NOT NULL,

  sets          integer NOT NULL,
  reps          integer NOT NULL,
  weight_kg     numeric(6, 2),

  note          text,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT strength_entries_part_check
    CHECK (part in ('胸', '肩', '背', '腿')),
  CONSTRAINT strength_entries_sets_check
    CHECK (sets > 0 and sets <= 50),
  CONSTRAINT strength_entries_reps_check
    CHECK (reps > 0 and reps <= 200),
  CONSTRAINT strength_entries_weight_check
    CHECK (weight_kg is null or (weight_kg >= 0 and weight_kg <= 1000))
);

CREATE INDEX strength_entries_user_date_idx
  ON public.strength_entries (user_id, log_date desc);

-- ── 3. 外键 → auth.users(id) ON DELETE CASCADE ─────────────────────────
--  和 0001 §2 一致：删账号时训练记录跟着走，不留孤儿行。
ALTER TABLE public.cardio_sessions
  ADD CONSTRAINT cardio_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

ALTER TABLE public.strength_entries
  ADD CONSTRAINT strength_entries_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

-- ── 4. RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.cardio_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strength_entries ENABLE ROW LEVEL SECURITY;

--  auth.uid() 包一层 (select ...)：Postgres 会把它当常量、整个语句只算一次，
--  而不是每行算一次。表大了这个差别很明显（0001 里对 meal_items 的写法一致）。
CREATE POLICY cardio_sessions_select_own ON public.cardio_sessions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY cardio_sessions_insert_own ON public.cardio_sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY cardio_sessions_update_own ON public.cardio_sessions
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY cardio_sessions_delete_own ON public.cardio_sessions
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY strength_entries_select_own ON public.strength_entries
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY strength_entries_insert_own ON public.strength_entries
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY strength_entries_update_own ON public.strength_entries
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY strength_entries_delete_own ON public.strength_entries
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ── 5. GRANT / REVOKE ──────────────────────────────────────────────────
--  顺序不能反：先收回再给，反过来会把刚给的又删掉（0005 里踩过）。
REVOKE ALL ON public.cardio_sessions  FROM anon, authenticated;
REVOKE ALL ON public.strength_entries FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cardio_sessions  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strength_entries TO authenticated;
