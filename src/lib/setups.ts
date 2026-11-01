import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

export const listSetups = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{ name: string; data: unknown }>`
      select name, data from saved_setups
      where user_id = ${context.userId}
      order by created_at desc
    `;
    return rows.map((row) => ({ name: row.name, data: asJson(row.data) }));
  });

export const saveSetup = createServerFn({ method: "POST" })
  .validator((input: { name?: string; data?: JsonValue }) => {
    const name = String(input?.name ?? "").trim().slice(0, 80);
    if (!name) throw new Error("N\u00e9v kell.");
    if (!input?.data || typeof input.data !== "object" || Array.isArray(input.data)) throw new Error("Hi\u00e1nyos be\u00e1ll\u00edt\u00e1s.");
    return { name, data: input.data };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into saved_setups (user_id, name, data)
      values (${context.userId}, ${data.name}, ${JSON.stringify(data.data)})
      on conflict (user_id, name) do update
      set data = excluded.data, created_at = now()
    `;
    return { name: data.name };
  });

export const deleteSetup = createServerFn({ method: "POST" })
  .validator((name: string) => String(name ?? "").trim().slice(0, 80))
  .middleware([authMiddleware])
  .handler(async ({ context, data: name }) => {
    if (!name) return;
    const sql = await getSql();
    await sql`delete from saved_setups where user_id = ${context.userId} and name = ${name}`;
  });
