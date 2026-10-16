#!/usr/bin/env node
// 监听浏览器 console / 未捕获异常 / 网络失败，用于验证「客户端状态机」类改动。
//
// 为什么需要它：
//   `curl` 拿不到客户端渲染结果，`eval` 只能看到**最终**状态 —— 而
//   React 的 hydration mismatch、key 警告、无害但会掩盖真问题的 deprecation
//   都只出现在 console 里，页面上看不出来。
//   本项目真踩过：错误页主题 bug 是「内联脚本在 __next_error__ 文档里不执行」，
//   页面渲染成了浅色，但没有任何报错 —— 只有把 console 和最终 DOM 一起看才定位得到。
//
// 用法：
//   node scripts/devtools/console.mjs <路径> [等待毫秒]
//   PORT=3000 node scripts/devtools/console.mjs '/login#access_token=bogus'

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = `http://localhost:${process.env.PORT || 3100}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [, , path = '/', waitMs = '2500'] = process.argv;
const url = path.startsWith('/') ? BASE + path : path;

const profile = mkdtempSync(join(tmpdir(), 'cdp-console-'));
const proc = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--disable-extensions',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const events = [];

function fmt(level, text) {
  // 只留真正代表问题的行；Next dev 的常规噪音（HMR 连接、Fast Refresh）滤掉
  if (!text) return null;
  if (/\[Fast Refresh\]|\[HMR\]|Download the React DevTools/.test(text)) return null;
  return `${level}  ${text}`;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = new Set();
    let id = 0;
    ws.addEventListener('open', () => resolve({
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      send(method, params = {}) {
        const mid = ++id;
        return new Promise((res, rej) => {
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { ws.close(); },
    }));
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
      } else if (msg.method) {
        for (const fn of listeners) fn(msg);
      }
    });
  });
}

let code = 0;
try {
  let wsUrl = null;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch { /* 还没起来 */ }
  }
  if (!wsUrl) throw new Error('Chrome 调试端口没起来');

  const cdp = await connect(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1400, deviceScaleFactor: 1, mobile: true });

  cdp.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      const line = fmt(m.params.type, text);
      if (line) events.push(line);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      events.push(`未捕获异常  ${d.text} ${d.exception?.description ?? ''}`.slice(0, 400));
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.level === 'warning') {
        const line = fmt(e.level, `${e.text} ${e.url ?? ''}`.trim());
        if (line) events.push(line);
      }
    } else if (m.method === 'Network.loadingFailed') {
      events.push(`请求失败  ${m.params.errorText} ${m.params.type}`);
    }
  });

  // 必须先导航 —— 少了这行，下面量到的是 about:blank（第一次就漏了，
  // 结果两行「console 干净」其实什么都没测）
  await cdp.send('Page.navigate', { url });
  await new Promise((res) => {
    const off = cdp.on((m) => { if (m.method === 'Page.loadEventFired') { off(); res(); } });
    setTimeout(res, 20000);
  });
  await sleep(Number(waitMs));

  const final = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      href: location.pathname + location.search + location.hash,
      alert: (document.querySelector('[role=alert]') || {}).textContent || null,
      working: (document.querySelector('[data-testid=completing-session]') || {}).textContent || null,
      htmlClass: document.documentElement.className,
      title: document.title,
    })`,
    returnByValue: true,
  });

  console.log(`地址  ${url}`);
  console.log(`最终  ${final.result.value}`);
  console.log(events.length ? `\nconsole / 网络问题 ${events.length} 条：` : '\nconsole 干净 ✅（无 error / warning / 异常 / 失败请求）');
  for (const e of events) console.log('  ' + e);
  if (events.length) code = 1;
  cdp.close();
} catch (e) {
  console.error('失败：' + e.message);
  code = 1;
} finally {
  proc.kill();
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(code);
