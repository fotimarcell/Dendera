import { useEffect, useRef, useState } from "react";

type Line = [number, number, number, number, number];
type Era = "ie" | "isz";

const LAT = (26.1417 * Math.PI) / 180;
const FUGA_PEAKS = [18, 108];
const ATLO_PEAKS = [81, 138];
const MONTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAME = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];

const SHOWERS = [
  { id: "met-lyr", nev: "Lyridák", color: "#0f766e", lam0: 273.427, beta: 56.639, dlam: 0, sunLon: 32.3, window: 6 },
  { id: "met-eta", nev: "Éta Aquaridák", color: "#0369a1", lam0: 338.933, beta: 7.696, dlam: 0, sunLon: 45.5, window: 8 },
  { id: "met-sda", nev: "Delta Aquaridák", color: "#1d4ed8", lam0: 335.329, beta: -7.488, dlam: 0, sunLon: 125.6, window: 10 },
  { id: "met-per", nev: "Perseidák", color: "#b45309", lam0: 63.631, beta: 38.362, dlam: 0, sunLon: 140, window: 8 },
  { id: "met-ori", nev: "Orionidák", color: "#9a3412", lam0: 95.87, beta: -7.557, dlam: 0, sunLon: 208, window: 8 },
  { id: "met-tau", nev: "Tauridák", color: "#a16207", lam0: 49.821, beta: -4.911, dlam: 0.75, sunLon: 223, window: 18 },
  { id: "met-leo", nev: "Leonidák", color: "#be123c", lam0: 148.025, beta: 10.225, dlam: 1.52, sunLon: 235.3, window: 6 },
  { id: "met-gem", nev: "Geminidák", color: "#6d28d9", lam0: 110.195, beta: 10.466, dlam: -1.57, sunLon: 262.2, window: 6 },
];

const PRESETS = [
  { id: "sda", label: "Delta Aquaridák, i. e. 54", era: "ie" as Era, year: "54", month: "8", day: "2", shower: "met-sda" },
  { id: "per", label: "Perseidák, i. e. 54", era: "ie" as Era, year: "54", month: "8", day: "17", shower: "met-per" },
  { id: "ori", label: "Orionidák, i. e. 54", era: "ie" as Era, year: "54", month: "10", day: "24", shower: "met-ori" },
  { id: "tau", label: "Tauridák, i. e. 54", era: "ie" as Era, year: "54", month: "10", day: "24", shower: "met-tau" },
  { id: "tau2", label: "Tauridák, i. e. 1766", era: "ie" as Era, year: "1766", month: "10", day: "24", shower: "met-tau" },
];

type DateParts = { era: Era; year: number; month: number; day: number };
type SkyBody = {
  id: string;
  nev: string;
  color: string;
  alt: number;
  az: number;
  lit: boolean;
  rise: number | null;
  set: number | null;
};

function wrap360(value: number) {
  return ((value % 360) + 360) % 360;
}

function lonGap(a: number, b: number) {
  return Math.abs(wrap360(a - b + 180) - 180);
}

function orientGap(line: number, azimuth: number) {
  const a = ((line % 180) + 180) % 180;
  const b = ((azimuth % 180) + 180) % 180;
  const diff = Math.abs(a - b);
  return Math.min(diff, 180 - diff);
}

function hu(value: number, digits = 1) {
  return value.toFixed(digits).replace(".", ",");
}

function compassRadians(degrees: number) {
  return ((degrees - 90) * Math.PI) / 180;
}

