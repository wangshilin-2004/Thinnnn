'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { createInviteCodeAction, voidInviteCodeAction } from './actions';
import { INVITE_INITIAL } from './state';

/* 邀请码卡片（只有管理员会看到 —— page.tsx 里先判 isInviteOwner）。
 *
 * 三件事做在一个卡片里：生成、展示刚生成的码、管理已经发出去的码。
 *
 * 为什么「刚生成的码」要单独大号显示，而列表里还有一个：
 *   生成码的下一刻是「复制给人发过去」，这是这张卡唯一的高频动作。
 *   如果只在列表里滚到底部去找，用户得先认出哪一行是新的 —— 平白多一步。
 *   所以生成的码直接顶在表单下面，等宽字体、大号、可点复制。
 */

/* 类型从服务端模块拿，但必须用 `import type` ——
 * '@/lib/invite-admin' 带 'server-only'，普通 import 会把这一整条依赖
 * 拉进客户端 bundle，构建直接报错。`import type` 在编译期就被擦掉，安全。 */
import type { InviteCodeView } from '@/lib/invite-admin';

const STATUS_TEXT: Record<InviteCodeView['status'], string> = {
  active: '可用',
  exhausted: '已用尽',
  expired: '已过期',
};

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  /* useFormStatus 必须在 <form> 的子组件里才拿得到状态。 */
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target w-full rounded-md bg-brand px-space-5 py-space-3 text-subhead font-semibold text-on-accent transition-opacity disabled:opacity-50 sm:w-auto"
    >
      {pending ? busy : idle}
    </button>
  );
}

function VoidButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target rounded-sm px-space-2 text-footnote text-ink-3 transition-colors hover:text-accent-red disabled:opacity-50"
    >
      {pending ? '处理中…' : '作废'}
    </button>
  );
}

/* 日期只取 ISO 的前 10 位，不用 toLocaleDateString。
 * 原因很具体：这个组件是客户端组件，但首屏 HTML 也是服务端渲染出来的，
 * 两边各跑一次 toLocaleDateString 会在时区/语言不一致时给出不同字符串，
 * 触发 hydration mismatch 警告。字符串切片的输出永远一样。 */
function shortDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

export function InviteCodes({ codes }: { codes: InviteCodeView[] }) {
  const [createState, createAction] = useActionState(createInviteCodeAction, INVITE_INITIAL);
  const [voidState, voidAction] = useActionState(voidInviteCodeAction, INVITE_INITIAL);
  const [copied, setCopied] = useState(false);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板可能不可用（非 https、或浏览器拒绝授权）。
       * 这里不报错 —— 码本身就在页面上，用户可以手动选中复制，
       * 弹一个「复制失败」的提示只会让他更困惑。 */
    }
  }

  return (
    <section className="flex flex-col gap-space-4 rounded-xl border border-hairline bg-card p-space-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-headline font-semibold text-ink">邀请码</h2>
        <p className="prose-measure text-footnote text-ink-3">
          现在注册需要一个码。生成一个发给朋友，他用「邮件链接」第一次登录时填进去就行。
          码用完即废，也可以随时在这里作废 ——{' '}
          <strong className="font-semibold text-ink-2">
            它同时就是注册凭据，只发给你认识的人。
          </strong>
        </p>
      </div>

      <form action={createAction} className="flex flex-col gap-space-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-space-1">
          <label htmlFor="invite-note" className="text-subhead text-ink-2">
            备注（给谁用）
          </label>
          <input
            id="invite-note"
            name="note"
            type="text"
            maxLength={40}
            placeholder="比如：小李"
            className="rounded-md border border-separator bg-sunken px-space-4 py-space-3 text-body text-ink placeholder:text-ink-4"
          />
        </div>
        <div className="flex flex-col gap-space-1">
          <label htmlFor="invite-max-uses" className="text-subhead text-ink-2">
            可用次数
          </label>
          <input
            id="invite-max-uses"
            name="maxUses"
            type="number"
            min={1}
            max={50}
            defaultValue={1}
            className="w-full rounded-md border border-separator bg-sunken px-space-4 py-space-3 text-body text-ink sm:w-24"
          />
        </div>
        <div className="flex flex-col gap-space-1">
          <label htmlFor="invite-days" className="text-subhead text-ink-2">
            有效天数
          </label>
          <input
            id="invite-days"
            name="days"
            type="number"
            min={1}
            max={3650}
            defaultValue={30}
            className="w-full rounded-md border border-separator bg-sunken px-space-4 py-space-3 text-body text-ink sm:w-24"
          />
        </div>
        <SubmitButton idle="生成新码" busy="生成中…" />
      </form>

      {createState.createdCode && (
        <div className="flex flex-wrap items-center gap-space-3 rounded-lg border border-brand/30 bg-brand/10 p-space-4">
          <code className="text-title-3 font-semibold tracking-widest text-brand-text">
            {createState.createdCode}
          </code>
          <button
            type="button"
            onClick={() => copy(createState.createdCode ?? '')}
            className="touch-target rounded-md border border-separator bg-sunken px-space-4 text-footnote font-semibold text-ink transition-colors hover:bg-raised"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}

      {createState.status === 'error' && (
        <p role="alert" className="text-footnote text-accent-red">
          {createState.message}
        </p>
      )}
      {voidState.status === 'ok' && (
        <p role="status" className="text-footnote text-ink-2">
          {voidState.message}
        </p>
      )}
      {voidState.status === 'error' && (
        <p role="alert" className="text-footnote text-accent-red">
          {voidState.message}
        </p>
      )}

      <div className="flex flex-col gap-space-2">
        <h3 className="text-subhead font-semibold text-ink-2">已经发出去的码</h3>
        {codes.length === 0 ? (
          <p className="text-footnote text-ink-3">还没有发过码。上面生成第一个。</p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline">
            {codes.map((row) => (
              <li key={row.code} className="flex items-center gap-space-3 py-space-2">
                {/* 备注和有效期放在第二行而不是 hidden sm:inline ——
                    手机上也要能看出「这个码是给谁的、什么时候失效」，
                    那是这个列表唯一的信息价值。 */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-space-2">
                    <code className="text-subhead font-semibold tracking-wider text-ink">
                      {row.code}
                    </code>
                    <span
                      className={`rounded-full px-2 py-0.5 text-caption-1 ${
                        row.status === 'active'
                          ? 'bg-brand/15 text-brand-text'
                          : 'bg-sunken text-ink-3'
                      }`}
                    >
                      {STATUS_TEXT[row.status]}
                    </span>
                    <span className="tabular text-footnote text-ink-3">
                      {row.usedCount}/{row.maxUses} 次
                    </span>
                  </div>
                  <span className="truncate text-caption-1 text-ink-4">
                    {row.note ?? '没写备注'} · 有效到 {shortDate(row.expiresAt)}
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-space-2">
                  {row.status === 'active' && (
                    <form action={voidAction}>
                      <input type="hidden" name="code" value={row.code} />
                      <VoidButton />
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
