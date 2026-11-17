/*
 * Servidor propio de Yvy Guaraní (computadora local o VPS): API, archivos de la página y avisos en vivo.
 *
 * - La API es la de server/nucleo.mjs, la misma que corre en Vercel; acá se guarda en SQLite (almacen-sqlite.mjs).
 * - Avisos en vivo por Server-Sent Events: cada cambio se avisa al instante a las demás pantallas.
 * - Copias de seguridad automáticas de la base (al iniciar, cada 24 h y antes de reemplazar datos).
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearNucleo, securityHeaders } from './nucleo.mjs';
import { crearAlmacenSqlite } from './almacen-sqlite.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json; charset=utf-8'
};
export const PUBLIC_PREFIXES = ['index.html', 'css/', 'js/', 'assets/'];

/**
 * @param {object} [opts]
 * @param {string} [opts.root]        carpeta del proyecto
 * @param {string} [opts.dataDir]     carpeta de la base SQLite y sus copias
 * @param {object} [opts.store]       otro almacenamiento (los tests usan Postgres en memoria)
 * @param {boolean} [opts.secureCookie] @param {boolean} [opts.trustProxy] @param {boolean} [opts.skipBackups]
 * @param {string} [opts.setupCode]   código exigido para el primer acceso
 */
export function createApp(opts = {}) {
  const root = path.resolve(opts.root || fileURLToPath(new URL('..', import.meta.url)));
  const dataDir = path.resolve(opts.dataDir || path.join(root, 'data'));
  const clock = opts.now || (() => new Date());
  const secureCookie = !!opts.secureCookie;
  const trustProxy = !!opts.trustProxy;
  const log = opts.log || (() => {});
  if (!opts.store) fs.mkdirSync(dataDir, { recursive: true });
  const store = opts.store || crearAlmacenSqlite({ dataDir });

  // ---------- cambios en vivo ----------

  const listeners = new Set();
  function broadcast(rev) {
    const msg = 'event: cambio\ndata: ' + JSON.stringify({ rev }) + '\n\n';
    listeners.forEach((res) => { try { res.write(msg); } catch (e) { listeners.delete(res); } });
  }
  const heartbeat = setInterval(() => listeners.forEach((res) => { try { res.write(': latido\n\n'); } catch (e) { listeners.delete(res); } }), 25000);
  heartbeat.unref();

  const core = crearNucleo({
    store, now: clock, log, secureCookie, setupCode: opts.setupCode, initialState: opts.initialState,
    eventos: 'vivo', dailyBackup: false, onChange: broadcast
  });

  // ---------- tareas periódicas ----------

  const timers = [];
  function every(ms, fn) {
    const t = setInterval(() => { Promise.resolve().then(fn).catch((e) => log('Error: ' + e.message)); }, ms);
    t.unref();
    timers.push(t);
  }
  every(3600 * 1000, () => store.purgeSessions(clock().toISOString()));
  if (!opts.skipBackups) every(24 * 3600 * 1000, () => core.backup('diaria'));

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
  function readText(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(Object.assign(new Error('El envío es demasiado grande.'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  function setHeaders(res, headers) {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  }

  async function api(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/eventos') {
      await core.ready();
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 4000\nevent: cambio\ndata: ' + JSON.stringify({ rev: core.getRev() }) + '\n\n');
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }
    const out = await core.handle({
      method: req.method,
      path: url.pathname,
      headers: req.headers,
      ip: ipOf(req),
      text: (limit) => readText(req, limit)
    });
    const data = Buffer.from(out.body);
    setHeaders(res, out.headers);
    res.setHeader('Content-Length', data.length);
    res.writeHead(out.status);
    res.end(data);
  }

  // ---------- archivos estáticos ----------

  function serveStatic(req, res, url) {
    let p;
    try { p = decodeURIComponent(url.pathname); } catch (e) { p = '/'; }
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
    setHeaders(res, securityHeaders(secureCookie));
    let url;
    try { url = new URL(req.url, 'http://local'); } catch (e) { res.writeHead(400); return res.end(); }
    if (url.pathname.startsWith('/api/')) {
      try {
        await api(req, res, url);
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(e.status || 500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, message: e.status ? e.message : 'Error interno del servidor.' }));
        }
        if (!e.status) log('Error: ' + (e.stack || e.message));
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  }

  async function listen(port, host, tls) {
    // Valida la base antes de abrir el puerto: si está dañada, el servidor no arranca.
    await core.ready();
    if (!opts.skipBackups) await core.backup('inicio');
    await store.purgeSessions(clock().toISOString());
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
    timers.forEach(clearInterval);
    listeners.forEach((r) => { try { r.end(); } catch (e) { /* nada */ } });
    if (store.close) store.close();
  }

  return { handler, listen, close, backup: core.backup, getState: core.getState, getRev: core.getRev, store, db: store.db };
}