function smooth01(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function julianDay(year: number, month: number, day: number) {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const gregorian = year > 1582 || (year === 1582 && (month > 10 || (month === 10 && day >= 15)));
  const b = gregorian ? 2 - a + Math.floor(a / 4) : 0;
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

function sunEquator(astro: number, month: number, day: number) {
  const n = julianDay(astro, month, day) - 2451545.0;
  const mean = wrap360(280.46 + 0.9856474 * n);
  const anomaly = (wrap360(357.528 + 0.9856003 * n) * Math.PI) / 180;
  const lon = wrap360(mean + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly));
  const lambda = (lon * Math.PI) / 180;
  const tilt = ((23.439 - 0.00000036 * n) * Math.PI) / 180;
  let ra = Math.atan2(Math.cos(tilt) * Math.sin(lambda), Math.cos(lambda));
  if (ra < 0) ra += Math.PI * 2;
  const dec = Math.asin(Math.sin(tilt) * Math.sin(lambda));
  return { ra: (ra * 180) / Math.PI, dec: (dec * 180) / Math.PI, lon };
}

function equatorialOfDate(lam: number, beta: number, year: number) {
  const tilt = ((23.439291 - 0.0130042 * (year - 2000) / 100) * Math.PI) / 180;
  const longitude = (wrap360(lam) * Math.PI) / 180;
  const latitude = (beta * Math.PI) / 180;
  const dec = Math.asin(Math.sin(latitude) * Math.cos(tilt) + Math.cos(latitude) * Math.sin(tilt) * Math.sin(longitude));
  const y = Math.sin(longitude) * Math.cos(tilt) - Math.tan(latitude) * Math.sin(tilt);
  let ra = Math.atan2(y, Math.cos(longitude));
  if (ra < 0) ra += Math.PI * 2;
  return { ra: (ra * 180) / Math.PI, dec: (dec * 180) / Math.PI };
}

function altitudeDeg(dec: number, hourAngle: number) {
  const alt = Math.asin(Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(hourAngle));
  return (alt * 180) / Math.PI;
}

function azimuthDeg(dec: number, hourAngle: number) {
  const south = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(LAT) - Math.tan(dec) * Math.cos(LAT));
  return wrap360((south * 180) / Math.PI + 180);
}

function riseSet(decDeg: number) {
  const limit = Math.sin((decDeg * Math.PI) / 180) / Math.cos(LAT);
  if (limit >= 1 || limit <= -1) return null;
  const rise = (Math.acos(Math.min(1, Math.max(-1, limit))) * 180) / Math.PI;
  return [rise, 360 - rise] as const;
}

function closest(azimuth: number, peaks: number[]) {
  let peak = peaks[0];
  let gap = orientGap(peak, azimuth);
  for (const next of peaks.slice(1)) {
    const distance = orientGap(next, azimuth);
    if (distance < gap) {
      gap = distance;
      peak = next;
    }
  }
  return { peak, gap };
}

function astroYear(era: Era, year: number) {
  if (!Number.isInteger(year) || year < 1 || year > 5000) return null;
  return era === "ie" ? 1 - year : year;
}

function daysInMonth(astro: number, month: number) {
  const leap = ((astro % 4) + 4) % 4 === 0;
  if (month === 2 && leap) return 29;
  return MONTHS[month - 1] ?? 0;
}

