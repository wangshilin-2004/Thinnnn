-- ═══════════════════════════════════════════════════════════════════════
--  0008 · 邀请码：把「谁能注册」从「知道网址的人」收成「拿到码的人」
--
--  背景
--    登录走魔法链接，`shouldCreateUser: true` 的含义是：任何一个知道域名
--    的人，填自己的邮箱就能把账号建出来。项目规模是「我 + 1-2 个朋友」，
--    需要一道门槛。门槛设在「第一次注册」这一步，不设在这一步之后的登录。
--
--  为什么判定不放在应用层
--    invite_codes 是 RLS 开启 + 一条策略都不建 + 一个 GRANT 都不给的
--    「三不沾」表（见 src/db/schema.ts 第 8 节）—— anon 和 authenticated
--    都读不到它。这是对的：邀请码列表不该被普通用户看见。
--    但登录页要校验码，而登录页恰恰是未登录状态（anon 角色）。
--
--  解法：SECURITY DEFINER 函数
--    函数体以创建者（postgres，超级用户，绕过 RLS）的身份执行，因此能读
--    invite_codes；调用方只需要 EXECUTE 权限，拿不到表权限。
--    于是安全边界从「能不能读这张表」变成「能不能调用这两个函数」——
--    而它们只回一个 boolean，不泄漏码的存在性、用量、备注。
--
--  为什么拆成「查」和「扣」两步
--    登录流程是：查码 → 发信 → 扣码。
--    发信是会失败的（Supabase 免费档对同一个邮箱有硬性频率限制，线上
--    实测撞过 429 over_email_send_rate_limit）。如果先扣再发，一次失败
--    就白烧一个码；max_uses = 1 的码被这样烧掉，朋友当场就进不来。
--    所以只在「信真的发出去了」之后才扣。
--
--  search_path 为什么必须钉死
--    SECURITY DEFINER 函数里若不定死 search_path，调用方可以临时建一个
--    同名的表或函数来劫持函数体里的名字解析，从而以超级用户身份执行
--    自己的代码 —— 这是 SECURITY DEFINER 最经典的提权手法。所以这里
--    同时做两件事：钉死 `search_path`，并且所有对象引用都写全 schema 前缀。
-- ═══════════════════════════════════════════════════════════════════════

-- ── 查：这个码现在能不能用（不产生副作用） ────────────────────────────
-- 归一化放在函数里（upper + btrim），而不是只靠调用方：
-- 从聊天窗口复制过来的码常带前后空格，也可能被输入法转成小写。
-- 归一化只在数据库这一层做一次，前后端就不会各写一套然后漂移。
create or replace function public.invite_code_is_valid(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.invite_codes c
     where c.code = upper(btrim(p_code))
       and c.used_count < c.max_uses
       and (c.expires_at is null or c.expires_at > now())
  );
$$;

comment on function public.invite_code_is_valid(text) is
  '邀请码当前是否可用（未过期且未用尽）。只读，不扣减。供未登录的登录页调用。';

-- ── 扣：用掉一次（原子） ──────────────────────────────────────────────
-- 原子性靠 UPDATE 的 WHERE 子句，而不是「先 SELECT 再 UPDATE」：
-- 并发下两个事务同时改同一行，第二个会在行锁释放后重新检查 WHERE，
-- 因此 used_count 永远不会超过 max_uses。先查后改做不到这一点。
-- RETURNING true ... INTO 在「没有行被更新」时给 null，coalesce 成 false。
create or replace function public.consume_invite_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_consumed boolean;
begin
  update public.invite_codes c
     set used_count = c.used_count + 1
   where c.code = upper(btrim(p_code))
     and c.used_count < c.max_uses
     and (c.expires_at is null or c.expires_at > now())
  returning true into v_consumed;

  return coalesce(v_consumed, false);
end;
$$;

comment on function public.consume_invite_code(text) is
  '用掉一次邀请码。原子自增 used_count，用尽/过期/不存在都返回 false。';

-- ── 权限：只给 EXECUTE，一个表权限都不给 ──────────────────────────────
-- Postgres 给函数的默认权限是「PUBLIC 可执行」，所以必须先 revoke。
-- 之后只把这两个函数授予 anon（未登录）与 authenticated（已登录）——
-- 已登录用户其实用不到，但 Supabase 里登录态请求的角色就是 authenticated，
-- 少给一个会在「登录后误回登录页」这类场景里静默报权限错。
revoke all on function public.invite_code_is_valid(text) from public;
revoke all on function public.consume_invite_code(text)   from public;

grant execute on function public.invite_code_is_valid(text) to anon, authenticated;
grant execute on function public.consume_invite_code(text)  to anon, authenticated;
