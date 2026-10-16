import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: '登录' };

/* 登录页。
 *
 * 这里**故意不用 (app) 路由组** —— 那个组带底部标签栏，
 * 而登录页不该出现「记一餐」「趋势」这些还没权限看的入口。
 *
 * 已经登录的人直接送去控制台：用户点了个旧书签、或者从邮箱回来时
 * 浏览器还开着登录页，都会走到这里。 */
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  return (
    <main className="screen-min flex flex-col justify-center px-space-5">
      <div className="content-max mx-auto w-full max-w-[400px]">
        <Link
          href="/"
          className="touch-target -my-space-2 mb-space-6 inline-flex items-center text-subhead text-ink-3 no-underline"
        >
          ← 轻记
        </Link>

        <h1 className="text-title-1 font-semibold text-ink">登录</h1>
        <p className="prose-measure mt-space-3 text-body text-ink-2">
          输入邮箱，我给你发一个登录链接。
          <br />
          <span className="text-ink-3">不用记密码 —— 点一下链接就进来了。</span>
        </p>

        <div className="mt-space-8">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
