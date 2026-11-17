/*
 * Núcleo de la API de Yvy Guaraní, independiente de dónde corre.
 *
 * Lo usan el servidor propio (server/app.mjs, con SQLite) y la función de Vercel (api/index.mjs, con Postgres).
 * El almacenamiento llega como "store" con la misma interfaz en los dos casos (ver almacen-sqlite.mjs y almacen-postgres.mjs).
 *
 * - El estado completo se guarda como una sola fila con número de revisión. Cada cambio se calcula con las reglas
 *   de js/domain.js y se graba solo si nadie cambió la base mientras tanto (misma revisión); si alguien la cambió,
 *   se vuelve a leer y se calcula de nuevo. Así dos reservas simultáneas nunca venden el mismo stock, aunque lleguen
 *   a dos copias distintas del servidor.
 * - El estado nuevo y su registro en el diario se graban juntos o no se graba ninguno.
 * - Cada cuenta recibe solo lo suyo (D.viewFor). Contraseñas con PBKDF2; sesiones en cookie HttpOnly y en la base
 *   solo el hash del token.
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../js/domain.js');
const Seed = require('../js/seed.js');

export const COOKIE = 'yvy_sesion';
const SESSION_DAYS = 14;
const PBKDF2_ITER = 210000;
export const MAX_BODY = 2 * 1024 * 1024;
export const MAX_BACKUP_BODY = 16 * 1024 * 1024;
const LOGIN_WINDOW_MS = 15 * 60000;
const LOGIN_MAX_FAILS = 8;
const MAX_RETRIES = 6;
const BLOCKED_COMMANDS = { 'usuario.credencial': 'Para contraseñas usá el formulario de acceso.' };
export const CSP = "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; frame-src https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function sha256(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }
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
function sameSecret(a, b) {
  return crypto.timingSafeEqual(Buffer.from(sha256(a), 'hex'), Buffer.from(sha256(b), 'hex'));
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
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function publicResult(r) {
  return r.ok ? { ok: true, summary: r.summary, result: r.result || null } : { ok: false, code: r.code, message: r.message, details: r.details || null };
}
export function securityHeaders(secure) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': CSP
  };
  if (secure) h['Strict-Transport-Security'] = 'max-age=15552000';
  return h;
}

/**
 * @param {object} o
 * @param {object} o.store         almacenamiento (SQLite o Postgres)
 * @param {Function} [o.now]       reloj
 * @param {Function} [o.log]
 * @param {boolean} [o.secureCookie]  cookie Secure y HSTS (https)
 * @param {string} [o.setupCode]   si está definido, el primer acceso exige este código
 * @param {'vivo'|'consulta'} [o.eventos]  cómo se entera la pantalla de los cambios de otros
 * @param {boolean} [o.dailyBackup]  copia diaria dentro de la base al primer cambio de cada día (Postgres)
 * @param {Function} [o.initialState]
 * @param {Function} [o.onChange]  se llama con la revisión nueva después de cada cambio grabado
 */
