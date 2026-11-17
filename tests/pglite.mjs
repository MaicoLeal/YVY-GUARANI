// Postgres en memoria (PGlite) para probar el almacenamiento de Vercel sin una base real.
// Es una dependencia solo de desarrollo: si no está instalada (npm install), las pruebas de Postgres se omiten.
export async function crearPglite() {
  let mod;
  try { mod = await import('@electric-sql/pglite'); } catch (e) { return null; }
  const pg = new mod.PGlite();
  await pg.waitReady;
  return {
    query: async (text, params) => (await pg.query(text, params || [])).rows,
    batch: (list) => pg.transaction(async (tx) => {
      const out = [];
      for (const [text, params] of list) out.push((await tx.query(text, params || [])).rows);
      return out;
    }),
    close: () => pg.close()
  };
}

export async function hayPglite() {
  try { await import('@electric-sql/pglite'); return true; } catch (e) { return false; }
}
