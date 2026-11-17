// Publicación en Vercel: la función de api/index.mjs, varias copias de la función sobre la misma base,
// el código del primer acceso, la IP real y la configuración de vercel.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { crearManejador, rutaDe, ipDe } from '../api/index.mjs';
import { crearNucleo, CSP } from '../server/nucleo.mjs';
import { crearAlmacenPostgres } from '../server/almacen-postgres.mjs';
import { crearPglite, hayPglite } from './pglite.mjs';
import { localDay } from './suite-servidor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://yvy.example';
const CODIGO = crypto.randomBytes(6).toString('hex');
const ADMIN_PW = crypto.randomBytes(9).toString('hex');
const CLIENT_PW = crypto.randomBytes(9).toString('hex');

/** Cliente que habla directo con la función, como lo haría el navegador a través de Vercel. */
function cliente(handler, ip) {
  let cookie = '';
  return async function (method, ruta, body, extra) {
    const headers = Object.assign({ 'x-real-ip': ip || '198.51.100.1' }, body !== undefined ? { 'content-type': 'application/json', 'x-yvy': '1' } : {}, cookie ? { cookie } : {}, extra || {});
    const res = await handler(new Request(BASE + ruta, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }));
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, headers: res.headers, json: await res.json() };
  };
}

test('Vercel · la ruta llega reescrita (?ruta=) o directa, y la IP sale de lo que pone Vercel', () => {
  assert.equal(rutaDe(BASE + '/api/index?ruta=estado'), '/api/estado');
  assert.equal(rutaDe(BASE + '/api/index.mjs?ruta=comando'), '/api/comando');
  assert.equal(rutaDe(BASE + '/api/estado'), '/api/estado');
  const req = new Request(BASE + '/api/estado', { headers: { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '10.0.0.1' } });
  assert.equal(ipDe(req), '203.0.113.9');
});

test('Vercel · sin base de datos conectada, la API lo dice con claridad', async () => {
  const handler = crearManejador(async () => null);
  const res = await handler(new Request(BASE + '/api/index?ruta=estado'));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'SIN_BASE');
  assert.match(body.message, /Neon/);
});

