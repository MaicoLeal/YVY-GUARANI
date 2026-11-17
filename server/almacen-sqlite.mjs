/*
 * Almacenamiento en SQLite (incluido en Node 24+) para el servidor propio: computadora local o VPS.
 * Copias de seguridad como archivos .db en <datos>/respaldos (se guardan las últimas 14).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function crearAlmacenSqlite({ dataDir, keepBackups = 14 }) {
  const backupDir = path.join(dataDir, 'respaldos');
  fs.mkdirSync(backupDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'yvy.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS estado (
      id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL, version INTEGER NOT NULL, datos TEXT NOT NULL, actualizado TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS diario (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, usuario TEXT, rol TEXT, vista_de TEXT, tipo TEXT NOT NULL,
      datos TEXT, ok INTEGER NOT NULL, codigo TEXT, resumen TEXT, ip TEXT, rev INTEGER);
    CREATE TABLE IF NOT EXISTS sesiones (
      token TEXT PRIMARY KEY, usuario TEXT NOT NULL, creada TEXT NOT NULL, vence TEXT NOT NULL, ultima TEXT NOT NULL, agente TEXT);
    CREATE INDEX IF NOT EXISTS diario_fecha ON diario (fecha);
    CREATE INDEX IF NOT EXISTS sesiones_usuario ON sesiones (usuario);
  `);
  const q = {
    rev: db.prepare('SELECT rev FROM estado WHERE id = 1'),
    datos: db.prepare('SELECT datos FROM estado WHERE id = 1'),
    insertState: db.prepare('INSERT INTO estado (id, rev, version, datos, actualizado) VALUES (1, ?, ?, ?, ?)'),
    updateState: db.prepare('UPDATE estado SET rev = ?, version = ?, datos = ?, actualizado = ? WHERE id = 1'),
    journal: db.prepare('INSERT INTO diario (fecha, usuario, rol, vista_de, tipo, datos, ok, codigo, resumen, ip, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    journalRows: db.prepare('SELECT tipo, ok, codigo, datos FROM diario ORDER BY seq'),
    getSession: db.prepare('SELECT usuario, vence, ultima FROM sesiones WHERE token = ?'),
    putSession: db.prepare('INSERT INTO sesiones (token, usuario, creada, vence, ultima, agente) VALUES (?, ?, ?, ?, ?, ?)'),
    touchSession: db.prepare('UPDATE sesiones SET ultima = ? WHERE token = ?'),
    delSession: db.prepare('DELETE FROM sesiones WHERE token = ?'),
    delUserSessions: db.prepare('DELETE FROM sesiones WHERE usuario = ? AND token <> ?'),
    delOtherSessions: db.prepare('DELETE FROM sesiones WHERE token <> ?'),
    moveSession: db.prepare('UPDATE sesiones SET usuario = ? WHERE token = ?'),
    purgeSessions: db.prepare('DELETE FROM sesiones WHERE vence < ?')
  };
  const journalArgs = (e, ok, rev) => [e.fecha, e.user || null, e.role || null, e.viewedBy || null, e.type, e.payload || null, ok, e.code || null, e.summary || '', e.ip || null, rev];
  // Un solo proceso: el límite de intentos de ingreso puede vivir en memoria.
  const attempts = new Map();

  function backupFile(reason, iso) {
    const stamp = iso.replace(/[:T]/g, '-').slice(0, 16);
    const file = path.join(backupDir, 'yvy-' + stamp + (reason ? '-' + reason : '') + '.db');
    if (fs.existsSync(file)) return null;
    db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
    const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).sort();
    files.slice(0, Math.max(0, files.length - keepBackups)).forEach((f) => fs.unlinkSync(path.join(backupDir, f)));
    return path.basename(file);
  }

  return {
    kind: 'sqlite',
    db,
    async init(version, initialJson, iso) {
      if (!q.rev.get()) q.insertState.run(0, version, initialJson(), iso);
    },
    async load(knownRev) {
      const r = q.rev.get();
      if (!r) return null;
      if (r.rev === knownRev) return { rev: r.rev, datos: null };
      return { rev: r.rev, datos: q.datos.get().datos };
    },
    async rev() {
      const r = q.rev.get();
      return r ? r.rev : 0;
    },
    /** Graba el estado nuevo y su registro juntos, solo si la revisión sigue siendo prevRev. Devuelve la revisión nueva o null. */
    async commit(prevRev, version, datos, entry, iso) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = q.rev.get();
        if (!r || r.rev !== prevRev) { db.exec('ROLLBACK'); return null; }
        const nextRev = prevRev + 1;
        q.journal.run(...journalArgs(entry, 1, nextRev));
        q.updateState.run(nextRev, version, datos, iso);
        db.exec('COMMIT');
        return nextRev;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async journal(entry) { q.journal.run(...journalArgs(entry, entry.ok ? 1 : 0, entry.rev == null ? null : entry.rev)); },
    async journalRows() { return q.journalRows.all(); },

    async getSession(key) { return q.getSession.get(key) || null; },
    async putSession(s) { q.putSession.run(s.token, s.usuario, s.creada, s.vence, s.ultima, s.agente); },
    async touchSession(key, iso) { q.touchSession.run(iso, key); },
    async delSession(key) { q.delSession.run(key); },
    async delUserSessions(userId, exceptKey) { q.delUserSessions.run(userId, exceptKey); },
    async delOtherSessions(exceptKey) { q.delOtherSessions.run(exceptKey); },
    async moveSession(key, userId) { q.moveSession.run(userId, key); },
    async purgeSessions(iso) { q.purgeSessions.run(iso); },

    async getAttempt(key) { return attempts.get(key) || null; },
    async failAttempt(key, nowMs, windowStartMs) {
      const a = attempts.get(key);
      if (!a || a.desde < windowStartMs) attempts.set(key, { fallos: 1, desde: nowMs });
      else a.fallos++;
    },
    async clearAttempt(key) { attempts.delete(key); },
    async purgeAttempts(windowStartMs) { attempts.forEach((a, k) => { if (a.desde < windowStartMs) attempts.delete(k); }); },

    async backup(reason, iso) { return backupFile(reason, iso); },
    async backupIfOlder(reason, iso) { return backupFile(reason, iso); },
    close() { db.close(); }
  };
}
