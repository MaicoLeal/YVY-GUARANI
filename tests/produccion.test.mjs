// Modo producción: https directo, cookie Secure + HSTS detrás de proxy, IP real del cliente y arranque.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cert = fs.readFileSync(path.join(here, 'fixtures', 'localhost-cert.pem'));
const key = fs.readFileSync(path.join(here, 'fixtures', 'localhost-key.pem'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yvy-prod-'));

function httpsRequest(port, p, opts = {}) {
  return new Promise((resolve, reject) => {
    // Sin verificar la cadena: en equipos con antivirus que inspecciona https (p. ej. Norton) el certificado de prueba se reemplaza.
    const req = https.request({ host: '127.0.0.1', port, path: p, method: opts.method || 'GET', rejectUnauthorized: false, servername: 'localhost', headers: opts.headers || {} }, (res) => {
      const encrypted = !!(res.socket && res.socket.encrypted);
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, encrypted }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test('https directo: conexión cifrada, cookie Secure y HSTS', async () => {
  const dir = tmp();
  const app = createApp({ dataDir: dir, skipBackups: true, secureCookie: true });
  const server = await app.listen(0, '127.0.0.1', { cert, key });
  const port = server.address().port;
  try {
    const page = await httpsRequest(port, '/');
    assert.equal(page.status, 200);
    assert.equal(page.encrypted, true);
    assert.match(page.headers['strict-transport-security'], /max-age=/);
    const pw = crypto.randomBytes(9).toString('hex');
    const r = await httpsRequest(port, '/api/configurar', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Yvy': '1' },
      body: JSON.stringify({ name: 'Administración', username: 'admin', password: pw })
    });
    assert.equal(r.status, 200, r.body);
    assert.match(r.headers['set-cookie'][0], /; Secure/);
    assert.match(r.headers['set-cookie'][0], /HttpOnly/);
  } finally {
    app.close();
    server.close();
    server.closeAllConnections();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detrás del proxy: el límite de intentos usa la IP que agrega el proxy, no la que inventa el cliente', async () => {
  const dir = tmp();
  const app = createApp({ dataDir: dir, skipBackups: true, trustProxy: true });
  const server = await app.listen(0, '127.0.0.1');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const post = (xff) => fetch(base + '/api/ingresar', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Yvy': '1', 'X-Forwarded-For': xff },
      body: JSON.stringify({ username: 'nadie', password: 'mala' })
    });
    // Mismo cliente real (203.0.113.7, puesto por el proxy al final) aunque cambie la primera dirección.
    for (let i = 0; i < 8; i++) await post('10.0.0.' + i + ', 203.0.113.7');
    assert.equal((await post('10.9.9.9, 203.0.113.7')).status, 429);
    // Otro cliente real no queda bloqueado.
    assert.equal((await post('203.0.113.8')).status, 401);
  } finally {
    app.close();
    server.close();
    server.closeAllConnections();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('arranque: avisa con claridad si el puerto está ocupado', async () => {
  const dir = tmp();
  const busy = createApp({ dataDir: dir, skipBackups: true });
  const server = await busy.listen(0, '127.0.0.1');
  const port = server.address().port;
  const dir2 = tmp();
  try {
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(here, '..', 'server', 'main.mjs'), '--port=' + port, '--data=' + dir2], { stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', (c) => { text += c; });
      child.stderr.on('data', (c) => { text += c; });
      child.on('exit', (code) => resolve({ code, text }));
    });
    assert.equal(out.code, 1);
    assert.match(out.text, /ya está en uso/);
  } finally {
    busy.close();
    server.close();
    server.closeAllConnections();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});
