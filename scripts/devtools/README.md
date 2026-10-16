# 本地验证工具

前端「看起来对不对」只能靠真渲染。这里放的是让渲染结果**可测量**的工具。

## `cdp.mjs` —— 无头 Chrome 真视口截图 + 版式诊断

```bash
npx next start -p 3100 &          # 需要先有服务

node scripts/devtools/cdp.mjs diag 390                    # 390px 下的版式诊断
node scripts/devtools/cdp.mjs diag 360                    # 小屏
node scripts/devtools/cdp.mjs shot 390 1560 2 /tmp/m.png  # 手机截图（2x）
node scripts/devtools/cdp.mjs shot 1440 3000 1 /tmp/d.png # 桌面截图
node scripts/devtools/cdp.mjs eval 390 "getComputedStyle(document.querySelector('h1')).fontSize"
```

走 Chrome DevTools Protocol，约 2 秒一次。

### 为什么不用 `chrome --headless --window-size=390,... --screenshot`

**无头 Chrome 强制窗口最小宽度 500px，`--window-size` 小于 500 会被静默忽略。**
于是「移动端截图」实际渲染的是 500px 宽的版式，再被裁到 390px ——
右侧文字看着像被切掉，非常像 CSS 横向溢出 bug。

本项目真的因此误判过一次：花了不少时间去找一个**根本不存在的移动端溢出**，
最后靠 `diag` 量出 `scrollWidth === innerWidth === 390`、越界元素 0 个，
才发现是截图工具在骗人。

三个附带教训：
1. `--headless=new` 同样有 500px 下限，换新版无头也绕不过去。
2. macOS 自带没有 `timeout` 命令，`timeout 30 chrome ...` 会 exit 127，
   而 Chrome 干完活**不会退出**。必须后台起 + 轮询产物 + 手动 kill。
3. 用 iframe 套窄视口能拿到真 390px，但 `file://` → `http://` 的
   `contentDocument` 被浏览器硬拦（`--disable-web-security` 也不放行），
   所以量不到 DOM。CDP 的 `Emulation.setDeviceMetricsOverride` 才是正路。

### `diag` 会报什么

- `scrollWidth` vs `innerWidth` → 横向溢出有无，超了几 px
- 越界元素清单（带 `L/R/W` 实测值）
- 关键容器实测宽度（`.content-max` / `.prose-measure` / `.glass` / `h1` …）
- **触控目标 <44px 的清单** —— 这条最有用：44px 是 HIG 硬要求，
  但 36px 的按钮在截图里看着完全正常，眼睛发现不了。
  本项目的导航按钮就是被这条抓出来的（可点区域外扩到 44px 后仍保持 36px 视觉）。

## 失败模式备忘

| 现象 | 真实原因 |
| --- | --- |
| 窄视口截图右侧内容「被切」 | 无头 Chrome 的 500px 窗口下限，不是 CSS 溢出 |
| `timeout: command not found`（exit 127） | macOS 没有 GNU `timeout` |
| Chrome 命令一直挂着不返回 | 无头 Chrome 完成后不退出，需手动 kill |
| 刚放进 `public/` 的文件 404 | `next start` 的 public 文件清单是**构建时**确定的，加文件要重新 build |
| `eval` / `diag` 报 `chrome-error://chromewebdata/` | `PORT` 环境变量没传，默认连的是 3100 |

## `console.mjs` —— 抓 console / 异常 / 失败请求

```bash
PORT=3000 node scripts/devtools/console.mjs '/login#access_token=bogus' 2500
```

`eval` 只能看到**最终**状态，而 hydration mismatch、key 警告、被吞掉的
客户端异常都只出现在 console 里，页面上完全看不出来。这个工具补的就是这一块。

判据：**只有真的有 error / warning / 异常 / 失败请求时才 exit 1**，
否则打印「console 干净 ✅」。可以直接串进验证流程。

滤掉了 Next dev 的常规噪音（HMR 连接、Fast Refresh、React DevTools 提示）。

### 两个已踩的坑

1. **忘了 `Page.navigate`** —— 第一次写完直接跑，两行「console 干净」其实量的是
   `about:blank`（`href` 返回 `"blank"`、`title` 为空才露馅）。
   所以输出里同时打「地址」和「最终」，别只看「干净」两个字。
2. `document.querySelector('[data-nextjs-toast]')` 会命中 `<style>` 标签，
   拿到一大段 CSS 文本 —— 想读 dev 浮层得进 `nextjs-portal` 的 `shadowRoot`，
   不如直接听 `Runtime.consoleAPICalled`。

