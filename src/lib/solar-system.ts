import catalog from "../data/naprendszer.json";

type Coeffs = { L: number[]; a: number[]; e: number[]; i: number[]; W: number[]; p: number[] };
type PlanetRow = Coeffs & { id: string; nev: string; hint: string; szin: string; szabadszem: boolean };

export const SOLAR_META = catalog.meta;
export const PLANET_ROWS = catalog.bolygok.filter((row) => row.szabadszem) as PlanetRow[];
const EARTH = catalog.fold as Coeffs;

export type PlanetPlace = {
  id: string;
  nev: string;
  sub: string;
  color: string;
  dec: number;
  shift: number;
  dra: number;
  ddec: number;
};

function poly(terms: number[], t: number) {
  let value = 0;
  let power = 1;
  for (const term of terms) {
    value += term * power;
    power *= t;
  }
  return value;
}

function wrap(degrees: number) {
  return ((degrees % 360) + 360) % 360;
}

export function julianDay(year: number, month: number, day: number) {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const century = Math.floor(y / 100);
  const gregorian = year > 1582 || (year === 1582 && (month > 10 || (month === 10 && day >= 15)));
  const b = gregorian ? 2 - century + Math.floor(century / 4) : 0;
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/** Dendera, Hathor-templom. A helyi dél 9,822 órával a világidő éjfél után van. */
export const SITE_LON = 32.6703;

/**
 * TT − UT, másodperc. NASA / Espenak–Meeus polinom, −500…+500 és +500…+1600.
 * Ezen kívül a Stephenson–Morrison közelítés. A pályaelemek földi időre szólnak.
 */
export function deltaTSeconds(year: number) {
  if (year >= -500 && year < 500) {
    const u = year / 100;
    return 10583.6 - 1014.41 * u + 33.78311 * u * u - 5.952053 * u ** 3 - 0.1798452 * u ** 4 + 0.0221742 * u ** 5 + 0.00903132 * u ** 6;
  }
  if (year >= 500 && year < 1600) {
    const u = (year - 1000) / 100;
    return 1574.2 - 556.01 * u + 71.23472 * u * u + 0.319781 * u ** 3 - 0.2459278 * u ** 4 - 0.000470638 * u ** 5 + 0.000079564 * u ** 6;
  }
  const u = (year - 1820) / 100;
  return -20 + 32 * u * u;
}

/** A nap helyi delének földi ideje. A Nap táblája is erre a pillanatra készült. */
export function julianDayNoon(year: number, month: number, day: number) {
  return julianDay(year, month, day) + (12 - SITE_LON / 15) / 24 + deltaTSeconds(year) / 86400;
}

function elements(body: Coeffs, jd: number) {
  const t = (jd - 2451545) / 36525;
  return {
    L: (wrap(poly(body.L, t)) * Math.PI) / 180,
    a: poly(body.a, t),
    e: poly(body.e, t),
    i: (wrap(poly(body.i, t)) * Math.PI) / 180,
    W: (wrap(poly(body.W, t)) * Math.PI) / 180,
    p: (wrap(poly(body.p, t)) * Math.PI) / 180,
  };
}

function kepler(mean: number, eccentricity: number) {
  let eccentric = mean;
  for (let step = 0; step < 16; step += 1) {
    const delta = eccentric - eccentricity * Math.sin(eccentric) - mean;
    eccentric -= delta / (1 - eccentricity * Math.cos(eccentric));
    if (Math.abs(delta) < 1e-12) break;
  }
  return eccentric;
}

function heliocentric(body: Coeffs, jd: number) {
  const el = elements(body, jd);
  let mean = el.L - el.p;
  mean = ((mean % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const eccentric = kepler(mean, el.e);
  const xv = el.a * (Math.cos(eccentric) - el.e);
  const yv = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(eccentric);
  const angle = el.p - el.W + Math.atan2(yv, xv);
  const radius = Math.hypot(xv, yv);
  const cosW = Math.cos(el.W);
  const sinW = Math.sin(el.W);
  const cosI = Math.cos(el.i);
  return {
    x: radius * (cosW * Math.cos(angle) - sinW * Math.sin(angle) * cosI),
    y: radius * (sinW * Math.cos(angle) + cosW * Math.sin(angle) * cosI),
    z: radius * Math.sin(angle) * Math.sin(el.i),
  };
}

function equatorial(lon: number, lat: number, jd: number) {
  const t = (jd - 2451545) / 36525;
  const tilt = ((23.439291 - 0.0130042 * t) * Math.PI) / 180;
  let ra = Math.atan2(Math.sin(lon) * Math.cos(tilt) - Math.tan(lat) * Math.sin(tilt), Math.cos(lon));
  if (ra < 0) ra += Math.PI * 2;
  const dec = Math.asin(Math.sin(lat) * Math.cos(tilt) + Math.cos(lat) * Math.sin(tilt) * Math.sin(lon));
  return { ra: (ra * 180) / Math.PI, dec: (dec * 180) / Math.PI };
}

function planetEquator(body: Coeffs, jd: number) {
  const planet = heliocentric(body, jd);
  const earth = heliocentric(EARTH, jd);
  const x = planet.x - earth.x;
  const y = planet.y - earth.y;
  const z = planet.z - earth.z;
  return equatorial(Math.atan2(y, x), Math.atan2(z, Math.hypot(x, y)), jd);
}

function moonEcliptic(jd: number) {
  const t = (jd - 2451545) / 36525;
  const rad = Math.PI / 180;
  const lp = wrap(218.3164477 + 481267.88123421 * t - 0.0015786 * t * t) * rad;
  const d = wrap(297.8501921 + 445267.1114034 * t - 0.0018819 * t * t) * rad;
  const m = wrap(357.5291092 + 35999.0502909 * t - 0.0001536 * t * t) * rad;
  const mp = wrap(134.9633964 + 477198.8675055 * t + 0.0087414 * t * t) * rad;
  const f = wrap(93.272095 + 483202.0175233 * t - 0.0036539 * t * t) * rad;
  const lon =
    lp +
    rad *
      (6.288774 * Math.sin(mp) +
        1.274027 * Math.sin(2 * d - mp) +
        0.658314 * Math.sin(2 * d) +
        0.213618 * Math.sin(2 * mp) -
        0.185116 * Math.sin(m) -
        0.114332 * Math.sin(2 * f) +
        0.058793 * Math.sin(2 * d - 2 * mp) +
        0.057066 * Math.sin(2 * d - m - mp) +
        0.053322 * Math.sin(2 * d + mp) +
        0.045758 * Math.sin(2 * d - m));
  const lat =
    rad *
    (5.128122 * Math.sin(f) +
      0.280602 * Math.sin(mp + f) +
      0.277693 * Math.sin(mp - f) +
      0.173238 * Math.sin(2 * d - f) +
      0.055413 * Math.sin(2 * d - mp + f) +
      0.046272 * Math.sin(2 * d - mp - f));
  return { lon, lat };
}

export function moonEquator(jd: number) {
  const { lon, lat } = moonEcliptic(jd);
  return equatorial(lon, lat, jd);
}

/** A helyi középdél óraszöge, radiánban, nyugati irányban pozitív. */
export function meanNoonHourAngle(year: number, month: number, day: number, raDeg: number) {
  const jdUt = julianDayNoon(year, month, day) - deltaTSeconds(year) / 86400;
  const days = jdUt - 2451545;
  const century = days / 36525;
  const gmst = wrap(280.46061837 + 360.98564736629 * days + 0.000387933 * century * century - (century * century * century) / 38710000);
  const hour = wrap(gmst + SITE_LON - raDeg);
  const signed = hour > 180 ? hour - 360 : hour;
  return (signed * Math.PI) / 180;
}

function sunLongitude(jd: number) {
  const earth = heliocentric(EARTH, jd);
  return wrap((Math.atan2(earth.y, earth.x) * 180) / Math.PI + 180);
}

/** A Nap egyenlítői helye ugyanarra a földi időre, mint a Hold és a bolygók. */
export function sunEquator(jd: number) {
  const earth = heliocentric(EARTH, jd);
  return equatorial(Math.atan2(earth.y, earth.x) + Math.PI, 0, jd);
}

export type MoonPhase = {
  elongation: number;
  fraction: number;
  name: string;
};

export function moonPhase(jd: number): MoonPhase {
  const { lon } = moonEcliptic(jd);
  const elongation = wrap((lon * 180) / Math.PI - sunLongitude(jd));
  const fraction = (1 - Math.cos((elongation * Math.PI) / 180)) / 2;
  let name = "fogyó sarló";
  if (elongation < 11.25 || elongation >= 348.75) name = "újhold";
  else if (elongation < 78.75) name = "növekvő sarló";
  else if (elongation < 101.25) name = "első negyed";
  else if (elongation < 168.75) name = "növekvő hold";
  else if (elongation < 191.25) name = "telehold";
  else if (elongation < 258.75) name = "fogyó hold";
  else if (elongation < 281.25) name = "utolsó negyed";
  return { elongation, fraction, name };
}

function step(ra0: number, ra1: number) {
  let delta = ra1 - ra0;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function placeOf(id: string, nev: string, hint: string, color: string, at: (jd: number) => { ra: number; dec: number }, jd: number, raSun: number): PlanetPlace {
  const now = at(jd);
  const next = at(jd + 1);
  const ra = wrap(now.ra);
  return {
    id,
    nev,
    sub: hint,
    color,
    dec: (now.dec * Math.PI) / 180,
    shift: (wrap(ra - raSun) * Math.PI) / 180,
    dra: (step(ra, wrap(next.ra)) * Math.PI) / 180,
    ddec: ((next.dec - now.dec) * Math.PI) / 180,
  };
}

export function planetPlaces(jd: number, raSun: number): PlanetPlace[] {
  const moon = placeOf("hold", "Hold", "a Föld kísérője", "#475569", moonEquator, jd, raSun);
  const planets = PLANET_ROWS.map((row) => placeOf(row.id, row.nev, row.hint, row.szin, (day) => planetEquator(row, day), jd, raSun));
  return [moon, ...planets];
}
