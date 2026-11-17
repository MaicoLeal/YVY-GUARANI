// Lo que el servidor entrega a cada cuenta: sin contraseñas, sin costos para clientes, sin datos de otros.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/domain.js');
const { buildDemo } = require('../js/seed.js');

const NOW = new Date(2026, 10, 16, 10, 0, 0);
const TODAY = D.localDate(NOW);
const CRED = { algo: 'PBKDF2-SHA256', iter: 210000, salt: 'a'.repeat(32), hash: 'b'.repeat(64) };

function demoWithCreds() {
  const s = buildDemo(NOW);
  s.users.forEach((u) => { u.cred = Object.assign({}, CRED, { at: NOW.toISOString() }); });
  return s;
}
const userOf = (s, role) => s.users.find((u) => u.role === role);

test('ninguna vista lleva hashes ni sal de contraseñas', () => {
  const s = demoWithCreds();
  for (const u of [null].concat(s.users)) {
    const json = JSON.stringify(D.viewFor(s, u));
    assert.ok(!json.includes(CRED.hash), (u ? u.role : 'visitante') + ' recibe el hash');
    assert.ok(!json.includes(CRED.salt), (u ? u.role : 'visitante') + ' recibe la sal');
  }
  const admin = D.viewFor(s, userOf(s, 'admin'));
  assert.deepEqual(admin.users[0].cred, { set: true, at: NOW.toISOString() });
});

test('cliente: precio sí, costos no; solo sus pedidos, avisos y faltantes', () => {
  const s = demoWithCreds();
  const client = s.users.find((u) => u.role === 'almacen');
  const v = D.viewFor(s, client);
  assert.ok(v.products.every((p) => p.pricing.costoProveedor === null && p.pricing.costoLogistico === null));
  assert.ok(v.products.some((p) => p.pricing.precioAlmacen !== null));
  assert.ok(v.orders.length > 0 && v.orders.every((o) => o.almacenId === client.orgId));
  assert.ok(!/unitCost/.test(JSON.stringify(v.orders)));
  assert.ok(v.demands.every((x) => x.almacenId === client.orgId));
  assert.ok(v.shortages.every((x) => x.almacenId === client.orgId));
  assert.deepEqual([v.movements.length, v.audit.length, v.offers.length], [0, 0, 0]);
  assert.deepEqual(v.users.map((u) => u.id), [client.id]);
  assert.ok(v.orgs.every((o) => o.id === client.orgId || o.type === 'cooperativa'));
  assert.ok(v.lots.every((l) => !('coopId' in l) && !('discrepancyNote' in l) && !('responsible' in l)));
  // La disponibilidad que ve el cliente es la misma que la real.
  const real = D.storefront(s, TODAY).map((p) => [p.sku, p.available, p.price]);
  const seen = D.storefront(v, TODAY).map((p) => [p.sku, p.available, p.price]);
  assert.deepEqual(seen, real);
});

test('cooperativa: sus productos sin precios, sus lotes y su oferta; nada de clientes', () => {
  const s = demoWithCreds();
  const coop = userOf(s, 'cooperativa');
  const v = D.viewFor(s, coop);
  assert.ok(v.products.every((p) => (!p.coopId || p.coopId === coop.orgId) && p.pricing.precioAlmacen === null && p.pricing.costoProveedor === null));
  assert.ok(v.lots.length > 0 && v.lots.every((l) => l.coopId === coop.orgId));
  assert.ok(v.offers.every((o) => o.coopId === coop.orgId));
  assert.deepEqual([v.orders.length, v.demands.length, v.audit.length], [0, 0, 0]);
  assert.ok(v.orgs.every((o) => o.id === coop.orgId));
});

test('visitante: catálogo sin precios ni stock, marcando que el precio existe', () => {
  const s = demoWithCreds();
  const v = D.viewFor(s, null);
  assert.equal(v.users.length, 0);
  assert.equal(v.lots.length, 0);
  assert.ok(v.products.every((p) => p.pricing.precioAlmacen === null && p.pricing.costoProveedor === null));
  const shop = D.storefront(v, TODAY);
  assert.equal(shop.filter((p) => p.priceHidden).length, 12);
  assert.ok(shop.every((p) => p.orderable === false));
  assert.ok(v.orgs.every((o) => o.type === 'cooperativa'));
});

test('equipo interno: datos operativos completos; una cuenta desactivada se ve como visitante', () => {
  const s = demoWithCreds();
  const ventas = D.viewFor(s, userOf(s, 'comercial'));
  assert.equal(ventas.orders.length, s.orders.length);
  assert.ok(ventas.products.some((p) => p.pricing.costoProveedor !== null));
  const off = Object.assign({}, userOf(s, 'comercial'), { active: false });
  assert.equal(D.viewFor(s, off).orders.length, 0);
});
