import catalog from "../data/zodiakus.json";
import { julianDay } from "./solar-system";

type StarRow = { hip: number; ra: number; dec: number; pmra: number; pmde: number; v: number };
type FigureRow = {
  id: string;
  nev: string;
  hint: string;
  szin: string;
  vezeto: number;
  vonalak: number[][];
  csillagok: StarRow[];
};

export const ZODIAC_META = catalog.meta;
export const ZODIAC = catalog.kepek as FigureRow[];

export type PlacedZodiac = {
  id: string;
  nev: string;
  color: string;
  vezeto: number;
  vonalak: number[][];
  csillagok: { dec: number; shift: number; v: number }[];
};

export function precess(raDeg: number, decDeg: number, year: number) {
  const jd = julianDay(year, 7, 1);
  const t = (jd - 2451545) / 36525;
  const arc = Math.PI / (180 * 3600);
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t) * arc;
  const zed = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t) * arc;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t) * arc;
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const a = Math.cos(dec) * Math.sin(ra + zeta);
  const b = Math.cos(theta) * Math.cos(dec) * Math.cos(ra + zeta) - Math.sin(theta) * Math.sin(dec);
  const c = Math.sin(theta) * Math.cos(dec) * Math.cos(ra + zeta) + Math.cos(theta) * Math.sin(dec);
  let out = Math.atan2(a, b) + zed;
  out = ((out * 180) / Math.PI) % 360;
  if (out < 0) out += 360;
  return { ra: out, dec: (Math.asin(c) * 180) / Math.PI };
}

export function moved(star: { ra: number; dec: number; pmra: number; pmde: number }, year: number) {
  const dt = year - 2000;
  const dec = (star.dec * Math.PI) / 180;
  const ra = star.ra + (star.pmra / Math.cos(dec)) * dt / 3600000;
  const de = star.dec + (star.pmde * dt) / 3600000;
  return precess(ra, de, year);
}

export function placeFixed(
  stars: { id: string; nev: string; hint: string; szin: string; ra: number; dec: number; pmra: number; pmde: number; v: number }[],
  year: number,
  raSun: number,
) {
  return stars.map((star) => {
    const at = moved(star, year);
    return {
      id: star.id,
      nev: star.nev,
      sub: star.hint,
      color: star.szin,
      v: star.v,
      dec: (at.dec * Math.PI) / 180,
      shift: ((((at.ra - raSun) % 360) + 360) % 360 * Math.PI) / 180,
    };
  });
}
export function placeZodiac(year: number, raSun: number): PlacedZodiac[] {
  return ZODIAC.map((figure) => ({
    id: figure.id,
    nev: figure.nev,
    color: figure.szin,
    vezeto: figure.vezeto,
    vonalak: figure.vonalak,
    csillagok: figure.csillagok.map((star) => {
      const at = moved(star, year);
      return {
        v: star.v,
        dec: (at.dec * Math.PI) / 180,
        shift: ((((at.ra - raSun) % 360) + 360) % 360 * Math.PI) / 180,
      };
    }),
  }));
}
