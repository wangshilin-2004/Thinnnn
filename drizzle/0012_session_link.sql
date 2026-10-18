-- 把「一次训练」和「折算出来的训练记录」连起来
--
-- 结束训练时会把做过的组折成 strength_entries（这样统计/导出/好友页都不用改）。
-- 但那样一来「回顾 → 某一天 → 当时那场训练」就断了：只知道做了 4 组，
-- 不知道是哪场训练、每组多少、练了多久。
-- 这里加一个可空外键，SET NULL 而不是 CASCADE —— 将来删掉会话也不该
-- 连带删掉训练记录本身（那是既成事实）。
ALTER TABLE public.strength_entries
  ADD COLUMN IF NOT EXISTS session_id uuid;

ALTER TABLE public.strength_entries
  ADD CONSTRAINT strength_entries_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.workout_sessions (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS strength_entries_session_idx
  ON public.strength_entries (session_id);
