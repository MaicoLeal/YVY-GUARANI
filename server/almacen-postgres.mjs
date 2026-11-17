/*
 * Almacenamiento en Postgres, para cuando el servidor corre en Vercel (funciones) con una base Neon.
 *
 * No depende de ningún driver: recibe query(texto, parámetros) → filas, y opcionalmente batch(lista) para
 * mandar varias sentencias juntas. api/index.mjs lo conecta con @neondatabase/serverless; los tests, con PGlite.
 *
 * Cada cambio se graba con una sola sentencia que actualiza el estado solo si la revisión no cambió y,
 * en la misma sentencia, agrega su registro al diario: o quedan los dos, o ninguno.
 */
const DDL = [
  `CREATE TABLE IF NOT EXISTS estado (
     id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL, version INTEGER NOT NULL, datos TEXT NOT NULL, actualizado TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS diario (
     seq BIGSERIAL PRIMARY KEY, fecha TEXT NOT NULL, usuario TEXT, rol TEXT, vista_de TEXT, tipo TEXT NOT NULL,
     datos TEXT, ok SMALLINT NOT NULL, codigo TEXT, resumen TEXT, ip TEXT, rev INTEGER)`,
  'CREATE INDEX IF NOT EXISTS diario_fecha ON diario (fecha)',
  `CREATE TABLE IF NOT EXISTS sesiones (
     token TEXT PRIMARY KEY, usuario TEXT NOT NULL, creada TEXT NOT NULL, vence TEXT NOT NULL, ultima TEXT NOT NULL, agente TEXT)`,
  'CREATE INDEX IF NOT EXISTS sesiones_usuario ON sesiones (usuario)',
  'CREATE TABLE IF NOT EXISTS intentos (clave TEXT PRIMARY KEY, fallos INTEGER NOT NULL, desde BIGINT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS respaldos (
     id BIGSERIAL PRIMARY KEY, fecha TEXT NOT NULL, motivo TEXT, rev INTEGER, datos TEXT NOT NULL)`
];

/**
 * @param {object} o
 * @param {(text: string, params?: any[]) => Promise<object[]>} o.query
 * @param {(list: Array<[string, any[]]>) => Promise<any>} [o.batch]  varias sentencias en una sola transacción
 * @param {number} [o.keepBackups]
 */
export function crearAlmacenPostgres({ query, batch, keepBackups = 14 }) {
  const run = (text, params) => query(text, params || []);
  const journalParams = (e, ok) => [e.fecha, e.user || null, e.role || null, e.viewedBy || null, e.type, e.payload || null, ok, e.code || null, e.summary || '', e.ip || null];

  async function prune() {
    await run('DELETE FROM respaldos WHERE id NOT IN (SELECT id FROM respaldos ORDER BY id DESC LIMIT $1::int)', [keepBackups]);
  }

  return {
    kind: 'postgres',
    async init(version, initialJson, iso) {
      if (batch) await batch(DDL.map((t) => [t, []]));
      else for (const t of DDL) await run(t);
      const rows = await run('SELECT rev FROM estado WHERE id = 1');
      if (!rows.length) {
        await run('INSERT INTO estado (id, rev, version, datos, actualizado) VALUES (1, 0, $1::int, $2::text, $3::text) ON CONFLICT (id) DO NOTHING', [version, initialJson(), iso]);
      }
    },
    /** Devuelve la revisión y, solo si cambió respecto de knownRev, el estado completo. */
    async load(knownRev) {
      const rows = await run('SELECT rev, CASE WHEN rev = $1::int THEN NULL ELSE datos END AS datos FROM estado WHERE id = 1', [knownRev]);
      return rows.length ? { rev: Number(rows[0].rev), datos: rows[0].datos } : null;
    },
    async rev() {
      const rows = await run('SELECT rev FROM estado WHERE id = 1');
      return rows.length ? Number(rows[0].rev) : 0;
    },
    /** Graba el estado nuevo y su registro juntos, solo si la revisión sigue siendo prevRev. Devuelve la revisión nueva o null. */
    async commit(prevRev, version, datos, entry, iso) {
      const rows = await run(
        `WITH u AS (
           UPDATE estado SET rev = rev + 1, version = $2::int, datos = $3::text, actualizado = $4::text
           WHERE id = 1 AND rev = $1::int RETURNING rev)
         INSERT INTO diario (fecha, usuario, rol, vista_de, tipo, datos, ok, codigo, resumen, ip, rev)
         SELECT $5::text, $6::text, $7::text, $8::text, $9::text, $10::text, 1, NULL, $11::text, $12::text, u.rev FROM u
         RETURNING rev`,
        [prevRev, version, datos, iso, entry.fecha, entry.user || null, entry.role || null, entry.viewedBy || null, entry.type, entry.payload || null, entry.summary || '', entry.ip || null]
      );
      return rows.length ? Number(rows[0].rev) : null;
    },
    async journal(entry) {
      await run(
        'INSERT INTO diario (fecha, usuario, rol, vista_de, tipo, datos, ok, codigo, resumen, ip, rev) VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::smallint, $8::text, $9::text, $10::text, $11::int)',
        journalParams(entry, entry.ok ? 1 : 0).concat([entry.rev == null ? null : entry.rev])
      );
    },
    async journalRows() {
      const rows = await run('SELECT tipo, ok, codigo, datos FROM diario ORDER BY seq');
      return rows.map((r) => Object.assign({}, r, { ok: Number(r.ok) }));
    },

    async getSession(key) {
      const rows = await run('SELECT usuario, vence, ultima FROM sesiones WHERE token = $1::text', [key]);
      return rows[0] || null;
    },
    async putSession(s) {
      await run('INSERT INTO sesiones (token, usuario, creada, vence, ultima, agente) VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text)', [s.token, s.usuario, s.creada, s.vence, s.ultima, s.agente]);
    },
    async touchSession(key, iso) { await run('UPDATE sesiones SET ultima = $1::text WHERE token = $2::text', [iso, key]); },
    async delSession(key) { await run('DELETE FROM sesiones WHERE token = $1::text', [key]); },
    async delUserSessions(userId, exceptKey) { await run('DELETE FROM sesiones WHERE usuario = $1::text AND token <> $2::text', [userId, exceptKey]); },
    async delOtherSessions(exceptKey) { await run('DELETE FROM sesiones WHERE token <> $1::text', [exceptKey]); },
    async moveSession(key, userId) { await run('UPDATE sesiones SET usuario = $1::text WHERE token = $2::text', [userId, key]); },
    async purgeSessions(iso) { await run('DELETE FROM sesiones WHERE vence < $1::text', [iso]); },

    async getAttempt(key) {
      const rows = await run('SELECT fallos, desde FROM intentos WHERE clave = $1::text', [key]);
      return rows.length ? { fallos: Number(rows[0].fallos), desde: Number(rows[0].desde) } : null;
    },
    async failAttempt(key, nowMs, windowStartMs) {
      await run(
        `INSERT INTO intentos (clave, fallos, desde) VALUES ($1::text, 1, $2::bigint)
         ON CONFLICT (clave) DO UPDATE SET
           fallos = CASE WHEN intentos.desde < $3::bigint THEN 1 ELSE intentos.fallos + 1 END,
           desde = CASE WHEN intentos.desde < $3::bigint THEN $2::bigint ELSE intentos.desde END`,
        [key, nowMs, windowStartMs]
      );
    },
    async clearAttempt(key) { await run('DELETE FROM intentos WHERE clave = $1::text', [key]); },
    async purgeAttempts(windowStartMs) { await run('DELETE FROM intentos WHERE desde < $1::bigint', [windowStartMs]); },

    /** Copia del estado dentro de la misma base (tabla respaldos); quedan las últimas 14. */
    async backup(reason, iso) {
      const rows = await run('INSERT INTO respaldos (fecha, motivo, rev, datos) SELECT $1::text, $2::text, rev, datos FROM estado WHERE id = 1 RETURNING id', [iso, reason]);
      await prune();
      return rows.length ? 'respaldo ' + rows[0].id + (reason ? ' (' + reason + ')' : '') : null;
    },
    /** Copia solo si la última es anterior a sinceIso. */
    async backupIfOlder(reason, iso, sinceIso) {
      const rows = await run(
        'INSERT INTO respaldos (fecha, motivo, rev, datos) SELECT $1::text, $2::text, rev, datos FROM estado WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM respaldos WHERE fecha >= $3::text) RETURNING id',
        [iso, reason, sinceIso]
      );
      if (!rows.length) return null;
      await prune();
      return 'respaldo ' + rows[0].id + ' (' + reason + ')';
    },
    close() { /* la conexión es de quien la creó */ }
  };
}
