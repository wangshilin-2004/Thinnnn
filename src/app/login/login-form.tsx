'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { sendMagicLink, signInWithPassword } from './actions';
/* 初值从 ./state 拿，不能从 ./actions 拿：
 * actions.ts 是 'use server' 文件，只能导出 async 函数。 */
import { LOGIN_INITIAL } from './state';
/* INVITE_REQUIRED 是普通常量（src/lib/invite.ts 是纯模块，不含任何服务端代码），
 * 客户端可以直接读。用它来控制「要不要渲染邀请码输入框」而不是写死，
 * 是为了让「关掉注册门槛」真的只改一个布尔值 —— 见那个文件头部的说明。 */
import { INVITE_REQUIRED } from '@/lib/invite';

/* 登录表单，两条通道：
 *
 *   邮件链接 —— 新用户第一次进来走这条（不用先有密码）
 *   密码     —— 老用户日常走这条（不依赖发信）
 *
 * 两条都留着的原因写在 actions.ts 的 signInWithPassword 注释里。
 * 这里只说界面上的取舍：默认停在「邮件链接」，因为新用户没有密码，
 * 让他先看见一个要输密码的框会直接卡住。
 *
 * useActionState（React 19）把「提交 → 等结果 → 显示结果」三件事
 * 收进一个 hook，不需要自己写 useState + pending + error 三个状态。
 * 它接的是 Server Action：函数体在服务端跑，密钥永远不下发到浏览器。
 */

const TABS = [
  { id: 'link', label: '邮件链接' },
  { id: 'password', label: '密码' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  /* useFormStatus 必须放在 <form> 的**子组件**里才拿得到状态 ——
   * 写在 form 自己的组件里永远是 false，因为它读的是父级 form 的 context。 */
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target w-full rounded-md bg-brand px-space-5 py-space-3 text-headline font-semibold text-on-accent transition-opacity disabled:opacity-50"
    >
      {pending ? busy : idle}
    </button>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete,
  inputMode,
  placeholder,
}: {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  inputMode?: 'email' | 'text';
  placeholder: string;
}) {
  return (
    <>
      <label htmlFor={id} className="text-subhead text-ink-2">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        required
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        /* text-body 是 17px > 16px —— iOS Safari 聚焦时不会放大整页。
         * 这是 globals.css 里那条 font-size 硬修复之外的第二道保险。 */
        className="rounded-md border border-separator bg-sunken px-space-4 py-space-3 text-body text-ink placeholder:text-ink-4"
      />
    </>
  );
}

export function LoginForm() {
  /* 两个 hook 都必须无条件调用（Hooks 规则），即使当前只渲染一个。
   * 分开是为了让「发链接」和「登密码」的错误互不干扰 ——
   * 共用一个 state 的话，在密码页输错之后再切回邮件页会看到残留的红字。 */
  const [linkState, linkAction] = useActionState(sendMagicLink, LOGIN_INITIAL);
  const [pwState, pwAction] = useActionState(signInWithPassword, LOGIN_INITIAL);
  const [tab, setTab] = useState<TabId>('link');

  const state = tab === 'link' ? linkState : pwState;

  /* 发信成功后把表单收起来。
   * 原因：留着表单会诱惑用户反复点 —— 而 Supabase 免费档对发信有频率限制，
   * 点太多次直接被限流，体验反而更差。 */
  if (tab === 'link' && linkState.status === 'sent') {
    return (
      <div className="flex flex-col gap-space-4">
        <div role="status" className="rounded-lg border border-hairline bg-card p-space-5">
          <p className="text-body text-ink">📬 {linkState.message}</p>
          <p className="mt-space-3 text-footnote text-ink-3">
            没收到？先看垃圾邮件箱。链接只能用一次，重复点同一条会提示已失效。
          </p>
        </div>

        {/* 收不到信时的出路。Supabase 自带发信有每小时几封的硬限制，
            而且收信方可能根本不存在（noreply 地址）—— 那种情况下
            上面这个「已发送」的提示会把用户困在原地。 */}
        <button
          type="button"
          onClick={() => setTab('password')}
          className="touch-target self-start text-footnote text-accent-blue transition-opacity hover:opacity-70"
        >
          一直没收到？改用密码登录 →
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-space-5">
      {/* 用 tab 而不是「两个并排的表单」，是因为两个表单同时在场时
          用户会不知道该填哪个，而它们的邮箱字段其实可以共用。 */}
      <div role="tablist" aria-label="登录方式" className="flex gap-1 rounded-md bg-sunken p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`touch-target flex-1 rounded-sm px-space-3 text-subhead transition-colors ${
              tab === t.id ? 'bg-raised text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'link' ? (
        <form action={linkAction} className="flex flex-col gap-space-3">
          <Field
            id="email"
            label="邮箱"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
          />

          {/* 邀请码输入框**不给 required**。
           * 只有「这个邮箱还没注册过」才需要它，老用户登录必须能留空 ——
           * 标成必填会让每一个老用户每天多卡一道。
           * 服务端那边的判断写在 actions.ts 的 sendMagicLink 里。 */}
          {INVITE_REQUIRED && (
            <div className="flex flex-col gap-space-1">
              <label htmlFor="inviteCode" className="text-subhead text-ink-2">
                邀请码
              </label>
              <input
                id="inviteCode"
                name="inviteCode"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="XXXX-XXXX"
                /* text-body 是 17px > 16px，和上面两个输入框同样的理由：
                 * 避免 iOS Safari 聚焦时把页面放大。 */
                className="rounded-md border border-separator bg-sunken px-space-4 py-space-3 text-body tracking-widest text-ink uppercase placeholder:tracking-normal placeholder:text-ink-4"
              />
              <p className="text-footnote text-ink-3">
                第一次用才需要（找发码的人要）。已经有账号就留空。
              </p>
            </div>
          )}

          <SubmitButton idle="发登录链接" busy="发送中…" />
        </form>
      ) : (
        <form action={pwAction} className="flex flex-col gap-space-3">
          <Field
            id="email"
            label="邮箱"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
          />
          <Field
            id="password"
            label="密码"
            type="password"
            autoComplete="current-password"
            placeholder="至少 6 位"
          />
          <SubmitButton idle="登录" busy="登录中…" />
          <p className="text-footnote text-ink-3">
            第一次用？先用「邮件链接」登一次，然后在设置里设一个密码。
          </p>
        </form>
      )}

      {state.status === 'error' && (
        <p role="alert" className="text-footnote text-accent-red">
          {state.message}
        </p>
      )}
    </div>
  );
}