test('Vercel · vercel.json publica solo la página y usa los mismos encabezados de seguridad que el servidor', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(cfg.outputDirectory, 'publico');
  assert.ok(cfg.rewrites.some((r) => r.source === '/api/:ruta*' && r.destination.startsWith('/api/index')));
  const all = cfg.headers.find((h) => h.source === '/(.*)').headers;
  assert.equal(all.find((h) => h.key === 'Content-Security-Policy').value, CSP);
  assert.ok(all.some((h) => h.key === 'Strict-Transport-Security'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'yvy-publico-'));
  try {
    execFileSync(process.execPath, [path.join(root, 'tools', 'vercel-publico.mjs'), '--salida=' + out]);
    assert.deepEqual(fs.readdirSync(out).sort(), ['assets', 'css', 'index.html', 'js']);
    assert.ok(fs.existsSync(path.join(out, 'assets', 'productos', 'eco-2148.jpg')));
    assert.ok(!fs.existsSync(path.join(out, 'server')) && !fs.existsSync(path.join(out, 'tests')));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

const conPglite = await hayPglite();

test('Vercel · primer acceso con código, cookie Secure, avisos por consulta y límite de intentos por IP real', { skip: !conPglite && 'falta npm install' }, async () => {
  const db = await crearPglite();
  try {
    const nucleo = crearNucleo({ store: crearAlmacenPostgres(db), secureCookie: true, setupCode: CODIGO, eventos: 'consulta', dailyBackup: true });
    const handler = crearManejador(async () => nucleo);
    const admin = cliente(handler);
    let r = await admin('GET', '/api/index?ruta=estado');
    assert.equal(r.status, 200);
    assert.equal(r.json.eventos, 'consulta');
    assert.equal(r.json.setupCode, true);
    assert.equal(r.headers.get('content-security-policy'), CSP);
    assert.match(r.headers.get('strict-transport-security'), /max-age=/);

    r = await admin('POST', '/api/index?ruta=configurar', { name: 'Administración', username: 'admin', password: ADMIN_PW });
    assert.equal(r.status, 403, 'sin el código no se configura');
    r = await admin('POST', '/api/index?ruta=configurar', { name: 'Administración', username: 'admin', password: ADMIN_PW, codigo: 'otro' });
    assert.equal(r.json.code, 'CODIGO_INVALIDO');
    r = await admin('POST', '/api/index?ruta=configurar', { name: 'Administración', username: 'admin', password: ADMIN_PW, codigo: CODIGO });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.setupCode, false);

    // La IP la pone Vercel (x-real-ip): cambiar X-Forwarded-For no saltea el límite.
    const intruso = cliente(handler, '203.0.113.50');
    for (let i = 0; i < 8; i++) await intruso('POST', '/api/index?ruta=ingresar', { username: 'admin', password: 'mala' }, { 'x-forwarded-for': '10.0.0.' + i });
    r = await intruso('POST', '/api/index?ruta=ingresar', { username: 'admin', password: ADMIN_PW }, { 'x-forwarded-for': '10.9.9.9' });
    assert.equal(r.status, 429);
    r = await cliente(handler, '203.0.113.51')('POST', '/api/index?ruta=ingresar', { username: 'admin', password: ADMIN_PW });
    assert.equal(r.status, 200, 'otra IP no queda bloqueada');

    const before = (await admin('GET', '/api/index?ruta=rev')).json.rev;
    await admin('POST', '/api/index?ruta=comando', { type: 'config.actualizar', payload: { nearExpiryDays: 21 } });
    assert.equal((await admin('GET', '/api/index?ruta=rev')).json.rev, before + 1);

    const big = await admin('POST', '/api/index?ruta=comando', { type: 'config.actualizar', payload: { x: 'a'.repeat(3 * 1024 * 1024) } });
    assert.equal(big.status, 413);

    const copias = await db.query('SELECT motivo FROM respaldos');
    assert.ok(copias.some((c) => c.motivo === 'diaria'), 'copia diaria dentro de la base');
  } finally {
    await db.close();
  }
});

test('Vercel · dos copias de la función sobre la misma base no venden el mismo stock', { skip: !conPglite && 'falta npm install' }, async () => {
  const db = await crearPglite();
  try {
    // Como en Vercel: cada copia tiene su propia memoria; lo único compartido es la base.
    const copiaA = crearManejador(async () => nucleoA);
    const copiaB = crearManejador(async () => nucleoB);
    // En la copia B, justo antes de grabar, se deja que la A grabe primero (el caso difícil, forzado).
    let antesDeGrabarB = null;
    let conflictos = 0;
    const storeB = crearAlmacenPostgres(db);
    const commitB = storeB.commit;
    storeB.commit = async (...args) => {
      if (antesDeGrabarB) { const f = antesDeGrabarB; antesDeGrabarB = null; await f(); }
      const rev = await commitB(...args);
      if (rev == null) conflictos++;
      return rev;
    };
    const nucleoA = crearNucleo({ store: crearAlmacenPostgres(db), secureCookie: true, eventos: 'consulta' });
    const nucleoB = crearNucleo({ store: storeB, secureCookie: true, eventos: 'consulta' });
    const admin = cliente(copiaA);
    assert.equal((await admin('POST', '/api/configurar', { name: 'Administración', username: 'admin', password: ADMIN_PW })).status, 200);
    let r = await admin('POST', '/api/escenario', { nombre: 'prueba' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    for (const u of r.json.view.users.filter((x) => x.username === 'uno' || x.username === 'dos')) {
      assert.equal((await admin('POST', '/api/contrasena', { id: u.id, password: CLIENT_PW })).status, 200);
    }
    r = await admin('POST', '/api/comando', {
      type: 'recepcion.registrar',
      payload: { coopId: 'COOP-ECOAGRO', depositoId: 'DEP-1', sku: 'PAS-REM-300', lotCode: 'VER-1', qtyReceived: 12, qtyReleased: 12, receivedDate: localDay(), expiry: '2099-01-01', responsible: 'Prueba' }
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));

    // La copia B arranca con lo que grabó la A.
    const uno = cliente(copiaA, '198.51.100.11');
    const dos = cliente(copiaB, '198.51.100.12');
    assert.equal((await uno('POST', '/api/ingresar', { username: 'uno', password: CLIENT_PW })).status, 200);
    r = await dos('POST', '/api/ingresar', { username: 'dos', password: CLIENT_PW });
    assert.equal(r.status, 200, 'la copia B ve las cuentas creadas en la A');
    const ida = (await uno('POST', '/api/comando', { type: 'pedido.guardarBorrador', payload: { lines: [{ sku: 'PAS-REM-300', qty: 8 }] } })).json.result.orderId;
    const idb = (await dos('POST', '/api/comando', { type: 'pedido.guardarBorrador', payload: { lines: [{ sku: 'PAS-REM-300', qty: 8 }] } })).json.result.orderId;
    // B calcula su reserva con 12 unidades libres; antes de que grabe, A reserva 8 y graba.
    let ra = null;
    antesDeGrabarB = async () => { ra = await uno('POST', '/api/comando', { type: 'pedido.confirmar', payload: { orderId: ida } }); };
    const rb = await dos('POST', '/api/comando', { type: 'pedido.confirmar', payload: { orderId: idb } });
    assert.equal(ra.json.ok, true, JSON.stringify(ra.json));
    assert.equal(conflictos, 1, 'B encontró la base cambiada y no grabó su cálculo viejo');
    assert.equal(rb.json.code, 'STOCK_INSUFICIENTE', 'al recalcular con el stock nuevo, B rechaza');
    const full = (await cliente(copiaB)('GET', '/api/estado', undefined, { cookie: '' })).json;
    assert.equal(full.view.lots.length, 0, 'sin sesión no se ve stock');
    const vista = (await admin('GET', '/api/estado')).json.view;
    assert.equal(vista.lots.find((l) => l.code === 'VER-1').reserved, 8);
    assert.equal(vista.shortages.length, 1);
  } finally {
    await db.close();
  }
});
