/* 动作演示的**回落方案**：两张定格照片来回淡入。
 *
 * 现在绝大多数动作都换成了一段循环动画（见 exercise-anim.tsx），
 * 只有两个有氧项目（划船机、户外骑行）在动作库动画里没有对应素材，
 * 才退回到这两帧照片。详见 globals.css 里 pose-crossfade 那段的说明。
 *
 * 为什么用原生 <img> 而不是 next/image：
 *   1. 图已经是我自己压过的 460px WebP（每张 15KB 左右），再走一遍
 *      next/image 的运行时缩放没有收益；
 *   2. next/image 要占位、要 blurDataURL、还要在构建时生成不同尺寸，
 *      这里只需要一张固定尺寸的图；
 *   3. 这两张图是绝对定位叠在一起的，next/image 的外层 div 会多一层
 *      包裹，定位反而更绕。
 * 代价是失去了 next/image 的自动 format 协商 —— 已经手动转成 WebP 了。
 */

export function ExerciseFrames({
  id,
  name,
  className = '',
}: {
  /** 数据集里的动作 id，同时也是 public/exercises/ 下的目录名 */
  id: string;
  name: string;
  className?: string;
}) {
  return (
    <div
      className={`relative aspect-[3/2] w-full overflow-hidden rounded-md bg-sunken ${className}`}
    >
      {/* 第一帧不用 lazy：它是容器的背景，延迟加载会让卡片先空一下。
          第二帧可以 lazy，它在视口外时没必要下载。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/exercises/${id}/0.webp`}
        alt=""
        width={460}
        height={307}
        className="pose-frame"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/exercises/${id}/1.webp`}
        alt={`${name} 的动作演示`}
        width={460}
        height={307}
        loading="lazy"
        className="pose-frame pose-frame-b"
      />
    </div>
  );
}
