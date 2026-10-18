'use client';

/* 为什么这个组件必须是客户端组件：
 * react-body-highlighter 是 2019 年的包，没有 'use client'，它内部渲染的
 * <polygon onClick={...}> 直接带事件处理器。服务端组件渲染它会在构建时报
 * 「Event handlers cannot be passed to Client Component props」—— 500。
 * 包一层 'use client' 是改动最小的解法：这些人体图本来也没有任何交互，
 * 但 React 需要知道「这段 JSX 该在哪个环境跑」。
 *
 * 代价：这个包（~25KB gzip）进了浏览器首屏 JS。如果以后觉得贵，正确的做法
 * 是把它内联成静态 SVG（把 polygon 路径抄进我们自己的服务端组件），
 * 而不是继续加客户端边界 —— 那才真的省得掉。 */

import Model from 'react-body-highlighter';
import type { IExerciseData, Muscle } from 'react-body-highlighter';

/* 人体肌肉示意图。
 *
 * 来源：react-body-highlighter（MIT）。它把人体拆成 20 多个可单独上色的
 * 肌肉多边形，正反两个视角各一套 —— 正好对应我们要的「绿色人体、红色
 * 标出训练肌群」。
 *
 * 三个决定：
 *
 * 1. **正反两面都画，不做「按肌群自动选一面」**。自动选看起来更聪明，但
 *    选中背部动作时用户看不到胸，就没法确认「这个动作不练胸」；两面都在，
 *    空白本身就是信息。宽度只有 44px 一个，两面加起来 88px，卡片放得下。
 *
 * 2. **主要肌群和次要肌群用两种红**。都用同一种红的话，卧推动作上亮起来
 *    的肱三头肌会和胸一样大 —— 而实际上卧推是练胸的，三头只是搭车。用
 *    亮红 = 主要、浅红 = 次要，一眼能分出主次。
 *
 * 3. **整块 aria-hidden**。这些图形对读屏用户没有增量信息（页面上的文字
 *    标签「胸大肌、肱三头肌」已经把同样的信息说了一遍），读屏读一堆
 *    「路径、路径」只会更糟。
 *
 * 配色：身体用暗绿（#3c6b52）而不是亮绿 —— 底下的卡片是深色的，亮绿会
 * 和背景抢注意力；红色才应该是最响的那个颜色。
 */

const BODY_COLOR = '#3c6b52';
const PRIMARY_COLOR = '#ff453a';
const SECONDARY_COLOR = '#ff8f7a';

export function MuscleMap({
  muscles,
  secondary,
  width = 44,
}: {
  /** 主要发力肌群，亮红 */
  muscles: Muscle[];
  /** 次要肌群，浅红 */
  secondary: Muscle[];
  /** 单张人体图的宽度（px），高度自动是它的两倍 */
  width?: number;
}) {
  /* frequency 是这个包用来分档的字段：索引 = frequency - 1 去 highlightedColors 里取色。
   * 所以主要肌群给 2、次要给 1，颜色数组顺序就是 [浅红, 亮红]。 */
  const data: IExerciseData[] = [];
  if (muscles.length > 0) data.push({ name: '主要', muscles, frequency: 2 });
  if (secondary.length > 0) data.push({ name: '次要', muscles: secondary, frequency: 1 });

  return (
    <div className="flex shrink-0 items-end gap-0.5" aria-hidden>
      {(['anterior', 'posterior'] as const).map((view) => (
        <Model
          key={view}
          type={view}
          data={data}
          bodyColor={BODY_COLOR}
          highlightedColors={[SECONDARY_COLOR, PRIMARY_COLOR]}
          style={{ width }}
          /* viewBox 是 0 0 100 200（1:2），高度让浏览器按比例算出来；
           * 写死 height 的话换个 width 就会变形。 */
          svgStyle={{ width: '100%', height: 'auto', display: 'block' }}
        />
      ))}
    </div>
  );
}
