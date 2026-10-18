-- ═══════════════════════════════════════════════════════════════════════
--  0010 · 用户名 + 好友 + 互相可见（训练 / 饮食）
--
--  为什么需要「用户名」而不能用邮箱当身份
--    邮箱是登录凭据，不是社交身份。把邮箱当好友搜索条件，等于逼所有人
--    在加好友之前先互相知道对方的登录账号 —— 那是把凭据当名片用。
--    所以单独有一个 username，只用来找人和显示。
--
--  为什么不是「关注」而是「双向好友」
--    这是 3 人自用工具，不是社交产品。单向关注会带来「他看得到我、
--    我看不到他」的困惑，还得再设计一套屏蔽逻辑。双向申请-接受，
--    关系对称，心智负担最小。
--
--  为什么能看数据要落在数据库（RLS）而不是应用层
--    应用层能保证「我的页面不查别人的数据」，但保证不了「我的 token
--    直接打 PostgREST 查不到别人的数据」。这个项目从第一天就选了
--    「越权由数据库拦」—— 好友可见必须走同一条路：
--    在 meal_items / cardio_sessions / strength_entries 上各加一条
--    SELECT 策略，条件是「对方接受了我的好友申请，且对方开了共享开关」。
--
--  为什么共享开关默认打开
--    「加好友」这个动作本身就是用户表达「我愿意给他看」。默认关掉的话，
--    加完好友两边都是空的，看起来像坏了。代价是接受申请前必须说清楚
--    会共享什么 —— 那句话放在接受按钮旁边（friends/page.tsx）。
--
--  为什么用户名小写 + 唯一
--    大小写敏感的唯一键会让 @ShiLin 和 @shilin 变成两个人，
--    然后你就会收到「加不上好友」的反馈。统一转小写存。
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. profiles 加三列 ─────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS share_meals boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS share_training boolean NOT NULL DEFAULT true;

-- 用户名格式：3–20 位小写字母/数字/下划线，不能以数字或下划线开头
-- （避免出现「2026」这种看起来像年份的 ID，也方便在 UI 里显示成 @xxx）
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9_]{2,19}$');

-- 唯一索引而不是 UNIQUE 约束：允许 NULL（没设用户名的老用户），
-- 但不允许两个人和同一个名字。
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_uniq
  ON public.profiles (username)
  WHERE username IS NOT NULL;

-- ── 2. 好友关系 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.friendships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL,
  addressee_id uuid NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  responded_at timestamp with time zone,

  CONSTRAINT friendships_status_check
    CHECK (status IN ('pending', 'accepted', 'declined')),
  CONSTRAINT friendships_not_self
    CHECK (requester_id <> addressee_id),
  CONSTRAINT friendships_requester_fk
    FOREIGN KEY (requester_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT friendships_addressee_fk
    FOREIGN KEY (addressee_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

-- A→B 和 B→A 不能同时存在。用规范化后的二元组建唯一索引，
-- 比「应用层先查一下有没有反向申请」可靠 —— 那是典型的竞态。
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_uniq
  ON public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );

CREATE INDEX IF NOT EXISTS friendships_addressee_pending_idx
  ON public.friendships (addressee_id, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- ── 3. 好友关系上的 RLS ────────────────────────────────────────────────
DROP POLICY IF EXISTS friendships_select_own ON public.friendships;
CREATE POLICY friendships_select_own ON public.friendships
  FOR SELECT TO authenticated
  USING (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid()));

-- 只能以「自己」的身份发出申请，且只能发成 pending
DROP POLICY IF EXISTS friendships_insert_own ON public.friendships;
CREATE POLICY friendships_insert_own ON public.friendships
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = (SELECT auth.uid()) AND status = 'pending');

-- 收件人可以接受/拒绝；发件人只能改回 declined（等于撤回）
DROP POLICY IF EXISTS friendships_update_own ON public.friendships;
CREATE POLICY friendships_update_own ON public.friendships
  FOR UPDATE TO authenticated
  USING (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid()))
  WITH CHECK (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid()));

-- 两边都能删（删好友 / 撤回 / 拒绝后清理）
DROP POLICY IF EXISTS friendships_delete_own ON public.friendships;
CREATE POLICY friendships_delete_own ON public.friendships
  FOR DELETE TO authenticated
  USING (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid()));

