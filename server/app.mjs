/*
 * Servidor de Yvy Guaraní: base compartida, cuentas y reglas aplicadas en el servidor.
 *
 * - Una sola fuente de verdad: el estado vive en SQLite (tabla "estado") y cada cambio aceptado
 *   se guarda en la misma transacción que su registro en el diario (tabla "diario").
 * - Las reglas son las de js/domain.js, ejecutadas acá: la pantalla solo pide, el servidor decide.
 *   Node atiende un comando por vez, así que dos reservas simultáneas nunca venden el mismo stock.
 * - Cada cuenta recibe solo lo suyo (D.viewFor). Las contraseñas se verifican con PBKDF2 en el servidor
 *   y las sesiones viajan en una cookie HttpOnly; en la base solo queda el hash del token.
 * - Copias de seguridad automáticas de la base (al iniciar, cada 24 h y antes de reemplazar datos).
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const D = require('../js/domain.js');
const Seed = require('../js/seed.js');

const COOKIE = 'yvy_sesion';
const SESSION_DAYS = 14;
const PBKDF2_ITER = 210000;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_BACKUP_BODY = 16 * 1024 * 1024;
const KEEP_BACKUPS = 14;
const BLOCKED_COMMANDS = { 'usuario.credencial': 'Para contraseñas usá el formulario de acceso.' };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json; charset=utf-8'
};
const PUBLIC_PREFIXES = ['index.html', 'css/', 'js/', 'assets/'];

function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function pbkdf2(password, saltHex, iter) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password), Buffer.from(saltHex, 'hex'), iter, 32, 'sha256', (err, key) => (err ? reject(err) : resolve(key)));
  });
}
async function makeCred(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await pbkdf2(password, salt, PBKDF2_ITER)).toString('hex');
  return { algo: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt, hash };
}
function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (p.length > 200) return 'La contraseña es demasiado larga.';
  return null;
}
/** Quita fotos incrustadas del diario para que no crezca de más. */
function forJournal(payload) {
  return JSON.stringify(payload, (k, v) => (typeof v === 'string' && v.startsWith('data:image') ? '[imagen]' : v));
}

