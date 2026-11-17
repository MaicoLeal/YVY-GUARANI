// Guion de aceptación (sección 6 del briefing), automatizado contra el núcleo de reglas.
// Ejecutar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/domain.js');
const { buildSeed } = require('../js/seed.js');

const NOW = new Date(2026, 10, 14, 10, 0, 0);
const TODAY = D.localDate(NOW);
const SKU = 'PAS-REM-300';

function world() {
  const w = { state: buildSeed(NOW) };
  const user = (id) => w.state.users.find((u) => u.id === id);
  w.alm1 = user('U-001');
  w.alm2 = user('U-002');
  w.dep = user('U-003');
  w.com = user('U-004');
  w.eco = user('U-005');
  w.agro = user('U-006');
  w.admin = user('U-007');
  w.run = (actor, type, payload, now) => {
    const r = D.execute(w.state, actor, { type, payload }, now || NOW);
    w.state = r.state;
    return r;
  };
  w.ok = (actor, type, payload, now) => {
    const r = w.run(actor, type, payload, now);
    assert.equal(r.ok, true, r.message);
    return r.result;
  };
  w.stock = (sku) => D.stockSummary(w.state, sku || SKU, TODAY);
  w.receive = (extra) =>
    w.ok(w.dep, 'recepcion.registrar', Object.assign({
      coopId: 'COOP-ECOAGRO', depositoId: 'DEP-1', sku: SKU, lotCode: 'REM-T-01', qtyReceived: 15, qtyReleased: 12,
      blockReason: 'Envase dañado', receivedDate: TODAY, expiry: D.addDays(TODAY, 120), responsible: 'Depósito de prueba'
    }, extra || {}));
  w.order = (actor, qty, sku) => w.ok(actor, 'pedido.guardarBorrador', { lines: [{ sku: sku || SKU, qty }] }).orderId;
  return w;
}
const win = (a, b) => ({ windowFrom: D.addDays(TODAY, a), windowTo: D.addDays(TODAY, b) });

test('a) oferta de 20 y demanda de 8 en la misma ventana: sugiere 8 y el stock sigue en cero', () => {
  const w = world();
  w.ok(w.eco, 'oferta.registrar', { sku: SKU, qty: 20, unit: 'paquete', ...win(2, 8), kind: 'disponible', confirmation: 'confirmada' });
  w.ok(w.alm1, 'demanda.registrar', { sku: SKU, qty: 8, unit: 'paquete', ...win(2, 8), kind: 'pedido_firme' });
  const row = D.matchSupplyDemand(w.state).find((r) => r.sku === SKU);
  assert.equal(row.offered, 20);
  assert.equal(row.demanded, 8);
  assert.equal(row.suggested, 8);
  assert.equal(row.offerBalance, 12);
  assert.equal(row.shortfall, 0);
  assert.deepEqual(w.stock(), { fisico: 0, bloqueado: 0, liberado: 0, vencido: 0, reservado: 0, disponible: 0 });
  assert.equal(w.state.lots.filter((l) => l.sku === SKU).length, 0, 'la oferta no crea lotes');
  assert.equal(w.state.orders.length, 0, 'la demanda no crea pedidos');
  // Ni siquiera una oferta "confirmada" permite vender sin recepción.
  const id = w.order(w.alm1, 8);
  assert.equal(w.run(w.alm1, 'pedido.confirmar', { orderId: id }).code, 'STOCK_INSUFICIENTE');
});

test('b) 12 liberados + 3 bloqueados: vendible 12; pedido de 8 deja 4 disponibles y 8 reservados', () => {
  const w = world();
  w.receive();
  assert.deepEqual(w.stock(), { fisico: 15, bloqueado: 3, liberado: 12, vencido: 0, reservado: 0, disponible: 12 });
  const id = w.order(w.alm1, 8);
  w.ok(w.alm1, 'pedido.confirmar', { orderId: id });
  assert.deepEqual(w.stock(), { fisico: 15, bloqueado: 3, liberado: 12, vencido: 0, reservado: 8, disponible: 4 });
  assert.equal(D.storefront(w.state, TODAY).find((p) => p.sku === SKU).available, 4);
  assert.deepEqual(D.checkInvariants(w.state), []);
});