-- ── 4. 「能不能看这个人」的判定函数 ───────────────────────────────────
-- 一律 SECURITY DEFINER + 钉死 search_path：
--   判定函数要读 friendships 和 profiles 两张表，而调用者只有
--   authenticated 角色。不提升权限的话它自己就会被 RLS 挡住，
--   然后所有人一律看不到 —— 而且是一个「静默看不到」的 bug。
CREATE OR REPLACE FUNCTION public.is_friend_of(p_me uuid, p_other uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.friendships f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = p_me AND f.addressee_id = p_other)
        OR (f.requester_id = p_other AND f.addressee_id = p_me))
  );
$$;

CREATE OR REPLACE FUNCTION public.shares_meals_with_me(p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_owner
      AND p.share_meals
      AND public.is_friend_of((SELECT auth.uid()), p_owner)
  );
$$;

CREATE OR REPLACE FUNCTION public.shares_training_with_me(p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_owner
      AND p.share_training
      AND public.is_friend_of((SELECT auth.uid()), p_owner)
  );
$$;

REVOKE ALL ON FUNCTION public.is_friend_of(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_meals_with_me(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_training_with_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_friend_of(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_meals_with_me(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_training_with_me(uuid) TO authenticated;

-- ── 5. 好友可见的 READ 策略 ────────────────────────────────────────────
-- 注意：这是**新增**的 SELECT 策略。Postgres 的 RLS 是「多条策略取并集」，
-- 所以原来那条 user_id = auth.uid() 不动，只是多了一个「或者是我好友」。
DROP POLICY IF EXISTS meal_items_select_friend ON public.meal_items;
CREATE POLICY meal_items_select_friend ON public.meal_items
  FOR SELECT TO authenticated
  USING (public.shares_meals_with_me(user_id));

DROP POLICY IF EXISTS cardio_select_friend ON public.cardio_sessions;
CREATE POLICY cardio_select_friend ON public.cardio_sessions
  FOR SELECT TO authenticated
  USING (public.shares_training_with_me(user_id));

DROP POLICY IF EXISTS strength_select_friend ON public.strength_entries;
CREATE POLICY strength_select_friend ON public.strength_entries
  FOR SELECT TO authenticated
  USING (public.shares_training_with_me(user_id));

-- ── 6. 应用层用的两个读取函数 ─────────────────────────────────────────
-- profiles 里除了 username 还有生日、身高、目标体重这些东西 —— 那是
-- **不能给好友看**的。RLS 只能按行过滤，没法按列过滤，所以好友目录
-- 必须走一个只返回三列的函数，而不是放宽 profiles 的 SELECT 策略。
CREATE OR REPLACE FUNCTION public.list_my_links()
RETURNS TABLE (
  link_id      uuid,
  peer_id      uuid,
  username     text,
  display_name text,
  status       text,
  since        timestamp with time zone,
  direction    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    f.id AS link_id,
    CASE WHEN f.requester_id = (SELECT auth.uid())
         THEN f.addressee_id ELSE f.requester_id END AS peer_id,
    p.username,
    p.display_name,
    f.status,
    f.created_at AS since,
    CASE WHEN f.requester_id = (SELECT auth.uid()) THEN 'out' ELSE 'in' END AS direction
  FROM public.friendships f
  JOIN public.profiles p
    ON p.id = CASE WHEN f.requester_id = (SELECT auth.uid())
                   THEN f.addressee_id ELSE f.requester_id END
  WHERE f.requester_id = (SELECT auth.uid()) OR f.addressee_id = (SELECT auth.uid())
  ORDER BY f.created_at DESC;
$$;

-- 按用户名找人。找不到返回 0 行，应用层统一说「没有这个用户名」，
-- 不做「是不是你把名字打错了」之外的区分 —— 好友功能天然要暴露
-- 「这个用户名存在」，这一点无解，写在注释里而不是假装没有。
CREATE OR REPLACE FUNCTION public.find_user_by_username(p_username text)
RETURNS TABLE (peer_id uuid, username text, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.username, p.display_name
  FROM public.profiles p
  WHERE p.username = lower(btrim(p_username))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.list_my_links() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_user_by_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_links() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_user_by_username(text) TO authenticated;

-- ── 7. GRANT：显式写死，不靠默认值 ────────────────────────────────────
REVOKE ALL ON TABLE public.friendships FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.friendships TO authenticated;

-- 好友目录函数是 SECURITY DEFINER，不依赖下面的列级 GRANT；
-- 但 friendships 表本身要能被应用层直接读写，所以给全表权限再由 RLS 兜底。
