import { julianDayNoon, moonPhase } from "../lib/solar-system";

const MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
const LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function julianMonthLengths(astro: number) {
  const lengths = LENGTHS.slice();
  if (astro % 4 === 0) lengths[1] = 29;
  return lengths;
}

export function yearDayCount(astro: number) {
  return julianMonthLengths(astro).reduce((sum, days) => sum + days, 0);
}

export function dayOfYear(astro: number, month: number, day: number) {
  const lengths = julianMonthLengths(astro);
  const safeMonth = Math.min(12, Math.max(1, month));
  const safeDay = Math.min(lengths[safeMonth - 1], Math.max(1, day));
  let count = safeDay - 1;
  for (let index = 0; index < safeMonth - 1; index += 1) count += lengths[index];
  return count;
}

export function dateFromYearDay(astro: number, index: number) {
  const lengths = julianMonthLengths(astro);
  const total = yearDayCount(astro);
  let cursor = ((Math.floor(index) % total) + total) % total;
  for (let month = 0; month < 12; month += 1) {
    if (cursor < lengths[month]) return { month: month + 1, day: cursor + 1 };
    cursor -= lengths[month];
  }
  return { month: 12, day: lengths[11] };
}

export function paintMoonDisc(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, phase: number) {
  const turn = ((phase % 1) + 1) % 1;
  const tilt = Math.cos(turn * Math.PI * 2);
  const right: { x: number; y: number }[] = [];
  const left: { x: number; y: number }[] = [];
  for (let step = 0; step <= 48; step += 1) {
    const ny = -1 + (2 * step) / 48;
    const limb = Math.sqrt(Math.max(0, 1 - ny * ny));
    const term = tilt * limb;
    const litFrom = turn <= 0.5 ? Math.max(-limb, term) : -limb;
    const litTo = turn <= 0.5 ? limb : Math.min(limb, -term);
    if (litTo - litFrom < 0.02) continue;
    right.push({ x: x + litTo * radius, y: y + ny * radius });
    left.push({ x: x + litFrom * radius, y: y + ny * radius });
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20,16,12,0.28)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#241f1a";
  ctx.fill();
  const shape = [...right, ...left.reverse()];
  if (shape.length > 2) {
    ctx.beginPath();
    ctx.moveTo(shape[0].x, shape[0].y);
    for (const point of shape) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fillStyle = "#f4e2b0";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,248,230,0.9)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function paintMoonFacing(ctx: CanvasRenderingContext2D, radius: number, elongation: number) {
  const turn = ((elongation % 360) + 360) % 360;
  const tilt = Math.cos((turn * Math.PI) / 180);
  const right: { x: number; y: number }[] = [];
  const left: { x: number; y: number }[] = [];
  for (let step = 0; step <= 48; step += 1) {
    const ny = -1 + (2 * step) / 48;
    const limb = Math.sqrt(Math.max(0, 1 - ny * ny));
    const litFrom = Math.max(-limb, tilt * limb);
    const litTo = limb;
    if (litTo - litFrom < 0.02) continue;
    right.push({ x: litTo * radius, y: ny * radius });
    left.push({ x: litFrom * radius, y: ny * radius });
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius + 8, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20,16,12,0.28)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#241f1a";
  ctx.fill();
  const shape = [...right, ...left.reverse()];
  if (shape.length > 2) {
    ctx.beginPath();
    ctx.moveTo(shape[0].x, shape[0].y);
    for (const point of shape) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fillStyle = "#f4e2b0";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,248,230,0.9)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function paintMoonOrbit(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sky: { elongation: number; sunAz: number; sunAlt: number; moonAz: number; moonAlt: number },
  caption: string,
) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.045;
  const horizon = Math.min(w * 0.22, h * 0.16, 220);
  const place = (azimuth: number, altitude: number) => {
    const reach = (Math.min(125, Math.max(0, 90 - altitude)) / 90) * horizon;
    const ang = ((azimuth - 90) * Math.PI) / 180;
    return { x: cx + Math.cos(ang) * reach, y: cy + Math.sin(ang) * reach, up: altitude >= 0 };
  };
  const sun = place(sky.sunAz, sky.sunAlt);
  const moon = place(sky.moonAz, sky.moonAlt);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, horizon, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(28,25,23,0.8)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(sun.x, sun.y);
  ctx.moveTo(cx, cy);
  ctx.lineTo(moon.x, moon.y);
  ctx.strokeStyle = "rgba(28,25,23,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = "700 16px sans-serif";
  ctx.fillStyle = "#1c1917";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("horizont", cx + 8, cy - horizon + 18);
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, radius * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = sun.up ? "#e6a100" : "rgba(230,161,0,0.45)";
  ctx.fill();
  const out = Math.hypot(sun.x - cx, sun.y - cy);
  const ux = out < 8 ? 1 : (sun.x - cx) / out;
  const uy = out < 8 ? 0 : (sun.y - cy) / out;
  ctx.font = "700 18px sans-serif";
  ctx.fillStyle = "#1c1917";
  ctx.textAlign = ux >= 0 ? "left" : "right";
  ctx.textBaseline = "middle";
  ctx.fillText("Nap", sun.x + ux * radius * 0.9, sun.y + uy * radius * 0.9);
  ctx.restore();
  let dx = sun.x - moon.x;
  let dy = sun.y - moon.y;
  if (dx * dx + dy * dy < 9) {
    dx = 1;
    dy = 0;
  }
  ctx.save();
  ctx.translate(moon.x, moon.y);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.globalAlpha = moon.up ? 1 : 0.45;
  paintMoonFacing(ctx, radius, sky.elongation);
  ctx.restore();
  const full = `${caption} · helyi dél · Hold ${Math.round(sky.moonAlt)}° · Nap ${Math.round(sky.sunAlt)}°`;
  ctx.font = "700 22px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const width = ctx.measureText(full).width;
  const labelY = Math.min(h - 42, cy + horizon + radius + 18);
  ctx.fillStyle = "rgba(255,252,245,0.9)";
  ctx.fillRect(cx - width / 2 - 14, labelY, width + 28, 36);
  ctx.fillStyle = "#1c1917";
  ctx.fillText(full, cx, labelY + 6);
  ctx.textAlign = "left";
}

const PHASE_COLOR: Record<string, string> = {
  "újhold": "#1c1917",
  "növekvő sarló": "#d6b07a",
  "első negyed": "#e6a100",
  "növekvő hold": "#f6e7c1",
  "telehold": "#fffaf0",
  "fogyó hold": "#bfdbfe",
  "utolsó negyed": "#64748b",
  "fogyó sarló": "#475569",
};
const PHASE_MARK: Record<string, string> = {
  "újhold": "Ú",
  "első negyed": "1",
  "telehold": "T",
  "utolsó negyed": "3",
};
const MONTH_SHORT = ["jan", "feb", "már", "ápr", "máj", "jún", "júl", "aug", "sze", "okt", "nov", "dec"];

type YearRing = { total: number; names: string[]; months: { name: string; start: number; days: number }[] };
const yearRings = new Map<number, YearRing>();

function yearRing(astro: number): YearRing {
  const cached = yearRings.get(astro);
  if (cached) return cached;
  const lengths = julianMonthLengths(astro);
  const names: string[] = [];
  const months: YearRing["months"] = [];
  let start = 0;
  lengths.forEach((days, index) => {
    months.push({ name: MONTH_SHORT[index], start, days });
    for (let day = 1; day <= days; day += 1) names.push(moonPhase(julianDayNoon(astro, index + 1, day)).name);
    start += days;
  });
  const ring = { total: start, names, months };
  yearRings.set(astro, ring);
  return ring;
}

/** Egész éves gyűrű: nagyobb, mint a napi körcikk. Hónapokra osztva, a holdfázis színeivel. */
export function paintYearArc(ctx: CanvasRenderingContext2D, w: number, h: number, astro: number, markIndex: number) {
  const ring = yearRing(astro);
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.min(w, h) * 0.48;
  const inner = Math.min(w, h) * 0.4;
  const ang = (day: number) => -Math.PI / 2 + (day / ring.total) * Math.PI * 2;
  const slice = (from: number, to: number) => {
    ctx.beginPath();
    ctx.arc(cx, cy, outer, ang(from), ang(to));
    ctx.arc(cx, cy, inner, ang(to), ang(from), true);
    ctx.closePath();
  };
  ctx.save();
  let run = 0;
  for (let index = 1; index <= ring.names.length; index += 1) {
    if (index < ring.names.length && ring.names[index] === ring.names[run]) continue;
    ctx.fillStyle = PHASE_COLOR[ring.names[run]] ?? "#a8a29e";
    slice(run, index);
    ctx.fill();
    run = index;
  }
  ctx.strokeStyle = "rgba(28,25,23,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,252,245,0.9)";
  ctx.font = "700 15px sans-serif";
  ctx.textBaseline = "middle";
  for (const month of ring.months) {
    const edge = ang(month.start);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(edge) * inner, cy + Math.sin(edge) * inner);
    ctx.lineTo(cx + Math.cos(edge) * outer, cy + Math.sin(edge) * outer);
    ctx.stroke();
    const mid = ang(month.start + month.days / 2);
    const lx = cx + Math.cos(mid) * (outer + 18);
    const ly = cy + Math.sin(mid) * (outer + 18);
    ctx.textAlign = Math.cos(mid) > 0.25 ? "left" : Math.cos(mid) < -0.25 ? "right" : "center";
    ctx.fillStyle = "rgba(255,252,245,0.92)";
    const width = ctx.measureText(month.name).width;
    ctx.fillRect(lx - (ctx.textAlign === "left" ? 0 : ctx.textAlign === "right" ? width : width / 2) - 3, ly - 10, width + 6, 20);
    ctx.fillStyle = "#1c1917";
    ctx.fillText(month.name, lx, ly);
  }
  ctx.font = "700 13px sans-serif";
  ctx.textAlign = "center";
  run = 0;
  for (let index = 1; index <= ring.names.length; index += 1) {
    if (index < ring.names.length && ring.names[index] === ring.names[run]) continue;
    const mark = PHASE_MARK[ring.names[run]];
    if (mark) {
      const mid = ang(run + (index - run) / 2);
      const mx = cx + Math.cos(mid) * ((inner + outer) / 2);
      const my = cy + Math.sin(mid) * ((inner + outer) / 2);
      ctx.fillStyle = ring.names[run] === "újhold" ? "#f4e2b0" : "#1c1917";
      ctx.fillText(mark, mx, my);
    }
    run = index;
  }
  const cursor = ((Math.floor(markIndex) % ring.total) + ring.total) % ring.total;
  const here = ang(cursor + 0.5);
  ctx.strokeStyle = "#9a3412";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(here) * (inner - 8), cy + Math.sin(here) * (inner - 8));
  ctx.lineTo(cx + Math.cos(here) * (outer + 8), cy + Math.sin(here) * (outer + 8));
  ctx.stroke();
  const legend = ["újhold", "növekvő sarló", "első negyed", "növekvő hold", "telehold", "fogyó hold", "utolsó negyed", "fogyó sarló"];
  ctx.font = "700 13px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let x = 16;
  let y = 22;
  for (const name of legend) {
    const width = ctx.measureText(name).width + 28;
    if (x + width > w - 12) {
      x = 16;
      y += 22;
    }
    ctx.fillStyle = PHASE_COLOR[name];
    ctx.fillRect(x, y - 7, 14, 14);
    ctx.strokeStyle = "#1c1917";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y - 7, 14, 14);
    ctx.fillStyle = "#1c1917";
    ctx.fillText(name, x + 18, y);
    x += width;
  }
  ctx.restore();
}

