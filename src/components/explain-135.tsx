import { useEffect, useRef, useState } from "react";

type Step = {
  id: string;
  label: string;
  seconds: number;
  lines: string[];
};

const STEPS: Step[] = [
  {
    id: "stones",
    label: "Két vonal",
    seconds: 8,
    lines: [
      "A padlón kétféle vonal van.",
      "A fuga a kövek közötti hézag. Az átló a kő belsejében fut, saroktól sarokig.",
    ],
  },
  {
    id: "fuga",
    label: "Hézagok",
    seconds: 8,
    lines: [
      "A hézagok nem állnak összevissza. Két irányba sűrűsödnek: 18° és 108°.",
      "A 0° észak, a 90° kelet. A vonalnak nincs eleje és vége: oda-vissza ugyanaz.",
    ],
  },
  {
    id: "atlo",
    label: "Átlók",
    seconds: 8,
    lines: [
      "Az átlók máshova sűrűsödnek: 81° és 138°.",
      "Sárga a hézag. Lila a kő belseje. Két külön család.",
    ],
  },
  {
    id: "gap",
    label: "27 fok",
    seconds: 7,
    lines: [
      "A két család itt van a legközelebb egymáshoz: a 108°-os hézag és a 81°-os átló.",
      "Közöttük 27 fok van. Ez a kiinduló szám.",
    ],
  },
  {
    id: "houses",
    label: "Egy hely",
    seconds: 8,
    lines: [
      "Egy érkezés csak egy helyen állhat. Két ház 27 lépésre van egymástól.",
      "A közepén mindkettőtől 13 és fél lépésre vagy. Közelebb az egyikhez csak úgy mehetsz, ha a másiktól távolodsz.",
    ],
  },
  {
    id: "on108",
    label: "A hézagon",
    seconds: 7,
    lines: [
      "Ha az érkezés pontosan a 108°-os hézagra ül, azt eltalálja.",
      "Az átlótól viszont 27 fokra marad. Az egyik jó, a másik nem.",
    ],
  },
  {
    id: "on81",
    label: "Az átlón",
    seconds: 7,
    lines: [
      "Ha az átlóra ül, 81°-ra, akkor az átló a pontos.",
      "A hézagtól marad 27 fokra. A másik választás, ugyanaz a gond.",
    ],
  },
  {
    id: "middle",
    label: "13,5 fok",
    seconds: 9,
    lines: [
      "A legkisebb közös tévedés a kettő között van.",
      "(108 − 81) / 2 = 13,5°. Itt mindkét vonal ugyanannyira van messze. Közelebb egyszerre nem lehet menni. Ez nem mérési hiba, hanem a 27 fok fele.",
    ],
  },
  {
    id: "taurid",
    label: "A túloldal",
    seconds: 8,
    lines: [
      "Ugyanez a két vonal a kör túlsó felén is megvan: 288° és 261°. A közepe 275°.",
      "A Tauridák meteorrajának nyugvása i. e. 1766-ban erre a felezőre esik. Ez a határ, nem egy külön találat.",
    ],
  },
  {
    id: "single",
    label: "Külön nézve",
    seconds: 12,
    lines: [
      "Ha nem kérjük, hogy egy irány mindkét vonalat eltalálja, a templom korában sokkal közelebbi egyezés is van.",
      "A Delta Aquaridák kelése 0,6°-ra van a 108°-os hézagtól.",
      "A Perseidák kelése 0,6°-ra van a 18°-os hézagtól.",
      "Az Orionidák nyugvása 0,1°-ra van a 108°-os vonaltól.",
      "A Tauridák kelése 0,5°-ra van a 81°-os átlótól.",
    ],
  },
  {
    id: "end",
    label: "Jelentősége",
    seconds: 14,
    lines: [
      "Mit jelent ez?",
      "A padló két irányt őriz, nem egyet. Egy meteorraj, egy csillag kelése, egyetlen nyíl csak az egyiket találhatja el pontosan.",
      "A 13,5 fok nem titkos dátum és nem mérési hiba. Azt a határt mondja meg, ameddig egy irány eljuthat, ha mindkét vonalat egyszerre akarná magyarázni.",
      "Aki az egész padlót egy nyíllal szeretné megfejteni, ezen a határon megáll. Külön-külön viszont mindkét irány mellé odaáll egy meteorraj a templom korában, egy fokon belül.",
    ],
  },
];

