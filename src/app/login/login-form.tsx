'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { sendMagicLink, LOGIN_INITIAL } from './actions';

/* 登录表单。
 *
 * useActionState（React 19）把「提交 → 等结果 → 显示结果」三件事
 * 收进一个 hook，不需要自己写 useState + pending + error 三个状态。
 * 它接的是 Server Action：函数体在服务端跑，密钥永远不下发到浏览器。
 */

function SubmitButton() {
  /* useFormStatus 必须放在 <form> 的**子组件**里才拿得到状态 ——
   * 写在 form 自己的组件里永远是 false，因为它读的是父级 form 的 context。 */
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target w-full rounded-md bg-brand px-space-5 py-space-3 text-headline font-semibold text-on-accent transition-opacity disabled:opacity-50"
    >
      {pending ? '发送中…' : '发登录链接'}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(sendMagicLink, LOGIN_INITIAL);

  /* 发信成功后把表单收起来。
   * 原因：留着表单会诱惑用户反复点 —— 而 Supabase 免费档对发信有频率限制，
   * 点太多次直接被限流，体验反而更差。 */
  if (state.status === 'sent') {
    return (
      <div
        role="status"
        className="rounded-lg border border-hairline bg-card p-space-5"
      >
        <p className="text-body text-ink">📬 {state.message}</p>
        <p className="mt-space-3 text-footnote text-ink-3">
          没收到？先看垃圾邮件箱。链接只能用一次，重复点同一条会提示已失效。
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-space-3">
      <label htmlFor="email" className="text-subhead text-ink-2">
        邮箱
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        /* text-body 是 17px > 16px —— iOS Safari 聚焦时不会放大整页。
         * 这是 globals.css 里那条 font-size 硬修复之外的第二道保险。 */
        className="rounded-md border border-separator bg-sunken px-space-4 py-space-3 text-body text-ink placeholder:text-ink-4"
      />

      <SubmitButton />

      {state.status === 'error' && (
        <p role="alert" className="text-footnote text-accent-red">
          {state.message}
        </p>
      )}
    </form>
  );
}
