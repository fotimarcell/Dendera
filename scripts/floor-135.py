#!/usr/bin/env python3
"""A 13,5 fok a számozott padlóra vetítve."""
import math
import os
from PIL import Image, ImageDraw, ImageFont

W = 960
FPS = 8
SRC = "/workspace/public/Padlo-18-szamozott-v7.jpg"
OUT = "/tmp/floor-135-frames"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FUGA = (230, 161, 0, 230)
ATLO = (124, 58, 237, 230)
ATLO2 = (167, 139, 250, 220)
ARRIVE = (180, 35, 24)

SCENES = [
    ("padlo", "A padló", 6, ["Ugyanaz a jelenség, most a számozott padlón.", "A vékony vonalak a hézagok. Észak a kép teteje."]),
    ("fuga", "Hézagok", 8, ["A hézagok két irányba sűrűsödnek: 18° és 108°, sárgával.", "A 0° észak–dél, a 90° kelet–nyugat."]),
    ("atlo", "Átlók", 8, ["Az átlók máshova sűrűsödnek: 81° és 138°, lilával.", "Sárga a hézag, lila a kő belseje."]),
    ("gap", "27 fok", 8, ["A legközelebbi pár a 108°-os hézag és a 81°-os átló.", "A körcikk a köztük lévő 27 fok."]),
    ("on108", "A hézagon", 7, ["A piros vonal pontosan a 108°-os hézagokon fekszik.", "Az átlóktól 27 fokra marad."]),
    ("on81", "Az átlón", 7, ["A piros vonal a 81°-os átlókra ül.", "A hézagoktól marad 27 fokra."]),
    ("middle", "13,5 fok", 10, ["A piros vonal a két nyaláb közé megy, 94,5°-ra.", "Mindkettőtől 13,5 fok. Ez a 27 fok fele, nem mérési hiba."]),
    ("far", "A túloldal", 8, ["A vonal túloldala 288° és 261°. A felező 275°.", "A Tauridák nyugvása i. e. 1766-ban ide esik."]),
    ("near108", "108° külön", 8, ["Csak a hézag, a templom korában.", "Delta Aquaridák kelése 0,6°, Orionidák nyugvása 0,1°."]),
    ("near18", "18° külön", 7, ["A másik hézagnyaláb a 18°.", "A Perseidák kelése 0,6°-ra van tőle."]),
    ("near81", "81° külön", 7, ["A 81°-os átló, külön nézve.", "A Tauridák kelése 0,5°-ra van tőle."]),
    ("end", "Jelentősége", 12, ["A piros vonal a két nyaláb között áll, egyikre sem fekszik rá.", "Egy érkezés mindkettőt egyszerre 13,5 foknál pontosabban nem találja el."]),
]


def font(path, size):
    return ImageFont.truetype(path, size)


def gap(a, b):
    a %= 180
    b %= 180
    d = abs(a - b)
    return min(d, 180 - d)


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def layer_of(lines, scale, ang, tol, color, width, size):
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    for a, x1, y1, x2, y2 in lines:
        if gap(a, ang) <= tol:
            dr.line((x1 * scale, y1 * scale, x2 * scale, y2 * scale), fill=color, width=width)
    return img


def spoke(draw, w, h, degree, color, width):
    cx, cy = w / 2, h / 2
    ang = math.radians(degree - 90)
    length = math.hypot(w, h)
    draw.line(
        (cx - math.cos(ang) * length, cy - math.sin(ang) * length, cx + math.cos(ang) * length, cy + math.sin(ang) * length),
        fill=color,
        width=width,
    )


def compass(draw, w, h, spokes, wedge, hand):
    cx, cy = w / 2, h / 2
    r = min(w, h) * 0.2
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 252, 245, 110), outline=(15, 60, 90, 220), width=2)
    if wedge:
        start = math.radians(81 - 90)
        end = math.radians(108 - 90)
        draw.pieslice((cx - r, cy - r, cx + r, cy + r), start=math.degrees(start), end=math.degrees(end), fill=(180, 35, 24, 70))
        face = font(BOLD, 22)
        draw.text((cx + r * 0.45, cy - r * 0.2), "27°", font=face, fill=(28, 25, 23), anchor="mm")
    for degree, color in spokes:
        ang = math.radians(degree - 90)
        draw.line((cx, cy, cx + math.cos(ang) * r, cy + math.sin(ang) * r), fill=color, width=3)
    if hand is not None:
        ang = math.radians(hand - 90)
        x, y = cx + math.cos(ang) * r, cy + math.sin(ang) * r
        draw.line((cx, cy, x, y), fill=ARRIVE + (255,), width=5)
        draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=ARRIVE + (255,))
    face = font(BOLD, 20)
    draw.text((cx, cy - r - 16), "É", font=face, fill=(15, 60, 90), anchor="mm")
    draw.text((cx, cy + r + 16), "D", font=face, fill=(15, 60, 90), anchor="mm")
    draw.text((cx + r + 16, cy), "K", font=face, fill=(15, 60, 90), anchor="mm")
    draw.text((cx - r - 18, cy), "Ny", font=face, fill=(15, 60, 90), anchor="mm")


