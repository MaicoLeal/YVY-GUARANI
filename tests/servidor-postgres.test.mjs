// Las mismas pruebas del servidor, con el almacenamiento Postgres que usa Vercel (en memoria, con PGlite).
import test from 'node:test';
import { pruebasServidor } from './suite-servidor.mjs';
import { crearPglite, hayPglite } from './pglite.mjs';
import { crearAlmacenPostgres } from '../server/almacen-postgres.mjs';

if (!(await hayPglite())) {
  test('Postgres · omitido: falta instalar las dependencias de desarrollo (npm install)', { skip: true }, () => {});
} else {
  let db;
  pruebasServidor({
    nombre: 'Postgres',
    antes: async () => { db = await crearPglite(); },
    despues: async () => { await db.close(); },
    // Cada "reinicio" crea un almacenamiento nuevo sobre la misma base, como una función nueva de Vercel.
    opciones: () => ({ store: crearAlmacenPostgres({ query: db.query, batch: db.batch }) })
  });
}
