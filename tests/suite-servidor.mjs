// Pruebas del servidor: acceso, permisos en el servidor, concurrencia, persistencia, diario, archivos y avisos en vivo.
// Las comparten los dos almacenamientos: SQLite (servidor propio) y Postgres (Vercel).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../server/app.mjs';

export function client(base) {
  let cookie = '';
  const call = async (method, p, body, headers) => {
    const res = await fetch(base + p, {
      method,
      headers: Object.assign(body !== undefined ? { 'Content-Type': 'application/json', 'X-Yvy': '1' } : {}, cookie ? { Cookie: cookie } : {}, headers || {}),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() : null, text: type.includes('json') ? null : await res.text() };
  };
  return {
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b || {}, h),
    raw: (p, init) => fetch(base + p, init),
    cookie: () => cookie,
    setCookie: (c) => { cookie = c; }
  };
}
export const userBy = (view, username) => view.users.find((u) => u.username === username);
export function localDay() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * @param {object} o
 * @param {string} o.nombre                  prefijo de los nombres de las pruebas
 * @param {(dir: string) => object} [o.opciones]  opciones extra de createApp (p. ej. otro almacenamiento)
 * @param {() => Promise<void>} [o.antes]    @param {() => Promise<void>} [o.despues]
 */
export function pruebasServidor(o) {
  const ADMIN_PW = crypto.randomBytes(9).toString('hex');
  const CLIENT_PW = crypto.randomBytes(9).toString('hex');
  const t = (name, fn) => test(o.nombre + ' · ' + name, fn);

  async function start(dataDir) {
    const app = createApp(Object.assign({ dataDir, skipBackups: true }, o.opciones ? o.opciones(dataDir) : {}));
    const server = await app.listen(0, '127.0.0.1');
    const base = 'http://127.0.0.1:' + server.address().port;
    return { app, server, base, stop: () => new Promise((r) => { app.close(); server.close(r); server.closeAllConnections(); }) };
  }

  let dir, srv, admin;
  test.before(async () => {
    if (o.antes) await o.antes();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yvy-test-'));
    srv = await start(dir);
    admin = client(srv.base);
  });
  test.after(async () => {
    await srv.stop();
    if (o.despues) await o.despues();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  t('primer acceso: solo una vez, con contraseña válida y cookie protegida', async () => {
    let r = await admin.get('/api/estado');
    assert.equal(r.json.setupRequired, true);
    assert.equal(r.json.view.products.length, 51);
    assert.ok(r.json.view.products.every((p) => p.pricing.precioAlmacen === null));
    r = await admin.raw('/api/configurar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A', username: 'admin', password: ADMIN_PW }) });
    assert.equal(r.status, 403, 'sin el encabezado propio se rechaza');
    r = await admin.post('/api/configurar', { name: 'Administración', username: 'admin', password: 'corta' });
    assert.equal(r.status, 400);
    r = await admin.post('/api/configurar', { name: 'Administración', username: 'admin', password: ADMIN_PW });
    assert.equal(r.status, 200);
    const setCookie = r.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.equal(r.json.me.role, 'admin');
    assert.equal(r.json.setupRequired, false);
    assert.ok(!JSON.stringify(r.json).includes('"hash"'));
    r = await client(srv.base).post('/api/configurar', { name: 'Intruso', username: 'x', password: 'otra-clave-larga' });
    assert.equal(r.status, 409);
  });

  t('escenario y cuentas: Administración carga datos y da acceso a clientes', async () => {
    let r = await admin.post('/api/escenario', { nombre: 'prueba' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.me.username, 'admin', 'se conserva la cuenta en uso');
    const uno = userBy(r.json.view, 'uno');
    const dos = userBy(r.json.view, 'dos');
    for (const u of [uno, dos]) {
      r = await admin.post('/api/contrasena', { id: u.id, password: CLIENT_PW });
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    r = await admin.post('/api/comando', { type: 'usuario.credencial', payload: { id: uno.id, cred: null } });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'NO_PERMITIDO');
  });

  t('ingreso: error genérico y límite de intentos', async () => {
    const c = client(srv.base);
    let r = await c.post('/api/ingresar', { username: 'uno', password: 'incorrecta-1' });
    assert.equal(r.status, 401);
    assert.equal(r.json.message, 'Usuario o contraseña incorrectos.');
    r = await c.post('/api/ingresar', { username: 'no-existe', password: 'x' });
    assert.equal(r.json.message, 'Usuario o contraseña incorrectos.');
    for (let i = 0; i < 8; i++) await c.post('/api/ingresar', { username: 'agronorte', password: 'mala' });
    r = await c.post('/api/ingresar', { username: 'agronorte', password: 'mala' });
    assert.equal(r.status, 429);
  });

  t('permisos en el servidor: cada cuenta recibe y hace solo lo suyo', async () => {
    const uno = client(srv.base);
    let r = await uno.post('/api/ingresar', { username: 'uno', password: CLIENT_PW });
    assert.equal(r.status, 200);
    const v = r.json.view;
    assert.ok(v.products.every((p) => p.pricing.costoProveedor === null));
    assert.equal(v.users.length, 1);
    assert.equal(v.movements.length + v.audit.length, 0);
    r = await uno.post('/api/comando', { type: 'producto.guardar', payload: {} });
    assert.equal(r.json.code, 'SIN_PERMISO');
    r = await uno.post('/api/escenario', { nombre: 'inicial' });
    assert.equal(r.status, 403);
    r = await uno.get('/api/respaldo');
    assert.equal(r.status, 403);
    // Pedir "ver como" sin ser Administración no cambia nada.
    const otro = (await admin.get('/api/estado')).json.view.users.find((u) => u.role === 'comercial');
    r = await uno.get('/api/estado', { 'X-Ver-Como': otro.id });
    assert.equal(r.json.viewAs, null);
    assert.equal(r.json.view.users.length, 1);
    // Sin sesión no hay comandos.
    r = await client(srv.base).post('/api/comando', { type: 'pedido.guardarBorrador', payload: {} });
    assert.equal(r.status, 401);
  });

  t('ver como: Administración ve exactamente lo que ve la otra cuenta y no reemplaza datos mientras mira', async () => {
    const st = (await admin.get('/api/estado')).json.view;
    const uno = userBy(st, 'uno');
    const r = await admin.get('/api/estado', { 'X-Ver-Como': uno.id });
    assert.equal(r.json.viewAs.id, uno.id);
    assert.equal(r.json.me.role, 'admin');
    assert.equal(r.json.view.users.length, 1);
    assert.ok(r.json.view.products.every((p) => p.pricing.costoProveedor === null));
    const r2 = await admin.post('/api/escenario', { nombre: 'prueba' }, { 'X-Ver-Como': uno.id });
    assert.equal(r2.status, 403, 'mientras mira como otra cuenta no puede reemplazar datos');
  });

  t('concurrencia: dos reservas simultáneas no venden el mismo stock', async () => {
    let r = await admin.post('/api/comando', {
      type: 'recepcion.registrar',
      payload: { coopId: 'COOP-ECOAGRO', depositoId: 'DEP-1', sku: 'PAS-REM-300', lotCode: 'SRV-1', qtyReceived: 12, qtyReleased: 12, receivedDate: localDay(), expiry: '2099-01-01', responsible: 'Prueba' }
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const a = client(srv.base);
    const b = client(srv.base);
    await a.post('/api/ingresar', { username: 'uno', password: CLIENT_PW });
    await b.post('/api/ingresar', { username: 'dos', password: CLIENT_PW });
    const ida = (await a.post('/api/comando', { type: 'pedido.guardarBorrador', payload: { lines: [{ sku: 'PAS-REM-300', qty: 8 }] } })).json.result.orderId;
    const idb = (await b.post('/api/comando', { type: 'pedido.guardarBorrador', payload: { lines: [{ sku: 'PAS-REM-300', qty: 8 }] } })).json.result.orderId;
    const [ra, rb] = await Promise.all([
      a.post('/api/comando', { type: 'pedido.confirmar', payload: { orderId: ida } }),
      b.post('/api/comando', { type: 'pedido.confirmar', payload: { orderId: idb } })
    ]);
    const oks = [ra, rb].filter((x) => x.json.ok);
    const fails = [ra, rb].filter((x) => !x.json.ok);
    assert.equal(oks.length, 1);
    assert.equal(fails[0].json.code, 'STOCK_INSUFICIENTE');
    const full = (await admin.get('/api/estado')).json.view;
    const lot = full.lots.find((l) => l.code === 'SRV-1');
    assert.equal(lot.reserved, 8);
    assert.equal(full.shortages.length, 1, 'la venta perdida queda registrada en el servidor');
    // Cada cliente ve solo su pedido.
    const va = (await a.get('/api/estado')).json.view;
    assert.ok(va.orders.every((x) => x.almacenId === userBy(full, 'uno').orgId));
  });

  t('contraseña: cambiarla exige la actual y cierra las otras sesiones de esa cuenta', async () => {
    const s1 = client(srv.base);
    const s2 = client(srv.base);
    await s1.post('/api/ingresar', { username: 'dos', password: CLIENT_PW });
    await s2.post('/api/ingresar', { username: 'dos', password: CLIENT_PW });
    const me = (await s1.get('/api/estado')).json.me;
    let r = await s1.post('/api/contrasena', { id: me.id, current: 'mala', password: 'nueva-clave-segura' });
    assert.equal(r.status, 400);
    r = await s1.post('/api/contrasena', { id: me.id, current: CLIENT_PW, password: 'nueva-clave-segura' });
    assert.equal(r.status, 200);
    assert.equal((await s1.get('/api/estado')).json.me.id, me.id, 'la sesión actual sigue');
    assert.equal((await s2.get('/api/estado')).json.me, null, 'la otra sesión se cerró');
    r = await s1.post('/api/contrasena', { id: userBy((await admin.get('/api/estado')).json.view, 'uno').id, current: 'x', password: 'otra-clave-larga' });
    assert.equal(r.status, 403);
  });

  t('diario: guarda aceptados y rechazados, sin fotos incrustadas ni contraseñas', async () => {
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(200);
    const st = (await admin.get('/api/estado')).json.view;
    const p = st.products.find((x) => x.sku === 'PAS-ACP-300');
    const r = await admin.post('/api/comando', { type: 'producto.guardar', payload: Object.assign({}, p, { isNew: false, photo }) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const rows = await srv.app.store.journalRows();
    assert.ok(rows.some((x) => x.tipo === 'producto.guardar' && x.ok === 1 && x.datos.includes('[imagen]') && !x.datos.includes('AAAA')));
    assert.ok(rows.some((x) => x.ok === 0 && x.codigo === 'STOCK_INSUFICIENTE'));
    assert.ok(rows.some((x) => x.ok === 0 && x.codigo === 'ACCESO_DENEGADO'));
    assert.ok(!rows.some((x) => (x.datos || '').includes(CLIENT_PW) || (x.datos || '').includes(ADMIN_PW)));
  });

  t('archivos: la base y el código del servidor no se publican; la página lleva encabezados de seguridad', async () => {
    const c = client(srv.base);
    for (const p of ['/data/yvy.db', '/server/app.mjs', '/package.json', '/js/../server/app.mjs', '/%2e%2e/server/app.mjs']) {
      const r = await c.raw(p);
      assert.equal(r.status, 404, p);
    }
    const page = await c.raw('/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal((await c.raw('/assets/productos/eco-2148.jpg')).status, 200);
  });

  t('cambios en vivo: los demás equipos reciben el aviso de cada cambio', async () => {
    const ctrl = new AbortController();
    const res = await fetch(srv.base + '/api/eventos', { signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const first = await reader.read();
    buf += dec.decode(first.value);
    const before = Number(/"rev":(\d+)/.exec(buf)[1]);
    await admin.post('/api/comando', { type: 'config.actualizar', payload: { nearExpiryDays: 21 } });
    let got = null;
    while (!got) {
      const chunk = await reader.read();
      buf += dec.decode(chunk.value);
      const all = [...buf.matchAll(/"rev":(\d+)/g)].map((m) => Number(m[1]));
      if (all.some((n) => n > before)) got = Math.max(...all);
    }
    ctrl.abort();
    assert.ok(got > before);
    // La consulta liviana de revisión (la que usa la pantalla en Vercel) da el mismo número.
    assert.equal((await admin.get('/api/rev')).json.rev, got);
  });

  t('persistencia: al reiniciar el servidor los datos y la sesión siguen', async () => {
    const cookie = admin.cookie();
    const rev = srv.app.getRev();
    const orders = srv.app.getState().orders.length;
    await srv.stop();
    srv = await start(dir);
    admin = client(srv.base);
    admin.setCookie(cookie);
    const r = await admin.get('/api/estado');
    assert.equal(r.json.rev, rev);
    assert.equal(r.json.view.orders.length, orders);
    assert.equal(r.json.me.username, 'admin');
  });

  t('respaldo: se descarga, se valida y se importa conservando la cuenta en uso', async () => {
    const r = await admin.get('/api/respaldo');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment/);
    const backup = r.json;
    let imp = await admin.post('/api/respaldo', { backup: { app: 'otra' } });
    assert.equal(imp.status, 400);
    imp = await admin.post('/api/respaldo', { backup });
    assert.equal(imp.status, 200, JSON.stringify(imp.json));
    assert.equal(imp.json.me.username, 'admin');
  });
}
