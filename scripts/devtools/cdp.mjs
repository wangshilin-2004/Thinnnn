#!/usr/bin/env node
// 无头 Chrome 真机视口截图 / 版式诊断（走 CDP，不是 --window-size）。
//
// 为什么不用 `chrome --headless --window-size=390,... --screenshot`：
//   无头 Chrome 强制窗口最小宽度 500px，390 会被静默忽略。于是「移动端截图」
//   实际渲染的是 500px 版式，只是被裁到 390px —— 右侧文字看着像被切掉，
//   会让人误判成 CSS 横向溢出 bug（本项目真踩过这个坑，浪费了很多时间）。
//   走 CDP 的 Emulation.setDeviceMetricsOverride 才能真正改视口，
//   而且顺带能在页面里执行任意 JS，量出每个元素的真实盒模型。
//
// 用法：
//   node cdp.mjs shot <宽> <高> <缩放> <输出.png> [路径] [full]
//   node cdp.mjs diag <宽> [路径]
//   node cdp.mjs eval <宽> "<JS 表达式>" [路径]
//
// 例：
//   node cdp.mjs shot 390 1560 2 /tmp/m.png
//   node cdp.mjs diag 390
//   node cdp.mjs eval 390 "document.querySelector('h1').getBoundingClientRect().width"

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = `http://localhost:${process.env.PORT || 3100}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 起一个带远程调试端口的无头 Chrome，返回 { proc, profile, wsUrl } */
async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'cdp-prof-'));
  const proc = spawn(CHROME, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch { /* 还没起来 */ }
  }
  if (!wsUrl) { proc.kill(); rmSync(profile, { recursive: true, force: true }); throw new Error('Chrome 调试端口没起来'); }
  return { proc, profile, wsUrl };
}

/** 极简 CDP 客户端：把 id ↔ Promise 对上，其余当事件分发 */
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

/** 设视口 → 导航 → 等 load → 再等一会儿让字体/布局稳定 */
async function open(cdp, url, { width, height = 1200, dpr = 1, mobile = true }) {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dpr, mobile,
  });
  const loaded = new Promise((res) => {
    const off = cdp.on((m) => { if (m.method === 'Page.loadEventFired') { off(); res(); } });
  });
  await cdp.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(20000)]);
  await sleep(700); // 字体替换 / 图片解码
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

const OVERFLOW_EXPR = `(async () => {
  const vw = innerWidth, de = document.documentElement;
  const L = [];
  L.push('视口 innerWidth = ' + vw + 'px   dpr=' + devicePixelRatio
       + '   文档 scrollWidth = ' + de.scrollWidth + '   文档 scrollHeight = ' + de.scrollHeight);
  L.push('横向溢出：' + (de.scrollWidth > vw ? '有 ❌ 超出 ' + (de.scrollWidth - vw) + 'px' : '无 ✅'));
  const bad = [];
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 0.5 || r.left < -0.5) {
      const cls = typeof el.className === 'string' ? el.className : '';
      bad.push('  ' + el.tagName.toLowerCase() + '.' + cls.slice(0, 56)
        + '  L=' + r.left.toFixed(1) + ' R=' + r.right.toFixed(1) + ' W=' + r.width.toFixed(1));
    }
  }
  L.push('越界元素：' + bad.length + ' 个');
  L.push(...bad.slice(0, 30));
  L.push('--- 关键容器实测 ---');
  const sels = ['.content-max', '.prose-measure', '.glass', 'h1', 'p', 'svg', 'section'];
  for (const sel of sels) {
    let i = 0;
    for (const el of document.querySelectorAll(sel)) {
      if (i >= 2) break;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const cs = getComputedStyle(el);
      L.push('  ' + sel + '[' + i + '] W=' + r.width.toFixed(1) + ' L=' + r.left.toFixed(1)
        + ' R=' + r.right.toFixed(1) + ' pad=' + cs.paddingLeft + '/' + cs.paddingRight
        + ' maxW=' + cs.maxWidth + ' fs=' + cs.fontSize);
      i++;
    }
  }
  L.push('--- 触控目标（应 ≥44px）---');
  /* 用 elementFromPoint 实测，不看元素的 CSS 盒子。
   * 原因：有些按钮（列表里那个只有 17px 高的「改」）靠 after 伪元素把触控区
   * 扩到 44px，而伪元素不在 getBoundingClientRect 里 —— 只看盒子会把它报成
   * 问题。反过来，CSS 里写着 44px 也可能有东西盖在上面，同样测不出来。
   * 探针取元素中心上下各 21px（即 44px 盒子的边界内一点）。 */
  const smallEls = [];
  for (const el of document.querySelectorAll('a, button, [role=button]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height >= 44 && r.width >= 44) continue;
    smallEls.push(el);
  }
  if (!smallEls.length) {
    L.push('  全部 ≥44px ✅');
  } else {
    const savedY = scrollY;
    const bad = [];
    for (const el of smallEls) {
      /* behavior:'instant' 是必须的：globals.css 里有 scroll-behavior:smooth，
       * 默认的 scrollIntoView 会动画滚过去，立刻测量拿到的是中途位置。 */
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 350));
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = (y) => {
        const e = document.elementFromPoint(cx, y);
        return !!e && (el.contains(e) || e.contains(el));
      };
      if (!(hit(cy - 21) && hit(cy + 21))) {
        bad.push('  ❌ 够不着 ' + r.width.toFixed(0) + 'x' + r.height.toFixed(0)
          + ' 上下探针未命中 「' + (el.textContent || '').trim().slice(0, 20) + '」');
      }
    }
    scrollTo(0, savedY);
    if (bad.length) L.push(...bad);
    else L.push('  ✅ ' + smallEls.length + ' 个元素视觉上小于 44px，但触控区实测达标');
  }
  return L.join('\\n');
})()`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { proc, profile, wsUrl } = await launch();
  let code = 0;
  try {
    const cdp = await connect(wsUrl);
    const abs = (p) => (p.startsWith('/') ? BASE + p : p);

    if (cmd === 'shot') {
      const [w, h, dpr, out, path = '/', full] = rest;
      await open(cdp, abs(path), { width: +w, height: +h, dpr: +dpr });
      const opts = { format: 'png' };
      if (full === 'full') opts.captureBeyondViewport = true;
      const { data } = await cdp.send('Page.captureScreenshot', opts);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(data, 'base64'));
      console.log(`${out}  ${+w}x${+h} @${dpr}x  (${Buffer.from(data, 'base64').length} bytes)`);
    } else if (cmd === 'diag') {
      const [w, path = '/'] = rest;
      await open(cdp, abs(path), { width: +w, height: 1400, dpr: 1 });
      console.log(await evaluate(cdp, OVERFLOW_EXPR));
    } else if (cmd === 'eval') {
      const [w, expr, path = '/'] = rest;
      await open(cdp, abs(path), { width: +w, height: 1400, dpr: 1 });
      const v = await evaluate(cdp, expr);
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    } else {
      console.error('用法：cdp.mjs shot|diag|eval ...（见文件头注释）');
      code = 1;
    }
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
}

main();
