/*
 * Simula localmente cómo corre el sistema en Vercel, sin cuenta ni base real:
 * - la página sale de publico/ (el mismo build de Vercel) con los encabezados de vercel.json;
 * - /api/… pasa por la reescritura de vercel.json y llega a la función api/index.mjs;
 * - la base es Postgres en memoria (PGlite, dependencia de desarrollo): se pierde al cerrar.
 *
 * Uso: npm install, y después  node tools/simular-vercel.mjs [--port=4175] [--codigo=CODIGO]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { crearManejador } from '../api/index.mjs';
import { crearNucleo } from '../server/nucleo.mjs';
import { crearAlmacenPostgres } from '../server/almacen-postgres.mjs';
import { crearPglite } from '../tests/pglite.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2)));
const port = Number(args.port) || 4175;
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const extraHeaders = cfg.headers.find((h) => h.source === '/(.*)').headers;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

execFileSync(process.execPath, [path.join(root, 'tools', 'vercel-publico.mjs')], { stdio: 'inherit' });
const db = await crearPglite();
if (!db) { console.error('Falta PGlite: ejecutá npm install.'); process.exit(1); }
const nucleo = crearNucleo({ store: crearAlmacenPostgres(db), secureCookie: false, setupCode: args.codigo || '', eventos: 'consulta', dailyBackup: true, log: console.log });
const handler = crearManejador(async () => nucleo);

http.createServer(async (req, res) => {
  extraHeaders.forEach((h) => { if (h.key !== 'Strict-Transport-Security') res.setHeader(h.key, h.value); });
  const url = new URL(req.url, 'http://localhost:' + port);
  if (url.pathname.startsWith('/api/')) {
    // Igual que la reescritura de vercel.json: /api/:ruta* → /api/index?ruta=:ruta*
    const ruta = url.pathname.slice('/api/'.length);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = Object.assign({}, req.headers, { 'x-real-ip': req.socket.remoteAddress || '' });
    const request = new Request('http://localhost:' + port + '/api/index?ruta=' + encodeURIComponent(ruta), {
      method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks)
    });
    const out = await handler(request);
    out.headers.forEach((v, k) => res.setHeader(k, v));
    res.writeHead(out.status);
    return res.end(Buffer.from(await out.arrayBuffer()));
  }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, 'publico', rel);
  if (!file.startsWith(path.join(root, 'publico')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('No encontrado');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log('Simulación de Vercel en http://localhost:' + port + ' (base en memoria' + (args.codigo ? ', con código de configuración' : '') + ')'));
