import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { TrendPreview } from '@/components/trend-preview';

/* 首屏。
 *
 * 这是一个【服务端组件】：整页没有一行客户端 JS，唯一需要交互的
 * 主题切换被隔离在 ThemeToggle 里。首屏因此只有 HTML + CSS。
 *
 * 版式照搬苹果发布会的节奏：一个词的小标签 → 一句大标题 → 两行说明 →
 * 产品本体 → 一个大断言 → 三条原则 → 收尾。中间大量留白，
 * 靠 py-20 / py-28 这种大间距而不是分割线来切分段落。 */

export default function Home() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main>
        {/* ══════════ 首屏 ══════════ */}
        <section className="content-max pt-16 pb-12 text-center sm:pt-24 sm:pb-16">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-hairline px-3.5 py-1.5 text-caption-1 text-ink-2">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden />
            为减脂新手做的记录工具
          </p>

          {/* 中文大标题的三条硬规则（来自设计系统）：
           *  ① letter-spacing 必须是 0 —— 负字距是给拉丁字母用的，
           *     套到汉字上会把字挤成一团
           *  ② 字重比苹果的标题降一档 —— 汉字笔画密度高，600 在小字号下发闷，
           *     这里用 500
           *  ③ 行高不能压到 1.05 —— 汉字的字面框是方的，1.15 才不会上下顶住 */}
          <h1 className="mx-auto max-w-[15ch] text-[clamp(2.25rem,6.5vw,3.5rem)] leading-[1.15] font-medium text-ink">
            减脂这件事，
            <br />
            交给数据。
          </h1>

          <p className="prose-measure mx-auto mt-6 text-pretty text-body text-ink-2">
            体重每天早上都在变，饮食每顿都不一样。
            轻记把这两件事记在同一段时间轴上，让你看清到底发生了什么。
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <Link
              href="/login"
              className="inline-flex h-11 w-full max-w-64 items-center justify-center rounded-full bg-brand px-7 text-body font-semibold text-on-accent transition-opacity hover:opacity-90 sm:w-auto"
            >
              开始记录
            </Link>
            <Link
              href="#principles"
              className="inline-flex h-11 w-full max-w-64 items-center justify-center rounded-full border border-hairline px-7 text-body font-medium text-ink transition-colors hover:bg-raised sm:w-auto"
            >
              它凭什么不一样
            </Link>
          </div>
        </section>

        {/* ══════════ 产品本体 ══════════ */}
        <section className="content-max pb-20 sm:pb-28">
          <TrendPreview />
          <p className="mt-4 text-center text-caption-1 text-ink-4">
            示意图 · 21 天，体重 −1.9 kg，日均摄入 1,962 kcal
          </p>
        </section>

        {/* ══════════ 大断言 ══════════ */}
        <section className="border-y border-hairline bg-canvas-subtle">
          <div className="content-max py-20 text-center sm:py-28">
            <h2 className="mx-auto max-w-[18ch] text-balance text-[clamp(1.75rem,4.5vw,2.75rem)] leading-[1.2] font-medium text-ink">
              大多数 App 让你记。
              <br />
              <span className="text-ink-3">我们想让你看懂。</span>
            </h2>
            <p className="prose-measure mx-auto mt-6 text-pretty text-body text-ink-2">
              记录本身不难，难的是第 30 天还在记。有研究发现，
              所有热量记录类 App 的坚持率都会随时间下降——问题不在于意志力，
              而在于每次录入的摩擦。
            </p>
            <p className="prose-measure mx-auto mt-4 text-callout text-ink-3">
              所以这个项目的第一优先级不是功能多，而是每次录入都快。
            </p>
          </div>
        </section>

        {/* ══════════ 三条原则 ══════════ */}
        <section id="principles" className="content-max scroll-mt-20 py-20 sm:py-28">
          <h2 className="text-balance text-title-2 font-medium text-ink">三条不肯妥协的地方</h2>
          <p className="mt-3 max-w-measure text-callout text-ink-2">
            这三条都不是「体验优化」，是数据可信度问题。
          </p>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            <Principle
              index="01"
              title="看 7 日均值，不看今天比昨天"
              accent="text-data-weight"
            >
              一晚的盐分、水分和糖原就能让体重上下浮动 1–2 公斤。单日数字里绝大部分是噪声，
              拿它判断成败只会让人放弃。轻记把 7 日移动平均画成主线，
              每日实测退成一条细线——趋势一眼就能看出来。
            </Principle>

            <Principle
              index="02"
              title="热量和体重，画在同一段时间轴上"
              accent="text-data-intake"
            >
              现有开源项目里，体重常常放在「身体测量」模块、饮食放在「营养」模块，
              两边从不见面。而「这周我明明吃少了，体重怎么没动」恰恰是减脂期
              最想回答的问题。把两条曲线对齐到同一根时间轴，答案才有地方出现。
            </Principle>

            <Principle
              index="03"
              title="食物库存原值，历史记录不被人改写"
              accent="text-accent-blue"
            >
              食物库统一按「每 100 克」存营养值，每条记录只存吃了多少克。
              以后修正某个食物的数据，全部历史会自动跟着变对。
              同时每条记录也会留一份当时的快照——你第 30 天回看时看到的东西，
              不会变样。
            </Principle>
          </div>
        </section>

        {/* ══════════ 收尾 ══════════ */}
        <section className="content-max pb-24 text-center sm:pb-32">
          {/* 不设 max-w：这句只有 11 个字，桌面端一行放得下（11 × 44px ≈ 484px）。
              之前给了 max-w-[16ch]，而 ch 是「0」这个字形的宽度（≈9px），
              16ch ≈ 144px 的视觉宽度远窄于中文标题需要的空间，
              于是被强行折成「先记两周，再 / 谈意志力。」这种难看的断法。 */}
          <h2 className="text-balance text-[clamp(1.75rem,4.5vw,2.75rem)] leading-[1.2] font-medium text-ink">
            先记两周，再谈意志力。
          </h2>
          <p className="prose-measure mx-auto mt-5 text-pretty text-body text-ink-2">
            两周足够让 7 日均值把噪声压下去，也足够让你第一次看见
            「吃进去的」和「体重秤上的」之间那条真实的连线。
          </p>
          <Link
            href="/login"
            className="mt-8 inline-flex h-11 items-center justify-center rounded-full bg-brand px-7 text-body font-semibold text-on-accent transition-opacity hover:opacity-90"
          >
            开始记录
          </Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