export function crearNucleo(o) {
  const store = o.store;
  const clock = o.now || (() => new Date());
  const log = o.log || (() => {});
  const secureCookie = !!o.secureCookie;
  const setupCode = o.setupCode ? String(o.setupCode) : '';
  const eventos = o.eventos || 'vivo';
  const onChange = o.onChange || (() => {});
  const iso = () => clock().toISOString();

  // ---------- estado ----------

  let cache = null; // { rev, state }
  let readyPromise = null;

  function parseState(text, strict) {
    const parsed = JSON.parse(text);
    if (!strict && parsed.schemaVersion === D.SCHEMA_VERSION) return parsed;
    const imp = D.importBackup({ app: D.APP_ID, kind: 'respaldo-de-prueba', schemaVersion: parsed.schemaVersion, state: parsed });
    if (!imp.ok) throw new Error('La base no pasó la validación: ' + imp.errors.join(' '));
    return imp.state;
  }
  /** Prepara la base (tablas y estado inicial) y valida el estado guardado. Si falla, se reintenta en el próximo pedido. */
  function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
        await store.init(D.SCHEMA_VERSION, () => JSON.stringify((o.initialState || Seed.buildInicial)(clock())), iso());
        await current();
      })().catch((e) => { readyPromise = null; throw e; });
    }
    return readyPromise;
  }
  /** Estado vigente: solo se vuelve a leer completo si otra copia del servidor lo cambió. */
  async function current() {
    const r = await store.load(cache ? cache.rev : -1);
    if (!r) throw new Error('La base no tiene estado.');
    if (r.datos == null && cache && r.rev === cache.rev) return cache;
    cache = { rev: r.rev, state: parseState(r.datos, !cache) };
    return cache;
  }
  /**
   * Aplica un cambio: build(state) devuelve { next, entry } para grabar, o cualquier otra cosa para no grabar.
   * Si la base cambió entre la lectura y la grabación, se recalcula sobre el estado nuevo.
   */
  async function mutate(build) {
    for (let i = 0; i < MAX_RETRIES; i++) {
      const cur = await current();
      const out = build(cur.state, cur.rev) || {};
      if (!out.next) return Object.assign(out, { rev: cur.rev });
      const entry = Object.assign({ fecha: iso() }, out.entry);
      const nextRev = await store.commit(cur.rev, D.SCHEMA_VERSION, JSON.stringify(out.next), entry, iso());
      if (nextRev != null) {
        cache = { rev: nextRev, state: out.next };
        onChange(nextRev);
        if (o.dailyBackup) await dailyBackup();
        return Object.assign(out, { rev: nextRev });
      }
    }
    throw httpError(503, 'Hay muchos cambios al mismo tiempo. Probá de nuevo en unos segundos.');
  }
  async function journalRejected(entry) {
    await store.journal(Object.assign({ fecha: iso(), ok: 0, rev: cache ? cache.rev : null }, entry));
  }

  // ---------- copias de seguridad ----------

  async function backup(reason) {
    const name = await store.backup(reason || '', iso());
    if (name) log('Copia de seguridad: ' + name);
    return name;
  }
  let lastDailyCheck = 0;
  async function dailyBackup() {
    const nowMs = clock().getTime();
    if (nowMs - lastDailyCheck < 3600000) return;
    lastDailyCheck = nowMs;
    try {
      const name = await store.backupIfOlder('diaria', iso(), new Date(nowMs - 24 * 3600000).toISOString());
      if (name) log('Copia de seguridad: ' + name);
    } catch (e) { log('Error de copia: ' + e.message); }
  }

  // ---------- sesiones ----------

  function header(req, name) { return String(req.headers[name] || ''); }
  function parseCookies(req) {
    const out = {};
    header(req, 'cookie').split(';').forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) {
        try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { /* cookie ilegible: se ignora */ }
      }
    });
    return out;
  }
  function validUser(state, id) {
    const u = id && D.byId(state.users, id);
    return u && u.active !== false && u.cred ? u : null;
  }
  async function sessionFrom(req, state) {
    const token = parseCookies(req)[COOKIE];
    if (!token || token.length > 100) return null;
    const key = sha256(token);
    const s = await store.getSession(key);
    if (!s) return null;
    const now = clock();
    if (s.vence < now.toISOString()) { await store.delSession(key); return null; }
    const user = validUser(state, s.usuario);
    if (!user) return null;
    // La última actividad se anota como mucho cada 5 minutos, para no escribir en la base en cada consulta.
    if (!s.ultima || Date.parse(s.ultima) < now.getTime() - 5 * 60000) await store.touchSession(key, now.toISOString());
    return { key, userId: user.id };
  }
  function cookieHeader(token, maxAge) {
    return COOKIE + '=' + (token || '') + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secureCookie ? '; Secure' : '');
  }
  async function newSession(req, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = clock();
    const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
    const key = sha256(token);
    await store.putSession({ token: key, usuario: userId, creada: now.toISOString(), vence: expires.toISOString(), ultima: now.toISOString(), agente: header(req, 'user-agent').slice(0, 200) });
    return { key, cookie: cookieHeader(token, SESSION_DAYS * 86400) };
  }
  async function throttled(key) {
    const a = await store.getAttempt(key);
    if (!a) return false;
    if (clock().getTime() - a.desde > LOGIN_WINDOW_MS) return false;
    return a.fallos >= LOGIN_MAX_FAILS;
  }
  async function housekeeping() {
    try {
      await store.purgeSessions(iso());
      await store.purgeAttempts(clock().getTime() - LOGIN_WINDOW_MS);
    } catch (e) { /* se reintenta en el próximo ingreso */ }
  }

  // ---------- vistas ----------

  function setupRequired(state) {
    return !state.users.some((u) => u.role === 'admin' && u.active !== false && u.cred);
  }
  /** Cuenta efectiva: Administración puede pedir ver el sistema como otra cuenta. */
  function effective(state, req, userId) {
    const me = validUser(state, userId);
    if (!me) return { me: null, actor: null, viewing: null };
    const wanted = header(req, 'x-ver-como');
    if (wanted && me.role === 'admin' && wanted !== me.id) {
      const v = D.byId(state.users, wanted);
      if (v && v.active !== false) return { me, actor: Object.assign({}, v, { name: v.name + ' (vista de ' + me.name + ')' }), viewing: v };
    }
    return { me, actor: me, viewing: null };
  }
  const NO_HEADERS = { headers: {} };
  function snapshot(req, userId) {
    const state = cache.state;
    const eff = effective(state, req, userId);
    const need = setupRequired(state);
    return {
      rev: cache.rev,
      setupRequired: need,
      setupCode: need && !!setupCode,
      eventos,
      me: eff.me ? D.publicUser(eff.me) : null,
      viewAs: eff.viewing ? D.publicUser(eff.viewing) : null,
      view: D.viewFor(state, eff.viewing || eff.me || null)
    };
  }
  /** Conserva la cuenta de Administración en uso cuando se reemplazan todos los datos. Devuelve el id que queda. */
  function adoptAdmin(next, me) {
    const target = next.users.filter((u) => u.role === 'admin')[0];
    next.users.forEach((u) => { if (u !== target && u.username === me.username) u.username = u.username + '.2'; });
    target.name = me.name;
    target.username = me.username;
    target.cred = D.clone(me.cred);
    return target.id;
  }

  // ---------- respuestas ----------

  function json(status, body, extra) {
    return {
      status,
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, securityHeaders(secureCookie), extra || {}),
      body: JSON.stringify(body)
    };
  }
  /** Contra envíos desde otros sitios: los POST deben ser JSON y traer el encabezado propio de la aplicación. */
  function trustedPost(req) {
    return header(req, 'content-type').startsWith('application/json') && header(req, 'x-yvy') === '1';
  }
  async function readJson(req, limit) {
    const text = await req.text(limit);
    if (!text) return {};
    try {
      const v = JSON.parse(text);
      return v && typeof v === 'object' ? v : {};
    } catch (e) { throw httpError(400, 'Datos con formato inválido.'); }
  }

  // ---------- API ----------

  async function api(req) {
    const route = req.method + ' ' + req.path;
    if (route === 'GET /api/rev') return json(200, { ok: true, rev: await store.rev() });

    const cur = await current();
    if (route === 'GET /api/salud') return json(200, { ok: true, rev: cur.rev });
    const sess = await sessionFrom(req, cur.state);
    const me = sess ? validUser(cache.state, sess.userId) : null;
    const ip = req.ip || '';

    if (route === 'GET /api/estado') return json(200, snapshot(req, sess && sess.userId));
    if (route === 'GET /api/respaldo') {
      if (!me || me.role !== 'admin') return json(403, { ok: false, message: 'Solo Administración puede descargar el respaldo.' });
      const name = 'yvy-respaldo-' + D.localDate(clock()) + '.json';
      return json(200, D.exportBackup(cache.state, clock()), { 'Content-Disposition': 'attachment; filename="' + name + '"' });
    }

    if (req.method !== 'POST') return json(404, { ok: false, message: 'No encontrado.' });
    if (!trustedPost(req)) return json(403, { ok: false, message: 'Solicitud rechazada.' });
    const body = await readJson(req, req.path === '/api/respaldo' ? MAX_BACKUP_BODY : MAX_BODY);

    if (req.path === '/api/configurar') {
      if (!setupRequired(cache.state)) return json(409, { ok: false, message: 'El acceso ya está configurado. Ingresá con tu usuario.' });
      if (setupCode) {
        const key = 'configurar|' + ip;
        if (await throttled(key)) return json(429, { ok: false, message: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' });
        if (!sameSecret(String(body.codigo || ''), setupCode)) {
          await store.failAttempt(key, clock().getTime(), clock().getTime() - LOGIN_WINDOW_MS);
          await journalRejected({ type: 'acceso.configurar', code: 'CODIGO_INVALIDO', summary: 'Código de configuración incorrecto.', ip });
          return json(403, { ok: false, code: 'CODIGO_INVALIDO', message: 'El código de configuración no es correcto.' });
        }
      }
      const problem = passwordProblem(body.password);
      if (problem) return json(400, { ok: false, message: problem });
      const cred = await makeCred(body.password);
      const out = await mutate((state) => {
        if (!setupRequired(state)) return { status: 409, body: { ok: false, message: 'El acceso ya está configurado. Ingresá con tu usuario.' } };
        const admin = state.users.filter((u) => u.role === 'admin' && u.active !== false)[0];
        if (!admin) return { status: 409, body: { ok: false, message: 'No hay una cuenta de Administración activa.' } };
        const r1 = D.execute(state, admin, { type: 'usuario.guardar', payload: { id: admin.id, name: body.name, username: body.username, role: 'admin', orgId: null, active: true } }, clock());
        if (!r1.ok) return { status: 400, body: publicResult(r1) };
        const r2 = D.execute(r1.state, D.byId(r1.state.users, admin.id), { type: 'usuario.credencial', payload: { id: admin.id, cred } }, clock());
        if (!r2.ok) return { status: 400, body: publicResult(r2) };
        return { next: r2.state, adminId: admin.id, entry: { user: admin.id, role: 'admin', type: 'acceso.configurar', summary: 'Acceso de Administración configurado.', ip } };
      });
      if (!out.next) return json(out.status, out.body);
      const s = await newSession(req, out.adminId);
      log('Acceso de Administración configurado desde ' + ip);
      return json(200, Object.assign({ ok: true, summary: 'Acceso configurado.' }, snapshot(NO_HEADERS, out.adminId)), { 'Set-Cookie': s.cookie });
    }

    if (req.path === '/api/ingresar') {
      const username = String(body.username || '').trim().toLowerCase().slice(0, 60);
      const key = ip + '|' + username;
      if (await throttled(key)) return json(429, { ok: false, message: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' });
      const user = cache.state.users.filter((u) => u.username === username && u.active !== false && u.cred)[0];
      const cred = user ? user.cred : { salt: '0'.repeat(32), iter: PBKDF2_ITER, hash: '0'.repeat(64) };
      const got = await pbkdf2(String(body.password || ''), cred.salt, cred.iter);
      const ok = !!user && crypto.timingSafeEqual(got, Buffer.from(cred.hash, 'hex'));
      if (!ok) {
        await store.failAttempt(key, clock().getTime(), clock().getTime() - LOGIN_WINDOW_MS);
        await journalRejected({ user: user ? user.id : null, type: 'acceso.ingresar', code: 'ACCESO_DENEGADO', summary: 'Ingreso fallido para "' + username + '"', ip });
        return json(401, { ok: false, message: 'Usuario o contraseña incorrectos.' });
      }
      await store.clearAttempt(key);
      const s = await newSession(req, user.id);
      await housekeeping();
      return json(200, Object.assign({ ok: true, summary: 'Hola, ' + user.name + '.' }, snapshot(NO_HEADERS, user.id)), { 'Set-Cookie': s.cookie });
    }

    if (req.path === '/api/salir') {
      if (sess) await store.delSession(sess.key);
      return json(200, Object.assign({ ok: true }, snapshot(NO_HEADERS, null)), { 'Set-Cookie': cookieHeader('', 0) });
    }

    if (!sess || !me) return json(401, { ok: false, code: 'SIN_SESION', message: 'Tu sesión terminó. Ingresá de nuevo.' });

    if (req.path === '/api/contrasena') {
      const target = D.byId(cache.state.users, body.id);
      if (!target) return json(404, { ok: false, message: 'Cuenta inexistente.' });
      const isSelf = target.id === me.id;
      if (!isSelf && me.role !== 'admin') return json(403, { ok: false, message: 'Solo podés cambiar tu propia contraseña.' });
      const problem = passwordProblem(body.password);
      if (problem) return json(400, { ok: false, message: problem });
      if (isSelf) {
        const got = await pbkdf2(String(body.current || ''), me.cred.salt, me.cred.iter);
        if (!crypto.timingSafeEqual(got, Buffer.from(me.cred.hash, 'hex'))) return json(400, { ok: false, message: 'La contraseña actual no es correcta.' });
      }
      const cred = await makeCred(body.password);
      const out = await mutate((state) => {
        const actor = validUser(state, sess.userId);
        if (!actor) return { status: 401, body: { ok: false, code: 'SIN_SESION', message: 'Tu sesión terminó. Ingresá de nuevo.' } };
        const r = D.execute(state, actor, { type: 'usuario.credencial', payload: { id: target.id, cred } }, clock());
        if (!r.ok) return { status: 400, body: publicResult(r) };
        return { next: r.state, r, entry: { user: actor.id, role: actor.role, type: 'usuario.credencial', payload: JSON.stringify({ id: target.id }), summary: r.summary, ip } };
      });
      if (!out.next) return json(out.status, out.body);
      // Las otras sesiones de esa cuenta se cierran.
      await store.delUserSessions(target.id, sess.key);
      return json(200, Object.assign({ ok: true, summary: out.r.summary }, snapshot(req, sess.userId)));
    }

    if (req.path === '/api/comando') {
      const type = String(body.type || '');
      if (BLOCKED_COMMANDS[type]) return json(400, { ok: false, code: 'NO_PERMITIDO', message: BLOCKED_COMMANDS[type] });
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
      const out = await mutate((state) => {
        const eff = effective(state, req, sess.userId);
        if (!eff.actor) return { r: { ok: false, code: 'SIN_SESION', message: 'Tu sesión terminó. Ingresá de nuevo.' } };
        const r = D.execute(state, eff.actor, { type, payload }, clock());
        const base = { user: eff.actor.id, role: eff.actor.role, viewedBy: eff.viewing ? sess.userId : null, type, payload: forJournal(payload), ip };
        if (!r.ok) return { r, base };
        return { next: r.state, r, entry: Object.assign({}, base, { summary: r.summary }) };
      });
      const r = out.r;
      if (!r.ok && out.base) {
        await journalRejected(Object.assign({}, out.base, { code: r.code, summary: r.message }));
        // Venta perdida: el pedido no se reservó por falta de stock; se registra aparte (la reserva no cambió nada).
        if (type === 'pedido.confirmar' && r.code === 'STOCK_INSUFICIENTE') {
          await mutate((state) => {
            const eff = effective(state, req, sess.userId);
            if (!eff.actor) return null;
            const f = D.execute(state, eff.actor, { type: 'pedido.registrarFaltante', payload: { orderId: payload.orderId } }, clock());
            if (!f.ok) return null;
            return { next: f.state, entry: Object.assign({}, out.base, { type: 'pedido.registrarFaltante', payload: forJournal({ orderId: payload.orderId }), summary: f.summary }) };
          });
        }
      }
      return json(r.ok ? 200 : (r.code === 'SIN_SESION' ? 401 : 400), Object.assign(publicResult(r), snapshot(req, sess.userId)));
    }

    if (me.role !== 'admin' || header(req, 'x-ver-como')) return json(403, { ok: false, message: 'Solo Administración, desde su propia cuenta.' });

    if (req.path === '/api/escenario') {
      const builders = { inicial: Seed.buildInicial, demo: Seed.buildDemo, prueba: Seed.buildSeed };
      const build = builders[body.nombre];
      if (!build) return json(400, { ok: false, message: 'Escenario desconocido.' });
      await backup('antes-de-' + body.nombre);
      const next = build(clock());
      const keepId = adoptAdmin(next, me);
      const labels = { inicial: 'Catálogo inicial cargado.', demo: 'Demostración cargada (datos ficticios).', prueba: 'Escenario de prueba cargado.' };
      await mutate(() => ({ next, entry: { user: me.id, role: 'admin', type: 'datos.escenario', payload: JSON.stringify({ nombre: body.nombre }), summary: labels[body.nombre], ip } }));
      await store.delOtherSessions(sess.key);
      await store.moveSession(sess.key, keepId);
      return json(200, Object.assign({ ok: true, summary: labels[body.nombre] }, snapshot(NO_HEADERS, keepId)));
    }

    if (req.path === '/api/respaldo') {
      const imp = D.importBackup(body.backup);
      if (!imp.ok) return json(400, { ok: false, message: 'No se importó. ' + imp.errors.join(' ') });
      const next = imp.state;
      if (!next.users.some((u) => u.role === 'admin')) return json(400, { ok: false, message: 'El respaldo no tiene una cuenta de Administración.' });
      await backup('antes-de-importar');
      // Si el respaldo no trae la cuenta en uso, se conserva para no quedar afuera.
      const same = next.users.filter((u) => u.id === me.id && u.role === 'admin' && u.cred)[0];
      const keepId = same ? me.id : adoptAdmin(next, me);
      await mutate(() => ({ next, entry: { user: me.id, role: 'admin', type: 'datos.importar', summary: 'Respaldo importado.', ip } }));
      await store.delOtherSessions(sess.key);
      if (!same) await store.moveSession(sess.key, keepId);
      return json(200, Object.assign({ ok: true, summary: 'Respaldo importado.' }, snapshot(NO_HEADERS, keepId)));
    }

    return json(404, { ok: false, message: 'No encontrado.' });
  }

  /**
   * Atiende un pedido a /api/…
   * @param {{ method: string, path: string, headers: Object<string,string>, ip: string, text: (limit:number)=>Promise<string> }} req
   *   headers con nombres en minúscula; text() lee el cuerpo y falla con status 413 si supera el límite.
   * @returns {Promise<{ status: number, headers: Object<string,string>, body: string }>}
   */
  async function handle(req) {
    try {
      await ready();
      return await api(req);
    } catch (e) {
      if (!e.status) log('Error: ' + (e.stack || e.message));
      return json(e.status || 500, { ok: false, message: e.status ? e.message : 'Error interno del servidor.' });
    }
  }

  return {
    handle,
    ready,
    backup,
    getState: () => (cache ? cache.state : null),
    getRev: () => (cache ? cache.rev : 0)
  };
}
