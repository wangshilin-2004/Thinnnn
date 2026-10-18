-- 训练会话：一次「今天练背」的完整过程
--
-- 为什么要三张表而不是往 strength_entries 上加字段：
-- strength_entries 记的是「练完了，4 组 × 8 次」这种事后事实，
-- 而一次进行中的训练要保存「还没做完的计划」和「每一组真实的起止时刻」，
-- 这两种东西的生命周期完全不同 —— 取消训练时不该在历史里留下记录。
CREATE TABLE IF NOT EXISTS public.workout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  log_date date NOT NULL,
  part text NOT NULL,
  title text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workout_sessions_part_check CHECK (part IN ('胸', '肩', '背', '腿', '全身')),
  CONSTRAINT workout_sessions_title_len CHECK (title IS NULL OR length(title) <= 40)
);

CREATE INDEX IF NOT EXISTS workout_sessions_user_date_idx
  ON public.workout_sessions (user_id, log_date DESC);

CREATE TABLE IF NOT EXISTS public.workout_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  exercise_id text NOT NULL,
  exercise_name text NOT NULL,
  position integer NOT NULL,
  target_sets integer NOT NULL DEFAULT 3,
  target_reps integer NOT NULL DEFAULT 10,
  rest_seconds integer NOT NULL DEFAULT 120,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workout_exercises_position_check CHECK (position >= 0 AND position <= 50),
  CONSTRAINT workout_exercises_sets_check CHECK (target_sets >= 1 AND target_sets <= 20),
  CONSTRAINT workout_exercises_reps_check CHECK (target_reps >= 1 AND target_reps <= 100),
  CONSTRAINT workout_exercises_rest_check CHECK (rest_seconds >= 15 AND rest_seconds <= 900),
  CONSTRAINT workout_exercises_session_position_uniq UNIQUE (session_id, position)
);

CREATE TABLE IF NOT EXISTS public.workout_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_exercise_id uuid NOT NULL,
  set_index integer NOT NULL,
  weight_kg numeric(6, 2),
  reps integer,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workout_sets_index_check CHECK (set_index >= 1 AND set_index <= 20),
  CONSTRAINT workout_sets_weight_check CHECK (weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg <= 1000)),
  CONSTRAINT workout_sets_reps_check CHECK (reps IS NULL OR (reps >= 1 AND reps <= 200)),
  CONSTRAINT workout_sets_exercise_index_uniq UNIQUE (session_exercise_id, set_index)
);

ALTER TABLE public.workout_sessions
  ADD CONSTRAINT workout_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
ALTER TABLE public.workout_exercises
  ADD CONSTRAINT workout_exercises_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.workout_sessions (id) ON DELETE CASCADE;
ALTER TABLE public.workout_sets
  ADD CONSTRAINT workout_sets_session_exercise_id_fkey FOREIGN KEY (session_exercise_id) REFERENCES public.workout_exercises (id) ON DELETE CASCADE;

ALTER TABLE public.workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY workout_sessions_select_own ON public.workout_sessions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY workout_sessions_insert_own ON public.workout_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY workout_sessions_update_own ON public.workout_sessions
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY workout_sessions_delete_own ON public.workout_sessions
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE POLICY workout_exercises_all_own ON public.workout_exercises
  FOR ALL TO authenticated
  USING (session_id IN (SELECT id FROM public.workout_sessions WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (session_id IN (SELECT id FROM public.workout_sessions WHERE user_id = (SELECT auth.uid())));

CREATE POLICY workout_sets_all_own ON public.workout_sets
  FOR ALL TO authenticated
  USING (session_exercise_id IN (
    SELECT e.id FROM public.workout_exercises e
    JOIN public.workout_sessions s ON s.id = e.session_id
    WHERE s.user_id = (SELECT auth.uid())))
  WITH CHECK (session_exercise_id IN (
    SELECT e.id FROM public.workout_exercises e
    JOIN public.workout_sessions s ON s.id = e.session_id
    WHERE s.user_id = (SELECT auth.uid())));

REVOKE ALL ON public.workout_sessions FROM anon, authenticated;
REVOKE ALL ON public.workout_exercises FROM anon, authenticated;
REVOKE ALL ON public.workout_sets FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_exercises TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_sets TO authenticated;