/* 原则卡片。刻意【不用】玻璃：这一屏已经有导航栏的毛玻璃了，
 * backdrop-filter 是滚动时最贵的属性，一屏最多三块。
 * 卡片靠 1px 发丝线 + 极浅的底色分层，这是苹果官网上
 * 「信息流卡片」的常规做法，也更省电。 */
function Principle({
  index,
  title,
  accent,
  children,
}: {
  index: string;
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-xl border border-hairline bg-canvas-subtle p-6">
      <span className={`text-caption-1 font-semibold tabular ${accent}`}>{index}</span>
      <h3 className="mt-3 text-title-4 font-medium text-ink">{title}</h3>
      <p className="mt-3 text-subhead text-ink-2">{children}</p>
    </article>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="content-max py-10">
        {/* 免责声明不是可选项：这个产品会给出热量目标与营养建议，
         * 而使用者是减脂新手——最容易被数字牵着走的一群人。
         * 数字算得再准，它也是用通用公式估出来的，不能替代医生。 */}
        <p className="text-footnote text-ink-3">
          免责声明：轻记提供的热量与营养数值由公开的通用公式估算得出，仅供参考，
          不构成医疗建议。任何减重计划都建议先咨询医生或注册营养师，
          尤其是有基础疾病、处于孕期或哺乳期的情况。
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-caption-1 text-ink-4">
          <span>轻记 · 个人减脂记录工具</span>
          <span>Next.js · PostgreSQL · Supabase</span>
        </div>
      </div>
    </footer>
  );
}
