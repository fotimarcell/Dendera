import { createFileRoute } from '@tanstack/react-router'
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { CAM_HOME, type Cam, type FloorSeg, type SkyArc, type SkyDot } from "../lib/sky-view";
import { renderSkyGL } from "../lib/sky-gl";
import { MoonYear, MOON_MONTHS, dateFromYearDay, dayOfYear, paintMoonOrbit, paintYearArc, yearDayCount } from "../components/moon-year";
import { julianDay, julianDayNoon, meanNoonHourAngle, moonEquator, moonPhase, planetPlaces, sunEquator, PLANET_ROWS, type PlanetPlace } from "../lib/solar-system";
import { moved, placeFixed, placeZodiac, precess, ZODIAC, type PlacedZodiac } from "../lib/zodiac";
import brightCatalog from "../data/fenyesek.json";
import { deleteSetup, listSetups, saveSetup } from "@/lib/setups";
import { UserButton } from "@/lib/auth/gates";
import { GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const FILE = "/Padlo-18-szamozott-v7.jpg?v=2";
const NAME = "Padlo-18-szamozott-v7.jpg";
const DATA = "/padlo-18-kovek.json";
const PAGE = "/adatbazis-letoltes.html";
const PROMPT = "/padlo-18-prompt.txt";
const NOTES_KEY = "padlo18-jegyzet";
const PROJECT_KEY = "dendera-projekt-lista";

type UserProject = { id: string; name: string };

function loadProjects(): UserProject[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PROJECT_KEY) || "[]") as UserProject[];
    return Array.isArray(saved) ? saved.filter((item) => item && item.id && item.name) : [];
  } catch {
    return [];
  }
}

function projectDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("dendera-projektek", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kepek");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveProjectImage(id: string, file: Blob) {
  return projectDb().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction("kepek", "readwrite");
    tx.objectStore("kepek").put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function readProjectImage(id: string) {
  return projectDb().then((db) => new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction("kepek", "readonly");
    const request = tx.objectStore("kepek").get(id);
    request.onsuccess = () => resolve((request.result as Blob) ?? null);
    request.onerror = () => reject(request.error);
  }));
}

function loadStarts(): Record<string, ProjectStart> {
  try {
    const saved = JSON.parse(localStorage.getItem(START_KEY) || "{}") as Record<string, ProjectStart>;
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function blankSetup(): SetupData {
  return {
    picked: { ...BLANK_OBJECTS },
    funcs: { ...BLANK_FUNCTIONS },
    sn: {},
    met: {},
    bright: {},
    planet: {},
    zod: {},
    compass: false,
    orient: false,
    time: false,
    dayNight: false,
    moonYear: false,
    moonTime: false,
    floor: true,
    fugaHist: false,
    atloHist: false,
    fugaBand: false,
    atloBand: false,
    peak: false,
    year: "54",
    era: "ie",
    month: "7",
    day: "16",
    from: "100",
    to: "110",
    match: "2",
    dayLen: "24",
    duration: "0,5",
    moonFromMonth: "1",
    moonFromDay: "1",
    moonToMonth: "12",
    moonToDay: "31",
    moonSpeed: "12",
    moonSector: false,
    moonYearArc: false,
  };
}

function deleteProjectImage(id: string) {
  return projectDb().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction("kepek", "readwrite");
    tx.objectStore("kepek").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

type Stone = {
  id: string;
  sorozat: string;
  szin: string;
  oldalak: number;
  forma: string;
  terulet: number;
  kerulet: number;
  tengely: number;
  szomszedok: string[];
  szomszed_oldalak: number[];
  elek: [number, number][];
  szogek: number[];
  atlok: [number, number, number, number][];
  cx: number;
  cy: number;
  megjegyzes?: string;
};

const stoneShapes = new Map<string, [number, number][]>();

function stoneOutline(stone: Stone): [number, number][] {
  const saved = stoneShapes.get(stone.id);
  if (saved) return saved;
  let x = 0;
  let y = 0;
  const raw: [number, number][] = [];
  for (const [length, azimuth] of stone.elek) {
    raw.push([x, y]);
    const rad = (azimuth * Math.PI) / 180;
    x += length * Math.sin(rad);
    y -= length * Math.cos(rad);
  }
  if (!raw.length) return [];
  const cx = raw.reduce((sum, point) => sum + point[0], 0) / raw.length;
  const top = Math.min(...raw.map((point) => point[1]));
  const dx = stone.cx - cx;
  const dy = stone.cy - top;
  return raw.map((point) => [point[0] + dx, point[1] + dy]);
}

function pointInOutline(x: number, y: number, outline: [number, number][]) {
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
    const xi = outline[index][0];
    const yi = outline[index][1];
    const xj = outline[previous][0];
    const yj = outline[previous][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.00001) + xi) inside = !inside;
  }
  return inside;
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

function wedge(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`;
}

function GroutRose({ stones, north = 0 }: { stones: Stone[]; north?: number }) {
  const rose = useMemo(() => {
    const bins = Array.from({ length: 18 }, () => 0);
    let total = 0;
    for (const stone of stones) {
      for (const [length, azimuth] of stone.elek) {
        const turned = ((azimuth + north) % 180 + 180) % 180;
        const bin = Math.floor(turned / 10) % 18;
        bins[bin] += length;
        total += length;
      }
    }
    const max = Math.max(...bins, 1);
    const ranked = bins
      .map((length, index) => ({ index, length, from: index * 10, share: total ? length / total : 0 }))
      .sort((a, b) => b.length - a.length);
    return { bins, max, total, top: ranked.slice(0, 4) };
  }, [stones, north]);

  const size = 420;
  const cx = 210;
  const cy = 210;
  const outer = 168;

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Fugairányok sűrűsége</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-stone-600">
            Kördiagram a fugák irányszögéről. Észak felül van, az óramutató járása szerint nő. A szirom hossza
            az adott irányba eső élek összhossza. A fuga vonal, ezért 15° és 195° ugyanaz az irány, a szirmok
            mindkét felé kirajzolódnak.
          </p>
        </div>
        <a
          href="/padlo-18-fugairany.png"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center justify-center rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50"
        >
          Diagram letöltése
        </a>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-6">
        <svg id="fuga-rozsa" viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-md">
          {[0.25, 0.5, 0.75, 1].map((step) => (
            <circle key={step} cx={cx} cy={cy} r={outer * step} fill="none" stroke="#e7e5e4" />
          ))}
          {rose.bins.map((length, index) => {
            const radius = (length / rose.max) * outer;
            const a0 = index * 10;
            const a1 = a0 + 10;
            return (
              <g key={index}>
                <path d={wedge(cx, cy, radius, a0, a1)} fill="#44403c" opacity="0.9" />
                <path d={wedge(cx, cy, radius, a0 + 180, a1 + 180)} fill="#44403c" opacity="0.9" />
              </g>
            );
          })}
          <line x1={cx} y1={28} x2={cx} y2={size - 28} stroke="#a8a29e" strokeWidth="1" />
          <line x1={28} y1={cy} x2={size - 28} y2={cy} stroke="#a8a29e" strokeWidth="1" />
          <text x={cx} y={22} textAnchor="middle" fontSize="14" fontWeight="700">
            É
          </text>
          <text x={size - 16} y={cy + 5} textAnchor="middle" fontSize="14" fontWeight="700">
            K
          </text>
          <text x={cx} y={size - 8} textAnchor="middle" fontSize="14" fontWeight="700">
            D
          </text>
          <text x={16} y={cy + 5} textAnchor="middle" fontSize="14" fontWeight="700">
            Ny
          </text>
        </svg>
        <div className="min-w-56 text-sm">
          <p className="font-semibold">Legsűrűbb irányok</p>
          <ul className="mt-2 space-y-1">
            {rose.top.map((bin) => (
              <li key={bin.index}>
                {bin.from}–{bin.from + 10}° · {(bin.share * 100).toFixed(1)}%
              </li>
            ))}
          </ul>
          <p className="mt-3 text-stone-600">
            Két, egymásra közel merőleges fugairány uralja a burkolatot. A többi szög szinte üres.
          </p>
        </div>
      </div>
      <a href="/padlo-18-fuga-iranytu-nelkul.jpg" target="_blank" rel="noopener" className="mt-4 block">
        <img
          src="/padlo-18-fuga-iranytu-nelkul.jpg"
          alt="Fugairány-diagram iránytűmutató nélkül"
          className="w-full rounded-lg border border-stone-300"
        />
      </a>
    </section>
  );
}

function saveFile(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openOrDownload(href: string, filename: string) {
  const embedded = window.parent !== window;
  const popup = embedded ? window.open(href, "_blank") : null;
  saveFile(href, filename);
  return embedded && !popup;
}

function idRank(id: string) {
  const match = /^([A-Za-z]*)(\d+)$/.exec(id);
  const prefix = match?.[1] ?? "";
  const n = Number(match?.[2] ?? 0);
  const group = prefix === "" ? 0 : prefix === "K" ? 1 : 2;
  return group * 1_000_000 + n;
}

function fmt(n: number, digits = 1) {
  return n.toLocaleString("hu-HU", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function drawRose(
  ctx: CanvasRenderingContext2D,
  bins: number[],
  w: number,
  h: number,
  color: string,
  title: string,
  scale: number,
  titleDy: number,
  labels: boolean,
  azimuths: number[] = [],
) {
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.min(w, h) * scale;
  const max = Math.max(...bins, 1);
  const hot = new Set<number>();
  const turn = (value: number) => ((value % 360) + 360) % 360;
  const gap360 = (from: number, to: number) => {
    const delta = Math.abs(turn(from - to));
    return Math.min(delta, 360 - delta);
  };
  for (const peak of rosePeaks(bins)) {
    for (const azimuth of azimuths) {
      if (orientGap(peak, azimuth) > 6) continue;
      const fore = turn(peak);
      const back = turn(peak + 180);
      const face = gap360(fore, azimuth) <= gap360(back, azimuth) ? fore : back;
      for (let delta = -5; delta <= 5; delta += 1) hot.add(turn(face + delta));
    }
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  for (let degree = 0; degree < 180; degree += 1) {
    const radius = (bins[degree] / max) * outer;
    if (radius < 0.5) continue;
    for (const base of [degree, degree + 180]) {
      const lit = hot.has(base);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, lit ? radius * 1.08 : radius, compassRadians(base), compassRadians(base + 1));
      ctx.closePath();
      ctx.fillStyle = lit ? "#f97316" : color;
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.moveTo(cx, cy - outer);
  ctx.lineTo(cx, cy + outer);
  ctx.moveTo(cx - outer, cy);
  ctx.lineTo(cx + outer, cy);
  ctx.strokeStyle = "rgba(15,60,90,0.45)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (labels) {
    ctx.fillStyle = "#0f3c5a";
    ctx.font = "700 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("É", cx, cy - outer - 14);
    ctx.fillText("D", cx, cy + outer + 14);
    ctx.fillText("K", cx + outer + 16, cy);
    ctx.fillText("Ny", cx - outer - 18, cy);
  }
  ctx.font = "700 16px sans-serif";
  ctx.fillStyle = "#1c1917";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, cx, cy + titleDy);
  ctx.restore();
}

type RoseBand = { peak: number; left: number; width: number };

function roseBands(bins: number[]): RoseBand[] {
  const smooth = bins.map((_, index) => {
    let sum = 0;
    for (let offset = -5; offset <= 5; offset += 1) sum += bins[(index + offset + 180) % 180];
    return sum;
  });
  return rosePeaks(bins).map((peak) => {
    const level = smooth[peak] * 0.5;
    let below = 0;
    let above = 0;
    while (below < 80 && smooth[(peak - below - 1 + 180) % 180] >= level) below += 1;
    while (above < 80 && smooth[(peak + above + 1) % 180] >= level) above += 1;
    return { peak, left: (peak - below + 180) % 180, width: below + above + 1 };
  });
}

function axisInBands(azimuth: number, bands: RoseBand[]) {
  const axis = ((azimuth % 180) + 180) % 180;
  return bands.some((band) => ((axis - band.left) % 180 + 180) % 180 < band.width);
}

function bandGap(azimuth: number, bands: RoseBand[]) {
  const axis = ((azimuth % 180) + 180) % 180;
  let best = 99;
  for (const band of bands) {
    let gap = Math.abs(axis - band.peak);
    if (gap > 90) gap = 180 - gap;
    if (gap < best) best = gap;
  }
  return best;
}

type AnalId = "taj" | "ido" | "napt" | "hold" | "boly" | "csil" | "ritk" | "lat";
type AnalKind = "fuga" | "atlo";
type AnalHit = { group: AnalId; year: number; az: number; kind: AnalKind; name: string; gap: number };
type AnalBand = "ev" | "evtized" | "negy" | "hosszu";

const ANAL_GROUPS: { id: AnalId; name: string; color: string; role: "irany" | "darab" | "szuro" }[] = [
  { id: "taj", name: "Tájolás", color: "#44403c", role: "irany" },
  { id: "ido", name: "Időmérés", color: "#0369a1", role: "darab" },
  { id: "napt", name: "Naptár", color: "#b45309", role: "darab" },
  { id: "hold", name: "Hold", color: "#4338ca", role: "irany" },
  { id: "boly", name: "Bolygók", color: "#be123c", role: "irany" },
  { id: "csil", name: "Állócsillagok", color: "#0f766e", role: "irany" },
  { id: "ritk", name: "Ritka", color: "#c2410c", role: "darab" },
  { id: "lat", name: "Láthatóság", color: "#78716c", role: "szuro" },
];

function analSpan(band: AnalBand, astro: number) {
  if (band === "ev") return { from: astro, to: astro, step: 1 };
  if (band === "evtized") return { from: astro - 5, to: astro + 4, step: 1 };
  if (band === "negy") return { from: -199, to: 200, step: 1 };
  return { from: -499, to: 500, step: 5 };
}

function analBandLabel(band: AnalBand) {
  if (band === "ev") return "Ez az év";
  if (band === "evtized") return "Évtized";
  if (band === "negy") return "i. e. 200 – i. sz. 200";
  return "i. e. 500 – i. sz. 500";
}

function riseHit(name: string, raDeg: number, decDeg: number, sunRa: number, sunDec: number, eye: boolean) {
  const dec = (decDeg * Math.PI) / 180;
  const ends = riseSetAzimuths(dec);
  if (!ends) return null;
  if (eye && name !== "Nap") {
    const limit = -Math.tan(LAT) * Math.tan(dec);
    const ha = -Math.acos(Math.min(1, Math.max(-1, limit)));
    const sunHa = ha - ((raDeg - sunRa) * Math.PI) / 180;
    const sunAlt = altitudeDeg((sunDec * Math.PI) / 180, sunHa);
    if (name === "Hold" ? sunAlt > 0 : sunAlt > -8) return null;
  }
  return ends.kel;
}

function pushAnal(hits: AnalHit[], group: AnalId, year: number, name: string, az: number, fuga: RoseBand[], atlo: RoseBand[]) {
  if (axisInBands(az, fuga)) hits.push({ group, year, az, kind: "fuga", name, gap: bandGap(az, fuga) });
  if (axisInBands(az, atlo)) hits.push({ group, year, az, kind: "atlo", name, gap: bandGap(az, atlo) });
}

function yearMarks(astro: number, month: number, day: number, fuga: RoseBand[], atlo: RoseBand[], eye: boolean, seasons: boolean) {
  const hits: AnalHit[] = [];
  const dates = seasons
    ? [[3, 20], [6, 21], [9, 22], [12, 21]]
    : [[month, day]];
  for (const [m, d] of dates) {
    const jd = julianDayNoon(astro, m, d);
    const sun = sunEquator(jd);
    const sunAz = riseHit("Nap", sun.ra, sun.dec, sun.ra, sun.dec, false);
    if (sunAz != null) pushAnal(hits, "taj", astro, "Nap", sunAz, fuga, atlo);
    if (!seasons || m === 6 || m === 12) {
      const places = planetPlaces(jd, sun.ra);
      for (const body of places) {
        const ra = (sun.ra + (body.shift * 180) / Math.PI + 360) % 360;
        const dec = (body.dec * 180) / Math.PI;
        const az = riseHit(body.nev, ra, dec, sun.ra, sun.dec, eye);
        if (az == null) continue;
        pushAnal(hits, body.nev === "Hold" ? "hold" : "boly", astro, body.nev, az, fuga, atlo);
      }
    }
  }
  const sun = sunEquator(julianDayNoon(astro, month, day));
  for (const star of BRIGHT) {
    const at = moved(star, astro);
    const az = riseHit(star.nev, at.ra, at.dec, sun.ra, sun.dec, eye);
    if (az == null) continue;
    pushAnal(hits, "csil", astro, star.nev, az, fuga, atlo);
  }
  return hits;
}

function imageCounts(project: string | null) {
  if (project === "dendera-roof") return { twelve: true, thirtySix: true, note: "A tetőn 12 jegy és 36 dekán van." };
  if (project === "dendera") return { twelve: false, thirtySix: false, note: "A padlóköveken nincs 12-es vagy 36-os osztás." };
  return { twelve: false, thirtySix: false, note: "Ehhez a képhez még nincs darabszám." };
}

function yearText(year: number) {
  return year < 1 ? `i. e. ${1 - year}` : `i. sz. ${year}`;
}

function analVerdict(id: AnalId, hits: AnalHit[], project: string | null) {
  if (id === "ido" || id === "napt" || id === "ritk") {
    const counts = imageCounts(project);
    if (id === "ido" && (counts.twelve || counts.thirtySix)) return { text: "A darabszám egyezik.", tone: "count" as const };
    return { text: "Nincs kapcsolat.", tone: "none" as const };
  }
  if (project !== "dendera") return { text: "Nincs saját mérés.", tone: "miss" as const };
  const own = hits.filter((hit) => hit.group === id);
  if (!own.length) return { text: "Nincs kapcsolat.", tone: "none" as const };
  const fuga = own.some((hit) => hit.kind === "fuga");
  const atlo = own.some((hit) => hit.kind === "atlo");
  if (fuga && atlo) return { text: "Fugával és átlóval egyezik.", tone: "both" as const };
  if (fuga) return { text: "Fugával egyezik.", tone: "fuga" as const };
  return { text: "Átlóval egyezik.", tone: "atlo" as const };
}

function analText(id: AnalId, tone: string, best: AnalHit | undefined, project: string | null) {
  const lead: Record<AnalId, string> = {
    taj: "A Nap kelése a napfordulókon és a napéjegyenlőségeken. Az irányt a kép fuga- és átlósávjához mértük.",
    ido: "Itt nem irányt nézünk, hanem darabszámot: 12 óra vagy hónap, és 36 dekán.",
    napt: "Itt az év osztása számít. Azt néztük, van-e a képen 365-nek megfelelő felosztás.",
    hold: "A Hold kelési iránya azokon a napokon, amikor Denderából látszott.",
    boly: "A Merkúr, a Vénusz, a Mars, a Jupiter és a Szaturnusz kelési iránya.",
    csil: "A fényes csillagok kelési iránya. Az évek során a precesszió miatt lassan elmozdul.",
    ritk: "Szupernóva, üstökös és tűzgolyó. Ezek egyszeri jelek, nem ismétlődő hálózat.",
    lat: "A láthatóság szűrő. Ami Denderából nem látszott, az nem kerül találatba.",
  };
  const angle = best ? `${best.az.toFixed(1).replace(".", ",")}°` : "";
  const gap = best ? `${best.gap.toFixed(1).replace(".", ",")}°` : "";
  if (tone === "fuga" && best) return `${lead[id]} A legszorosabb találat a ${best.name}, ${yearText(best.year)}, ${angle}. Ez a fugasávba esik, ${gap}-ra a sáv közepétől. A padlón az arany küllő ezt az irányt mutatja.`;
  if (tone === "atlo" && best) return `${lead[id]} A legszorosabb találat a ${best.name}, ${yearText(best.year)}, ${angle}. Ez az átlósávba esik, ${gap}-ra a sáv közepétől. A padlón a lila küllő ezt az irányt mutatja.`;
  if (tone === "both" && best) return `${lead[id]} A legszorosabb találat a ${best.name}, ${yearText(best.year)}, ${angle}. Ebben a csoportban fuga- és átlótalálat is van. A küllő a szorosabbat mutatja, ${best.kind === "fuga" ? "arany, fuga" : "lila, átló"}.`;
  if (tone === "count") return `${lead[id]} ${imageCounts(project).note} Ez darabszám-egyezés, nem egy irány a padlón.`;
  if (tone === "miss") return `${lead[id]} Ehhez a képhez nincs megmérve a fuga és az átló. Irányt csak a Dendera-Hathor felmérésével lehet összevetni.`;
  if (id === "ido" || id === "napt" || id === "ritk") return `${lead[id]} ${imageCounts(project).note} Ezért itt nincs kapcsolat.`;
  return `${lead[id]} Ebben a sávban egy kelési irány sem esett a fuga- vagy az átlósávba.`;
}

function paintAnalMarks(ctx: CanvasRenderingContext2D, w: number, h: number, marks: { az: number; kind: AnalKind; name?: string }[]) {
  if (!marks.length) return;
  const cx = w / 2;
  const cy = h / 2;
  const span = Math.hypot(w, h) * 0.48;
  ctx.save();
  ctx.lineCap = "round";
  ctx.font = "700 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const mark of marks.slice(0, 20)) {
    const ang = compassRadians(mark.az);
    const x = cx + Math.cos(ang) * span;
    const y = cy + Math.sin(ang) * span;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = mark.kind === "fuga" ? "rgba(245,196,0,0.95)" : "rgba(124,58,237,0.95)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    if (!mark.name) continue;
    const label = `${mark.name} ${mark.az.toFixed(1).replace(".", ",")}°`;
    const width = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(255,252,245,0.94)";
    ctx.fillRect(x - width / 2 - 6, y - 14, width + 12, 28);
    ctx.fillStyle = mark.kind === "fuga" ? "#854d0e" : "#5b21b6";
    ctx.fillText(label, x, y);
  }
  ctx.restore();
}

function pairHitsBand(a: number, b: number, bands: RoseBand[]) {
  if (!bands.length) return false;
  const forward = ((b - a) % 360 + 360) % 360;
  const span = forward <= 180 ? forward : 360 - forward;
  const start = forward <= 180 ? a : b;
  const steps = Math.max(1, Math.ceil(span));
  for (let index = 0; index <= steps; index += 1) {
    if (axisInBands((start + (span * index) / steps) % 360, bands)) return true;
  }
  return false;
}

function bodyAzimuth(body: ConjBody, sunRa: number, clockAz: number) {
  const hour = ((clockAz - 180) * Math.PI) / 180;
  const shift = ((((body.ra - sunRa) % 360) + 360) % 360 * Math.PI) / 180;
  return azimuthDeg((body.dec * Math.PI) / 180, hour - shift);
}

function bodyShift(body: ConjBody, sunRa: number) {
  return ((((body.ra - sunRa) % 360) + 360) % 360 * Math.PI) / 180;
}

function sphereGap(dec1: number, dec2: number, dRa: number) {
  const cos = Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(dRa);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

function seenNaked(name: string, alt: number, sunAlt: number, fromSun: number) {
  if (name === "Nap") return sunAlt >= 0;
  if (name === "Hold") return alt >= 2 && fromSun >= 10;
  return alt >= 2 && sunAlt <= -8;
}

function nakedFromDendera(row: ConjRow) {
  for (let hour = 0; hour < 24; hour += 0.25) {
    const sunHour = ((hour - 12) * 15 * Math.PI) / 180;
    const sunAlt = altitudeDeg(row.sunDec, sunHour);
    const visible = [0, 1].every((index) => {
      const name = row.names[index];
      const alt = name === "Nap" ? sunAlt : altitudeDeg(row.decs[index], sunHour - row.shifts[index]);
      const fromSun = name === "Nap" ? 0 : sphereGap(row.sunDec, row.decs[index], row.shifts[index]);
      return seenNaked(name, alt, sunAlt, fromSun);
    });
    if (visible) return true;
  }
  return false;
}

function conjArcBodies(rows: ConjRow[]) {
  const found = new Map<string, { name: string; color: string; dec: number; shift: number; sun: boolean; sunDec: number }>();
  for (const row of rows) {
    if (!nakedFromDendera(row)) continue;
    row.names.forEach((name, index) => {
      if (found.has(name)) return;
      found.set(name, {
        name,
        color: row.colors[index] || "#1c1917",
        dec: row.decs[index],
        shift: row.shifts[index],
        sun: name === "Nap",
        sunDec: row.sunDec,
      });
    });
  }
  return [...found.values()];
}

function paintOmittedFugas(ctx: CanvasRenderingContext2D, bins: number[], lines: number[][], scale: number) {
  const covered = (angle: number) => {
    const a = ((angle % 180) + 180) % 180;
    return roseBands(bins).some((band) => ((a - band.left) % 180 + 180) % 180 < band.width);
  };
  const deviation = (angle: number) => {
    const a = ((angle % 180) + 180) % 180;
    let axis = 18;
    let signed = 180;
    for (const mark of [18, 108]) {
      let delta = a - mark;
      if (delta > 90) delta -= 180;
      if (delta < -90) delta += 180;
      if (Math.abs(delta) < Math.abs(signed)) {
        signed = delta;
        axis = mark;
      }
    }
    return { axis, signed };
  };
  const omitted = lines.filter((line) => !covered(line[0]));
  ctx.save();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "#be123c";
  ctx.beginPath();
  for (const line of omitted) {
    ctx.moveTo(line[1] * scale, line[2] * scale);
    ctx.lineTo(line[3] * scale, line[4] * scale);
  }
  ctx.stroke();
  const picks = new Map<string, { line: number[]; signed: number }>();
  for (const line of omitted) {
    const length = Math.hypot(line[3] - line[1], line[4] - line[2]);
    if (length < 40) continue;
    const turn = deviation(line[0]);
    const key = `${turn.axis}${turn.signed >= 0 ? "+" : "-"}`;
    const held = picks.get(key);
    if (!held || Math.abs(turn.signed) > Math.abs(held.signed)) picks.set(key, { line, signed: turn.signed });
  }
  ctx.font = "700 14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const pick of picks.values()) {
    const line = pick.line;
    const x = ((line[1] + line[3]) / 2) * scale;
    const y = ((line[2] + line[4]) / 2) * scale;
    ctx.strokeStyle = "#7f1d1d";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(line[1] * scale, line[2] * scale);
    ctx.lineTo(line[3] * scale, line[4] * scale);
    ctx.stroke();
    const text = `${line[0].toFixed(0)}°  ${pick.signed > 0 ? "+" : ""}${pick.signed.toFixed(0)}°`;
    const width = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(255,252,245,0.94)";
    ctx.fillRect(x - width / 2 - 5, y - 11, width + 10, 22);
    ctx.fillStyle = "#7f1d1d";
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

function drawBands(
  ctx: CanvasRenderingContext2D,
  bins: number[],
  w: number,
  h: number,
  fill: string,
  stroke: string,
  scale: number,
  bands: RoseBand[] = roseBands(bins),
  innerRatio = 0.78,
) {
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.min(w, h) * scale;
  const inner = outer * innerRatio;
  ctx.save();
  ctx.font = "700 14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const band of bands) {
    for (const shift of [0, 180]) {
      const start = compassRadians(band.left + shift);
      const end = compassRadians(band.left + shift + band.width);
      ctx.beginPath();
      ctx.arc(cx, cy, outer, start, end);
      ctx.arc(cx, cy, inner, end, start, true);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const rad = compassRadians(band.peak);
    ctx.fillStyle = stroke;
    ctx.fillText(`${Math.round(band.width)}°`, cx + Math.cos(rad) * (outer + 18), cy + Math.sin(rad) * (outer + 18));
  }
  ctx.restore();
}

function drawRingHist(
  ctx: CanvasRenderingContext2D,
  bins: number[],
  w: number,
  h: number,
  scale: number,
  innerRatio: number,
  color: string,
  bands: RoseBand[],
  azimuths: number[] = [],
) {
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.min(w, h) * scale;
  const inner = outer * innerRatio;
  const max = Math.max(...bins, 1);
  const inside = (degree: number) => {
    const angle = ((degree % 180) + 180) % 180;
    return bands.some((band) => ((angle - band.left) % 180 + 180) % 180 < band.width);
  };
  const hot = new Set<number>();
  const turn = (value: number) => ((value % 360) + 360) % 360;
  const gap360 = (from: number, to: number) => {
    const delta = Math.abs(turn(from - to));
    return Math.min(delta, 360 - delta);
  };
  for (const peak of rosePeaks(bins)) {
    for (const azimuth of azimuths) {
      if (orientGap(peak, azimuth) > 6) continue;
      const fore = turn(peak);
      const back = turn(peak + 180);
      const face = gap360(fore, azimuth) <= gap360(back, azimuth) ? fore : back;
      for (let delta = -5; delta <= 5; delta += 1) hot.add(turn(face + delta));
    }
  }
  ctx.save();
  for (let degree = 0; degree < 180; degree += 1) {
    if (!inside(degree)) continue;
    const reach = inner + (bins[degree] / max) * (outer - inner);
    if (reach <= inner + 0.4 && !hot.has(degree) && !hot.has(degree + 180)) continue;
    for (const base of [degree, degree + 180]) {
      const lit = hot.has(base);
      const start = compassRadians(base);
      const end = compassRadians(base + 1);
      ctx.beginPath();
      ctx.arc(cx, cy, inner, start, end);
      ctx.arc(cx, cy, lit ? outer : reach, end, start, true);
      ctx.closePath();
      ctx.fillStyle = lit ? "#f97316" : color;
      ctx.fill();
    }
  }
  ctx.restore();
}

function fullFugaBands(lines: number[][]): RoseBand[] {
  return [18, 108].map((axis) => {
    const other = axis === 18 ? 108 : 18;
    let low = 0;
    let high = 0;
    const signed = (angle: number, mark: number) => {
      const a = ((angle % 180) + 180) % 180;
      let delta = a - mark;
      if (delta > 90) delta -= 180;
      if (delta < -90) delta += 180;
      return delta;
    };
    for (const line of lines) {
      const here = signed(line[0], axis);
      if (Math.abs(here) > Math.abs(signed(line[0], other))) continue;
      if (here < low) low = here;
      if (here > high) high = here;
    }
    return { peak: axis, left: (((axis + low) % 180) + 180) % 180, width: Math.max(1, high - low) };
  });
}

function NameChip({ on, onClick, name, className = "", tint }: { on: boolean; onClick: () => void; name: string; className?: string; tint?: string }) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs leading-4 ${tint ? "border-transparent text-white" : on ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-800"} ${className}`}
      style={tint ? { background: tint, borderColor: tint } : undefined}
    >
      <input type="checkbox" checked={on} onChange={onClick} className="h-3 w-3 shrink-0" />
      {name}
    </label>
  );
}

export const Route = createFileRoute("/")({ component: Home });

type ObjId = "nap" | "sirius" | "alkaid" | "goncol" | "fuga" | "atlo";
type FnId = "mozgas" | "lathato" | "fugafele" | "atlofele" | "suruseg" | "ssav" | "asav" | "tsav" | "csucs" | "kcsucs" | "cikk" | "palya" | "ellentet" | "deleles" | "azimut" | "eazimut";
const OBJECTS: { id: ObjId; label: string; hint: string }[] = [
  { id: "nap", label: "Nap", hint: "nappal, éjjel, azimut" },
  { id: "sirius", label: "Szíriusz", hint: "Sopdet" },
  { id: "alkaid", label: "Alkaid", hint: "a rúd vége" },
  { id: "goncol", label: "Göncölszekér", hint: "hét csillag együtt" },
  { id: "fuga", label: "Fugák", hint: "a kövek közötti hézag" },
  { id: "atlo", label: "Átlók", hint: "a kő belsejében" },
];
const FUNCTIONS: { id: FnId; label: string; hint: string }[] = [
  { id: "mozgas", label: "Mozgás", hint: "végigmegy a napon vagy a szögeken" },
  { id: "lathato", label: "Láthatóság", hint: "csak szabad szemmel, égitestre" },
  { id: "fugafele", label: "Fugák felé", hint: "a kijelölt égitest azimutja" },
  { id: "atlofele", label: "Átlók felé", hint: "ugyanaz az átlókon" },
  { id: "suruseg", label: "Sűrűség", hint: "mindkét kördiagram a kép közepén" },
  { id: "ssav", label: "Fugák sávja", hint: "a fugairányok csúcsa, félmagasságig" },
  { id: "asav", label: "Átlók sávja", hint: "az átlóirányok csúcsa, félmagasságig" },
  { id: "tsav", label: "Teljes sávszélesség", hint: "a teljes fugaív, benne a sűrűségi hisztogram" },
  { id: "csucs", label: "Átlócsúcsok", hint: "a kiugró irány szöge" },
  { id: "cikk", label: "Láthatósági körcikk", hint: "a kijelölt égitest aznapi íve" },
  { id: "azimut", label: "Azimut", hint: "az aktuális idő azimutíve a körön" },
  { id: "eazimut", label: "Éves azimut", hint: "ugyanabban az órában, egy év azimutja" },
  { id: "deleles", label: "Delelési pont", hint: "a horizonthoz képest legmagasabb pont" },
  { id: "kcsucs", label: "Csúcs", hint: "a fugák eltűnnek, a kövek csúcsai pontok" },
  { id: "palya", label: "Pálya", hint: "az aktív objektumok napi útja" },
  { id: "ellentet", label: "Ellentétes járás", hint: "minden objektum, ami az óramutatóval szemben is megy" },
];
const BLANK_OBJECTS: Record<ObjId, boolean> = { nap: false, sirius: false, alkaid: false, goncol: false, fuga: false, atlo: false };
const BRIGHT = brightCatalog.csillagok;
const FUNCTION_GROUPS: { label: string; ids: FnId[] }[] = [
  { label: "Mozgás", ids: ["mozgas", "palya", "ellentet"] },
  { label: "Láthatóság", ids: ["lathato", "cikk", "azimut", "eazimut", "suruseg", "ssav", "asav", "tsav", "deleles", "kcsucs"] },
  { label: "Vonalak", ids: ["fugafele", "atlofele", "csucs"] },
];
const BLANK_FUNCTIONS: Record<FnId, boolean> = { mozgas: false, lathato: false, fugafele: false, atlofele: false, suruseg: false, ssav: false, asav: false, tsav: false, csucs: false, kcsucs: false, cikk: false, palya: false, ellentet: false, deleles: false, azimut: false, eazimut: false };
type FugaGroup = { szog: number; n: number; v: number[][] };
type FugaData = { halvany: number[][]; vonalak: number[][]; csoportok: FugaGroup[] };

type ScanRow = { size: number; line: number; cross: number };
type StoneLayer = { id: string; name: string; stones: string[] };
const SCAN_KEY = "dendera-raster-scan";
const LAYER_KEY = "dendera-retegek";

function loadLayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYER_KEY) || "null") as { layers?: StoneLayer[]; current?: string | null } | null;
    const layers = Array.isArray(saved?.layers) ? saved.layers.filter((layer) => layer && typeof layer.id === "string" && typeof layer.name === "string" && Array.isArray(layer.stones)) : [];
    return { layers, current: saved?.current && layers.some((layer) => layer.id === saved.current) ? saved.current : layers[0]?.id ?? null };
  } catch {
    return { layers: [] as StoneLayer[], current: null as string | null };
  }
}

function rasterHits(lines: number[][], nw: number, nh: number, width: number, height: number, originX: number, originY: number, step: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const near = (value: number) => Math.abs(value / step - Math.round(value / step)) * step <= 3;
  const seen = new Set<string>();
  const hits: { x: number; y: number; cross: boolean }[] = [];
  for (const line of lines) {
    for (const point of [[line[1], line[2]], [line[3], line[4]]]) {
      const key = `${Math.round(point[0])},${Math.round(point[1])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const vx = (point[0] / nw) * width;
      const vy = (point[1] / nh) * height;
      const dx = vx - originX;
      const dy = vy - originY;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const onV = near(lx);
      const onH = near(ly);
      if (onV && onH) hits.push({ x: vx, y: vy, cross: true });
      else if (onV || onH) hits.push({ x: vx, y: vy, cross: false });
    }
  }
  return hits;
}

type AltItem = { name: string; alt: number; color: string; culm: number; atCulm: boolean; showCulm: boolean };

type SetupData = {
  picked: Record<ObjId, boolean>;
  funcs: Record<FnId, boolean>;
  sn: Record<string, boolean>;
  met: Record<string, boolean>;
  bright: Record<string, boolean>;
  planet: Record<string, boolean>;
  zod: Record<string, boolean>;
  compass: boolean;
  orient: boolean;
  time: boolean;
  dayNight: boolean;
  moonYear: boolean;
  moonTime: boolean;
  floor: boolean;
  fugaHist: boolean;
  atloHist: boolean;
  fugaBand: boolean;
  atloBand: boolean;
  peak: boolean;
  year: string;
  era: "ie" | "isz";
  month: string;
  day: string;
  from: string;
  to: string;
  match: string;
  dayLen: string;
  duration: string;
  moonFromMonth: string;
  moonFromDay: string;
  moonToMonth: string;
  moonToDay: string;
  moonSpeed: string;
  moonSector?: boolean;
  moonYearArc?: boolean;
};
type SavedSetup = { name: string; data: SetupData };
type ProjectStart = {
  deg: number;
  zoom: number;
  panX: number;
  panY: number;
  spare: boolean[];
  rasterOn: boolean;
  rasterSize: number;
  rasterDeg: number;
  setup?: SetupData;
  full?: boolean;
};
const START_KEY = "dendera-projekt-alap";

function AltitudeBoard({ live, children }: { live: React.RefObject<AltItem[]>; children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<AltItem[]>([]);
  const [box, setBox] = useState({ left: null as number | null, top: 8, width: 230, height: 188, right: 12 });
  const [zoom, setZoom] = useState(false);
  const [cursor, setCursor] = useState("grab");
  const home = { left: null as number | null, top: 8, width: 230, height: 188, right: 12 };

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 40) return;
      last = now;
      const next = live.current ?? [];
      setItems((prev) => {
        if (prev.length === next.length && prev.every((item, index) => item.name === next[index].name && Math.abs(item.alt - next[index].alt) < 0.05 && item.color === next[index].color && Math.abs(item.culm - next[index].culm) < 0.05 && item.atCulm === next[index].atCulm && item.showCulm === next[index].showCulm)) return prev;
        return next.slice();
      });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [live]);

  function edgeAt(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const band = 10;
    return {
      left: x < band,
      right: rect.width - x < band,
      top: y < band,
      bottom: rect.height - y < band,
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    const parent = wrapRef.current?.getBoundingClientRect();
    const rect = event.currentTarget.getBoundingClientRect();
    if (!parent) return;
    const edges = edgeAt(event);
    const resize = edges.left || edges.right || edges.top || edges.bottom;
    const start = {
      px: event.clientX,
      py: event.clientY,
      left: rect.left - parent.left,
      top: rect.top - parent.top,
      w: rect.width,
      h: rect.height,
      edges,
    };
    const apply = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      if (!resize) {
        setBox({ left: start.left + dx, top: Math.max(0, start.top + dy), width: start.w, height: start.h, right: 0 });
        return;
      }
      let left = start.left;
      let top = start.top;
      let width = start.w;
      let height = start.h;
      if (edges.right) width = Math.max(180, start.w + dx);
      if (edges.bottom) height = Math.max(160, start.h + dy);
      if (edges.left) {
        width = Math.max(180, start.w - dx);
        left = start.left + start.w - width;
      }
      if (edges.top) {
        height = Math.max(160, start.h - dy);
        top = start.top + start.h - height;
      }
      setBox({ left, top, width, height, right: 0 });
    };
    const up = () => {
      window.removeEventListener("pointermove", apply);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", apply);
    window.addEventListener("pointerup", up);
  }

  const lead = items.slice().sort((a, b) => b.alt - a.alt)[0];
  const chartH = Math.max(80, box.height - 96);
  const minA = -40;
  const maxA = 90;
  const yOf = (alt: number) => {
    const clamped = Math.max(minA, Math.min(maxA, alt));
    return (1 - (clamped - minA) / (maxA - minA)) * chartH;
  };
  const sign = lead ? (lead.alt >= 0 ? "+" : "−") : "";
  return (
    <div ref={wrapRef} className="relative flex min-h-0 flex-1 flex-col">
      {children}
      <div
        className="absolute z-20 select-none rounded-xl border border-stone-300 bg-white/95 shadow-sm"
        style={{ top: box.top, width: box.width, height: box.height, right: box.left == null ? box.right : undefined, left: box.left == null ? undefined : box.left, cursor, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          const edges = edgeAt(event);
          if ((edges.left && edges.top) || (edges.right && edges.bottom)) setCursor("nwse-resize");
          else if ((edges.right && edges.top) || (edges.left && edges.bottom)) setCursor("nesw-resize");
          else if (edges.left || edges.right) setCursor("ew-resize");
          else if (edges.top || edges.bottom) setCursor("ns-resize");
          else setCursor("grab");
        }}
      >
        <button
          type="button"
          title={zoom ? "Eredeti méret" : "Nagyítás"}
          onClick={(event) => {
            event.stopPropagation();
            if (zoom) {
              setZoom(false);
              setBox(home);
            } else {
              setZoom(true);
              setBox((current) => ({ left: current.left, top: current.top, right: current.left == null ? 12 : 0, width: 480, height: 560 }));
            }
          }}
          className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-800"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </button>
        <div className="px-3 pt-2 text-xs font-semibold text-stone-500">Szögmagasság</div>
        <div className="px-3 text-2xl font-bold leading-none text-stone-900">{lead ? `${sign}${Math.abs(lead.alt).toFixed(1).replace(".", ",")}°` : "—"}</div>
        <div className="truncate px-3 text-xs font-semibold" style={{ color: lead?.color ?? "#78716c" }}>{lead ? lead.name : "nincs kijelölt objektum"}</div>
        <div className="relative mx-3 mt-2" style={{ height: chartH }}>
          <div className="absolute bottom-0 left-7 top-0 w-px bg-stone-400" />
          {[90, 60, 30, 0, -30].map((tick) => (
            <div key={tick} className="absolute left-0 text-[10px] text-stone-500" style={{ top: yOf(tick) - 6 }}>{tick}</div>
          ))}
          <div className="absolute left-7 right-0 h-0.5 bg-stone-900" style={{ top: yOf(0) }} />
          <div className="absolute text-[11px] font-bold text-stone-900" style={{ left: 36, top: yOf(0) - 16 }}>horizont</div>
          {items.filter((item) => item.showCulm).map((item, index) => (
            <div key={`culm-${item.name}-${index}`} className="absolute" style={{ left: 18, top: yOf(item.culm) - 5 }}>
              <span className="block h-2.5 w-2.5 rotate-45 border-2 bg-white" style={{ borderColor: item.color }} />
            </div>
          ))}
          {items.filter((item) => item.showCulm && item.atCulm).map((item) => (
            <div key={`flash-${item.name}`} className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: yOf(item.culm) - 2, height: 4, background: "#fff", boxShadow: "0 0 14px 5px #fff" }} />
          ))}
          {items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="absolute" style={{ left: 22, top: yOf(item.alt) - 6 }}>
              <span className="inline-block h-3 w-3 rounded-full border-2 border-white" style={{ background: item.color }} />
              {items.length <= 8 ? <span className="ml-1 align-middle text-[11px] font-bold text-stone-900">{item.name} {item.alt >= 0 ? "+" : "−"}{Math.abs(item.alt).toFixed(0)}°</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function rangeWedge(from: number, to: number) {
  const a = ((from % 180) + 180) % 180;
  const b = ((to % 180) + 180) % 180;
  if (Math.abs(a - b) < 1e-6) return { start: a, end: a + 0.6 };
  if (a <= b) return { start: a, end: b };
  return { start: a - 180, end: b };
}

function compassRadians(degrees: number) {
  return ((degrees - 90) * Math.PI) / 180;
}

const STAR_PAIRS: { a: string; b: string; kind: string; az1: number; az2: number; stone: string }[] = [
  { a: "Pollux", b: "Adhara", kind: "nyug", az1: 303.99, az2: 238.4, stone: "K61" },
  { a: "Spica", b: "Deneb", kind: "nyug", az1: 270.13, az2: 314.85, stone: "K61" },
  { a: "Procyon", b: "Castor", kind: "nyug", az1: 279, az2: 307.78, stone: "K64" },
  { a: "Rigel", b: "Bellatrix", kind: "nyug", az1: 255.76, az2: 272.27, stone: "K64" },
  { a: "Szíriusz", b: "Deneb", kind: "kel", az1: 107.88, az2: 45.15, stone: "K28" },
  { a: "Deneb", b: "Elnath", kind: "nyug", az1: 314.85, az2: 296.98, stone: "K65" },
  { a: "Antares", b: "Pollux", kind: "kel", az1: 111.76, az2: 56.01, stone: "K28" },
  { a: "Rigel", b: "Regulus", kind: "kel", az1: 104.24, az2: 67.12, stone: "K64" },
  { a: "Pávián 6", b: "Hapi 7", kind: "kel", az1: 45.52, az2: 121.88, stone: "K63" },
  { a: "Pávián 8", b: "Ozirisz király 14", kind: "nyug", az1: 343.07, az2: 283.34, stone: "K63" },
];

const PARALLEL_PAIRS: { a: string; b: string; kind: string; az1: number; az2: number; stone: string }[] = [
  { a: "Mimosa", b: "Miaplacidus", kind: "nyug", az1: 213.72, az2: 191.26, stone: "K61" },
  { a: "Acrux", b: "Adhara", kind: "nyug", az1: 208.95, az2: 238.4, stone: "K28" },
  { a: "Termékenység 4", b: "Skorpió 10", kind: "nyug", az1: 212.25, az2: 234.15, stone: "K63" },
];

const EAST_LINKS: { stone: string; x: number; y: number; source: "dendera" | "fenyes"; a: string; b: string; kind: string; how: string; gap: number; line: number }[] = [
  { stone: "K62", x: 2165.8, y: 790, source: "dendera", a: "Termékenység istene", b: "Anuket", kind: "kel", how: "merőleges", gap: 0.001, line: 49.6 },
  { stone: "K62", x: 2165.8, y: 790, source: "fenyes", a: "Canopus", b: "Shaula", kind: "kel", how: "merőleges", gap: 0.035, line: 49.56 },
  { stone: "K28", x: 2508.4, y: 892.2, source: "dendera", a: "Az óriás", b: "Szíriusz", kind: "kel", how: "merőleges", gap: 0.014, line: 166.51 },
  { stone: "K28", x: 2508.4, y: 892.2, source: "fenyes", a: "Szíriusz", b: "Deneb", kind: "kel", how: "merőleges", gap: 0.014, line: 166.51 },
  { stone: "K29", x: 2881.1, y: 1031.4, source: "dendera", a: "A mező", b: "A cethal", kind: "nyug", how: "merőleges", gap: 0.01, line: 173.51 },
  { stone: "K29", x: 2881.1, y: 1031.4, source: "fenyes", a: "Arcturus", b: "Antares", kind: "kel", how: "merőleges", gap: 0.031, line: 173.47 },
  { stone: "K30", x: 3260, y: 1161.4, source: "dendera", a: "Pávián", b: "A cethal", kind: "kel", how: "merőleges", gap: 0.006, line: 173.39 },
  { stone: "K30", x: 3260, y: 1161.4, source: "fenyes", a: "Deneb", b: "Adhara", kind: "kel", how: "merőleges", gap: 0.027, line: 173.37 },
  { stone: "K61", x: 3734.3, y: 1319.5, source: "dendera", a: "Pávián", b: "Ízisz", kind: "nyug", how: "merőleges", gap: 0.036, line: 0.66 },
  { stone: "K61", x: 3734.3, y: 1319.5, source: "fenyes", a: "Pollux", b: "Adhara", kind: "nyug", how: "merőleges", gap: 0.003, line: 1.2 },
  { stone: "K63", x: 1828, y: 676.3, source: "dendera", a: "A megszelídítés", b: "Ízisz", kind: "kel", how: "merőleges", gap: 0.04, line: 173.66 },
  { stone: "K63", x: 1828, y: 676.3, source: "fenyes", a: "Rigel", b: "Elnath", kind: "kel", how: "merőleges", gap: 0.07, line: 173.63 },
  { stone: "K64", x: 1444.8, y: 538.1, source: "dendera", a: "Kanópusz", b: "A kakas", kind: "kel", how: "merőleges", gap: 0.08, line: 43.12 },
  { stone: "K64", x: 1444.8, y: 538.1, source: "fenyes", a: "Rigel", b: "Bellatrix", kind: "nyug", how: "merőleges", gap: 0.01, line: 174.01 },
  { stone: "K65", x: 968.1, y: 383.4, source: "dendera", a: "Pávián", b: "A mező", kind: "nyug", how: "merőleges", gap: 0.03, line: 33.23 },
  { stone: "K65", x: 968.1, y: 383.4, source: "fenyes", a: "Deneb", b: "Elnath", kind: "nyug", how: "merőleges", gap: 0.01, line: 35.91 },
];

const RESULT_LINKS: { stone: string; x: number; y: number; name: string; gap: number; line: number }[] = [
  { stone: "K39", x: 3379.5, y: 3006.5, name: "A madár", gap: 0.14, line: 83.6 },
  { stone: "K54", x: 3583.5, y: 2414, name: "Ízisz", gap: 0.2, line: 135 },
  { stone: "K34", x: 3718.2, y: 2005.1, name: "Szatet és Hathor tehene", gap: 0.3, line: 81 },
  { stone: "K1", x: 737, y: 463.1, name: "Anuket", gap: 0.45, line: 131.5 },
  { stone: "K49", x: 3319.7, y: 3208.1, name: "Az őr", gap: 0.83, line: 55.2 },
];

const RISE_PERP: { stone: string; x: number; y: number; anchor: "Szíriusz" | "Procyon"; mate: string; gap: number; line: number }[] = [
  { stone: "K28", x: 2508.4, y: 892.2, anchor: "Szíriusz", mate: "Deneb", gap: 0.014, line: 166.51 },
  { stone: "K28", x: 2508.4, y: 892.2, anchor: "Szíriusz", mate: "Vega", gap: 0.475, line: 166.98 },
  { stone: "K61", x: 3734.3, y: 1319.5, anchor: "Szíriusz", mate: "A holttest", gap: 0.101, line: 3.7 },
  { stone: "K61", x: 3734.3, y: 1319.5, anchor: "Szíriusz", mate: "Aldebaran", gap: 0.45, line: 3.35 },
  { stone: "K61", x: 3734.3, y: 1319.5, anchor: "Szíriusz", mate: "Mimosa", gap: 0.483, line: 37.08 },
  { stone: "K64", x: 1444.8, y: 538.1, anchor: "Procyon", mate: "Mimosa", gap: 0.244, line: 23.64 },
  { stone: "K64", x: 1444.8, y: 538.1, anchor: "Szíriusz", mate: "Elnath", gap: 0.247, line: 175.45 },
  { stone: "K64", x: 1444.8, y: 538.1, anchor: "Procyon", mate: "Spica", gap: 0.266, line: 175.43 },
  { stone: "K64", x: 1444.8, y: 538.1, anchor: "Szíriusz", mate: "Mia", gap: 0.279, line: 23.12 },
  { stone: "K65", x: 968.1, y: 383.4, anchor: "Procyon", mate: "A cethal", gap: 0.06, line: 12.06 },
  { stone: "K65", x: 968.1, y: 383.4, anchor: "Szíriusz", mate: "Alnilam", gap: 0.34, line: 11.66 },
  { stone: "K65", x: 968.1, y: 383.4, anchor: "Szíriusz", mate: "Hadar", gap: 0.385, line: 37.81 },
];

const KOZOS: {
  stones: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  diag: number;
  chords: { anchor: "Szíriusz" | "Procyon"; mate: string; line: number; gap: number }[];
}[] = [
  { stones: "K30–K61", x1: 3103, y1: 1010, x2: 3976, y2: 1507, diag: 119.65, chords: [{ anchor: "Szíriusz", mate: "Anuket", line: 29.67, gap: 0.014 }] },
  { stones: "K30–K61", x1: 3042, y1: 1186, x2: 4038, y2: 1323, diag: 97.83, chords: [{ anchor: "Szíriusz", mate: "Bellatrix", line: 7.81, gap: 0.026 }, { anchor: "Procyon", mate: "A kakas", line: 7.47, gap: 0.363 }] },
  { stones: "K63–K64", x1: 2043, y1: 651, x2: 1229, y2: 570, diag: 95.68, chords: [{ anchor: "Szíriusz", mate: "Altair", line: 5.76, gap: 0.077 }] },
  { stones: "K64–K65", x1: 1664, y1: 524, x2: 668, y2: 386, diag: 97.89, chords: [{ anchor: "Szíriusz", mate: "Bellatrix", line: 7.81, gap: 0.082 }, { anchor: "Procyon", mate: "A kakas", line: 7.47, gap: 0.419 }] },
  { stones: "K63–K64", x1: 1988, y1: 826, x2: 1287, y2: 396, diag: 121.53, chords: [{ anchor: "Szíriusz", mate: "Ízisz", line: 31.44, gap: 0.084 }] },
  { stones: "K28–K29", x1: 2286, y1: 927, x2: 3098, y2: 1007, diag: 95.63, chords: [{ anchor: "Szíriusz", mate: "Altair", line: 5.76, gap: 0.133 }] },
  { stones: "K29–K30", x1: 2665, y1: 1056, x2: 3477, y2: 1136, diag: 95.63, chords: [{ anchor: "Szíriusz", mate: "Altair", line: 5.76, gap: 0.133 }] },
  { stones: "K62–K63", x1: 2341, y1: 753, x2: 1611, y2: 699, diag: 94.23, chords: [{ anchor: "Szíriusz", mate: "Procyon", line: 4.44, gap: 0.211 }] },
  { stones: "K28–K62", x1: 2717, y1: 881, x2: 1993, y2: 828, diag: 94.19, chords: [{ anchor: "Szíriusz", mate: "Procyon", line: 4.44, gap: 0.255 }] },
];

function rosePeaks(bins: number[]) {
  const smooth = bins.map((_, index) => {
    let sum = 0;
    for (let offset = -5; offset <= 5; offset += 1) sum += bins[(index + offset + 180) % 180];
    return sum;
  });
  const max = Math.max(...smooth, 1);
  const found: number[] = [];
  for (let index = 0; index < 180; index += 1) {
    if (smooth[index] >= smooth[(index + 179) % 180] && smooth[index] > smooth[(index + 1) % 180] && smooth[index] >= max * 0.72) found.push(index);
  }
  const kept: number[] = [];
  for (const peak of found.sort((a, b) => smooth[b] - smooth[a])) {
    if (kept.every((other) => Math.min((peak - other + 180) % 180, (other - peak + 180) % 180) >= 12)) kept.push(peak);
  }
  return kept.sort((a, b) => a - b);
}

/** SIMBAD ICRS J2000 (van Leeuwen 2007, Gaia DR3 ahol az a forrás). A helyet a többi csillaggal közös precesszió adja. */
const DIPPER = [
  { nev: "Dubhe", color: "#b45309", ra: 165.93196, dec: 61.75103, pmra: -134.11, pmde: -34.7 },
  { nev: "Merak", color: "#0369a1", ra: 165.46033, dec: 56.38243, pmra: 79.959, pmde: 32.365 },
  { nev: "Phecda", color: "#15803d", ra: 178.4577, dec: 53.69476, pmra: 107.68, pmde: 11.01 },
  { nev: "Megrez", color: "#a16207", ra: 183.8565, dec: 57.03262, pmra: 103.947, pmde: 8.141 },
  { nev: "Alioth", color: "#6d28d9", ra: 193.50729, dec: 55.95982, pmra: 111.91, pmde: -8.24 },
  { nev: "Mizar", color: "#be123c", ra: 200.98142, dec: 54.92535, pmra: 119.01, pmde: -25.97 },
  { nev: "Alkaid", color: "#1a7f9c", ra: 206.88516, dec: 49.31327, pmra: -121.17, pmde: -14.91 },
];
const DIPPER_LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [3, 4],
  [4, 5],
  [5, 6],
];
const DIPPER_HIPS = DIPPER.map((star) => {
  let best = 0;
  let gap = 99;
  for (const figure of ZODIAC) {
    for (const item of figure.csillagok) {
      const next = Math.abs(item.ra - star.ra) + Math.abs(item.dec - star.dec);
      if (next < gap) {
        gap = next;
        best = item.hip;
      }
    }
  }
  return gap < 0.2 ? best : 0;
});

/** SIMBAD ICRS J2000, a maradvány közepe. Sajátmozgásuk elhanyagolható, a helyet a közös precesszió adja. */
const NOVA = [
  { id: "sn185", nev: "185", sub: "RCW 86", color: "#9f1239", ra: 220.75, dec: -62.5 },
  { id: "sn1006", nev: "1006", sub: "Farkas", color: "#c2410c", ra: 225.59208, dec: -42.09694 },
  { id: "sn1054", nev: "1054", sub: "Rák-köd", color: "#d97706", ra: 83.6325, dec: 22.0175 },
  { id: "sn1181", nev: "1181", sub: "Pa 30", color: "#7c3aed", ra: 13.29669, dec: 67.50066 },
  { id: "sn1572", nev: "1572", sub: "Tycho", color: "#0369a1", ra: 6.33958, dec: 64.14083 },
  { id: "sn1604", nev: "1604", sub: "Kepler", color: "#be123c", ra: 262.66879, dec: -21.48733 },
  { id: "sn1680", nev: "1680", sub: "Cas A", color: "#44403c", ra: 350.85833, dec: 58.81139 },
];

type DipperPlace = { nev: string; color: string; dec: number; shift: number };
type WagonStar = DipperPlace & { alt: number; az: number; above: boolean; lit: number };
type NovaPlace = DipperPlace & { id: string; sub: string };

function dipperPlaces(astro: number, raSun: number): DipperPlace[] {
  return DIPPER.map((star) => {
    const at = moved(star, astro);
    return {
      nev: star.nev,
      color: star.color,
      dec: (at.dec * Math.PI) / 180,
      shift: ((((at.ra - raSun) % 360) + 360) % 360 * Math.PI) / 180,
    };
  });
}

function novaPlaces(astro: number, raSun: number): NovaPlace[] {
  return NOVA.map((star) => {
    const at = precess(star.ra, star.dec, astro);
    return {
      id: star.id,
      nev: star.nev,
      sub: star.sub,
      color: star.color,
      dec: (at.dec * Math.PI) / 180,
      shift: ((((at.ra - raSun) % 360) + 360) % 360 * Math.PI) / 180,
    };
  });
}

const METEOR = [
  { id: "met-lyr", nev: "Lyridák", sub: "április", color: "#0f766e", lam0: 273.427, beta: 56.639, dlam: 0 },
  { id: "met-eta", nev: "Éta Aquaridák", sub: "május, Halley", color: "#0369a1", lam0: 338.933, beta: 7.696, dlam: 0 },
  { id: "met-sda", nev: "Delta Aquaridák", sub: "július", color: "#1d4ed8", lam0: 335.329, beta: -7.488, dlam: 0 },
  { id: "met-per", nev: "Perseidák", sub: "augusztus", color: "#b45309", lam0: 63.631, beta: 38.362, dlam: 0 },
  { id: "met-ori", nev: "Orionidák", sub: "október, Halley", color: "#9a3412", lam0: 95.87, beta: -7.557, dlam: 0 },
  { id: "met-tau", nev: "Tauridák", sub: "november, +0,75°/század", color: "#a16207", lam0: 49.821, beta: -4.911, dlam: 0.75 },
  { id: "met-leo", nev: "Leonidák", sub: "november, +1,52°/század", color: "#be123c", lam0: 148.025, beta: 10.225, dlam: 1.52 },
  { id: "met-gem", nev: "Geminidák", sub: "december, −1,57°/század", color: "#6d28d9", lam0: 110.195, beta: 10.466, dlam: -1.57 },
];

function equatorialOfDate(lam: number, beta: number, year: number) {
  const tilt = ((23.439291 - 0.0130042 * (year - 2000) / 100) * Math.PI) / 180;
  const longitude = (((lam % 360) + 360) % 360 * Math.PI) / 180;
  const latitude = (beta * Math.PI) / 180;
  const dec = Math.asin(Math.sin(latitude) * Math.cos(tilt) + Math.cos(latitude) * Math.sin(tilt) * Math.sin(longitude));
  const y = Math.sin(longitude) * Math.cos(tilt) - Math.tan(latitude) * Math.sin(tilt);
  let ra = Math.atan2(y, Math.cos(longitude));
  if (ra < 0) ra += Math.PI * 2;
  return { ra: (ra * 180) / Math.PI, dec: (dec * 180) / Math.PI };
}

function meteorPlaces(astro: number, raSun: number): NovaPlace[] {
  return METEOR.map((star) => {
    const eq = equatorialOfDate(star.lam0 + star.dlam * (astro - 2000) / 100, star.beta, astro);
    return {
      id: star.id,
      nev: star.nev,
      sub: star.sub,
      color: star.color,
      dec: (eq.dec * Math.PI) / 180,
      shift: ((((eq.ra - raSun) % 360) + 360) % 360 * Math.PI) / 180,
    };
  });
}

const FUGA_PEAKS = [18, 108];
const ATLO_PEAKS = [81, 138];

function radiantRiseSet(decDeg: number) {
  const limit = Math.sin((decDeg * Math.PI) / 180) / Math.cos(LAT);
  if (limit >= 1 || limit <= -1) return null;
  const rise = (Math.acos(Math.min(1, Math.max(-1, limit))) * 180) / Math.PI;
  return [rise, 360 - rise];
}

function bestRadiantMatch() {
  let best: { score: number; year: number; name: string; kind: string; az: number; fuga: number; atlo: number } | null = null;
  for (const star of METEOR) {
    if (!star.dlam) continue;
    for (let year = -5000; year <= 2000; year += 5) {
      const eq = equatorialOfDate(star.lam0 + star.dlam * (year - 2000) / 100, star.beta, year);
      const ends = radiantRiseSet(eq.dec);
      if (!ends) continue;
      for (const [kind, az] of [["kel", ends[0]], ["nyug", ends[1]]] as const) {
        const fuga = Math.min(...FUGA_PEAKS.map((peak) => orientGap(north180(peak), az)));
        const atlo = Math.min(...ATLO_PEAKS.map((peak) => orientGap(north180(peak), az)));
        const score = Math.max(fuga, atlo);
        if (!best || score < best.score - 0.05) best = { score, year, name: star.nev, kind, az, fuga, atlo };
      }
    }
  }
  return best;
}

type AimMoment = {
  azimuth: number;
  fugaPeak: number;
  fugaGap: number;
  atloPeak: number;
  atloGap: number;
  joint: number;
};

type CompareRow = {
  name: string;
  now: AimMoment;
  kel: AimMoment | null;
  nyug: AimMoment | null;
  napi: AimMoment | null;
};

function closestPeak(azimuth: number, peaks: number[]) {
  let peak = peaks[0];
  let gap = orientGap(peak, azimuth);
  for (let index = 1; index < peaks.length; index += 1) {
    const next = orientGap(peaks[index], azimuth);
    if (next < gap) {
      gap = next;
      peak = peaks[index];
    }
  }
  return { peak, gap };
}

function aimMoment(azimuth: number): AimMoment {
  const fuga = closestPeak(azimuth, FUGA_PEAKS.map(north180));
  const atlo = closestPeak(azimuth, ATLO_PEAKS.map(north180));
  return {
    azimuth,
    fugaPeak: fuga.peak,
    fugaGap: fuga.gap,
    atloPeak: atlo.peak,
    atloGap: atlo.gap,
    joint: Math.max(fuga.gap, atlo.gap),
  };
}

function dailyClosest(decRad: number) {
  let best: AimMoment | null = null;
  for (let step = 0; step < 72; step += 1) {
    const hour = (step * 5 * Math.PI) / 180;
    if (altitudeDeg(decRad, hour) < 0) continue;
    const moment = aimMoment(azimuthDeg(decRad, hour));
    if (!best || moment.joint < best.joint) best = moment;
  }
  return best;
}

function compareBody(name: string, decRad: number, azimuth: number): CompareRow {
  const ends = radiantRiseSet((decRad * 180) / Math.PI);
  return {
    name,
    now: aimMoment(azimuth),
    kel: ends ? aimMoment(ends[0]) : null,
    nyug: ends ? aimMoment(ends[1]) : null,
    napi: dailyClosest(decRad),
  };
}

function huDeg(value: number) {
  return `${value.toFixed(1).replace(".", ",")}°`;
}

function bestMarked(rows: CompareRow[]) {
  let found: { name: string; where: string; moment: AimMoment } | null = null;
  for (const row of rows) {
    const options: { where: string; moment: AimMoment }[] = [];
    if (row.kel) options.push({ where: "kelése", moment: row.kel });
    if (row.nyug) options.push({ where: "nyugvása", moment: row.nyug });
    if (!options.length && row.napi) options.push({ where: "napi pályája", moment: row.napi });
    for (const option of options) {
      if (!found || option.moment.joint < found.moment.joint) found = { name: row.name, where: option.where, moment: option.moment };
    }
  }
  return found;
}

function momentLine(title: string, moment: AimMoment) {
  return `${title}: ${huDeg(moment.azimuth)} · fuga ${huDeg(moment.fugaGap)} a ${moment.fugaPeak}°-os csúcstól · átló ${huDeg(moment.atloGap)} a ${moment.atloPeak}°-os csúcstól · közös ${huDeg(moment.joint)}`;
}

function drawFigures(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  figures: { nev: string; color: string; vezeto: number; vonalak: number[][]; csillagok: { alt: number; az: number; lit: number }[] }[],
  glow: boolean,
) {
  if (!figures.length) return;
  const cx = w / 2;
  const cy = h / 2;
  const horizon = Math.min(w, h) * 0.26;
  const xy = (alt: number, az: number) => {
    const clipped = Math.max(alt, -12);
    const radius = (horizon * (90 - clipped)) / 90;
    const rad = (az * Math.PI) / 180;
    return [cx + radius * Math.sin(rad), cy - radius * Math.cos(rad)];
  };
  ctx.save();
  ctx.font = "700 13px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const figure of figures) {
    for (const path of figure.vonalak) {
      for (let step = 1; step < path.length; step += 1) {
        const from = figure.csillagok[path[step - 1]];
        const to = figure.csillagok[path[step]];
        const [x1, y1] = xy(from.alt, from.az);
        const [x2, y2] = xy(to.alt, to.az);
        const litCount = (from.lit === 1 ? 1 : 0) + (to.lit === 1 ? 1 : 0);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineCap = "round";
        if (litCount === 0) {
          ctx.strokeStyle = figure.color;
          ctx.globalAlpha = 0.14;
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          const strength = litCount === 2 ? 1 : 0.55;
          ctx.strokeStyle = figure.color;
          ctx.globalAlpha = 0.35 * strength;
          ctx.lineWidth = 11;
          ctx.stroke();
          ctx.globalAlpha = 0.75 * strength;
          ctx.lineWidth = 4.5;
          ctx.stroke();
          ctx.strokeStyle = "rgba(255,252,240,0.95)";
          ctx.globalAlpha = strength;
          ctx.lineWidth = 1.7;
          ctx.stroke();
        }
      }
    }
    figure.csillagok.forEach((star, index) => {
      const [x, y] = xy(star.alt, star.az);
      const lead = index === figure.vezeto;
      if (star.lit === 1) {
        const radius = lead ? 16 : 9;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
        halo.addColorStop(0, "rgba(255,252,240,0.95)");
        halo.addColorStop(0.45, figure.color);
        halo.addColorStop(1, "rgba(255,252,240,0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fffdf6";
        ctx.beginPath();
        ctx.arc(x, y, lead ? 3.4 : 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = figure.color;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (lead) {
        ctx.globalAlpha = star.lit === 1 ? 1 : 0.45;
        ctx.fillStyle = "#1c1917";
        ctx.fillText(figure.nev, x + 8, y);
      }
    });
  }
  ctx.restore();
}

function drawWagon(ctx: CanvasRenderingContext2D, w: number, h: number, stars: WagonStar[], glow: boolean) {
  const cx = w / 2;
  const cy = h / 2;
  const horizon = Math.min(w, h) * 0.26;
  const xy = (alt: number, az: number) => {
    const clipped = Math.max(alt, -12);
    const radius = (horizon * (90 - clipped)) / 90;
    const rad = (az * Math.PI) / 180;
    return [cx + radius * Math.sin(rad), cy - radius * Math.cos(rad)];
  };
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, horizon, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,252,245,0.16)";
  ctx.fill();
  ctx.strokeStyle = "rgba(15,60,90,0.75)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#0f3c5a";
  ctx.font = "700 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("É", cx, cy - horizon - 14);
  ctx.fillText("D", cx, cy + horizon + 14);
  ctx.fillText("K", cx + horizon + 16, cy);
  ctx.fillText("Ny", cx - horizon - 18, cy);
  ctx.lineWidth = 2;
  for (const [a, b] of DIPPER_LINKS) {
    const [x1, y1] = xy(stars[a].alt, stars[a].az);
    const [x2, y2] = xy(stars[b].alt, stars[b].az);
    const litCount = (stars[a].lit === 1 ? 1 : 0) + (stars[b].lit === 1 ? 1 : 0);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineCap = "round";
    if (litCount === 0) {
      ctx.strokeStyle = "rgba(28,25,23,0.25)";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      const strength = litCount === 2 ? 1 : 0.55;
      ctx.strokeStyle = stars[a].color;
      ctx.globalAlpha = 0.35 * strength;
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.globalAlpha = 0.85 * strength;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,252,240,0.95)";
      ctx.globalAlpha = strength;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "700 14px sans-serif";
  for (const star of stars) {
    const [x, y] = xy(star.alt, star.az);
    const lit = star.lit === 1;
    if (lit) {
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 16);
      halo.addColorStop(0, "rgba(255,252,240,0.95)");
      halo.addColorStop(0.45, star.color);
      halo.addColorStop(1, "rgba(255,252,240,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, lit ? 4 : star.above ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = lit ? "#fffdf6" : star.above ? star.color : "rgba(120,113,108,0.55)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = star.color;
    ctx.stroke();
    ctx.fillStyle = star.above ? "#1c1917" : "rgba(28,25,23,0.45)";
    ctx.fillText(`${star.nev} ${star.alt.toFixed(0)}°`, x + 10, y);
  }
  ctx.restore();
}

function drawNovae(ctx: CanvasRenderingContext2D, w: number, h: number, stars: (WagonStar & { sub: string })[], glow: boolean) {
  if (!stars.length) return;
  const cx = w / 2;
  const cy = h / 2;
  const horizon = Math.min(w, h) * 0.26;
  const xy = (alt: number, az: number) => {
    const clipped = Math.max(alt, -12);
    const radius = (horizon * (90 - clipped)) / 90;
    const rad = (az * Math.PI) / 180;
    return [cx + radius * Math.sin(rad), cy - radius * Math.cos(rad)];
  };
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, horizon, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(15,60,90,0.75)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "700 14px sans-serif";
  for (const star of stars) {
    const [x, y] = xy(star.alt, star.az);
    const lit = star.lit === 1;
    if (lit) {
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 18);
      halo.addColorStop(0, "rgba(255,252,240,0.95)");
      halo.addColorStop(0.45, star.color);
      halo.addColorStop(1, "rgba(255,252,240,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, lit ? 4.2 : star.above ? 6 : 3, 0, Math.PI * 2);
    ctx.fillStyle = lit ? "#fffdf6" : star.above ? star.color : "rgba(120,113,108,0.55)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = star.color;
    ctx.stroke();
    ctx.fillStyle = star.above ? "#1c1917" : "rgba(28,25,23,0.45)";
    ctx.fillText(`${star.nev} ${star.alt.toFixed(0)}°`, x + 10, y);
  }
  ctx.restore();
}

const SIRIUS_KEL = 107.6;
const SIRIUS_NYUG = 252.4;

function clockwise(from: number, to: number) {
  return ((to - from) % 360 + 360) % 360;
}

function orientGap(line: number, azimuth: number) {
  const a = ((line % 180) + 180) % 180;
  const b = ((azimuth % 180) + 180) % 180;
  const gap = Math.abs(a - b);
  return Math.min(gap, 180 - gap);
}

const PHOTO_NORTH = 18.67;
const HATHOR_DEG = 18.65;
const HATHOR_KEY = "dendera-hathor-start";

function containTurned(stageW: number, stageH: number, natW: number, natH: number, deg: number, zoom: number) {
  const roomW = Math.max(0, stageW - 4);
  const roomH = Math.max(0, stageH - 4);
  if (roomW < 8 || roomH < 8 || natW < 1 || natH < 1) return null;
  const fit = Math.min(roomW / natW, roomH / natH);
  let width = natW * fit;
  let height = natH * fit;
  const rad = (((deg % 360) + 360) % 360 * Math.PI) / 180;
  const across = Math.abs(Math.cos(rad));
  const down = Math.abs(Math.sin(rad));
  const boxW = width * across + height * down;
  const boxH = width * down + height * across;
  const shrink = Math.min(1, roomW / Math.max(boxW, 1), roomH / Math.max(boxH, 1));
  const scale = shrink * (zoom > 0 ? zoom : 1);
  return { width: Math.max(1, width * scale), height: Math.max(1, height * scale) };
}

function isRoofFull2(name: string) {
  return /roof/i.test(name) && /full\s*2/i.test(name);
}

type RoofCrop = { x: number; y: number; w: number; h: number };
const roofCrops = new WeakMap<HTMLImageElement, RoofCrop>();

function roofStoneCrop(img: HTMLImageElement): RoofCrop {
  const full = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  const cached = roofCrops.get(img);
  if (cached) return cached;
  const sw = 360;
  const sh = Math.max(1, Math.round((img.naturalHeight * sw) / img.naturalWidth));
  const sample = document.createElement("canvas");
  sample.width = sw;
  sample.height = sh;
  const sampleCtx = sample.getContext("2d", { willReadFrequently: true });
  if (!sampleCtx) return full;
  sampleCtx.drawImage(img, 0, 0, sw, sh);
  const data = sampleCtx.getImageData(0, 0, sw, sh).data;
  const cyan = new Uint8Array(sw * sh);
  for (let p = 0; p < sw * sh; p++) {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    const light = g > 210 && b > 210 && r < 200 && Math.abs(g - b) < 45;
    const blue = b > 70 && r < 190 && b > r + 18 && b + 15 >= g && g < 180;
    if (light || blue) cyan[p] = 1;
  }
  let top = 0;
  let run = 0;
  for (let y = 0; y < sh; y++) {
    let count = 0;
    for (let x = 0; x < sw; x++) if (cyan[y * sw + x]) count++;
    if (count / sw > 0.55) run++;
    else {
      if (run > 2) top = y;
      break;
    }
  }
  let bottom = sh - 1;
  run = 0;
  for (let y = sh - 1; y >= 0; y--) {
    let count = 0;
    for (let x = 0; x < sw; x++) if (cyan[y * sw + x]) count++;
    if (count / sw > 0.55) run++;
    else {
      if (run > 2) bottom = y;
      break;
    }
  }
  if (bottom - top < sh * 0.4) {
    roofCrops.set(img, full);
    return full;
  }
  const sx = img.naturalWidth / sw;
  const sy = img.naturalHeight / sh;
  const crop = {
    x: 0,
    y: Math.max(0, Math.floor(top * sy)),
    w: img.naturalWidth,
    h: Math.min(img.naturalHeight, Math.ceil((bottom + 1) * sy)) - Math.max(0, Math.floor(top * sy)),
  };
  roofCrops.set(img, crop);
  return crop;
}

function hathorStartsOn() {
  try {
    return localStorage.getItem(HATHOR_KEY) === "1";
  } catch {
    return false;
  }
}

let northOffset = 0;

function north180(azimuth: number) {
  return ((azimuth + northOffset) % 180 + 180) % 180;
}

function segmentDistance(px: number, py: number, line: number[]) {
  const dx = line[3] - line[1];
  const dy = line[4] - line[2];
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - line[1]) * dx + (py - line[2]) * dy) / len2));
  return Math.hypot(px - (line[1] + t * dx), py - (line[2] + t * dy));
}

function lineGap(line: number[], px: number, py: number) {
  const dx = line[3] - line[1];
  const dy = line[4] - line[2];
  const len = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((py - line[2]) * dx - (px - line[1]) * dy) / len;
}

type AngleRow = { szog: number; fuga18: number; fuga108: number; fugaEszak: number; fugaKelet: number; atlo81: number; atlo138: number; sirius: number };
const ANGLE_KEY = "dendera-szog-sorok-v2";

function angleRow(deg: number, fuga: number[][], atlo: number[][]): AngleRow {
  const und = (azimuth: number) => ((azimuth + deg) % 180 + 180) % 180;
  const near = (lines: number[][], target: number) => Math.round(lines.reduce((sum, line) => orientGap(und(line[0]), target) <= 2 ? sum + Math.hypot(line[3] - line[1], line[4] - line[2]) : sum, 0));
  return {
    szog: Math.round(deg * 100) / 100,
    fuga18: Math.round(und(18) * 100) / 100,
    fuga108: Math.round(und(108) * 100) / 100,
    fugaEszak: near(fuga, 0),
    fugaKelet: near(fuga, 90),
    atlo81: Math.round(und(81) * 100) / 100,
    atlo138: Math.round(und(138) * 100) / 100,
    sirius: Math.round(orientGap(und(18), 107.6) * 100) / 100,
  };
}

const LAT = (26.1417 * Math.PI) / 180;
const SIRIUS_DEC = (-16.75 * Math.PI) / 180;
const MONTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

type YearSky = {
  szoko: number;
  dek_nap: number[];
  ra_nap: number[];
  dek_szir: number[];
  ra_szir: number[];
  lathato: number[];
  ora: (number | null)[];
  ra_alk: number[];
  dek_alk: number[];
  lathato_alk: number[];
  ora_alk: (number | null)[];
};

function astroYear(era: "ie" | "isz", year: number) {
  if (!Number.isInteger(year) || year < 1) return null;
  return era === "ie" ? 1 - year : year;
}

function dayIndex(month: number, day: number, leap: boolean) {
  const lengths = MONTHS.slice();
  if (leap) lengths[1] = 29;
  if (month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) return -1;
  let index = day - 1;
  for (let i = 0; i < month - 1; i += 1) index += lengths[i];
  return index;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smooth01(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function altitudeDeg(dec: number, hourAngle: number) {
  const alt = Math.asin(Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(hourAngle));
  return (alt * 180) / Math.PI;
}

function alsoCounterClockwise(dec: number) {
  return dec > LAT;
}

function riseSetAzimuths(dec: number) {
  const limit = -Math.tan(LAT) * Math.tan(dec);
  if (limit <= -1 || limit >= 1) return null;
  const hour = Math.acos(Math.min(1, Math.max(-1, limit)));
  return { kel: azimuthDeg(dec, -hour), nyug: azimuthDeg(dec, hour) };
}

const PLANET_PAIR_NAMES = ["Nap", "Hold", "Merkúr", "Vénusz", "Mars", "Jupiter", "Szaturnusz"] as const;

/** A kék vonal a kő legalább 350 pixeles átlójára merőleges legjobb pár. A deklináció a helyi dél, nem beégetett fok. */
function bestPlanetLink(stone: Stone, decOf: Map<string, number>) {
  let best: { a: string; b: string; kind: "kel" | "nyug"; gap: number; line: number } | null = null;
  for (let i = 0; i < PLANET_PAIR_NAMES.length; i += 1) {
    for (let j = i + 1; j < PLANET_PAIR_NAMES.length; j += 1) {
      const decA = decOf.get(PLANET_PAIR_NAMES[i]);
      const decB = decOf.get(PLANET_PAIR_NAMES[j]);
      if (decA == null || decB == null) continue;
      const left = riseSetAzimuths(decA);
      const right = riseSetAzimuths(decB);
      if (!left || !right) continue;
      for (const kind of ["kel", "nyug"] as const) {
        const span = Math.abs(left[kind] - right[kind]);
        if (Math.min(span, 360 - span) < 8) continue;
        const rad = Math.PI / 180;
        let line = Math.atan2(Math.sin(right[kind] * rad) - Math.sin(left[kind] * rad), Math.cos(right[kind] * rad) - Math.cos(left[kind] * rad)) / rad;
        line = ((line % 180) + 180) % 180;
        for (const diag of stone.atlok) {
          if (diag[2] < 350) continue;
          const gap = Math.abs(90 - orientGap(line, diag[3]));
          if (!best || gap < best.gap) best = { a: PLANET_PAIR_NAMES[i], b: PLANET_PAIR_NAMES[j], kind, gap, line };
        }
      }
    }
  }
  return best;
}

function visibleRuns(
  at: (hour: number, dayFrac: number) => { dec: number; hour: number },
  sunDec: number,
) {
  const runs: { kel: number; nyug: number }[] = [];
  let open: number | null = null;
  let last = 0;
  for (let clock = 0; clock <= 360; clock += 1) {
    const sunHour = ((clock - 180) * Math.PI) / 180;
    const body = at(sunHour, (clock - 180) / 360);
    const seen = altitudeDeg(body.dec, body.hour) >= 2 && altitudeDeg(sunDec, sunHour) <= -8;
    if (seen && open === null) open = azimuthDeg(body.dec, body.hour);
    if (!seen && open !== null) {
      runs.push({ kel: open, nyug: last });
      open = null;
    }
    if (seen) last = azimuthDeg(body.dec, body.hour);
  }
  if (open !== null) runs.push({ kel: open, nyug: last });
  return runs;
}

function azimuthDeg(dec: number, hourAngle: number) {
  const south = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(LAT) - Math.tan(dec) * Math.cos(LAT),
  );
  return (((south * 180) / Math.PI + 180) % 360 + 360) % 360;
}

const culmFlash = new Map<string, number>();

function culminationFlash(name: string, hourAngle: number) {
  const wrapped = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle));
  const now = performance.now();
  if (Math.abs(wrapped) < (12 * Math.PI) / 180) culmFlash.set(name, now);
  return now - (culmFlash.get(name) ?? 0) < 800;
}

function riseClock(dec: number) {
  const limit = -Math.tan(LAT) * Math.tan(dec);
  if (limit <= -1) return 0;
  if (limit >= 1) return null;
  const hourAngle = -Math.acos(Math.min(1, Math.max(-1, limit)));
  return (((hourAngle * 180) / Math.PI + 180) % 360 + 360) % 360;
}

function hexAlpha(hex: string, alpha: number) {
  const n = hex.replace("#", "");
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function coverArc(azimuths: number[]) {
  const norm = azimuths.map((degree) => ((degree % 360) + 360) % 360).sort((a, b) => a - b);
  let maxGap = -1;
  let gapAt = 0;
  for (let index = 0; index < norm.length; index += 1) {
    const next = norm[(index + 1) % norm.length];
    const gap = (next - norm[index] + 360) % 360;
    if (gap > maxGap) {
      maxGap = gap;
      gapAt = index;
    }
  }
  const start = norm[(gapAt + 1) % norm.length];
  const end = norm[gapAt];
  const width = (end - start + 360) % 360;
  if (width > 356) return { start: 0, end: 360, width: 360, kind: "mindig" as const };
  if (width < 3) {
    const mid = norm[Math.floor(norm.length / 2)];
    return { start: mid - 1.5, end: mid + 1.5, width: 3, kind: "iv" as const };
  }
  return { start, end: start + width, width, kind: "iv" as const };
}

type VisSector = { name: string; color: string; start: number; end: number; kind: "nincs" | "nappal" | "mindig" | "iv" };

function visibilitySectors(
  name: string,
  color: string,
  sun: boolean,
  sunDec: number,
  at: (hour: number, dayFrac: number) => { dec: number; hour: number },
): VisSector[] {
  const samples: { lit: boolean; az: number; alt: number }[] = [];
  for (let clock = 0; clock < 360; clock += 2) {
    const hour = ((clock - 180) * Math.PI) / 180;
    const dayFrac = (clock - 180) / 360;
    const sunAlt = altitudeDeg(sunDec, hour);
    const body = at(hour, dayFrac);
    const alt = altitudeDeg(body.dec, body.hour);
    const fromSun = sphereGap(sunDec, body.dec, hour - body.hour);
    const lit = sun ? alt >= 0 : name === "Hold" ? alt >= 2 && fromSun >= 10 : alt >= 2 && sunAlt <= -8;
    samples.push({ lit, alt, az: azimuthDeg(body.dec, body.hour) });
  }
  const flags = samples.map((sample) => sample.lit);
  const count = flags.filter(Boolean).length;
  if (count === 0) {
    const maxAlt = Math.max(...samples.map((sample) => sample.alt));
    const kind = !sun && maxAlt >= 2 ? "nappal" as const : "nincs" as const;
    return [{ name, color, start: 0, end: 0, kind }];
  }
  if (count === flags.length) return [{ name, color, start: 0, end: 360, kind: "mindig" as const }];
  const n = flags.length;
  let origin = 0;
  while (origin < n && flags[origin]) origin += 1;
  const runs: { idx: number; len: number }[] = [];
  let k = 0;
  while (k < n) {
    const idx = (origin + k) % n;
    if (!flags[idx]) {
      k += 1;
      continue;
    }
    let len = 0;
    while (len < n && flags[(idx + len) % n]) len += 1;
    runs.push({ idx, len });
    k += len;
  }
  return runs.map((run) => {
    const azimuths: number[] = [];
    for (let step = 0; step < run.len; step += 1) azimuths.push(samples[(run.idx + step) % n].az);
    const arc = coverArc(azimuths);
    return { name, color, start: arc.start, end: arc.end, kind: arc.kind };
  });
}

function siriusShine(sunAlt: number, siriusAlt: number) {
  return siriusAlt >= 2 && sunAlt <= -8 ? 1 : 0;
}

function dayFromAltitude(sunAlt: number, twilight: number) {
  const depth = Math.max(1, twilight);
  if (sunAlt >= 0) return 1;
  if (sunAlt <= -depth) return 0;
  return 1 - smooth01(-sunAlt / depth);
}

function clockLabel(azimuth: number) {
  const hour = (((12 + (azimuth - 180) / 15) % 24) + 24) % 24;
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

type ConjMode = "now" | "year" | "span";
type ConjBody = { name: string; color: string; ra: number; dec: number; moving: boolean };
type ConjRow = {
  id: string;
  title: string;
  names: string[];
  colors: string[];
  gap: number;
  era: "ie" | "isz";
  year: number;
  month: number;
  day: number;
  azimuth: number;
  azs: [number, number];
  decs: [number, number];
  shifts: [number, number];
  sunDec: number;
};

function hourAzimuth(hour: number) {
  return ((180 + (hour - 12) * 15) % 360 + 360) % 360;
}

function clockHour(azimuth: number) {
  return (((12 + (azimuth - 180) / 15) % 24) + 24) % 24;
}

function angularGap(a: ConjBody, b: ConjBody) {
  const r1 = (a.ra * Math.PI) / 180;
  const d1 = (a.dec * Math.PI) / 180;
  const r2 = (b.ra * Math.PI) / 180;
  const d2 = (b.dec * Math.PI) / 180;
  const cos = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(r1 - r2);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

function conjBodies(jd: number, extra: ConjBody[]) {
  const sun = sunEquator(jd);
  const places = planetPlaces(jd, sun.ra);
  const list: ConjBody[] = [
    { name: "Nap", color: "#ca8a04", ra: sun.ra, dec: sun.dec, moving: true },
    ...places.map((star) => ({
      name: star.nev,
      color: star.color,
      ra: (sun.ra + (star.shift * 180) / Math.PI + 360) % 360,
      dec: (star.dec * 180) / Math.PI,
      moving: true,
    })),
  ];
  const seen = new Set(list.map((item) => item.name));
  for (const star of extra) {
    if (seen.has(star.name)) continue;
    seen.add(star.name);
    list.push(star);
  }
  return list;
}

function walkDay(astro: number, month: number, day: number, step: number) {
  const lengths = () => [31, astro % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let days = lengths();
  day += step;
  while (day > days[month - 1]) {
    day -= days[month - 1];
    month += 1;
    if (month > 12) {
      month = 1;
      astro += 1;
      days = lengths();
    }
  }
  return { astro, month, day };
}

function eraLabel(astro: number) {
  if (astro < 1) return { era: "ie" as const, year: 1 - astro, text: `i. e. ${1 - astro}` };
  return { era: "isz" as const, year: astro, text: `i. sz. ${astro}` };
}

const FESTIVALS: { month: number; day: number; name: string; label?: string; lunar?: boolean; about: string }[] = [
  { month: 1, day: 1, name: "Újév, Ré-Harakhti születése", label: "Újév", about: "A polgári év első napja, Thot 1. Ré-Harakhti születésnapja. Ezen a napon nyitják az év rítusait, és a templom megújítja a kultuszképet. Denderában Hathor évének kezdete is ide kötődik." },
  { month: 1, day: 15, name: "Áldozat Hapi és Ámonnak", about: "Thot 15. Áldozat a Nílusnak, Hapinak, és Ámonnak. A folyó és a thébai isten részesedik a templom javadalmából." },
  { month: 1, day: 18, name: "Vág-ünnep", label: "Vág", about: "Thot 18. Ozirisz és az elhunytak ünnepe. Libációt és áldozatot visznek az ősöknek, és megkezdődik Ozirisz évi útja." },
  { month: 1, day: 20, name: "A részegség ünnepe", label: "Részegség", about: "Thot 20. Hathor részegségének ünnepe. A mítosz szerint az emberiség ellen küldött istennőt sörrel csillapították. A templomban zene, ital és Hathor megnyugtatása a rítus." },
  { month: 1, day: 22, name: "Ozirisz nagy menete", about: "Thot 22. Ozirisz képmását körmenetben viszik. A menet a Vág-ünnep utáni napokhoz tartozik." },
  { month: 2, day: 15, name: "Opet, Théba", label: "Opet", about: "Paopi 15-től. Ámon, Mut és Khonszu bárkája Karnakból a luxori templomba megy, és a királyi hatalom megújul. A külső barna sáv ennek az útnak a napjait jelöli, Paopi 15-től körülbelül Hathor elejéig." },
  { month: 3, day: 1, name: "Hathor ünnepe", label: "Hathor", about: "Hathor hónap 1. napja, a harmadik áradási hónap. A hónap az istennő nevét viseli. Denderában ezen a napon jön elő Hathor, a templom úrnője: körmenet és áldozat a szentélyében." },
  { month: 4, day: 18, name: "Khoiak, Ozirisz misztériuma", label: "Khoiak", about: "Khoiak 18-tól a hónap végéig. Ozirisz misztériuma: gabonából formázzák a testét, őrzik, eltemetik, majd a hónap végén feltámad. A belső zöld sáv ezeknek a napoknak az íve." },
  { month: 4, day: 26, name: "Szokár ünnepe", label: "Szokár", about: "Khoiak 26. Szokár, a memphiszi halotti isten ünnepe. Szánon körülhordozzák a képmását, összekapcsolva Ozirisz feltámadásával." },
  { month: 4, day: 30, name: "A dzsed-oszlop felállítása", label: "Dzsed", about: "Khoiak 30. A dzsed-oszlop felállítása. Ozirisz gerincének és a tartós rendnek a rítusa, a Khoiak záró napján." },
  { month: 5, day: 1, name: "Nehebkau", label: "Nehebkau", about: "Tobi 1. Nehebkau, a kígyóisten ünnepe a peret évszak élén. A ka megerősítése és az évszakváltás." },
  { month: 5, day: 29, name: "A fűzfa felemelése", about: "Tobi 29. A fűzfa felemelése. A szent fa Oziriszhez és a megújuló növényzethez kötődik." },
  { month: 6, day: 1, name: "Anubisz hajózása", about: "Mekhir 1. Anubisz bárkájának ünnepe. A balzsamozás istene vízi meneten jelenik meg." },
  { month: 6, day: 30, name: "Az ég felemelése", label: "Ég", about: "Mekhir 30. Az ég felemelése. Su szétválasztja az eget és a földet. Geb és Nut ünnepe az évszak végén." },
  { month: 7, day: 1, name: "Ptah ünnepe", about: "Phamenot 1. Ptah, a memphiszi teremtő ünnepe. A kézművesek és a teremtés istene kap áldozatot." },
  { month: 7, day: 21, name: "I. Amenhotep ünnepe", about: "Phamenot 21. I. Amenhotep, a megistenült király ünnepe. A thébai nyugati parton gyógyító és jósló kultusza volt." },
  { month: 8, day: 4, name: "Basztet", about: "Pharmuti 4. Basztet, a bubasztiszi macskaistennő ünnepe. Zene és körmenet tartozik hozzá." },
  { month: 8, day: 25, name: "Aratási áldozat", about: "Pharmuti 25. Áldozat az aratás kezdetén. A termés első része az isteneké." },
  { month: 9, day: 1, name: "Renenutet, Nepri születése", about: "Pakhon 1. Renenutet és Nepri, a termés és a gabona istenei. A semu, az aratás évszakának nyitánya. Nepri születésnapja." },
  { month: 9, day: 11, name: "Min ünnepe", label: "Min", about: "Pakhon 11. Min ünnepe, a termékenység és a királyi erő. A király kivágja az első kévét, Min képmását körmenet viszi." },
  { month: 10, day: 15, name: "A völgy szép ünnepe, újhold", label: "Völgy", lunar: true, about: "Paoni 15, újholdhoz kötve. Ámon bárkája a Nílus nyugati partjára megy, a halotti templomokhoz. A családok az elhunytakkal ünnepelnek." },
  { month: 11, day: 1, name: "A szép egyesülés, újholdtól", label: "Egyesülés", lunar: true, about: "Ipip 1-től, újholdtól számítva, körülbelül két hétig. Hathor denderai képmása Edfuba hajózik Hóruszhoz. A két isten násza, majd Hathor visszatérése. A külső vörös sáv ennek az ívnek a helye." },
  { month: 11, day: 15, name: "Áldozat Hapi és Ámonnak", about: "Ipip 15. Újabb áldozat Hapinak és Ámonnak, a Thot 15-i áldozat párja az év másik felében." },
  { month: 12, day: 2, name: "Ipip ünnepe", about: "Meszoré 2. A záró hónap ünnepe. Ipet, a thébai születésistennő és a hónap névadója kapja a rítust." },
  { month: 12, day: 30, name: "Az év előestéje", about: "Meszoré 30. Az év előestéje, az öt epagomenális nap előtt. Lezárják az évet, és előkészítik az istenek születésnapjait." },
];

function sunLongitude(jd: number) {
  const century = (jd - 2451545) / 36525;
  const mean = 280.46646 + 36000.76983 * century + 0.0003032 * century * century;
  const anomaly = 357.52911 + 35999.05029 * century - 0.0001537 * century * century;
  const rad = (anomaly * Math.PI) / 180;
  const center = (1.914602 - 0.004817 * century) * Math.sin(rad) + (0.019993 - 0.000101 * century) * Math.sin(2 * rad) + 0.000289 * Math.sin(3 * rad);
  return ((mean + center) % 360 + 360) % 360;
}

function paintFestivalRing(ctx: CanvasRenderingContext2D, w: number, h: number, astro: number, month: number, day: number) {
  const cx = w / 2;
  const cy = h / 2;
  const scale = (Math.min(w, h) * 0.3) / 112;
  const months = ["Thot", "Paopi", "Hathor", "Khoiak", "Tobi", "Mekhir", "Phamenot", "Pharmuti", "Pakhon", "Paoni", "Ipip", "Meszoré"];
  const tone = (index: number) => (index < 4 ? "#8ec3dc" : index < 8 ? "#8fb57a" : "#e0b15c");
  const safeMonth = Math.min(12, Math.max(1, month || 7));
  const safeDay = Math.min(31, Math.max(1, day || 16));
  const nabonassar = julianDay(-746, 2, 26);
  const selected = julianDay(astro, safeMonth, safeDay);
  const thoth = nabonassar + Math.floor(Math.floor(selected - nabonassar) / 365) * 365;
  const lonOf = (index: number) => sunLongitude(thoth + index);
  const ang = (lon: number) => ((lon - 180) * Math.PI) / 180;
  const at = (lon: number, radius: number) => [cx + Math.cos(ang(lon)) * radius * scale, cy + Math.sin(ang(lon)) * radius * scale];
  const ring = (start: number, end: number, inner: number, outer: number, color: string, alpha: number) => {
    const lon0 = lonOf(start);
    let lon1 = lonOf(end);
    while (lon1 < lon0) lon1 += 360;
    ctx.beginPath();
    ctx.arc(cx, cy, outer * scale, ang(lon0), ang(lon1));
    ctx.arc(cx, cy, inner * scale, ang(lon1), ang(lon0), true);
    ctx.closePath();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,252,245,0.9)";
    ctx.lineWidth = Math.max(1, scale * 0.6);
    ctx.stroke();
  };
  const label = (text: string, lon: number, radius: number, size: number, color: string, align: CanvasTextAlign = "center") => {
    const [x, y] = at(lon, radius);
    ctx.font = `700 ${Math.max(11, size * scale)}px sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(3, scale * 1.4);
    ctx.strokeStyle = "rgba(255,252,245,0.92)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  ctx.save();
  months.forEach((_, index) => ring(index * 30, (index + 1) * 30, 72, 112, tone(index), 0.72));
  ring(360, 365, 72, 112, "#d6d3d1", 0.8);
  ring(101, 120, 56, 68, "#0f766e", 0.85);
  ring(44, 71, 116, 126, "#7c2d12", 0.8);
  ring(300, 314, 116, 126, "#9a3412", 0.75);
  months.forEach((name, index) => label(name, lonOf(index * 30 + 15), 92, 8, "#1c1917"));
  label("5 nap", lonOf(362.5), 92, 7, "#1c1917");
  for (const mark of [
    { lon: 90, name: "Nyár" },
    { lon: 180, name: "Ősz" },
    { lon: 270, name: "Tél" },
    { lon: 0, name: "Tavasz" },
  ]) {
    const [x0, y0] = at(mark.lon, 114);
    const [x1, y1] = at(mark.lon, 124);
    ctx.strokeStyle = "#e6a100";
    ctx.lineWidth = Math.max(2, scale);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    label(mark.name, mark.lon, 58, 9, "#a16207");
  }
  let previous = -999;
  let tier = 0;
  for (const fest of FESTIVALS) {
    const index = (fest.month - 1) * 30 + fest.day - 1;
    const lon = lonOf(index);
    if (fest.label) {
      const gap = (lon - previous + 360) % 360;
      tier = gap < 18 ? tier + 1 : 0;
      previous = lon;
    }
    const [x, y] = at(lon, 112);
    ctx.beginPath();
    ctx.arc(x, y, (fest.label ? 3.2 : 2) * scale, 0, Math.PI * 2);
    ctx.fillStyle = fest.lunar ? "#fff" : "#1c1917";
    ctx.fill();
    ctx.lineWidth = Math.max(1, scale * 0.4);
    ctx.strokeStyle = "#1c1917";
    ctx.stroke();
    if (fest.label) {
      const left = Math.cos(ang(lon)) < 0;
      label(fest.label, lon, 132 + Math.min(tier, 3) * 13, 9, "#1c1917", left ? "right" : "left");
    }
  }
  const [sx, sy] = at(sunLongitude(selected), 128);
  ctx.beginPath();
  ctx.arc(sx, sy, 5.5 * scale, 0, Math.PI * 2);
  ctx.fillStyle = "#e6a100";
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, scale * 0.6);
  ctx.strokeStyle = "#1c1917";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 28 * scale, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,252,245,0.88)";
  ctx.fill();
  ctx.strokeStyle = "#d6d3d1";
  ctx.lineWidth = Math.max(1, scale * 0.5);
  ctx.stroke();
  const yearLabel = astro < 1 ? `i. e. ${1 - astro}` : `i. sz. ${astro}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.max(12, 10 * scale)}px sans-serif`;
  ctx.lineWidth = Math.max(3, scale);
  ctx.strokeStyle = "rgba(255,252,245,0.92)";
  ctx.strokeText("Nap járása", cx, cy - 8 * scale);
  ctx.fillStyle = "#1c1917";
  ctx.fillText("Nap járása", cx, cy - 8 * scale);
  ctx.font = `600 ${Math.max(11, 9 * scale)}px sans-serif`;
  ctx.fillStyle = "#57534e";
  ctx.fillText(yearLabel, cx, cy + 10 * scale);
  ctx.restore();
}

const FEST_MONTHS = ["Thot", "Paopi", "Hathor", "Khoiak", "Tobi", "Mekhir", "Phamenot", "Pharmuti", "Pakhon", "Paoni", "Ipip", "Meszoré"];
const FEST_BANDS = [
  { start: 44, end: 71, inner: 112, outer: 138, month: 2, day: 15 },
  { start: 101, end: 120, inner: 50, outer: 74, month: 4, day: 18 },
  { start: 300, end: 314, inner: 112, outer: 138, month: 11, day: 1 },
];

function festivalWhen(fest: { month: number; day: number; lunar?: boolean }) {
  const monthName = FEST_MONTHS[fest.month - 1] || "";
  return `${fest.month}. hónap ${fest.day}. nap · ${monthName} ${fest.day}.${fest.lunar ? " · újholdhoz kötött" : ""}`;
}

function festivalAt(x: number, y: number, w: number, h: number, astro: number, month: number, day: number) {
  const cx = w / 2;
  const cy = h / 2;
  const scale = (Math.min(w, h) * 0.3) / 112;
  const dx = x - cx;
  const dy = y - cy;
  const radius = Math.hypot(dx, dy) / scale;
  if (radius < 46 || radius > 176) return null;
  const lon = ((Math.atan2(dy, dx) * 180) / Math.PI + 180 + 360) % 360;
  const safeMonth = Math.min(12, Math.max(1, month || 7));
  const safeDay = Math.min(31, Math.max(1, day || 16));
  const thoth = julianDay(-746, 2, 26) + Math.floor(Math.floor(julianDay(astro, safeMonth, safeDay) - julianDay(-746, 2, 26)) / 365) * 365;
  const lonOf = (index: number) => sunLongitude(thoth + index);
  let index = 0;
  let best = 999;
  for (let i = 0; i <= 365; i += 1) {
    let gap = Math.abs(lonOf(i) - lon);
    if (gap > 180) gap = 360 - gap;
    if (gap < best) {
      best = gap;
      index = i;
    }
  }
  const byDate = (itemMonth: number, itemDay: number) => FESTIVALS.find((fest) => fest.month === itemMonth && fest.day === itemDay);
  let nearest: (typeof FESTIVALS)[number] | null = null;
  let nearestDist = 22 * scale;
  for (const fest of FESTIVALS) {
    const festIndex = (fest.month - 1) * 30 + fest.day - 1;
    const festLon = lonOf(festIndex);
    const px = cx + Math.cos(((festLon - 180) * Math.PI) / 180) * 112 * scale;
    const py = cy + Math.sin(((festLon - 180) * Math.PI) / 180) * 112 * scale;
    const dist = Math.hypot(x - px, y - py);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = fest;
    }
  }
  if (nearest) return { name: nearest.name, about: nearest.about, when: festivalWhen(nearest) };
  const band = FEST_BANDS.find((item) => radius >= item.inner && radius <= item.outer && index >= item.start && index <= item.end);
  const bandFest = band ? byDate(band.month, band.day) : undefined;
  if (bandFest) return { name: bandFest.name, about: bandFest.about, when: festivalWhen(bandFest) };
  if (radius >= 72 && radius <= 114 && index < 360) {
    const monthNo = Math.floor(index / 30) + 1;
    const inMonth = FESTIVALS.filter((fest) => fest.month === monthNo);
    if (inMonth.length) {
      const picked = inMonth.reduce((bestFest, fest) => {
        const festIndex = (fest.month - 1) * 30 + fest.day - 1;
        const gap = Math.abs(festIndex - index);
        const bestIndex = (bestFest.month - 1) * 30 + bestFest.day - 1;
        return gap < Math.abs(bestIndex - index) ? fest : bestFest;
      });
      return { name: picked.name, about: picked.about, when: festivalWhen(picked) };
    }
  }
  let labeled: (typeof FESTIVALS)[number] | null = null;
  let labeledGap = 9;
  for (const fest of FESTIVALS) {
    if (!fest.label) continue;
    const festLon = lonOf((fest.month - 1) * 30 + fest.day - 1);
    let gap = Math.abs(festLon - lon);
    if (gap > 180) gap = 360 - gap;
    if (gap < labeledGap && radius >= 120 && radius <= 176) {
      labeledGap = gap;
      labeled = fest;
    }
  }
  if (labeled) return { name: labeled.name, about: labeled.about, when: festivalWhen(labeled) };
  return null;
}

function inAngleRange(angle: number, from: number, to: number) {
  const a = ((from % 180) + 180) % 180;
  const b = ((to % 180) + 180) % 180;
  const z = ((angle % 180) + 180) % 180;
  if (Math.abs(a - b) < 1e-9) return Math.abs(z - a) < 0.05 || Math.abs(z - a - 180) < 0.05;
  if (a <= b) return z >= a && z <= b;
  return z >= a || z <= b;
}

const DEFAULT_PLANETS = planetPlaces(julianDayNoon(-53, 7, 16), 111.25);

type DecayTrace = { name: string; color: string; alt: number[]; az: number[] };

function decayAltitudes(dec: number, shift: number) {
  const steps = 96;
  const alt: number[] = [];
  const az: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const ha = (i / steps) * Math.PI * 2 - Math.PI - shift;
    alt.push(altitudeDeg(dec, ha));
    az.push(azimuthDeg(dec, ha));
  }
  return { alt, az };
}

function paintDecayCanvas(canvas: HTMLCanvasElement | null, traces: DecayTrace[], progress: number) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const unit = Math.max(1, Math.min(w, h) / 210);
  const left = 34 * unit;
  const right = 12 * unit;
  const top = 16 * unit;
  const bottom = 28 * unit;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const yMin = -40;
  const yMax = 90;
  const yOf = (alt: number) => top + ((yMax - alt) / (yMax - yMin)) * plotH;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, w, h);
  ctx.font = `600 ${Math.round(12 * unit)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(226,232,240,0.12)";
  ctx.lineWidth = unit;
  for (const hour of [0, 6, 12, 18, 24]) {
    const x = left + (hour / 24) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotH);
    ctx.stroke();
    ctx.fillStyle = "rgba(226,232,240,0.75)";
    ctx.fillText(String(hour), x, h - 14 * unit);
  }
  const horizon = yOf(0);
  ctx.save();
  ctx.setLineDash([4 * unit, 4 * unit]);
  ctx.strokeStyle = "rgba(248,250,252,0.55)";
  ctx.beginPath();
  ctx.moveTo(left, horizon);
  ctx.lineTo(left + plotW, horizon);
  ctx.stroke();
  ctx.restore();
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(226,232,240,0.75)";
  ctx.fillText("0°", 4 * unit, horizon);
  if (!traces.length) {
    ctx.fillStyle = "#e2e8f0";
    ctx.textAlign = "center";
    ctx.fillText("Nincs bejelölt objektum", w / 2, h / 2);
    return;
  }
  const count = traces[0].alt.length;
  const last = Math.max(1, Math.floor(progress * (count - 1)));
  for (const trace of traces) {
    ctx.beginPath();
    for (let i = 0; i <= last; i += 1) {
      const x = left + (i / (count - 1)) * plotW;
      const y = yOf(trace.alt[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = trace.color;
    ctx.lineWidth = (trace.name === "Nap" ? 2.6 : 1.8) * unit;
    ctx.shadowColor = trace.color;
    ctx.shadowBlur = 10 * unit;
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (progress > 0.2) {
      const x = left + (last / (count - 1)) * plotW;
      const y = yOf(trace.alt[last]);
      ctx.fillStyle = trace.color;
      ctx.fillText(trace.name, Math.min(x + 8 * unit, w - 72 * unit), y);
    }
  }
  const head = left + progress * plotW;
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = unit;
  ctx.beginPath();
  ctx.moveTo(head, top);
  ctx.lineTo(head, top + plotH);
  ctx.stroke();
}

function paintRing360(canvas: HTMLCanvasElement | null, traces: DecayTrace[], progress: number, sunTopIn: number) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const unit = Math.max(1, Math.min(w, h) / 360);
  const sunTop = Math.max(24, Math.min(89, sunTopIn || 55));
  const R = 1;
  const camZ = 2.7;
  const yScale = 1.45 / sunTop;
  const camY = (sunTop * yScale) / 2;
  const facingCut = -R / camZ;
  const facing = (az: number) => Math.cos((az * Math.PI) / 180) < facingCut;
  const raw = (az: number, alt: number) => {
    const rad = (az * Math.PI) / 180;
    const x = Math.sin(rad) * R;
    const z = Math.cos(rad) * R;
    const relZ = z + camZ;
    return { nx: x / relZ, ny: (alt * yScale - camY) / relZ, front: facing(az) };
  };
  let maxNx = 0.001;
  let maxNy = 0.001;
  for (let az = 0; az <= 360; az += 3) {
    for (const alt of [-18, 0, sunTop, sunTop + 14]) {
      const p = raw(az, alt);
      maxNx = Math.max(maxNx, Math.abs(p.nx));
      maxNy = Math.max(maxNy, Math.abs(p.ny));
    }
  }
  const f = Math.min((w * 0.42) / maxNx, (h * 0.4) / maxNy);
  const cx = w / 2;
  const cy = h / 2;
  const project = (az: number, alt: number) => {
    const p = raw(az, alt);
    return { x: cx + p.nx * f, y: cy - p.ny * f, front: p.front };
  };
  ctx.clearRect(0, 0, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#07111c");
  sky.addColorStop(0.5, "#123049");
  sky.addColorStop(1, "#1c1917");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  let started = false;
  for (let alt = -18; alt <= sunTop + 14; alt += 2) {
    let left: { x: number; y: number } | null = null;
    for (let az = 0; az < 360; az += 3) {
      const p = project(az, alt);
      if (!left || p.x < left.x) left = p;
    }
    if (!left) continue;
    if (!started) {
      ctx.moveTo(left.x, left.y);
      started = true;
    } else ctx.lineTo(left.x, left.y);
  }
  for (let alt = sunTop + 14; alt >= -18; alt -= 2) {
    let right: { x: number; y: number } | null = null;
    for (let az = 0; az < 360; az += 3) {
      const p = project(az, alt);
      if (!right || p.x > right.x) right = p;
    }
    if (right) ctx.lineTo(right.x, right.y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(186,230,253,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(224,242,254,0.55)";
  ctx.lineWidth = 1.5 * unit;
  ctx.stroke();
  for (const front of [false, true]) {
    for (let az = 0; az < 360; az += 30) {
      if (facing(az) !== front) continue;
      ctx.beginPath();
      for (let alt = -18; alt <= sunTop + 14; alt += 3) {
        const p = project(az, alt);
        if (alt === -18) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = "rgba(224,242,254,0.4)";
      ctx.globalAlpha = front ? 0.5 : 0.18;
      ctx.lineWidth = unit;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  const strokeRing = (alt: number, front: boolean, color: string, width: number, alpha: number) => {
    ctx.beginPath();
    let open = false;
    for (let az = 0; az <= 360; az += 2) {
      if (facing(az) !== front) {
        open = false;
        continue;
      }
      const p = project(az, alt);
      if (!open) {
        ctx.moveTo(p.x, p.y);
        open = true;
      } else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  strokeRing(sunTop, false, "#e6a100", 1.5 * unit, 0.35);
  strokeRing(0, false, "#f5f5f4", 1.6 * unit, 0.35);
  strokeRing(sunTop, true, "#e6a100", 2.2 * unit, 0.95);
  strokeRing(0, true, "#f5f5f4", 2.4 * unit, 1);
  const count = traces[0]?.az?.length ?? 0;
  const last = count ? Math.max(0, Math.min(count - 1, Math.round(progress * (count - 1)))) : 0;
  const drawPaths = (front: boolean) => {
    if (!count) return;
    for (const trace of traces) {
      const run = (upto: number, alpha: number, width: number) => {
        ctx.beginPath();
        let open = false;
        for (let i = 0; i <= upto; i += 1) {
          if (facing(trace.az[i]) !== front) {
            open = false;
            continue;
          }
          const p = project(trace.az[i], trace.alt[i]);
          if (!open) {
            ctx.moveTo(p.x, p.y);
            open = true;
          } else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = trace.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      run(count - 1, front ? 0.28 : 0.12, 1.4 * unit);
      run(last, front ? 1 : 0.3, (front ? 2.4 : 1.5) * unit);
      if (facing(trace.az[last]) !== front) continue;
      const now = project(trace.az[last], trace.alt[last]);
      ctx.beginPath();
      ctx.arc(now.x, now.y, (front ? 5 : 3.5) * unit, 0, Math.PI * 2);
      ctx.fillStyle = trace.color;
      ctx.globalAlpha = front ? 1 : 0.45;
      ctx.fill();
      ctx.lineWidth = 1.4 * unit;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.font = `700 ${11 * unit}px sans-serif`;
      ctx.fillStyle = "#f5f5f4";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(trace.name, now.x + 8 * unit, now.y);
      ctx.globalAlpha = 1;
    }
  };
  drawPaths(false);
  drawPaths(true);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${12 * unit}px sans-serif`;
  for (const [az, name] of [[0, "Észak"], [90, "Kelet"], [180, "Dél"], [270, "Nyugat"]] as const) {
    const p = project(az, 0);
    ctx.globalAlpha = facing(az) ? 0.95 : 0.4;
    ctx.fillStyle = "#f5f5f4";
    ctx.fillText(name, p.x, p.y + 16 * unit);
  }
  const southH = project(180, 0);
  const southS = project(180, sunTop);
  ctx.globalAlpha = 0.95;
  ctx.font = `600 ${11 * unit}px sans-serif`;
  ctx.fillStyle = "#f5f5f4";
  ctx.fillText("horizont", southH.x, southH.y - 16 * unit);
  ctx.fillStyle = "#f6d36b";
  ctx.fillText("Nap delelése", southS.x, southS.y - 16 * unit);
  ctx.globalAlpha = 1;
  if (!count) {
    ctx.fillStyle = "#e7e5e4";
    ctx.font = `600 ${14 * unit}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("Nincs bejelölt objektum", cx, h - 28 * unit);
  }
  const minutes = Math.round(progress * 24 * 60) % (24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#f5f5f4";
  ctx.font = `800 ${14 * unit}px sans-serif`;
  ctx.fillText(`${hh}:${mm}`, 12 * unit, h - 10 * unit);
}

function roundDecaySpeed(value: number) {
  const v = Math.min(4, Math.max(0.01, value));
  if (v <= 1) return Math.round(v * 100) / 100;
  return Math.round((1 + Math.round((v - 1) / 0.05) * 0.05) * 100) / 100;
}

function nudgeDecaySpeed(value: number, direction: number) {
  const current = roundDecaySpeed(value);
  if (direction < 0) return roundDecaySpeed(current <= 1 ? current - 0.01 : current - 0.05);
  return roundDecaySpeed(current < 1 ? current + 0.01 : current + 0.05);
}

function speedToPos(value: number) {
  const v = roundDecaySpeed(value);
  if (v <= 1) return Math.round((v - 0.01) * 100);
  return 99 + Math.round((v - 1) / 0.05);
}

function posToSpeed(pos: number) {
  const p = Math.max(0, Math.min(159, Math.round(pos)));
  if (p <= 99) return Math.round((0.01 + p * 0.01) * 100) / 100;
  return Math.round((1 + (p - 99) * 0.05) * 100) / 100;
}

function formatDecaySpeed(value: number) {
  const v = roundDecaySpeed(value);
  const raw = v < 1 ? v.toFixed(2) : v.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return raw.replace(".", ",") + "×";
}

function DecayChart({ traces, sunTop, onFrame }: { traces: DecayTrace[]; sunTop: number; onFrame: (progress: number, floor: boolean, ring: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLCanvasElement>(null);
  const tracesRef = useRef(traces);
  const sunTopRef = useRef(sunTop);
  const speedRef = useRef(1);
  const floorRef = useRef(false);
  const ringFlag = useRef(false);
  const onFrameRef = useRef(onFrame);
  tracesRef.current = traces;
  sunTopRef.current = sunTop;
  onFrameRef.current = onFrame;
  const [run, setRun] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [floor, setFloor] = useState(false);
  const [ring, setRing] = useState(false);
  useEffect(() => {
    let acc = 0;
    let raf = 0;
    const loop = () => {
      acc = (acc + speedRef.current) % 280;
      const progress = acc / 280;
      paintDecayCanvas(ref.current, tracesRef.current, progress);
      if (ringFlag.current) paintRing360(ringRef.current, tracesRef.current, progress, sunTopRef.current);
      onFrameRef.current(progress, floorRef.current, ringFlag.current);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [run]);
  return (
    <div className="mt-3 w-[340px]">
      <p className="text-sm font-semibold text-stone-900">Lecsengés</p>
      <canvas ref={ref} width={340} height={210} className="mt-1 h-[210px] w-[340px] rounded-lg" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setRun((value) => value + 1)} className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-semibold text-white">
          Indítás
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !floor;
            floorRef.current = next;
            if (next) {
              ringFlag.current = false;
              setRing(false);
            }
            setFloor(next);
          }}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${floor ? "bg-stone-900 text-white" : "border border-stone-900"}`}
        >
          Padlóra
        </button>
        <label className="flex items-center gap-1 text-xs text-stone-700">
          Sebesség
          <button
            type="button"
            onClick={() => {
              const next = nudgeDecaySpeed(speedRef.current, -1);
              speedRef.current = next;
              setSpeed(next);
            }}
            className="h-7 w-7 rounded border border-stone-900 text-sm font-semibold"
          >
            −
          </button>
          <input
            type="range"
            min={0}
            max={159}
            step={1}
            value={speedToPos(speed)}
            onChange={(event) => {
              const next = posToSpeed(Number(event.target.value));
              speedRef.current = next;
              setSpeed(next);
            }}
            className="w-24"
          />
          <button
            type="button"
            onClick={() => {
              const next = nudgeDecaySpeed(speedRef.current, 1);
              speedRef.current = next;
              setSpeed(next);
            }}
            className="h-7 w-7 rounded border border-stone-900 text-sm font-semibold"
          >
            +
          </button>
          {formatDecaySpeed(speed)}
        </label>
        <button
          type="button"
          onClick={() => {
            const next = !ring;
            ringFlag.current = next;
            if (next) {
              floorRef.current = false;
              setFloor(false);
            }
            setRing(next);
          }}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${ring ? "bg-stone-900 text-white" : "border border-stone-900"}`}
        >
          360-fok
        </button>
      </div>
      {ring ? (
        <>
          <canvas ref={ringRef} width={340} height={360} className="mt-2 h-[360px] w-[340px] rounded-lg" />
          <p className="mt-1 text-[11px] leading-4 text-stone-600">Üveghenger kívülről, a horizont és a Nap delelése között félúton. A túloldal az üvegen át halványan látszik. Dél van elöl. Ugyanez a padló helyén is látszik.</p>
        </>
      ) : null}
      <p className="mt-1 text-[11px] leading-4 text-stone-600">Csak a bejelölt objektumok görbéje látszik. A szaggatott vonal a horizont, a számok órák. A Padlóra gomb a padló képét cseréli le erre.</p>
    </div>
  );
}

function FugaAnim() {
  const radiantMatch = useMemo(() => bestRadiantMatch(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const altLiveRef = useRef<AltItem[]>([]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const groupsRef = useRef<FugaGroup[]>([]);
  const fugaGroupsRef = useRef<FugaGroup[]>([]);
  const linesRef = useRef<number[][]>([]);
  const fugaLinesRef = useRef<number[][]>([]);
  const fugaRawRef = useRef<number[][]>([]);
  const atloRawRef = useRef<number[][]>([]);
  const fugaGroupRawRef = useRef<FugaGroup[]>([]);
  const atloGroupRawRef = useRef<FugaGroup[]>([]);
  const [fugaPick, setFugaPick] = useState(false);
  const [pickedFugas, setPickedFugas] = useState<number[]>([]);
  const pickedFugasRef = useRef<number[]>([]);
  pickedFugasRef.current = pickedFugas;
  const [fugaMenu, setFugaMenu] = useState<{ x: number; y: number } | null>(null);
  const [angleRows, setAngleRows] = useState<AngleRow[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ANGLE_KEY) || "[]") as AngleRow[];
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const atloLinesRef = useRef<number[][]>([]);
  const atloGroupsRef = useRef<FugaGroup[]>([]);
  const sourceRef = useRef<"fuga" | "atlo">("fuga");
  const [source, setSource] = useState<"fuga" | "atlo">("fuga");
  const indexRef = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const listRef = useRef<FugaGroup[]>([]);
  const freezeRef = useRef<{ from: number; to: number } | null>(null);
  const compassRef = useRef(false);
  const orientRef = useRef(false);
  const timeOnRef = useRef(false);
  const dayNightRef = useRef(false);
  const fromRef = useRef("100");
  const toRef = useRef("110");
  const [compassOn, setCompassOn] = useState(false);
  const [orientOn, setOrientOn] = useState(false);
  const [timeOn, setTimeOn] = useState(false);
  const [dayNight, setDayNight] = useState(false);
  const [moonYear, setMoonYear] = useState(false);
  const [moonTime, setMoonTime] = useState(false);
  const [moonPlay, setMoonPlay] = useState(false);
  const [conjOpen, setConjOpen] = useState(false);
  const [conjBox, setConjBox] = useState({ x: 16, y: 12, w: 860, h: 380 });
  const [conjMode, setConjMode] = useState<ConjMode | null>(null);
  const [conjRows, setConjRows] = useState<ConjRow[]>([]);
  const [conjIndex, setConjIndex] = useState(0);
  const [conjPlay, setConjPlay] = useState(false);
  const [conjNote, setConjNote] = useState("");
  const [conjFuga, setConjFuga] = useState(false);
  const [conjAtlo, setConjAtlo] = useState(false);
  const [conjEye, setConjEye] = useState(false);
  const conjEyeRef = useRef(false);
  const [conjArcs, setConjArcs] = useState(false);
  const conjArcRef = useRef(false);
  const conjArcBodiesRef = useRef<ReturnType<typeof conjArcBodies>>([]);
  const conjFugaRef = useRef(false);
  const conjAtloRef = useRef(false);
  const conjRowsRef = useRef<ConjRow[]>([]);
  const conjShownRef = useRef<ConjRow[]>([]);
  const conjMarkRef = useRef<ConjRow | null>(null);
  const conjModeRef = useRef<ConjMode | null>(null);
  const conjTokenRef = useRef(0);
  const moonPlayRef = useRef(false);
  const moonCursorRef = useRef(0);
  const moonFromMonthRef = useRef("1");
  const moonFromDayRef = useRef("1");
  const moonToMonthRef = useRef("12");
  const moonToDayRef = useRef("31");
  const moonSpeedRef = useRef(12);
  const moonSectorRef = useRef(false);
  const moonYearArcRef = useRef(false);
  const view3dRef = useRef(false);
  const festRef = useRef(false);
  const decayFloorRef = useRef(false);
  const ringOnRef = useRef(false);
  const decaySunTopRef = useRef(55);
  const decayOpenRef = useRef(false);
  const decayProgressRef = useRef(0);
  const decayTracesRef = useRef<DecayTrace[]>([]);
  const camRef = useRef<Cam>({ ...CAM_HOME });
  const plateRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; orbit: number; tilt: number } | null>(null);
  const [moonFromMonth, setMoonFromMonth] = useState("1");
  const [moonFromDay, setMoonFromDay] = useState("1");
  const [moonToMonth, setMoonToMonth] = useState("12");
  const [moonToDay, setMoonToDay] = useState("31");
  const [moonSpeed, setMoonSpeed] = useState("12");
  const [moonSector, setMoonSector] = useState(false);
  const [moonYearArc, setMoonYearArc] = useState(false);
  const [view3d, setView3d] = useState(false);
  const [cam, setCam] = useState<Cam>({ ...CAM_HOME });
  const floorOnRef = useRef(true);
  const [floorOn, setFloorOn] = useState(true);
  const projectRef = useRef<string | null>("dendera");
  const projectUrls = useRef<Record<string, string>>({});
  const projectFileRef = useRef<HTMLInputElement | null>(null);
  const [projectId, setProjectId] = useState<string | null>("dendera");
  const [projectOpen, setProjectOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [analOpen, setAnalOpen] = useState(false);
  const [barMenu, setBarMenu] = useState<null | "nezet" | "rajz" | "ido" | "eg">(null);
  const [analBox, setAnalBox] = useState({ x: 300, y: 56, w: 880, h: 440 });
  const [analBand, setAnalBand] = useState<AnalBand>("negy");
  const [analFromEra, setAnalFromEra] = useState<"ie" | "isz">("ie");
  const [analFromText, setAnalFromText] = useState("200");
  const [analToEra, setAnalToEra] = useState<"ie" | "isz">("isz");
  const [analToText, setAnalToText] = useState("200");
  const [analOn, setAnalOn] = useState<Record<AnalId, boolean>>({ taj: true, ido: true, napt: true, hold: true, boly: true, csil: true, ritk: true, lat: true });
  const [analHits, setAnalHits] = useState<AnalHit[]>([]);
  const [analCursor, setAnalCursor] = useState(-53);
  const [analPlay, setAnalPlay] = useState(false);
  const [analDir, setAnalDir] = useState(1);
  const [analPace, setAnalPace] = useState(1);
  const [analPick, setAnalPick] = useState<AnalHit | null>(null);
  const [analFloor, setAnalFloor] = useState<{ group: AnalId; kind: AnalKind }[]>([]);
  const [analExplain, setAnalExplain] = useState<AnalId | null>(null);
  const [analNote, setAnalNote] = useState("Még nincs szkennelés.");
  const [analCompare, setAnalCompare] = useState(false);
  const analHitsRef = useRef<AnalHit[]>([]);
  const analCursorRef = useRef(-53);
  const analOnRef = useRef(analOn);
  const analPickRef = useRef<AnalHit | null>(null);
  const analFloorRef = useRef<{ group: AnalId; kind: AnalKind }[]>([]);
  const analOpenRef = useRef(false);
  const analTokenRef = useRef(0);
  const analSpanRef = useRef({ from: -199, to: 200, step: 1 });
  const analDirRef = useRef(1);
  const analPaceRef = useRef(1);
  analHitsRef.current = analHits;
  analCursorRef.current = analCursor;
  analOnRef.current = analOn;
  analPickRef.current = analPick;
  analFloorRef.current = analFloor;
  analOpenRef.current = analOpen;
  analDirRef.current = analDir;
  analPaceRef.current = analPace;
  const [projectNote, setProjectNote] = useState("");
  const [projects, setProjects] = useState<UserProject[]>(loadProjects);
  const projectNameRef = useRef("");
  projectNameRef.current = projectId === "dendera-roof" ? "Dendera roof full2" : (projects.find((item) => item.id === projectId)?.name ?? "");
  const [starts, setStarts] = useState<Record<string, ProjectStart>>(loadStarts);
  const [startFor, setStartFor] = useState<string | null>(null);
  const [startDegText, setStartDegText] = useState("0.00");
  const [floorSrc, setFloorSrc] = useState(FILE);
  const floorSrcRef = useRef("");
  floorSrcRef.current = floorSrc;
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  projectRef.current = projectId;
  const [floorMenu, setFloorMenu] = useState<"beallitas" | "kovek" | "fugak" | "atlok" | null>(null);
  const floorMenuRef = useRef(floorMenu);
  floorMenuRef.current = floorMenu;
  const [stonePick, setStonePick] = useState(false);
  const [pickedStones, setPickedStones] = useState<string[]>(() => {
    const stored = loadLayers();
    return stored.layers.find((layer) => layer.id === stored.current)?.stones ?? [];
  });
  const pickedStonesRef = useRef<string[]>([]);
  pickedStonesRef.current = pickedStones;
  const [layers, setLayers] = useState<StoneLayer[]>(() => loadLayers().layers);
  const [currentLayer, setCurrentLayer] = useState<string | null>(() => loadLayers().current);
  const [layerName, setLayerName] = useState(() => loadLayers().layers.find((layer) => layer.id === loadLayers().current)?.name ?? "");
  useEffect(() => {
    localStorage.setItem(LAYER_KEY, JSON.stringify({ layers, current: currentLayer }));
  }, [layers, currentLayer]);
  const [rulerOn, setRulerOn] = useState(false);
  const [rasterOn, setRasterOn] = useState(false);
  const [rasterSize, setRasterSize] = useState(40);
  const [rasterDeg, setRasterDeg] = useState(0);
  const [rasterPick, setRasterPick] = useState(false);
  const [rasterLineHit, setRasterLineHit] = useState(false);
  const [rasterCrossHit, setRasterCrossHit] = useState(false);
  const [rasterScan, setRasterScan] = useState(false);
  const [scanRows, setScanRows] = useState<ScanRow[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SCAN_KEY) || "[]") as ScanRow[];
      return Array.isArray(saved) ? saved.filter((row) => row && Number.isFinite(row.size)) : [];
    } catch {
      return [];
    }
  });
  const rasterDegRef = useRef(0);
  rasterDegRef.current = rasterDeg;
  const [vertexStamp, setVertexStamp] = useState(0);
  const [rasterAnchor, setRasterAnchor] = useState<{ x: number; y: number } | null>(null);
  const rasterAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const rasterDrag = useRef(false);
  const [recording, setRecording] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoSize, setVideoSize] = useState(0);
  const [recordNote, setRecordNote] = useState("");
  const recordRef = useRef<{ stop: () => Promise<Blob>; url: string } | null>(null);
  const recordLive = useRef(false);
  const floorBoxRef = useRef<HTMLDivElement>(null);
  const floorScrollRef = useRef<HTMLDivElement>(null);
  const [floorZoom, setFloorZoom] = useState(1);
  const floorZoomRef = useRef(1);
  const floorStageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [photoNatural, setPhotoNatural] = useState({ w: 0, h: 0 });
  const [poseOn, setPoseOn] = useState(false);
  const poseOnRef = useRef(false);
  const [floorDeg, setFloorDeg] = useState(HATHOR_DEG);
  const [floorDegText, setFloorDegText] = useState("18,65");
  const [bandStamp, setBandStamp] = useState(0);
  const floorDegRef = useRef(HATHOR_DEG);
  const [hathorOn, setHathorOn] = useState(hathorStartsOn);
  const [floorPan, setFloorPan] = useState({ x: 0, y: 0 });
  const floorPanRef = useRef({ x: 0, y: 0 });
  const poseDrag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const poseMoved = useRef(false);
  useEffect(() => {
    localStorage.setItem(SCAN_KEY, JSON.stringify(scanRows));
  }, [scanRows]);
  useEffect(() => {
    if (!rasterScan) return;
    let size = 12;
    const timer = window.setInterval(() => {
      const img = imgRef.current;
      const box = floorBoxRef.current;
      if (!img?.naturalWidth || !img.naturalHeight || !box?.clientWidth || size > 200) {
        setRasterScan(false);
        return;
      }
      const width = box.clientWidth;
      const height = box.clientHeight;
      const originX = rasterAnchorRef.current ? rasterAnchorRef.current.x : width / 2;
      const originY = rasterAnchorRef.current ? rasterAnchorRef.current.y : height / 2;
      const step = Math.max(4, size * floorZoomRef.current);
      const hits = rasterHits(fugaLinesRef.current, img.naturalWidth, img.naturalHeight, width, height, originX, originY, step, rasterDegRef.current);
      const cross = hits.filter((hit) => hit.cross).length;
      const line = hits.length - cross;
      setRasterSize(size);
      if (line + cross > 0) setScanRows((rows) => [...rows, { size, line, cross }]);
      size = Math.round((size + 0.5) * 100) / 100;
    }, 80);
    return () => window.clearInterval(timer);
  }, [rasterScan]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => drawRef.current());
    return () => cancelAnimationFrame(frame);
  }, [floorZoom, pickedStones]);
  const [zoomWheel, setZoomWheel] = useState(false);
  const zoomWheelRef = useRef(false);
  useEffect(() => {
    const scroller = floorScrollRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (!zoomWheelRef.current) return;
      event.preventDefault();
      const prev = floorZoomRef.current;
      const next = Math.round(Math.min(4, Math.max(1, prev + (event.deltaY < 0 ? 0.25 : -0.25))) * 100) / 100;
      if (next === prev) return;
      const ratio = next / prev;
      const rect = scroller.getBoundingClientRect();
      const anchorX = event.clientX - rect.left + scroller.scrollLeft;
      const anchorY = event.clientY - rect.top + scroller.scrollTop;
      floorZoomRef.current = next;
      rulerRef.current = { ...rulerRef.current, x: rulerRef.current.x * ratio, y: rulerRef.current.y * ratio, len: rulerRef.current.len * ratio };
      setRuler({ ...rulerRef.current });
      setMarks((list) => list.map((mark) => ({ ...mark, x: mark.x * ratio, y: mark.y * ratio, len: mark.len * ratio })));
      if (rasterAnchorRef.current) {
        rasterAnchorRef.current = { x: rasterAnchorRef.current.x * ratio, y: rasterAnchorRef.current.y * ratio };
        setRasterAnchor({ ...rasterAnchorRef.current });
      }
      setFloorZoom(next);
      requestAnimationFrame(() => {
        scroller.scrollLeft = anchorX * ratio - (event.clientX - rect.left);
        scroller.scrollTop = anchorY * ratio - (event.clientY - rect.top);
      });
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);
  const rulerRef = useRef({ x: 0, y: 0, deg: 0, len: 310 });
  const [ruler, setRuler] = useState(rulerRef.current);
  const rulerDrag = useRef<null | { mode: "move" | "turn" | "size"; px: number; py: number; x: number; y: number; flip: boolean }>(null);
  const rulerSvgRef = useRef<SVGSVGElement>(null);
  const markSeq = useRef(1);
  const [marks, setMarks] = useState<{ id: number; x: number; y: number; deg: number; len: number }[]>([]);
  const [hotMark, setHotMark] = useState<number | null>(null);
  const hotMarkRef = useRef<number | null>(null);
  const [rulerHot, setRulerHot] = useState(false);
  const [toolMenu, setToolMenu] = useState<null | { x: number; y: number; kind: "ruler" | "line"; id: number }>(null);
  const fugaHistMenuRef = useRef(false);
  const atloHistMenuRef = useRef(false);
  const fugaBandRef = useRef(false);
  const atloBandRef = useRef(false);
  const [fugaHistMenu, setFugaHistMenu] = useState(false);
  const peakColorRef = useRef(false);
  const [peakColor, setPeakColor] = useState(false);
  const [atloHistMenu, setAtloHistMenu] = useState(false);
  const [fugaBandOn, setFugaBandOn] = useState(false);
  const [atloBandOn, setAtloBandOn] = useState(false);
  const [stoneList, setStoneList] = useState<Stone[]>([]);
  const stoneListRef = useRef<Stone[]>([]);
  stoneListRef.current = stoneList;
  const [stoneId, setStoneId] = useState("1");
  const skyRef = useRef({ sav: false, kel: false, nyug: false, band: false, sun: false, sirius: false, glow: false, aim: false, sunAim: false, siriusAim: false, sunAtlo: false, siriusAtlo: false, alkaid: false, alkaidGlow: false, alkaidAim: false, alkaidAtlo: false, goncol: false, goncolGlow: false, goncolAim: false, goncolAtlo: false, sn: false, snGlow: false, snAim: false, snAtlo: false, met: false, metGlow: false, metAim: false, metAtlo: false, plan: false, planGlow: false, planAim: false, planAtlo: false, zod: false, zodGlow: false, zodAim: false, zodAtlo: false });
  const [sky, setSky] = useState(skyRef.current);
  const [follow, setFollow] = useState<"none" | "nap" | "sirius" | "egyutt" | "alkaid" | "alkaid-fuga" | "alkaid-atlo" | "goncol" | "goncol-mozgas" | "goncol-fuga" | "goncol-atlo" | "bemutato">("none");
  const followRef = useRef(follow);
  followRef.current = follow;
  const [pairMenu, setPairMenu] = useState(false);
  const [pairLines, setPairLines] = useState({ fedes: false, meroleges: false, sirius: false, procyon: false, kot: false, szegely: false, kozel: false, egyenesen: false, derekszog: false, k63: false });
  const sunAzRef = useRef(0);
  const pairLinesRef = useRef({ fedes: false, meroleges: false, sirius: false, procyon: false, kot: false, szegely: false, kozel: false, egyenesen: false, derekszog: false, k63: false });
  const [starOn, setStarOn] = useState<boolean[]>(() => STAR_PAIRS.map(() => false));
  const starOnRef = useRef(starOn);
  const [parallelOn, setParallelOn] = useState<boolean[]>(() => PARALLEL_PAIRS.map(() => false));
  const parallelOnRef = useRef(parallelOn);
  const [starMenu, setStarMenu] = useState(false);
  const [parallelMenu, setParallelMenu] = useState(false);
  const [eastMenu, setEastMenu] = useState(false);
  const [eastFlags, setEastFlags] = useState({ result: false, kel: false, kozos: false, dendera: false, nap: false, fenyes: false, K62: false, K28: false, K29: false, K30: false, K61: false, K63: false, K64: false, K65: false });
  const eastFlagsRef = useRef(eastFlags);
  const pairReadyRef = useRef(false);
  const pairHoldRef = useRef(0);
  const pairLockRef = useRef(false);
  const pairMarkRef = useRef<{ az: number; clock: string; sAlt: number; pAlt: number } | null>(null);
  const twilightRef = useRef("8");
  const sunMsRef = useRef(24000);
  const motionPauseRef = useRef(false);
  const motionDirRef = useRef(1);
  const motionRateRef = useRef(1);
  const motionClockRef = useRef<HTMLSpanElement>(null);
  const [motionPause, setMotionPause] = useState(false);
  const [motionDir, setMotionDir] = useState(1);
  const [motionRate, setMotionRate] = useState(1);
  const dayNumRef = useRef("54");
  const eraRef = useRef<"ie" | "isz">("ie");
  const monthRef = useRef("7");
  const dateDayRef = useRef("16");
  const skyDateRef = useRef<{ sunDec: number; sirDec: number; shift: number; alkDec: number; alkShift: number; alkClock: number | null; dipper: DipperPlace[]; nova: NovaPlace[]; meteor: NovaPlace[]; planet: PlanetPlace[]; zod: PlacedZodiac[]; bright: NovaPlace[] } | null>(null);
  const yearSkyRef = useRef<YearSky | null>(null);
  const yearAstroRef = useRef<number | null>(null);
  const yearCache = useRef(new Map<number, YearSky>());
  const matchRef = useRef("2");
  const sceneRef = useRef<"leltar" | "eg">("leltar");
  const [dayNumText, setDayNumText] = useState("54");
  const [era, setEra] = useState<"ie" | "isz">("ie");
  const [monthText, setMonthText] = useState("7");
  const [dateDayText, setDateDayText] = useState("16");
  const [matchText, setMatchText] = useState("2");
  const [scene, setScene] = useState<"leltar" | "eg">("leltar");
  const [dayText, setDayText] = useState("24");
  const [label, setLabel] = useState("Az azonos szögű fugák betöltése");
  const labelHold = useRef("");
  const [on, setOn] = useState(false);
  const animOnRef = useRef(false);
  const animReasonRef = useRef<"floor" | "settings" | null>(null);
  animOnRef.current = on;
  function setAnim(next: boolean) {
    animOnRef.current = next;
    setOn(next);
  }
  const histOnRef = useRef(false);
  const bandOnRef = useRef(false);
  const sectorOnRef = useRef(false);
  const pathOnRef = useRef(false);
  const culmOnRef = useRef(false);
  const ccwOnRef = useRef(false);
  const histBinsRef = useRef<number[] | null>(null);
  const atloHistOnRef = useRef(false);
  const atloPeaksOnRef = useRef(false);
  const atloHistBinsRef = useRef<number[] | null>(null);
  const [histOn, setHistOn] = useState(false);
  const [atloHistOn, setAtloHistOn] = useState(false);
  const pickedRef = useRef({ ...BLANK_OBJECTS });
  const funcsRef = useRef({ ...BLANK_FUNCTIONS });
  const [picked, setPicked] = useState(pickedRef.current);
  const [funcs, setFuncs] = useState(funcsRef.current);
  const snPickRef = useRef<Record<string, boolean>>(Object.fromEntries(NOVA.map((star) => [star.id, false])));
  const [snPick, setSnPick] = useState(snPickRef.current);
  const metPickRef = useRef<Record<string, boolean>>(Object.fromEntries(METEOR.map((star) => [star.id, false])));
  const [metPick, setMetPick] = useState(metPickRef.current);
  const brightPickRef = useRef<Record<string, boolean>>(Object.fromEntries(BRIGHT.map((star) => [star.id, false])));
  const [brightPick, setBrightPick] = useState(brightPickRef.current);
  const brightModeRef = useRef({ show: false, glow: false, aim: false, atlo: false });
  const planetPickRef = useRef<Record<string, boolean>>(Object.fromEntries([["hold", false], ...PLANET_ROWS.map((star) => [star.id, false] as const)]));
  const [planetPick, setPlanetPick] = useState(planetPickRef.current);
  const zodPickRef = useRef<Record<string, boolean>>(Object.fromEntries(ZODIAC.map((figure) => [figure.id, false])));
  const [zodPick, setZodPick] = useState(zodPickRef.current);
  const [compareRows, setCompareRows] = useState<CompareRow[]>([]);
  const { user, isPending: accountPending } = useCurrentUserState();
  const [setups, setSetups] = useState<SavedSetup[]>([]);
  const [setupError, setSetupError] = useState("");
  const [namingSetup, setNamingSetup] = useState(false);
  const [setupName, setSetupName] = useState("");
  useEffect(() => {
    if (accountPending) return;
    if (!user) {
      setSetups([]);
      return;
    }
    let live = true;
    listSetups()
      .then((rows) => {
        if (!live) return;
        setSetups(rows.filter((item) => item && typeof item.name === "string" && item.data) as SavedSetup[]);
      })
      .catch(() => {
        if (live) setSetups([]);
      });
    return () => {
      live = false;
    };
  }, [accountPending, user?.id]);
  const compareHold = useRef("·");
  const compareTick = useRef(0);
  const [fromText, setFromText] = useState("100");
  const [toText, setToText] = useState("110");
  const [durationText, setDurationText] = useState("0,5");
  const [stepMs, setStepMs] = useState(500);
  const [frozen, setFrozen] = useState(false);
  const [rangeNote, setRangeNote] = useState("");

  sceneRef.current = scene;

  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = imgRef.current;
    const dendera = projectRef.current === "dendera";
    const turnedRoof = isRoofFull2(projectNameRef.current);
    const natW = turnedRoof ? 4108 : (img?.naturalWidth || 4108);
    const natH = turnedRoof ? 3538 : (img?.naturalHeight || 3538);
    const groups = groupsRef.current;
    const w = 1400;
    const h = Math.round((natH * w) / natW);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const paintPhoto = (target: CanvasRenderingContext2D) => {
      if (!(projectRef.current && floorOnRef.current && img?.naturalWidth)) return false;
      if (!turnedRoof) {
        target.drawImage(img, 0, 0, w, h);
        return true;
      }
      const crop = roofStoneCrop(img);
      const angle = ((180 + PHOTO_NORTH) * Math.PI) / 180;
      const cos = Math.abs(Math.cos(angle));
      const sin = Math.abs(Math.sin(angle));
      const rotW = w * cos + h * sin;
      const rotH = w * sin + h * cos;
      const fit = Math.max(w / rotW, h / rotH);
      const drawW = w * fit;
      const drawH = h * fit;
      target.save();
      target.translate(w / 2, h / 2);
      target.rotate(angle);
      target.drawImage(img, crop.x, crop.y, crop.w, crop.h, -drawW / 2, -drawH / 2, drawW, drawH);
      target.restore();
      return true;
    };
    if (ringOnRef.current) {
      paintRing360(canvas, decayTracesRef.current, decayProgressRef.current, decaySunTopRef.current);
      return;
    }
    if (decayFloorRef.current) {
      paintDecayCanvas(canvas, decayTracesRef.current, decayProgressRef.current);
      return;
    }
    let sky3d: { lines: FloorSeg[]; dots: SkyDot[]; arcs: SkyArc[]; night: number } | null = null;
    try {
    const s = w / natW;
    ctx.clearRect(0, 0, w, h);
    if (!paintPhoto(ctx)) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
    }
    if (dendera && pickedStonesRef.current.length) {
      const shown = canvas.clientWidth || w;
      ctx.save();
      ctx.lineWidth = Math.max(1, (2 * w) / shown);
      ctx.strokeStyle = "#9a3412";
      ctx.fillStyle = "rgba(202,138,4,0.38)";
      for (const id of pickedStonesRef.current) {
        const stone = stoneListRef.current.find((item) => item.id === id);
        if (!stone) continue;
        const outline = stoneOutline(stone);
        ctx.beginPath();
        outline.forEach((point, index) => index ? ctx.lineTo(point[0] * s, point[1] * s) : ctx.moveTo(point[0] * s, point[1] * s));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.lineCap = "round";
    const paintNet = (lines: number[][], color: string) => {
      if (!floorOnRef.current || !lines.length) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      for (const line of lines) {
        ctx.moveTo(line[1] * s, line[2] * s);
        ctx.lineTo(line[3] * s, line[4] * s);
      }
      ctx.stroke();
    };
    const paintHighlight = (lines: number[][], color: string) => {
      if (!floorOnRef.current || !lines.length) return;
      const stroke = (width: number, ink: string) => {
        ctx.lineWidth = width;
        ctx.strokeStyle = ink;
        for (const line of lines) {
          ctx.beginPath();
          ctx.moveTo(line[1] * s, line[2] * s);
          ctx.lineTo(line[3] * s, line[4] * s);
          ctx.stroke();
        }
      };
      stroke(7, "#1c1917");
      stroke(4, color);
    };
    const menuNow = floorMenuRef.current;
    const chipsFuga = pickedRef.current.fuga;
    const chipsAtlo = pickedRef.current.atlo;
    const moving = animOnRef.current || !!freezeRef.current;
    const vertexOn = funcsRef.current.kcsucs;
    const showFugaNet = dendera && !vertexOn && (chipsFuga || fugaBandRef.current || menuNow === "fugak" || (moving && sourceRef.current === "fuga") || (menuNow === "beallitas" && sourceRef.current === "fuga"));
    const showAtloNet = dendera && (chipsAtlo || atloBandRef.current || menuNow === "atlok" || (moving && sourceRef.current === "atlo") || (menuNow === "beallitas" && sourceRef.current === "atlo"));
    if (showFugaNet) paintNet(fugaLinesRef.current, "rgba(20,20,20,0.45)");
    if (dendera && pickedFugasRef.current.length) paintHighlight(pickedFugasRef.current.map((index) => fugaLinesRef.current[index]).filter(Boolean), "#ea580c");
    if (showAtloNet) paintNet(atloLinesRef.current, "rgba(88,28,135,0.28)");
    if (dendera && vertexOn && floorOnRef.current) {
      const seen = new Set<string>();
      for (const line of fugaLinesRef.current) {
        for (const point of [[line[1], line[2]], [line[3], line[4]]]) {
          const key = `${Math.round(point[0])},${Math.round(point[1])}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const shown = canvas.clientWidth || w;
          const halo = Math.max(0.7, (2 * w) / shown);
          const dot = Math.max(0.45, (1.25 * w) / shown);
          const px = point[0] * s;
          const py = point[1] * s;
          ctx.beginPath();
          ctx.arc(px, py, halo, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(px, py, dot, 0, Math.PI * 2);
          ctx.fillStyle = "#9a3412";
          ctx.fill();
        }
      }
    }
    const range = freezeRef.current;
    const list = listRef.current.length ? listRef.current : groups;
    const current = list[indexRef.current];
    const groupSegs = (group: FugaGroup | undefined) => group?.v.map((line) => [0, ...line]) ?? [];
    if (range) {
      if (showFugaNet) paintHighlight(fugaLinesRef.current.filter((line) => inAngleRange(line[0], range.from, range.to)), "#f5c400");
      if (showAtloNet) paintHighlight(atloLinesRef.current.filter((line) => inAngleRange(line[0], range.from, range.to)), "#7c3aed");
    } else if (animOnRef.current) {
      if (chipsFuga && chipsAtlo) {
        const fugaGroup = fugaGroupsRef.current[indexRef.current % Math.max(fugaGroupsRef.current.length, 1)];
        const atloGroup = atloGroupsRef.current[indexRef.current % Math.max(atloGroupsRef.current.length, 1)];
        if (!vertexOn) paintHighlight(groupSegs(fugaGroup), "#f5c400");
        paintHighlight(groupSegs(atloGroup), "#7c3aed");
      } else if (!(vertexOn && sourceRef.current !== "atlo")) {
        paintHighlight(groupSegs(current), sourceRef.current === "atlo" ? "#7c3aed" : "#f5c400");
      }
    }
    const picked = range
      ? linesRef.current.filter((line) => inAngleRange(line[0], range.from, range.to))
      : groupSegs(current);
    const paintAngleBand = (lines: number[][], color: string, fill: string) => {
      const fromDeg = Number(fromRef.current.replace(",", "."));
      const toDeg = Number(toRef.current.replace(",", "."));
      if (!Number.isFinite(fromDeg) || !Number.isFinite(toDeg)) return;
      const chosenLines = lines.filter((line) => inAngleRange(line[0], fromDeg, toDeg));
      if (floorOnRef.current) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      for (const line of chosenLines) {
        ctx.beginPath();
        ctx.moveTo(line[1] * s, line[2] * s);
        ctx.lineTo(line[3] * s, line[4] * s);
        ctx.stroke();
      }
      }
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.2;
      const wedge = rangeWedge(fromDeg, toDeg);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, compassRadians(wedge.start), compassRadians(wedge.end));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    if (!vertexOn && fugaBandRef.current) paintAngleBand(fugaLinesRef.current, "#f5c400", "rgba(245,196,0,0.35)");
    if (atloBandRef.current) paintAngleBand(atloLinesRef.current, "#7c3aed", "rgba(124,58,237,0.28)");
    if (picked.length) {
      const word = sourceRef.current === "atlo" ? "átló" : "fuga";
      const text = range
        ? `${range.from}–${range.to}°   ${picked.length} ${word}`
        : `${current?.szog.toFixed(1).replace(".", ",") ?? ""}°   ${current?.n ?? 0} ${word}`;
      const nextLabel = range || !current ? text : `${text} · ${indexRef.current + 1} / ${list.length}`;
      if (nextLabel !== labelHold.current) {
        labelHold.current = nextLabel;
        setLabel(nextLabel);
      }
    } else if (range) setLabel("Ebben a tartományban nincs fuga");
    const twilight = Number(twilightRef.current.replace(",", "."));
    const marks = skyRef.current;
    const skyOn = sceneRef.current === "eg";
    const placed = skyDateRef.current;
    const sunDec = placed ? placed.sunDec : (22.25 * Math.PI) / 180;
    const sirDec = placed ? placed.sirDec : SIRIUS_DEC;
    const shift = placed ? placed.shift : (327.42 * Math.PI) / 180;
    const alkDec = placed ? placed.alkDec : (60.27 * Math.PI) / 180;
    const alkShift = placed ? placed.alkShift : (74 * Math.PI) / 180;
    const hour = ((sunAzRef.current - 180) * Math.PI) / 180;
    const sunAlt = altitudeDeg(sunDec, hour);
    const sunAz = azimuthDeg(sunDec, hour);
    const siriusAlt = altitudeDeg(sirDec, hour - shift);
    const siriusAz = azimuthDeg(sirDec, hour - shift);
    const alkaidAlt = altitudeDeg(alkDec, hour - alkShift);
    const alkaidAz = azimuthDeg(alkDec, hour - alkShift);
    const above = siriusAlt > 0;
    const shine = siriusShine(sunAlt, siriusAlt);
    const alkaidAbove = alkaidAlt > 0;
    const alkaidLit = siriusShine(sunAlt, alkaidAlt);
    const dipper = placed?.dipper ?? dipperPlaces(-53, 93.62);
    const nova = placed?.nova ?? novaPlaces(-53, 93.62);
    const meteor = placed?.meteor ?? meteorPlaces(-53, 93.62);
    const planet = placed?.planet ?? DEFAULT_PLANETS;
    const dayFrac = (((((sunAzRef.current - 180) % 360) + 540) % 360) - 180) / 360;
    const wagon = dipper.map((star) => {
      const alt = altitudeDeg(star.dec, hour - star.shift);
      const az = azimuthDeg(star.dec, hour - star.shift);
      return { ...star, alt, az, above: alt > 0, lit: siriusShine(sunAlt, alt) };
    });
    const bursts = nova
      .filter((star) => snPickRef.current[star.id])
      .map((star) => {
        const alt = altitudeDeg(star.dec, hour - star.shift);
        const az = azimuthDeg(star.dec, hour - star.shift);
        return { ...star, alt, az, above: alt > 0, lit: siriusShine(sunAlt, alt) };
      });
    const showers = meteor
      .filter((star) => metPickRef.current[star.id])
      .map((star) => {
        const alt = altitudeDeg(star.dec, hour - star.shift);
        const az = azimuthDeg(star.dec, hour - star.shift);
        return { ...star, alt, az, above: alt > 0, lit: siriusShine(sunAlt, alt) };
      });
    const bright = placed?.bright ?? [];
    const brightMode = brightModeRef.current;
    const brightStars = bright
      .filter((star) => brightPickRef.current[star.id])
      .map((star) => {
        const alt = altitudeDeg(star.dec, hour - star.shift);
        const az = azimuthDeg(star.dec, hour - star.shift);
        return { ...star, alt, az, above: alt > 0, lit: siriusShine(sunAlt, alt) };
      });
    const worlds = planet
      .filter((star) => planetPickRef.current[star.id])
      .map((star) => {
        const dec = star.dec + star.ddec * dayFrac;
        const alt = altitudeDeg(dec, hour - star.shift - star.dra * dayFrac);
        const az = azimuthDeg(dec, hour - star.shift - star.dra * dayFrac);
        return { ...star, alt, az, above: alt > 0, lit: siriusShine(sunAlt, alt) };
      });
    const zodiac = (placed?.zod ?? [])
      .filter((figure) => zodPickRef.current[figure.id])
      .map((figure) => ({
        ...figure,
        csillagok: figure.csillagok.map((star) => {
          const alt = altitudeDeg(star.dec, hour - star.shift);
          const az = azimuthDeg(star.dec, hour - star.shift);
          return { ...star, alt, az, above: alt > 0, lit: siriusShine(sunAlt, alt) };
        }),
      }));
    const chosen = pickedRef.current;
    const bodies: { name: string; dec: number; az: number }[] = [];
    if (chosen.nap) bodies.push({ name: "Nap", dec: sunDec, az: sunAz });
    if (chosen.sirius) bodies.push({ name: "Szíriusz", dec: sirDec, az: siriusAz });
    if (chosen.alkaid || chosen.goncol) bodies.push({ name: "Alkaid", dec: alkDec, az: alkaidAz });
    if (chosen.goncol) {
      for (const star of wagon) {
        if (star.nev === "Alkaid") continue;
        bodies.push({ name: star.nev, dec: star.dec, az: star.az });
      }
    }
    for (const star of bursts) bodies.push({ name: `SN ${star.nev}`, dec: star.dec, az: star.az });
    for (const star of showers) bodies.push({ name: star.nev, dec: star.dec, az: star.az });
    for (const star of brightStars) bodies.push({ name: star.nev, dec: star.dec, az: star.az });
    for (const star of worlds) bodies.push({ name: star.nev, dec: star.dec + star.ddec * dayFrac, az: star.az });
    for (const figure of zodiac) {
      const star = figure.csillagok[figure.vezeto];
      bodies.push({ name: figure.nev, dec: star.dec, az: star.az });
    }
    const stamp = performance.now();
    const signature = bodies.map((body) => `${body.name}:${body.az.toFixed(0)}`).join(";");
    if (signature !== compareHold.current && stamp - compareTick.current > 200) {
      compareHold.current = signature;
      compareTick.current = stamp;
      setCompareRows(bodies.map((body) => compareBody(body.name, body.dec, body.az)));
    }
    const night = 1 - dayFromAltitude(sunAlt, Number.isFinite(twilight) ? twilight : 8);
    if (dayNightRef.current || (skyOn && (marks.sun || marks.glow || marks.sirius || marks.alkaid || marks.alkaidGlow || marks.goncol || marks.goncolGlow || marks.sn || marks.snGlow || marks.met || marks.metGlow || marks.plan || marks.planGlow || marks.zod || marks.zodGlow))) {
      const depth = dayNightRef.current ? 0.62 : 0.12;
      ctx.fillStyle = `rgba(7,16,40,${(depth * night).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      if (dayNightRef.current && night < 0.2) {
        ctx.fillStyle = `rgba(255,244,214,${(0.18 * (1 - night)).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
    const conj = conjMarkRef.current;
    const fugaClip = conjFugaRef.current && histBinsRef.current ? roseBands(histBinsRef.current) : [];
    const atloClip = conjAtloRef.current && atloHistBinsRef.current ? roseBands(atloHistBinsRef.current) : [];
    const clipOn = fugaClip.length > 0 || atloClip.length > 0;
    if (conj || clipOn) {
      const want = new Set(conj?.names ?? []);
      const spokes: { name: string; az: number; color: string }[] = [];
      const addSpoke = (name: string, dec: number, shiftHours: number, color: string) => {
        if (!want.has(name) || spokes.some((item) => item.name === name)) return;
        spokes.push({ name, az: azimuthDeg(dec, hour - shiftHours), color });
      };
      if (conj) {
        addSpoke("Nap", sunDec, 0, "#ca8a04");
        addSpoke("Szíriusz", sirDec, shift, "#c2410c");
        addSpoke("Alkaid", alkDec, alkShift, "#1a7f9c");
        for (const star of wagon) addSpoke(star.nev, star.dec, star.shift, star.color);
        for (const star of planet) addSpoke(star.nev, star.dec + star.ddec * dayFrac, star.shift + star.dra * dayFrac, star.color);
        for (const star of bright) {
          if (!want.has(star.nev)) continue;
          addSpoke(star.nev, star.dec, star.shift, star.color);
        }
      }
      const kept = clipOn ? spokes.filter((spoke) => axisInBands(spoke.az, fugaClip) || axisInBands(spoke.az, atloClip)) : spokes;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.4;
      ctx.save();
      ctx.lineWidth = 3;
      ctx.font = "700 15px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const paintSector = (bands: RoseBand[], fill: string) => {
        ctx.fillStyle = fill;
        for (const band of bands) {
          for (const base of [band.left, band.left + 180]) {
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, compassRadians(base), compassRadians(base + band.width));
            ctx.closePath();
            ctx.fill();
          }
        }
      };
      paintSector(fugaClip, "rgba(245,196,0,0.28)");
      paintSector(atloClip, "rgba(124,58,237,0.22)");
      for (const spoke of kept) {
        const rad = compassRadians(spoke.az);
        const x = cx + Math.cos(rad) * radius;
        const y = cy + Math.sin(rad) * radius;
        if (dayNightRef.current) {
          ctx.save();
          ctx.shadowColor = spoke.color;
          ctx.shadowBlur = 22;
          ctx.strokeStyle = spoke.color;
          ctx.lineWidth = 8;
          ctx.globalAlpha = 0.95;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 16, 0, Math.PI * 2);
          ctx.fillStyle = spoke.color;
          ctx.fill();
          ctx.restore();
        }
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.strokeStyle = spoke.color;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = dayNightRef.current ? "#fff" : spoke.color;
        ctx.fill();
        if (dayNightRef.current) {
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = spoke.color;
          ctx.fill();
        }
        ctx.fillStyle = spoke.color;
        ctx.fillText(spoke.name, cx + Math.cos(rad) * (radius + 28), cy + Math.sin(rad) * (radius + 28));
      }
      if (spokes.length >= 2) {
        const start = spokes[0].az;
        const span = ((spokes[1].az - start) % 360 + 360) % 360 || 360;
        let drawing = false;
        ctx.beginPath();
        ctx.strokeStyle = "rgba(28,25,23,0.85)";
        for (let step = 0; step <= span; step += 1) {
          const az = (start + step) % 360;
          const inside = !clipOn || axisInBands(az, fugaClip) || axisInBands(az, atloClip);
          const rad = compassRadians(az);
          const x = cx + Math.cos(rad) * radius * 0.55;
          const y = cy + Math.sin(rad) * radius * 0.55;
          if (!inside) {
            drawing = false;
            continue;
          }
          if (!drawing) {
            ctx.moveTo(x, y);
            drawing = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (conj && (!clipOn || kept.length)) {
          ctx.fillStyle = "#1c1917";
          ctx.fillText(`${conj.gap.toFixed(1).replace(".", ",")}°`, cx, cy - radius * 0.22);
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          const when = conjModeRef.current === "now" ? conj.title : `${conj.title} · ${conj.era === "ie" ? "i. e." : "i. sz."} ${conj.year}. ${conj.month}. ${conj.day}.`;
          const width = ctx.measureText(when).width;
          ctx.fillStyle = "rgba(255,252,245,0.94)";
          ctx.fillRect(16, 16, width + 16, 26);
          ctx.fillStyle = "#1c1917";
          ctx.fillText(when, 24, 20);
        }
      }
      ctx.restore();
    }
    if (conjArcRef.current && conjArcBodiesRef.current.length) {
      const arcX = w / 2;
      const arcY = h / 2;
      const base = Math.min(w, h) * 0.46;
      ctx.save();
      ctx.font = "700 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      conjArcBodiesRef.current.forEach((body, index) => {
        const sectors = visibilitySectors(body.name, body.color, body.sun, body.sunDec, (sample) => ({
          dec: body.sun ? body.sunDec : body.dec,
          hour: body.sun ? sample : sample - body.shift,
        }));
        const radius = base - (index % 8) * 18;
        for (const sector of sectors) {
          if (sector.kind === "nincs" || sector.kind === "nappal") continue;
          ctx.beginPath();
          ctx.moveTo(arcX, arcY);
          if (sector.kind === "mindig") ctx.arc(arcX, arcY, radius, 0, Math.PI * 2);
          else ctx.arc(arcX, arcY, radius, compassRadians(sector.start), compassRadians(sector.end));
          ctx.closePath();
          ctx.fillStyle = hexAlpha(body.color, 0.22);
          ctx.fill();
          ctx.strokeStyle = body.color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        const live = sectors.find((sector) => sector.kind === "iv" || sector.kind === "mindig");
        if (!live) return;
        const mid = live.kind === "mindig" ? 0 : (live.start + live.end) / 2;
        const rad = compassRadians(mid);
        ctx.fillStyle = body.color;
        ctx.fillText(body.name, arcX + Math.cos(rad) * (radius + 16), arcY + Math.sin(rad) * (radius + 16));
      });
      ctx.restore();
    }
    if (skyOn && chosen.sirius && (marks.siriusAim || marks.aim)) {
      const scale = w / natW;
      ctx.beginPath();
      for (const line of fugaLinesRef.current) {
        if (orientGap(line[0], SIRIUS_KEL) > 1) continue;
        ctx.moveTo(line[1] * scale, line[2] * scale);
        ctx.lineTo(line[3] * scale, line[4] * scale);
      }
      ctx.strokeStyle = "rgba(20,90,140,0.45)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (skyOn && marks.glow) {
      ctx.font = "700 20px sans-serif";
      ctx.fillStyle = night > 0.45 ? "#f4fbff" : "#1c1917";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(
        shine === 1 ? "Szíriusz szabad szemmel látható" : "Szíriusz szabad szemmel nem látható",
        16,
        marks.sun ? 122 : 96,
      );
    }
    if (skyOn && (marks.aim || marks.sunAim || marks.siriusAim || marks.sunAtlo || marks.siriusAtlo || marks.alkaidAim || marks.alkaidAtlo || marks.goncolAim || marks.goncolAtlo || marks.snAim || marks.snAtlo || marks.metAim || marks.metAtlo || marks.planAim || marks.planAtlo || marks.zodAim || marks.zodAtlo || brightMode.aim || brightMode.atlo)) {
      const tolerance = Number(matchRef.current.replace(",", "."));
      const limit = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 2;
      const scale = w / natW;
      const paintLines = (source: number[][], azimuth: number, color: string, width: number) => {
        if (!floorOnRef.current || (vertexOn && source === fugaLinesRef.current)) return;
        ctx.beginPath();
        for (const line of source) {
          if (orientGap(line[0], azimuth) > limit) continue;
          ctx.moveTo(line[1] * scale, line[2] * scale);
          ctx.lineTo(line[3] * scale, line[4] * scale);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      };
    if (marks.sunAim) paintLines(fugaLinesRef.current, sunAz, "#e6a100", 4);
      if (marks.siriusAim) paintLines(fugaLinesRef.current, siriusAz, "#1d4e89", 4);
      if (marks.aim) {
        paintLines(fugaLinesRef.current, sunAz, "#e6a100", 4);
        paintLines(fugaLinesRef.current, siriusAz, "#1d4e89", 4);
      }
      if (marks.alkaidAim) {
        paintLines(fugaLinesRef.current, alkaidAz, "#1a7f9c", 4);
        ctx.font = "700 20px sans-serif";
        ctx.fillStyle = "#0c3a4a";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(`Fugák az Alkaid felé, ${alkaidAz.toFixed(0)}°`, 16, h - 16);
      }
      if (marks.alkaidAtlo || marks.goncolAtlo || marks.sunAtlo || marks.siriusAtlo || marks.snAtlo || marks.metAtlo || marks.planAtlo || marks.zodAtlo || brightMode.atlo) {
        ctx.beginPath();
        for (const line of atloLinesRef.current) {
          ctx.moveTo(line[1] * scale, line[2] * scale);
          ctx.lineTo(line[3] * scale, line[4] * scale);
        }
        ctx.strokeStyle = "rgba(124,58,237,0.22)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (marks.sunAtlo) paintLines(atloLinesRef.current, sunAz, "#e6a100", 3);
      if (marks.siriusAtlo) paintLines(atloLinesRef.current, siriusAz, "#1d4e89", 3);
      if (marks.alkaidAtlo) paintLines(atloLinesRef.current, alkaidAz, "#1a7f9c", 3);
      if (marks.goncolAim) {
        for (const star of wagon) paintLines(fugaLinesRef.current, star.az, star.color, 3);
      }
      if (marks.goncolAtlo) {
        ctx.beginPath();
        for (const line of atloLinesRef.current) {
          ctx.moveTo(line[1] * scale, line[2] * scale);
          ctx.lineTo(line[3] * scale, line[4] * scale);
        }
        ctx.strokeStyle = "rgba(124,58,237,0.22)";
        ctx.lineWidth = 1;
        ctx.stroke();
        for (const star of wagon) paintLines(atloLinesRef.current, star.az, star.color, 3);
      }
      if (marks.goncolAim || marks.goncolAtlo) {
        ctx.font = "700 18px sans-serif";
        ctx.fillStyle = "#1c1917";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText("Göncölszekér, szín szerint", 16, marks.alkaidAim || marks.alkaidAtlo ? h - 72 : h - 16);
      }
      if (marks.snAim) for (const star of bursts) paintLines(fugaLinesRef.current, star.az, star.color, 3);
      if (marks.snAtlo) for (const star of bursts) paintLines(atloLinesRef.current, star.az, star.color, 3);
      if (marks.metAim) for (const star of showers) paintLines(fugaLinesRef.current, star.az, star.color, 3);
      if (marks.metAtlo) for (const star of showers) paintLines(atloLinesRef.current, star.az, star.color, 3);
      if (brightMode.aim) for (const star of brightStars) paintLines(fugaLinesRef.current, star.az, star.color, 3);
      if (brightMode.atlo) for (const star of brightStars) paintLines(atloLinesRef.current, star.az, star.color, 3);
      if (marks.planAim) for (const star of worlds) paintLines(fugaLinesRef.current, star.az, star.color, 3);
      if (marks.planAtlo) for (const star of worlds) paintLines(atloLinesRef.current, star.az, star.color, 3);
      if (marks.zodAim) {
        for (const figure of zodiac) paintLines(fugaLinesRef.current, figure.csillagok[figure.vezeto].az, figure.color, 3);
      }
      if (marks.zodAtlo) {
        for (const figure of zodiac) paintLines(atloLinesRef.current, figure.csillagok[figure.vezeto].az, figure.color, 3);
      }
    }
    const riseWanted = chosen.nap || chosen.sirius || chosen.alkaid || chosen.goncol || bursts.length > 0 || showers.length > 0 || worlds.length > 0 || zodiac.length > 0 || brightStars.length > 0;
    const paintFrameMarks = () => {
      if (!compassRef.current && !orientRef.current && !timeOnRef.current) return;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.22;
      ctx.save();
      if (compassRef.current) {
        ctx.strokeStyle = "rgba(15,60,90,0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
        ctx.stroke();
        ctx.fillStyle = "#0f3c5a";
        ctx.font = "700 22px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("É", cx, 8);
        ctx.textBaseline = "bottom";
        ctx.fillText("D", cx, h - 8);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText("K", w - 10, cy);
        ctx.textAlign = "left";
        ctx.fillText("Ny", 10, cy);
      }
      if (orientRef.current) {
        const axis = 18.65;
        const span = Math.hypot(w, h);
        ctx.strokeStyle = "rgba(154,52,18,0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const deg of [axis, axis + 90]) {
          const ang = compassRadians(deg);
          ctx.moveTo(cx - Math.cos(ang) * span, cy - Math.sin(ang) * span);
          ctx.lineTo(cx + Math.cos(ang) * span, cy + Math.sin(ang) * span);
        }
        ctx.stroke();
        ctx.font = "700 20px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const deg of [axis, axis + 90, axis + 180, axis + 270]) {
          const shown = ((deg % 360) + 360) % 360;
          const ang = compassRadians(shown);
          const dx = Math.cos(ang);
          const dy = Math.sin(ang);
          let reach = Infinity;
          if (dx > 0) reach = Math.min(reach, (w - 36 - cx) / dx);
          else if (dx < 0) reach = Math.min(reach, (36 - cx) / dx);
          if (dy > 0) reach = Math.min(reach, (h - 28 - cy) / dy);
          else if (dy < 0) reach = Math.min(reach, (28 - cy) / dy);
          const x = cx + dx * reach;
          const y = cy + dy * reach;
          const label = `${shown.toFixed(2).replace(".", ",")}°`;
          const width = ctx.measureText(label).width;
          ctx.fillStyle = "rgba(255,252,245,0.92)";
          ctx.fillRect(x - width / 2 - 6, y - 14, width + 12, 28);
          ctx.fillStyle = "#9a3412";
          ctx.fillText(label, x, y);
        }
      }
      if (timeOnRef.current) {
        const fromDeg = Number(fromRef.current.replace(",", "."));
        const toDeg = Number(toRef.current.replace(",", "."));
        let hand: number | null = sceneRef.current === "eg" ? sunAzRef.current : (current?.szog ?? sunAzRef.current);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(15,60,90,0.45)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (Number.isFinite(fromDeg) && Number.isFinite(toDeg) && sceneRef.current === "leltar") {
          const wedge = rangeWedge(fromDeg, toDeg);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, radius, compassRadians(wedge.start), compassRadians(wedge.end));
          ctx.closePath();
          ctx.fillStyle = "rgba(245,196,0,0.4)";
          ctx.fill();
          ctx.strokeStyle = "rgba(146,96,0,0.95)";
          ctx.lineWidth = 2;
          ctx.stroke();
          if (range) hand = wedge.start + (wedge.end - wedge.start) / 2;
        }
        if (hand !== null) {
          const ang = compassRadians(hand);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius);
          ctx.strokeStyle = "#b42318";
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius, 5, 0, Math.PI * 2);
          ctx.fillStyle = "#b42318";
          ctx.fill();
        }
        const when = sceneRef.current === "eg" ? clockLabel(sunAzRef.current) : `${(hand ?? 0).toFixed(1).replace(".", ",")}°`;
        ctx.font = "700 18px sans-serif";
        ctx.fillStyle = "#1c1917";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(sceneRef.current === "eg" ? `Idő ${when}` : `Jelölés ${when}`, 16, 16);
      }
      ctx.restore();
    };
    const paintWagon = () => {
      if (skyOn && marks.goncol) drawWagon(ctx, w, h, wagon, marks.goncolGlow);
    };
    const paintNovae = () => {
      if (skyOn && (marks.sn || marks.snGlow || marks.snAim || marks.snAtlo)) drawNovae(ctx, w, h, bursts, marks.snGlow);
      if (skyOn && (marks.met || marks.metGlow || marks.metAim || marks.metAtlo)) drawNovae(ctx, w, h, showers, marks.metGlow);
      if (skyOn && (brightMode.show || brightMode.glow || brightMode.aim || brightMode.atlo)) drawNovae(ctx, w, h, brightStars, brightMode.glow);
      if (skyOn && (marks.plan || marks.planGlow || marks.planAim || marks.planAtlo)) drawNovae(ctx, w, h, worlds, marks.planGlow);
      if (skyOn && (marks.zod || marks.zodGlow || marks.zodAim || marks.zodAtlo)) drawFigures(ctx, w, h, zodiac, marks.zodGlow);
    };
    const paintCcw = () => {
      if (!skyOn || !ccwOnRef.current) return;
      const marks: { name: string; dec: number; shift: number }[] = [];
      const push = (name: string, dec: number, shift: number) => {
        if (alsoCounterClockwise(dec)) marks.push({ name, dec, shift });
      };
      push("Nap", sunDec, 0);
      push("Szíriusz", sirDec, shift);
      for (const star of dipper) push(star.nev, star.dec, star.shift);
      for (const star of nova) push(`SN ${star.nev}`, star.dec, star.shift);
      for (const star of meteor) push(star.nev, star.dec, star.shift);
      for (const star of bright) if (brightPickRef.current[star.id]) push(star.nev, star.dec, star.shift);
      for (const star of planet) push(star.nev, star.dec + star.ddec * dayFrac, star.shift + star.dra * dayFrac);
      const zodiacCount = new Map<string, number>();
      for (const figure of placed?.zod ?? []) {
        let count = 0;
        for (const star of figure.csillagok) {
          if (!alsoCounterClockwise(star.dec)) continue;
          count += 1;
          marks.push({ name: figure.nev, dec: star.dec, shift: star.shift });
        }
        if (count) zodiacCount.set(figure.nev, count);
      }
      const cx = w / 2;
      const cy = h / 2;
      const horizon = Math.min(w, h) * 0.26;
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = "#c2410c";
      ctx.fillStyle = "#c2410c";
      for (const mark of marks) {
        const alt = altitudeDeg(mark.dec, hour - mark.shift);
        const az = azimuthDeg(mark.dec, hour - mark.shift);
        const radius = (horizon * (90 - Math.max(alt, -12))) / 90;
        const screen = ((az - 90) * Math.PI) / 180;
        const x = cx + radius * Math.sin((az * Math.PI) / 180);
        const y = cy - radius * Math.cos((az * Math.PI) / 180);
        ctx.globalAlpha = alt >= 0 ? 0.95 : 0.35;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(radius, 8), screen, screen - 0.45, true);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      const lines = ["Ellentétesen is mozog"];
      const named = new Set<string>();
      for (const mark of marks) {
        if (zodiacCount.has(mark.name)) continue;
        named.add(mark.name);
      }
      for (const name of named) lines.push(name);
      for (const [name, count] of zodiacCount) lines.push(`${name} (${count})`);
      lines.push(`összesen ${marks.length}`);
      ctx.globalAlpha = 1;
      ctx.font = "700 14px sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      let y = 16;
      for (const line of lines.slice(0, 18)) {
        const width = ctx.measureText(line).width;
        ctx.fillStyle = "rgba(255,252,245,0.9)";
        ctx.fillRect(w - width - 28, y, width + 16, 20);
        ctx.fillStyle = "#9a3412";
        ctx.fillText(line, w - 20, y + 2);
        y += 22;
      }
      if (lines.length > 18) {
        const more = `és még ${lines.length - 18}`;
        const width = ctx.measureText(more).width;
        ctx.fillStyle = "rgba(255,252,245,0.9)";
        ctx.fillRect(w - width - 28, y, width + 16, 20);
        ctx.fillStyle = "#9a3412";
        ctx.fillText(more, w - 20, y + 2);
      }
      ctx.restore();
    };
    const paintRoses = () => {
      const job = funcsRef.current;
      const fugaRose = (job.suruseg || fugaHistMenuRef.current) && !!histBinsRef.current;
      const atloRose = (job.suruseg || atloHistMenuRef.current || (job.csucs && !job.asav)) && !!atloHistBinsRef.current;
      const fugaBand = job.ssav && !!histBinsRef.current;
      const atloBand = job.asav && !!atloHistBinsRef.current;
      const fugaOn = (fugaRose || fugaBand) && !!histBinsRef.current;
      const peaksOn = job.csucs && atloHistBinsRef.current;
      const atloOn = (atloRose || atloBand || !!peaksOn) && !!atloHistBinsRef.current;
      if (peaksOn && atloHistBinsRef.current) {
        const peaks = rosePeaks(atloHistBinsRef.current);
        const lineScale = w / natW;
        ctx.save();
        ctx.beginPath();
        for (const line of atloLinesRef.current) {
          if (!peaks.some((peak) => orientGap(line[0], peak) <= 2)) continue;
          ctx.moveTo(line[1] * lineScale, line[2] * lineScale);
          ctx.lineTo(line[3] * lineScale, line[4] * lineScale);
        }
        ctx.strokeStyle = "#c2410c";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
      const aims = peakColorRef.current ? bodies.map((body) => body.az) : [];
      if (atloRose && atloHistBinsRef.current) {
        drawRose(ctx, atloHistBinsRef.current, w, h, "rgba(124,58,237,0.9)", "Átlók", fugaOn ? 0.42 : 0.34, fugaOn ? 18 : 0, true, aims);
      }
      if (fugaRose && histBinsRef.current) {
        drawRose(ctx, histBinsRef.current, w, h, "rgba(28,25,23,0.88)", "Fugák", atloOn ? 0.24 : 0.34, atloOn ? -16 : 0, !atloOn, aims);
      }
      if (atloBand && atloHistBinsRef.current) drawBands(ctx, atloHistBinsRef.current, w, h, "rgba(124,58,237,0.28)", "#6d28d9", fugaOn ? 0.42 : 0.34);
      if (fugaBand && histBinsRef.current) drawBands(ctx, histBinsRef.current, w, h, "rgba(28,25,23,0.28)", "#1c1917", atloOn ? 0.24 : 0.34);
      if (job.tsav && histBinsRef.current && fugaLinesRef.current.length) {
        const fullBands = fullFugaBands(fugaLinesRef.current);
        const visibleAims: number[] = [];
        if (chosen.nap && sunAlt >= 0) visibleAims.push(sunAz);
        if (chosen.sirius && shine === 1) visibleAims.push(siriusAz);
        if ((chosen.alkaid || chosen.goncol) && alkaidLit === 1) visibleAims.push(alkaidAz);
        if (chosen.goncol) for (const star of wagon) if (star.nev !== "Alkaid" && star.lit === 1) visibleAims.push(star.az);
        for (const star of [...bursts, ...showers, ...brightStars, ...worlds]) if (star.lit === 1) visibleAims.push(star.az);
        for (const figure of zodiac) {
          const star = figure.csillagok[figure.vezeto];
          if (star.lit === 1) visibleAims.push(star.az);
        }
        drawBands(ctx, histBinsRef.current, w, h, "rgba(190,18,60,0.16)", "#be123c", 0.46, fullBands, 0.62);
        drawRingHist(ctx, histBinsRef.current, w, h, 0.46, 0.62, "rgba(28,25,23,0.9)", fullBands, visibleAims);
      }
      if (peaksOn && atloOn && atloHistBinsRef.current) {
        const peaks = rosePeaks(atloHistBinsRef.current);
        const cx = w / 2;
        const cy = h / 2;
        const outer = Math.min(w, h) * (fugaOn ? 0.42 : 0.34);
        ctx.save();
        ctx.strokeStyle = "#9a3412";
        ctx.lineWidth = 2.5;
        ctx.font = "700 15px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const degree of peaks) {
          for (const base of [degree, degree + 180]) {
            const rad = compassRadians(base);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(rad) * outer, cy + Math.sin(rad) * outer);
            ctx.stroke();
          }
          const rad = compassRadians(degree);
          const lx = cx + Math.cos(rad) * (outer + 26);
          const ly = cy + Math.sin(rad) * (outer + 26);
          const text = `${degree}°`;
          const width = ctx.measureText(text).width;
          ctx.fillStyle = "rgba(255,252,245,0.92)";
          ctx.fillRect(lx - width / 2 - 4, ly - 11, width + 8, 22);
          ctx.fillStyle = "#9a3412";
          ctx.fillText(text, lx, ly);
        }
        ctx.restore();
      }
    };
    const paintAzimuth = () => {
      const daily = funcsRef.current.azimut;
      const yearly = funcsRef.current.eazimut;
      if (!daily && !yearly) return;
      const table = yearSkyRef.current;
      const astro = yearAstroRef.current;
      const hourNow = hour;
      type AzBody = {
        name: string;
        color: string;
        at: (sampleHour: number, sampleFrac: number) => { dec: number; hour: number };
        yearAt: (index: number) => { dec: number; hour: number } | null;
      };
      const bodies: AzBody[] = [];
      const fixedYear = (dec: number, shift: number) => () => ({ dec, hour: hourNow - shift });
      if (chosen.nap) {
        bodies.push({
          name: "Nap",
          color: "#e6a100",
          at: (sampleHour) => ({ dec: sunDec, hour: sampleHour }),
          yearAt: (index) => (table ? { dec: (table.dek_nap[index] * Math.PI) / 180, hour: hourNow } : null),
        });
      }
      if (chosen.sirius) {
        bodies.push({
          name: "Szíriusz",
          color: "#1d4e89",
          at: (sampleHour) => ({ dec: sirDec, hour: sampleHour - shift }),
          yearAt: (index) => {
            if (!table) return null;
            const dec = (table.dek_szir[index] * Math.PI) / 180;
            const starShift = ((((table.ra_szir[index] - table.ra_nap[index]) % 360) + 360) % 360 * Math.PI) / 180;
            return { dec, hour: hourNow - starShift };
          },
        });
      }
      if (chosen.alkaid) {
        bodies.push({
          name: "Alkaid",
          color: "#1a7f9c",
          at: (sampleHour) => ({ dec: alkDec, hour: sampleHour - alkShift }),
          yearAt: (index) => {
            if (!table) return null;
            const dec = (table.dek_alk[index] * Math.PI) / 180;
            const starShift = ((((table.ra_alk[index] - table.ra_nap[index]) % 360) + 360) % 360 * Math.PI) / 180;
            return { dec, hour: hourNow - starShift };
          },
        });
      }
      if (chosen.goncol) {
        dipper.forEach((star, starIndex) => {
          if (chosen.alkaid && star.nev === "Alkaid") return;
          bodies.push({
            name: star.nev,
            color: star.color,
            at: (sampleHour) => ({ dec: star.dec, hour: sampleHour - star.shift }),
            yearAt: (index) => {
              if (!table || astro == null) return null;
              const places = dipperPlaces(astro, table.ra_nap[index]);
              if (starIndex === 6) {
                const dec = (table.dek_alk[index] * Math.PI) / 180;
                const starShift = ((((table.ra_alk[index] - table.ra_nap[index]) % 360) + 360) % 360 * Math.PI) / 180;
                return { dec, hour: hourNow - starShift };
              }
              const next = places[starIndex];
              return next ? { dec: next.dec, hour: hourNow - next.shift } : null;
            },
          });
        });
      }
      for (const star of bursts) {
        bodies.push({
          name: `SN ${star.nev}`,
          color: star.color,
          at: (sampleHour) => ({ dec: star.dec, hour: sampleHour - star.shift }),
          yearAt: (index) => {
            if (!table || astro == null) return null;
            const next = novaPlaces(astro, table.ra_nap[index]).find((item) => item.id === star.id);
            return next ? { dec: next.dec, hour: hourNow - next.shift } : fixedYear(star.dec, star.shift)();
          },
        });
      }
      for (const star of showers) {
        bodies.push({
          name: star.nev,
          color: star.color,
          at: (sampleHour) => ({ dec: star.dec, hour: sampleHour - star.shift }),
          yearAt: (index) => {
            if (!table || astro == null) return null;
            const next = meteorPlaces(astro, table.ra_nap[index]).find((item) => item.id === star.id);
            return next ? { dec: next.dec, hour: hourNow - next.shift } : null;
          },
        });
      }
      for (const star of brightStars) {
        bodies.push({
          name: star.nev,
          color: star.color,
          at: (sampleHour) => ({ dec: star.dec, hour: sampleHour - star.shift }),
          yearAt: (index) => {
            if (!table || astro == null) return null;
            const next = placeFixed(BRIGHT, astro, table.ra_nap[index]).find((item) => item.id === star.id);
            return next ? { dec: next.dec, hour: hourNow - next.shift } : null;
          },
        });
      }
      for (const figure of zodiac) {
        const star = figure.csillagok[figure.vezeto];
        bodies.push({
          name: figure.nev,
          color: figure.color,
          at: (sampleHour) => ({ dec: star.dec, hour: sampleHour - star.shift }),
          yearAt: (index) => {
            if (!table || astro == null) return null;
            const next = placeZodiac(astro, table.ra_nap[index]).find((item) => item.id === figure.id);
            const lead = next?.csillagok[next.vezeto];
            return lead ? { dec: lead.dec, hour: hourNow - lead.shift } : null;
          },
        });
      }
      for (const star of worlds) {
        bodies.push({
          name: star.nev,
          color: star.color,
          at: (sampleHour, sampleFrac) => ({ dec: star.dec + star.ddec * sampleFrac, hour: sampleHour - star.shift - star.dra * sampleFrac }),
          yearAt: (index) => {
            if (!table || astro == null) return null;
            const date = dateFromYearDay(astro, index);
            const next = planetPlaces(julianDayNoon(astro, date.month, date.day), table.ra_nap[index]).find((item) => item.id === star.id);
            return next ? { dec: next.dec, hour: hourNow - next.shift } : null;
          },
        });
      }
      if (!bodies.length) return;
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * 0.3;
      const today = table ? dayIndex(Number(monthRef.current) || 1, Number(dateDayRef.current) || 1, table.szoko === 1) : -1;
      ctx.save();
      bodies.forEach((body, index) => {
        const radius = base - index * 12;
        if (radius < 34) return;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = hexAlpha(body.color, 0.4);
        ctx.lineWidth = 1;
        ctx.stroke();
        if (daily) {
          const azimuths: number[] = [];
          for (let clock = 0; clock < 360; clock += 3) {
            const sampleHour = ((clock - 180) * Math.PI) / 180;
            const spot = body.at(sampleHour, (clock - 180) / 360);
            if (altitudeDeg(spot.dec, spot.hour) > 0) azimuths.push(azimuthDeg(spot.dec, spot.hour));
          }
          if (azimuths.length) {
            const arc = coverArc(azimuths);
            ctx.beginPath();
            ctx.strokeStyle = body.color;
            ctx.lineWidth = 7;
            if (arc.kind === "mindig") ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            else ctx.arc(cx, cy, radius, compassRadians(arc.start), compassRadians(arc.end));
            ctx.stroke();
          }
          const now = body.at(hourNow, dayFrac);
          const azimuth = azimuthDeg(now.dec, now.hour);
          const ang = compassRadians(azimuth);
          const x = cx + Math.cos(ang) * radius;
          const y = cy + Math.sin(ang) * radius;
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.fillStyle = altitudeDeg(now.dec, now.hour) > 0 ? "#fffdf6" : "#fff";
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = body.color;
          ctx.stroke();
          const text = `${body.name} ${Math.round(azimuth)}°`;
          ctx.font = "700 14px sans-serif";
          const width = ctx.measureText(text).width;
          ctx.fillStyle = "rgba(255,252,245,0.92)";
          ctx.fillRect(x + 10, y - 18, width + 8, 18);
          ctx.fillStyle = "#1c1917";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(text, x + 14, y - 9);
        }
        if (yearly && table) {
          const ring = radius + (daily ? 9 : 0);
          const total = table.dek_nap.length;
          for (let indexDay = 0; indexDay < total; indexDay += 4) {
            const spot = body.yearAt(indexDay);
            if (!spot) continue;
            const ang = compassRadians(azimuthDeg(spot.dec, spot.hour));
            ctx.beginPath();
            ctx.arc(cx + Math.cos(ang) * ring, cy + Math.sin(ang) * ring, 2.2, 0, Math.PI * 2);
            ctx.fillStyle = hexAlpha(body.color, 0.8);
            ctx.fill();
          }
          if (today >= 0) {
            const spot = body.yearAt(today);
            if (spot) {
              const ang = compassRadians(azimuthDeg(spot.dec, spot.hour));
              ctx.beginPath();
              ctx.arc(cx + Math.cos(ang) * ring, cy + Math.sin(ang) * ring, 6, 0, Math.PI * 2);
              ctx.fillStyle = body.color;
              ctx.fill();
              ctx.lineWidth = 2;
              ctx.strokeStyle = "#1c1917";
              ctx.stroke();
            }
          }
        }
      });
      ctx.restore();
    };
    const paintSectors = () => {
      const wantSector = sectorOnRef.current;
      const wantPath = pathOnRef.current;
      const targets: { name: string; color: string; sun: boolean; planet: boolean; at: (hour: number, dayFrac: number) => { dec: number; hour: number } }[] = [];
      if (chosen.nap) targets.push({ name: "Nap", color: "#e6a100", sun: true, planet: false, at: (hour) => ({ dec: sunDec, hour }) });
      if (chosen.sirius) targets.push({ name: "Szíriusz", color: "#1d4e89", sun: false, planet: false, at: (hour) => ({ dec: sirDec, hour: hour - shift }) });
      if (chosen.alkaid) targets.push({ name: "Alkaid", color: "#1a7f9c", sun: false, planet: false, at: (hour) => ({ dec: alkDec, hour: hour - alkShift }) });
      if (chosen.goncol) {
        for (const star of dipper) {
          if (chosen.alkaid && star.nev === "Alkaid") continue;
          targets.push({ name: star.nev, color: star.color, sun: false, planet: false, at: (hour) => ({ dec: star.dec, hour: hour - star.shift }) });
        }
      }
      for (const star of nova) {
        if (!snPickRef.current[star.id]) continue;
        targets.push({ name: `SN ${star.nev}`, color: star.color, sun: false, planet: false, at: (hour) => ({ dec: star.dec, hour: hour - star.shift }) });
      }
      for (const star of meteor) {
        if (!metPickRef.current[star.id]) continue;
        targets.push({ name: star.nev, color: star.color, sun: false, planet: false, at: (hour) => ({ dec: star.dec, hour: hour - star.shift }) });
      }
      for (const star of placed?.bright ?? []) {
        if (!brightPickRef.current[star.id]) continue;
        targets.push({ name: star.nev, color: star.color, sun: false, planet: false, at: (hour) => ({ dec: star.dec, hour: hour - star.shift }) });
      }
      for (const figure of placed?.zod ?? []) {
        if (!zodPickRef.current[figure.id]) continue;
        const star = figure.csillagok[figure.vezeto];
        targets.push({ name: figure.nev, color: figure.color, sun: false, planet: false, at: (hour) => ({ dec: star.dec, hour: hour - star.shift }) });
      }
      for (const star of planet) {
        if (!planetPickRef.current[star.id]) continue;
        targets.push({
          name: star.nev,
          color: star.color,
          sun: false,
          planet: true,
          at: (hour, dayFrac) => ({ dec: star.dec + star.ddec * dayFrac, hour: hour - star.shift - star.dra * dayFrac }),
        });
      }
      if (!targets.length) return;
      const cx = w / 2;
      const cy = h / 2;
      if (wantSector) {
      const sectors = targets.flatMap((target) => visibilitySectors(target.name, target.color, target.sun, sunDec, target.at));
      const base = Math.min(w, h) * 0.4;
      ctx.save();
      sectors.forEach((sector, index) => {
        if (sector.kind === "nincs" || sector.kind === "nappal") return;
        const radius = base - index * 16;
        if (radius < 40) return;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        if (sector.kind === "mindig") ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        else ctx.arc(cx, cy, radius, compassRadians(sector.start), compassRadians(sector.end));
        ctx.closePath();
        ctx.fillStyle = hexAlpha(sector.color, 0.28);
        ctx.fill();
        ctx.strokeStyle = sector.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      ctx.font = "700 16px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      let y = h - 14;
      const groups = new Map<string, { color: string; bits: string[] }>();
      for (const sector of sectors) {
        const norm = (degree: number) => Math.round(((degree % 360) + 360) % 360);
        const bit = sector.kind === "nincs"
          ? "nem emelkedik látható magasságba"
          : sector.kind === "nappal"
            ? "csak nappal van fent"
            : sector.kind === "mindig"
              ? "egész nap látszik"
              : `${norm(sector.start)}–${norm(sector.end)}°`;
        const row = groups.get(sector.name) ?? { color: sector.color, bits: [] };
        row.bits.push(bit);
        groups.set(sector.name, row);
      }
      const rows = [...groups.entries()].reverse();
      for (const [name, row] of rows) {
        const text = `${name}: ${row.bits.join(" és ")}`;
        const width = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(255,252,245,0.88)";
        ctx.fillRect(16, y - 18, width + 28, 22);
        ctx.fillStyle = row.color;
        ctx.fillRect(20, y - 12, 10, 10);
        ctx.fillStyle = "#1c1917";
        ctx.fillText(text, 36, y);
        y -= 26;
      }
      ctx.restore();
      }
      if (wantPath) {
        const ring = Math.min(w, h) * 0.3;
        ctx.save();
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        targets.forEach((target, index) => {
          const radius = ring - index * 8;
          if (radius < 28) return;
          ctx.beginPath();
          let drawing = false;
          for (let clock = 0; clock <= 360; clock += 2) {
            const sampleHour = ((clock - 180) * Math.PI) / 180;
            const sampleFrac = (clock - 180) / 360;
            const body = target.at(sampleHour, sampleFrac);
            const seen = target.planet
              ? altitudeDeg(body.dec, body.hour) >= 2 && altitudeDeg(sunDec, sampleHour) <= -8
              : altitudeDeg(body.dec, body.hour) > 0;
            if (!seen) {
              drawing = false;
              continue;
            }
            const ang = compassRadians(azimuthDeg(body.dec, body.hour));
            const x = cx + Math.cos(ang) * radius;
            const y = cy + Math.sin(ang) * radius;
            if (!drawing) {
              ctx.moveTo(x, y);
              drawing = true;
            } else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = target.color;
          ctx.stroke();
          const now = target.at(hour, dayFrac);
          const nowUp = target.planet
            ? altitudeDeg(now.dec, now.hour) >= 2 && altitudeDeg(sunDec, hour) <= -8
            : altitudeDeg(now.dec, now.hour) > 0;
          const ang = compassRadians(azimuthDeg(now.dec, now.hour));
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius, nowUp ? 6 : 3, 0, Math.PI * 2);
          ctx.fillStyle = target.color;
          ctx.globalAlpha = nowUp ? 1 : 0.35;
          ctx.fill();
          ctx.globalAlpha = 1;
        });
        ctx.restore();
      }
      ctx.save();
      if (culmOnRef.current) targets.forEach((target, index) => {
        const radius = wantPath ? Math.min(w, h) * 0.3 - index * 8 : Math.min(w, h) * 0.22;
        if (radius < 28) return;
        const now = target.at(hour, dayFrac);
        const az = azimuthDeg(now.dec, 0);
        const peak = altitudeDeg(now.dec, 0);
        const ang = compassRadians(az);
        const x = cx + Math.cos(ang) * radius;
        const y = cy + Math.sin(ang) * radius;
        ctx.beginPath();
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 7, y);
        ctx.lineTo(x, y + 8);
        ctx.lineTo(x - 7, y);
        ctx.closePath();
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = target.color;
        ctx.stroke();
        if (targets.length <= 5) {
          ctx.font = "700 12px sans-serif";
          ctx.fillStyle = "#1c1917";
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.fillText(`delelés ${peak >= 0 ? "+" : "−"}${Math.abs(peak).toFixed(0)}°`, x + 12, y - 2);
        }
        if (culminationFlash(target.name, now.hour)) {
          const inner = Math.max(16, radius - 52);
          const outer = radius + 88;
          ctx.save();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 7;
          ctx.shadowColor = "#ffffff";
          ctx.shadowBlur = 18;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
          ctx.lineTo(cx + Math.cos(ang) * outer, cy + Math.sin(ang) * outer);
          ctx.stroke();
          ctx.restore();
        }
      });
      ctx.restore();
    };
    const eastNow = eastFlagsRef.current;
    const pairNow = pairLinesRef.current;
    const studyOn = eastNow.result || eastNow.kel || eastNow.kozos || eastNow.dendera || eastNow.nap || eastNow.fenyes || eastNow.K62 || eastNow.K28 || eastNow.K29 || eastNow.K30 || eastNow.K61 || eastNow.K63 || eastNow.K64 || eastNow.K65 || pairNow.fedes || pairNow.meroleges || pairNow.sirius || pairNow.procyon || pairNow.kot || pairNow.szegely || pairNow.kozel || pairNow.egyenesen || pairNow.derekszog || pairNow.k63 || starOnRef.current.some(Boolean) || parallelOnRef.current.some(Boolean);
    const showDial = studyOn || (skyOn && (marks.sav || marks.kel || marks.nyug || marks.band || marks.sun || marks.sirius || marks.glow || marks.alkaid || marks.alkaidGlow || marks.goncol || marks.goncolGlow || marks.sn || marks.snGlow || marks.snAim || marks.snAtlo || marks.met || marks.metGlow || marks.metAim || marks.metAtlo || marks.plan || marks.planGlow || marks.planAim || marks.planAtlo || marks.zod || marks.zodGlow || marks.zodAim || marks.zodAtlo || brightMode.show || brightMode.glow || brightMode.aim || brightMode.atlo || riseWanted));
    if (!showDial) {
      paintRoses();
      paintSectors();
      paintAzimuth();
      paintWagon();
      paintNovae();
      paintCcw();
      paintFrameMarks();
    } else {
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.22;
    ctx.save();
    const ring = (start: number, end: number, fill: string) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, compassRadians(start), compassRadians(end));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    const markPoint = (azimuth: number, name: string, color: string) => {
      const ang = compassRadians(azimuth);
      const x = cx + Math.cos(ang) * radius;
      const y = cy + Math.sin(ang) * radius;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.font = "700 16px sans-serif";
      ctx.fillStyle = "#1c1917";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(name, x + 10, y - 6);
    };
    const riseMarks: { name: string; color: string; dec: number }[] = [];
    if (chosen.nap) riseMarks.push({ name: "Nap", color: "#e6a100", dec: sunDec });
    if (chosen.sirius) riseMarks.push({ name: "Szíriusz", color: "#1d4e89", dec: sirDec });
    if (chosen.goncol) {
      for (const star of dipper) riseMarks.push({ name: star.nev, color: star.color, dec: star.dec });
    } else if (chosen.alkaid) riseMarks.push({ name: "Alkaid", color: "#1a7f9c", dec: alkDec });
    for (const star of bursts) riseMarks.push({ name: `SN ${star.nev}`, color: star.color, dec: star.dec });
    for (const star of showers) riseMarks.push({ name: star.nev, color: star.color, dec: star.dec });
    for (const star of brightStars) riseMarks.push({ name: star.nev, color: star.color, dec: star.dec });
    for (const figure of zodiac) riseMarks.push({ name: figure.nev, color: figure.color, dec: figure.csillagok[figure.vezeto].dec });
    for (const mark of riseMarks) {
      const ends = riseSetAzimuths(mark.dec);
      if (!ends) continue;
      markPoint(ends.kel, `${mark.name} kel`, mark.color);
      markPoint(ends.nyug, `${mark.name} fekszik`, mark.color);
    }
    for (const star of planet) {
      if (!planetPickRef.current[star.id]) continue;
      const runs = visibleRuns(
        (sunHour, frac) => ({ dec: star.dec + star.ddec * frac, hour: sunHour - star.shift - star.dra * frac }),
        sunDec,
      );
      for (const run of runs) {
        markPoint(run.kel, `${star.nev} kel`, star.color);
        markPoint(run.nyug, `${star.nev} fekszik`, star.color);
      }
    }
    if (marks.sun) {
      const lit = sunAlt >= 0;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(180,120,20,0.45)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const ang = compassRadians(sunAz);
      const sx = cx + Math.cos(ang) * radius;
      const sy = cy + Math.sin(ang) * radius;
      if (lit) {
        const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, 22);
        halo.addColorStop(0, "rgba(255,244,210,0.95)");
        halo.addColorStop(0.5, "rgba(230,161,0,0.85)");
        halo.addColorStop(1, "rgba(230,161,0,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(sx, sy, 22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(sx, sy);
      ctx.strokeStyle = "#e6a100";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, lit ? 8 : 5, 0, Math.PI * 2);
      ctx.fillStyle = lit ? "#fff6d8" : "rgba(230,161,0,0.45)";
      ctx.fill();
      const when = clockLabel(sunAzRef.current);
      ctx.font = "700 20px sans-serif";
      ctx.fillStyle = "#1c1917";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`Nap ${when}   magasság ${sunAlt.toFixed(0)}°`, 16, 70);
    }
    if (marks.sirius) {
      const ang = compassRadians(siriusAz);
      const x = cx + Math.cos(ang) * radius;
      const y = cy + Math.sin(ang) * radius;
      const seen = shine === 1 ? "látható" : above && sunAlt < 0 ? "szürkület" : above ? "nappali égen" : "a horizont alatt";
      const lit = shine === 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = lit ? "#d6ecff" : above ? "#1d4e89" : "rgba(29,78,137,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (lit) {
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, lit ? 28 : 8, 0, Math.PI * 2);
      ctx.fillStyle = lit ? "#ffffff" : above ? "#1d4e89" : "rgba(29,78,137,0.45)";
      ctx.fill();
      ctx.lineWidth = lit ? 6 : 3;
      ctx.strokeStyle = lit ? "#ffffff" : "#0b2545";
      ctx.stroke();
      ctx.font = "700 20px sans-serif";
      ctx.fillStyle = lit ? "#f4fbff" : "#1c1917";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`Szíriusz ${siriusAlt.toFixed(0)}°  ${seen}`, 16, marks.sun ? 96 : 70);
    }
    if (pairLinesRef.current.fedes || pairLinesRef.current.meroleges || pairLinesRef.current.sirius || pairLinesRef.current.procyon || pairLinesRef.current.kot || pairLinesRef.current.szegely || pairLinesRef.current.kozel || pairLinesRef.current.egyenesen || pairLinesRef.current.derekszog || pairLinesRef.current.k63 || starOnRef.current.some(Boolean) || parallelOnRef.current.some(Boolean)) {
      const proStar = (placed?.bright ?? []).find((star) => star.id === "f37279");
      if (proStar && !pairMarkRef.current && (pairLinesRef.current.fedes || pairLinesRef.current.meroleges)) {
        let prev: { d: number; sAz: number; sAlt: number; pAlt: number; deg: number } | null = null;
        for (let deg = 0; deg <= 360; deg += 0.5) {
          const sample = ((deg - 180) * Math.PI) / 180;
          const sAz = azimuthDeg(sirDec, sample - shift);
          const pAz = azimuthDeg(proStar.dec, sample - proStar.shift);
          const sAlt = altitudeDeg(sirDec, sample - shift);
          const pAlt = altitudeDeg(proStar.dec, sample - proStar.shift);
          const d = ((sAz - pAz + 540) % 360) - 180;
          if (prev && prev.d * d < 0 && prev.sAlt > 0 && prev.pAlt > 0) {
            pairMarkRef.current = { az: prev.sAz, clock: clockLabel(prev.deg), sAlt: prev.sAlt, pAlt: prev.pAlt };
            break;
          }
          prev = { d, sAz, sAlt, pAlt, deg };
        }
      }
      const mark = pairMarkRef.current;
      const proBase = (placed?.bright ?? []).find((star) => star.id === "f37279");
      const proNow = proBase
        ? { az: azimuthDeg(proBase.dec, hour - proBase.shift), alt: altitudeDeg(proBase.dec, hour - proBase.shift) }
        : undefined;
      let gapNow = 99;
      if (proNow) {
        gapNow = Math.abs(siriusAz - proNow.az);
        if (gapNow > 180) gapNow = 360 - gapNow;
      }
      const close = gapNow < 1.2 && siriusAlt > 0 && (proNow?.alt ?? -1) > 0;
      const span = Math.hypot(w, h) * 0.48;
      const paintAxis = (degree: number, color: string, width: number) => {
        const ang = compassRadians(degree);
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(ang) * span, cy - Math.sin(ang) * span);
        ctx.lineTo(cx + Math.cos(ang) * span, cy + Math.sin(ang) * span);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
        for (const end of [degree, (degree + 180) % 360]) {
          const a = compassRadians(end);
          const angleText = `${end.toFixed(1).replace(".", ",")}°`;
          ctx.save();
          ctx.translate(cx + Math.cos(a) * span * 0.72, cy + Math.sin(a) * span * 0.72);
          ctx.rotate(Math.cos(a) < 0 ? a + Math.PI : a);
          ctx.font = "700 22px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const angleWidth = ctx.measureText(angleText).width;
          ctx.fillStyle = "rgba(255,252,245,0.94)";
          ctx.fillRect(-angleWidth / 2 - 8, -16, angleWidth + 16, 32);
          ctx.fillStyle = "#1c1917";
          ctx.fillText(angleText, 0, 0);
          ctx.restore();
        }
      };
      if (pairLinesRef.current.fedes && mark) paintAxis(mark.az, close ? "#facc15" : "rgba(250,204,21,0.9)", close ? 6 : 2);
      if (pairLinesRef.current.meroleges && mark) paintAxis((mark.az + 90) % 360, close ? "#7dd3fc" : "rgba(125,211,252,0.95)", close ? 4 : 2);
      const sirEnds = riseSetAzimuths(sirDec);
      const proEnds = proStar ? riseSetAzimuths(proStar.dec) : null;
      if (pairLinesRef.current.sirius && sirEnds) paintAxis(sirEnds.kel, "#1d4e89", 3);
      if (pairLinesRef.current.procyon && proEnds) paintAxis(proEnds.kel, "#15803d", 3);
      if (pairLinesRef.current.kot && sirEnds && proEnds) {
        const a1 = compassRadians(sirEnds.kel);
        const a2 = compassRadians(proEnds.kel);
        const x1 = cx + Math.cos(a1) * radius;
        const y1 = cy + Math.sin(a1) * radius;
        const x2 = cx + Math.cos(a2) * radius;
        const y2 = cy + Math.sin(a2) * radius;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const reach = Math.hypot(w, h) * 0.48;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        ctx.beginPath();
        ctx.moveTo(mx - ux * reach, my - uy * reach);
        ctx.lineTo(mx + ux * reach, my + uy * reach);
        ctx.strokeStyle = "#b45309";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = "#1d4e89";
        ctx.beginPath();
        ctx.arc(x1, y1, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#15803d";
        ctx.beginPath();
        ctx.arc(x2, y2, 6, 0, Math.PI * 2);
        ctx.fill();
        const bearing = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
        for (const [sign, end] of [[1, bearing], [-1, (bearing + 180) % 360]] as const) {
          const angleText = `${end.toFixed(1).replace(".", ",")}°`;
          ctx.save();
          ctx.translate(mx + ux * reach * 0.72 * sign, my + uy * reach * 0.72 * sign);
          const a = Math.atan2(dy, dx);
          ctx.rotate(Math.cos(a) < 0 ? a + Math.PI : a);
          ctx.font = "700 22px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const angleWidth = ctx.measureText(angleText).width;
          ctx.fillStyle = "rgba(255,252,245,0.94)";
          ctx.fillRect(-angleWidth / 2 - 8, -16, angleWidth + 16, 32);
          ctx.fillStyle = "#1c1917";
          ctx.fillText(angleText, 0, 0);
          ctx.restore();
        }
      }
      if ((pairLinesRef.current.fedes || pairLinesRef.current.meroleges) && mark) {
        const text = `Fedés ${mark.clock}  Szíriusz ${mark.sAlt.toFixed(0)}°  Procyon ${mark.pAlt.toFixed(0)}°`;
        ctx.font = "700 18px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const width = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(255,252,245,0.92)";
        ctx.fillRect(12, 124, width + 16, 28);
        ctx.fillStyle = "#1c1917";
        ctx.fillText(text, 20, 130);
      }
      if (pairLinesRef.current.szegely) {
        const scale = w / natW;
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = "#7c3aed";
        ctx.lineWidth = 4;
        for (const [ax, ay, bx, by] of [[2723, 880, 3037, 1184], [3098, 1007, 2660, 1054]] as const) {
          ctx.beginPath();
          ctx.moveTo(ax * scale, ay * scale);
          ctx.lineTo(bx * scale, by * scale);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (pairLinesRef.current.kozel) {
        let target = 4.442;
        if (sirEnds && proEnds) {
          const a1 = compassRadians(sirEnds.kel);
          const a2 = compassRadians(proEnds.kel);
          const dx = Math.cos(a2) - Math.cos(a1);
          const dy = Math.sin(a2) - Math.sin(a1);
          target = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 180;
        }
        const scale = w / natW;
        const paintNear = (lines: number[][], color: string) => {
          let count = 0;
          ctx.beginPath();
          for (const line of lines) {
            if (orientGap(line[0], target) > 1) continue;
            count += 1;
            ctx.moveTo(line[1] * scale, line[2] * scale);
            ctx.lineTo(line[3] * scale, line[4] * scale);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.stroke();
          return count;
        };
        ctx.save();
        ctx.lineCap = "round";
        const fugaCount = paintNear(fugaLinesRef.current, "#ea580c");
        const atloCount = paintNear(atloLinesRef.current, "#db2777");
        const nearText = `${target.toFixed(1).replace(".", ",")}° ±1°: ${fugaCount} fuga, ${atloCount} átló`;
        ctx.font = "700 18px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const nearWidth = ctx.measureText(nearText).width;
        ctx.fillStyle = "rgba(255,252,245,0.92)";
        ctx.fillRect(12, 156, nearWidth + 16, 28);
        ctx.fillStyle = "#1c1917";
        ctx.fillText(nearText, 20, 162);
        ctx.restore();
      }
      const chordAngle = () => {
        if (!sirEnds || !proEnds) return 4.442;
        const a1 = compassRadians(sirEnds.kel);
        const a2 = compassRadians(proEnds.kel);
        const dx = Math.cos(a2) - Math.cos(a1);
        const dy = Math.sin(a2) - Math.sin(a1);
        return (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 180;
      };
      if (pairLinesRef.current.egyenesen) {
        const target = chordAngle();
        const th = (target * Math.PI) / 180;
        const ux = Math.sin(th);
        const uy = -Math.cos(th);
        const nx = -uy;
        const ny = ux;
        const off = (x: number, y: number) => x * nx + y * ny;
        const items = fugaLinesRef.current
          .filter((line) => orientGap(line[0], target) <= 1)
          .map((line) => ({ line, o: (off(line[1], line[2]) + off(line[3], line[4])) / 2 }));
        items.sort((a, b) => a.o - b.o);
        const groups: { o: number; items: typeof items }[] = [];
        for (const item of items) {
          let group = groups.find((entry) => Math.abs(entry.o - item.o) <= 6);
          if (!group) {
            group = { o: item.o, items: [] };
            groups.push(group);
          }
          group.items.push(item);
          group.o = group.items.reduce((sum, entry) => sum + entry.o, 0) / group.items.length;
        }
        const chosen = groups.filter((group) => group.items.length >= 2);
        const scale = w / natW;
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = "#16a34a";
        ctx.lineWidth = 4;
        ctx.beginPath();
        let count = 0;
        for (const group of chosen) {
          for (const item of group.items) {
            count += 1;
            ctx.moveTo(item.line[1] * scale, item.line[2] * scale);
            ctx.lineTo(item.line[3] * scale, item.line[4] * scale);
          }
        }
        ctx.stroke();
        const text = `Egy vonalon: ${chosen.length} egyenes, ${count} fuga`;
        ctx.font = "700 18px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const width = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(255,252,245,0.92)";
        ctx.fillRect(12, 188, width + 16, 28);
        ctx.fillStyle = "#1c1917";
        ctx.fillText(text, 20, 194);
        ctx.restore();
      }
      if (pairLinesRef.current.derekszog) {
        const target = (chordAngle() + 90) % 180;
        const scale = w / natW;
        const paintCross = (lines: number[][], color: string) => {
          let count = 0;
          ctx.beginPath();
          for (const line of lines) {
            if (orientGap(line[0], target) > 1) continue;
            count += 1;
            ctx.moveTo(line[1] * scale, line[2] * scale);
            ctx.lineTo(line[3] * scale, line[4] * scale);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.stroke();
          return count;
        };
        ctx.save();
        ctx.lineCap = "round";
        const fugaCount = paintCross(fugaLinesRef.current, "#0891b2");
        const atloCount = paintCross(atloLinesRef.current, "#1e3a8a");
        const text = `${target.toFixed(1).replace(".", ",")}° ±1°: ${fugaCount} fuga, ${atloCount} átló`;
        ctx.font = "700 18px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const width = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(255,252,245,0.92)";
        ctx.fillRect(12, 220, width + 16, 28);
        ctx.fillStyle = "#1c1917";
        ctx.fillText(text, 20, 226);
        ctx.restore();
      }
      if (pairLinesRef.current.k63) {
        const scale = w / natW;
        const x1 = 1611 * scale;
        const y1 = 773 * scale;
        const x2 = 2043 * scale;
        const y2 = 725 * scale;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const reach = Math.hypot(w, h) * 0.48;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(mx - ux * reach, my - uy * reach);
        ctx.lineTo(mx + ux * reach, my + uy * reach);
        ctx.stroke();
        ctx.strokeStyle = "#111827";
        ctx.lineWidth = 2;
        ctx.stroke();
        const label = "K63  83,7°";
        ctx.font = "700 18px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const labelWidth = ctx.measureText(label).width;
        ctx.translate(mx, my);
        ctx.rotate(Math.cos(Math.atan2(dy, dx)) < 0 ? Math.atan2(dy, dx) + Math.PI : Math.atan2(dy, dx));
        ctx.fillStyle = "rgba(255,252,245,0.94)";
        ctx.fillRect(-labelWidth / 2 - 8, -16, labelWidth + 16, 32);
        ctx.fillStyle = "#1c1917";
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
      const paintPairs = (pairs: typeof STAR_PAIRS, enabled: boolean[], top0: number) => {
        const reach = Math.hypot(w, h) * 0.46;
        const colors = ["#f97316", "#22c55e", "#38bdf8", "#e879f9", "#facc15", "#fb7185", "#a3e635", "#67e8f9", "#ffffff", "#c4b5fd"];
        ctx.save();
        ctx.lineCap = "round";
        ctx.font = "700 15px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        let row = 0;
        pairs.forEach((pair, index) => {
          if (!enabled[index]) return;
          const a1 = compassRadians(pair.az1);
          const a2 = compassRadians(pair.az2);
          const px = cx + Math.cos(a1) * radius;
          const py = cy + Math.sin(a1) * radius;
          const qx = cx + Math.cos(a2) * radius;
          const qy = cy + Math.sin(a2) * radius;
          const dx = qx - px;
          const dy = qy - py;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const mx = (px + qx) / 2;
          const my = (py + qy) / 2;
          const color = colors[index % colors.length];
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(mx - ux * reach, my - uy * reach);
          ctx.lineTo(mx + ux * reach, my + uy * reach);
          ctx.stroke();
          ctx.font = "700 16px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const tag = pair.stone;
          const tagWidth = ctx.measureText(tag).width;
          ctx.fillStyle = "rgba(255,252,245,0.94)";
          ctx.fillRect(mx - uy * 18 - tagWidth / 2 - 6, my + ux * 18 - 12, tagWidth + 12, 24);
          ctx.fillStyle = color;
          ctx.fillText(tag, mx - uy * 18, my + ux * 18);
          ctx.font = "700 15px sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          const text = `${pair.a}–${pair.b} ${pair.kind === "kel" ? "kel" : "nyug"} · ${pair.stone}`;
          const textWidth = ctx.measureText(text).width;
          const top = top0 + row * 22;
          ctx.fillStyle = "rgba(255,252,245,0.9)";
          ctx.fillRect(12, top, textWidth + 12, 20);
          ctx.fillStyle = color;
          ctx.fillText(text, 18, top + 2);
          row += 1;
        });
        ctx.restore();
      };
      if (starOnRef.current.some(Boolean)) paintPairs(STAR_PAIRS, starOnRef.current, 260);
      if (parallelOnRef.current.some(Boolean)) paintPairs(PARALLEL_PAIRS, parallelOnRef.current, starOnRef.current.some(Boolean) ? 500 : 260);
    }
    const east = eastFlagsRef.current;
    const eastStones = ["K62", "K28", "K29", "K30", "K61", "K63", "K64", "K65"] as const;
    const eastSources = ["dendera", "fenyes", "nap"] as const;
    const stonesOn = eastStones.filter((id) => east[id]);
    const sourcesOn = eastSources.filter((id) => east[id]);
    if (east.result || east.kel || stonesOn.length || sourcesOn.length) {
      const scale = w / natW;
      const colors = { dendera: "#b45309", fenyes: "#15803d", nap: "#2563eb" } as const;
      const occupied: { l: number; r: number; t: number; b: number }[] = [];
      const paintLine = (x: number, y: number, line: number, color: string, label: string, slot: number) => {
        const sx = x * scale;
        const sy = y * scale;
        const th = (line * Math.PI) / 180;
        const ux = Math.sin(th);
        const uy = -Math.cos(th);
        const reach = Math.hypot(w, h);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(sx - ux * reach, sy - uy * reach);
        ctx.lineTo(sx + ux * reach, sy + uy * reach);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.font = "700 14px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const width = ctx.measureText(label).width;
        let top = sy - 16 - slot * 20;
        const left = sx + 12;
        const boxW = width + 10;
        for (let guard = 0; guard < 30; guard += 1) {
          const boxT = top - 10;
          const boxB = boxT + 20;
          const hit = occupied.some((box) => left < box.r && left + boxW > box.l && boxT < box.b && boxB > box.t);
          if (!hit) break;
          top -= 22;
        }
        occupied.push({ l: left, r: left + boxW, t: top - 10, b: top + 10 });
        ctx.fillStyle = "rgba(255,252,245,0.92)";
        ctx.fillRect(left, top - 10, boxW, 20);
        ctx.fillStyle = color;
        ctx.fillText(label, left + 5, top);
        ctx.restore();
      };
      if (east.result) {
        RESULT_LINKS.forEach((link, index) => paintLine(link.x, link.y, link.line, "#7c3aed", `${link.stone} · ${link.name} ${link.gap.toFixed(2)}°`, index === 0 ? 0 : 0));
      }
      if (stonesOn.length || sourcesOn.length) {
        const stones = stonesOn.length ? stonesOn : eastStones;
        const sources = sourcesOn.length ? sourcesOn : eastSources;
        for (const stone of stones) {
          let slot = 0;
          for (const source of sources) {
            const anchor = EAST_LINKS.find((item) => item.stone === stone);
            let link: { x: number; y: number; line: number; a: string; b: string; kind: string; gap: number } | null =
              source === "nap" ? null : (EAST_LINKS.find((item) => item.stone === stone && item.source === source) ?? null);
            if (source === "nap" && anchor) {
              const year = Number(dayNumRef.current.replace(",", "."));
              const month = Number(monthRef.current.replace(",", "."));
              const day = Number(dateDayRef.current.replace(",", "."));
              const astro = astroYear(eraRef.current, year);
              const floor = stoneListRef.current.find((item) => item.id === stone);
              if (astro !== null && floor && Number.isFinite(month) && Number.isFinite(day)) {
                const jd = julianDayNoon(astro, month, day);
                const decOf = new Map(planetPlaces(jd, 0).map((body) => [body.nev, body.dec]));
                decOf.set("Nap", (sunEquator(jd).dec * Math.PI) / 180);
                const found = bestPlanetLink(floor, decOf);
                if (found) link = { x: anchor.x, y: anchor.y, ...found };
              }
            }
            if (!link) continue;
            paintLine(link.x, link.y, link.line, colors[source], `${stone} · ${link.a}–${link.b} ${link.kind} ${link.gap.toFixed(3)}°`, slot);
            slot += 1;
          }
        }
      }
      if (east.kel) {
        const slots = new Map<string, number>();
        for (const link of RISE_PERP) {
          const slot = slots.get(link.stone) ?? 0;
          slots.set(link.stone, slot + 1);
          paintLine(link.x, link.y, link.line, link.anchor === "Szíriusz" ? "#1d4e89" : "#6d28d9", `${link.stone} · ${link.anchor}–${link.mate} ${link.gap.toFixed(3)}°`, slot);
        }
      }
    }
    if (eastFlagsRef.current.kozos) {
      const scale = w / natW;
      const deg = (value: number, digits: number) => `${value.toFixed(digits).replace(".", ",")}°`;
      const along = (x1: number, y1: number, x2: number, y2: number, text: string, color: string, t: number, side: number) => {
        const sx1 = x1 * scale;
        const sy1 = y1 * scale;
        const sx2 = x2 * scale;
        const sy2 = y2 * scale;
        const dx = sx2 - sx1;
        const dy = sy2 - sy1;
        const len = Math.hypot(dx, dy) || 1;
        let rot = Math.atan2(dy, dx);
        if (rot > Math.PI / 2 || rot < -Math.PI / 2) rot += Math.PI;
        ctx.save();
        ctx.translate(sx1 + dx * t + (-dy / len) * side, sy1 + dy * t + (dx / len) * side);
        ctx.rotate(rot);
        ctx.font = "700 13px sans-serif";
        const width = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(255,252,245,0.92)";
        ctx.fillRect(-width / 2 - 3, -9, width + 6, 16);
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 0, 0);
        ctx.restore();
      };
      for (const link of KOZOS) {
        const sx1 = link.x1 * scale;
        const sy1 = link.y1 * scale;
        const sx2 = link.x2 * scale;
        const sy2 = link.y2 * scale;
        ctx.save();
        ctx.strokeStyle = "#b45309";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.lineTo(sx2, sy2);
        ctx.stroke();
        ctx.restore();
        along(link.x1, link.y1, link.x2, link.y2, `átló ${deg(link.diag, 1)}`, "#b45309", 0.18, 16);
        link.chords.forEach((chord, index) => {
          const color = chord.mate === "Procyon" ? "#0f766e" : chord.anchor === "Szíriusz" ? "#1d4e89" : "#6d28d9";
          const th = (chord.line * Math.PI) / 180;
          const ux = Math.sin(th);
          const uy = -Math.cos(th);
          const mx = (link.x1 + link.x2) / 2;
          const my = (link.y1 + link.y2) / 2;
          const reach = 620;
          const x1 = mx - ux * reach;
          const y1 = my - uy * reach;
          const x2 = mx + ux * reach;
          const y2 = my + uy * reach;
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(x1 * scale, y1 * scale);
          ctx.lineTo(x2 * scale, y2 * scale);
          ctx.stroke();
          ctx.restore();
          along(x1, y1, x2, y2, `${chord.anchor}–${chord.mate} ${deg(chord.line, 1)}`, color, 0.78, 16 + index * 18);
          const meet = deg(90 - chord.gap, 2);
          const smx = mx * scale;
          const smy = my * scale - index * 18;
          ctx.save();
          ctx.font = "700 14px sans-serif";
          const width = ctx.measureText(meet).width;
          ctx.fillStyle = "rgba(255,252,245,0.94)";
          ctx.fillRect(smx - width / 2 - 4, smy - 10, width + 8, 18);
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(meet, smx, smy);
          ctx.restore();
        });
      }
    }
    if (marks.alkaid) {
      const ang = compassRadians(alkaidAz);
      const x = cx + Math.cos(ang) * radius;
      const y = cy + Math.sin(ang) * radius;
      const seen = alkaidLit === 1 ? "látható" : alkaidAbove && sunAlt < 0 ? "szürkület" : alkaidAbove ? "nappali égen" : "a horizont alatt";
      const lit = alkaidLit === 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = lit ? "#d7f6ff" : alkaidAbove ? "#1a7f9c" : "rgba(26,127,156,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (lit) {
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(190,240,255,0.9)";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, lit ? 26 : 8, 0, Math.PI * 2);
      ctx.fillStyle = lit ? "#e9fbff" : alkaidAbove ? "#1a7f9c" : "rgba(26,127,156,0.45)";
      ctx.fill();
      ctx.lineWidth = lit ? 6 : 3;
      ctx.strokeStyle = lit ? "#7ad7f0" : "#0c3a4a";
      ctx.stroke();
      const line = marks.sun && marks.sirius ? 122 : marks.sun || marks.sirius ? 96 : 70;
      ctx.font = "700 20px sans-serif";
      ctx.fillStyle = lit ? "#e9fbff" : "#1c1917";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`Alkaid ${alkaidAlt.toFixed(0)}°  ${seen}`, 16, line);
    }
    ctx.restore();
    paintRoses();
    paintSectors();
    paintAzimuth();
    paintWagon();
    paintNovae();
    paintCcw();
    paintFrameMarks();
    }
    const altItems: AltItem[] = [];
    const note = (name: string, alt: number, color: string, dec: number, hourAngle: number) => {
      const showCulm = culmOnRef.current;
      altItems.push({ name, alt, color, culm: altitudeDeg(dec, 0), atCulm: showCulm && culminationFlash(name, hourAngle), showCulm });
    };
    if (chosen.nap) note("Nap", sunAlt, "#d97706", sunDec, hour);
    if (chosen.sirius) note("Szíriusz", siriusAlt, "#1d4e89", sirDec, hour - shift);
    if (chosen.alkaid) note("Alkaid", alkaidAlt, "#1a7f9c", alkDec, hour - alkShift);
    if (chosen.goncol) {
      for (const star of wagon) {
        if (chosen.alkaid && star.nev === "Alkaid") continue;
        note(star.nev, star.alt, star.color, star.dec, hour - star.shift);
      }
    }
    for (const star of bursts) note(`SN ${star.nev}`, star.alt, star.color, star.dec, hour - star.shift);
    for (const star of showers) note(star.nev, star.alt, star.color, star.dec, hour - star.shift);
    for (const star of worlds) note(star.nev, star.alt, star.color, star.dec + star.ddec * dayFrac, hour - star.shift - star.dra * dayFrac);
    for (const star of brightStars) note(star.nev, star.alt, star.color, star.dec, hour - star.shift);
    for (const figure of zodiac) {
      const star = figure.csillagok[figure.vezeto];
      note(figure.nev, star.alt, figure.color, star.dec, hour - star.shift);
    }
    altLiveRef.current = decayOpenRef.current ? altLiveRef.current : altItems;
    const skyDots: SkyDot[] = [];
    const skyArcs: SkyArc[] = [];
    const markDot = (name: string, az: number, alt: number, color: string, dim = false) => {
      skyDots.push({ name, az, alt, color, dim });
    };
    const trackOf = (dec: number, shift: number, color: string) => {
      if (!pathOnRef.current) return;
      const points: { az: number; alt: number }[] = [];
      for (let clock = 0; clock <= 360; clock += 8) {
        const sample = ((clock - 180) * Math.PI) / 180;
        points.push({ az: azimuthDeg(dec, sample - shift), alt: altitudeDeg(dec, sample - shift) });
      }
      skyArcs.push({ points, color });
    };
    const sectorOf = (name: string, color: string, sun: boolean, dec: number, shift: number) => {
      if (!sectorOnRef.current) return;
      const found = visibilitySectors(name, color, sun, sunDec, (sample) => ({ dec, hour: sample - shift }));
      for (const sector of found) {
        if (sector.kind === "nincs" || sector.kind === "nappal") continue;
        const points: { az: number; alt: number }[] = [];
        if (sector.kind === "mindig") {
          for (let az = 0; az <= 360; az += 8) points.push({ az, alt: 8 });
        } else {
          let span = sector.end - sector.start;
          if (span < 0) span += 360;
          const steps = Math.max(2, Math.round(span / 4));
          for (let step = 0; step <= steps; step += 1) points.push({ az: sector.start + (span * step) / steps, alt: 2 });
        }
        skyArcs.push({ points, color });
      }
    };
    if (chosen.nap) {
      markDot("Nap", sunAz, sunAlt, "#e6a100");
      trackOf(sunDec, 0, "#e6a100");
      sectorOf("Nap", "#e6a100", true, sunDec, 0);
    }
    if (chosen.sirius) {
      markDot("Szíriusz", siriusAz, siriusAlt, "#1d4e89", shine !== 1);
      trackOf(sirDec, shift, "#1d4e89");
      sectorOf("Szíriusz", "#1d4e89", false, sirDec, shift);
    }
    if (chosen.alkaid) {
      markDot("Alkaid", alkaidAz, alkaidAlt, "#1a7f9c", alkaidLit !== 1);
      trackOf(alkDec, alkShift, "#1a7f9c");
      sectorOf("Alkaid", "#1a7f9c", false, alkDec, alkShift);
    }
    if (chosen.goncol) {
      for (const star of wagon) {
        if (chosen.alkaid && star.nev === "Alkaid") continue;
        markDot(star.nev, star.az, star.alt, star.color, !star.lit);
        trackOf(star.dec, star.shift, star.color);
        sectorOf(star.nev, star.color, false, star.dec, star.shift);
      }
    }
    for (const star of bursts) {
      markDot(`SN ${star.nev}`, star.az, star.alt, star.color, !star.lit);
      trackOf(star.dec, star.shift, star.color);
    }
    for (const star of showers) {
      markDot(star.nev, star.az, star.alt, star.color, !star.lit);
      trackOf(star.dec, star.shift, star.color);
    }
    for (const star of brightStars) {
      markDot(star.nev, star.az, star.alt, star.color, !star.lit);
      trackOf(star.dec, star.shift, star.color);
    }
    for (const star of worlds) {
      markDot(star.nev, star.az, star.alt, star.color, !star.lit);
      trackOf(star.dec + star.ddec * dayFrac, star.shift + star.dra * dayFrac, star.color);
    }
    for (const figure of zodiac) {
      const star = figure.csillagok[figure.vezeto];
      markDot(figure.nev, star.az, star.alt, figure.color, !star.lit);
      trackOf(star.dec, star.shift, figure.color);
    }
    const floorLines: FloorSeg[] = [];
    const pushLine = (line: number[], color: string, width: number) => {
      floorLines.push({ x1: line[1] * s, y1: line[2] * s, x2: line[3] * s, y2: line[4] * s, color, width });
    };
    if (showFugaNet) for (const line of fugaLinesRef.current) pushLine(line, "rgba(20,20,20,0.75)", 1.4);
    if (showAtloNet) for (const line of atloLinesRef.current) pushLine(line, "rgba(88,28,135,0.7)", 1.4);
    if (orientRef.current) {
      const cx = w / 2;
      const cy = h / 2;
      const span = Math.hypot(w, h);
      for (const deg of [18.65, 108.65]) {
        const ang = compassRadians(deg);
        floorLines.push({
          x1: cx - Math.cos(ang) * span,
          y1: cy - Math.sin(ang) * span,
          x2: cx + Math.cos(ang) * span,
          y2: cy + Math.sin(ang) * span,
          color: "rgba(154,52,18,0.9)",
          width: 2,
        });
      }
    }
    sky3d = { lines: floorLines, dots: skyDots, arcs: skyArcs, night };
    } catch (error) {
      console.error(error);
    }
    if (moonPlayRef.current || moonTime) {
      const year = Number(dayNumRef.current.replace(",", "."));
      const astro = Number.isInteger(year) && year >= 1 ? (eraRef.current === "ie" ? 1 - year : year) : null;
      if (astro !== null) {
        const start = dayOfYear(astro, Number(moonFromMonthRef.current), Number(moonFromDayRef.current));
        const end = dayOfYear(astro, Number(moonToMonthRef.current), Number(moonToDayRef.current));
        const total = yearDayCount(astro);
        const span = Math.max(1, end >= start ? end - start + 1 : total - start + end + 1);
        const index = start + (((moonCursorRef.current % span) + span) % span);
        const date = dateFromYearDay(astro, index);
        const jd = julianDayNoon(astro, date.month, date.day);
        const phase = moonPhase(jd);
        const sun = sunEquator(jd);
        const moon = moonEquator(jd);
        const sunHa = meanNoonHourAngle(astro, date.month, date.day, sun.ra);
        const moonHa = meanNoonHourAngle(astro, date.month, date.day, moon.ra);
        const deg = Math.PI / 180;
        const caption = `${eraRef.current === "ie" ? "i. e." : "i. sz."} ${year}. ${MOON_MONTHS[date.month - 1]} ${date.day}. · ${phase.name} · ${Math.round(phase.fraction * 100)}%`;
        if (moonTime && moonYearArcRef.current) paintYearArc(ctx, w, h, astro, index);
        if (moonTime && moonSectorRef.current) {
          const sunDec = sun.dec * deg;
          const moonDec = moon.dec * deg;
          const shift = ((((moon.ra - sun.ra) % 360) + 360) % 360) * deg;
          const sectors = visibilitySectors("Hold", "#475569", false, sunDec, (hour) => ({ dec: moonDec, hour: hour - shift }));
          const base = Math.min(w, h) * 0.34;
          const cx = w / 2;
          const cy = h / 2;
          ctx.save();
          sectors.forEach((sector) => {
            if (sector.kind === "nincs" || sector.kind === "nappal") return;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            if (sector.kind === "mindig") ctx.arc(cx, cy, base, 0, Math.PI * 2);
            else ctx.arc(cx, cy, base, compassRadians(sector.start), compassRadians(sector.end));
            ctx.closePath();
            ctx.fillStyle = hexAlpha("#475569", 0.28);
            ctx.fill();
            ctx.strokeStyle = "#475569";
            ctx.lineWidth = 2;
            ctx.stroke();
          });
          ctx.font = "700 16px sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          const bits = sectors.map((sector) => {
            const norm = (degree: number) => Math.round(((degree % 360) + 360) % 360);
            if (sector.kind === "nincs") return "nem emelkedik látható magasságba";
            if (sector.kind === "nappal") return "csak nappal van fent";
            if (sector.kind === "mindig") return "egész nap látszik";
            return `${norm(sector.start)}–${norm(sector.end)}°`;
          });
          const text = `Hold: ${bits.join(" és ")}`;
          const width = ctx.measureText(text).width;
          const labelY = h - 52;
          ctx.fillStyle = "rgba(255,252,245,0.88)";
          ctx.fillRect(16, labelY - 18, width + 28, 22);
          ctx.fillStyle = "#475569";
          ctx.fillRect(20, labelY - 12, 10, 10);
          ctx.fillStyle = "#1c1917";
          ctx.fillText(text, 36, labelY);
          ctx.restore();
        }
        paintMoonOrbit(ctx, w, h, {
          elongation: phase.elongation,
          sunAz: azimuthDeg(sun.dec * deg, sunHa),
          sunAlt: altitudeDeg(sun.dec * deg, sunHa),
          moonAz: azimuthDeg(moon.dec * deg, moonHa),
          moonAlt: altitudeDeg(moon.dec * deg, moonHa),
        }, caption);
        if (sky3d) {
          sky3d.dots.push({ name: "Nap, dél", az: azimuthDeg(sun.dec * deg, sunHa), alt: altitudeDeg(sun.dec * deg, sunHa), color: "#e6a100" });
          sky3d.dots.push({ name: "Hold", az: azimuthDeg(moon.dec * deg, moonHa), alt: altitudeDeg(moon.dec * deg, moonHa), color: "#475569" });
        }
      }
    }
    if (festRef.current && !view3dRef.current) {
      const year = Number(String(dayNumRef.current).replace(",", "."));
      const astro = Number.isInteger(year) && year >= 1 ? (eraRef.current === "ie" ? 1 - year : year) : -53;
      paintFestivalRing(ctx, w, h, astro, Number(monthRef.current) || 7, Number(dateDayRef.current) || 16);
    }
    if (analOpenRef.current && !view3dRef.current) {
      const floor = analFloorRef.current;
      const pick = analPickRef.current;
      const span = analSpanRef.current;
      const cursor = analCursorRef.current;
      const source = floor.length ? analHitsRef.current : analHitsRef.current.filter((hit) => analOnRef.current[hit.group]);
      const chosen = floor.length
        ? source.filter((hit) => floor.some((item) => item.group === hit.group && item.kind === hit.kind))
        : pick
          ? source.filter((hit) => hit.group === pick.group && hit.year === pick.year && hit.name === pick.name && hit.kind === pick.kind)
          : source.filter((hit) => Math.abs(hit.year - cursor) <= span.step / 2);
      const seen = new Set<string>();
      const marks: { az: number; kind: AnalKind; name: string }[] = [];
      for (const hit of [...chosen].sort((a, b) => a.gap - b.gap)) {
        const key = `${hit.group}:${hit.kind}:${Math.round(hit.az)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        marks.push({ az: hit.az, kind: hit.kind, name: hit.name });
      }
      paintAnalMarks(ctx, w, h, marks);
    }
    if (view3dRef.current && sky3d) {
      let plate = plateRef.current;
      if (!plate) {
        plate = document.createElement("canvas");
        plateRef.current = plate;
      }
      if (plate.width !== w || plate.height !== h) {
        plate.width = w;
        plate.height = h;
      }
      const plateCtx = plate.getContext("2d");
      if (plateCtx) {
        plateCtx.clearRect(0, 0, w, h);
        if (!paintPhoto(plateCtx)) {
          plateCtx.fillStyle = "#fff";
          plateCtx.fillRect(0, 0, w, h);
        }
        if (dendera && pickedStonesRef.current.length) {
          plateCtx.save();
          plateCtx.lineWidth = 2;
          plateCtx.strokeStyle = "#9a3412";
          plateCtx.fillStyle = "rgba(202,138,4,0.38)";
          const scale = w / natW;
          for (const id of pickedStonesRef.current) {
            const stone = stoneListRef.current.find((item) => item.id === id);
            if (!stone) continue;
            const outline = stoneOutline(stone);
            plateCtx.beginPath();
            outline.forEach((point, index) => index ? plateCtx.lineTo(point[0] * scale, point[1] * scale) : plateCtx.moveTo(point[0] * scale, point[1] * scale));
            plateCtx.closePath();
            plateCtx.fill();
            plateCtx.stroke();
          }
          plateCtx.restore();
        }
        if (dendera && funcsRef.current.kcsucs && floorOnRef.current) {
          const seen = new Set<string>();
          const scale = w / natW;
          for (const line of fugaLinesRef.current) {
            for (const point of [[line[1], line[2]], [line[3], line[4]]]) {
              const key = `${Math.round(point[0])},${Math.round(point[1])}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const shown = canvas.clientWidth || w;
              const halo = Math.max(0.7, (2 * w) / shown);
              const dot = Math.max(0.45, (1.25 * w) / shown);
              const px = point[0] * scale;
              const py = point[1] * scale;
              plateCtx.beginPath();
              plateCtx.arc(px, py, halo, 0, Math.PI * 2);
              plateCtx.fillStyle = "#fff";
              plateCtx.fill();
              plateCtx.beginPath();
              plateCtx.arc(px, py, dot, 0, Math.PI * 2);
              plateCtx.fillStyle = "#9a3412";
              plateCtx.fill();
            }
          }
        }
        if (festRef.current) {
          const year = Number(String(dayNumRef.current).replace(",", "."));
          const astro = Number.isInteger(year) && year >= 1 ? (eraRef.current === "ie" ? 1 - year : year) : -53;
          paintFestivalRing(plateCtx, w, h, astro, Number(monthRef.current) || 7, Number(dateDayRef.current) || 16);
        }
      }
      ctx.clearRect(0, 0, w, h);
      const gl = glRef.current;
      if (gl) renderSkyGL(gl, w, h, camRef.current, floorOnRef.current ? plate : null, sky3d.lines, sky3d.dots, sky3d.arcs, compassRef.current, sky3d.night);
      if (moonTime && moonYearArcRef.current) {
        const year = Number(dayNumRef.current.replace(",", "."));
        const astro = Number.isInteger(year) && year >= 1 ? (eraRef.current === "ie" ? 1 - year : year) : null;
        if (astro !== null) {
          const start = dayOfYear(astro, Number(moonFromMonthRef.current), Number(moonFromDayRef.current));
          const end = dayOfYear(astro, Number(moonToMonthRef.current), Number(moonToDayRef.current));
          const total = yearDayCount(astro);
          const span = Math.max(1, end >= start ? end - start + 1 : total - start + end + 1);
          const index = start + (((moonCursorRef.current % span) + span) % span);
          paintYearArc(ctx, w, h, astro, index);
        }
      }
    }
  };

  function currentAstro() {
    const year = Number(String(dayNumRef.current).replace(",", "."));
    return astroYear(eraRef.current, Number.isInteger(year) ? year : 54) ?? -53;
  }

  function chosenSpan() {
    const from = astroYear(analFromEra, Number(analFromText.replace(",", ".")));
    const to = astroYear(analToEra, Number(analToText.replace(",", ".")));
    if (from === null || to === null) return analSpan(analBand, currentAstro());
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const width = hi - lo;
    const step = width > 1200 ? 10 : width > 500 ? 5 : 1;
    return { from: lo, to: hi, step };
  }

  function fillBand(band: AnalBand) {
    setAnalBand(band);
    const span = analSpan(band, currentAstro());
    const from = eraLabel(span.from);
    const to = eraLabel(span.to);
    setAnalFromEra(from.era);
    setAnalFromText(String(from.year));
    setAnalToEra(to.era);
    setAnalToText(String(to.year));
  }

  async function runAnal(seasons: boolean) {
    const token = analTokenRef.current + 1;
    analTokenRef.current = token;
    setAnalPlay(false);
    setAnalPick(null);
    analFloorRef.current = [];
    setAnalFloor([]);
    const astro = currentAstro();
    const span = seasons ? chosenSpan() : { from: astro, to: astro, step: 1 };
    analSpanRef.current = span;
    analCursorRef.current = astro;
    setAnalCursor(astro);
    if (projectRef.current !== "dendera") {
      setAnalHits([]);
      setAnalNote("Ehhez a képhez nincs fuga- és átlómérés. A darabszám ettől függetlenül a táblában olvasható.");
      drawRef.current();
      return;
    }
    const fuga = histBinsRef.current ? roseBands(histBinsRef.current) : [];
    const atlo = atloHistBinsRef.current ? roseBands(atloHistBinsRef.current) : [];
    if (!fuga.length && !atlo.length) {
      setAnalHits([]);
      setAnalNote("A fugaháló még nincs betöltve.");
      return;
    }
    setAnalNote("Számolás…");
    const month = Number(monthRef.current) || 7;
    const day = Number(dateDayRef.current) || 16;
    const eye = analOnRef.current.lat;
    const hits: AnalHit[] = [];
    for (let year = span.from; year <= span.to; year += span.step) {
      if (token !== analTokenRef.current) return;
      hits.push(...yearMarks(year, month, day, fuga, atlo, eye, seasons));
      if (seasons && (year - span.from) % (span.step * 25) === 0) {
        setAnalNote(`Számolás: ${yearText(year)}`);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
    if (token !== analTokenRef.current) return;
    const kept = new Map<string, AnalHit>();
    for (const hit of hits) {
      const key = `${hit.group}|${hit.year}|${hit.kind}`;
      const prev = kept.get(key);
      if (!prev || hit.gap < prev.gap) kept.set(key, hit);
    }
    const shown = [...kept.values()];
    setAnalHits(shown);
    setAnalNote(shown.length ? `${shown.length} találat, ${yearText(span.from)} – ${yearText(span.to)}.` : "Nincs találat ebben a sávban.");
    if (seasons && span.to > span.from) setAnalPlay(true);
    drawRef.current();
  }

  useEffect(() => {
    if (!analPlay) return;
    const timer = window.setInterval(() => {
      const span = analSpanRef.current;
      const pace = Math.max(1, analPaceRef.current);
      setAnalCursor((year) => {
        const next = year + analDirRef.current * span.step * pace;
        if (next > span.to || next < span.from) {
          window.setTimeout(() => setAnalPlay(false), 0);
          const edge = Math.max(span.from, Math.min(span.to, next));
          analCursorRef.current = edge;
          return edge;
        }
        analCursorRef.current = next;
        return next;
      });
      drawRef.current();
    }, 320);
    return () => window.clearInterval(timer);
  }, [analPlay]);

  const applyNorthRef = useRef<(deg: number) => void>(() => {});
  const angleSaveRef = useRef(0);
  applyNorthRef.current = (deg: number) => {
    const base = projectRef.current === "dendera" || isRoofFull2(projectNameRef.current) ? HATHOR_DEG : 0;
    const turn = deg - base;
    northOffset = turn;
    const und = (azimuth: number) => ((azimuth + turn) % 180 + 180) % 180;
    const shiftLines = (raw: number[][]) => raw.map((line) => [und(line[0]), line[1], line[2], line[3], line[4]]);
    const shiftGroups = (raw: FugaGroup[]) => raw.map((group) => ({ ...group, szog: und(group.szog) }));
    if (fugaRawRef.current.length) {
      fugaLinesRef.current = shiftLines(fugaRawRef.current);
      const groups = shiftGroups(fugaGroupRawRef.current);
      fugaGroupsRef.current = groups;
      if (sourceRef.current === "fuga") {
        groupsRef.current = groups;
        listRef.current = groups;
        linesRef.current = fugaLinesRef.current;
      }
      const bins = Array.from({ length: 180 }, () => 0);
      for (const line of fugaLinesRef.current) bins[Math.floor(line[0]) % 180] += Math.hypot(line[3] - line[1], line[4] - line[2]);
      histBinsRef.current = bins;
    }
    if (atloRawRef.current.length) {
      atloLinesRef.current = shiftLines(atloRawRef.current);
      const groups = shiftGroups(atloGroupRawRef.current);
      atloGroupsRef.current = groups;
      if (sourceRef.current === "atlo") {
        groupsRef.current = groups;
        listRef.current = groups;
        linesRef.current = atloLinesRef.current;
      }
      const bins = Array.from({ length: 180 }, () => 0);
      for (const line of atloLinesRef.current) bins[Math.floor(line[0]) % 180] += Math.hypot(line[3] - line[1], line[4] - line[2]);
      atloHistBinsRef.current = bins;
    }
    const row = angleRow(turn, fugaRawRef.current, atloRawRef.current);
    row.szog = Math.round(((((deg % 360) + 360) % 360) * 100)) / 100;
    window.clearTimeout(angleSaveRef.current);
    angleSaveRef.current = window.setTimeout(() => {
      setAngleRows((rows) => {
        const next = [...rows.filter((item) => item.szog !== row.szog), row].sort((a, b) => a.szog - b.szog);
        localStorage.setItem(ANGLE_KEY, JSON.stringify(next));
        return next;
      });
    }, 400);
    drawRef.current();
  };

  useEffect(() => {
    applyNorthRef.current(floorDeg);
    setBandStamp((n) => n + 1);
  }, [floorDeg]);

  useEffect(() => {
    const el = floorStageRef.current;
    if (!el) return;
    const apply = () => setStageSize({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const obs = new ResizeObserver(apply);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!floorSrc) {
      imgRef.current = null;
      setPhotoNatural({ w: 0, h: 0 });
      drawRef.current();
      return;
    }
    let cancel = false;
    const img = new Image();
    img.onload = () => {
      if (cancel) return;
      imgRef.current = img;
      setPhotoNatural({ w: img.naturalWidth, h: img.naturalHeight });
      setVertexStamp((n) => n + 1);
      drawRef.current();
    };
    img.src = floorSrc;
    return () => {
      cancel = true;
    };
  }, [floorSrc]);

  useEffect(() => {
    fetch("/padlo-18-korvonal.json")
      .then((response) => response.json())
      .then((data: Record<string, [number, number][]>) => {
        Object.entries(data).forEach(([id, points]) => stoneShapes.set(id, points));
        drawRef.current();
      })
      .catch(() => undefined);
    fetch(DATA)
      .then((response) => response.json())
      .then((data: { kovek: Stone[] }) => {
        stoneListRef.current = data.kovek ?? [];
        setStoneList(data.kovek ?? []);
        drawRef.current();
      })
      .catch(() => setStoneList([]));
    fetch("/fugak-csoportok.json")
      .then((response) => response.json())
      .then((data: FugaData) => {
        fugaRawRef.current = data.vonalak.map((line) => line.slice());
        fugaGroupRawRef.current = data.csoportok;
        applyNorthRef.current(floorDegRef.current);
      })
      .catch(() => setLabel("A fugaadatok nem töltődtek be"));
    fetch("/atlok-csoportok.json")
      .then((response) => response.json())
      .then((data: FugaData) => {
        atloRawRef.current = data.vonalak.map((line) => line.slice());
        atloGroupRawRef.current = data.csoportok;
        applyNorthRef.current(floorDegRef.current);
      })
      .catch(() => setLabel("Az átlóadatok nem töltődtek be"));
  }, []);

  useEffect(() => {
    if (!on || frozen) return;
    const timer = window.setInterval(() => {
      const list = listRef.current.length ? listRef.current : groupsRef.current;
      if (!list.length || freezeRef.current) return;
      indexRef.current = (indexRef.current + 1) % list.length;
      drawRef.current();
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [on, frozen, stepMs]);

  useEffect(() => {
    if (follow === "none") return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      if (pairHoldRef.current > now) {
        drawRef.current();
        frame = requestAnimationFrame(loop);
        return;
      }
      if (!motionPauseRef.current) {
        const step = motionDirRef.current * (dt / sunMsRef.current) * motionRateRef.current * 360;
        sunAzRef.current = (((sunAzRef.current + step) % 360) + 360) % 360;
      }
      if (motionClockRef.current) motionClockRef.current.textContent = clockLabel(sunAzRef.current);
      if (pairLinesRef.current.fedes) {
        const skyDate = skyDateRef.current;
        const pro = skyDate?.bright.find((star) => star.id === "f37279");
        if (skyDate && pro) {
          const hour = ((sunAzRef.current - 180) * Math.PI) / 180;
          const siriusAzimuth = azimuthDeg(skyDate.sirDec, hour - skyDate.shift);
          const procyonAzimuth = azimuthDeg(pro.dec, hour - pro.shift);
          let gap = Math.abs(siriusAzimuth - procyonAzimuth);
          if (gap > 180) gap = 360 - gap;
          const siriusAltitude = altitudeDeg(skyDate.sirDec, hour - skyDate.shift);
          const procyonAltitude = altitudeDeg(pro.dec, hour - pro.shift);
          if (gap < 1.2 && siriusAltitude > 0 && procyonAltitude > 0) {
            if (!pairLockRef.current) {
              pairHoldRef.current = now + 1800;
              pairLockRef.current = true;
            }
          } else if (gap > 8) pairLockRef.current = false;
        }
      }
      drawRef.current();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [follow]);

  useEffect(() => {
    if (!moonPlay) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      moonCursorRef.current += ((now - last) / 1000) * moonSpeedRef.current;
      last = now;
      drawRef.current();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [moonPlay]);

  function toggleSky(key: "sav" | "kel" | "nyug" | "band" | "sun" | "sirius" | "glow" | "aim" | "alkaid" | "alkaidGlow" | "alkaidAim" | "alkaidAtlo" | "goncol" | "goncolGlow" | "goncolAim" | "goncolAtlo") {
    const next = { ...skyRef.current, [key]: !skyRef.current[key] };
    skyRef.current = next;
    setSky(next);
    if ((key === "alkaidAim" && next.alkaidAim) || (key === "alkaidAtlo" && next.alkaidAtlo)) {
      setScene("eg");
      sceneRef.current = "eg";
      if (follow === "none") {
        const start = skyDateRef.current?.alkClock;
        if (start != null) sunAzRef.current = start;
        setFollow(key === "alkaidAtlo" ? "alkaid-atlo" : "alkaid-fuga");
      }
    }
    if ((key === "alkaidAim" || key === "alkaidAtlo") && !next.alkaidAim && !next.alkaidAtlo && (follow === "alkaid-fuga" || follow === "alkaid-atlo")) {
      setFollow("none");
    }
    if ((key === "goncol" && next.goncol) || (key === "goncolAim" && next.goncolAim) || (key === "goncolAtlo" && next.goncolAtlo)) {
      setScene("eg");
      sceneRef.current = "eg";
      if (follow === "none") {
        const start = skyDateRef.current?.alkClock;
        if (start != null) sunAzRef.current = start;
        setFollow(key === "goncolAtlo" ? "goncol-atlo" : key === "goncolAim" ? "goncol-fuga" : "goncol-mozgas");
      }
    }
    if (key === "goncol" && !next.goncol && follow === "goncol") setFollow("none");
    if ((key === "goncol" || key === "goncolAim" || key === "goncolAtlo") && !next.goncol && !next.goncolAim && !next.goncolAtlo && (follow === "goncol-mozgas" || follow === "goncol-fuga" || follow === "goncol-atlo")) {
      setFollow("none");
    }
    drawRef.current();
  }

  function readBounds() {
    const from = Number(fromText.replace(",", "."));
    const to = Number(toText.replace(",", "."));
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      setRangeNote("A két határ legyen szám.");
      return null;
    }
    setRangeNote("");
    return { from, to };
  }

  function playBand() {
    const bounds = readBounds();
    if (!bounds) return;
    const list = groupsRef.current.filter((group) => inAngleRange(group.szog, bounds.from, bounds.to));
    if (!list.length) {
      setRangeNote("Ebben a tartományban nincs fuga.");
      return;
    }
    freezeRef.current = null;
    listRef.current = list;
    indexRef.current = 0;
    setFrozen(false);
    setFollow("none");
    followRef.current = "none";
    animReasonRef.current = "settings";
    setAnim(true);
    setRangeNote(`${bounds.from}–${bounds.to}° között, ${list.length} szög.`);
    drawRef.current();
  }

  function playAll() {
    freezeRef.current = null;
    listRef.current = groupsRef.current;
    indexRef.current = 0;
    setFrozen(false);
    setFollow("none");
    followRef.current = "none";
    animReasonRef.current = "settings";
    setAnim(true);
    setRangeNote("A teljes kör, 0–180°.");
    drawRef.current();
  }

  function showSource(next: "fuga" | "atlo") {
    sourceRef.current = next;
    setSource(next);
    freezeRef.current = null;
    setFrozen(false);
    const groups = next === "atlo" ? atloGroupsRef.current : fugaGroupsRef.current;
    const lines = next === "atlo" ? atloLinesRef.current : fugaLinesRef.current;
    linesRef.current = lines;
    groupsRef.current = groups;
    listRef.current = groups;
    indexRef.current = 0;
    setRangeNote(next === "atlo" ? "Átlók, 1°-os iránycsoportok. Egy átló mindkét vége felé mutat." : "");
    drawRef.current();
  }

  function playOnly(kind: "fuga" | "nap" | "sirius" | "egyutt" | "alkaid" | "goncol") {
    if (kind === "fuga") {
      setScene("leltar");
      sceneRef.current = "leltar";
      setFollow("none");
      freezeRef.current = null;
      setFrozen(false);
      if (!listRef.current.length) listRef.current = groupsRef.current;
      animReasonRef.current = "settings";
      setAnim(true);
      drawRef.current();
      return;
    }
    const next = followRef.current === kind ? "none" : kind;
    if (next === "alkaid" || next === "goncol") {
      const start = skyDateRef.current?.alkClock;
      if (start != null) sunAzRef.current = start;
    }
    const skyNext = {
      ...skyRef.current,
      sun: next === "nap" || next === "egyutt",
      sirius: next === "sirius" || next === "egyutt",
      glow: next === "sirius" || next === "egyutt",
      aim: next === "nap" || next === "sirius" || next === "egyutt",
      alkaid: next === "alkaid",
      alkaidGlow: next === "alkaid",
      goncol: next === "goncol",
      goncolGlow: next === "goncol",
    };
    skyRef.current = skyNext;
    setSky(skyNext);
    setScene("eg");
    sceneRef.current = "eg";
    followRef.current = next;
    setFollow(next);
    if (animReasonRef.current === "floor") {
      animReasonRef.current = null;
      setAnim(false);
    }
    drawRef.current();
  }

  function jumpHeliacal() {
    eraRef.current = "ie";
    dayNumRef.current = "54";
    monthRef.current = "7";
    dateDayRef.current = "16";
    setEra("ie");
    setDayNumText("54");
    setMonthText("7");
    setDateDayText("16");
    void applyDate();
  }

  async function applyDate(openSky = true) {
    const year = Number(dayNumRef.current.replace(",", "."));
    const month = Number(monthRef.current.replace(",", "."));
    const day = Number(dateDayRef.current.replace(",", "."));
    const astro = astroYear(eraRef.current, year);
    if (astro === null || astro < -199 || astro > 100) {
      setRangeNote("A naptár i. e. 200 és i. sz. 100 között van kitöltve.");
      return;
    }
    let table = yearCache.current.get(astro);
    if (!table) {
      const response = await fetch(`/egbolt/${astro}.json`);
      if (!response.ok) {
        setRangeNote("Erre az évre nincs égbolttábla.");
        return;
      }
      table = (await response.json()) as YearSky;
      yearCache.current.set(astro, table);
    }
    yearSkyRef.current = table;
    yearAstroRef.current = astro;
    const index = dayIndex(month, day, table.szoko === 1);
    if (index < 0) {
      setRangeNote("Ez a nap nincs a julián naptárban.");
      return;
    }
    const sunDec = (table.dek_nap[index] * Math.PI) / 180;
    const sirDec = (table.dek_szir[index] * Math.PI) / 180;
    const shift = (((table.ra_szir[index] - table.ra_nap[index]) % 360 + 360) % 360 * Math.PI) / 180;
    const alkDecDeg = table.dek_alk[index];
    const alkDec = (alkDecDeg * Math.PI) / 180;
    const alkShift = (((table.ra_alk[index] - table.ra_nap[index]) % 360 + 360) % 360 * Math.PI) / 180;
    const dipper = dipperPlaces(astro, table.ra_nap[index]);
    dipper[6] = { nev: "Alkaid", color: "#1a7f9c", dec: alkDec, shift: alkShift };
    const nova = novaPlaces(astro, table.ra_nap[index]);
    const meteor = meteorPlaces(astro, table.ra_nap[index]);
    const planet = planetPlaces(julianDayNoon(astro, month, day), table.ra_nap[index]);
    const zod = placeZodiac(astro, table.ra_nap[index]);
    const bright = placeFixed(BRIGHT, astro, table.ra_nap[index]);
    skyDateRef.current = { sunDec, sirDec, shift, alkDec, alkShift, alkClock: riseClock(alkDec), dipper, nova, meteor, planet, zod, bright };
    const clock = table.ora[index];
    sunAzRef.current = clock ?? 90;
    const when = `${eraRef.current === "ie" ? "i. e." : "i. sz."} ${year}. ${month}. ${day}.`;
    const seen = table.lathato[index] === 1 ? "A Szíriusz hajnalban látható." : "A Szíriusz ezen a hajnalon nem látszik.";
    const alkSeen = table.lathato_alk[index] === 1 ? "Az Alkaid hajnalban látható." : "Az Alkaid ezen a hajnalon nem látszik.";
    setRangeNote(`${when} Julián naptár, Dendera. ${seen} ${alkSeen}`);
    if (openSky) {
      setScene("eg");
      sceneRef.current = "eg";
    }
    drawRef.current();
    syncPresentation();
  }

  function catalogStars(astro: number): ConjBody[] {
    const out: ConjBody[] = [];
    const seen = new Set<string>();
    const add = (name: string, color: string, ra: number, dec: number, pmra: number, pmde: number) => {
      if (seen.has(name)) return;
      seen.add(name);
      const at = moved({ ra, dec, pmra, pmde }, astro);
      out.push({ name, color, ra: at.ra, dec: at.dec, moving: false });
    };
    for (const star of BRIGHT) add(star.nev, star.szin, star.ra, star.dec, star.pmra, star.pmde);
    for (const star of DIPPER) add(star.nev, star.color, star.ra, star.dec, star.pmra, star.pmde);
    return out;
  }

  async function showConj(row: ConjRow) {
    conjMarkRef.current = row;
    ringOnRef.current = false;
    decayFloorRef.current = false;
    if (conjModeRef.current !== "now") {
      eraRef.current = row.era;
      dayNumRef.current = String(row.year);
      monthRef.current = String(row.month);
      dateDayRef.current = String(row.day);
      setEra(row.era);
      setDayNumText(String(row.year));
      setMonthText(String(row.month));
      setDateDayText(String(row.day));
      const astro = astroYear(row.era, row.year);
      if (astro !== null && astro >= -199 && astro <= 100) await applyDate(true);
      else if (astro !== null) {
        const jd = julianDayNoon(astro, row.month, row.day);
        const sun = sunEquator(jd);
        const sunDec = (sun.dec * Math.PI) / 180;
        const dipper = dipperPlaces(astro, sun.ra);
        const bright = placeFixed(BRIGHT, astro, sun.ra);
        const sir = bright.find((star) => star.nev === "Szíriusz");
        const alk = dipper[6];
        skyDateRef.current = {
          sunDec,
          sirDec: sir?.dec ?? 0,
          shift: sir?.shift ?? 0,
          alkDec: alk?.dec ?? 0,
          alkShift: alk?.shift ?? 0,
          alkClock: alk ? riseClock(alk.dec) : null,
          dipper,
          nova: novaPlaces(astro, sun.ra),
          meteor: meteorPlaces(astro, sun.ra),
          planet: planetPlaces(jd, sun.ra),
          zod: placeZodiac(astro, sun.ra),
          bright,
        };
        setScene("eg");
        sceneRef.current = "eg";
      }
    }
    sunAzRef.current = row.azimuth;
    if (motionClockRef.current) motionClockRef.current.textContent = clockLabel(row.azimuth);
    floorScrollRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    drawRef.current();
  }

  async function runConjunction(mode: ConjMode) {
    const token = conjTokenRef.current + 1;
    conjTokenRef.current = token;
    conjModeRef.current = mode;
    setConjMode(mode);
    setConjPlay(false);
    setConjRows([]);
    conjRowsRef.current = [];
    setConjIndex(0);
    setConjNote("Számolás…");
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
    const clock = clockHour(sunAzRef.current);
    const azimuth = hourAzimuth(clock);
    const limit = mode === "span" ? 3 : 5;
    const rows: ConjRow[] = [];
    const pushPair = (a: ConjBody, b: ConjBody, gap: number, astro: number, month: number, day: number, sunRa: number, sunDec: number) => {
      if (mode === "span" && (a.name === "Hold" || b.name === "Hold") && gap > 1.5) return;
      const when = eraLabel(astro);
      rows.push({
        id: `${when.era}-${when.year}-${month}-${day}-${a.name}-${b.name}-${rows.length}`,
        title: `${a.name} · ${b.name}`,
        names: [a.name, b.name],
        colors: [a.color, b.color],
        gap,
        era: when.era,
        year: when.year,
        month,
        day,
        azimuth,
        azs: [bodyAzimuth(a, sunRa, azimuth), bodyAzimuth(b, sunRa, azimuth)],
        decs: [(a.dec * Math.PI) / 180, (b.dec * Math.PI) / 180],
        shifts: [bodyShift(a, sunRa), bodyShift(b, sunRa)],
        sunDec,
      });
    };
    if (mode === "now") {
      const astro = astroYear(eraRef.current, Number(dayNumRef.current.replace(",", ".")));
      if (astro === null) {
        setConjNote("Előbb adj meg egy évet.");
        return;
      }
      const month = Number(monthRef.current) || 1;
      const day = Number(dateDayRef.current) || 1;
      const jd = julianDayNoon(astro, month, day) + (clock - 12) / 24;
      const bodies = conjBodies(jd, catalogStars(astro));
      for (let i = 0; i < bodies.length; i += 1) {
        for (let j = i + 1; j < bodies.length; j += 1) {
          if (!bodies[i].moving && !bodies[j].moving) continue;
          const gap = angularGap(bodies[i], bodies[j]);
          if (gap <= limit) {
            const sun = bodies.find((item) => item.name === "Nap");
            pushPair(bodies[i], bodies[j], gap, astro, month, day, sun?.ra ?? 0, ((sun?.dec ?? 0) * Math.PI) / 180);
          }
        }
      }
    } else {
      let astro = mode === "year" ? astroYear(eraRef.current, Number(dayNumRef.current.replace(",", "."))) : -199;
      if (astro === null) {
        setConjNote("Előbb adj meg egy évet.");
        return;
      }
      const end = mode === "year" ? astro : 200;
      let month = 1;
      let day = 1;
      const step = mode === "span" ? 2 : 1;
      type Slot = { gap: number; astro: number; month: number; day: number; a: ConjBody; b: ConjBody; sunRa: number; sunDec: number; open: boolean };
      const slots = new Map<string, Slot>();
      let guard = 0;
      let marked = astro;
      let starYear = astro - 1;
      let stars: ConjBody[] = [];
      while (astro <= end && guard < 80000) {
        guard += 1;
        if (token !== conjTokenRef.current) return;
        if (astro !== starYear) {
          starYear = astro;
          stars = catalogStars(astro);
        }
        const jd = julianDayNoon(astro, month, day) + (clock - 12) / 24;
        const bodies = conjBodies(jd, stars);
        for (let i = 0; i < bodies.length; i += 1) {
          for (let j = i + 1; j < bodies.length; j += 1) {
            if (!bodies[i].moving && !bodies[j].moving) continue;
            const gap = angularGap(bodies[i], bodies[j]);
            const key = [bodies[i].name, bodies[j].name].sort().join("|");
            const sun = bodies.find((item) => item.name === "Nap");
            const sunRa = sun?.ra ?? 0;
            const sunDec = ((sun?.dec ?? 0) * Math.PI) / 180;
            const slot = slots.get(key);
            if (!slot) {
              if (gap < limit + 1.5) slots.set(key, { gap, astro, month, day, a: bodies[i], b: bodies[j], sunRa, sunDec, open: gap <= limit });
              continue;
            }
            if (gap < slot.gap) {
              slot.gap = gap;
              slot.astro = astro;
              slot.month = month;
              slot.day = day;
              slot.a = bodies[i];
              slot.b = bodies[j];
              slot.sunRa = sunRa;
              slot.sunDec = sunDec;
              slot.open = true;
            } else if (slot.open && gap > slot.gap + 0.35) {
              if (slot.gap <= limit) pushPair(slot.a, slot.b, slot.gap, slot.astro, slot.month, slot.day, slot.sunRa, slot.sunDec);
              slots.delete(key);
            }
          }
        }
        const prevYear: number = astro;
        const next = walkDay(astro, month, day, step);
        astro = next.astro;
        month = next.month;
        day = next.day;
        if (mode === "span" && astro !== prevYear && astro - marked >= 20) {
          marked = astro;
          setConjNote(`Számolás: ${eraLabel(astro).text}`);
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        } else if (guard % 20 === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }
      for (const slot of slots.values()) {
        if (slot.open && slot.gap <= limit) pushPair(slot.a, slot.b, slot.gap, slot.astro, slot.month, slot.day, slot.sunRa, slot.sunDec);
      }
    }
    if (token !== conjTokenRef.current) return;
    rows.sort((a, b) => a.gap - b.gap);
    const shown = mode === "span" ? rows.slice(0, 160) : rows;
    conjRowsRef.current = shown;
    setConjRows(shown);
    setConjIndex(0);
    setConjNote(mode === "span"
      ? (shown.length ? `A legszorosabb ${shown.length} együttállás, i. e. 200 – i. sz. 200.` : "Nincs együttállás.")
      : (shown.length ? `${shown.length} együttállás, ${limit}°-on belül.` : `Nincs együttállás ${limit}°-on belül.`));
    const list = conjEyeRef.current ? shown.filter(nakedFromDendera) : shown;
    conjShownRef.current = list;
    if (list[0]) {
      setConjIndex(0);
      setConjPlay(true);
      void showConj(list[0]);
    } else {
      setConjPlay(false);
      conjMarkRef.current = null;
      drawRef.current();
    }
    } catch (error) {
      if (token !== conjTokenRef.current) return;
      setConjPlay(false);
      setConjNote(error instanceof Error ? error.message : "A számolás megállt.");
    }
  }

  useEffect(() => {
    void applyDate(false);
  }, []);

  useEffect(() => {
    if (!conjPlay) return;
    const step = () => {
      const list = conjShownRef.current;
      if (list.length < 2) return;
      setConjIndex((index) => {
        const next = (index + 1) % list.length;
        const row = list[next];
        window.setTimeout(() => { if (row) void showConj(row); }, 0);
        return next;
      });
    };
    const timer = window.setInterval(step, 1400);
    return () => window.clearInterval(timer);
  }, [conjPlay, conjRows, conjEye]);

  function applyRange() {
    const bounds = readBounds();
    if (!bounds) return;
    freezeRef.current = bounds;
    setFrozen(true);
    drawRef.current();
  }

  function syncPresentation() {
    const chosen = pickedRef.current;
    const job = funcsRef.current;
    const snOn = NOVA.some((star) => snPickRef.current[star.id]);
    const metOn = METEOR.some((star) => metPickRef.current[star.id]);
    const planOn = planetPickRef.current.hold || PLANET_ROWS.some((star) => planetPickRef.current[star.id]);
    const zodOn = ZODIAC.some((figure) => zodPickRef.current[figure.id]);
    const brightOn = BRIGHT.some((star) => brightPickRef.current[star.id]);
    const skyBody = chosen.nap || chosen.sirius || chosen.alkaid || chosen.goncol || snOn || metOn || planOn || zodOn || brightOn;
    const skyMotion = skyBody && (job.mozgas || job.lathato || job.fugafele || job.atlofele);
    const nextSky = {
      ...skyRef.current,
      sun: chosen.nap && (job.mozgas || job.lathato),
      sirius: chosen.sirius && (job.mozgas || job.lathato),
      glow: chosen.sirius && job.lathato,
      sunAim: chosen.nap && job.fugafele,
      siriusAim: chosen.sirius && job.fugafele,
      sunAtlo: chosen.nap && job.atlofele,
      siriusAtlo: chosen.sirius && job.atlofele,
      alkaid: chosen.alkaid && (job.mozgas || job.lathato),
      alkaidGlow: chosen.alkaid && job.lathato,
      alkaidAim: chosen.alkaid && job.fugafele,
      alkaidAtlo: chosen.alkaid && job.atlofele,
      goncol: chosen.goncol && (job.mozgas || job.lathato),
      goncolGlow: chosen.goncol && job.lathato,
      goncolAim: chosen.goncol && job.fugafele,
      goncolAtlo: chosen.goncol && job.atlofele,
      sn: snOn && (job.mozgas || job.lathato),
      snGlow: snOn && job.lathato,
      snAim: snOn && job.fugafele,
      snAtlo: snOn && job.atlofele,
      met: metOn && (job.mozgas || job.lathato),
      metGlow: metOn && job.lathato,
      metAim: metOn && job.fugafele,
      metAtlo: metOn && job.atlofele,
      plan: planOn && (job.mozgas || job.lathato),
      planGlow: planOn && job.lathato,
      planAim: planOn && job.fugafele,
      planAtlo: planOn && job.atlofele,
      zod: zodOn && (job.mozgas || job.lathato),
      zodGlow: zodOn && job.lathato,
      zodAim: zodOn && job.fugafele,
      zodAtlo: zodOn && job.atlofele,
      aim: false,
    };
    brightModeRef.current = {
      show: brightOn && (job.mozgas || job.lathato),
      glow: brightOn && job.lathato,
      aim: brightOn && job.fugafele,
      atlo: brightOn && job.atlofele,
    };
    skyRef.current = nextSky;
    setSky(nextSky);
    const histWanted = job.suruseg || job.ssav || job.tsav;
    const atloWanted = job.suruseg || job.csucs || job.asav;
    histOnRef.current = histWanted || fugaHistMenuRef.current;
    atloHistOnRef.current = atloWanted || atloHistMenuRef.current;
    atloPeaksOnRef.current = job.csucs;
    bandOnRef.current = job.ssav || job.asav;
    sectorOnRef.current = job.cikk;
    pathOnRef.current = job.palya;
    culmOnRef.current = job.deleles;
    ccwOnRef.current = job.ellentet;
    setHistOn(histOnRef.current);
    setAtloHistOn(atloHistOnRef.current);
    if ((histWanted || atloWanted || job.cikk || job.azimut || job.eazimut || job.palya || job.ellentet || job.ssav || job.asav || job.tsav) && canvasRef.current) {
      canvasRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    const floorMotion = (chosen.fuga || chosen.atlo) && job.mozgas;
    if (floorMotion) {
      if (!(chosen.fuga && chosen.atlo)) {
        const kind = chosen.atlo ? "atlo" : "fuga";
        if (sourceRef.current !== kind) {
          sourceRef.current = kind;
          setSource(kind);
          const groups = kind === "atlo" ? atloGroupsRef.current : fugaGroupsRef.current;
          const lines = kind === "atlo" ? atloLinesRef.current : fugaLinesRef.current;
          linesRef.current = lines;
          groupsRef.current = groups;
          listRef.current = groups;
          indexRef.current = 0;
        }
      }
      animReasonRef.current = "floor";
      setAnim(true);
    } else if (animReasonRef.current === "floor") {
      animReasonRef.current = null;
      setAnim(false);
    }
    if (skyMotion || job.ellentet) {
      setScene("eg");
      sceneRef.current = "eg";
      if (skyMotion) {
        if (followRef.current === "none") {
          motionPauseRef.current = false;
          setMotionPause(false);
        }
        followRef.current = "bemutato";
        setFollow("bemutato");
      }
    } else {
      if (followRef.current === "bemutato") {
        followRef.current = "none";
        setFollow("none");
      }
      if (!skyBody) {
        sceneRef.current = "leltar";
        setScene("leltar");
      }
    }
    drawRef.current();
  }

  function togglePicked(id: ObjId) {
    const next = { ...pickedRef.current, [id]: !pickedRef.current[id] };
    pickedRef.current = next;
    setPicked(next);
    if (next[id] && id !== "fuga" && id !== "atlo") {
      setScene("eg");
      sceneRef.current = "eg";
    }
    syncPresentation();
  }

  function toggleFunc(id: FnId) {
    const next = { ...funcsRef.current, [id]: !funcsRef.current[id] };
    funcsRef.current = next;
    setFuncs(next);
    syncPresentation();
  }

  function toggleSn(id: string) {
    const next = { ...snPickRef.current, [id]: !snPickRef.current[id] };
    snPickRef.current = next;
    setSnPick(next);
    if (next[id]) {
      setScene("eg");
      sceneRef.current = "eg";
    }
    syncPresentation();
  }

  function toggleMet(id: string) {
    const next = { ...metPickRef.current, [id]: !metPickRef.current[id] };
    metPickRef.current = next;
    setMetPick(next);
    if (next[id]) {
      setScene("eg");
      sceneRef.current = "eg";
    }
    syncPresentation();
  }

  function toggleBright(id: string) {
    const next = { ...brightPickRef.current, [id]: !brightPickRef.current[id] };
    brightPickRef.current = next;
    setBrightPick(next);
    if (next[id]) {
      setScene("eg");
      sceneRef.current = "eg";
    }
    syncPresentation();
  }

  function togglePlanet(id: string) {
    const next = { ...planetPickRef.current, [id]: !planetPickRef.current[id] };
    planetPickRef.current = next;
    setPlanetPick(next);
    if (next[id]) {
      setScene("eg");
      sceneRef.current = "eg";
    }
    syncPresentation();
  }

  function toggleZod(id: string) {
    const next = { ...zodPickRef.current, [id]: !zodPickRef.current[id] };
    zodPickRef.current = next;
    setZodPick(next);
    if (next[id]) {
      setScene("eg");
      sceneRef.current = "eg";
    }
    syncPresentation();
  }

  function captureSetup(): SetupData {
    return {
      picked: { ...pickedRef.current },
      funcs: { ...funcsRef.current },
      sn: { ...snPickRef.current },
      met: { ...metPickRef.current },
      bright: { ...brightPickRef.current },
      planet: { ...planetPickRef.current },
      zod: { ...zodPickRef.current },
      compass: compassRef.current,
      orient: orientRef.current,
      time: timeOnRef.current,
      dayNight: dayNightRef.current,
      moonYear,
      moonTime,
      floor: floorOnRef.current,
      fugaHist: fugaHistMenuRef.current,
      atloHist: atloHistMenuRef.current,
      fugaBand: fugaBandRef.current,
      atloBand: atloBandRef.current,
      peak: peakColorRef.current,
      year: dayNumRef.current,
      era: eraRef.current,
      month: monthRef.current,
      day: dateDayRef.current,
      from: fromRef.current,
      to: toRef.current,
      match: matchRef.current,
      dayLen: dayText,
      duration: durationText,
      moonFromMonth: moonFromMonthRef.current,
      moonFromDay: moonFromDayRef.current,
      moonToMonth: moonToMonthRef.current,
      moonToDay: moonToDayRef.current,
      moonSpeed: String(moonSpeedRef.current),
      moonSector: moonSectorRef.current,
      moonYearArc: moonYearArcRef.current,
    };
  }

  function setupLine(data: SetupData) {
    const names = [
      ...OBJECTS.filter((item) => data.picked?.[item.id]).map((item) => item.label),
      ...FUNCTIONS.filter((item) => data.funcs?.[item.id]).map((item) => item.label),
      ...NOVA.filter((star) => data.sn?.[star.id]).map((star) => star.nev),
      ...METEOR.filter((star) => data.met?.[star.id]).map((star) => star.nev),
      ...PLANET_ROWS.filter((star) => data.planet?.[star.id]).map((star) => star.nev),
      ...BRIGHT.filter((star) => data.bright?.[star.id]).map((star) => star.nev),
      ...ZODIAC.filter((figure) => data.zod?.[figure.id]).map((figure) => figure.nev),
    ];
    if (data.compass) names.push("Égtájak");
    if (data.orient) names.push("Orientáció");
    if (data.dayNight) names.push("Éjjel-Nappal");
    if (data.floor === false) names.push("Padló ki");
    return names.length ? names.join(", ") : "Nincs bekapcsolt kapcsoló.";
  }

  function saveNamedSetup() {
    const name = setupName.trim();
    if (!name || !user) return;
    const data = captureSetup();
    setSetupError("");
    void saveSetup({ data: { name, data } })
      .then(() => {
        setSetups((current) => [{ name, data }, ...current.filter((item) => item.name !== name)]);
        setSetupName("");
        setNamingSetup(false);
      })
      .catch(() => setSetupError("A mentés nem sikerült. Lépj be, és próbáld újra."));
  }

  function dropNamedSetup(name: string) {
    setSetups((current) => current.filter((row) => row.name !== name));
    void deleteSetup({ data: name }).catch(() => {
      void listSetups().then((rows) => setSetups(rows.filter((item) => item && typeof item.name === "string" && item.data) as SavedSetup[]));
    });
  }

  function loadSetup(item: SavedSetup) {
    const data = item.data;
    pickedRef.current = { ...BLANK_OBJECTS, ...data.picked };
    funcsRef.current = { ...BLANK_FUNCTIONS, ...data.funcs };
    if (data.funcs && data.funcs.asav === undefined && data.funcs.ssav) funcsRef.current.asav = true;
    snPickRef.current = { ...snPickRef.current, ...data.sn };
    metPickRef.current = { ...metPickRef.current, ...data.met };
    brightPickRef.current = { ...brightPickRef.current, ...data.bright };
    planetPickRef.current = { ...planetPickRef.current, ...data.planet };
    zodPickRef.current = { ...zodPickRef.current, ...data.zod };
    setPicked({ ...pickedRef.current });
    setFuncs({ ...funcsRef.current });
    setSnPick({ ...snPickRef.current });
    setMetPick({ ...metPickRef.current });
    setBrightPick({ ...brightPickRef.current });
    setPlanetPick({ ...planetPickRef.current });
    setZodPick({ ...zodPickRef.current });
    compassRef.current = !!data.compass;
    orientRef.current = !!data.orient;
    timeOnRef.current = !!data.time;
    dayNightRef.current = !!data.dayNight;
    floorOnRef.current = data.floor !== false;
    fugaHistMenuRef.current = !!data.fugaHist;
    atloHistMenuRef.current = !!data.atloHist;
    fugaBandRef.current = !!data.fugaBand;
    atloBandRef.current = !!data.atloBand;
    peakColorRef.current = data.peak === true;
    setCompassOn(compassRef.current);
    setOrientOn(orientRef.current);
    setTimeOn(timeOnRef.current);
    setDayNight(dayNightRef.current);
    setMoonYear(!!data.moonYear);
    setMoonTime(!!data.moonTime);
    setFloorOn(floorOnRef.current);
    setFugaHistMenu(fugaHistMenuRef.current);
    setAtloHistMenu(atloHistMenuRef.current);
    setFugaBandOn(fugaBandRef.current);
    setAtloBandOn(atloBandRef.current);
    setPeakColor(peakColorRef.current);
    dayNumRef.current = data.year || "54";
    eraRef.current = data.era === "isz" ? "isz" : "ie";
    monthRef.current = data.month || "7";
    dateDayRef.current = data.day || "16";
    fromRef.current = data.from || "100";
    toRef.current = data.to || "110";
    matchRef.current = data.match || "2";
    moonFromMonthRef.current = data.moonFromMonth || "1";
    moonFromDayRef.current = data.moonFromDay || "1";
    moonToMonthRef.current = data.moonToMonth || "12";
    moonToDayRef.current = data.moonToDay || "31";
    moonSpeedRef.current = Number(data.moonSpeed) || 12;
    moonSectorRef.current = !!data.moonSector && !!data.moonTime;
    moonYearArcRef.current = !!data.moonYearArc && !!data.moonTime;
    setDayNumText(dayNumRef.current);
    setEra(eraRef.current);
    setMonthText(monthRef.current);
    setDateDayText(dateDayRef.current);
    setFromText(fromRef.current);
    setToText(toRef.current);
    setMatchText(matchRef.current);
    setDayText(data.dayLen || "24");
    setDurationText(data.duration || "0,5");
    const ms = Math.round(Number(String(data.duration || "0.5").replace(",", ".")) * 1000);
    if (Number.isFinite(ms) && ms > 0) setStepMs(ms);
    const dayMs = Math.round(Number(String(data.dayLen || "24").replace(",", ".")) * 1000);
    if (Number.isFinite(dayMs) && dayMs > 0) sunMsRef.current = dayMs;
    setMoonFromMonth(moonFromMonthRef.current);
    setMoonFromDay(moonFromDayRef.current);
    setMoonToMonth(moonToMonthRef.current);
    setMoonToDay(moonToDayRef.current);
    setMoonSpeed(String(moonSpeedRef.current));
    setMoonSector(moonSectorRef.current);
    setMoonYearArc(moonYearArcRef.current);
    syncPresentation();
    void applyDate(false);
  }

  function togglePairLine(id: "fedes" | "meroleges" | "sirius" | "procyon" | "kot" | "szegely" | "kozel" | "egyenesen" | "derekszog" | "k63") {
    const next = { ...pairLinesRef.current, [id]: !pairLinesRef.current[id] };
    pairLinesRef.current = next;
    setPairLines(next);
    if (!next.fedes && !next.meroleges) pairMarkRef.current = null;
    drawRef.current();
  }
  function toggleNamedPair(kind: "star" | "parallel", index: number) {
    const source = kind === "star" ? starOnRef.current : parallelOnRef.current;
    const next = source.map((on, item) => (item === index ? !on : on));
    if (kind === "star") {
      starOnRef.current = next;
      setStarOn(next);
    } else {
      parallelOnRef.current = next;
      setParallelOn(next);
    }
    drawRef.current();
  }
  function toggleEast(id: "result" | "kel" | "kozos" | "dendera" | "nap" | "fenyes" | "K62" | "K28" | "K29" | "K30" | "K61" | "K63" | "K64" | "K65") {
    const next = { ...eastFlagsRef.current, [id]: !eastFlagsRef.current[id] };
    eastFlagsRef.current = next;
    setEastFlags(next);
    drawRef.current();
  }

  const [spare, setSpare] = useState([false, false, false, false]);
  const [festNote, setFestNote] = useState<{ name: string; about: string; when: string; left: number; top: number } | null>(null);
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!view3dRef.current) return;
      event.preventDefault();
      const height = Math.min(2.2, Math.max(0.08, camRef.current.height + event.deltaY * 0.0012));
      camRef.current = { ...camRef.current, height };
      setCam({ ...camRef.current });
      drawRef.current();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
  function applyCam(next: Cam) {
    const camNext = {
      orbit: ((next.orbit + 540) % 360) - 180,
      tilt: Math.min(75, Math.max(-5, next.tilt)),
      height: Math.min(2.2, Math.max(0.08, next.height)),
    };
    camRef.current = camNext;
    setCam(camNext);
    drawRef.current();
  }
  if (skyDateRef.current) decaySunTopRef.current = altitudeDeg(skyDateRef.current.sunDec, 0);
  const decayNow: DecayTrace[] = [];
  if (spare[3] && skyDateRef.current) {
    const placed = skyDateRef.current;
    const push = (name: string, color: string, dec: number, shift: number) => {
      if (decayNow.some((trace) => trace.name === name)) return;
      decayNow.push({ name, color, ...decayAltitudes(dec, shift) });
    };
    if (picked.nap) push("Nap", "#e6a100", placed.sunDec, 0);
    if (picked.sirius) push("Szíriusz", "#1d4e89", placed.sirDec, placed.shift);
    if (picked.alkaid) push("Alkaid", "#1a7f9c", placed.alkDec, placed.alkShift);
    if (picked.goncol) for (const star of placed.dipper) push(star.nev, star.color, star.dec, star.shift);
    for (const star of placed.planet) if (planetPick[star.id]) push(star.nev, star.color, star.dec, star.shift);
    for (const star of placed.nova) if (snPick[star.id]) push(star.nev, star.color, star.dec, star.shift);
    for (const star of placed.meteor) if (metPick[star.id]) push(star.nev, star.color, star.dec, star.shift);
    for (const star of placed.bright) if (brightPick[star.id]) push(star.nev, star.color, star.dec, star.shift);
    for (const figure of placed.zod) {
      if (!zodPick[figure.id]) continue;
      const star = figure.csillagok[figure.vezeto];
      push(figure.nev, figure.color, star.dec, star.shift);
    }
  }
  decayTracesRef.current = decayNow;
  decayOpenRef.current = spare[3];
  const marked = bestMarked(compareRows);
  const stone = stoneList.find((item) => item.id === stoneId) ?? stoneList[0] ?? null;
  const rememberProjects = (next: UserProject[]) => {
    setProjects(next);
    localStorage.setItem(PROJECT_KEY, JSON.stringify(next));
  };
  const openDendera = () => {
    projectNameRef.current = "";
    projectRef.current = "dendera";
    setProjectId("dendera");
    setFloorSrc(FILE);
    floorOnRef.current = true;
    setFloorOn(true);
    applyProjectStart("dendera");
    setProjectNote("");
    setProjectOpen(false);
  };
  useEffect(() => {
    openDendera();
  }, []);
  const openRoof = () => {
    projectNameRef.current = "Dendera roof full2";
    projectRef.current = "dendera-roof";
    setProjectId("dendera-roof");
    setFloorSrc("/Dendera-roof-full2.jpg");
    floorOnRef.current = true;
    setFloorOn(true);
    applyProjectStart("dendera-roof");
    setProjectNote("");
    setProjectOpen(false);
  };
  const openUserProject = (id: string) => {
    const name = projects.find((item) => item.id === id)?.name ?? "";
    void readProjectImage(id).then((blob) => {
      if (!blob) {
        setRangeNote("A projekt képe nincs meg. Töltsd fel újra a Kép feltöltése gombbal.");
        setProjectNote("A kép hiányzik. Töltsd fel újra.");
        return;
      }
      const previous = projectUrls.current[id];
      if (previous) URL.revokeObjectURL(previous);
      const url = URL.createObjectURL(blob);
      projectUrls.current[id] = url;
      projectRef.current = id;
      projectNameRef.current = name;
      setProjectId(id);
      setFloorSrc(url);
      floorOnRef.current = true;
      setFloorOn(true);
      if (isRoofFull2(name)) applyProjectStart("dendera");
      else applyProjectStart(id);
      setProjectNote("");
      setProjectOpen(false);
    }).catch(() => {
      setRangeNote("A projektet nem sikerült betölteni.");
      setProjectNote("A betöltés nem sikerült.");
    });
  };
  function rememberStarts(next: Record<string, ProjectStart>) {
    setStarts(next);
    localStorage.setItem(START_KEY, JSON.stringify(next));
  }
  function commitAngle(deg: number) {
    const wrapped = Math.round(((((deg % 360) + 360) % 360) * 100)) / 100;
    floorDegRef.current = wrapped;
    setFloorDeg(wrapped);
    setFloorDegText(wrapped.toFixed(2).replace(".", ","));
    applyNorthRef.current(wrapped);
  }
  function applyProjectStart(id: string) {
    const saved = loadStarts()[id];
    const savedDeg = saved && Number.isFinite(saved.deg) ? saved.deg : null;
    const deg = id === "dendera" || id === "dendera-roof" ? (savedDeg && savedDeg !== 0 ? savedDeg : HATHOR_DEG) : (savedDeg ?? 0);
    commitAngle(deg);
    const zoom = saved && Number.isFinite(saved.zoom) && saved.zoom > 0 ? saved.zoom : 1;
    floorZoomRef.current = zoom;
    setFloorZoom(zoom);
    const pan = { x: saved?.panX || 0, y: saved?.panY || 0 };
    floorPanRef.current = pan;
    setFloorPan(pan);
    if (!saved?.full) {
      drawRef.current();
      return;
    }
    const spareNext = saved.spare?.length === 4 ? saved.spare.map(Boolean) : [false, false, false, false];
    view3dRef.current = !!spareNext[1];
    festRef.current = !!spareNext[2];
    decayOpenRef.current = !!spareNext[3];
    if (!spareNext[3]) {
      decayFloorRef.current = false;
      ringOnRef.current = false;
    }
    setView3d(!!spareNext[1]);
    setSpare(spareNext);
    setFestNote(null);
    setRasterOn(!!saved.rasterOn);
    setRasterSize(Number.isFinite(saved.rasterSize) && saved.rasterSize > 0 ? saved.rasterSize : 40);
    setRasterDeg(Number.isFinite(saved.rasterDeg) ? saved.rasterDeg : 0);
    setAnim(false);
    if (saved.setup) loadSetup({ name: "", data: saved.setup });
    else drawRef.current();
  }
  function saveCurrentStart() {
    if (!startFor) return;
    const typed = Number(startDegText.replace(",", "."));
    const deg = Number.isFinite(typed)
      ? Math.round(((((typed % 360) + 360) % 360) * 100)) / 100
      : Math.round(((((floorDegRef.current % 360) + 360) % 360) * 100)) / 100;
    const next = {
      ...loadStarts(),
      [startFor]: {
        deg,
        zoom: floorZoomRef.current,
        panX: floorPanRef.current.x,
        panY: floorPanRef.current.y,
        spare: [...spare],
        rasterOn,
        rasterSize,
        rasterDeg,
        setup: captureSetup(),
        full: true,
      },
    };
    rememberStarts(next);
    setStartDegText(deg.toFixed(2));
  }
  function saveStartAngle(text: string) {
    if (!startFor) return;
    if (!text.trim() || /[.,-]$/.test(text)) return;
    const raw = Number(text.replace(",", "."));
    if (!Number.isFinite(raw)) return;
    const deg = Math.round(((((raw % 360) + 360) % 360) * 100)) / 100;
    const previous = loadStarts()[startFor] ?? {
      deg: 0,
      zoom: 1,
      panX: 0,
      panY: 0,
      spare: [false, false, false, false],
      rasterOn: false,
      rasterSize: 40,
      rasterDeg: 0,
    };
    rememberStarts({ ...loadStarts(), [startFor]: { ...previous, deg } });
    if (projectRef.current === startFor) commitAngle(deg);
  }

  const eyeRows = conjEye ? conjRows.filter(nakedFromDendera) : conjRows;
  conjShownRef.current = eyeRows;
  conjArcBodiesRef.current = conjArcBodies(conjRows);
  const uploadedFit = Boolean(projectId) && projectId !== "dendera" && projectId !== "dendera-roof";
  const fittedPhoto = uploadedFit
    ? containTurned(stageSize.w, stageSize.h, photoNatural.w, photoNatural.h, floorDeg, floorZoom)
    : null;

  return (
    <figure className="flex h-dvh w-full flex-col overflow-hidden bg-white">
        <div className="z-[70] flex shrink-0 items-center gap-1 overflow-visible border-b border-stone-200 bg-white px-2 py-1">
        <div className="flex shrink-0 items-center">
          {accountPending ? <div className="h-8 w-8 animate-pulse rounded-full bg-stone-200" /> : user ? <UserButton /> : <a href="/login" className="rounded-lg border border-stone-900 px-2 py-1 text-sm font-semibold">Belépés</a>}
        </div>
        <div className="relative flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => { setBarMenu(null); setWatchOpen(false); setPlanOpen(false); setProjectOpen((open) => !open); }}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${projectId ? "bg-stone-900 text-white" : "border border-stone-900"}`}
            >
              Projekt
            </button>
            {projectOpen ? (
              <div className="absolute left-0 top-full z-[80] mt-1 max-h-[70vh] w-72 overflow-auto rounded-lg border border-stone-300 bg-white p-1 shadow-lg" onPointerDown={(event) => event.stopPropagation()}>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={openDendera} className={`min-w-0 flex-1 rounded px-2 py-2 text-left text-sm font-semibold ${projectId === "dendera" ? "bg-stone-900 text-white" : "hover:bg-stone-100"}`}>Dendera-Hathor</button>
                  <button type="button" onClick={() => { setStartFor("dendera"); setStartDegText((loadStarts().dendera?.deg ?? 0).toFixed(2)); }} className="rounded border border-stone-300 px-2 py-2 text-xs font-semibold hover:bg-stone-100">Alap</button>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <button type="button" onClick={openRoof} className={`min-w-0 flex-1 rounded px-2 py-2 text-left text-sm font-semibold ${projectId === "dendera-roof" ? "bg-stone-900 text-white" : "hover:bg-stone-100"}`}>Dendera roof full2</button>
                  <button type="button" onClick={() => { setStartFor("dendera-roof"); setStartDegText((loadStarts()["dendera-roof"]?.deg ?? 0).toFixed(2)); }} className="rounded border border-stone-300 px-2 py-2 text-xs font-semibold hover:bg-stone-100">Alap</button>
                </div>
                {projectNote ? <p className="px-2 py-1 text-xs text-red-700">{projectNote}</p> : null}
                {projects.map((item) => (
                  <div key={item.id} className="mt-1 flex items-center gap-1">
                    <button type="button" onClick={() => openUserProject(item.id)} className={`min-w-0 flex-1 truncate rounded px-2 py-2 text-left text-sm font-semibold ${projectId === item.id ? "bg-stone-900 text-white" : "hover:bg-stone-100"}`}>{item.name}</button>
                    <button type="button" onClick={() => { setStartFor(item.id); setStartDegText((loadStarts()[item.id]?.deg ?? 0).toFixed(2)); }} className="rounded border border-stone-300 px-2 py-2 text-xs font-semibold hover:bg-stone-100">Alap</button>
                    <button
                      type="button"
                      aria-label="Projekt törlése"
                      className="rounded px-2 py-2 text-xs font-semibold text-stone-500 hover:bg-stone-100"
                      onClick={() => {
                        const next = projects.filter((project) => project.id !== item.id);
                        rememberProjects(next);
                        void deleteProjectImage(item.id);
                        const url = projectUrls.current[item.id];
                        if (url) URL.revokeObjectURL(url);
                        if (projectId === item.id) {
                          projectRef.current = null;
                          setProjectId(null);
                          setFloorSrc("");
                        }
                        const stored = loadStarts();
                        delete stored[item.id];
                        rememberStarts(stored);
                        if (startFor === item.id) setStartFor(null);
                      }}
                    >
                      törlés
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => projectFileRef.current?.click()} className="mt-1 block w-full rounded border border-stone-300 px-2 py-2 text-left text-sm font-semibold hover:bg-stone-100">Kép feltöltése</button>
                <input
                  ref={projectFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setUploadFile(file);
                    setUploadName(file.name.replace(/\.[^.]+$/, ""));
                  }}
                />
                {uploadFile ? (
                  <form
                    className="mt-1 flex flex-col gap-1 border-t border-stone-200 p-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = uploadName.trim() || uploadFile.name.replace(/\.[^.]+$/, "");
                      const id = `p-${Date.now()}`;
                      void saveProjectImage(id, uploadFile).then(() => {
                        rememberProjects([...projects, { id, name }]);
                        setUploadFile(null);
                        setUploadName("");
                        openUserProject(id);
                      });
                    }}
                  >
                    <label className="text-xs font-semibold text-stone-600">Projekt neve
                      <input value={uploadName} onChange={(event) => setUploadName(event.target.value)} className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm" />
                    </label>
                    <button type="submit" className="rounded bg-stone-900 px-2 py-1 text-sm font-semibold text-white">Mentés</button>
                  </form>
                ) : null}
                {startFor ? (
                  <div className="mt-1 border-t border-stone-200 p-2">
                    <p className="text-xs font-semibold">Alapbeállítás · {startFor === "dendera" ? "Dendera-Hathor" : startFor === "dendera-roof" ? "Dendera roof full2" : projects.find((item) => item.id === startFor)?.name}</p>
                    <label className="mt-1 block text-xs font-semibold text-stone-600">Szög
                      <input inputMode="decimal" value={startDegText} onChange={(event) => { const text = event.target.value.replace(/[^\d,.-]/g, ""); setStartDegText(text); saveStartAngle(text); }} onBlur={() => { const raw = Number(startDegText.replace(",", ".")); if (Number.isFinite(raw)) saveStartAngle(String(raw)); }} className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm" />
                    </label>
                    <p className="mt-1 text-xs text-stone-500">Mentett induló szög: {(starts[startFor]?.deg ?? 0).toFixed(2).replace(".", ",")}°</p>
                    <button type="button" onClick={saveCurrentStart} className="mt-2 w-full rounded bg-stone-900 px-2 py-1 text-xs font-semibold text-white">A mostani állapot legyen az indulás</button>
                    <button type="button" onClick={() => { if (!startFor) return; const stored = loadStarts(); delete stored[startFor]; rememberStarts(stored); setStartDegText("0.00"); if (projectRef.current === startFor) commitAngle(0); }} className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-xs font-semibold">Eredeti</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="relative">
              <button
                type="button"
                onClick={() => setWatchOpen((open) => !open)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${watchOpen ? "bg-teal-800 text-white" : "border border-teal-800 text-teal-950"}`}
              >
                Megfigyelések
              </button>
              {watchOpen ? (
                <div className="absolute left-0 top-full z-[80] mt-1 max-h-[70vh] w-80 overflow-auto rounded-lg border border-stone-300 bg-white p-2 shadow-lg" onPointerDown={(event) => event.stopPropagation()}>
                  <p className="px-1 text-[11px] leading-4 text-stone-500">A zöld már működik. A fehér még beemelhető.</p>
                  <p className="mt-2 px-1 text-[10px] font-extrabold uppercase tracking-wide text-emerald-800">Elkészült</p>
                  {[
                    "Nap és Hold",
                    "Merkúr, Vénusz, Mars, Jupiter, Szaturnusz",
                    "A 30 legfényesebb csillag",
                    "Göncölszekér",
                    "Denderai zodiákus",
                    "Szupernóvák",
                    "Meteorrajok",
                    "Együttállás",
                    "Láthatóság: 2° magas, a Nap −8° alatt",
                    "Szíriusz heliákus kelése",
                    "Holdfázisok",
                    "Éjjel–nappal",
                    "Azimut és éves azimut",
                    "Délés a kijelölt objektumra",
                  ].map((item) => (
                    <p key={item} className="mt-1 rounded bg-emerald-700 px-2 py-1 text-xs font-semibold text-white">{item}</p>
                  ))}
                  <p className="mt-3 px-1 text-[10px] font-extrabold uppercase tracking-wide text-stone-500">Még beemelhető</p>
                  {[
                    "A 36 egyiptomi dekán",
                    "Plejádok, Hyadok, Jászol, Omega Centauri",
                    "Algol és Mira",
                    "Fényes üstökösök, a Halley visszatérései",
                    "Tejút és állatövi fény",
                    "Heliákus kelés minden dekánra",
                    "Akronichikus kelés és kozmikus nyugvás",
                    "Légköri gyengülés a horizont közelében",
                    "A holdfény elnyomja a halványat",
                    "Szürkület: 6°, 12° és 18°",
                    "Fénytörés a horizontnál",
                    "Bolygóállomás és hátráló mozgás",
                    "Legnagyobb kitérés és szembenállás",
                    "Okkultáció",
                    "Három vagy több objektum együttállása",
                    "A Hold 18,6 éves szélső kitérése",
                    "Nap- és holdfogyatkozás",
                    "A dekánok éjszakai órája",
                    "Soha le nem nyugvó és soha fel nem kelő csillagok",
                    "Napforduló és napéjegyenlőség",
                    "Déli árnyék",
                    "A Szíriusz kb. 70 napos eltűnése",
                    "Szotikus ciklus",
                    "Az első holdsarló",
                    "25 éves egyiptomi holdciklus",
                    "Évszakos órák",
                    "Átlós csillagóra és a Ramesszida délésóra",
                    "Paranatellonta",
                    "A bolygó első és utolsó láthatósága",
                    "A Sarkcsillag cseréje",
                    "A Vénusz nappal",
                    "Hamuszürke fény",
                    "Szárosz",
                    "Tűzgolyó és szórványos meteor",
                  ].map((item) => (
                    <p key={item} className="mt-1 rounded border border-stone-300 bg-white px-2 py-1 text-xs font-semibold text-stone-800">{item}</p>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setPlanOpen((open) => !open)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${planOpen ? "bg-stone-900 text-white" : "border border-stone-900"}`}
              >
                Terv
              </button>
              {planOpen ? (
                <div className="absolute left-0 top-full z-[80] mt-1 max-h-[70vh] w-96 overflow-auto rounded-lg border border-stone-300 bg-white p-2 shadow-lg" onPointerDown={(event) => event.stopPropagation()}>
                  <p className="px-1 text-[11px] leading-4 text-stone-500">Javasolt sorrend. Előbb a kép száma és az egy napos egyezés, utána az időszkenel, mert az ugyanennek az ismétlése hosszabb sávon.</p>
                  {[
                    ["1", "Képkészlet", "Minden projektből ugyanaz: oldal, sarok, átló, fugacsúcs, átlócsúcs, körosztás, alakok száma, szög északhoz."],
                    ["2", "Csoportok", "Nyolc lánc. Mindegyik egyféle számot ad: szög, dátum, darabszám vagy időszak."],
                    ["3", "Láthatósági szűrő", "Ami Denderából nem látszott, az nem kerül egyezésbe."],
                    ["4", "Egyezés egy időpontra", "A beállított nap égi száma és a kép száma: fuga, átló, darabszám, vagy nincs kapcsolat."],
                    ["5", "Elemzés · időszkenel", "Nagyobb idősávban keres találatot, mert a mozgás más évet más szögre tesz. Sávok: a beállított év, évtized, i. e. 200 – i. sz. 200, majd a precesszió és a szotikus ciklus hosszú íve."],
                    ["6", "Megállapítás", "Projektenként és csoportonként egy sor: fugával egyezik, átlóval egyezik, a darabszám egyezik, vagy nincs kapcsolat."],
                    ["7", "Összevetés", "A Hathor, a tető és a feltöltött képek ugyanazon a mércén, ugyanabban az idősávban."],
                  ].map(([n, title, text]) => (
                    <div key={n} className={`mt-1 rounded border px-2 py-1.5 ${n === "5" ? "border-amber-400 bg-amber-50" : "border-stone-200 bg-stone-50"}`}>
                      <p className="text-xs font-extrabold text-stone-950">{n}. {title}</p>
                      <p className="mt-0.5 text-[11px] leading-4 text-stone-700">{text}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setAnalOpen((open) => !open)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${analOpen ? "bg-amber-500 text-stone-950" : "border border-amber-600 text-amber-950"}`}
            >
              Elemzés
            </button>
          </div>
          <div className="relative flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => {
              if (recordLive.current) {
                if (!recordRef.current) return;
                recordLive.current = false;
                const handle = recordRef.current;
                recordRef.current = null;
                void handle.stop().then((blob) => {
                  const url = URL.createObjectURL(blob);
                  if (handle.url) URL.revokeObjectURL(handle.url);
                  if (recordRef.current === handle) recordRef.current = { stop: handle.stop, url };
                  setVideoUrl(url);
                  setVideoSize(blob.size);
                  setVideoOpen(true);
                  setRecording(false);
                  setRecordNote(blob.size > 1000 ? "A fájl MP4, a gomb alatt lejátszható." : "A felvétel üres maradt, próbáld újra.");
                }).catch(() => {
                  setRecording(false);
                  recordLive.current = false;
                  setRecordNote("Az MP4 elkészítése nem sikerült.");
                });
                return;
              }
              drawRef.current();
              recordLive.current = true;
              setRecording(true);
              setRecordNote("Az MP4 készül…");
              const readStarter = () => (window as unknown as { startFloorMp4?: () => Promise<{ stop: () => Promise<Blob> }> }).startFloorMp4;
              const ready = readStarter()
                ? Promise.resolve(readStarter()!)
                : new Promise<() => Promise<{ stop: () => Promise<Blob> }>>((resolve, reject) => {
                    const script = document.createElement("script");
                    script.type = "module";
                    script.textContent = "import { startFloorMp4 } from '/floor-mp4.mjs'; window.startFloorMp4 = startFloorMp4; window.dispatchEvent(new Event('floor-mp4-ready'));";
                    window.addEventListener("floor-mp4-ready", () => resolve(readStarter()!), { once: true });
                    script.addEventListener("error", () => reject(new Error("nincs")));
                    document.head.appendChild(script);
                  });
              void ready.then(async (startFloorMp4) => {
                const recorder = await startFloorMp4();
                recordLive.current = true;
                recordRef.current = { stop: () => recorder.stop(), url: recordRef.current?.url ?? "" };
                setRecording(true);
                setRecordNote("Felvétel: a gombok, a padló és az egér is látszik.");
              }).catch(() => {
                setRecording(false);
                recordLive.current = false;
                setRecordNote("Ez a böngésző nem tud MP4 videót készíteni.");
              });
            }}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${recording ? "bg-stone-900 text-white" : "border border-stone-900"}`}
          >
            {recording ? "Leállítás" : "Felvétel"}
          </button>
          {videoUrl ? (
            <button
              type="button"
              onClick={() => {
                setVideoOpen(true);
                const link = document.createElement("a");
                link.href = videoUrl;
                link.download = "dendera-bemutato.mp4";
                document.body.appendChild(link);
                link.click();
                link.remove();
              }}
              className="rounded-lg bg-stone-900 px-3 py-2 text-center text-sm font-semibold text-white"
            >
              Videó küldése
            </button>
          ) : null}
          {videoOpen && videoUrl ? (
            <div className="absolute left-0 top-full z-[80] mt-1 w-72 rounded-lg border border-stone-300 bg-white p-2 shadow-lg">
              <p className="text-xs font-extrabold">dendera-bemutato.mp4</p>
              <p className="text-xs text-stone-500">{videoSize > 0 ? `${Math.max(1, Math.round(videoSize / 1024))} KB` : "üres fájl"}</p>
              <video src={videoUrl} controls className="mt-1 w-full rounded bg-black" />
              <a href={videoUrl} download="dendera-bemutato.mp4" className="mt-1 block text-center text-sm font-semibold text-stone-900">Letöltés</a>
            </div>
          ) : null}
          {recordNote ? <p className="absolute left-0 top-full z-[70] mt-1 max-w-56 rounded bg-white px-2 py-1 text-xs text-stone-600 shadow">{recordNote}</p> : null}
          </div>
        {(
          [
            ["nezet", "Nézet", spare[0] || spare[1] || floorOn || compassOn || orientOn],
            ["rajz", "Rajz", floorMenu !== null],
            ["ido", "Idő", timeOn || dayNight || moonYear || moonTime],
            ["eg", "Ég", spare[2] || spare[3] || pairMenu || eastMenu],
          ] as const
        ).map(([id, label, lit]) => (
          <div key={id} className="relative">
            <button type="button" onClick={() => { setProjectOpen(false); setWatchOpen(false); setPlanOpen(false); setBarMenu((open) => open === id ? null : id); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${barMenu === id || lit ? "bg-stone-900 text-white" : "border border-stone-900"}`}>{label}</button>
          </div>
        ))}
      </div>
      {barMenu === "nezet" ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2">
          {spare.map((on, index) => index > 1 ? null : (
            <button
              key={index}
              type="button"
              onClick={() => {
                if (index === 0) {
                  const next = !spare[0];
                  if (next) { view3dRef.current = false; setView3d(false); }
                  setSpare([next, next ? false : spare[1], spare[2], spare[3]]);
                  drawRef.current();
                  return;
                }
                const next = !spare[1];
                view3dRef.current = next;
                setView3d(next);
                setSpare([next ? false : spare[0], next, spare[2], spare[3]]);
                drawRef.current();
              }}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${on ? "bg-stone-900 text-white" : "border border-stone-900"}`}
            >
              {index === 0 ? "2D" : "3D"}
            </button>
          ))}
          <button type="button" onClick={() => { floorOnRef.current = !floorOnRef.current; setFloorOn(floorOnRef.current); drawRef.current(); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${floorOn ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Padló</button>
          <button type="button" onClick={() => { compassRef.current = !compassRef.current; setCompassOn(compassRef.current); drawRef.current(); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${compassOn ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Égtájak</button>
          <button type="button" onClick={() => { orientRef.current = !orientRef.current; setOrientOn(orientRef.current); drawRef.current(); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${orientOn ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Orientáció</button>
        </div>
      ) : null}
      {barMenu === "rajz" ? (
        <div className="flex flex-wrap gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2">
          {([["beallitas", "Beállítások"], ["kovek", "Kövek"], ["fugak", "Fugák"], ["atlok", "Átlók"]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => { const next = floorMenuRef.current === id ? null : id; floorMenuRef.current = next; setFloorMenu(next); drawRef.current(); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${floorMenu === id ? "bg-stone-900 text-white" : "border border-stone-900"}`}>{label}</button>
          ))}
        </div>
      ) : null}
      {barMenu === "ido" ? (
        <div className="flex flex-wrap gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2">
          <button type="button" onClick={() => { timeOnRef.current = !timeOnRef.current; setTimeOn(timeOnRef.current); drawRef.current(); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${timeOn ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Idő</button>
          <button type="button" onClick={() => { dayNightRef.current = !dayNightRef.current; setDayNight(dayNightRef.current); drawRef.current(); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${dayNight ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Éjjel-Nappal</button>
          <button type="button" onClick={() => setMoonYear((value) => !value)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${moonYear ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Holdfázisok</button>
          <button type="button" onClick={() => { const next = !moonTime; setMoonTime(next); moonPlayRef.current = next; setMoonPlay(next); if (!next) { moonSectorRef.current = false; moonYearArcRef.current = false; setMoonSector(false); setMoonYearArc(false); } if (next) moonCursorRef.current = 0; drawRef.current(); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${moonTime || moonPlay ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Hold idő</button>
        </div>
      ) : null}
      {barMenu === "eg" ? (
        <div className="relative flex flex-wrap gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2">
          {spare.map((on, index) => index < 2 ? null : (
            <button
              key={index}
              type="button"
              onClick={() => {
                if (index === 2) {
                  const next = !spare[2];
                  festRef.current = next;
                  if (!next) setFestNote(null);
                  setSpare([spare[0], spare[1], next, spare[3]]);
                  drawRef.current();
                  return;
                }
                const next = !spare[3];
                decayOpenRef.current = next;
                if (!next) { decayFloorRef.current = false; ringOnRef.current = false; drawRef.current(); }
                setSpare([spare[0], spare[1], spare[2], next]);
              }}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${on ? "bg-stone-900 text-white" : "border border-stone-900"}`}
            >
              {index === 2 ? "Ünnepek" : "Lecsengés"}
            </button>
          ))}
          <button type="button" onClick={() => setPairMenu((open) => !open)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${pairMenu || pairLines.fedes || pairLines.meroleges || pairLines.sirius || pairLines.procyon || pairLines.kot || pairLines.szegely || pairLines.kozel || pairLines.egyenesen || pairLines.derekszog || pairLines.k63 || starOn.some(Boolean) || parallelOn.some(Boolean) ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Szíriusz–Procyon</button>
          <button type="button" onClick={() => setEastMenu((open) => !open)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${eastMenu || eastFlags.result || eastFlags.kel || eastFlags.kozos || eastFlags.dendera || eastFlags.nap || eastFlags.fenyes || eastFlags.K62 || eastFlags.K28 || eastFlags.K29 || eastFlags.K30 || eastFlags.K61 || eastFlags.K63 || eastFlags.K64 || eastFlags.K65 ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Keleti kövek</button>
          {spare[3] ? (
            <div className="w-full">
              <DecayChart
                traces={decayNow}
                sunTop={decaySunTopRef.current}
                onFrame={(progress, floor, ring) => {
                  const was = decayFloorRef.current;
                  const wasRing = ringOnRef.current;
                  decayProgressRef.current = progress;
                  decayFloorRef.current = floor;
                  ringOnRef.current = ring;
                  const traces = decayTracesRef.current;
                  if (traces.length) {
                    const count = traces[0].alt.length;
                    const last = Math.max(0, Math.min(count - 1, Math.round(progress * (count - 1))));
                    altLiveRef.current = traces.map((trace) => {
                      const peak = Math.max(...trace.alt);
                      return { name: trace.name, alt: trace.alt[last], color: trace.color, culm: peak, atCulm: culmOnRef.current && Math.abs(trace.alt[last] - peak) < 0.6, showCulm: culmOnRef.current };
                    });
                  } else altLiveRef.current = [];
                  if ((floor && !was) || (ring && !wasRing)) {
                    view3dRef.current = false;
                    setView3d(false);
                    setSpare((current) => [current[0], false, current[2], current[3]]);
                    canvasRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
                  }
                  if (floor || was || ring || wasRing) drawRef.current();
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {view3d ? (
        <div className="flex flex-wrap items-end gap-4 border-b border-stone-200 bg-stone-50 px-4 py-3 text-sm">
          <label className="flex min-w-40 flex-col gap-1">Magasság
            <input type="range" min={0.08} max={2.2} step={0.02} value={cam.height} onChange={(event) => applyCam({ ...camRef.current, height: Number(event.target.value) })} className="w-40" />
          </label>
          <label className="flex min-w-40 flex-col gap-1">Keringés
            <input type="range" min={-180} max={180} step={1} value={cam.orbit} onChange={(event) => applyCam({ ...camRef.current, orbit: Number(event.target.value) })} className="w-40" />
          </label>
          <label className="flex min-w-40 flex-col gap-1">Dőlés
            <input type="range" min={-5} max={75} step={1} value={cam.tilt} onChange={(event) => applyCam({ ...camRef.current, tilt: Number(event.target.value) })} className="w-40" />
          </label>
          <button type="button" onClick={() => applyCam({ ...CAM_HOME })} className="rounded-lg border border-stone-900 px-3 py-2 text-sm font-semibold">
            Kiinduló nézet
          </button>
          <p className="w-full text-xs text-stone-600">Az egérrel a keringés és a dőlés állítható, a görgő a magasságot. A padló síkja a gömb egyenlítőjén metszi a gömböt, és a köveken kívül szinte átlátszó.</p>
        </div>
      ) : null}
      {pairMenu ? (
        <div className="flex flex-wrap gap-2 border-b border-stone-200 bg-stone-50 px-4 py-3">
          {([
            ["fedes", "Fedés vonala"],
            ["meroleges", "Merőleges"],
            ["sirius", "Szíriusz kelése"],
            ["procyon", "Procyon kelése"],
            ["kot", "Kelési pontok összekötve"],
            ["szegely", "K29 átlói"],
            ["kozel", "Közeli fugák és átlók"],
            ["egyenesen", "Egy vonalon"],
            ["derekszog", "Merőleges fugák és átlók"],
            ["k63", "K63 merőlegese"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => togglePairLine(id)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${pairLines[id] ? "bg-stone-900 text-white" : "border border-stone-900"}`}
            >
              {label}
            </button>
          ))}
          <button type="button" onClick={() => setStarMenu((open) => !open)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${starMenu || starOn.some(Boolean) ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Csillagpárok</button>
          <button type="button" onClick={() => setParallelMenu((open) => !open)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${parallelMenu || parallelOn.some(Boolean) ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Párhuzamos párok</button>
        </div>
      ) : null}
      {pairMenu && starMenu ? (
        <div className="flex flex-wrap gap-2 border-b border-stone-200 bg-stone-50 px-4 py-3">
          {STAR_PAIRS.map((pair, index) => (
            <button key={`${pair.a}-${pair.b}-${pair.kind}`} type="button" onClick={() => toggleNamedPair("star", index)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${starOn[index] ? "bg-stone-900 text-white" : "border border-stone-900"}`}>
              {pair.a}–{pair.b} {pair.kind === "kel" ? "kel" : "nyug"} · {pair.stone}
            </button>
          ))}
        </div>
      ) : null}
      {pairMenu && parallelMenu ? (
        <div className="flex flex-wrap gap-2 border-b border-stone-200 bg-stone-50 px-4 py-3">
          {PARALLEL_PAIRS.map((pair, index) => (
            <button key={`${pair.a}-${pair.b}-p`} type="button" onClick={() => toggleNamedPair("parallel", index)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${parallelOn[index] ? "bg-stone-900 text-white" : "border border-stone-900"}`}>
              {pair.a}–{pair.b} {pair.kind === "kel" ? "kel" : "nyug"} · {pair.stone}
            </button>
          ))}
        </div>
      ) : null}
      {eastMenu ? (
        <div className="flex flex-col gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3 text-sm">
          <p>A denderai alakok és a szegélykövek sorrendje nem függ össze. Spearman −0,09, p = 0,54. 1°-on belül öt alak van, ezek lent bekapcsolhatók.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => toggleEast("result")} className={`rounded-lg px-3 py-2 font-semibold ${eastFlags.result ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Eredmény a padlón</button>
            <button type="button" onClick={() => toggleEast("kel")} className={`rounded-lg px-3 py-2 font-semibold ${eastFlags.kel ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Szíriusz–Procyon kelés</button>
            <button type="button" onClick={() => toggleEast("kozos")} className={`rounded-lg px-3 py-2 font-semibold ${eastFlags.kozos ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Közös átló</button>
            <button type="button" onClick={() => toggleEast("dendera")} className={`rounded-lg px-3 py-2 font-semibold ${eastFlags.dendera ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Dendera</button>
            <button type="button" onClick={() => toggleEast("nap")} className={`rounded-lg px-3 py-2 font-semibold ${eastFlags.nap ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Naprendszer</button>
            <button type="button" onClick={() => toggleEast("fenyes")} className={`rounded-lg px-3 py-2 font-semibold ${eastFlags.fenyes ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Fényes csillagok</button>
          </div>
          <p>A keleti nagy kövek északról kelet felé. A kimaradt nagy kövek északról nyugat felé: K63, K64, K65. Mindegyik a saját legjobb párját rajzolja, i. e. 54. július 16., helyi dél.</p>
          <div className="flex flex-wrap gap-2">
            {(["K62", "K28", "K29", "K30", "K61", "K63", "K64", "K65"] as const).map((id) => (
              <button key={id} type="button" onClick={() => toggleEast(id)} className={`rounded-lg px-3 py-2 font-semibold ${eastFlags[id] ? "bg-stone-900 text-white" : "border border-stone-900"}`}>{id}</button>
            ))}
          </div>
        </div>
      ) : null}
      {timeOn ? (
        <div className="flex flex-wrap items-end gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
          <label className="flex flex-col gap-1 text-sm">Év
            <input value={dayNumText} onChange={(event) => { setDayNumText(event.target.value); dayNumRef.current = event.target.value; }} inputMode="numeric" className="w-20 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">Korszak
            <select value={era} onChange={(event) => { const next = event.target.value === "isz" ? "isz" : "ie"; setEra(next); eraRef.current = next; }} className="rounded-lg border border-stone-300 px-3 py-2">
              <option value="ie">i. e.</option>
              <option value="isz">i. sz.</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">Hónap
            <input value={monthText} onChange={(event) => { setMonthText(event.target.value); monthRef.current = event.target.value; }} inputMode="numeric" className="w-16 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">Nap
            <input value={dateDayText} onChange={(event) => { setDateDayText(event.target.value); dateDayRef.current = event.target.value; }} inputMode="numeric" className="w-16 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <button type="button" onClick={() => void applyDate()} className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white">Erre a napra</button>
          <button type="button" onClick={jumpHeliacal} className="rounded-lg border border-stone-900 px-3 py-2 text-sm font-semibold">Heliakális kelés, i. e. 54</button>
          <label className="flex flex-col gap-1 text-sm">Egyezés, °
            <input value={matchText} onChange={(event) => { setMatchText(event.target.value); matchRef.current = event.target.value; drawRef.current(); }} inputMode="decimal" className="w-20 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">Nap hossza, mp
            <input value={dayText} onChange={(event) => { const text = event.target.value; setDayText(text); const seconds = Number(text.replace(",", ".")); if (Number.isFinite(seconds) && seconds > 0) sunMsRef.current = seconds * 1000; }} inputMode="decimal" className="w-24 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
        </div>
      ) : null}
      {floorMenu === "beallitas" ? (
        <div className="flex flex-wrap items-end gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
          <label className="flex flex-col gap-1 text-sm">Ettől, °
            <input value={fromText} onChange={(event) => { setFromText(event.target.value); fromRef.current = event.target.value; drawRef.current(); }} inputMode="decimal" className="w-24 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">Eddig, °
            <input value={toText} onChange={(event) => { setToText(event.target.value); toRef.current = event.target.value; drawRef.current(); }} inputMode="decimal" className="w-24 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">Időtartam, mp
            <input value={durationText} onChange={(event) => { const text = event.target.value; setDurationText(text); const seconds = Number(text.replace(",", ".")); if (Number.isFinite(seconds) && seconds > 0) setStepMs(Math.round(seconds * 1000)); }} inputMode="decimal" className="w-24 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <button type="button" onClick={() => showSource("fuga")} className={`rounded-lg px-3 py-2 text-sm font-semibold ${source === "fuga" ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Fugák</button>
          <button type="button" onClick={() => showSource("atlo")} className={`rounded-lg px-3 py-2 text-sm font-semibold ${source === "atlo" ? "bg-stone-900 text-white" : "border border-stone-900"}`}>Átlók</button>
          <button type="button" onClick={playBand} className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white">Tartomány animációja</button>
          <button type="button" onClick={playAll} className="rounded-lg border border-stone-900 px-3 py-2 text-sm font-semibold">Teljes animáció</button>
          <button type="button" onClick={applyRange} className="rounded-lg border border-stone-900 px-3 py-2 text-sm font-semibold">Kiemelés</button>
          <button type="button" onClick={() => { followRef.current = "none"; setFollow("none"); animReasonRef.current = animOnRef.current ? null : "settings"; animOnRef.current = !animOnRef.current; setOn(animOnRef.current); drawRef.current(); }} disabled={frozen} className="rounded-lg border border-stone-900 px-3 py-2 text-sm font-semibold disabled:opacity-40">{on && !frozen ? "Megállítás" : "Indítás"}</button>
          <p className="w-full text-xs leading-5 text-stone-600">0° észak–dél, 90° kelet–nyugat. Ha az ettől nagyobb, mint az eddig, a tartomány átfordul a 0°-on.{rangeNote ? ` ${rangeNote}` : ""}</p>
        </div>
      ) : null}
      {floorMenu === "kovek" ? (
        <div className="space-y-3 border-b border-stone-200 bg-stone-50 px-4 py-3 text-sm">
          <p className="font-medium">{stoneList.length ? `${stoneList.length} kő` : "A kövek betöltése…"}</p>
          {stone ? (
            <>
              <label className="flex flex-col gap-1">Kő
                <select value={stone.id} onChange={(event) => setStoneId(event.target.value)} className="max-w-xs rounded-lg border border-stone-300 px-3 py-2">
                  {stoneList.map((item) => (
                    <option key={item.id} value={item.id}>{item.id} · {item.oldalak} szög · {item.forma}</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-2">
                <p>Azonosító: {stone.id} · {stone.sorozat} · {stone.szin}</p>
                <p>Szögek száma: {stone.oldalak} · forma: {stone.forma}</p>
                <p>Terület: {fmt(stone.terulet, 0)} px² · kerület: {fmt(stone.kerulet)} px</p>
                <p>Tengely északhoz: {fmt(stone.tengely)}° · szomszéd: {stone.szomszedok.length}</p>
                <p className="sm:col-span-2">Oldalhosszak, px és irány: {stone.elek.map(([length, bearing]) => `${fmt(length)} px / ${fmt(bearing)}°`).join(" · ")}</p>
                <p className="sm:col-span-2">Belső szögek: {stone.szogek.map((angle) => `${fmt(angle)}°`).join(" · ")}</p>
                <p className="sm:col-span-2">Átlók: {stone.atlok.length ? stone.atlok.map((item) => `${fmt(item[2])} px / ${fmt(item[3])}°`).join(" · ") : "nincs"}</p>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {floorMenu === "fugak" ? (
        <div className="flex flex-wrap gap-4 border-b border-stone-200 bg-stone-50 px-4 py-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={fugaHistMenu} onChange={() => { fugaHistMenuRef.current = !fugaHistMenuRef.current; setFugaHistMenu(fugaHistMenuRef.current); syncPresentation(); }} />
            Hisztogram
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={fugaBandOn} onChange={() => { fugaBandRef.current = !fugaBandRef.current; setFugaBandOn(fugaBandRef.current); drawRef.current(); }} />
            Láthatósági szögsáv
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={peakColor} onChange={() => { peakColorRef.current = !peakColorRef.current; setPeakColor(peakColorRef.current); drawRef.current(); }} />
            Csúcs színe az objektum felé
          </label>
          <p className="w-full text-xs text-stone-600">A sáv a Beállításokban megadott ettől–eddig szögtartomány. A hisztogram a fugák irányának sűrűsége. A csúcs színe csak akkor vált, ha a kapcsoló be van kapcsolva, és egy objektum áthalad rajta.</p>
        </div>
      ) : null}
      {floorMenu === "atlok" ? (
        <div className="flex flex-wrap gap-4 border-b border-stone-200 bg-stone-50 px-4 py-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={atloHistMenu} onChange={() => { atloHistMenuRef.current = !atloHistMenuRef.current; setAtloHistMenu(atloHistMenuRef.current); syncPresentation(); }} />
            Hisztogram
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={atloBandOn} onChange={() => { atloBandRef.current = !atloBandRef.current; setAtloBandOn(atloBandRef.current); drawRef.current(); }} />
            Láthatósági szögsáv
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={peakColor} onChange={() => { peakColorRef.current = !peakColorRef.current; setPeakColor(peakColorRef.current); drawRef.current(); }} />
            Csúcs színe az objektum felé
          </label>
          <p className="w-full text-xs text-stone-600">A sáv a Beállításokban megadott ettől–eddig szögtartomány. A hisztogram az átlók irányának sűrűsége. A csúcs színe csak akkor vált, ha a kapcsoló be van kapcsolva, és egy objektum áthalad rajta.</p>
        </div>
      ) : null}
      {moonTime ? (
        <div className="flex flex-wrap items-end gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
          <label className="flex flex-col gap-1 text-sm">Ettől, hónap
            <input value={moonFromMonth} onChange={(event) => { setMoonFromMonth(event.target.value); moonFromMonthRef.current = event.target.value; moonCursorRef.current = 0; drawRef.current(); }} inputMode="numeric" className="w-20 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">nap
            <input value={moonFromDay} onChange={(event) => { setMoonFromDay(event.target.value); moonFromDayRef.current = event.target.value; moonCursorRef.current = 0; drawRef.current(); }} inputMode="numeric" className="w-16 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">Eddig, hónap
            <input value={moonToMonth} onChange={(event) => { setMoonToMonth(event.target.value); moonToMonthRef.current = event.target.value; moonCursorRef.current = 0; drawRef.current(); }} inputMode="numeric" className="w-20 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">nap
            <input value={moonToDay} onChange={(event) => { setMoonToDay(event.target.value); moonToDayRef.current = event.target.value; moonCursorRef.current = 0; drawRef.current(); }} inputMode="numeric" className="w-16 rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <label className="flex min-w-56 flex-col gap-1 text-sm">Keringés sebessége
            <input
              type="range"
              min={1}
              max={90}
              step={1}
              value={Math.min(90, Math.max(1, Number(moonSpeed.replace(",", ".")) || 12))}
              onChange={(event) => {
                const text = event.target.value;
                setMoonSpeed(text);
                moonSpeedRef.current = Number(text);
              }}
              className="w-56"
            />
            <span className="text-xs text-stone-600">{Math.min(90, Math.max(1, Number(moonSpeed.replace(",", ".")) || 12))} nap másodpercenként</span>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={moonSector}
              onChange={() => {
                moonSectorRef.current = !moonSectorRef.current;
                setMoonSector(moonSectorRef.current);
                drawRef.current();
              }}
            />
            Láthatósági körcikk
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={moonYearArc}
              onChange={() => {
                moonYearArcRef.current = !moonYearArcRef.current;
                setMoonYearArc(moonYearArcRef.current);
                drawRef.current();
              }}
            />
            Éves láthatósági körív
          </label>
          <button
            type="button"
            onClick={() => {
              const next = !moonPlayRef.current;
              if (next) moonCursorRef.current = 0;
              moonPlayRef.current = next;
              setMoonPlay(next);
              drawRef.current();
            }}
            className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white"
          >
            {moonPlay ? "Megállítás" : "Indítás"}
          </button>
          <p className="w-full text-xs text-stone-600">Az év az Idő mezőből jön. A csúszka adja meg, hány naptári nap telik el egy másodperc alatt. A körcikk az aznapi látható ív. Az éves körív nagyobb: tizenkét hónap, a holdfázisok színnel. Ú újhold, 1 első negyed, T telehold, 3 utolsó negyed. A barna vonal a lejátszás napja.</p>
        </div>
      ) : null}
      {moonYear ? (
        <MoonYear
          era={era}
          yearText={dayNumText}
          month={Number(monthText) || 1}
          day={Number(dateDayText) || 1}
          onPick={(nextMonth, nextDay) => {
            const monthValue = String(nextMonth);
            const dayValue = String(nextDay);
            setMonthText(monthValue);
            monthRef.current = monthValue;
            setDateDayText(dayValue);
            dateDayRef.current = dayValue;
            void applyDate(false);
          }}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 items-stretch overflow-hidden">
      <aside className="z-20 h-full w-64 shrink-0 overflow-y-auto border-r border-stone-200 bg-stone-50">
      <section className="border-b border-stone-200">
        <details open>
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">Objektumok</summary>
          <details className="mx-2 mb-1 rounded border border-stone-200 bg-white">
            <summary className="cursor-pointer px-2 py-1 text-xs font-semibold">Nevezetes objektumok</summary>
            <div className="flex flex-wrap gap-1 px-2 pb-2">
              {OBJECTS.filter((item) => item.id === "sirius" || item.id === "alkaid" || item.id === "goncol").map((item) => {
                const memberHips = new Set<number>();
                if (picked.sirius) memberHips.add(32349);
                if (picked.alkaid && DIPPER_HIPS[6]) memberHips.add(DIPPER_HIPS[6]);
                if (picked.goncol) for (const hip of DIPPER_HIPS) if (hip) memberHips.add(hip);
                for (const star of BRIGHT) if (brightPick[star.id]) memberHips.add(star.hip);
                const wagonLit = item.id === "goncol" && DIPPER_HIPS.some((hip) => hip && memberHips.has(hip));
                return <NameChip key={item.id} name={item.label} tint={wagonLit ? "#9f1239" : undefined} on={picked[item.id]} onClick={() => togglePicked(item.id)} />;
              })}
              <NameChip name="Procyon" on={!!brightPick.f37279} onClick={() => toggleBright("f37279")} />
            </div>
          </details>
          <details className="mx-2 mb-1 rounded border border-stone-200 bg-white">
            <summary className="cursor-pointer px-2 py-1 text-xs font-semibold">Naprendszer</summary>
            <div className="flex flex-wrap gap-1 px-2 pb-2">
              <NameChip name="Nap" on={picked.nap} onClick={() => togglePicked("nap")} />
              <NameChip name="Hold" on={!!planetPick.hold} onClick={() => togglePlanet("hold")} />
              {PLANET_ROWS.map((star) => (
                <NameChip key={star.id} name={star.nev} on={!!planetPick[star.id]} onClick={() => togglePlanet(star.id)} />
              ))}
            </div>
          </details>
          <details className="mx-2 mb-1 rounded border border-stone-200 bg-white">
            <summary className="cursor-pointer px-2 py-1 text-xs font-semibold" title={radiantMatch ? `${radiantMatch.name}, ${radiantMatch.score.toFixed(1)}°` : undefined}>Meteoridák</summary>
            <div className="flex flex-wrap gap-1 px-2 pb-2">
              {METEOR.map((star) => (
                <NameChip key={star.id} name={star.nev} on={!!metPick[star.id]} onClick={() => toggleMet(star.id)} />
              ))}
            </div>
          </details>
          <details className="mx-2 mb-1 rounded border border-stone-200 bg-white">
            <summary className="cursor-pointer px-2 py-1 text-xs font-semibold">Szupernóvák</summary>
            <div className="flex flex-wrap gap-1 px-2 pb-2">
              {NOVA.map((star) => (
                <NameChip key={star.id} name={star.nev} on={!!snPick[star.id]} onClick={() => toggleSn(star.id)} />
              ))}
            </div>
          </details>
          <details className="mx-2 mb-1 rounded border border-stone-200 bg-white">
            <summary className="cursor-pointer px-2 py-1 text-xs font-semibold">Fényesek</summary>
            <div className="flex flex-wrap gap-1 px-2 pb-2">
              {BRIGHT.map((star) => (
                <NameChip key={star.id} name={star.nev} on={!!brightPick[star.id]} onClick={() => toggleBright(star.id)} />
              ))}
            </div>
          </details>
          <details className="mx-2 mb-2 rounded border border-stone-200 bg-white">
            <summary className="cursor-pointer px-2 py-1 text-xs font-semibold">Denderai zodiákus</summary>
            <div className="flex flex-wrap gap-1 px-2 pb-2">
              {ZODIAC.map((figure) => {
                const memberHips = new Set<number>();
                if (picked.sirius) memberHips.add(32349);
                if (picked.alkaid && DIPPER_HIPS[6]) memberHips.add(DIPPER_HIPS[6]);
                if (picked.goncol) for (const hip of DIPPER_HIPS) if (hip) memberHips.add(hip);
                for (const star of BRIGHT) if (brightPick[star.id]) memberHips.add(star.hip);
                const lit = figure.csillagok.some((star) => memberHips.has(star.hip)) || (figure.id === "zod-003" && (picked.sirius || !!brightPick.f32349));
                return <NameChip key={figure.id} name={figure.nev} tint={lit ? figure.szin : undefined} on={!!zodPick[figure.id]} onClick={() => toggleZod(figure.id)} />;
              })}
            </div>
          </details>
        </details>
        {FUNCTION_GROUPS.map((group) => (
          <details key={group.label} open className="border-t border-stone-200">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{group.label}</summary>
            <div className="flex flex-wrap gap-1 px-2 pb-2">
              {group.label === "Vonalak"
                ? OBJECTS.filter((item) => item.id === "fuga" || item.id === "atlo").map((item) => (
                    <NameChip key={item.id} name={item.label} on={picked[item.id]} onClick={() => togglePicked(item.id)} />
                  ))
                : null}
              {group.ids.map((id) => {
                if (id === "asav") return null;
                if (id === "ssav") {
                  return (
                    <div key="sav-row" className="flex w-full flex-nowrap gap-1">
                      {(["ssav", "asav"] as const).map((bandId) => {
                        const item = FUNCTIONS.find((row) => row.id === bandId);
                        return item ? <NameChip key={bandId} className="flex-1 justify-center" name={item.label} on={funcs[bandId]} onClick={() => toggleFunc(bandId)} /> : null;
                      })}
                    </div>
                  );
                }
                const item = FUNCTIONS.find((row) => row.id === id);
                return item ? <NameChip key={id} name={item.label} on={funcs[id]} onClick={() => toggleFunc(id)} /> : null;
              })}
              {group.label === "Láthatóság" ? (
                <div className="w-full">
                  <button
                    type="button"
                    onClick={() => setConjOpen(true)}
                    className={`w-full rounded border px-2 py-1 text-left text-xs font-semibold ${conjOpen || conjMode ? "border-amber-700 bg-amber-500 text-stone-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}
                  >
                    Együttállás
                  </button>
                </div>
              ) : null}
            </div>
          </details>
        ))}
        <details open className="border-t border-stone-200">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">Eszközök</summary>
          <div className="flex flex-wrap gap-1 px-2 pb-2">
            <button
              type="button"
              onClick={() => {
                const next = !rulerOn;
                setRulerOn(next);
                if (next && rulerRef.current.x === 0) {
                  const box = floorBoxRef.current?.getBoundingClientRect();
                  rulerRef.current = { x: box ? box.width / 2 : 360, y: box ? box.height / 2 : 280, deg: 0, len: rulerRef.current.len || 310 };
                  setRuler({ ...rulerRef.current });
                }
              }}
              className={`rounded border px-2 py-1 text-xs font-semibold ${rulerOn ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-800"}`}
            >
              Vonalzó
            </button>
            <button
              type="button"
              onClick={() => {
                setRasterOn((on) => !on);
                setRasterScan(false);
              }}
              className={`rounded border px-2 py-1 text-xs font-semibold ${rasterOn ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-800"}`}
            >
              Raszter
            </button>
            {rasterOn ? (
              <div className="w-full space-y-1 pt-1">
                <label className="flex items-center gap-2 text-xs text-stone-700">
                  Méret
                  <input type="range" min={12} max={200} step={0.01} value={rasterSize} onChange={(event) => setRasterSize(Math.round(Number(event.target.value) * 100) / 100)} className="min-w-0 flex-1" />
                  <input type="number" min={12} max={200} step={0.01} value={rasterSize} onChange={(event) => { const next = Number(event.target.value.replace(",", ".")); if (Number.isFinite(next)) setRasterSize(Math.round(Math.min(200, Math.max(12, next)) * 100) / 100); }} className="w-16 rounded border border-stone-300 bg-white px-1 py-0.5 text-right text-xs tabular-nums" />
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-700">
                  Irány
                  <input type="range" min={-90} max={90} step={0.01} value={rasterDeg} onChange={(event) => setRasterDeg(Math.round(Number(event.target.value) * 100) / 100)} className="min-w-0 flex-1" />
                  <input type="number" min={-90} max={90} step={0.01} value={rasterDeg} onChange={(event) => { const next = Number(event.target.value.replace(",", ".")); if (Number.isFinite(next)) setRasterDeg(Math.round(Math.min(90, Math.max(-90, next)) * 100) / 100); }} className="w-16 rounded border border-stone-300 bg-white px-1 py-0.5 text-right text-xs tabular-nums" />
                  <span>°</span>
                </label>
                <button
                  type="button"
                  onClick={() => setRasterPick((on) => !on)}
                  className={`rounded border px-2 py-1 text-xs font-semibold ${rasterPick ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-800"}`}
                >
                  Ponthoz köt
                </button>
                <button
                  type="button"
                  onClick={() => setRasterLineHit((on) => !on)}
                  className={`rounded border px-2 py-1 text-xs font-semibold ${rasterLineHit ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-800"}`}
                >
                  Vonalon
                </button>
                <button
                  type="button"
                  onClick={() => setRasterCrossHit((on) => !on)}
                  className={`rounded border px-2 py-1 text-xs font-semibold ${rasterCrossHit ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-800"}`}
                >
                  Kereszteződés
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (rasterScan) {
                      setRasterScan(false);
                      return;
                    }
                    setScanRows([]);
                    setRasterSize(12);
                    setRasterLineHit(true);
                    setRasterCrossHit(true);
                    setRasterScan(true);
                  }}
                  className={`rounded border px-2 py-1 text-xs font-semibold ${rasterScan ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-800"}`}
                >
                  {rasterScan ? "Szkennelés leáll" : "Szkennel"}
                </button>
                <p className="text-xs text-stone-600">{rasterScan ? `Méret ${rasterSize.toFixed(2).replace(".", ",")} · a találatok gyűlnek.` : rasterPick ? "Kattints a padlóra. Az a pont fix kereszteződés lesz." : "A narancs pontot húzva a háló áthelyezhető. Szkennel: a méret 12-től 200-ig nő, a találatok megmaradnak."}</p>
                {scanRows.length ? (
                  <div className="max-h-36 w-full overflow-auto rounded border border-stone-200">
                    {scanRows.map((row) => (
                      <button
                        key={row.size}
                        type="button"
                        onClick={() => {
                          setRasterScan(false);
                          setRasterSize(row.size);
                          setRasterLineHit(true);
                          setRasterCrossHit(true);
                        }}
                        className="flex w-full justify-between px-2 py-1 text-left text-xs hover:bg-stone-100"
                      >
                        <span>{row.size.toFixed(2).replace(".", ",")}</span>
                        <span>vonal {row.line} · kereszt {row.cross}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="w-full text-xs text-stone-600">A végét húzva nyúlik. Jobb gomb a vonalzón: Vonal. A kijelölt vonalon jobb gomb: Vonal törlése.</p>
            <details className="w-full">
              <summary className="cursor-pointer px-1 py-1 text-xs font-semibold">Kijelölés</summary>
              <div className="flex flex-wrap gap-1 px-1 pb-2">
                <button
                  type="button"
                  onClick={() => setStonePick((on) => !on)}
                  className={`rounded border px-2 py-1 text-xs font-semibold ${stonePick ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-800"}`}
                >
                  Kő
                </button>
                <button
                  type="button"
                  onClick={() => { setFugaPick((on) => !on); setFugaMenu(null); }}
                  className={`rounded border px-2 py-1 text-xs font-semibold ${fugaPick ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-800"}`}
                >
                  Fuga
                </button>
                <p className="w-full text-xs text-stone-600">{fugaPick ? "Bal gomb: fuga. Jobb gomb: további kijelölés." : "A kijelölt fugák megmaradnak."} {pickedFugas.length ? `${pickedFugas.length} fuga` : "Még nincs kijelölt fuga."} {pickedStones.length ? `${pickedStones.length} kő: ${pickedStones.join(", ")}` : ""}</p>
              </div>
            </details>
            <details className="w-full">
              <summary className="cursor-pointer px-1 py-1 text-xs font-semibold">Réteg</summary>
              <div className="space-y-1 px-1 pb-2">
                <input value={layerName} onChange={(event) => setLayerName(event.target.value)} placeholder="A réteg neve" className="w-full rounded border border-stone-300 px-2 py-1 text-xs" />
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const name = layerName.trim() || `Réteg ${layers.length + 1}`;
                      const id = String(Date.now());
                      setLayers((list) => [...list, { id, name, stones: [] }]);
                      setCurrentLayer(id);
                      setLayerName(name);
                      setPickedStones([]);
                    }}
                    className="rounded border border-stone-300 bg-white px-2 py-1 text-xs font-semibold text-stone-800"
                  >
                    Új réteg
                  </button>
                  <button
                    type="button"
                    disabled={!currentLayer}
                    onClick={() => {
                      const name = layerName.trim();
                      if (!currentLayer || !name) return;
                      setLayers((list) => list.map((layer) => layer.id === currentLayer ? { ...layer, name } : layer));
                    }}
                    className="rounded border border-stone-300 bg-white px-2 py-1 text-xs font-semibold text-stone-800 disabled:opacity-40"
                  >
                    Átnevez
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const name = layerName.trim() || `Réteg ${layers.length + 1}`;
                      if (!currentLayer) {
                        const id = String(Date.now());
                        setLayers((list) => [...list, { id, name, stones: [...pickedStones] }]);
                        setCurrentLayer(id);
                        setLayerName(name);
                        return;
                      }
                      setLayers((list) => list.map((layer) => layer.id === currentLayer ? { ...layer, name, stones: [...pickedStones] } : layer));
                    }}
                    className="rounded border border-stone-900 bg-stone-900 px-2 py-1 text-xs font-semibold text-white"
                  >
                    Mentés
                  </button>
                </div>
                <p className="text-xs text-stone-600">{currentLayer ? "A mentés az aktuális rétegre írja a kijelölt köveket." : "Előbb hozz létre egy réteget."}</p>
                {layers.length ? (
                  <div className="max-h-36 overflow-auto rounded border border-stone-200">
                    {layers.map((layer) => (
                      <button
                        key={layer.id}
                        type="button"
                        onClick={() => {
                          setCurrentLayer(layer.id);
                          setLayerName(layer.name);
                          setPickedStones(layer.stones);
                        }}
                        className={`flex w-full justify-between px-2 py-1 text-left text-xs ${layer.id === currentLayer ? "bg-stone-900 text-white" : "hover:bg-stone-100"}`}
                      >
                        <span>{layer.name}</span>
                        <span>{layer.stones.length} kő</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
            <details className="w-full">
              <summary className="cursor-pointer px-1 py-1 text-xs font-semibold">Szögösszevetés</summary>
              <div className="max-h-48 overflow-auto px-1 pb-2">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="text-stone-500">
                      <th className="py-1 pr-2">Szög</th>
                      <th className="py-1 pr-2">Fuga csúcsok</th>
                      <th className="py-1 pr-2">Északra</th>
                      <th className="py-1 pr-2">Keletre</th>
                      <th className="py-1 pr-2">Átló csúcsok</th>
                      <th className="py-1">Szíriusz</th>
                    </tr>
                  </thead>
                  <tbody>
                    {angleRows.map((row) => (
                      <tr key={row.szog} className={row.szog === floorDeg ? "bg-stone-100 font-semibold" : ""}>
                        <td className="py-0.5 pr-2 tabular-nums">{row.szog.toFixed(2).replace(".", ",")}°</td>
                        <td className="py-0.5 pr-2 tabular-nums">{row.fuga18.toFixed(1)}° · {row.fuga108.toFixed(1)}°</td>
                        <td className="py-0.5 pr-2 tabular-nums">{row.fugaEszak}</td>
                        <td className="py-0.5 pr-2 tabular-nums">{row.fugaKelet}</td>
                        <td className="py-0.5 pr-2 tabular-nums">{row.atlo81.toFixed(1)}° · {row.atlo138.toFixed(1)}°</td>
                        <td className="py-0.5 tabular-nums">{row.sirius.toFixed(2).replace(".", ",")}°</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </details>
        <div className="border-t border-stone-200 px-3 py-2">
          {accountPending ? (
            <div className="h-10 animate-pulse rounded-lg bg-stone-100" />
          ) : user ? (
            <>
              <button
                type="button"
                onClick={() => setNamingSetup((current) => !current)}
                className="w-full rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white"
              >
                Beállítás mentése
              </button>
              {namingSetup ? (
                <div className="mt-2 flex gap-2">
                  <input
                    value={setupName}
                    onChange={(event) => setSetupName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveNamedSetup();
                    }}
                    placeholder="A beállítás neve"
                    className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                    autoFocus
                  />
                  <button type="button" onClick={saveNamedSetup} className="rounded-lg border border-stone-900 px-3 py-2 text-sm font-semibold">
                    Mentés
                  </button>
                </div>
              ) : null}
              {setupError ? <p className="mt-2 text-xs text-red-700">{setupError}</p> : null}
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-semibold">Mentett beállítások</summary>
                <div className="mt-2 space-y-2">
                  {setups.length === 0 ? (
                    <p className="text-sm text-stone-500">Még nincs mentett beállítás.</p>
                  ) : (
                    setups.map((item) => (
                      <div key={item.name} className="rounded-lg bg-stone-50 px-2 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <button type="button" onClick={() => loadSetup(item)} className="text-left text-sm font-semibold text-stone-900 underline">
                            {item.name}
                          </button>
                          <button type="button" onClick={() => dropNamedSetup(item.name)} className="text-xs text-stone-500">
                            törlés
                          </button>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-stone-600">{setupLine(item.data)}</p>
                      </div>
                    ))
                  )}
                </div>
              </details>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-xs leading-5 text-stone-600">A mentés a belépéshez tartozik. Mindenki a saját listáját látja.</p>
              {GROK_PROVIDERS.map((provider) => (
                <button key={provider.providerId} type="button" onClick={() => signIn(provider.providerId, { callbackURL: "/" })} className="w-full rounded-lg border border-stone-900 px-3 py-2 text-sm font-semibold">
                  Belépés: {provider.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <details>
          <summary className="cursor-pointer border-t border-stone-200 px-3 py-2 text-sm font-semibold">Összevetés</summary>
          <div className="space-y-3 px-4 pb-4 text-sm leading-6 text-stone-800">
            <p>
              A bejelölt égitest irányát mérem a padló két hisztogramjához. A fuga csúcsai 18° és 108°. Az átló csúcsai 81° és 138°. Ezek a vonalak nem mozognak. A közös eltérés a két eltérés közül a nagyobb: egy irány csak akkor számít közelnek, ha egyik csúcshalmaztól sem áll messze.
            </p>
            {compareRows.length === 0 ? (
              <p className="rounded-lg bg-stone-50 px-3 py-2">Még nincs kijelölt égitest. Jelölj ki legalább egyet az Objektumok, a Szupernóvák vagy a Meteoritok között. A fugák és az átlók maguk a vonalak, nem egy mozgó irány.</p>
            ) : (
              <div className="space-y-2">
                {compareRows.map((row) => (
                  <div key={row.name} className="rounded-lg border border-stone-200 px-3 py-2">
                    <p className="font-semibold">{row.name}</p>
                    <p>{momentLine("Most", row.now)}</p>
                    <p>{row.kel ? momentLine("Kelés", row.kel) : "Nem kel: a deklinációja a denderai szélességen a horizont fölött marad."}</p>
                    <p>{row.nyug ? momentLine("Nyugvás", row.nyug) : "Nem nyugszik."}</p>
                    <p>{row.napi ? `Horizont fölött, 5°-os lépésben a legkisebb közös eltérés ${huDeg(row.napi.joint)}, irány ${huDeg(row.napi.azimuth)}.` : "A pálya a horizont alatt marad."}</p>
                  </div>
                ))}
              </div>
            )}
            <h3 className="text-sm font-semibold">Közérthetően</h3>
            <p>
              {marked
                ? `A kijelöltek közül a ${marked.name} ${marked.where} áll a legközelebb ahhoz, hogy egyetlen iránya egyszerre illeszkedjen a fuga és az átló fő vonalára. Az irány ${huDeg(marked.moment.azimuth)}. A fugától ${huDeg(marked.moment.fugaGap)} van, az átlótól ${huDeg(marked.moment.atloGap)}. A közös eltérés a nagyobbik: ${huDeg(marked.moment.joint)}. Ennél kisebb közös szám nem létezik, mert a 108°-os fuga és a 81°-os átló 27°-ra áll egymástól, a kettő közötti felező pedig mindkettőtől 13,5°-ra.`
                : "Amíg nincs kijelölt égitest, nincs mit a vonalakhoz mérni. A hisztogram csak azt mondja meg, merre sűrűsödnek a padló vonalai."}
            </p>
            <h3 className="text-sm font-semibold">Tudományosan</h3>
            <p>
              Az irányítatlan eltérés δ(a, b) = min(|a′ − b′|, 180° − |a′ − b′|), ahol a′ = a mod 180. A közös pontszám s(A) = max(min δ(A, Fᵢ), min δ(A, Dⱼ)), F = {"{18°, 108°}"}, D = {"{81°, 138°}"}. Ez a két halmaz Csebisev-távolsága.
              {marked ? ` A kijelölt halmaz horizonti minimuma s = ${huDeg(marked.moment.joint)}, ${marked.name}, ${marked.where}, A = ${huDeg(marked.moment.azimuth)}.` : " A minimum akkor számolható, ha van deklináció és azimut."}
              {" "}Nem Pearson-korreláció, és nincs hozzá p-érték. A geometriai alsó korlát s ≥ 13,5°, mert a legközelebbi F–D pár távolsága 27°, és egy pont a körön nem lehet mindkettőhöz közelebb, mint a távolság fele.
            </p>
            <h3 className="text-sm font-semibold">Levezetés</h3>
            <ol className="list-decimal space-y-2 pl-5">
              <li>A vonalnak nincs nyiliránya. A 0° és a 180° ugyanaz az észak–dél tengely. Ezért minden szöget 180°-ra hajtok, és a távolság δ(a, b) = min(|a − b|, 180° − |a − b|).</li>
              <li>A hisztogram hosszal súlyoz. Az k-adik egyfokos rekesz: H(k) = Σ hossz, azokra az élekre vagy átlókra, amelyek iránya k-ba esik. A rövid fuga így kevesebbet számít, mint a hosszú.</li>
              <li>A csúcs nem egyetlen rekesz. S(k) = Σⱼ₌₋₅⁺⁵ H((k + j) mod 180). Csúcs, ha S(k) helyi maximum, S(k) ≥ 0,72 · max S, és a nála erősebb csúcstól legalább 12°-ra van. Ezt csinálja a rosePeaks függvény. A megtartott módusok: fuga 18° és 108°, átló 81° és 138°.</li>
              <li>A kelés azimutja, törés nélkül, A = arccos(sin δ / cos φ), φ = 26,1417°. A másik metszés 360° − A. Ha |sin δ| nagyobb, mint cos φ, a test nem kel és nem nyugszik. A pillanatnyi azimut az óraszögből jön: azimut = atan2(sin H, cos H sin φ − tan δ cos φ) + 180°, északról kelet felé.</li>
              <li>A meteor radiánsa nem állócsillag. λ(t) = λ₀ + (dλ/dt) · (év − 2000) / 100, a tropikus ekliptikán. ε(T) = 23,439291° − 0,0130042° · T, T = (év − 2000) / 100. sin δ = sin β cos ε + cos β sin ε sin λ, és a rektaszcenzió a Meeus-párból: y = sin λ cos ε − tan β sin ε, x = cos λ.</li>
              <li>A keresés csak a nem nulla pályacsúszású rajokra ment, i. e. 5001-től i. sz. 2000-ig, 5 évenként. A pontszám minden kelésre és nyugvásra s(A). A rács miatt az év ±2–3 év lehet. Ahol a ráta nulla, a csúszás nem viszi közelebb a felezőhöz.</li>
              <li>A legkisebb talált s 13,5°, a Tauridák nyugvásánál, i. e. 1766 körül, 275°-on. Ez a 108° + 180° és a 81° + 180° felezője. A szám a 27° fele, nem egy illesztett találat. Egy csúcshoz külön már a templom korában is van 1°-on belüli egyezés; a 13,5° csak a két hisztogram együttes követelménye.</li>
            </ol>
          </div>
        </details>
        <details>
          <summary className="cursor-pointer border-t border-stone-200 px-3 py-2 text-sm font-semibold">Jegyzet</summary>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap px-4 pb-4 text-sm leading-6 text-stone-800">{`Kérdés
Miért a 13.5 fokban van a legközelebbi egyezés

Válasz
A 13,5° nem mérési hiba, hanem a két csúcs távolságának a fele. Ennél közelebb egyetlen érkezési irány nem kerülhet mindkettőhöz.

A fuga hisztogram csúcsai 18° és 108°. Az átló hisztogram csúcsai 81° és 138°. A legközelebbi pár a 108°-os fuga és a 81°-os átló: közöttük 27° van.

Egy meteorrajnak egy kelési vagy nyugvási iránya van. Ha ez pontosan a 108°-on ül, az átlócsúcstól 27°-ra marad. Ha a 81°-on ül, a fugacsúcstól 27°-ra marad. A közös eltérés ott a legkisebb, ahol a kettő között, középen áll:

(108 − 81) / 2 = 13,5°

A Tauridák nyugvása i. e. 1766-ban éppen erre a felezőre esik, 275°-ra. Ez a 108°-os vonal másik vége (288°) és a 81°-os vonal másik vége (261°) között van, mindkettőtől 13,5°-ra.

Ha csak az egyik hisztogramot nézzük, ennél sokkal közelebbi egyezés is van. A templom korában a Delta Aquaridák kelése 0,6°-ra van a 108°-os fugacsúcstól, a Perseidák kelése 0,6°-ra a 18°-ostól, az Orionidák nyugvása 0,1°-ra a 108°-os vonaltól, a Tauridák kelése pedig 0,5°-ra a 81°-os átlócsúcstól. A 13,5° csak akkor lép fel, ha egy iránytól azt várjuk, hogy egyszerre mindkét csúcshoz közel legyen.

Kérdés
Vizsgáld meg, melyek azok az objektumok, amelyek láthatósági sávjának legalább egy része egybeesik a sűrűségi sávval.

Válasz
I. e. 54. július 16., Dendera. A láthatósági sáv az az ív, ahol az objektum szabad szemmel fenn van: csillagnál legalább 2° magasan, és a Nap legalább 8°-kal a horizont alatt. A Napnál ez a nappali ív. A sűrűségi sáv a hisztogramcsúcs félmagasságig mért szélessége, mindkét irányban.

Fuga 18°: 13° széles, 12–25° és 192–205°.
Fuga 108°: 13° széles, 102–115° és 282–295°.
Átló 81°: 42° széles, 49–91° és 229–271°.
Átló 138°: 42° széles, 125–167° és 305–347°.

Azok tartoznak egy csoportba, akiknek a láthatósági íve nagy részben egy sávban ül. Ezek mentett beállítások, mindegyiken a mozgás, a láthatósági sáv és a sűrűségi sáv van bekapcsolva.

Fuga 108°, láthatóság: Szíriusz, Rigel, Alnilam, Szaturnusz, Geminidák.
Fuga 18°, láthatóság: Perseidák, SN 185.
Átló 81°, láthatóság: Vénusz, Mars, Procyon, Betelgeuse, Aldebaran, Capella, Castor, Pollux, Elnath, SN 1054, Bika, Ikrek, Szatet és Hathor tehene.
Átló 138°, láthatóság: Alkaid és a Göncölszekér.

A Nap nappali íve mind a négy sávot metszi, mert hosszú. Több sávot is átszel a Hold, a Jupiter, a Vega, a Deneb, az Altair, az Antares, a Fomalhaut és a zodiákus széles figurái. Ők ezért nem kerültek egyetlen csoportba.

Ezen a napon nincs közös szakasz: Merkúr, Orionidák, Leonidák, Canopus, Achernar, Hadar, Acrux, Mimosa, Regulus, Adhara, Gacrux, Miaplacidus, Kanópusz, Ízisz, Anuket, a kakas, a Rák, az Oroszlán a hölggyel és a Kígyó a hollóval.

Kérdés
Vizsgáld meg ugyanezzel a feltételekkel az i. e. 104-től i. sz. 20-ig tartó idősávot. Készíts belőle jelentést, statisztikát, keresd meg a legpontosabb találati évet és napot.

Válasz
I. e. 104. január 1. és i. sz. 20. december 31. között, Dendera szélességén. Találat, ha a láthatósági ív legalább 90%-a egy sűrűségi sávban ül. A pontosság az ív közepének távolsága a csúcstól. A csúcsnak nincs iránya, a 180°-kal szemközti vége is számít.

A legpontosabb nap i. e. 15. november 17. A Mars íve 3,6°, teljesen a fuga 108°-os sávjában, közepe 107,99°, a csúcstól 0,01°. Közel ilyen pontos, hosszabb ívvel: i. e. 75. március 2., a Vénusz, 8,1°-os ív, 0,07°-ra a 108°-os csúcstól.

Sávban töltött nap és a legjobb nap: Mars 10 865 nap, 0,01°. Vénusz 18 865 nap, 0,07°. SN 1054 8 698 nap, i. e. 49. május 5., 0,11°. Elnath és a Bika 12 390 nap, i. e. 104. április 2., 0,57°. Geminidák 12 079 nap, i. e. 91. július 2., 0,64°. Szíriusz 6 143 nap, i. sz. 7. július 16., 0,94°. Procyon és Szatet 2 545 nap, i. e. 61. július 12., 0,99°. Alkaid 10 055 nap, legjobbja is 8,0°. Castor 11,5°, Pollux és az Ikrek 15,1°. I. e. 54. július 16-án a Szíriusz 1,05°-ra volt a 108°-os csúcstól.

Kérdés
Nézd meg, ezek az eredmények jobbak vagy rosszabbak egy statisztikai véletlen egyezésnél.

Válasz
Nem jobbak. A négy csúcsot együtt körbeforgattam, 360 véletlen padlóirányt néztem, 414 045 éjszakán. A legkisebb eltérés 0,00°, a véletlen irányok kétharmada ugyanilyet ad, a valószínűsége 0,67. Az átlagos eltérés 10,2° a véletlen 12,8° ellenében, valószínűség 0,22. Az 1°-on belüli éjszakák 21 322 a véletlen 18 403 ellenében, valószínűség 0,33. Egyenletes iránynál az éjszakák 4,4%-a esik 1°-on belülre, itt 5,2%, és ez sem ritka. Az SN 1054 a legjobb egyedi eset, valószínűség 0,05, de tíz objektumnál egy ilyen határeset várható. A Szíriusznál a forgatások 78%-a közelebb van, mint a mostani padló.

Kérdés
Nézd meg ugyanezt a téli napfordulóra.

Válasz
A téli napfordulón sem jobb a véletlennél. I. e. 104. és i. sz. 20. között a napforduló december 22-ére vagy 23-ára esik, a Nap deklinációja −23,7°. Csak a rövid láthatósági ív számít iránynak. 671 ilyen éjszakán az átlagos eltérés 8,3°, a véletlen padlóé 12,8°, a valószínűség 0,09. Az 1°-on belüli éjszakák valószínűsége 0,24.

A napfordulós irányok: Castor 316°, 2,4°-ra az átló 138° másik végétől. Szíriusz 195°, 3,4°-ra a fuga 18° másik végétől, minden ilyen éjszakán a sávban, de nem a csúcson. Pollux 314°, 3,6°. Alkaid 32°, 13,6°. A Vénusz és a Mars évről évre máshol jár, a legjobb napjuk is 18–20°. A Castor 124 napfordulóból 29-ben van 1°-on belül, valószínűség 0,09.

Kérdés
Vizsgáld meg fordítva. Milyen események esnek a csúcsra, függetlenül az időponttól.

Válasz
A kelés és a nyugvás iránya Denderán csak a deklinációtól függ, a dátum csak az órát változtatja. Két esemény ül csúcson, i. e. 54 körül.

Fuga 108°: a Szíriusz kelése. Deklinációja −16,00°, a 108°-hoz −16,10° kell. Iránya 107,9°, eltérés 0,12°.
Átló 81°: a Procyon kelése, a zodiákuson a Szatet és Hathor tehene. Deklinációja +8,07°, a kellő érték +8,08°. Iránya 81,0°, eltérés 0,00°.

A tengely másik vége nem ugyanannak a csillagnak a lenyugvása. A Szíriusz 252°-on, a Procyon 279°-on nyugszik. Az átló 138° másik végéhez, 318°-hoz a Capella nyugvása van a legközelebb, 316,6°, 1,4°-ra. A fuga 18° csak egy +58,6°-os csillag kelése lehetne. Ilyen fényes csillag nincs, a Göncölszekér le sem nyugszik. A Nap és a Hold sem esik csúcsra. A legközelebbi holdesemény a kis holdállás déli kelése, 110,8°, 2,8°-ra a 108°-tól.

Kérdés
Procyon és Szíriusz. Koncentrálj erre a két csillagra, nézd meg, milyen összefüggéseket találsz a csúcsok és a két csillag sajátmozgása között, vizsgálj nagy időtartamot.

Válasz
A két csúcsra esés csak a sajátmozgással jön létre, és éppen a templom kora körül tart. A precesszió egymagában nem teszi rá őket.

Mindkét csillag gyorsan mozog: a Szíriusz 1,34″-et, a Procyon 1,26″-et évente, dél-délnyugat felé. Évszázadonként ez 0,04°-ot húz a kelésükön, a precesszióval ellentétes irányba.

Szíriusz, fuga 108°. Sajátmozgással pontosan i. e. 185-ben és i. sz. 1471-ben. Fél fokon belül i. e. 592-től i. sz. 1877-ig, 2469 évig. Sajátmozgás nélkül a legközelebbi i. sz. 987, 0,06°-ra, és a félfokos ablak csak i. sz. 141-ben nyílik.

Procyon, átló 81°. Sajátmozgással pontosan i. e. 162-ben és i. e. 87-ben. Fél fokon belül i. e. 960-tól i. sz. 711-ig, 1671 évig. Sajátmozgás nélkül soha nem ér fél fokon belülre, a legközelebbi is 0,71°. A precesszió a kelését −0,029°-kal viszi évszázadonként, a sajátmozgás +0,039°-kal, ezért a csúcson időzik.

Együtt i. e. 183-ban mindkettő a saját csúcsán áll: a Szíriusz 108,00°, a Procyon 81,00°. Mindkettő fél fokon belül i. e. 592-től i. sz. 711-ig, 1303 évig. I. e. 54 benne van ebben: a Szíriusz 0,12°-ra, a Procyon 0,00°-on. A lenyugvásuk nem a tengely másik vége.

Kérdés
Vizsgáld meg, hogy a kövek fugáinak és átlóinak orientációja, hossza, szögei összefüggésbe hozhatók-e a két csillag sajátmozgásával, és a két sajátmozgás valamilyen elv mentén összekapcsolható-e. Van-e közvetlen kapcsolat a két csillag mozgásából számítható eredmények között. Nézd meg, ha a két mozgás adatait összekötjük valamilyen függvény szerint, az eredmény tükrözhet-e a padlóban látható matematikai eredménnyel korrelációt.

Válasz
A két sajátmozgás különbsége ráül az átlócsúcsra. A többi összekapcsolás nem ül rá semmire a padlón.

A Szíriusz évente 1,34″-et mozdul, iránya északról kelet felé 204°, irány nélkül 24,1°. A Procyon 1,26″-et, iránya 215°, irány nélkül 34,7°. A két vektor 10,7°-ot zár be, a sebességük aránya 1,06. Mindkettő dél-délnyugat felé halad, majdnem együtt: az egymáshoz képesti mozgás csak 0,25″ évente.

Szíriusz sajátmozgása 24,1°, a fuga 18°-tól 6,1°.
Procyon sajátmozgása 34,7°, a fuga 18°-tól 16,7°.
A kettő összege 29,2°, a fuga 18°-tól 11,2°.
A kettő felezője 29,4°, a fuga 18°-tól 11,4°.
Az összekötő egyenesük 32,5°, a fuga 18°-tól 14,5°.
A kettő különbsége 137,9°, az átló 138°-tól 0,1°.

A különbség a Procyon mozgása mínusz a Szíriusz mozgása. Az átlók hosszal súlyozott, simított csúcsa 137,8°. A fugáknál ugyanez az irány üres, a fuga hossza ott a teljes hossz 0,01%-a. Az átlóknál a csúcs körüli vonalak hosszabbak, 132 pixel a többi 111 pixelével szemben, de ez a csúcs maga, nem külön szabály.

A 10,7°-os közbezárt szög nem padlószög. A csúcsok távolságai 27°, 30°, 57°, 60°, 63° és 90°. A sebességarány, 1,06, közel van a két átlócsúcs hosszarányához, az 1,04-hez, de két szám hasonlósága nem összefüggés.

Egy véletlen irány 0,1°-on belülre esése ettől az egy tengelytől körülbelül 1 az 1000-hez. A sajátmozgás hibája körülbelül 0,4°-ot bizonytalanít az irányon, ezért a különbség iránya a 138°-os átlócsúcson van, nem századfokra azonos.

Ez szögszámok egyezése. A sajátmozgás szöge az égi északhoz van mérve, a padlóéle a földi északhoz. A kettő ugyanúgy van számozva, de nem ugyanaz a sík, ezért a csillag nem a padló átlója mentén halad a horizonton.

Kérdés
Hány szegélykő maradt ki, ahol nincs egyezés?

Válasz
65 szegélykő van. A szigorú vizsgálat csak a legalább 350 pixeles átlókra ment. Ilyen 8 kövön van: K28, K29, K30, K61, K62, K63, K64 és K65.

0,02°-on belül, a zodiákus csillagaival, mind a nyolcnak van párhuzamos vagy merőleges párja. Közülük egy sem maradt ki.

A fényes csillagok szűkebb listáján 4 maradt ki: K29, K30, K62 és K63. A K63 a menüben ettől még szerepel, mert a zodiákus-párokkal egyezik.

A többi 57 szegélykőnek nincs ilyen hosszú átlója, ezért nem került bele az összevetésbe.

Kérdés
Legyél megengedőbb. Vizsgáld meg az összes szegélykövet kevésbé szigorú szabályokkal, nézd meg, találsz-e egyezést. Az eredményről készíts statisztikát.

Válasz
I. e. 54, Dendera. Minden szegélykő minden átlója számít, a rövid is. A vonal a két csillag kelési pontját vagy a két nyugvási pontját köti össze, ha a két pont legalább 8°-ra van egymástól. Egyezés a párhuzam vagy a merőleges. A fényes csillag 30, plusz a Szíriusz: 770 ilyen vonal.

Mind a 65 kő egyezik. A legrosszabb is 0,10°-on belül van, a K5. 0,5°-on belül mind a 65. 0,05°-on belül 57. 0,02°-on belül 27. A medián, a kő legjobb átlójára, 0,023°. Ha csak a leghosszabb átló számít, a medián 0,041°, és 0,05°-on belül 40 kő van.

Ez nem szorosabb, mint a véletlen. A 770 vonalat együtt elforgattam, 400-szor. Az elforgatott ég mediánja 0,019°, a valódi 0,023°. Annak az esélye, hogy a véletlen legalább ilyen közel legyen, 0,80. A leghosszabb átlónál ugyanez 0,40. A 0,05°-on belüli 57 kő az elforgatás mediánja, 54, körül van, p = 0,23.

A zodiákus 415 kelő-nyugvó csillaga 142 812 vonalat ad. Ekkora halmaznál mind a 65 kő századfokon belülre esik, a medián 0,000°. Ez a vonalak száma, nem a padló.

A lazább szabály tehát minden kövön talál egyezést, és a statisztika szerint ez a találatszám a véletlentől várható.`}</pre>
        </details>
      </section>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {follow !== "none" ? (
          <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-4 py-2">
            <span className="text-sm font-extrabold">Mozgás</span>
            <span ref={motionClockRef} className="min-w-14 text-sm font-extrabold tabular-nums">{clockLabel(sunAzRef.current)}</span>
            <button type="button" onClick={() => { motionPauseRef.current = !motionPauseRef.current; setMotionPause(motionPauseRef.current); }} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${motionPause ? "bg-stone-900 text-white" : "border border-stone-900"}`}>{motionPause ? "Indítás" : "Megállítás"}</button>
            <button type="button" onClick={() => { const steps = [0.1, 0.25, 0.5, 1, 2, 4, 8]; const index = Math.max(0, steps.indexOf(motionRateRef.current) - 1); motionRateRef.current = steps[index]; setMotionRate(steps[index]); }} className="rounded-lg border border-stone-900 px-3 py-1.5 text-sm font-semibold">Lassítás</button>
            <span className="min-w-10 text-sm font-semibold tabular-nums">{String(motionRate).replace(".", ",")}×</span>
            <button type="button" onClick={() => { const steps = [0.1, 0.25, 0.5, 1, 2, 4, 8]; const index = Math.min(steps.length - 1, Math.max(0, steps.indexOf(motionRateRef.current)) + 1); motionRateRef.current = steps[index]; setMotionRate(steps[index]); }} className="rounded-lg border border-stone-900 px-3 py-1.5 text-sm font-semibold">Gyorsítás</button>
            <button type="button" onClick={() => { sunAzRef.current = (((sunAzRef.current - 3.75) % 360) + 360) % 360; if (motionClockRef.current) motionClockRef.current.textContent = clockLabel(sunAzRef.current); drawRef.current(); }} className="rounded-lg border border-stone-900 px-3 py-1.5 text-sm font-semibold">−15 perc</button>
            <button type="button" onClick={() => { sunAzRef.current = (((sunAzRef.current + 3.75) % 360) + 360) % 360; if (motionClockRef.current) motionClockRef.current.textContent = clockLabel(sunAzRef.current); drawRef.current(); }} className="rounded-lg border border-stone-900 px-3 py-1.5 text-sm font-semibold">+15 perc</button>
            <button type="button" onClick={() => { motionDirRef.current = -motionDirRef.current; setMotionDir(motionDirRef.current); }} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${motionDir < 0 ? "bg-stone-900 text-white" : "border border-stone-900"}`}>{motionDir < 0 ? "Irány: vissza" : "Fordított irány"}</button>
            <button type="button" onClick={() => { sunAzRef.current = 180; if (motionClockRef.current) motionClockRef.current.textContent = clockLabel(180); drawRef.current(); }} className="rounded-lg border border-stone-900 px-3 py-1.5 text-sm font-semibold">Dél</button>
          </div>
        ) : null}
        <AltitudeBoard live={altLiveRef}>
        <div ref={floorStageRef} className={`relative min-h-0 min-w-0 flex-1 ${uploadedFit ? "overflow-hidden" : "overflow-auto"}`}>
          <button
            type="button"
            title={zoomWheel ? "A görgő nagyít. Újabb kattintás kikapcsolja." : "Nagyítás. Kattintás után a görgő is nagyít."}
            aria-label="Nagyítás"
            aria-pressed={zoomWheel}
            onClick={(event) => {
              event.stopPropagation();
              if (zoomWheelRef.current) {
                zoomWheelRef.current = false;
                setZoomWheel(false);
                return;
              }
              zoomWheelRef.current = true;
              setZoomWheel(true);
              const next = Math.min(4, Math.round((floorZoomRef.current + 0.5) * 100) / 100);
              const ratio = next / floorZoomRef.current;
              floorZoomRef.current = next;
              rulerRef.current = { ...rulerRef.current, x: rulerRef.current.x * ratio, y: rulerRef.current.y * ratio, len: rulerRef.current.len * ratio };
              setRuler({ ...rulerRef.current });
              setMarks((list) => list.map((mark) => ({ ...mark, x: mark.x * ratio, y: mark.y * ratio, len: mark.len * ratio })));
              if (rasterAnchorRef.current) {
                rasterAnchorRef.current = { x: rasterAnchorRef.current.x * ratio, y: rasterAnchorRef.current.y * ratio };
                setRasterAnchor({ ...rasterAnchorRef.current });
              }
              setFloorZoom(next);
            }}
            className={`absolute left-2 top-2 z-40 flex h-9 w-9 items-center justify-center rounded-lg border shadow ${zoomWheel ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-900"}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            {floorZoom > 1 ? <span className="absolute -bottom-1 -right-1 rounded bg-stone-900 px-1 text-[10px] leading-tight text-white">{String(floorZoom).replace(".", ",")}×</span> : null}
          </button>
          <button
            type="button"
            title={poseOn ? "Húzd a padlót az áthelyezéshez. Újabb kattintás kikapcsolja." : "Szög. Forgatás és egérrel áthelyezés."}
            aria-label="Szög"
            aria-pressed={poseOn}
            onClick={(event) => {
              event.stopPropagation();
              poseOnRef.current = !poseOnRef.current;
              setPoseOn(poseOnRef.current);
            }}
            className={`absolute left-14 top-2 z-40 flex h-9 w-9 items-center justify-center rounded-lg border shadow ${poseOn ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-900"}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 19V7h12" /><path d="M5 19l9-9" /><path d="M9 7a6 6 0 0 1 6 6" /></svg>
          </button>
          <span className="pointer-events-none absolute left-24 top-2 z-30 flex h-9 items-center whitespace-nowrap rounded-lg border border-stone-300 bg-white px-2 text-xs font-semibold tabular-nums shadow">{floorDeg.toFixed(2).replace(".", ",")}° a függőlegeshez, északhoz képest</span>
          {poseOn ? (
            <>
            <div className="absolute left-2 top-12 z-50 flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-2 py-1 shadow" onPointerDown={(event) => event.stopPropagation()}>
              <span className="text-xs font-semibold">Szög</span>
              <input type="range" min={0} max={360} step={0.01} value={floorDeg} onChange={(event) => commitAngle(Number(event.target.value))} className="w-28" />
              <input inputMode="decimal" value={floorDegText} onChange={(event) => { const text = event.target.value.replace(/[^\d,.-]/g, ""); setFloorDegText(text); if (!text.trim() || /[.,-]$/.test(text)) return; const next = Number(text.replace(",", ".")); if (!Number.isFinite(next)) return; const wrapped = Math.round(((((next % 360) + 360) % 360) * 100)) / 100; floorDegRef.current = wrapped; setFloorDeg(wrapped); applyNorthRef.current(wrapped); }} onBlur={() => setFloorDegText(floorDeg.toFixed(2).replace(".", ","))} className="w-20 rounded border border-stone-300 px-1 py-0.5 text-right text-xs tabular-nums" />
              <span className="text-xs">°</span>
            </div>
            <div className="absolute left-2 top-24 z-40 flex items-center gap-2" onPointerDown={(event) => event.stopPropagation()}>
              <button
                type="button"
                onClick={() => commitAngle(HATHOR_DEG)}
                className="flex h-9 items-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold shadow"
              >
                Dendera - Hathor
              </button>
              <span className="flex h-9 items-center rounded-lg border border-stone-300 bg-white px-2 text-xs font-semibold tabular-nums shadow">18,65°</span>
              <label className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white shadow" title="Bejelölve induláskor erre a szögre áll a kép">
                <input
                  type="checkbox"
                  checked={hathorOn}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setHathorOn(on);
                    localStorage.setItem(HATHOR_KEY, on ? "1" : "0");
                  }}
                  aria-label="Induláskor Dendera - Hathor"
                />
              </label>
            </div>
            </>
          ) : null}
          {fugaMenu ? (
            <div className="fixed z-50 min-w-56 rounded-lg border border-stone-300 bg-white py-1 text-xs shadow-lg" style={{ left: fugaMenu.x, top: fugaMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-stone-100" onClick={() => {
                const lines = fugaLinesRef.current;
                const extra = new Set(pickedFugasRef.current);
                for (const index of pickedFugasRef.current) {
                  const base = lines[index];
                  if (!base) continue;
                  lines.forEach((line, other) => {
                    if (orientGap(base[0], line[0]) > 1.5) return;
                    if (lineGap(base, line[1], line[2]) > 8 || lineGap(base, line[3], line[4]) > 8) return;
                    extra.add(other);
                  });
                }
                setPickedFugas([...extra]);
                setFugaMenu(null);
              }}>Egyenesre eső fugák</button>
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-stone-100" onClick={() => {
                const lines = fugaLinesRef.current;
                const extra = new Set(pickedFugasRef.current);
                for (const index of pickedFugasRef.current) {
                  const base = lines[index];
                  if (!base) continue;
                  lines.forEach((line, other) => {
                    if (orientGap(base[0] + 90, line[0]) > 1.5) return;
                    extra.add(other);
                  });
                }
                setPickedFugas([...extra]);
                setFugaMenu(null);
              }}>Merőleges fugák</button>
            </div>
          ) : null}
          <div
            ref={floorScrollRef}
            className={uploadedFit ? "h-full w-full overflow-auto" : "max-h-[calc(100vh-8rem)] overflow-auto"}
          >
        <div className={uploadedFit ? "flex min-h-full min-w-full items-center justify-center" : undefined}>
        <div ref={floorBoxRef} className={`relative bg-white ${poseOn ? "cursor-move" : ""}`} style={{ width: fittedPhoto ? fittedPhoto.width : `${floorZoom * 100}%`, height: fittedPhoto ? fittedPhoto.height : undefined, transform: `translate(${floorPan.x}px, ${floorPan.y}px) rotate(${floorDeg - (projectId === "dendera" || isRoofFull2(projectNameRef.current) ? PHOTO_NORTH : 0)}deg)`, transformOrigin: "center center" }} onPointerDown={(event) => {
          setToolMenu(null);
          if (!poseOnRef.current || view3d) return;
          if ((event.target as HTMLElement).closest("button, a, input")) return;
          poseDrag.current = { x: event.clientX, y: event.clientY, panX: floorPanRef.current.x, panY: floorPanRef.current.y, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={(event) => {
          const drag = poseDrag.current;
          if (!drag) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (Math.hypot(dx, dy) > 3) drag.moved = true;
          const next = { x: drag.panX + dx, y: drag.panY + dy };
          floorPanRef.current = next;
          setFloorPan(next);
        }} onPointerUp={() => { poseMoved.current = poseDrag.current?.moved ?? false; poseDrag.current = null; }} onPointerCancel={() => { poseDrag.current = null; }} onContextMenu={(event) => {
          if (!fugaPick || view3d) return;
          event.preventDefault();
          setFugaMenu({ x: event.clientX, y: event.clientY });
        }} onClick={(event) => {
          if (poseMoved.current) { poseMoved.current = false; return; }
          if (view3d || projectRef.current !== "dendera" || (!stonePick && !fugaPick)) return;
          const target = event.target as HTMLElement;
          if (target.closest("button, a")) return;
          const box = floorBoxRef.current;
          const photo = imgRef.current;
          if (!box || !photo?.naturalWidth || !box.offsetWidth || !box.offsetHeight) return;
          const rect = box.getBoundingClientRect();
          const angle = ((floorDegRef.current - (projectRef.current === "dendera" || isRoofFull2(projectNameRef.current) ? PHOTO_NORTH : 0)) * Math.PI) / 180;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const vx = event.clientX - (rect.left + rect.width / 2);
          const vy = event.clientY - (rect.top + rect.height / 2);
          const localX = vx * cos + vy * sin + box.offsetWidth / 2;
          const localY = -vx * sin + vy * cos + box.offsetHeight / 2;
          const x = (localX / box.offsetWidth) * photo.naturalWidth;
          const y = (localY / box.offsetHeight) * photo.naturalHeight;
          if (fugaPick) {
            let best = -1;
            let bestDistance = Infinity;
            fugaLinesRef.current.forEach((line, index) => {
              const distance = segmentDistance(x, y, line);
              if (distance < bestDistance) {
                bestDistance = distance;
                best = index;
              }
            });
            const tolerance = (14 * photo.naturalWidth) / Math.max(box.offsetWidth, 1);
            if (best >= 0 && bestDistance <= tolerance) {
              setPickedFugas((list) => list.includes(best) ? list.filter((index) => index !== best) : [...list, best]);
              return;
            }
          }
          if (!stonePick) return;
          let found: Stone | null = null;
          for (const item of stoneListRef.current) {
            if (!pointInOutline(x, y, stoneOutline(item))) continue;
            if (!found || item.terulet < found.terulet) found = item;
          }
          if (!found) return;
          const id = found.id;
          setPickedStones((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
        }}>
          {floorSrc ? (
            isRoofFull2(projectNameRef.current) ? (
              <div className={`relative w-full bg-white ${floorOn ? "" : "invisible"}`} style={{ aspectRatio: "4108 / 3538" }}>
                <img src={floorSrc} alt="Dendera roof" className="absolute inset-0 h-full w-full object-fill opacity-0" style={{ transform: `rotate(${180 + PHOTO_NORTH}deg)` }} />
              </div>
            ) : (
              <img src={floorSrc} alt={projectId === "dendera" ? "Számozott padló" : "Projekt kép"} className={`block bg-white ${fittedPhoto ? "h-full w-full object-contain" : "w-full"} ${floorOn ? "" : "invisible"}`} />
            )
          ) : <div className="aspect-[4108/3538] w-full bg-white" />}
          <canvas ref={glRef} className={`absolute inset-0 h-full w-full ${view3d ? "" : "hidden"}`} />
          <canvas
            ref={canvasRef}
            onPointerDown={(event) => {
              if (!view3dRef.current) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { x: event.clientX, y: event.clientY, orbit: camRef.current.orbit, tilt: camRef.current.tilt };
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag) return;
              applyCam({
                orbit: drag.orbit - (event.clientX - drag.x) * 0.28,
                tilt: drag.tilt + (event.clientY - drag.y) * 0.16,
                height: camRef.current.height,
              });
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            onClick={(event) => {
              if (view3dRef.current || !festRef.current) return;
              const canvas = event.currentTarget;
              const rect = canvas.getBoundingClientRect();
              if (!canvas.width || !rect.width) return;
              const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
              const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
              const year = Number(String(dayNumRef.current).replace(",", "."));
              const astro = Number.isInteger(year) && year >= 1 ? (eraRef.current === "ie" ? 1 - year : year) : -53;
              const hit = festivalAt(x, y, canvas.width, canvas.height, astro, Number(monthRef.current) || 7, Number(dateDayRef.current) || 16);
              if (!hit) {
                setFestNote(null);
                return;
              }
              const box = canvas.parentElement?.getBoundingClientRect() ?? rect;
              const rawLeft = event.clientX - box.left + 12;
              const rawTop = event.clientY - box.top + 12;
              setFestNote({
                ...hit,
                left: Math.max(8, Math.min(rawLeft, box.width - 300)),
                top: Math.max(8, Math.min(rawTop, box.height - 180)),
              });
            }}
            className={`absolute inset-0 h-full w-full bg-transparent ${view3d ? "cursor-grab touch-none" : spare[2] ? "cursor-pointer" : "pointer-events-none"}`}
          />
          {rasterOn ? (
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
              <svg
                className="absolute"
                width={3600 * floorZoom}
                height={3600 * floorZoom}
                style={{
                  left: rasterAnchor ? rasterAnchor.x : "50%",
                  top: rasterAnchor ? rasterAnchor.y : "50%",
                  transform: `translate(-50%, -50%) rotate(${rasterDeg}deg)`,
                }}
              >
                {Array.from({ length: Math.floor(1800 / rasterSize) + 1 }, (_, index) => index * rasterSize * floorZoom).map((at) => (
                  <g key={at}>
                    <line x1={1800 * floorZoom - at} y1={0} x2={1800 * floorZoom - at} y2={3600 * floorZoom} stroke="rgba(28,25,23,0.55)" strokeWidth={1} />
                    {at > 0 ? <line x1={1800 * floorZoom + at} y1={0} x2={1800 * floorZoom + at} y2={3600 * floorZoom} stroke="rgba(28,25,23,0.55)" strokeWidth={1} /> : null}
                    <line y1={1800 * floorZoom - at} x1={0} y2={1800 * floorZoom - at} x2={3600 * floorZoom} stroke="rgba(28,25,23,0.55)" strokeWidth={1} />
                    {at > 0 ? <line y1={1800 * floorZoom + at} x1={0} y2={1800 * floorZoom + at} x2={3600 * floorZoom} stroke="rgba(28,25,23,0.55)" strokeWidth={1} /> : null}
                  </g>
                ))}
              </svg>
              <span
                className="absolute z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-white bg-orange-700 active:cursor-grabbing"
                style={{ left: rasterAnchor ? rasterAnchor.x : "50%", top: rasterAnchor ? rasterAnchor.y : "50%", pointerEvents: "auto" }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  rasterDrag.current = true;
                  const box = floorBoxRef.current?.getBoundingClientRect();
                  if (!rasterAnchorRef.current && box) {
                    const point = { x: box.width / 2, y: box.height / 2 };
                    rasterAnchorRef.current = point;
                    setRasterAnchor(point);
                  }
                }}
                onPointerMove={(event) => {
                  if (!rasterDrag.current) return;
                  const box = floorBoxRef.current?.getBoundingClientRect();
                  if (!box) return;
                  const point = { x: event.clientX - box.left, y: event.clientY - box.top };
                  rasterAnchorRef.current = point;
                  setRasterAnchor(point);
                }}
                onPointerUp={() => { rasterDrag.current = false; }}
                onPointerCancel={() => { rasterDrag.current = false; }}
              />
            </div>
          ) : null}
          {rasterOn && (rasterLineHit || rasterCrossHit) && !view3d ? (
            <div className="pointer-events-none absolute inset-0 z-20">
              {(() => {
                void vertexStamp;
                const img = imgRef.current;
                const box = floorBoxRef.current;
                if (!img?.naturalWidth || !img.naturalHeight || !box?.clientWidth) return null;
                const width = box.clientWidth;
                const height = box.clientHeight;
                const originX = rasterAnchor ? rasterAnchor.x : width / 2;
                const originY = rasterAnchor ? rasterAnchor.y : height / 2;
                const step = Math.max(4, rasterSize * floorZoom);
                const hits = rasterHits(fugaLinesRef.current, img.naturalWidth, img.naturalHeight, width, height, originX, originY, step, rasterDeg);
                return hits.filter((hit) => (hit.cross ? rasterCrossHit : rasterLineHit)).map((hit) => (
                  <span key={`${hit.x.toFixed(1)}-${hit.y.toFixed(1)}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ left: hit.x, top: hit.y, width: hit.cross ? 10 : 8, height: hit.cross ? 10 : 8, background: hit.cross ? "#dc2626" : "#ca8a04" }} />
                ));
              })()}
            </div>
          ) : null}
          {rasterPick ? (
            <div
              className="absolute inset-0 z-30 cursor-crosshair"
              onClick={(event) => {
                const box = floorBoxRef.current?.getBoundingClientRect();
                if (!box) return;
                const point = { x: event.clientX - box.left, y: event.clientY - box.top };
                rasterAnchorRef.current = point;
                setRasterAnchor(point);
                setRasterPick(false);
              }}
            />
          ) : null}
          {marks.map((mark) => {
            const span = mark.len + 16;
            const size = span * 2;
            return (
              <svg
                key={mark.id}
                className="absolute z-[35]"
                width={size}
                height={size}
                viewBox={`${-span} ${-span} ${size} ${size}`}
                style={{ left: mark.x, top: mark.y, transform: "translate(-50%, -50%)", pointerEvents: "none" }}
              >
                <g
                  transform={`rotate(${mark.deg})`}
                  style={{ pointerEvents: "auto" }}
                  onPointerEnter={() => { hotMarkRef.current = mark.id; setHotMark(mark.id); }}
                  onPointerLeave={() => { if (hotMarkRef.current === mark.id) { hotMarkRef.current = null; setHotMark(null); } }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    hotMarkRef.current = mark.id;
                    setHotMark(mark.id);
                    const box = floorBoxRef.current?.getBoundingClientRect();
                    if (!box) return;
                    setToolMenu({ kind: "line", id: mark.id, x: event.clientX - box.left, y: event.clientY - box.top });
                  }}
                >
                  <line x1="0" y1={-mark.len} x2="0" y2={mark.len} stroke="rgba(0,0,0,0.01)" strokeWidth="22" pointerEvents="stroke" />
                  <line x1="0" y1={-mark.len} x2="0" y2={mark.len} stroke={hotMark === mark.id ? "#c2410c" : "#1c1917"} strokeWidth={hotMark === mark.id ? 3 : 2} style={{ pointerEvents: "none" }} />
                </g>
              </svg>
            );
          })}
          {rulerOn ? (
            <svg
              className="absolute z-30 touch-none select-none"
              width={(ruler.len + 80) * 2}
              height={(ruler.len + 80) * 2}
              viewBox={`${-(ruler.len + 80)} ${-(ruler.len + 80)} ${(ruler.len + 80) * 2} ${(ruler.len + 80) * 2}`}
              style={{ left: ruler.x, top: ruler.y, transform: "translate(-50%, -50%)", pointerEvents: "none" }}
              ref={rulerSvgRef}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerMove={(event) => {
                const drag = rulerDrag.current;
                if (!drag) return;
                if (drag.mode === "move") {
                  rulerRef.current = { ...rulerRef.current, x: drag.x + event.clientX - drag.px, y: drag.y + event.clientY - drag.py };
                } else {
                  const box = floorBoxRef.current?.getBoundingClientRect();
                  if (!box) return;
                  const dx = event.clientX - (box.left + rulerRef.current.x);
                  const dy = event.clientY - (box.top + rulerRef.current.y);
                  if (dx * dx + dy * dy < 36) return;
                  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
                  if (drag.flip) deg += 180;
                  deg = ((deg + 180) % 360 + 360) % 360 - 180;
                  const len = drag.mode === "size" ? Math.max(48, Math.min(900, Math.hypot(dx, dy))) : rulerRef.current.len;
                  rulerRef.current = { ...rulerRef.current, deg, len };
                }
                setRuler({ ...rulerRef.current });
              }}
              onPointerUp={() => { rulerDrag.current = null; }}
              onPointerCancel={() => { rulerDrag.current = null; }}
            >
              <circle cx="0" cy="0" r="58" fill="transparent" stroke="#1c1917" strokeWidth="1.5" className="cursor-move" style={{ pointerEvents: "auto" }} onPointerDown={(event) => {
                event.preventDefault();
                rulerSvgRef.current?.setPointerCapture(event.pointerId);
                rulerDrag.current = { mode: "move", px: event.clientX, py: event.clientY, x: rulerRef.current.x, y: rulerRef.current.y, flip: false };
              }} />
              {Array.from({ length: 36 }, (_, index) => index * 10 - 180).map((degree) => {
                const rad = (degree * Math.PI) / 180;
                const major = degree % 30 === 0;
                return (
                  <line key={degree} x1={Math.sin(rad) * (major ? 40 : 48)} y1={-Math.cos(rad) * (major ? 40 : 48)} x2={Math.sin(rad) * 56} y2={-Math.cos(rad) * 56} stroke="#1c1917" strokeWidth={major ? 1.6 : 1} />
                );
              })}
              <text x="0" y="-62" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1c1917">0</text>
              <text x="66" y="4" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1c1917">90</text>
              <text x="-66" y="4" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1c1917">90</text>
              <g
                transform={`rotate(${ruler.deg})`}
                className="cursor-grab"
                style={{ pointerEvents: "auto" }}
                onPointerEnter={() => setRulerHot(true)}
                onPointerLeave={() => setRulerHot(false)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setRulerHot(true);
                  const box = floorBoxRef.current?.getBoundingClientRect();
                  if (!box) return;
                  setToolMenu({ kind: "ruler", id: 0, x: event.clientX - box.left, y: event.clientY - box.top });
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  rulerSvgRef.current?.setPointerCapture(event.pointerId);
                  const box = floorBoxRef.current?.getBoundingClientRect();
                  const dx = box ? event.clientX - (box.left + rulerRef.current.x) : 0;
                  const dy = box ? event.clientY - (box.top + rulerRef.current.y) : 1;
                  const aim = (Math.atan2(dx, -dy) * 180) / Math.PI;
                  const delta = ((aim - rulerRef.current.deg + 180) % 360 + 360) % 360 - 180;
                  const sizing = Math.abs(Math.hypot(dx, dy) - rulerRef.current.len) < 28;
                  rulerDrag.current = { mode: sizing ? "size" : "turn", px: event.clientX, py: event.clientY, x: rulerRef.current.x, y: rulerRef.current.y, flip: Math.abs(delta) > 90 };
                }}
              >
                <line x1="0" y1={-ruler.len} x2="0" y2={ruler.len} stroke="rgba(0,0,0,0.01)" strokeWidth="22" pointerEvents="stroke" />
                <line x1="0" y1={-ruler.len} x2="0" y2={ruler.len} stroke={rulerHot ? "#c2410c" : "#1c1917"} strokeWidth={rulerHot ? 3 : 2} style={{ pointerEvents: "none" }} />
                {Array.from({ length: 61 }, (_, index) => index - 30).filter((index) => index !== 0 && Math.abs(index * 24) < ruler.len - 8).map((index) => (
                  <line key={index} x1={index % 2 === 0 ? -11 : -6} x2={index % 2 === 0 ? 11 : 6} y1={index * 24} y2={index * 24} stroke="#1c1917" strokeWidth="1" />
                ))}
                <circle cx="0" cy={-ruler.len} r="9" fill="transparent" stroke="#1c1917" strokeWidth="2" />
                <circle cx="0" cy={ruler.len} r="9" fill="transparent" stroke="#1c1917" strokeWidth="2" />
              </g>
              <circle
                cx="0"
                cy="0"
                r="16"
                fill="transparent"
                stroke="#1c1917"
                strokeWidth="2"
                className="cursor-move"
                style={{ pointerEvents: "auto" }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  rulerSvgRef.current?.setPointerCapture(event.pointerId);
                  rulerDrag.current = { mode: "move", px: event.clientX, py: event.clientY, x: rulerRef.current.x, y: rulerRef.current.y, flip: false };
                }}
              />
              <text x="74" y="-4" textAnchor="start" fontSize="16" fontWeight="800" fill="#1c1917">{(() => { let tilt = ((ruler.deg % 180) + 180) % 180; if (tilt > 90) tilt -= 180; const rounded = Math.round(tilt); return `${rounded < 0 ? "−" : rounded > 0 ? "+" : ""}${Math.abs(rounded)}°`; })()}</text>
              <text x="74" y="12" textAnchor="start" fontSize="11" fill="#57534e">a függőlegestől</text>
            </svg>
          ) : null}
          {toolMenu ? (
            <div
              className="absolute z-40 min-w-36 rounded-lg border border-stone-300 bg-white py-1 shadow-lg"
              style={{ left: toolMenu.x, top: toolMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              {toolMenu.kind === "ruler" ? (
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100"
                  onClick={() => {
                    const id = markSeq.current;
                    markSeq.current += 1;
                    const here = rulerRef.current;
                    setMarks((list) => [...list, { id, x: here.x, y: here.y, deg: here.deg, len: here.len }]);
                    setToolMenu(null);
                  }}
                >
                  Vonal
                </button>
              ) : (
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100"
                  onClick={() => {
                    const id = toolMenu.id;
                    setMarks((list) => list.filter((mark) => mark.id !== id));
                    setToolMenu(null);
                  }}
                >
                  Vonal törlése
                </button>
              )}
            </div>
          ) : null}
          {spare[2] && festNote ? (
            <div className="absolute z-30 w-[min(22rem,calc(100%-16px))] rounded-xl border border-stone-300 bg-stone-50 p-4 shadow-lg" style={{ left: festNote.left, top: festNote.top }}>
              <button type="button" onClick={() => setFestNote(null)} className="absolute right-3 top-3 text-xs font-semibold text-stone-500">bezár</button>
              <p className="pr-10 text-base font-extrabold text-stone-950">{festNote.name}</p>
              <p className="mt-1 text-xs font-semibold text-stone-500">{festNote.when}</p>
              <p className="mt-2 text-sm leading-relaxed text-stone-800">{festNote.about}</p>
            </div>
          ) : null}
        </div>
          </div>
          </div>
        </div>
        </AltitudeBoard>
      </div>
      </div>
      {analOpen && typeof document !== "undefined" ? createPortal(
        <div
          className="fixed z-[90] flex flex-col overflow-hidden rounded-2xl border border-stone-300 bg-white shadow-2xl"
          style={{ left: analBox.x, top: analBox.y, width: analBox.w, height: analBox.h }}
        >
          <div
            className="flex cursor-move items-center justify-between bg-amber-500 px-3 py-2 text-stone-950"
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              const startX = event.clientX;
              const startY = event.clientY;
              const origin = analBox;
              const move = (ev: PointerEvent) => {
                setAnalBox({
                  ...origin,
                  x: Math.max(-origin.w + 64, Math.min(window.innerWidth - 64, origin.x + ev.clientX - startX)),
                  y: Math.max(-12, Math.min(window.innerHeight - 36, origin.y + ev.clientY - startY)),
                });
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          >
            <div>
              <p className="text-sm font-extrabold">Elemzés</p>
              <p className="text-[11px] font-semibold">{analNote}</p>
            </div>
            <button type="button" onClick={() => setAnalOpen(false)} className="rounded-lg bg-stone-950 px-2 py-1 text-xs font-semibold text-white">Bezár</button>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[168px_220px_1fr] gap-2 overflow-hidden p-2">
            <section className="overflow-auto">
              {ANAL_GROUPS.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    setAnalOn((on) => ({ ...on, [group.id]: !on[group.id] }));
                    drawRef.current();
                  }}
                  className="mb-1 flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-[11px] font-bold"
                  style={analOn[group.id] ? { background: group.color, color: "#fff", borderColor: group.color } : { borderColor: "#d6d3d1", color: "#44403c" }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: analOn[group.id] ? "#fff" : group.color }} />
                  {group.name}
                </button>
              ))}
              <p className="mt-1 rounded border border-stone-200 bg-stone-50 px-2 py-1 text-[10px] leading-4 font-medium text-stone-700">A Láthatóság szűrő, nem eredmény. Bekapcsolva csak az kerül találatba, ami Denderából a keléskor látszik: csillagnál és bolygónál a Nap legalább 8°-kal a horizont alatt van, a Holdnál a Nap nincs a horizont fölött. A Nap mindig bent marad. Kikapcsolva a nappali kelés is számít. Átkapcsolás után újra kell szkennelni.</p>
            </section>
            <section className="flex flex-col gap-1 overflow-auto text-[11px]">
              {(["ev", "evtized", "negy", "hosszu"] as const).map((band) => (
                <button key={band} type="button" onClick={() => fillBand(band)} className={`rounded border px-2 py-1 text-left font-bold ${analBand === band ? "border-amber-600 bg-amber-100" : "border-stone-200"}`}>{analBandLabel(band)}</button>
              ))}
              <button type="button" onClick={() => { void runAnal(false); }} className="mt-1 rounded bg-stone-900 px-2 py-1 font-bold text-white">Erre a napra</button>
              <button type="button" onClick={() => { void runAnal(true); }} className="rounded bg-amber-500 px-2 py-1 font-bold text-stone-950">Időszkenel</button>
              <div className="rounded border border-amber-300 bg-amber-50 p-1">
                <p className="font-extrabold">Kezdődik</p>
                <div className="mt-0.5 flex gap-1">
                  <button type="button" onClick={() => setAnalFromEra("ie")} className={`rounded px-1.5 py-0.5 font-bold ${analFromEra === "ie" ? "bg-stone-900 text-white" : "border border-stone-300"}`}>i. e.</button>
                  <button type="button" onClick={() => setAnalFromEra("isz")} className={`rounded px-1.5 py-0.5 font-bold ${analFromEra === "isz" ? "bg-stone-900 text-white" : "border border-stone-300"}`}>i. sz.</button>
                  <input value={analFromText} onChange={(event) => setAnalFromText(event.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className="w-14 rounded border border-stone-300 px-1 py-0.5" />
                </div>
                <p className="mt-1 font-extrabold">Végződik</p>
                <div className="mt-0.5 flex gap-1">
                  <button type="button" onClick={() => setAnalToEra("ie")} className={`rounded px-1.5 py-0.5 font-bold ${analToEra === "ie" ? "bg-stone-900 text-white" : "border border-stone-300"}`}>i. e.</button>
                  <button type="button" onClick={() => setAnalToEra("isz")} className={`rounded px-1.5 py-0.5 font-bold ${analToEra === "isz" ? "bg-stone-900 text-white" : "border border-stone-300"}`}>i. sz.</button>
                  <input value={analToText} onChange={(event) => setAnalToText(event.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className="w-14 rounded border border-stone-300 px-1 py-0.5" />
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <button type="button" onClick={() => setAnalDir((dir) => -dir)} className="rounded border border-stone-300 px-2 py-1 font-bold">{analDir < 0 ? "Vissza" : "Előre"}</button>
                <button type="button" onClick={() => {
                  const span = analSpanRef.current;
                  const next = analCursorRef.current + analDirRef.current * span.step;
                  const edge = Math.max(span.from, Math.min(span.to, next));
                  setAnalPlay(false);
                  setAnalPick(null);
                  setAnalCursor(edge);
                  drawRef.current();
                }} className="rounded border border-stone-300 px-2 py-1 font-bold">Lépés</button>
                <button type="button" onClick={() => setAnalPlay((play) => !play)} className={`rounded px-2 py-1 font-bold text-white ${analPlay ? "bg-rose-600" : "bg-emerald-700"}`}>{analPlay ? "Megállítás" : "Indítás"}</button>
                <button type="button" onClick={() => setAnalPace((pace) => pace >= 4 ? 1 : pace * 2)} className="rounded border border-stone-300 px-2 py-1 font-bold">{analPace}×</button>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  const span = chosenSpan();
                  analSpanRef.current = span;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const pct = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
                  const year = Math.round(span.from + pct * (span.to - span.from));
                  setAnalPlay(false);
                  setAnalPick(null);
                  setAnalCursor(year);
                  drawRef.current();
                }}
                className="relative mt-1 h-8 rounded bg-stone-100"
              >
                {analHits.filter((hit) => analOn[hit.group]).map((hit) => {
                  const span = chosenSpan();
                  const width = Math.max(1, span.to - span.from);
                  const left = ((hit.year - span.from) / width) * 100;
                  return <span key={`${hit.group}-${hit.year}-${hit.name}-${hit.kind}`} className="absolute top-1 h-4 w-px" style={{ left: `${left}%`, background: hit.kind === "fuga" ? "#f5c400" : "#7c3aed" }} />;
                })}
                {(() => {
                  const span = chosenSpan();
                  const width = Math.max(1, span.to - span.from);
                  const left = ((analCursor - span.from) / width) * 100;
                  return <span className="absolute top-0 h-full w-0.5 bg-stone-950" style={{ left: `${Math.min(100, Math.max(0, left))}%` }} />;
                })()}
              </button>
              <p className="font-semibold">{yearText(analCursor)}</p>
              <label className="flex items-center gap-1 font-semibold">
                <input type="checkbox" checked={analCompare} onChange={() => setAnalCompare((on) => !on)} />
                Másik projekt
              </label>
            </section>
            <section className="min-h-0 overflow-auto">
              {ANAL_GROUPS.filter((group) => group.role !== "szuro").map((group) => {
                const own = analHits.filter((hit) => hit.group === group.id);
                const verdict = analVerdict(group.id, analHits, projectId);
                const otherProject = projectId === "dendera" ? "dendera-roof" : "dendera";
                const otherVerdict = analVerdict(group.id, analHits, otherProject);
                const years = [...new Set(own.map((hit) => hit.year))].sort((a, b) => a - b);
                const best = [...own].sort((a, b) => a.gap - b.gap)[0];
                const tone = verdict.tone === "fuga"
                  ? { background: "#f5c400", color: "#1c1917" }
                  : verdict.tone === "atlo"
                    ? { background: "#7c3aed", color: "#fff" }
                    : verdict.tone === "both"
                      ? { backgroundImage: "linear-gradient(90deg,#f5c400 0 50%,#7c3aed 50% 100%)", color: "#1c1917" }
                      : verdict.tone === "count"
                        ? { background: "#e0f2fe", color: "#0c4a6e" }
                        : verdict.tone === "miss"
                          ? { background: "#e7e5e4", color: "#57534e" }
                          : { background: "#fafaf9", color: "#44403c" };
                return (
                  <div key={group.id} className={`mb-1 flex items-start gap-1 ${analOn[group.id] ? "" : "opacity-40"}`}>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setAnalExplain(analExplain === group.id ? null : group.id)}
                        className="block w-full rounded border border-stone-200 px-2 py-1 text-left"
                        style={tone}
                      >
                        <span className="block text-[11px] font-extrabold">{group.name} · {verdict.text}</span>
                        <span className="block text-[10px] font-semibold">{years.length ? `${years.length} év, ${yearText(years[0])} – ${yearText(years[years.length - 1])}` : imageCounts(projectId).note}</span>
                        {analCompare ? <span className="block text-[10px] font-semibold">{otherProject === "dendera" ? "Dendera-Hathor" : "Dendera roof"}: {otherVerdict.text}</span> : null}
                      </button>
                      {analExplain === group.id ? (
                        <p className="rounded-b border border-t-0 border-stone-300 bg-white px-2 py-1.5 text-[11px] leading-4 font-medium text-stone-800">{analText(group.id, verdict.tone, best, projectId)}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      {(["fuga", "atlo"] as const).filter((kind) => own.some((hit) => hit.kind === kind)).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => {
                            const hit = [...own].filter((item) => item.kind === kind).sort((a, b) => a.gap - b.gap)[0];
                            const on = analFloorRef.current.some((item) => item.group === group.id && item.kind === kind);
                            const next = on
                              ? analFloorRef.current.filter((item) => !(item.group === group.id && item.kind === kind))
                              : [...analFloorRef.current, { group: group.id, kind }];
                            analFloorRef.current = next;
                            setAnalFloor(next);
                            setAnalPlay(false);
                            if (!on && hit) {
                              analPickRef.current = hit;
                              analCursorRef.current = hit.year;
                              setAnalPick(hit);
                              setAnalCursor(hit.year);
                            }
                            drawRef.current();
                          }}
                          className={`rounded px-2 py-1 text-[10px] font-extrabold ${analFloor.some((item) => item.group === group.id && item.kind === kind) ? "bg-stone-950 text-white" : kind === "fuga" ? "bg-[#f5c400] text-stone-950" : "bg-[#7c3aed] text-white"}`}
                        >
                          {kind === "fuga" ? "Fuga a padlón" : "Átló a padlón"}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
          <button
            type="button"
            aria-label="Ablak méretezése"
            className="absolute bottom-1 right-1 h-5 w-5 cursor-nwse-resize border-b-2 border-r-2 border-stone-500"
            onPointerDown={(event) => {
              event.preventDefault();
              const startX = event.clientX;
              const startY = event.clientY;
              const origin = analBox;
              const move = (ev: PointerEvent) => {
                setAnalBox({
                  ...origin,
                  w: Math.max(640, Math.min(window.innerWidth - origin.x - 8, origin.w + ev.clientX - startX)),
                  h: Math.max(280, Math.min(window.innerHeight - origin.y - 8, origin.h + ev.clientY - startY)),
                });
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
        </div>,
        document.body,
      ) : null}
      {conjOpen && typeof document !== "undefined" ? createPortal(
        <div
          className="fixed z-[90] flex flex-col overflow-hidden rounded-2xl border border-stone-300 bg-white shadow-2xl"
          style={{ left: conjBox.x, top: conjBox.y, width: conjBox.w, height: conjBox.h }}
        >
            <div
              className="flex cursor-move items-center justify-between bg-amber-500 px-4 py-3 text-stone-950"
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest("button")) return;
                const startX = event.clientX;
                const startY = event.clientY;
                const origin = conjBox;
                const move = (ev: PointerEvent) => {
                  const width = window.innerWidth;
                  const height = window.innerHeight;
                  setConjBox({
                    ...origin,
                    x: Math.max(-origin.w + 64, Math.min(width - 64, origin.x + ev.clientX - startX)),
                    y: Math.max(-12, Math.min(height - 36, origin.y + ev.clientY - startY)),
                  });
                };
                const up = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
            >
              <div>
                <p className="text-lg font-extrabold">Együttállás</p>
                <p className="text-xs font-semibold">A teljes menü egy helyen. A színes sor a fugasávba vagy az átlósávba esik.</p>
              </div>
              <button type="button" onClick={() => setConjOpen(false)} className="rounded-lg bg-stone-950 px-3 py-1.5 text-sm font-semibold text-white">Bezár</button>
            </div>
            <div className="grid min-h-0 flex-1 gap-2 overflow-auto p-3 md:grid-cols-[200px_210px_380px]">
              <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-amber-900">Időtartomány</p>
                {([
                  ["now", "Aktuális idő", "bg-amber-500 text-stone-950", "bg-white text-amber-950 border-amber-300"],
                  ["year", "Aktuális év", "bg-sky-600 text-white", "bg-white text-sky-950 border-sky-300"],
                  ["span", "i. e. 200 – i. sz. 200", "bg-indigo-700 text-white", "bg-white text-indigo-950 border-indigo-300"],
                ] as const).map(([mode, label, on, off]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => { void runConjunction(mode); }}
                    className={`mt-2 block w-full rounded-lg border px-3 py-2 text-left text-sm font-bold ${conjMode === mode ? on : off}`}
                  >
                    {label}
                  </button>
                ))}
                <p className="mt-3 text-[11px] leading-4 text-amber-950">Nap, Hold, szabad szemmel látható bolygók és a fényes csillagok. A kapcsolóktól független.</p>
              </section>
              <section className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-stone-700">Megjelenítés</p>
                <label className={`mt-2 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${conjFuga ? "border-amber-500 bg-[#f5c400] text-stone-950" : "border-amber-200 bg-white text-stone-800"}`}>
                  <input type="checkbox" checked={conjFuga} onChange={() => { const next = !conjFuga; conjFugaRef.current = next; setConjFuga(next); drawRef.current(); }} className="h-4 w-4" />
                  Fugasáv
                </label>
                <label className={`mt-2 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${conjAtlo ? "border-violet-700 bg-[#7c3aed] text-white" : "border-violet-200 bg-white text-stone-800"}`}>
                  <input type="checkbox" checked={conjAtlo} onChange={() => { const next = !conjAtlo; conjAtloRef.current = next; setConjAtlo(next); drawRef.current(); }} className="h-4 w-4" />
                  Átlósáv
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const next = !conjEye;
                    conjEyeRef.current = next;
                    setConjEye(next);
                    const list = next ? conjRows.filter(nakedFromDendera) : conjRows;
                    setConjPlay(false);
                    setConjIndex(0);
                    if (list[0]) void showConj(list[0]);
                    else {
                      conjMarkRef.current = null;
                      drawRef.current();
                    }
                  }}
                  className={`mt-2 w-full rounded-lg border px-3 py-2 text-left text-sm font-bold ${conjEye ? "border-teal-800 bg-teal-700 text-white" : "border-teal-200 bg-white text-teal-950"}`}
                >
                  Denderából látható
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !conjArcs;
                    conjArcRef.current = next;
                    setConjArcs(next);
                    drawRef.current();
                  }}
                  className={`mt-2 w-full rounded-lg border px-3 py-2 text-left text-sm font-bold ${conjArcs ? "border-orange-800 bg-orange-600 text-white" : "border-orange-200 bg-white text-orange-950"}`}
                >
                  Látható ívek együtt
                </button>
                <p className="mt-3 text-[11px] leading-4 text-stone-600">Denderából: csillag és bolygó legalább 2° magasan, a Nap legalább 8°-kal a horizont alatt. A Hold nappal is, ha nincs a Nap mellett.</p>
              </section>
              <section className="flex min-h-0 max-h-full flex-col rounded-xl border border-stone-200 bg-white p-2">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-stone-700">Lista · {eyeRows.length}</p>
                  <button
                    type="button"
                    onClick={() => setConjPlay((play) => !play)}
                    className={`rounded px-2 py-0.5 text-[11px] font-bold ${conjPlay ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"}`}
                  >
                    {conjPlay ? "Megállítás" : "Indítás"}
                  </button>
                </div>
                {conjNote ? <p className="mt-1 text-[10px] leading-3 text-stone-600">{conjNote}</p> : null}
                {conjEye && conjRows.length && !eyeRows.length ? <p className="mt-1 text-[10px] text-stone-600">Nincs látható együttállás.</p> : null}
                <div className="mt-1 min-h-0 flex-1 overflow-auto">
                  {eyeRows.map((row, index) => {
                    void bandStamp;
                    const fugaBands = histBinsRef.current ? roseBands(histBinsRef.current) : [];
                    const atloBands = atloHistBinsRef.current ? roseBands(atloHistBinsRef.current) : [];
                    const inFuga = pairHitsBand(row.azs[0], row.azs[1], fugaBands);
                    const inAtlo = pairHitsBand(row.azs[0], row.azs[1], atloBands);
                    const tint = inFuga && inAtlo
                      ? { backgroundImage: "linear-gradient(90deg, #f5c400 0%, #f5c400 50%, #7c3aed 50%, #7c3aed 100%)", color: "#1c1917", textShadow: "0 0 3px #fff" }
                      : inFuga
                        ? { backgroundColor: "#f5c400", color: "#1c1917" }
                        : inAtlo
                          ? { backgroundColor: "#7c3aed", color: "#fff" }
                          : undefined;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => { setConjPlay(false); setConjIndex(index); void showConj(row); }}
                        style={tint}
                        className={`mb-0.5 block w-full whitespace-nowrap rounded border px-1.5 py-0.5 text-left text-[10px] font-semibold leading-3 ${index === conjIndex ? "ring-2 ring-stone-950" : "border-stone-200"} ${tint ? "" : "bg-stone-50 text-stone-800 hover:bg-amber-50"}`}
                      >
                        {row.title} · {row.gap.toFixed(1).replace(".", ",")}°
                        {conjMode === "now" ? "" : ` · ${row.era === "ie" ? "i. e." : "i. sz."} ${row.year}. ${row.month}. ${row.day}.`}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
            <button
              type="button"
              aria-label="Ablak méretezése"
              title="Húzd a méretezéshez"
              className="absolute bottom-1 right-1 h-5 w-5 cursor-nwse-resize rounded-sm border-b-2 border-r-2 border-stone-500"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const startX = event.clientX;
                const startY = event.clientY;
                const origin = conjBox;
                const move = (ev: PointerEvent) => {
                  setConjBox({
                    ...origin,
                    w: Math.max(480, Math.min(window.innerWidth - origin.x - 8, origin.w + ev.clientX - startX)),
                    h: Math.max(260, Math.min(window.innerHeight - origin.y - 8, origin.h + ev.clientY - startY)),
                  });
                };
                const up = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
            />
          </div>,
        document.body,
      ) : null}
    </figure>
  );
}

function Home() {
  return (
    <main className="h-dvh overflow-hidden bg-white text-stone-900">
      <FugaAnim />
    </main>
  );
}
