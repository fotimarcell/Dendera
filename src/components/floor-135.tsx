import { useEffect, useRef, useState } from "react";

type Line = [number, number, number, number, number];
type Step = {
  id: string;
  label: string;
  seconds: number;
  lines: string[];
};

const STEPS: Step[] = [
  {
    id: "padlo",
    label: "A padló",
    seconds: 6,
    lines: [
      "Ugyanaz a jelenség, most a számozott padlón.",
      "A vékony sötét vonalak a kövek közötti hézagok. Észak a kép teteje.",
    ],
  },
  {
    id: "fuga",
    label: "Hézagok",
    seconds: 8,
    lines: [
      "A hézagok két irányba sűrűsödnek. Sárgával a 18° és a 108° van kiemelve.",
      "Nem minden rés, csak a két fő irány. A 0° észak–dél, a 90° kelet–nyugat.",
    ],
  },
  {
    id: "atlo",
    label: "Átlók",
    seconds: 8,
    lines: [
      "A kövek belsejében futó átlók máshova sűrűsödnek. Lilával a 81° és a 138°.",
      "A sárga hézag és a lila átló két külön család a padlón.",
    ],
  },
  {
    id: "gap",
    label: "27 fok",
    seconds: 8,
    lines: [
      "A két család legközelebbi párja a 108°-os hézag és a 81°-os átló.",
      "A körcikk a köztük lévő 27 fok. Ezt a két nyalábot nézd a padlón.",
    ],
  },
  {
    id: "on108",
    label: "A hézagon",
    seconds: 7,
    lines: [
      "A piros vonal az érkezés. Most pontosan a 108°-os hézagokon fekszik.",
      "Az átlók ettől 27 fokra maradnak. Az egyik családot eltalálja, a másikat nem.",
    ],
  },
  {
    id: "on81",
    label: "Az átlón",
    seconds: 7,
    lines: [
      "Ha a piros vonal a 81°-os átlókra ül, azok a pontosak.",
      "A hézagoktól marad 27 fokra. Fordítva ugyanaz a gond.",
    ],
  },
  {
    id: "middle",
    label: "13,5 fok",
    seconds: 10,
    lines: [
      "A piros vonal a két nyaláb közé megy.",
      "94,5°-nál mindkettőtől 13,5 fokra áll. Közelebb az egyikhez csak a másik rovására lehet. Ez a 27 fok fele, nem mérési hiba.",
    ],
  },
  {
    id: "far",
    label: "A túloldal",
    seconds: 8,
    lines: [
      "A hézagnak és az átlónak nincs iránya, a túloldalon is ugyanaz a vonal: 288° és 261°.",
      "A felező 275°. A Tauridák nyugvása i. e. 1766-ban ide esik. Ez a határ, nem egy külön találat.",
    ],
  },
  {
    id: "near108",
    label: "108° külön",
    seconds: 8,
    lines: [
      "Ha csak a hézagot nézzük, a templom korában van közeli egyezés.",
      "A kiemelt 108°-os hézagokhoz a Delta Aquaridák kelése 0,6°-ra, az Orionidák nyugvása 0,1°-ra áll.",
    ],
  },
  {
    id: "near18",
    label: "18° külön",
    seconds: 7,
    lines: [
      "A másik hézagnyaláb a 18°.",
      "A Perseidák kelése a templom korában 0,6°-ra van ettől a iránytól.",
    ],
  },
  {
    id: "near81",
    label: "81° külön",
    seconds: 7,
    lines: [
      "Az átlóknál a 81°-os nyaláb a közelibb a Tauridákhoz.",
      "A kelésük 0,5°-ra van ettől a lila iránytól. Ez már csak az egyik család.",
    ],
  },
  {
    id: "end",
    label: "Jelentősége",
    seconds: 12,
    lines: [
      "A padló két irányt őriz. A piros vonal a kettő között áll, és egyik nyalábra sem fekszik rá.",
      "Egy érkezés az egyik családot eltalálhatja. Mindkettőt egyszerre 13,5 foknál pontosabban nem. Aki az egész padlót egy nyíllal fejtené meg, ezen a határon megáll.",
    ],
  },
];

const FUGA = "#e6a100";
const ATLO = "#7c3aed";
const ARRIVE = "#b42318";

function gap(line: number, azimuth: number) {
  const a = ((line % 180) + 180) % 180;
  const b = ((azimuth % 180) + 180) % 180;
  const diff = Math.abs(a - b);
  return Math.min(diff, 180 - diff);
}

