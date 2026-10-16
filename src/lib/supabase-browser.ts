'use client';

import { createBrowserClient } from '@supabase/ssr';

/* Supabase 浏览器端客户端。
 *
 * 和 src/lib/supabase.ts 分开两个文件，是因为那边顶上有 `import 'server-only'` ——
 * 那是防止服务端密钥被打进客户端包的一道闸。客户端的 anon key 本来就是公开的，
 * 两边的约束条件完全不同，混在一个文件里迟早会有人把 SERVICE_ROLE_KEY 读进来。
 *
 * 什么时候会用到浏览器端客户端：见 src/app/login/complete-session.tsx。
 * 正常登录（PKCE）全程在服务端完成，根本不需要它；只有当 Supabase 用
 * 「隐式流程」把我们踢回来时，令牌才只存在于 URL fragment 里 —— 而 fragment
 * 永远不会发给服务器，只能在浏览器里接。 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
