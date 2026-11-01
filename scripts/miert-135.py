#!/usr/bin/env python3
"""Feliratos magyarázó videó: miért 13,5° a közös határ."""
import math
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
FPS = 12
OUT_DIR = "/tmp/miert-135-frames"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
INK = (28, 25, 23)
FUGA = (196, 136, 10)
ATLO = (109, 40, 217)
ARRIVE = (180, 35, 24)
PAPER = (244, 239, 230)
NAVY = (15, 60, 90)

SCENES = [
    ("Két vonal", 7, [
        "A padlón kétféle vonal van.",
        "A fuga a kövek közötti hézag. Az átló a kő belsejében fut, saroktól sarokig.",
    ]),
    ("Hézagok", 8, [
        "A hézagok nem állnak összevissza. Két irányba sűrűsödnek: 18° és 108°.",
        "A 0° észak, a 90° kelet. A vonalnak nincs eleje: oda-vissza ugyanaz.",
    ]),
    ("Átlók", 8, [
        "Az átlók máshova sűrűsödnek: 81° és 138°.",
        "Sárga a hézag. Lila a kő belseje. Két külön család.",
    ]),
    ("27 fok", 7, [
        "A két család itt van a legközelebb: a 108°-os hézag és a 81°-os átló.",
        "Közöttük 27 fok van. Ez a kiinduló szám.",
    ]),
    ("Egy hely", 8, [
        "Egy érkezés csak egy helyen állhat. Két ház 27 lépésre van egymástól.",
        "A közepén mindkettőtől 13 és fél lépésre vagy. Közelebb az egyikhez csak a másik rovására mehetsz.",
    ]),
    ("A hézagon", 7, [
        "Ha az érkezés pontosan a 108°-os hézagra ül, azt eltalálja.",
        "Az átlótól viszont 27 fokra marad.",
    ]),
    ("Az átlón", 7, [
        "Ha az átlóra ül, 81°-ra, akkor az átló a pontos.",
        "A hézagtól marad 27 fokra. Ugyanaz a gond, csak fordítva.",
    ]),
    ("13,5 fok", 9, [
        "A legkisebb közös tévedés a kettő között van.",
        "(108 − 81) / 2 = 13,5°. Ez nem mérési hiba, hanem a 27 fok fele.",
    ]),
    ("A túloldal", 8, [
        "Ugyanez a két vonal a kör túlsó felén is megvan. A közepe 275°.",
        "A Tauridák nyugvása i. e. 1766-ban erre a felezőre esik.",
    ]),
    ("Külön nézve", 12, [
        "Ha csak az egyik vonalat nézzük, a templom korában van közeli egyezés.",
        "Delta Aquaridák kelése: 0,6° a 108°-os hézagtól. Perseidák kelése: 0,6° a 18°-ostól.",
        "Orionidák nyugvása: 0,1° a 108°-os vonaltól. Tauridák kelése: 0,5° a 81°-os átlótól.",
    ]),
    ("Jelentősége", 14, [
        "A padló két irányt őriz, nem egyet. Egy nyíl csak az egyiket találhatja el pontosan.",
        "A 13,5 fok a határ: eddig jut egy irány, ha mindkét vonalat egyszerre akarná magyarázni.",
        "Az egész padló egy nyíllal nem fejthető meg. Külön-külön mindkét irány mellé odaáll egy meteorraj, egy fokon belül.",
    ]),
]


def font(path, size):
    return ImageFont.truetype(path, size)


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


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def xy(cx, cy, r, deg):
    a = math.radians(deg - 90)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def spoke(draw, cx, cy, r, deg, color, width):
    x1, y1 = xy(cx, cy, r, deg)
    x2, y2 = xy(cx, cy, r, deg + 180)
    draw.line((x1, y1, x2, y2), fill=color, width=width)


def dial(draw, cx, cy, r):
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 252, 245), outline=NAVY, width=3)
    for name, deg in (("É", 0), ("K", 90), ("D", 180), ("Ny", 270)):
        x, y = xy(cx, cy, r + 28, deg)
        face = font(BOLD, 26)
        draw.text((x, y), name, font=face, fill=NAVY, anchor="mm")


