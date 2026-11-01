import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

const DATA = "/dendera-csillagok-ie54.json";

type Star = {
  csillagkep_hu: string;
  csillagkep: string;
  iau: string;
  azonossag: string;
  csillag: string;
  bayer: string;
  mag: number;
  deklinacio_ie54: number;
  kel_azimut: number | null;
  nyug_azimut: number | null;
  elteres_kelettol: number | null;
  allapot: string;
};

type Payload = {
  hely: string;
  idopont: string;
  horizont: string;
  azimut: string;
  elteres: string;
  forras: string;
  megjegyzes: string;
  csillagok: Star[];
};

export const Route = createFileRoute("/dendera")({ component: Dendera });

function num(value: number | null) {
  return value === null ? "—" : value.toFixed(1);
}

function Dendera() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"mind" | "biztos" | "feltételezett">("mind");

  useEffect(() => {
    fetch(DATA)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<Payload>;
      })
      .then(setData)
      .catch(() => setError("A táblázat nem tölthető be."));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.csillagok.filter((star) => {
      if (only !== "mind" && star.azonossag !== only) return false;
      if (!q) return true;
      return `${star.csillagkep_hu} ${star.csillagkep} ${star.csillag} ${star.iau}`.toLowerCase().includes(q);
    });
  }, [data, query, only]);

  return (
    <main className="min-h-screen bg-stone-100 text-stone-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-stone-500">
              <Link to="/" className="underline">
                Padló 18
              </Link>
            </p>
            <h1 className="text-lg font-semibold">Denderai zodiákus, i. e. 54</h1>
          </div>
          <a
            href="/dendera-csillagok-ie54.csv"
            target="_blank"
            rel="noopener"
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Táblázat megnyitása
          </a>
        </header>
        <section className="rounded-xl border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-700 shadow-sm">
          <p>
            A Hathor-templom kör alakú zodiákusán a tizenkét állatövi csillagkép, a Nagy Medve, a Kis Medve, az
            Orion és a Szíriusz biztosan látható. A további csillagképek Éric Aubourg 1995-ös, kifejezetten
            feltételezett azonosításai. A kelési és nyugvási szög azimut: 0° észak, 90° kelet, 270° nyugat.
            Hely: {data?.hely ?? "Dendera"}. Időpont: {data?.idopont ?? "i. e. 54"}.
          </p>
          <p className="mt-2">{data?.megjegyzes}</p>
        </section>
        <a href="/dendera-csillagok-rajz.jpg" target="_blank" rel="noopener" className="block">
          <img
            src="/dendera-csillagok-rajz.jpg"
            alt="Denderai horizontkör: a csillagok kelési és nyugvási szöge"
            className="w-full rounded-xl border border-stone-300 bg-white"
          />
        </a>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Keresés: Sirius, Orion, Skorpió…"
            className="w-64 rounded-md border border-stone-300 px-3 py-2 text-sm"
          />
          {(
            [
              ["mind", "Mind"],
              ["biztos", "Biztos"],
              ["feltételezett", "Feltételezett"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setOnly(value)}
              className={`rounded-full px-3 py-1.5 text-sm ${only === value ? "bg-stone-900 text-white" : "bg-white text-stone-700"}`}
            >
              {label}
            </button>
          ))}
          <span className="text-sm text-stone-500">{rows.length} csillag</span>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Csillagkép</th>
                <th className="px-3 py-2">Csillag</th>
                <th className="px-3 py-2">Fényerő</th>
                <th className="px-3 py-2">Kelés</th>
                <th className="px-3 py-2">Nyugvás</th>
                <th className="px-3 py-2">Kelettől</th>
                <th className="px-3 py-2">Állapot</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((star) => (
                <tr key={`${star.iau}-${star.csillag}`} className="border-t border-stone-100">
                  <td className="px-3 py-2">
                    {star.csillagkep_hu}
                    <span className="block text-xs text-stone-500">{star.azonossag}</span>
                  </td>
                  <td className="px-3 py-2">{star.csillag}</td>
                  <td className="px-3 py-2">{star.mag.toFixed(2)}</td>
                  <td className="px-3 py-2">{num(star.kel_azimut)}°</td>
                  <td className="px-3 py-2">{num(star.nyug_azimut)}°</td>
                  <td className="px-3 py-2">{num(star.elteres_kelettol)}°</td>
                  <td className="px-3 py-2 text-stone-600">{star.allapot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