export const MOON_MONTHS = MONTHS;

function MoonIcon({ phase, size }: { phase: number; size: number }) {
  const right: string[] = [];
  const left: string[] = [];
  const steps = 28;
  const turn = ((phase % 1) + 1) % 1;
  const ang = Math.cos(turn * Math.PI * 2);
  for (let step = 0; step <= steps; step += 1) {
    const y = -1 + (2 * step) / steps;
    const limb = Math.sqrt(Math.max(0, 1 - y * y));
    const term = ang * limb;
    const litFrom = turn <= 0.5 ? Math.max(-limb, term) : -limb;
    const litTo = turn <= 0.5 ? limb : Math.min(limb, -term);
    if (litTo - litFrom < 0.02) continue;
    right.push(`${(litTo * 10).toFixed(2)},${(y * 10).toFixed(2)}`);
    left.push(`${(litFrom * 10).toFixed(2)},${(y * 10).toFixed(2)}`);
  }
  const points = [...right, ...left.reverse()].join(" ");
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      <circle r="10" fill="#241f1a" />
      {points ? <polygon points={points} fill="#f4e2b0" /> : null}
    </svg>
  );
}

export function MoonYear({
  era,
  yearText,
  month,
  day,
  onPick,
}: {
  era: "ie" | "isz";
  yearText: string;
  month: number;
  day: number;
  onPick: (month: number, day: number) => void;
}) {
  const year = Number(yearText.replace(",", "."));
  const astro = Number.isInteger(year) && year >= 1 ? (era === "ie" ? 1 - year : year) : null;
  if (astro === null) {
    return <p className="px-4 py-3 text-sm text-stone-600">Adj meg egy évet az Idő mezőben.</p>;
  }
  const lengths = julianMonthLengths(astro);
  const days = lengths.flatMap((count, index) =>
    Array.from({ length: count }, (_, dayIndex) => {
      const date = dayIndex + 1;
      const phase = moonPhase(julianDayNoon(astro, index + 1, date));
      return { month: index + 1, day: date, phase };
    }),
  );
  const current = days.find((item) => item.month === month && item.day === day) ?? days[0];
  return (
    <div className="space-y-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
      <p className="text-sm font-medium">
        {era === "ie" ? "i. e." : "i. sz."} {year}. · julián naptár
      </p>
      <p className="flex items-center gap-2 text-sm text-stone-700">
        <MoonIcon phase={current.phase.elongation / 360} size={36} />
        <span>
          {MONTHS[current.month - 1]} {current.day}. · {current.phase.name} · {Math.round(current.phase.fraction * 100)}% megvilágítva
        </span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {MONTHS.map((name, index) => (
          <div key={name}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{name}</p>
            <div className="flex flex-wrap gap-1">
              {days
                .filter((item) => item.month === index + 1)
                .map((item) => {
                  const picked = item.month === month && item.day === day;
                  return (
                    <button
                      key={item.day}
                      type="button"
                      title={`${name} ${item.day}. · ${item.phase.name}`}
                      onClick={() => onPick(item.month, item.day)}
                      className={`flex w-8 flex-col items-center rounded ${picked ? "bg-stone-900 text-white" : "hover:bg-stone-200"}`}
                    >
                      <MoonIcon phase={item.phase.elongation / 360} size={22} />
                      <span className="pb-0.5 text-[10px] leading-none">{item.day}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-stone-500">Jobbra világosodik az újholdtól a teleholdig, utána balról fogy. A napra kattintva az idő arra a napra áll.</p>
    </div>
  );
}