test('c) reservar 5 más se rechaza sin cambio parcial; cancelar devuelve 12 una sola vez', () => {
  const w = world();
  w.receive();
  const first = w.order(w.alm1, 8);
  w.ok(w.alm1, 'pedido.confirmar', { orderId: first });

  const second = w.order(w.alm2, 5);
  const before = JSON.stringify(w.state);
  const r = w.run(w.alm2, 'pedido.confirmar', { orderId: second });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'STOCK_INSUFICIENTE');
  assert.deepEqual(r.details.shortages, [{ sku: SKU, name: 'Pasta de remolacha', unit: 'paquete', requested: 5, available: 4 }]);
  assert.equal(JSON.stringify(w.state), before, 'el rechazo no modifica nada');
  assert.equal(w.state.orders.find((o) => o.id === second).status, 'borrador');

  w.ok(w.alm1, 'pedido.cancelar', { orderId: first, reason: 'Prueba' });
  assert.deepEqual(w.stock(), { fisico: 15, bloqueado: 3, liberado: 12, vencido: 0, reservado: 0, disponible: 12 });

  const again = w.run(w.alm1, 'pedido.cancelar', { orderId: first, reason: 'Prueba' });
  assert.equal(again.code, 'YA_CANCELADO');
  assert.equal(w.stock().disponible, 12, 'repetir la cancelación no suma saldo');
  assert.equal(w.stock().reservado, 0);
  assert.equal(w.state.movements.filter((m) => m.type === 'liberacion_reserva').length, 1);
  assert.deepEqual(D.checkInvariants(w.state), []);
});

test('d) pedido de 8 → preparar → despachar → entregar: vendible 4, bloqueados intactos, sin doble descuento, precio fijo', () => {
  const w = world();
  w.receive();
  const id = w.order(w.alm1, 8);
  w.ok(w.alm1, 'pedido.confirmar', { orderId: id });
  w.ok(w.dep, 'pedido.preparar', { orderId: id });
  assert.equal(w.stock().fisico, 15, 'reservar y preparar no son salida física');
  w.ok(w.dep, 'pedido.despachar', { orderId: id, responsible: 'Chofer de prueba' });
  assert.deepEqual(w.stock(), { fisico: 7, bloqueado: 3, liberado: 4, vencido: 0, reservado: 0, disponible: 4 });

  // Doble clic / repetición del despacho.
  const dup = w.run(w.dep, 'pedido.despachar', { orderId: id, responsible: 'Chofer de prueba' });
  assert.equal(dup.code, 'TRANSICION_INVALIDA');
  assert.deepEqual(w.stock(), { fisico: 7, bloqueado: 3, liberado: 4, vencido: 0, reservado: 0, disponible: 4 });
  assert.equal(w.state.movements.filter((m) => m.type === 'salida' && m.orderId === id).length, 1);

  w.ok(w.dep, 'pedido.entregar', { orderId: id });
  assert.equal(w.stock().disponible, 4);
  assert.equal(w.stock().bloqueado, 3);

  // Cambiar la lista de precios después no toca el pedido.
  w.ok(w.com, 'precio.actualizar', { sku: SKU, precioAlmacen: 19900 });
  const order = w.state.orders.find((o) => o.id === id);
  assert.equal(order.status, 'entregado');
  assert.equal(order.lines[0].unitPrice, 12500);
  assert.equal(order.lines[0].unit, 'paquete');
  assert.equal(order.total, 100000);
  assert.equal(D.orderView(w.state, order, TODAY).total, 100000);
  assert.equal(D.storefront(w.state, TODAY).find((p) => p.sku === SKU).price, 19900);

  // Después del despacho no hay cancelación ni reposición automática.
  assert.equal(w.run(w.com, 'pedido.cancelar', { orderId: id, reason: 'x' }).code, 'TRANSICION_INVALIDA');
  assert.equal(w.stock().fisico, 7);
  assert.deepEqual(D.checkInvariants(w.state), []);
});

test('e) ventana incompatible: no hay sugerencia y se explica el motivo', () => {
  const w = world();
  w.ok(w.eco, 'oferta.registrar', { sku: SKU, qty: 20, unit: 'paquete', ...win(2, 8), kind: 'disponible', confirmation: 'confirmada' });
  w.ok(w.alm1, 'demanda.registrar', { sku: SKU, qty: 8, unit: 'paquete', ...win(9, 15), kind: 'interes' });
  const row = D.matchSupplyDemand(w.state).find((r) => r.sku === SKU);
  assert.equal(row.suggested, 0);
  assert.equal(row.shortfall, 8);
  assert.equal(row.offerBalance, 20);
  assert.match(row.demands[0].reasons[0], /Ventanas que no se superponen/);
});

test('e) cantidad cero o negativa se rechaza en oferta, demanda, recepción y pedido', () => {
  const w = world();
  const before = JSON.stringify(w.state);
  for (const qty of [0, -3, 1.5, NaN]) {
    assert.equal(w.run(w.eco, 'oferta.registrar', { sku: SKU, qty, unit: 'paquete', ...win(1, 2), confirmation: 'probable' }).code, 'CANTIDAD_INVALIDA');
    assert.equal(w.run(w.alm1, 'demanda.registrar', { sku: SKU, qty, unit: 'paquete', ...win(1, 2), kind: 'interes' }).code, 'CANTIDAD_INVALIDA');
    assert.equal(w.run(w.alm1, 'pedido.guardarBorrador', { lines: [{ sku: SKU, qty }] }).code, 'CANTIDAD_INVALIDA');
    assert.equal(w.run(w.dep, 'recepcion.registrar', {
      coopId: 'COOP-ECOAGRO', depositoId: 'DEP-1', sku: SKU, lotCode: 'X', qtyReceived: qty, qtyReleased: 0, receivedDate: TODAY,
      expiry: D.addDays(TODAY, 30), responsible: 'x'
    }).code, 'CANTIDAD_INVALIDA');
  }
  assert.equal(JSON.stringify(w.state), before);
});

