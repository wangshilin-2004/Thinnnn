import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/* Supabase 服务端客户端（App Router 版）。
 *
 * 用 @supabase/ssr 而不是 supabase-js 裸用：App Router 里 Cookie 的读写
 * 必须走 Next 的 cookies()，否则刷新令牌无法回写，用户登录后一刷新就掉线。
 */

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* Server Component 里 Cookie 是只读的，set 会抛错。
             * 这不是 bug：刷新令牌由 middleware 负责写回，
             * 这里吞掉异常即可，否则每次渲染都会崩。 */
          }
        },
      },
    },
  );
}
