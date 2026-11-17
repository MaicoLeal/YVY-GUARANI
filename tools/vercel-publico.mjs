/*
 * Build de Vercel: copia a publico/ solo lo que la página necesita (index.html, css/, js/, assets/).
 * Así el código del servidor, los tests y las guías no quedan publicados en el sitio.
 *
 * Uso: node tools/vercel-publico.mjs [--salida=carpeta]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.slice(2).find((a) => a.startsWith('--salida='));
const out = path.resolve(root, arg ? arg.slice('--salida='.length) : 'publico');
const PUBLICO = ['index.html', 'css', 'js', 'assets'];

// Nunca borrar el proyecto ni una carpeta que lo contenga.
if (out === root || root.startsWith(out + path.sep)) throw new Error('Carpeta de salida inválida: ' + out);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let files = 0;
for (const item of PUBLICO) fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
(function count(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) count(path.join(dir, e.name));
    else files++;
  }
})(out);
console.log('Página lista en ' + path.relative(root, out) + ' (' + files + ' archivos).');