def arrow(draw, cx, cy, r, deg):
    x, y = xy(cx, cy, r, deg)
    draw.line((cx, cy, x, y), fill=ARRIVE, width=8)
    draw.ellipse((x - 12, y - 12, x + 12, y + 12), fill=ARRIVE)
    draw.ellipse((cx - 7, cy - 7, cx + 7, cy + 7), fill=ARRIVE)


def label(draw, x, y, text, color):
    face = font(BOLD, 28)
    tw = draw.textlength(text, font=face)
    draw.rounded_rectangle((x - tw / 2 - 12, y - 22, x + tw / 2 + 12, y + 18), 8, fill=(255, 252, 245))
    draw.text((x, y), text, font=face, fill=color, anchor="mm")


def stones(draw, p):
    draw.polygon([(120, 120), (340, 100), (370, 400), (140, 430)], fill=(239, 228, 207), outline=INK)
    draw.polygon([(410, 110), (700, 95), (730, 410), (440, 395)], fill=(231, 240, 220), outline=INK)
    if p > 0.15:
        draw.line((385, 120, 410, 400), fill=FUGA, width=16)
        label(draw, 300, 250, "fuga, a hézag", FUGA)
    if p > 0.45:
        draw.line((450, 140, 700, 380), fill=ATLO, width=8)
        label(draw, 620, 200, "átló", ATLO)
    note = font(FONT, 28)
    draw.text((800, 200), "hézag a kövek között", font=note, fill=INK)
    draw.text((800, 260), "vonal a kő belsejében", font=note, fill=INK)


def houses(draw, p):
    left, right, y = 250, 980, 280
    person = left + (right - left) * 0.5 * smooth(min(1, p / 0.7))
    draw.line((left, y + 90, right, y + 90), fill=(180, 170, 160), width=8)
    draw.rounded_rectangle((left - 80, y - 50, left + 80, y + 70), 8, fill=FUGA)
    draw.rounded_rectangle((right - 80, y - 50, right + 80, y + 70), 8, fill=ATLO)
    label(draw, left, y - 90, "hézag", FUGA)
    label(draw, right, y - 90, "átló", ATLO)
    label(draw, (left + right) / 2, y + 150, "27 lépés", INK)
    draw.ellipse((person - 24, y + 20, person + 24, y + 68), fill=ARRIVE)
    if p > 0.55:
        label(draw, person, y - 10, "13,5 és 13,5", ARRIVE)