function smooth(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function take(lines: Line[], angle: number, tolerance: number) {
  return lines.filter((line) => gap(line[0], angle) <= tolerance);
}

function paintLines(ctx: CanvasRenderingContext2D, lines: Line[], scale: number, color: string, width: number) {
  ctx.beginPath();
  for (const line of lines) {
    ctx.moveTo(line[1] * scale, line[2] * scale);
    ctx.lineTo(line[3] * scale, line[4] * scale);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
}

function compassPoint(cx: number, cy: number, radius: number, degree: number) {
  const angle = ((degree - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function drawSpoke(ctx: CanvasRenderingContext2D, w: number, h: number, degree: number, color: string, width: number) {
  const cx = w / 2;
  const cy = h / 2;
  const angle = ((degree - 90) * Math.PI) / 180;
  const len = Math.hypot(w, h);
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(angle) * len, cy - Math.sin(angle) * len);
  ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawCompass(ctx: CanvasRenderingContext2D, w: number, h: number, spokes: number[], wedge: boolean, hand: number | null) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,252,245,0.42)";
  ctx.fill();
  ctx.strokeStyle = "rgba(15,60,90,0.8)";
  ctx.lineWidth = 2;
  ctx.stroke();
  if (wedge) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, ((81 - 90) * Math.PI) / 180, ((108 - 90) * Math.PI) / 180);
    ctx.closePath();
    ctx.fillStyle = "rgba(180,35,24,0.28)";
    ctx.fill();
    ctx.font = "700 22px sans-serif";
    ctx.fillStyle = "#1c1917";
    ctx.textAlign = "center";
    ctx.fillText("27°", cx + radius * 0.62, cy - radius * 0.15);
  }
  ctx.lineWidth = 3;
  for (const degree of spokes) {
    const [x, y] = compassPoint(cx, cy, radius, degree);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = degree === 18 || degree === 108 || degree === 288 ? FUGA : ATLO;
    ctx.stroke();
  }
  if (hand !== null) {
    const [x, y] = compassPoint(cx, cy, radius, hand);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = ARRIVE;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = ARRIVE;
    ctx.fill();
  }
  ctx.fillStyle = "#0f3c5a";
  ctx.font = "700 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("É", cx, cy - radius - 16);
  ctx.fillText("D", cx, cy + radius + 16);
  ctx.fillText("K", cx + radius + 16, cy);
  ctx.fillText("Ny", cx - radius - 18, cy);
  ctx.restore();
}

function shownLines(step: Step, progress: number) {
  const count = Math.max(1, Math.ceil(Math.min(1, progress) * step.lines.length));
  return step.lines.slice(0, count);
}

export function Floor135() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fugaRef = useRef<Line[]>([]);
  const atloRef = useRef<Line[]>([]);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const bundleRef = useRef<Record<string, Line[]>>({});
  const readyRef = useRef(false);
  const indexRef = useRef(0);
  const accRef = useRef(0);
  const playingRef = useRef(false);
  const lineHold = useRef("");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lines, setLines] = useState(STEPS[0].lines.slice(0, 1));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.src = "/Padlo-18-szamozott-v7.jpg";
    img.onload = () => {
      imgRef.current = img;
      if (fugaRef.current.length && atloRef.current.length) {
        readyRef.current = true;
        setReady(true);
      }
    };
    fetch("/fugak-csoportok.json")
      .then((response) => response.json())
      .then((data: { vonalak: Line[] }) => {
        fugaRef.current = data.vonalak;
        if (imgRef.current && atloRef.current.length) {
          readyRef.current = true;
          setReady(true);
        }
      })
      .catch(() => setLines(["A hézagok nem töltődtek be."]));
    fetch("/atlok-csoportok.json")
      .then((response) => response.json())
      .then((data: { vonalak: Line[] }) => {
        atloRef.current = data.vonalak;
        if (imgRef.current && fugaRef.current.length) {
          readyRef.current = true;
          setReady(true);
        }
      })
      .catch(() => setLines(["Az átlók nem töltődtek be."]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (readyRef.current && playingRef.current) {
        const step = STEPS[indexRef.current];
        accRef.current += dt;
        if (accRef.current >= step.seconds) {
          if (indexRef.current < STEPS.length - 1) {
            accRef.current = 0;
            indexRef.current += 1;
            setIndex(indexRef.current);
          } else {
            accRef.current = step.seconds;
            playingRef.current = false;
            setPlaying(false);
          }
        }
      }
      const current = STEPS[indexRef.current];
      const progress = Math.min(1, accRef.current / current.seconds);
      const nextLines = shownLines(current, readyRef.current ? progress : 0);
      const signature = nextLines.join("\n");
      if (signature !== lineHold.current) {
        lineHold.current = signature;
        setLines(nextLines);
      }
      paint(current.id, progress);
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);

  function paint(id: string, progress: number) {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img?.naturalWidth) return;
    const w = 1200;
    const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = w / img.naturalWidth;
    const fuga = fugaRef.current;
    const atlo = atloRef.current;
    if (!fuga.length || !atlo.length) {
      ctx.drawImage(img, 0, 0, w, h);
      return;
    }
    if (!baseRef.current) {
      const base = document.createElement("canvas");
      base.width = w;
      base.height = h;
      const layer = base.getContext("2d");
      if (!layer) return;
      layer.drawImage(img, 0, 0, w, h);
      paintLines(layer, fuga, scale, "rgba(28,25,23,0.28)", 1);
      baseRef.current = base;
      bundleRef.current = {
        f18: take(fuga, 18, 5),
        f18t: take(fuga, 18, 2.5),
        f108: take(fuga, 108, 5),
        f108t: take(fuga, 108, 2.5),
        a81: take(atlo, 81, 7),
        a81t: take(atlo, 81, 4),
        a138: take(atlo, 138, 7),
      };
    }
    ctx.drawImage(baseRef.current, 0, 0);
    const bundle = bundleRef.current;
    const show18 = ["fuga", "atlo", "near18", "end"].includes(id);
    const show108 = ["fuga", "atlo", "gap", "on108", "on81", "middle", "far", "near108", "end"].includes(id);
    const show81 = ["atlo", "gap", "on108", "on81", "middle", "far", "near81", "end"].includes(id);
    const show138 = ["atlo", "end"].includes(id);
    if (show18) paintLines(ctx, id === "near18" ? bundle.f18t : bundle.f18, scale, FUGA, id === "near18" ? 4 : 2.5);
    if (show108) paintLines(ctx, id === "near108" ? bundle.f108t : bundle.f108, scale, FUGA, id === "near108" || id === "on108" ? 4 : 2.5);
    if (show138) paintLines(ctx, bundle.a138, scale, "#a78bfa", 2);
    if (show81) paintLines(ctx, id === "near81" ? bundle.a81t : bundle.a81, scale, ATLO, id === "on81" || id === "near81" ? 3.5 : 2.5);
    let hand: number | null = null;
    if (id === "on108" || id === "near108") hand = 108;
    if (id === "on81" || id === "near81") hand = 81;
    if (id === "near18") hand = 18;
    if (id === "middle") hand = 81 + (94.5 - 81) * smooth(Math.min(1, progress / 0.72));
    if (id === "far") hand = 275;
    if (id === "end") hand = 94.5;
    if (hand !== null) drawSpoke(ctx, w, h, hand, "rgba(180,35,24,0.85)", 3);
    const spokes = [
      ...(show18 ? [18] : []),
      ...(show108 ? [108] : []),
      ...(show81 ? [81] : []),
      ...(show138 ? [138] : []),
      ...(id === "far" ? [288, 261] : []),
    ];
    drawCompass(ctx, w, h, spokes, id === "gap" || id === "middle" || id === "end", hand);
    if (id === "middle" && hand !== null) {
      ctx.font = "700 28px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const fugaGap = Math.abs(108 - hand);
      const atloGap = Math.abs(hand - 81);
      ctx.fillStyle = "rgba(255,252,245,0.9)";
      ctx.fillRect(16, 16, 280, 78);
      ctx.fillStyle = "#1c1917";
      ctx.fillText(`hézag ${fugaGap.toFixed(1).replace(".", ",")}°`, 28, 24);
      ctx.fillText(`átló ${atloGap.toFixed(1).replace(".", ",")}°`, 28, 58);
    }
    if (id === "end") {
      ctx.font = "700 26px sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,252,245,0.9)";
      ctx.fillRect(16, 16, 360, 44);
      ctx.fillStyle = ARRIVE;
      ctx.fillText("két nyaláb, a nyíl középen", 28, 46);
    }
  }

  function jump(next: number) {
    indexRef.current = next;
    accRef.current = 0;
    playingRef.current = true;
    setIndex(next);
    setPlaying(true);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-stone-300 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-4 py-3">
        <h2 className="text-lg font-semibold">Ugyanez a padlóra vetítve</h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          A sárga a hézag, a lila az átló, a piros az egyetlen érkezés. A kör északkal van tájolva, a kép teteje észak.
        </p>
      </div>
      <canvas ref={canvasRef} className="w-full bg-[#f4efe6]" />
      <div className="min-h-28 border-t border-stone-200 px-4 py-4">
        {lines.map((line) => (
          <p key={line} className="text-base leading-7 text-stone-900">
            {line}
          </p>
        ))}
        {!ready ? <p className="text-sm text-stone-500">A padló betöltése…</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            playingRef.current = !playingRef.current;
            setPlaying(playingRef.current);
          }}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white"
        >
          {playing ? "Megállítás" : "Indítás"}
        </button>
        <button type="button" onClick={() => jump(0)} className="rounded-lg border border-stone-900 px-4 py-2 text-sm font-semibold">
          Újra
        </button>
        <a href="/padlo-13-5.mp4" download="padlo-13-5-fok.mp4" className="rounded-lg border border-stone-900 px-4 py-2 text-sm font-semibold">
          Videó letöltése
        </a>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {STEPS.map((step, stepIndex) => (
          <button
            key={step.id}
            type="button"
            onClick={() => jump(stepIndex)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${stepIndex === index ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700"}`}
          >
            {stepIndex + 1}. {step.label}
          </button>
        ))}
      </div>
    </section>
  );
}
