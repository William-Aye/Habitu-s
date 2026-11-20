"""Draws every Habituer brand image from one definition of the mark (two people whose arms make the H).

Run from the repository root:  python scripts/brand/make_brand_assets.py
Needs Pillow, and Segoe UI (Windows) for the social preview text. The SVG copies of the mark are in
web/public/favicon.svg, web/src/html.ts (LOGO_MARK), app/src/features/brand/LogoMark.tsx and
app/assets/expo.icon/Assets/habituer-mark.svg; change them together with SHAPES below.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
TERRA, PEACH = (0xB4, 0x44, 0x1F, 255), (0xFD, 0xE8, 0xDC, 255)
# Shapes in a 100x100 box: heads, bodies, arms (x0, y0, x1, y1, radius).
SHAPES = [(20, 16, 38, 34, 9), (62, 16, 80, 34, 9),
          (21, 39, 37, 83, 8), (63, 39, 79, 83, 8), (28, 53, 72, 65, 6)]


def mark(size, scale, color, bg=None, ss=4):
    """The mark centred on a size x size image, drawn 4x larger then reduced for smooth edges."""
    n = size * ss
    im = Image.new("RGBA", (n, n), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    k = n / 100 * scale
    off = n / 2 - 50 * k
    dy = (50 - 49.5) * k  # centre the mark vertically (its box is y 16..83)
    for x0, y0, x1, y1, r in SHAPES:
        d.rounded_rectangle([off + x0 * k, off + y0 * k + dy, off + x1 * k, off + y1 * k + dy], radius=r * k, fill=color)
    return im.resize((size, size), Image.LANCZOS)


def social_preview(path):
    """1200x630 image for link previews: app icon, name and the home page headline."""
    W, H, SS = 1200, 630, 2
    BG, TERRA, TEXT, MUTED, PEACH = (0xFF, 0xFA, 0xF5), (0xB4, 0x44, 0x1F), (0x2B, 0x21, 0x18), (0x6B, 0x5A, 0x4E), (0xFD, 0xE8, 0xDC, 255)
    im = Image.new("RGB", (W * SS, H * SS), BG)
    d = ImageDraw.Draw(im)
    # Icon: peach rounded square with the mark.
    size = 300 * SS
    icon = mark(size, 1, TERRA + (255,), PEACH, ss=2)
    maskim = Image.new("L", (size, size), 0)
    ImageDraw.Draw(maskim).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
    x0, y0 = 100 * SS, (H * SS - size) // 2
    im.paste(icon, (x0, y0), maskim)
    bold = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 96 * SS)
    reg = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 40 * SS)
    tx = x0 + size + 70 * SS
    d.text((tx, 190 * SS), "Habituer", font=bold, fill=TERRA)
    d.text((tx, 330 * SS), "Retrouvez les mêmes visages,", font=reg, fill=TEXT)
    d.text((tx, 384 * SS), "chaque semaine", font=reg, fill=TEXT)
    d.text((tx, 460 * SS), "habituer.org", font=ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 30 * SS), fill=MUTED)
    im.resize((W, H), Image.LANCZOS).save(path, optimize=True)


def main():
    img = ROOT / "app/assets/images"
    mark(1024, 1, TERRA, PEACH).save(img / "icon.png")
    mark(512, 0.62, TERRA).save(img / "android-icon-foreground.png")  # inside the adaptive-icon safe zone
    Image.new("RGBA", (512, 512), PEACH).save(img / "android-icon-background.png")
    mark(432, 0.62, (255, 255, 255, 255)).save(img / "android-icon-monochrome.png")
    mark(48, 1, TERRA, PEACH).save(img / "favicon.png")
    mark(256, 1, TERRA).crop((50, 38, 206, 216)).save(img / "splash-icon.png")
    web = ROOT / "web/public"
    mark(64, 1, TERRA, PEACH).resize((16, 16), Image.LANCZOS).save(web / "favicon.ico", sizes=[(16, 16)])
    mark(180, 1, TERRA, PEACH).convert("RGB").save(web / "apple-touch-icon.png", optimize=True)
    social_preview(web / "og-default.png")


if __name__ == "__main__":
    main()
