/*
 * Inicia el servidor de Yvy Guaraní.
 *
 * Variables de entorno (todas opcionales; también se aceptan como --port= --host= --data= --tls-cert= --tls-key=):
 *   PORT=4173              puerto
 *   HOST=127.0.0.1         usar 0.0.0.0 para entrar desde otros equipos de la red
 *   DATA_DIR=./data        dónde queda la base (yvy.db) y las copias de seguridad
 *   TLS_CERT, TLS_KEY      rutas a certificado y clave para servir por https directamente
 *   COOKIE_SECURE=1        si hay https delante (proxy), marca la cookie como Secure y activa HSTS
 *   TRUST_PROXY=1          usar X-Forwarded-For para la IP (solo detrás de un proxy propio)
 */
import fs from 'node:fs';

const major = Number(process.versions.node.split('.')[0]);
try {
  if (major < 22) throw new Error('version');
  await import('node:sqlite');
} catch (e) {
  console.error('Se necesita Node.js 22.13+ o 24+ (con node:sqlite). Versión actual: ' + process.versions.node);
  process.exit(1);
}
const { createApp } = await import('./app.mjs');

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--') && a.includes('=')).map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2)));
const fromArgs = { port: 'PORT', host: 'HOST', data: 'DATA_DIR', 'tls-cert': 'TLS_CERT', 'tls-key': 'TLS_KEY' };
const env = Object.assign({}, process.env);
Object.keys(fromArgs).forEach((k) => { if (args[k]) env[fromArgs[k]] = args[k]; });

const port = Number(env.PORT) || 4173;
const host = env.HOST || '127.0.0.1';
const tls = env.TLS_CERT && env.TLS_KEY ? { cert: fs.readFileSync(env.TLS_CERT), key: fs.readFileSync(env.TLS_KEY) } : null;

const app = createApp({
  dataDir: env.DATA_DIR,
  secureCookie: !!tls || env.COOKIE_SECURE === '1',
  trustProxy: env.TRUST_PROXY === '1',
  log: (m) => console.log(new Date().toISOString() + '  ' + m)
});
let server;
try {
  server = await app.listen(port, host, tls);
} catch (e) {
  console.error(e.code === 'EADDRINUSE' ? 'El puerto ' + port + ' ya está en uso. ¿Hay otro servidor de Yvy Guaraní abierto?' : 'No se pudo iniciar: ' + e.message);
  app.close();
  process.exit(1);
}
const shown = host === '0.0.0.0' ? 'localhost' : host;
console.log('Yvy Guaraní en ' + (tls ? 'https' : 'http') + '://' + shown + ':' + port + '  (datos en ' + (env.DATA_DIR || 'data') + ')');
if (host === '0.0.0.0' && !tls) console.log('Atención: accesible desde la red sin https. Las contraseñas viajan sin cifrar; usalo solo en una red de confianza.');

function stop() {
  server.close();
  app.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