def compass(draw, scene, p):
    side = scene in {"A hézagon", "Az átlón", "13,5 fok", "A túloldal", "Külön nézve", "Jelentősége"}
    cx, cy, r = (340, 250, 170) if side else (640, 250, 190)
    dial(draw, cx, cy, r)
    if scene != "Egy hely":
        strong = scene in {"27 fok", "A hézagon", "Az átlón", "13,5 fok", "A túloldal"}
        spoke(draw, cx, cy, r - 14, 18, (232, 214, 170) if strong else FUGA, 6 if strong else 10)
        spoke(draw, cx, cy, r - 14, 108, FUGA, 12)
        if scene in {"Hézagok", "Átlók"}:
            x, y = xy(cx, cy, r + 8, 18)
            label(draw, x, y - 34, "18°", FUGA)
            x, y = xy(cx, cy, r + 10, 108)
            label(draw, x + 30, y, "108°", FUGA)
    if scene not in {"Hézagok", "Egy hely"}:
        strong = scene in {"27 fok", "A hézagon", "Az átlón", "13,5 fok", "A túloldal"}
        spoke(draw, cx, cy, r - 14, 138, (109, 40, 217) if not strong else (210, 190, 230), 6 if strong else 10)
        spoke(draw, cx, cy, r - 14, 81, ATLO, 12)
        if scene == "Átlók":
            x, y = xy(cx, cy, r + 12, 81)
            label(draw, x, y, "81°", ATLO)
            x, y = xy(cx, cy, r + 12, 138)
            label(draw, x, y + 28, "138°", ATLO)
    if scene in {"27 fok", "A hézagon", "Az átlón", "13,5 fok"}:
        box = (cx + 70, cy - 150)
        label(draw, box[0], box[1], "27°", INK)
    if scene == "A hézagon":
        arrow(draw, cx, cy, r - 24, 108)
        label(draw, 980, 160, "hézag: 0°", FUGA)
        label(draw, 980, 230, "átló: 27°", ATLO)
    if scene == "Az átlón":
        arrow(draw, cx, cy, r - 24, 81)
        label(draw, 980, 160, "átló: 0°", ATLO)
        label(draw, 980, 230, "hézag: 27°", FUGA)
    if scene == "13,5 fok":
        degree = 81 + (94.5 - 81) * smooth(min(1, p / 0.7))
        arrow(draw, cx, cy, r - 24, degree)
        label(draw, 1000, 150, f"hézag: {abs(108 - degree):.1f}°".replace(".", ","), FUGA)
        label(draw, 1000, 220, f"átló: {abs(degree - 81):.1f}°".replace(".", ","), ATLO)
        if p > 0.6:
            face = font(BOLD, 40)
            draw.text((760, 300), "(108 − 81) / 2", font=face, fill=INK)
            draw.text((760, 360), "= 13,5°", font=font(BOLD, 48), fill=ARRIVE)
    if scene == "A túloldal":
        spoke(draw, cx, cy, r - 14, 288, FUGA, 12)
        spoke(draw, cx, cy, r - 14, 261, ATLO, 12)
        arrow(draw, cx, cy, r - 24, 275)
        label(draw, 980, 200, "275°", ARRIVE)
        label(draw, 980, 270, "Tauridák, i. e. 1766", INK)
    if scene == "Külön nézve":
        rows = [
            ("Delta Aquaridák kelése", "0,6° a 108°-os hézagtól", FUGA),
            ("Perseidák kelése", "0,6° a 18°-os hézagtól", FUGA),
            ("Orionidák nyugvása", "0,1° a 108°-os vonaltól", FUGA),
            ("Tauridák kelése", "0,5° a 81°-os átlótól", ATLO),
        ]
        face = font(BOLD, 26)
        small = font(FONT, 24)
        for i, (name, text, color) in enumerate(rows):
            appear = smooth((p * len(rows) - i) / 0.6)
            if appear <= 0:
                continue
            y = 80 + i * 90
            draw.rectangle((700, y, 714, y + 58), fill=color)
            draw.text((730, y), name, font=face, fill=INK)
            draw.text((730, y + 34), text, font=small, fill=INK)
    if scene == "Jelentősége":
        arrow(draw, cx, cy, r - 24, 94.5)
        face = font(BOLD, 36)
        draw.text((620, 120), "Két irány, egy nyíl.", font=face, fill=INK)
        body = font(FONT, 28)
        for i, sentence in enumerate((
            "Egy nyíl csak egy irányba mutat.",
            "A két vonal 27 fokra van.",
            "A közös határ a fele: 13,5°.",
            "Ez határ, nem egy titkos dátum.",
        )):
            if smooth((p * 4 - i) / 0.8) <= 0:
                continue
            draw.text((620, 190 + i * 58), sentence, font=body, fill=INK)


def frame(scene, p, lines):
    img = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(img)
    if scene == "Két vonal":
        stones(draw, p)
    elif scene == "Egy hely":
        houses(draw, p)
    else:
        compass(draw, scene, p)
    draw.rectangle((0, 500, W, H), fill=(255, 252, 245))
    draw.line((0, 500, W, 500), fill=(214, 211, 209), width=2)
    title = font(BOLD, 34)
    body = font(FONT, 26)
    draw.text((48, 518), scene, font=title, fill=INK)
    y = 568
    for paragraph in lines:
        for row in wrap(draw, paragraph, body, W - 96):
            draw.text((48, y), row, font=body, fill=INK)
            y += 34
            if y > H - 20:
                break
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    n = 0
    for title, seconds, lines in SCENES:
        count = int(round(seconds * FPS))
        for i in range(count):
            img = frame(title, i / max(1, count - 1), lines)
            img.save(os.path.join(OUT_DIR, f"f{n:04d}.png"))
            n += 1
    print(n)


if __name__ == "__main__":
    main()