function clockLabel(clock: number) {
  const hour = wrap360(12 * 15 + (clock - 180)) / 15;
  const hh = Math.floor(hour) % 24;
  const mm = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function paintLines(ctx: CanvasRenderingContext2D, lines: Line[], scale: number, color: string, width: number) {
  if (!lines.length) return;
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

function spoke(ctx: CanvasRenderingContext2D, w: number, h: number, degree: number, color: string, width: number) {
  const cx = w / 2;
  const cy = h / 2;
  const angle = compassRadians(degree);
  const len = Math.hypot(w, h);
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(angle) * len, cy - Math.sin(angle) * len);
  ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawRose(ctx: CanvasRenderingContext2D, bins: number[], w: number, h: number, radiusScale: number, color: string) {
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.min(w, h) * radiusScale;
  const max = Math.max(...bins, 1);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,252,245,0.28)";
  ctx.fill();
  for (let degree = 0; degree < 180; degree += 1) {
    const radius = (bins[degree] / max) * outer;
    if (radius < 0.5) continue;
    for (const base of [degree, degree + 180]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, compassRadians(base), compassRadians(base + 1));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(15,60,90,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function take(lines: Line[], angle: number, tolerance: number) {
  return lines.filter((line) => orientGap(line[0], angle) <= tolerance);
}

function skyPoint(cx: number, cy: number, horizon: number, alt: number, az: number) {
  const clamped = Math.max(-18, Math.min(90, alt));
  const radius = horizon * ((90 - clamped) / 90);
  const angle = compassRadians(az);
  return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as const;
}

export function MeteorFloor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const fugaBins = useRef<number[]>([]);
  const atloBins = useRef<number[]>([]);
  const bundles = useRef<Record<number, Line[]>>({});
  const readyRef = useRef(false);
  const clockRef = useRef(310);
  const playingRef = useRef(false);
  const dateRef = useRef<DateParts>({ era: "ie", year: 54, month: 8, day: 2 });
  const pickRef = useRef<Record<string, boolean>>(Object.fromEntries(SHOWERS.map((star) => [star.id, false])));
  const captionHold = useRef("");
  const [playing, setPlaying] = useState(false);
  const [era, setEra] = useState<Era>("ie");
  const [year, setYear] = useState("54");
  const [month, setMonth] = useState("8");
  const [day, setDay] = useState("2");
  const [picks, setPicks] = useState(pickRef.current);
  const [caption, setCaption] = useState(["A padló és az ég betöltése…"]);

  useEffect(() => {
    const img = new Image();
    img.src = "/Padlo-18-szamozott-v7.jpg";
    img.onload = () => {
      imgRef.current = img;
      if (fugaBins.current.length && atloBins.current.length) readyRef.current = true;
    };
    const load = (url: string, target: "fuga" | "atlo") =>
      fetch(url)
        .then((response) => response.json())
        .then((data: { vonalak: Line[] }) => {
          const bins = new Array<number>(180).fill(0);
          for (const line of data.vonalak) {
            const length = Math.hypot(line[3] - line[1], line[4] - line[2]);
            bins[Math.round(((line[0] % 180) + 180) % 180) % 180] += length;
          }
          if (target === "fuga") {
            fugaBins.current = bins;
            for (const peak of FUGA_PEAKS) bundles.current[peak] = take(data.vonalak, peak, 5);
          } else {
            atloBins.current = bins;
            for (const peak of ATLO_PEAKS) bundles.current[peak] = take(data.vonalak, peak, 7);
          }
          if (imgRef.current && fugaBins.current.length && atloBins.current.length) readyRef.current = true;
        });
    void load("/fugak-csoportok.json", "fuga");
    void load("/atlok-csoportok.json", "atlo");
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (playingRef.current && readyRef.current) clockRef.current = wrap360(clockRef.current + (dt / 56) * 360);
      paint(clockRef.current);
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function paint(clock: number) {
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
    if (!baseRef.current && fugaBins.current.length) {
      const base = document.createElement("canvas");
      base.width = w;
      base.height = h;
      const layer = base.getContext("2d");
      if (layer) {
        layer.drawImage(img, 0, 0, w, h);
        baseRef.current = base;
      }
    }
    if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0);
    else ctx.drawImage(img, 0, 0, w, h);

    const date = dateRef.current;
    const astro = astroYear(date.era, date.year);
    const valid = astro !== null && date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= daysInMonth(astro ?? 0, date.month);
    if (!valid || astro === null) {
      writeCaption(["A dátum nem értelmezhető. Julián naptár, 1 és 5000 között."]);
      return;
    }
    const sun = sunEquator(astro, date.month, date.day);
    const hour = ((clock - 180) * Math.PI) / 180;
    const sunAlt = altitudeDeg((sun.dec * Math.PI) / 180, hour);
    const sunAz = azimuthDeg((sun.dec * Math.PI) / 180, hour);
    const night = sunAlt >= 0 ? 0 : sunAlt <= -8 ? 1 : 1 - smooth01(-sunAlt / 8);
    ctx.fillStyle = `rgba(7,16,40,${(0.42 * night).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);

    const bodies: SkyBody[] = [];
    for (const star of SHOWERS) {
      if (!pickRef.current[star.id]) continue;
      const node = wrap360(star.sunLon + (star.dlam * (astro - 2000)) / 100);
      if (lonGap(sun.lon, node) > star.window) continue;
      const drifted = star.lam0 + (star.dlam * (astro - 2000)) / 100;
      const eq = equatorialOfDate(drifted, star.beta, astro);
      const shift = (wrap360(eq.ra - sun.ra) * Math.PI) / 180;
      const alt = altitudeDeg((eq.dec * Math.PI) / 180, hour - shift);
      const az = azimuthDeg((eq.dec * Math.PI) / 180, hour - shift);
      const ends = riseSet(eq.dec);
      bodies.push({
        id: star.id,
        nev: star.nev,
        color: star.color,
        alt,
        az,
        lit: alt >= 2 && sunAlt <= -8,
        rise: ends ? ends[0] : null,
        set: ends ? ends[1] : null,
      });
    }

    for (const peak of [...FUGA_PEAKS, ...ATLO_PEAKS]) {
      const family = FUGA_PEAKS.includes(peak) ? "rgba(230,161,0,0.35)" : "rgba(124,58,237,0.35)";
      spoke(ctx, w, h, peak, family, 1.5);
    }
    for (const body of bodies) {
      if (body.alt > 0) spoke(ctx, w, h, body.az, body.lit ? body.color : "rgba(255,255,255,0.45)", body.lit ? 2 : 1);
      for (const azimuth of [body.rise, body.set]) {
        if (azimuth === null) continue;
        const fuga = closest(azimuth, FUGA_PEAKS);
        const atlo = closest(azimuth, ATLO_PEAKS);
        const hit = fuga.gap <= 3 || atlo.gap <= 3;
        spoke(ctx, w, h, azimuth, hit ? body.color : "rgba(255,255,255,0.25)", body.lit && hit ? 4 : 1);
        if (!(body.lit && hit)) continue;
        if (fuga.gap <= 3) paintLines(ctx, bundles.current[fuga.peak] ?? [], scale, body.color, 4);
        if (atlo.gap <= 3) paintLines(ctx, bundles.current[atlo.peak] ?? [], scale, body.color, 3);
      }
    }
    spoke(ctx, w, h, sunAz, night > 0.5 ? "rgba(251,191,36,0.9)" : "rgba(180,83,9,0.8)", 2);

    if (fugaBins.current.length) drawRose(ctx, fugaBins.current, w, h, 0.16, "rgba(230,161,0,0.8)");
    if (atloBins.current.length) drawRose(ctx, atloBins.current, w, h, 0.28, "rgba(124,58,237,0.55)");
    const cx = w / 2;
    const cy = h / 2;
    const horizon = Math.min(w, h) * 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, horizon, 0, Math.PI * 2);
    ctx.strokeStyle = night > 0.45 ? "rgba(244,251,255,0.85)" : "rgba(15,60,90,0.75)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = "700 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = night > 0.45 ? "#f4fbff" : "#0f3c5a";
    ctx.fillText("É", cx, cy - horizon - 16);
    ctx.fillText("D", cx, cy + horizon + 16);
    ctx.fillText("K", cx + horizon + 16, cy);
    ctx.fillText("Ny", cx - horizon - 18, cy);
    for (const peak of [18, 108, 81, 138]) {
      const angle = compassRadians(peak);
      ctx.fillStyle = FUGA_PEAKS.includes(peak) ? "#a16207" : "#6d28d9";
      ctx.fillText(`${peak}°`, cx + Math.cos(angle) * (horizon + 34), cy + Math.sin(angle) * (horizon + 34));
    }

    const [sx, sy] = skyPoint(cx, cy, horizon, sunAlt, sunAz);
    ctx.beginPath();
    ctx.arc(sx, sy, sunAlt > 0 ? 11 : 7, 0, Math.PI * 2);
    ctx.fillStyle = sunAlt > 0 ? "#f59e0b" : "#94a3b8";
    ctx.fill();
    ctx.font = "700 14px sans-serif";
    ctx.fillStyle = night > 0.45 ? "#f8fafc" : "#1c1917";
    ctx.fillText("Nap", sx, sy - 16);

    for (const body of bodies) {
      const [x, y] = skyPoint(cx, cy, horizon, body.alt, body.az);
      ctx.beginPath();
      ctx.arc(x, y, body.lit ? 9 : 5, 0, Math.PI * 2);
      ctx.fillStyle = body.lit ? body.color : "rgba(255,255,255,0.35)";
      ctx.fill();
      if (body.lit) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
      ctx.font = "700 14px sans-serif";
      ctx.fillStyle = body.lit ? "#fff" : night > 0.45 ? "#e7e5e4" : "#1c1917";
      ctx.fillText(body.nev, x, y - 16);
    }

    const when = `${date.era === "ie" ? "i. e." : "i. sz."} ${date.year}. ${MONTH_NAME[date.month - 1]} ${date.day}.`;
    const phase = sunAlt > 0 ? "nappal" : sunAlt > -8 ? "szürkület" : "éjjel";
    const lines = [`${when}  ${clockLabel(clock)}  ${phase}. A Nap ${hu(sunAz, 0)}°-on, ${hu(sunAlt, 0)}° magasan.`];
    if (!bodies.length) {
      lines.push("Erre az éjszakára a bejelölt rajok közül egyik sincs szezonban. A szezon a pályacsomóponthoz igazodik.");
    }
    for (const body of bodies) {
      const seen = body.lit ? "szabad szemmel látható" : body.alt > 0 ? "a horizont fölött van, de a Nap még túl magasan" : "a horizont alatt van";
      lines.push(`${body.nev}: ${seen}. Most ${hu(body.az, 0)}°.`);
      for (const [kind, azimuth] of [["Kelés", body.rise], ["Nyugvás", body.set]] as const) {
        if (azimuth === null) continue;
        const fuga = closest(azimuth, FUGA_PEAKS);
        const atlo = closest(azimuth, ATLO_PEAKS);
        const joint = Math.max(fuga.gap, atlo.gap);
        const hit = fuga.gap <= 3 ? `hézag ${fuga.peak}°` : atlo.gap <= 3 ? `átló ${atlo.peak}°` : "";
        const state = hit ? (body.lit ? `most a ${hit} kigyulladt` : `éjjel a ${hit} fog kigyulladni`) : "egyik család sem gyullad ki";
        lines.push(`${kind} ${hu(azimuth)}°. Hézag ${hu(fuga.gap)}°, átló ${hu(atlo.gap)}°. Közös eltérés ${hu(joint)}°. ${state}.`);
      }
    }
    writeCaption(lines.slice(0, 6));
  }

  function writeCaption(lines: string[]) {
    const signature = lines.join("\n");
    if (signature === captionHold.current) return;
    captionHold.current = signature;
    setCaption(lines);
  }

  function commitDate(next: Partial<DateParts> & { yearText?: string; monthText?: string; dayText?: string }) {
    const yearText = next.yearText ?? year;
    const monthText = next.monthText ?? month;
    const dayText = next.dayText ?? day;
    const eraNext = next.era ?? era;
    dateRef.current = {
      era: eraNext,
      year: Number(yearText),
      month: Number(monthText),
      day: Number(dayText),
    };
  }

  function applyPreset(id: string) {
    const preset = PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setEra(preset.era);
    setYear(preset.year);
    setMonth(preset.month);
    setDay(preset.day);
    dateRef.current = { era: preset.era, year: Number(preset.year), month: Number(preset.month), day: Number(preset.day) };
    const next = Object.fromEntries(SHOWERS.map((star) => [star.id, star.id === preset.shower]));
    pickRef.current = next;
    setPicks(next);
    clockRef.current = 310;
    playingRef.current = true;
    setPlaying(true);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-stone-300 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-4 py-3">
        <h2 className="text-lg font-semibold">Meteorrajok a padlón</h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          A Nap körbemegy, a padló a keléssel kivilágosodik és a nyugvással besötétedik. A raj csak akkor fénylik, ha szabad szemmel látszik. A belső kör a hézag, a nagyobb az átló. Ha a kelés vagy a nyugvás 3°-on belül van egy csúcshoz, az a nyaláb a raj színére gyullad.
        </p>
      </div>
      <canvas ref={canvasRef} className="w-full bg-[#f4efe6]" />
      <div className="min-h-32 space-y-1 border-t border-stone-200 px-4 py-4">
        {caption.map((line, index) => (
          <p key={`${index}-${line}`} className="text-base leading-7 text-stone-900">
            {line}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3 border-t border-stone-200 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            playingRef.current = !playingRef.current;
            setPlaying(playingRef.current);
          }}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white"
        >
          {playing ? "Megállítás" : "Egy nap lejátszása"}
        </button>
        <label className="text-sm">
          Kor
          <select
            value={era}
            onChange={(event) => {
              const next = event.target.value as Era;
              setEra(next);
              commitDate({ era: next });
            }}
            className="ml-2 rounded-lg border border-stone-300 px-2 py-2"
          >
            <option value="ie">i. e.</option>
            <option value="isz">i. sz.</option>
          </select>
        </label>
        <label className="text-sm">
          Év
          <input
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
              commitDate({ yearText: event.target.value });
            }}
            className="ml-2 w-24 rounded-lg border border-stone-300 px-2 py-2"
          />
        </label>
        <label className="text-sm">
          Hónap
          <input
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              commitDate({ monthText: event.target.value });
            }}
            className="ml-2 w-16 rounded-lg border border-stone-300 px-2 py-2"
          />
        </label>
        <label className="text-sm">
          Nap
          <input
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
              commitDate({ dayText: event.target.value });
            }}
            className="ml-2 w-16 rounded-lg border border-stone-300 px-2 py-2"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-3">
        {PRESETS.map((preset) => (
          <button key={preset.id} type="button" onClick={() => applyPreset(preset.id)} className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-800">
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 px-4 pb-4">
        {SHOWERS.map((star) => (
          <label key={star.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(picks[star.id])}
              onChange={(event) => {
                const next = { ...pickRef.current, [star.id]: event.target.checked };
                pickRef.current = next;
                setPicks(next);
              }}
            />
            <span style={{ color: star.color }}>{star.nev}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