export function createApp(opts = {}) {
  const root = path.resolve(opts.root || fileURLToPath(new URL('..', import.meta.url)));
  const dataDir = path.resolve(opts.dataDir || path.join(root, 'data'));
  const backupDir = path.join(dataDir, 'respaldos');
  const clock = opts.now || (() => new Date());
  const secureCookie = !!opts.secureCookie;
  const trustProxy = !!opts.trustProxy;
  const log = opts.log || (() => {});
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
    getState: db.prepare('SELECT rev, datos FROM estado WHERE id = 1'),
    putState: db.prepare('INSERT INTO estado (id, rev, version, datos, actualizado) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, version = excluded.version, datos = excluded.datos, actualizado = excluded.actualizado'),
    journal: db.prepare('INSERT INTO diario (fecha, usuario, rol, vista_de, tipo, datos, ok, codigo, resumen, ip, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    getSession: db.prepare('SELECT usuario, vence FROM sesiones WHERE token = ?'),
    putSession: db.prepare('INSERT INTO sesiones (token, usuario, creada, vence, ultima, agente) VALUES (?, ?, ?, ?, ?, ?)'),
    touchSession: db.prepare('UPDATE sesiones SET ultima = ? WHERE token = ?'),
    delSession: db.prepare('DELETE FROM sesiones WHERE token = ?'),
    delUserSessions: db.prepare('DELETE FROM sesiones WHERE usuario = ? AND token <> ?'),
    delOtherSessions: db.prepare('DELETE FROM sesiones WHERE token <> ?'),
    moveSession: db.prepare('UPDATE sesiones SET usuario = ? WHERE token = ?'),
    purgeSessions: db.prepare('DELETE FROM sesiones WHERE vence < ?')
  };

  // ---------- estado ----------

  let state;
  let rev;
  const row = q.getState.get();
  if (row) {
    const parsed = JSON.parse(row.datos);
    const imp = D.importBackup({ app: D.APP_ID, kind: 'respaldo-de-prueba', schemaVersion: parsed.schemaVersion, state: parsed });
    if (!imp.ok) throw new Error('La base no pasó la validación al iniciar: ' + imp.errors.join(' '));
    state = imp.state;
    rev = row.rev;
  } else {
    state = (opts.initialState || Seed.buildInicial)(clock());
    rev = 0;
    q.putState.run(rev, D.SCHEMA_VERSION, JSON.stringify(state), clock().toISOString());
  }

  /** Guarda el estado nuevo y su registro en una sola transacción. Si algo falla, nada cambia. */
  function commit(next, entry) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const nextRev = rev + 1;
      q.journal.run(clock().toISOString(), entry.user || null, entry.role || null, entry.viewedBy || null, entry.type, entry.payload || null, 1, null, entry.summary || '', entry.ip || null, nextRev);
      q.putState.run(nextRev, D.SCHEMA_VERSION, JSON.stringify(next), clock().toISOString());
      db.exec('COMMIT');
      state = next;
      rev = nextRev;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    broadcast();
  }
  function journalRejected(entry) {
    q.journal.run(clock().toISOString(), entry.user || null, entry.role || null, entry.viewedBy || null, entry.type, entry.payload || null, 0, entry.code || null, entry.summary || '', entry.ip || null, rev);
  }

  // ---------- copias de seguridad ----------

  function backup(reason) {
    const stamp = clock().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const file = path.join(backupDir, 'yvy-' + stamp + (reason ? '-' + reason : '') + '.db');
    if (fs.existsSync(file)) return file;
    db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
    const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).sort();
    files.slice(0, Math.max(0, files.length - KEEP_BACKUPS)).forEach((f) => fs.unlinkSync(path.join(backupDir, f)));
    log('Copia de seguridad: ' + path.basename(file));
    return file;
  }
  if (!opts.skipBackups) backup('inicio');
  const backupTimer = opts.skipBackups ? null : setInterval(() => { try { backup('diaria'); } catch (e) { log('Error de copia: ' + e.message); } }, 24 * 3600 * 1000);
  if (backupTimer) backupTimer.unref();

  // ---------- sesiones ----------

  function parseCookies(req) {
    const out = {};
    String(req.headers.cookie || '').split(';').forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
    return out;
  }
  function sessionFrom(req) {
    const token = parseCookies(req)[COOKIE];
    if (!token || token.length > 100) return null;
    const key = sha256(token);
    const s = q.getSession.get(key);
    if (!s) return null;
    if (s.vence < clock().toISOString()) { q.delSession.run(key); return null; }
    const user = D.byId(state.users, s.usuario);
    if (!user || user.active === false || !user.cred) return null;
    q.touchSession.run(clock().toISOString(), key);
    return { key, user };
  }
  function cookieHeader(token, maxAge) {
    return COOKIE + '=' + (token || '') + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secureCookie ? '; Secure' : '');
  }
  function newSession(res, req, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = clock();
    const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
    q.putSession.run(sha256(token), userId, now.toISOString(), expires.toISOString(), now.toISOString(), String(req.headers['user-agent'] || '').slice(0, 200));
    res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 86400));
    return sha256(token);
  }
  q.purgeSessions.run(clock().toISOString());
  const purgeTimer = setInterval(() => { try { q.purgeSessions.run(clock().toISOString()); } catch (e) { /* se reintenta en la próxima */ } }, 3600 * 1000);
  purgeTimer.unref();

  // Límite de intentos de ingreso: 8 fallas por usuario e IP cada 15 minutos.
  const attempts = new Map();
  function throttled(key) {
    const a = attempts.get(key);
    if (!a) return false;
    if (clock().getTime() - a.first > 15 * 60000) { attempts.delete(key); return false; }
    return a.count >= 8;
  }
  function failAttempt(key) {
    const a = attempts.get(key);
    if (!a || clock().getTime() - a.first > 15 * 60000) attempts.set(key, { count: 1, first: clock().getTime() });
    else a.count++;
  }

  // ---------- cambios en vivo ----------

  const listeners = new Set();
  function broadcast() {
    const msg = 'event: cambio\ndata: ' + JSON.stringify({ rev }) + '\n\n';
    listeners.forEach((res) => { try { res.write(msg); } catch (e) { listeners.delete(res); } });
  }
  const heartbeat = setInterval(() => listeners.forEach((res) => { try { res.write(': latido\n\n'); } catch (e) { listeners.delete(res); } }), 25000);
  heartbeat.unref();

  // ---------- utilidades HTTP ----------

  /**
   * IP del cliente. Detrás del proxy propio se toma la última dirección de X-Forwarded-For,
   * que es la que agrega el proxy: las anteriores las puede inventar cualquiera.
   */
  function ipOf(req) {
    if (trustProxy && req.headers['x-forwarded-for']) {
      const list = String(req.headers['x-forwarded-for']).split(',').map((x) => x.trim()).filter(Boolean);
      if (list.length) return list[list.length - 1];
    }
    return req.socket.remoteAddress || '';
  }
  function securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; frame-src https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if (secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }
  function send(res, status, body, extra) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': data.length }, extra || {}));
    res.end(data);
  }
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(Object.assign(new Error('El envío es demasiado grande.'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(Object.assign(new Error('Datos con formato inválido.'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }
  /** Contra envíos desde otros sitios: los POST deben ser JSON y traer el encabezado propio de la aplicación. */
  function trustedPost(req) {
    return String(req.headers['content-type'] || '').startsWith('application/json') && req.headers['x-yvy'] === '1';
  }
  function setupRequired() {
    return !state.users.some((u) => u.role === 'admin' && u.active !== false && u.cred);
  }
  /** Cuenta efectiva: Administración puede pedir ver el sistema como otra cuenta. */
  function effective(req, sess) {
    if (!sess) return { actor: null, viewing: null };
    const wanted = String(req.headers['x-ver-como'] || '');
    if (wanted && sess.user.role === 'admin' && wanted !== sess.user.id) {
      const v = D.byId(state.users, wanted);
      if (v && v.active !== false) {
        return { actor: Object.assign({}, v, { name: v.name + ' (vista de ' + sess.user.name + ')' }), viewing: v };
      }
    }
    return { actor: sess.user, viewing: null };
  }
  function snapshotFor(req, sess) {
    const eff = effective(req, sess);
    const viewUser = eff.viewing || (sess && sess.user) || null;
    return {
      rev,
      setupRequired: setupRequired(),
      me: sess ? D.publicUser(sess.user) : null,
      viewAs: eff.viewing ? D.publicUser(eff.viewing) : null,
      view: D.viewFor(state, viewUser)
    };
  }
  /** Conserva la cuenta de Administración en uso cuando se reemplazan todos los datos. */
  function adoptAdmin(next, me, sessKey) {
    const target = next.users.filter((u) => u.role === 'admin')[0];
    next.users.forEach((u) => { if (u !== target && u.username === me.username) u.username = u.username + '.2'; });
    target.name = me.name;
    target.username = me.username;
    target.cred = D.clone(me.cred);
    q.delOtherSessions.run(sessKey);
    q.moveSession.run(target.id, sessKey);
    return next;
  }

  // ---------- API ----------

  async function api(req, res, url) {
    const sess = sessionFrom(req);
    const ip = ipOf(req);
    const route = req.method + ' ' + url.pathname;

    if (route === 'GET /api/salud') return send(res, 200, { ok: true, rev });
    if (route === 'GET /api/estado') return send(res, 200, snapshotFor(req, sess));
    if (route === 'GET /api/eventos') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 4000\nevent: cambio\ndata: ' + JSON.stringify({ rev }) + '\n\n');
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }
    if (route === 'GET /api/respaldo') {
      if (!sess || sess.user.role !== 'admin') return send(res, 403, { ok: false, message: 'Solo Administración puede descargar el respaldo.' });
      const body = D.exportBackup(state, clock());
      const name = 'yvy-respaldo-' + D.localDate(clock()) + '.json';
      return send(res, 200, body, { 'Content-Disposition': 'attachment; filename="' + name + '"' });
    }

    if (req.method !== 'POST') return send(res, 404, { ok: false, message: 'No encontrado.' });
    if (!trustedPost(req)) return send(res, 403, { ok: false, message: 'Solicitud rechazada.' });
    const body = await readBody(req, url.pathname === '/api/respaldo' ? MAX_BACKUP_BODY : MAX_BODY);

    if (url.pathname === '/api/configurar') {
      if (!setupRequired()) return send(res, 409, { ok: false, message: 'El acceso ya está configurado. Ingresá con tu usuario.' });
      const problem = passwordProblem(body.password);
      if (problem) return send(res, 400, { ok: false, message: problem });
      const admin = state.users.filter((u) => u.role === 'admin' && u.active !== false)[0];
      if (!admin) return send(res, 409, { ok: false, message: 'No hay una cuenta de Administración activa.' });
      const r1 = D.execute(state, admin, { type: 'usuario.guardar', payload: { id: admin.id, name: body.name, username: body.username, role: 'admin', orgId: null, active: true } }, clock());
      if (!r1.ok) return send(res, 400, r1Public(r1));
      const cred = await makeCred(body.password);
      const r2 = D.execute(r1.state, D.byId(r1.state.users, admin.id), { type: 'usuario.credencial', payload: { id: admin.id, cred } }, clock());
      if (!r2.ok) return send(res, 400, r1Public(r2));
      commit(r2.state, { user: admin.id, role: 'admin', type: 'acceso.configurar', summary: 'Acceso de Administración configurado.', ip });
      newSession(res, req, admin.id);
      log('Acceso de Administración configurado desde ' + ip);
      return send(res, 200, Object.assign({ ok: true, summary: 'Acceso configurado.' }, snapshotForUser(admin.id)));
    }

    if (url.pathname === '/api/ingresar') {
      const username = String(body.username || '').trim().toLowerCase().slice(0, 60);
      const key = ip + '|' + username;
      if (throttled(key)) return send(res, 429, { ok: false, message: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' });
      const user = state.users.filter((u) => u.username === username && u.active !== false && u.cred)[0];
      const cred = user ? user.cred : { salt: '0'.repeat(32), iter: PBKDF2_ITER, hash: '0'.repeat(64) };
      const got = await pbkdf2(String(body.password || ''), cred.salt, cred.iter);
      const ok = !!user && crypto.timingSafeEqual(got, Buffer.from(cred.hash, 'hex'));
      if (!ok) {
        failAttempt(key);
        journalRejected({ user: user ? user.id : null, type: 'acceso.ingresar', code: 'ACCESO_DENEGADO', summary: 'Ingreso fallido para "' + username + '"', ip });
        return send(res, 401, { ok: false, message: 'Usuario o contraseña incorrectos.' });
      }
      attempts.delete(key);
      newSession(res, req, user.id);
      return send(res, 200, Object.assign({ ok: true, summary: 'Hola, ' + user.name + '.' }, snapshotForUser(user.id)));
    }

    if (url.pathname === '/api/salir') {
      if (sess) q.delSession.run(sess.key);
      res.setHeader('Set-Cookie', cookieHeader('', 0));
      return send(res, 200, Object.assign({ ok: true }, snapshotFor({ headers: {} }, null)));
    }

    if (!sess) return send(res, 401, { ok: false, code: 'SIN_SESION', message: 'Tu sesión terminó. Ingresá de nuevo.' });

    if (url.pathname === '/api/contrasena') {
      const target = D.byId(state.users, body.id);
      if (!target) return send(res, 404, { ok: false, message: 'Cuenta inexistente.' });
      const isSelf = target.id === sess.user.id;
      if (!isSelf && sess.user.role !== 'admin') return send(res, 403, { ok: false, message: 'Solo podés cambiar tu propia contraseña.' });
      const problem = passwordProblem(body.password);
      if (problem) return send(res, 400, { ok: false, message: problem });
      if (isSelf) {
        const got = await pbkdf2(String(body.current || ''), sess.user.cred.salt, sess.user.cred.iter);
        if (!crypto.timingSafeEqual(got, Buffer.from(sess.user.cred.hash, 'hex'))) return send(res, 400, { ok: false, message: 'La contraseña actual no es correcta.' });
      }
      const cred = await makeCred(body.password);
      const r = D.execute(state, sess.user, { type: 'usuario.credencial', payload: { id: target.id, cred } }, clock());
      if (!r.ok) return send(res, 400, r1Public(r));
      commit(r.state, { user: sess.user.id, role: sess.user.role, type: 'usuario.credencial', payload: JSON.stringify({ id: target.id }), summary: r.summary, ip });
      // Las otras sesiones de esa cuenta se cierran.
      q.delUserSessions.run(target.id, sess.key);
      return send(res, 200, Object.assign({ ok: true, summary: r.summary }, snapshotFor(req, sessionFrom(req))));
    }

    if (url.pathname === '/api/comando') {
      const type = String(body.type || '');
      if (BLOCKED_COMMANDS[type]) return send(res, 400, { ok: false, code: 'NO_PERMITIDO', message: BLOCKED_COMMANDS[type] });
      const eff = effective(req, sess);
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
      const r = D.execute(state, eff.actor, { type, payload }, clock());
      const base = { user: eff.actor.id, role: eff.actor.role, viewedBy: eff.viewing ? sess.user.id : null, type, payload: forJournal(payload), ip };
      if (r.ok) {
        commit(r.state, Object.assign(base, { summary: r.summary }));
      } else {
        journalRejected(Object.assign(base, { code: r.code, summary: r.message }));
        // Venta perdida: el pedido no se reservó por falta de stock; se registra aparte (la reserva no cambió nada).
        if (type === 'pedido.confirmar' && r.code === 'STOCK_INSUFICIENTE') {
          const f = D.execute(state, eff.actor, { type: 'pedido.registrarFaltante', payload: { orderId: payload.orderId } }, clock());
          if (f.ok) commit(f.state, Object.assign({}, base, { type: 'pedido.registrarFaltante', payload: forJournal({ orderId: payload.orderId }), summary: f.summary }));
        }
      }
      return send(res, r.ok ? 200 : 400, Object.assign(r1Public(r), snapshotFor(req, sess)));
    }

    if (sess.user.role !== 'admin' || req.headers['x-ver-como']) return send(res, 403, { ok: false, message: 'Solo Administración, desde su propia cuenta.' });

    if (url.pathname === '/api/escenario') {
      const builders = { inicial: Seed.buildInicial, demo: Seed.buildDemo, prueba: Seed.buildSeed };
      const build = builders[body.nombre];
      if (!build) return send(res, 400, { ok: false, message: 'Escenario desconocido.' });
      backup('antes-de-' + body.nombre);
      const next = adoptAdmin(build(clock()), sess.user, sess.key);
      const labels = { inicial: 'Catálogo inicial cargado.', demo: 'Demostración cargada (datos ficticios).', prueba: 'Escenario de prueba cargado.' };
      commit(next, { user: sess.user.id, role: 'admin', type: 'datos.escenario', payload: JSON.stringify({ nombre: body.nombre }), summary: labels[body.nombre], ip });
      return send(res, 200, Object.assign({ ok: true, summary: labels[body.nombre] }, snapshotFor({ headers: {} }, sessionFrom(req))));
    }

    if (url.pathname === '/api/respaldo') {
      const imp = D.importBackup(body.backup);
      if (!imp.ok) return send(res, 400, { ok: false, message: 'No se importó. ' + imp.errors.join(' ') });
      backup('antes-de-importar');
      const next = imp.state;
      if (!next.users.some((u) => u.role === 'admin')) return send(res, 400, { ok: false, message: 'El respaldo no tiene una cuenta de Administración.' });
      // Si el respaldo no trae la cuenta en uso, se conserva para no quedar afuera.
      const same = next.users.filter((u) => u.id === sess.user.id && u.role === 'admin' && u.cred)[0];
      const final = same ? next : adoptAdmin(next, sess.user, sess.key);
      if (same) q.delOtherSessions.run(sess.key);
      commit(final, { user: sess.user.id, role: 'admin', type: 'datos.importar', summary: 'Respaldo importado.', ip });
      return send(res, 200, Object.assign({ ok: true, summary: 'Respaldo importado.' }, snapshotFor({ headers: {} }, sessionFrom(req))));
    }

    return send(res, 404, { ok: false, message: 'No encontrado.' });
  }
  function r1Public(r) {
    return r.ok ? { ok: true, summary: r.summary, result: r.result || null } : { ok: false, code: r.code, message: r.message, details: r.details || null };
  }
  function snapshotForUser(userId) {
    const u = D.byId(state.users, userId);
    return { rev, setupRequired: setupRequired(), me: D.publicUser(u), viewAs: null, view: D.viewFor(state, u) };
  }

  // ---------- archivos estáticos ----------

  function serveStatic(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const rel = path.normalize(p).replace(/^[\\/]+/, '').replace(/\\/g, '/');
    if (rel.includes('..') || !PUBLIC_PREFIXES.some((a) => rel === a || rel.startsWith(a))) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    const file = path.join(root, rel);
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('No encontrado');
      }
      const ext = path.extname(rel).toLowerCase();
      const cache = ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400';
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
      res.end(data);
    });
  }

  async function handler(req, res) {
    securityHeaders(res);
    let url;
    try { url = new URL(req.url, 'http://local'); } catch (e) { res.writeHead(400); return res.end(); }
    if (url.pathname.startsWith('/api/')) {
      try {
        await api(req, res, url);
      } catch (e) {
        if (!res.headersSent) send(res, e.status || 500, { ok: false, message: e.status ? e.message : 'Error interno del servidor.' });
        if (!e.status) log('Error: ' + (e.stack || e.message));
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  }

  function listen(port, host, tls) {
    const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
    // Conexiones lentas o abandonadas no quedan abiertas para siempre (los avisos en vivo mandan un latido cada 25 s).
    server.headersTimeout = 30000;
    server.requestTimeout = 60000;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(server); });
    });
  }
  function close() {
    clearInterval(heartbeat);
    clearInterval(purgeTimer);
    if (backupTimer) clearInterval(backupTimer);
    listeners.forEach((r) => { try { r.end(); } catch (e) { /* nada */ } });
    db.close();
  }

  return { handler, listen, close, backup, getState: () => state, getRev: () => rev, db };
}