def wrap(draw, text, face, width):
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=face) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def main():
    import json
    floor = Image.open(SRC).convert("RGBA")
    h = round(floor.height * W / floor.width)
    floor = floor.resize((W, h), Image.Resampling.LANCZOS)
    scale = W / 4108
    fuga = json.load(open("/workspace/public/fugak-csoportok.json"))["vonalak"]
    atlo = json.load(open("/workspace/public/atlok-csoportok.json"))["vonalak"]
    base = floor.copy()
    faint = Image.new("RGBA", (W, h), (0, 0, 0, 0))
    dr = ImageDraw.Draw(faint)
    for a, x1, y1, x2, y2 in fuga:
        dr.line((x1 * scale, y1 * scale, x2 * scale, y2 * scale), fill=(20, 20, 20, 90), width=1)
    base.alpha_composite(faint)
    packs = {
        "f18": layer_of(fuga, scale, 18, 5, FUGA, 3, (W, h)),
        "f18t": layer_of(fuga, scale, 18, 2.5, FUGA, 4, (W, h)),
        "f108": layer_of(fuga, scale, 108, 5, FUGA, 3, (W, h)),
        "f108t": layer_of(fuga, scale, 108, 2.5, FUGA, 4, (W, h)),
        "a81": layer_of(atlo, scale, 81, 7, ATLO, 3, (W, h)),
        "a81t": layer_of(atlo, scale, 81, 4, ATLO, 4, (W, h)),
        "a138": layer_of(atlo, scale, 138, 7, ATLO2, 2, (W, h)),
    }
    os.makedirs(OUT, exist_ok=True)
    n = 0
    body = font(FONT, 24)
    title_font = font(BOLD, 28)
    for sid, title, seconds, texts in SCENES:
        count = max(1, int(round(seconds * FPS)))
        for i in range(count):
            p = i / max(1, count - 1)
            frame = base.copy()
            show18 = sid in {"fuga", "atlo", "near18", "end"}
            show108 = sid in {"fuga", "atlo", "gap", "on108", "on81", "middle", "far", "near108", "end"}
            show81 = sid in {"atlo", "gap", "on108", "on81", "middle", "far", "near81", "end"}
            show138 = sid in {"atlo", "end"}
            if show18:
                frame.alpha_composite(packs["f18t"] if sid == "near18" else packs["f18"])
            if show108:
                frame.alpha_composite(packs["f108t"] if sid == "near108" else packs["f108"])
            if show138:
                frame.alpha_composite(packs["a138"])
            if show81:
                frame.alpha_composite(packs["a81t"] if sid == "near81" else packs["a81"])
            hand = None
            if sid in {"on108", "near108"}:
                hand = 108
            elif sid in {"on81", "near81"}:
                hand = 81
            elif sid == "near18":
                hand = 18
            elif sid == "middle":
                hand = 81 + (94.5 - 81) * smooth(min(1, p / 0.72))
            elif sid == "far":
                hand = 275
            elif sid == "end":
                hand = 94.5
            overlay = Image.new("RGBA", (W, h), (0, 0, 0, 0))
            dr = ImageDraw.Draw(overlay)
            if hand is not None:
                spoke(dr, W, h, hand, ARRIVE + (210,), 3)
            spokes = []
            if show18:
                spokes.append((18, FUGA))
            if show108:
                spokes.append((108, FUGA))
            if show81:
                spokes.append((81, ATLO))
            if show138:
                spokes.append((138, ATLO2))
            if sid == "far":
                spokes.extend(((288, FUGA), (261, ATLO)))
            compass(dr, W, h, spokes, sid in {"gap", "middle", "end"}, hand)
            if sid == "middle" and hand is not None:
                dr.rounded_rectangle((16, 16, 300, 96), 8, fill=(255, 252, 245, 230))
                face = font(BOLD, 26)
                dr.text((28, 28), f"hézag {abs(108 - hand):.1f}°".replace(".", ","), font=face, fill=(28, 25, 23))
                dr.text((28, 60), f"átló {abs(hand - 81):.1f}°".replace(".", ","), font=face, fill=(28, 25, 23))
            frame.alpha_composite(overlay)
            bar = Image.new("RGBA", (W, 118), (255, 252, 245, 235))
            bd = ImageDraw.Draw(bar)
            bd.text((20, 8), title, font=title_font, fill=(28, 25, 23))
            y = 44
            for paragraph in texts:
                for row in wrap(bd, paragraph, body, W - 40):
                    bd.text((20, y), row, font=body, fill=(28, 25, 23))
                    y += 28
            frame.paste(bar, (0, h - 118), bar)
            frame.convert("RGB").save(os.path.join(OUT, f"f{n:04d}.jpg"), quality=85)
            n += 1
    print(n, W, h)


if __name__ == "__main__":
    main()
