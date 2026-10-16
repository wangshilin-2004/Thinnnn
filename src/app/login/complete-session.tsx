'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';

import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

/* 登录页上的收尾工作：接住令牌，或者把失败原因说清楚。
 *
 * ── 一、为什么要接 fragment ──────────────────────────────────
 * 我们这个项目用的是 PKCE 流程（@supabase/ssr 的默认值，见
 * node_modules/@supabase/ssr/dist/main/createServerClient.js 里的 flowType: "pkce"）。
 * 官方文档的范例就是这样：验证成功后 Supabase 回跳 /auth/callback?code=xxx，
 * 服务端拿 code 换会话。这条路上一切都在服务端，不需要这个组件。
 *
 * 但 Supabase 在某些情况下会用**隐式流程**回跳，令牌直接塞在 URL 的 fragment 里：
 *
 *   /auth/callback#access_token=xxx&refresh_token=yyy&type=magiclink
 *
 * 这不是假设 —— 用管理端 API 生成链接实测过，回跳的就是这种形式。
 * 而 fragment（# 后面那段）浏览器**不会发给服务器**，所以 route.ts 里
 * 永远看不到它，只能落到「没有 code」的分支。
 *
 * 这本来不算灾难：route.ts 会把人送回 /login?error=nocode。但按 RFC 7231，
 * 重定向会**继承**原来的 fragment，于是 fragment 一路跟到了登录页 ——
 * 反而是个机会：令牌就在登录页的地址栏里，只是没人接。
 *
 * ── 二、为什么地址栏里的 ?error= 也由这里显示 ────────────────
 * 两种流程会在同一个地址上撞车：PKCE 失败时 route.ts 加上 ?error=nocode，
 * 而隐式流程的 fragment 同时被带过来，变成 /login?error=nocode#access_token=xxx。
 * 这时令牌其实是好的。如果让服务端直接渲染 error 文案，用户会先看到
 * 「登录失败」再被跳走。所以两边一起交给客户端判断，fragment 优先。
 *
 * ── 三、为什么放在登录页而不是 /auth/callback ────────────────
 * /auth/callback 是 route.ts（Route Handler），只能返回 Response，
 * 渲染不了客户端组件。而 fragment 恰好会被重定向带到 /login，就地接手最省事。
 *
 * ── 四、为什么用 useSyncExternalStore 读 fragment ────────────
 * 第一版写成「在 useEffect 里读 hash 然后 setState」，被
 * react-hooks/set-state-in-effect 拦下了 —— 这条规则指出的问题是真的：
 * 「由 fragment 决定的文案」是**渲染期就能推导**的状态，用 effect 去同步它
 * 会多渲染一轮，而且首帧会闪。
 *
 * useSyncExternalStore 正好是这个场景的标准解法：
 *   - 服务端快照给空串 → 不会有 hydration mismatch（服务端渲染成"什么都没有"）
 *   - 客户端快照读 window.location.hash → 渲染期就能拿到，不需要 effect
 * 于是 effect 里只剩下真正异步的那件事：拿令牌换会话。
 *
 * ── 五、安全性 ────────────────────────────────────────────────
 * 令牌出现在 URL 里确实比 PKCE 差（会进浏览器历史、可能被 Referer 带走）。
 * 所以接到之后立刻 setSession 并清掉 fragment，缩短暴露窗口。
 * 真要彻底消除，得让 Supabase 只走 PKCE —— 那取决于服务端配置，
 * 不在我们代码的控制范围内，所以这里选择「两种都能跑」而不是「赌一种」。
 */

/** route.ts 回跳时带的错误码 → 给人看的话。
 *
 * 每一条都要能回答「那我现在该干什么」。登录失败最怕的是界面没反应：
 * 用户只会反复点「发登录链接」，然后撞上 Supabase 的发信频率限制，
 * 从此连重试都做不了。 */
const ERROR_TEXT: Record<string, string> = {
  nocode: '登录链接没带上验证信息。可能链接被邮箱截断了一部分 —— 试试整条复制粘贴，或者重新发一个。',
  exchange: '链接验证过了，但换取登录状态时失败。通常是这条链接已经用过一次了 —— 重新发一个吧。',
  link: '这个登录链接已经失效。链接只能用一次、15 分钟内有效，重新发一个吧。',
  not_configured: '服务端还没配好 Supabase，暂时登录不了。',
};

