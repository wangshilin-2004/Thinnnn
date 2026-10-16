#!/usr/bin/env python3
"""生成图标。跑一次就够了，产物已经提交进仓库。

    python3 scripts/make-icons.py

为什么用 PIL 直接画而不是拿设计稿导出：
  这个图标就是「圆角方块 + 一条下降的折线 + 一个圆点」，用代码画比用设计工具
  更快、可复现、还能随时改颜色。等真要换设计了再说。

为什么用 4 倍超采样：
  PIL 的 ImageDraw 不做抗锯齿，圆角和斜线会有明显锯齿。
  先画 4 倍大再 LANCZOS 缩回来，等于手工抗锯齿，成本几毫秒。
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

# 品牌色。和 src/app/globals.css 里的 --color-brand / --color-data-weight 保持一致。
# 注意这里**必须写死**：图标在构建前生成好，读不到 CSS 变量。
BRAND_TOP = (255, 69, 58)     # systemRed 深色版
BRAND_BOTTOM = (255, 55, 95)  # systemPink 深色版（品牌主色）

SS = 4  # 超采样倍数


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def squircle(draw, box, radius, fill):
    """圆角矩形。Apple 的圆角其实不是正圆角（是超椭圆），
    但 22.37% 圆角的正圆角矩形在小尺寸下几乎看不出差别，
    而正圆角 PIL 原生支持 —— 不值得为此写超椭圆光栅化。"""
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def render(size: int, *, with_background: bool, pad_ratio: float = 0.0) -> Image.Image:
    """画一张 size×size 的图标。

    with_background=False 时只画折线（透明底），用于 Android 的 maskable 图标 ——
    系统会自己裁形状，带背景的图被裁完会缺角。
    """
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    if with_background:
        # 先画一条竖直渐变，再用圆角矩形当蒙版 —— 比逐行画圆角矩形简单得多
        grad = Image.new("RGB", (1, S))
        for y in range(S):
            grad.putpixel((0, y), lerp(BRAND_TOP, BRAND_BOTTOM, y / max(S - 1, 1)))
        grad = grad.resize((S, S))

        mask = Image.new("L", (S, S), 0)
        squircle(ImageDraw.Draw(mask), (0, 0, S - 1, S - 1), radius=round(S * 0.2237), fill=255)
        img.paste(grad, (0, 0), mask)

    draw = ImageDraw.Draw(img)

    # ── 折线：7 日移动平均的样子，整体向下 ──────────────────
    inset = S * (pad_ratio + 0.20)
    w = S - inset * 2
    h = S - inset * 2
    top = inset

    # 归一化坐标（0..1，y 越小越高）。刻意做得像真实体重曲线：
    # 有起伏，但趋势明确向下 —— 这正是产品想传达的东西。
    #
    # 第一版用了 8 个点、振幅 ±0.08，结果在 60px 显示尺寸下像一道闪电而不是趋势线。
    # 图标要在很小的尺寸下被认出来，所以点数降到 6 个、振幅收到 ±0.06，
    # 保留「有起伏」的语义，去掉「很剧烈」的误读。
    pts = [
        (0.00, 0.32),
        (0.22, 0.40),
        (0.42, 0.34),
        (0.62, 0.48),
        (0.82, 0.52),
        (1.00, 0.64),
    ]
    xy = [(inset + px * w, top + py * h) for px, py in pts]

    line_w = round(S * 0.062)
    draw.line(xy, fill=(255, 255, 255, 255), width=line_w, joint="curve")

    # 两端补圆点：PIL 的 line 端点默认是方的，加圆点才有 stroke-linecap="round" 的效果
    r = line_w / 2
    for x, y in (xy[0], xy[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, 255))

    # ── 末端圆点：强调「落到一个具体数字上」 ────────────────
    ex, ey = xy[-1]
    dot_r = S * 0.072
    draw.ellipse((ex - dot_r, ey - dot_r, ex + dot_r, ey + dot_r), fill=(255, 255, 255, 255))
    inner_r = dot_r * 0.44
    draw.ellipse((ex - inner_r, ey - inner_r, ex + inner_r, ey + inner_r), fill=(*BRAND_BOTTOM, 255))

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = {
        ROOT / "src/app/icon.png": render(512, with_background=True),
        ROOT / "src/app/apple-icon.png": render(180, with_background=True),
        ROOT / "public/icon-192.png": render(192, with_background=True),
        ROOT / "public/icon-512.png": render(512, with_background=True),
        # maskable：留 20% 安全边距，系统裁成圆形/方形都不会切到折线
        ROOT / "public/icon-maskable-512.png": render(512, with_background=True, pad_ratio=0.10),
    }
    for path, im in out.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        im.save(path, "PNG", optimize=True)
        print(f"  ✓ {path.relative_to(ROOT)}  {im.size[0]}×{im.size[1]}  {path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
