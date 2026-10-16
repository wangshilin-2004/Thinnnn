'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { signOut } from '@/app/login/actions';

import { updateEmail, updatePassword } from './actions';
/* 初值从 ./state 拿，不能从 ./actions 拿 ——
 * actions.ts 是 'use server' 文件，只能导出 async 函数。 */
import { SETTINGS_INITIAL } from './state';

/* 设置页的两张表单 + 退出登录。
 *
 * 三个都做成独立的小组件而不是一个大表单：
 * 改密码和改邮箱是两件互不相干的事，合成一个表单会出现
 * 「只想改密码却被告知邮箱格式不对」这种莫名其妙的耦合。 */

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  /* useFormStatus 必须在 <form> 的子组件里才拿得到状态 ——
   * 写在 form 自己的组件里永远是 false，它读的是父级 form 的 context。 */
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target self-start rounded-md bg-brand px-space-5 py-space-3 text-subhead font-semibold text-on-accent transition-opacity disabled:opacity-50"
    >
      {pending ? busy : idle}
    </button>
  );
}

function Result({ state }: { state: { status: string; message: string } }) {
  if (state.status === 'idle') return null;

  /* role 分开是有意的：
   *   ok    → role="status"（读屏器温和播报，不打断）
   *   error → role="alert"（立刻打断，因为用户必须知道没成功）
   * 两个都用 alert 的话，成功提示也会变成「警报」，久了用户就不看了。 */
  return state.status === 'ok' ? (
    <p role="status" className="text-footnote text-accent-blue">
      {state.message}
    </p>
  ) : (
    <p role="alert" className="text-footnote text-accent-red">
      {state.message}
    </p>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-space-3 rounded-xl border border-hairline bg-card p-space-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-headline font-semibold text-ink">{title}</h2>
        {hint && <p className="prose-measure text-footnote text-ink-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete,
  placeholder,
}: {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-subhead text-ink-2">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        required
        autoComplete={autoComplete}
        placeholder={placeholder}
        /* text-body 是 17px > 16px —— iOS Safari 聚焦时不会放大整页。 */
        className="rounded-md border border-separator bg-sunken px-space-4 py-space-3 text-body text-ink placeholder:text-ink-4"
      />
    </div>
  );
}

export function PasswordForm() {
  const [state, formAction] = useActionState(updatePassword, SETTINGS_INITIAL);

  return (
    <Card title="改密码" hint="设好之后，登录就不用等邮件了。至少 6 位。">
      <form action={formAction} className="flex flex-col gap-space-3">
        <Field
          id="password"
          label="新密码"
          type="password"
          autoComplete="new-password"
          placeholder="至少 6 位"
        />
        <Field
          id="confirm"
          label="再输一遍"
          type="password"
          autoComplete="new-password"
          placeholder="两次要一样"
        />
        <SubmitButton idle="保存新密码" busy="保存中…" />
        <Result state={state} />
      </form>
    </Card>
  );
}

export function EmailForm({ current }: { current: string }) {
  const [state, formAction] = useActionState(updateEmail, SETTINGS_INITIAL);

  return (
    <Card
      title="改邮箱"
      hint="换一个能收到信的地址。提交后要去新邮箱点一下确认链接才生效。"
    >
      <p className="text-footnote text-ink-3">
        当前：<span className="text-ink-2">{current}</span>
      </p>
      <form action={formAction} className="flex flex-col gap-space-3">
        <Field
          id="email"
          label="新邮箱"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <SubmitButton idle="发送确认信" busy="发送中…" />
        <Result state={state} />
      </form>
    </Card>
  );
}

export function SignOutButton() {
  return (
    /* 不是 <form action={signOut}> 而是按钮 —— 因为它不需要任何输入。
     * signOut 会 revalidatePath 再 redirect('/login')，两边都是服务端行为。 */
    <form action={signOut}>
      <button
        type="submit"
        className="touch-target rounded-md border border-separator px-space-5 py-space-3 text-subhead font-medium text-ink-2 transition-colors hover:text-ink"
      >
        退出登录
      </button>
    </form>
  );
}