const EXPIRED_TEXT = '这个登录链接已经失效了（只能用一次、15 分钟内有效）。重新发一个吧。';
const REJECTED_TEXT = '登录链接没能验证通过。重新发一个吧。';

/* ── URL fragment 的读取 ──────────────────────────────────────
 * 三个函数都放在模块作用域：useSyncExternalStore 要求 subscribe 和
 * getSnapshot 的引用稳定，写成内联箭头函数每次渲染都是新引用，
 * 会导致 React 反复重新订阅。 */

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function getHashSnapshot() {
  return window.location.hash;
}

/** 服务端没有 location，返回空串 —— 服务端渲染成「什么都没有」，
 * 客户端首次渲染（hydration）也拿它对齐，不会 mismatch。 */
function getHashServerSnapshot() {
  return '';
}

/** 从 hash 解析出 Supabase 放的参数。
 *
 * 自己 parse 而不用 URLSearchParams(location.hash) 的坑：
 * hash 以 '#' 开头，URLSearchParams 会把第一个键名带上 '#'（'#access_token'）。 */
function parseFragment(hash: string): URLSearchParams | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  return new URLSearchParams(raw);
}

/** 清掉地址栏里的 fragment，但不触发跳转。
 *
 * history.replaceState 而不是改 location.hash：后者会再压一条历史记录，
 * 用户按返回键会掉回带令牌的那一页。 */
function clearFragment() {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

export function CompleteSession({ error }: { error?: string }) {
  const router = useRouter();
  const hash = useSyncExternalStore(subscribeHash, getHashSnapshot, getHashServerSnapshot);

  /* 只由异步回调写入 —— 渲染期不 setState，effect 里也不同步 setState。 */
  const [failure, setFailure] = useState<string | null>(null);

  const frag = parseFragment(hash);
  const accessToken = frag?.get('access_token') ?? null;
  const refreshToken = frag?.get('refresh_token') ?? null;
  const hasTokens = Boolean(accessToken && refreshToken);

  /* 有令牌但没有失败 → 正在换会话。这是**推导**出来的，不是 setState 设的，
   * 所以首帧就能显示「正在完成登录」，不会先闪一下登录表单。 */
  const exchanging = hasTokens && failure === null;

  useEffect(() => {
    if (!accessToken || !refreshToken) return;

    let cancelled = false;

    void (async () => {
      const supabase = createSupabaseBrowserClient();
      /* setSession 会把会话写进 cookie —— @supabase/ssr 的浏览器客户端
       * 用的就是 document.cookie，所以服务端下一次请求就能读到，
       * 这跟 PKCE 走完之后的最终状态是一样的。 */
      const { error: setError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      /* 组件卸载后不要再动状态，否则 React 会警告，
       * 而且用户可能已经点走了，跳转会把人从新页面拽回来。 */
      if (cancelled) return;

      if (setError) {
        clearFragment();
        setFailure(REJECTED_TEXT);
        return;
      }

      clearFragment();
      /* replace 而不是 push：登录成功后再按返回键不该回到登录页。
       * refresh 是必须的 —— 否则 App Router 可能继续用服务端渲染的旧结果，
       * 而我们刚写进去的 cookie 对那份结果不可见。 */
      router.replace('/dashboard');
      router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshToken, router]);

  /* ── 渲染：按优先级挑一句话 ──────────────────────────────────
   * 顺序不能换：
   *  1. 正在换会话（令牌是好的，别的都别管）
   *  2. 换会话失败了
   *  3. fragment 里带着 Supabase 的失败原因（链接过期等）
   *  4. route.ts 传来的 ?error=（PKCE 那条路失败）
   *  5. 什么都没有 → 不渲染任何东西 */
  let message: string | null = null;
  let tone: 'working' | 'error' = 'error';

  if (exchanging) {
    message = '正在完成登录…';
    tone = 'working';
  } else if (failure) {
    message = failure;
  } else if (frag) {
    const fragError = frag.get('error_code') ?? frag.get('error');
    if (fragError) message = fragError === 'otp_expired' ? EXPIRED_TEXT : REJECTED_TEXT;
  }

  if (message === null && error) message = ERROR_TEXT[error] ?? ERROR_TEXT.nocode;

  if (message === null) return null;

  if (tone === 'working') {
    return (
      <p role="status" className="mt-space-4 text-footnote text-ink-3" data-testid="completing-session">
        {message}
      </p>
    );
  }

  return (
    <p role="alert" className="mt-space-4 text-footnote text-accent-red">
      {message}
    </p>
  );
}