test('e) unidad incompatible: el cruce lo explica y el pedido lo rechaza; la conversión explícita sí cruza', () => {
  const w = world();
  w.ok(w.eco, 'oferta.registrar', { sku: SKU, qty: 20, unit: 'kg', ...win(2, 8), kind: 'disponible', confirmation: 'probable' });
  w.ok(w.alm1, 'demanda.registrar', { sku: SKU, qty: 8, unit: 'paquete', ...win(2, 8), kind: 'interes' });
  let row = D.matchSupplyDemand(w.state).find((r) => r.sku === SKU);
  assert.equal(row.suggested, 0);
  assert.match(row.demands[0].reasons[0], /Unidad incompatible/);

  // 1 caja = 12 paquetes está definido en el producto: 2 cajas cubren 8 paquetes.
  w.ok(w.eco, 'oferta.registrar', { sku: SKU, qty: 2, unit: 'caja', ...win(2, 8), kind: 'disponible', confirmation: 'probable' });
  row = D.matchSupplyDemand(w.state).find((r) => r.sku === SKU);
  assert.equal(row.offered, 24);
  assert.equal(row.suggested, 8);

  assert.equal(w.run(w.alm1, 'pedido.guardarBorrador', { lines: [{ sku: SKU, qty: 2, unit: 'kg' }] }).code, 'UNIDAD_INCOMPATIBLE');
});

test('e) lote vencido: no se libera, no cuenta como vendible y no se puede pedir', () => {
  const w = world();
  const expired = D.addDays(TODAY, -1);
  // No se puede recibir como liberado.
  assert.equal(w.run(w.dep, 'recepcion.registrar', {
    coopId: 'COOP-ECOAGRO', depositoId: 'DEP-1', sku: SKU, lotCode: 'VENC-1', qtyReceived: 10, qtyReleased: 10,
    receivedDate: TODAY, expiry: expired, responsible: 'x'
  }).code, 'LOTE_VENCIDO');
  // Sí se registra el hecho físico, bloqueado.
  const lotId = w.receive({ lotCode: 'VENC-1', qtyReceived: 10, qtyReleased: 0, blockReason: 'Vencido', expiry: expired }).lotId;
  assert.equal(w.stock().fisico, 10);
  assert.equal(w.stock().disponible, 0);
  assert.equal(w.run(w.dep, 'lote.liberar', { lotId, qty: 10, note: 'x' }).code, 'LOTE_VENCIDO');

  // Un lote liberado que vence más tarde deja de ser vendible sin intervención.
  w.receive({ lotCode: 'CORTO-1', qtyReceived: 6, qtyReleased: 6, blockReason: '', expiry: D.addDays(TODAY, 2) });
  assert.equal(w.stock().disponible, 6);
  const later = new Date(NOW.getTime() + 5 * 86400000);
  assert.equal(D.stockSummary(w.state, SKU, D.localDate(later)).disponible, 0);
  assert.equal(D.stockSummary(w.state, SKU, D.localDate(later)).vencido, 6);
  const id = w.order(w.alm1, 1);
  assert.equal(w.run(w.alm1, 'pedido.confirmar', { orderId: id }, later).code, 'STOCK_INSUFICIENTE');
});

test('e) recarga: el estado sobrevive a guardar y volver a leer (JSON), y el respaldo se valida', () => {
  const w = world();
  w.receive();
  const id = w.order(w.alm1, 8);
  w.ok(w.alm1, 'pedido.confirmar', { orderId: id });
  const reloaded = JSON.parse(JSON.stringify(w.state));
  assert.deepEqual(reloaded, w.state);
  assert.deepEqual(D.stockSummary(reloaded, SKU, TODAY), w.stock());

  const backup = JSON.parse(JSON.stringify(D.exportBackup(w.state, NOW)));
  const imp = D.importBackup(backup);
  assert.equal(imp.ok, true);
  assert.deepEqual(imp.state, w.state);

  assert.equal(D.importBackup({ foo: 1 }).ok, false);
  assert.equal(D.importBackup({ ...backup, schemaVersion: 99 }).ok, false);
  const tampered = JSON.parse(JSON.stringify(backup));
  tampered.state.lots.find((l) => l.sku === SKU).reserved = 2; // no coincide con los pedidos
  assert.equal(D.importBackup(tampered).ok, false);
  const negative = JSON.parse(JSON.stringify(backup));
  negative.state.lots[0].liberado = -1;
  assert.equal(D.importBackup(negative).ok, false);
});
