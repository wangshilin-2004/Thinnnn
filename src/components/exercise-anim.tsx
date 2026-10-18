/* 动作演示：一段循环播放的人体解剖示意动画，训练肌群标红。
 *
 * 数据来自 exercises-gifs（MIT），每个动作 12 帧、300×300。本仓库把
 * 原始 GIF 的白底抠掉、压成无色透明的 WebP，每帧 85ms 无限循环 ——
 * 原始 GIF 在起点和终点各停 1 秒，放在卡片上像「卡住了」，改成匀速
 * 之后看起来是一段连续动作。
 *
 * 为什么用原生 <img> 而不是 next/image：
 *   1. 这是一张**动画** WebP。next/image 会把图片交给运行时做转码，
 *      动画帧会被丢掉，只剩第一帧 —— 那就白配了；
 *   2. 图已经是我自己压过的 300px WebP（每张 70KB 左右），再缩放没有收益。
 * 代价是失去 format 协商，已经手动转好了。
 *
 * 少数项目（划船机、户外骑行）在动作库里没有对应动画，此时回落到
 * 两张实拍照片交替淡入 —— 见 exercise-frames.tsx。
 */

import { ExerciseFrames } from './exercise-frames';

export function ExerciseAnim({
  id,
  name,
  hasLoop = true,
  className = '',
}: {
  /** 动作 id，同时也是 public/exercises/ 下的目录名 */
  id: string;
  name: string;
  /** 动作库缺这个项目的动画时为 false，回落到两帧照片 */
  hasLoop?: boolean;
  className?: string;
}) {
  if (!hasLoop) {
    return <ExerciseFrames id={id} name={name} className={className} />;
  }

  return (
    <div
      className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-[radial-gradient(circle_at_50%_45%,#2b2b2f_0%,#1c1c1e_72%)] ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {/* 插画本身是「白底 + 白色人体 + 红色肌肉」。放到暗色主题上时，
          白色的边缘在深色卡片上就是一圈刺眼的白锯齿 —— 那不是抠图没抠干净，
          而是人体本身就是白的。invert 让它变成深色人体，hue-rotate(180)
          把反转后变青的肌肉再转回红色。亮色主题保持原样。 */}
      <img
        src={`/exercises/${id}/loop.webp`}
        alt={`${name} 的动作示意，红色是这个动作训练的肌群`}
        width={300}
        height={300}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-contain dark:invert dark:hue-rotate-180"
      />
    </div>
  );
}