const FUGA = "#c4880a";
const ATLO = "#6d28d9";
const INK = "#1c1917";
const ARRIVE = "#b42318";

function smooth(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function point(cx: number, cy: number, radius: number, degree: number) {
  const angle = ((degree - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function lineThrough(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, degree: number, color: string, width: number) {
  const [x1, y1] = point(cx, cy, radius, degree);
  const [x2, y2] = point(cx, cy, radius, degree + 180);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
}

function tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  ctx.font = "700 28px sans-serif";
  const width = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(255,252,245,0.92)";
  ctx.fillRect(x - width / 2 - 10, y - 20, width + 20, 36);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function dial(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,252,245,0.55)";
  ctx.fill();
  ctx.strokeStyle = "rgba(15,60,90,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = "rgba(15,60,90,0.18)";
  ctx.lineWidth = 1;
  for (let degree = 0; degree < 360; degree += 30) {
    const [x1, y1] = point(cx, cy, radius - 8, degree);
    const [x2, y2] = point(cx, cy, radius, degree);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.fillStyle = "#0f3c5a";
  ctx.font = "700 26px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const marks: [string, number, number, number][] = [
    ["É", 0, 0, -1],
    ["K", 90, 1, 0],
    ["D", 180, 0, 1],
    ["Ny", 270, -1, 0],
  ];
  for (const [name, degree, dx, dy] of marks) {
    const [x, y] = point(cx, cy, radius + 28, degree);
    ctx.fillText(name, x + dx * 6, y + dy * 4);
  }
}

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, degree: number) {
  const [x, y] = point(cx, cy, radius, degree);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(x, y);
  ctx.strokeStyle = ARRIVE;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fillStyle = ARRIVE;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
}

function stone(ctx: CanvasRenderingContext2D, pts: number[][], fill: string) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const item of pts.slice(1)) ctx.lineTo(item[0], item[1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "#44403c";
  ctx.lineWidth = 4;
  ctx.stroke();
}

function drawStones(ctx: CanvasRenderingContext2D, p: number) {
  stone(ctx, [[70, 150], [250, 130], [280, 330], [90, 360]], "#efe4cf");
  stone(ctx, [[310, 140], [540, 125], [560, 340], [330, 325]], "#e7f0dc");
  stone(ctx, [[150, 390], [400, 370], [430, 560], [130, 575]], "#efe4cf");
  const showGap = smooth(p / 0.45);
  const showDiag = smooth((p - 0.35) / 0.45);
  ctx.globalAlpha = showGap;
  ctx.beginPath();
  ctx.moveTo(292, 145);
  ctx.lineTo(312, 332);
  ctx.strokeStyle = FUGA;
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.stroke();
  tag(ctx, 250, 250, "fuga", FUGA);
  ctx.globalAlpha = showDiag;
  ctx.beginPath();
  ctx.moveTo(330, 160);
  ctx.lineTo(540, 320);
  ctx.strokeStyle = ATLO;
  ctx.lineWidth = 8;
  ctx.stroke();
  tag(ctx, 470, 210, "átló", ATLO);
  ctx.globalAlpha = 1;
  ctx.fillStyle = INK;
  ctx.font = "600 30px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("hézag a kövek között", 620, 230);
  ctx.fillText("vonal a kő belsejében", 620, 290);
}

function drawDialScene(ctx: CanvasRenderingContext2D, id: string, p: number) {
  const side = ["on108", "on81", "middle", "taurid", "single", "end"].includes(id);
  const cx = side ? 300 : 500;
  const cy = 310;
  const radius = side ? 175 : 200;
  dial(ctx, cx, cy, radius);
  const fugaOn = id !== "houses";
  const atloOn = !["fuga", "houses"].includes(id);
  const dimOthers = ["gap", "on108", "on81", "middle", "taurid", "single", "end"].includes(id);
  const quiet = ["single", "end"].includes(id);
  if (fugaOn) {
    lineThrough(ctx, cx, cy, radius - 16, 18, dimOthers ? "rgba(196,136,10,0.25)" : FUGA, dimOthers ? 6 : 10);
    lineThrough(ctx, cx, cy, radius - 16, 108, FUGA, 12);
    if (!dimOthers && !quiet) {
      const [x, y] = point(cx, cy, radius + 8, 18);
      tag(ctx, x, y - 36, "18°", FUGA);
    }
    const [x108, y108] = point(cx, cy, radius + 6, 108);
    if ((id === "fuga" || id === "atlo") && !quiet) tag(ctx, x108 + 20, y108, "108°", FUGA);
  }
  if (atloOn) {
    lineThrough(ctx, cx, cy, radius - 16, 138, dimOthers ? "rgba(109,40,217,0.22)" : ATLO, dimOthers ? 6 : 10);
    lineThrough(ctx, cx, cy, radius - 16, 81, ATLO, 12);
    if (!dimOthers && !quiet) {
      const [x, y] = point(cx, cy, radius + 10, 81);
      tag(ctx, x - 10, y, "81°", ATLO);
      const [x2, y2] = point(cx, cy, radius + 8, 138);
      tag(ctx, x2, y2 + 28, "138°", ATLO);
    }
  }
  if (id === "gap" || id === "middle" || id === "on108" || id === "on81") {
    ctx.beginPath();
    const start = ((81 - 90) * Math.PI) / 180;
    const end = ((108 - 90) * Math.PI) / 180;
    ctx.arc(cx, cy, radius + 24, start, end);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.stroke();
    tag(ctx, cx + 150, cy - 150, "27°", INK);
  }
  if (id === "on108") {
    arrow(ctx, cx, cy, radius - 28, 108);
    tag(ctx, 800, 150, "hézag: 0°", FUGA);
    tag(ctx, 800, 210, "átló: 27°", ATLO);
  }
  if (id === "on81") {
    arrow(ctx, cx, cy, radius - 28, 81);
    tag(ctx, 800, 150, "átló: 0°", ATLO);
    tag(ctx, 800, 210, "hézag: 27°", FUGA);
  }
  if (id === "middle") {
    const degree = 81 + (94.5 - 81) * smooth(Math.min(1, p / 0.7));
    arrow(ctx, cx, cy, radius - 28, degree);
    const fugaGap = Math.abs(108 - degree);
    const atloGap = Math.abs(degree - 81);
    tag(ctx, 800, 150, `hézag: ${fugaGap.toFixed(1).replace(".", ",")}°`, FUGA);
    tag(ctx, 800, 210, `átló: ${atloGap.toFixed(1).replace(".", ",")}°`, ATLO);
    if (p > 0.62) {
      ctx.fillStyle = INK;
      ctx.font = "700 42px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("(108 − 81) / 2", 690, 320);
      ctx.fillStyle = ARRIVE;
      ctx.fillText("= 13,5°", 690, 380);
    }
  }
  if (id === "taurid") {
    lineThrough(ctx, cx, cy, radius - 16, 108, "rgba(196,136,10,0.25)", 6);
    lineThrough(ctx, cx, cy, radius - 16, 81, "rgba(109,40,217,0.22)", 6);
    lineThrough(ctx, cx, cy, radius - 16, 288, FUGA, 12);
    lineThrough(ctx, cx, cy, radius - 16, 261, ATLO, 12);
    arrow(ctx, cx, cy, radius - 28, 275);
    tag(ctx, 780, 250, "275°", ARRIVE);
    tag(ctx, 780, 310, "Tauridák", INK);
  }
  if (id === "single") {
    const rows = [
      ["Delta Aquaridák kelése", "0,6° a 108°-os hézagtól", FUGA],
      ["Perseidák kelése", "0,6° a 18°-os hézagtól", FUGA],
      ["Orionidák nyugvása", "0,1° a 108°-os vonaltól", FUGA],
      ["Tauridák kelése", "0,5° a 81°-os átlótól", ATLO],
    ];
    rows.forEach((row, index) => {
      const appear = smooth((p * rows.length - index) / 0.7);
      ctx.globalAlpha = appear;
      ctx.fillStyle = row[2];
      ctx.fillRect(690, 120 + index * 100, 14, 64);
      ctx.fillStyle = INK;
      ctx.font = "700 26px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(row[0], 720, 140 + index * 100);
      ctx.font = "500 24px sans-serif";
      ctx.fillText(row[1], 720, 174 + index * 100);
      ctx.globalAlpha = 1;
    });
  }
  if (id === "end") {
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "700 40px sans-serif";
    ctx.fillText("Két irány, egy nyíl.", 540, 140);
    ctx.font = "500 28px sans-serif";
    const sentences = [
      "Egy nyíl csak egy irányba mutat.",
      "A két vonal 27 fokra van.",
      "A közös határ a fele: 13,5°.",
      "Ez a padló határa, nem egy dátum.",
    ];
    sentences.forEach((sentence, index) => {
      ctx.globalAlpha = smooth((p * sentences.length - index) / 0.8);
      ctx.fillText(sentence, 540, 220 + index * 70);
    });
    ctx.globalAlpha = 1;
    arrow(ctx, cx, cy, radius - 24, 94.5);
  }
}

function drawHouses(ctx: CanvasRenderingContext2D, p: number) {
  const left = 180;
  const right = 760;
  const y = 300;
  const person = left + (right - left) * 0.5 * smooth(Math.min(1, p / 0.75));
  ctx.strokeStyle = "#d6d3d1";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(left, y + 80);
  ctx.lineTo(right, y + 80);
  ctx.stroke();
  ctx.fillStyle = FUGA;
  ctx.fillRect(left - 70, y - 40, 140, 110);
  ctx.fillStyle = ATLO;
  ctx.fillRect(right - 70, y - 40, 140, 110);
  tag(ctx, left, y - 80, "hézag", FUGA);
  tag(ctx, right, y - 80, "átló", ATLO);
  tag(ctx, (left + right) / 2, y + 140, "27 lépés", INK);
  ctx.beginPath();
  ctx.arc(person, y + 40, 22, 0, Math.PI * 2);
  ctx.fillStyle = ARRIVE;
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "700 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("1", person, y + 41);
  if (p > 0.55) tag(ctx, person, y - 10, "13,5 és 13,5", ARRIVE);
}

function paintStep(ctx: CanvasRenderingContext2D, id: string, p: number) {
  ctx.fillStyle = "#f4efe6";
  ctx.fillRect(0, 0, 1000, 620);
  if (id === "stones") drawStones(ctx, p);
  else if (id === "houses") drawHouses(ctx, p);
  else drawDialScene(ctx, id, p);
}

function shownLines(step: Step, progress: number) {
  const count = Math.max(1, Math.ceil(Math.min(1, progress) * step.lines.length));
  return step.lines.slice(0, count);
}

export function Explain135() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const indexRef = useRef(0);
  const accRef = useRef(0);
  const playingRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lines, setLines] = useState(STEPS[0].lines.slice(0, 1));
  const lineHold = useRef(lines.join("\n"));

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const step = STEPS[indexRef.current];
      if (playingRef.current) {
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
      const nextLines = shownLines(current, progress);
      const signature = nextLines.join("\n");
      if (signature !== lineHold.current) {
        lineHold.current = signature;
        setLines(nextLines);
      }
      const canvas = canvasRef.current;
      if (canvas) {
        const cssW = canvas.clientWidth || 1000;
        const cssH = canvas.clientHeight || 620;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const nextW = Math.max(1, Math.round(cssW * dpr));
        const nextH = Math.max(1, Math.round(cssH * dpr));
        if (canvas.width !== nextW || canvas.height !== nextH) {
          canvas.width = nextW;
          canvas.height = nextH;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const scale = Math.min(cssW / 1000, cssH / 620);
          ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (cssW - 1000 * scale) / 2, dpr * (cssH - 620 * scale) / 2);
          ctx.clearRect(-100, -100, 1200, 800);
          paintStep(ctx, current.id, progress);
        }
      }
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);

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
        <h2 className="text-lg font-semibold">Miért nem lehet 13,5 foknál közelebb?</h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          Külön animáció erről a magyarázatról. Két vonal 27 fokra áll egymástól. Egy érkezés csak egy helyen lehet, ezért a közös eltérés fele ennyi, 13,5 fok.
        </p>
      </div>
      <canvas ref={canvasRef} className="aspect-[1000/620] w-full bg-[#f4efe6]" />
      <div className="min-h-28 border-t border-stone-200 px-4 py-4">
        {lines.map((line) => (
          <p key={line} className="text-base leading-7 text-stone-900">
            {line}
          </p>
        ))}
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
        <a href="/miert-13-5.mp4" download="miert-13-5-fok.mp4" className="rounded-lg border border-stone-900 px-4 py-2 text-sm font-semibold">
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
      <details className="border-t border-stone-200">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Ugyanez videón, ha a rajz nem indul</summary>
        <video src="/miert-13-5.mp4" controls preload="metadata" className="w-full bg-black" />
      </details>
    </section>
  );
}
