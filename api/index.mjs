/*
 * Función de Vercel: atiende todo /api/… (vercel.json reenvía cada ruta acá con ?ruta=…).
 *
 * Usa el mismo núcleo que el servidor propio (server/nucleo.mjs), con los datos en una base Postgres de Neon
 * conectada al proyecto de Vercel (variable DATABASE_URL o POSTGRES_URL, que la integración crea sola).
 *
 * Variables opcionales:
 *   CODIGO_CONFIGURACION  si está definida, el primer acceso de Administración exige este código.
 */
import { crearNucleo } from '../server/nucleo.mjs';
import { crearAlmacenPostgres } from '../server/almacen-postgres.mjs';

const MAX_REQUEST = 4 * 1024 * 1024; // Vercel no acepta cuerpos de más de 4,5 MB.

/** Ruta pedida por el navegador, tanto si llega como /api/estado o reescrita como /api/index?ruta=estado. */
export function rutaDe(url) {
  const u = new URL(url);
  const p = u.pathname.replace(/\/+$/, '');
  if (p === '/api' || p === '/api/index' || p === '/api/index.mjs') return '/api/' + (u.searchParams.get('ruta') || '');
  return u.pathname;
}

/** IP del cliente: Vercel reemplaza estos encabezados, así que el cliente no puede inventarla. */
export function ipDe(request) {
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return String(request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
}

function sinBase() {
  return new Response(JSON.stringify({
    ok: false,
    code: 'SIN_BASE',
    message: 'Falta conectar la base de datos. En Vercel: Storage → Create Database → Neon, conectada a este proyecto, y volver a publicar.'
  }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/**
 * @param {() => Promise<ReturnType<typeof crearNucleo>|null>} obtenerNucleo
 */
export function crearManejador(obtenerNucleo) {
  return async function fetchHandler(request) {
    const nucleo = await obtenerNucleo();
    if (!nucleo) return sinBase();
    const headers = {};
    request.headers.forEach((v, k) => { headers[k] = v; });
    const out = await nucleo.handle({
      method: request.method,
      path: rutaDe(request.url),
      headers,
      ip: ipDe(request),
      text: async (limit) => {
        const text = await request.text();
        if (Buffer.byteLength(text) > Math.min(limit, MAX_REQUEST)) throw Object.assign(new Error('El envío es demasiado grande.'), { status: 413 });
        return text;
      }
    });
    return new Response(out.body, { status: out.status, headers: out.headers });
  };
}

let nucleo = null;
async function obtenerNucleo() {
  if (nucleo) return nucleo;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  const store = crearAlmacenPostgres({
    query: (text, params) => sql.query(text, params),
    batch: (list) => sql.transaction(list.map(([text, params]) => sql.query(text, params)))
  });
  nucleo = crearNucleo({
    store,
    secureCookie: true,
    setupCode: process.env.CODIGO_CONFIGURACION || '',
    eventos: 'consulta',
    dailyBackup: true,
    log: (m) => console.log(m)
  });
  return nucleo;
}

export default { fetch: crearManejador(obtenerNucleo) };
