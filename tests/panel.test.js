// Panel de gestión: costo congelado, faltantes, migración, indicadores por período y escenario de demostración.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/domain.js');
const { buildSeed, buildDemo } = require('../js/seed.js');

const NOW = new Date(2026, 10, 16, 10, 0, 0);
const TODAY = D.localDate(NOW);
const SKU = 'PAS-REM-300';

function world() {
  const w = { state: buildSeed(NOW) };
  const user = (id) => w.state.users.find((u) => u.id === id);
  Object.assign(w, { alm1: user('U-001'), alm2: user('U-002'), dep: user('U-003'), com: user('U-004'), admin: user('U-007') });
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
  w.receive = (qty, sku, code) =>
    w.ok(w.dep, 'recepcion.registrar', {
      coopId: 'COOP-ECOAGRO', depositoId: 'DEP-1', sku: sku || SKU, lotCode: code || 'L-' + Math.random(), qtyReceived: qty, qtyReleased: qty,
      receivedDate: TODAY, expiry: D.addDays(TODAY, 90), responsible: 'Depósito de prueba'
    });
  w.order = (actor, qty, sku, now) => {
    const id = w.ok(actor, 'pedido.guardarBorrador', { lines: [{ sku: sku || SKU, qty }] }, now).orderId;
    return id;
  };
  w.flow = (id, t) => {
    w.ok(w.dep, 'pedido.preparar', { orderId: id }, t);
    w.ok(w.dep, 'pedido.despachar', { orderId: id, responsible: 'Reparto de prueba' }, t);
    w.ok(w.dep, 'pedido.entregar', { orderId: id }, t);
  };
  return w;
}
const at = (days, h) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + days, h || 10);

test('el pedido registra el costo vigente al confirmar; cambiar el costo después no cambia el margen', () => {
  const w = world();
  w.receive(20);
  const id = w.order(w.alm1, 4);
  w.ok(w.alm1, 'pedido.confirmar', { orderId: id });
  const line = w.state.orders.find((o) => o.id === id).lines[0];
  assert.equal(line.unitCostProveedor, 9000);
  assert.equal(line.unitCostLogistico, 800);
  w.flow(id);
  w.ok(w.com, 'precio.actualizar', { sku: SKU, costoProveedor: 11000 });
  const a = D.analytics(w.state, TODAY, TODAY, TODAY);
  // 4 × 12.500 = 50.000 de venta; costo 4 × 9.800 = 39.200 → ganancia 10.800 → margen 21,6 %
  assert.equal(a.cur.ingresoEntregado, 50000);
  assert.equal(a.cur.gananciaBruta, 10800);
  assert.equal(a.cur.margen, 10800 / 50000);
  assert.equal(a.cur.coberturaMargen, 1);
});

test('el almacén ve sus pedidos sin costos internos', () => {
  const w = world();
  w.receive(10);
  const id = w.order(w.alm1, 2);
  w.ok(w.alm1, 'pedido.confirmar', { orderId: id });
  const mine = D.visibleOrders(w.state, w.alm1);
  assert.equal(mine.length, 1);
  assert.ok(!/unitCost|costo/i.test(JSON.stringify(mine)));
  assert.equal(mine[0].lines[0].unitPrice, 12500);
  // La vista interna sí los tiene y el estado no se modificó.
  assert.equal(D.visibleOrders(w.state, w.com)[0].lines[0].unitCostProveedor, 9000);
  assert.equal(w.state.orders[0].lines[0].unitCostProveedor, 9000);
});

test('margen sin costo logístico: "sin dato" en lugar de cero, con cobertura parcial', () => {
  const w = world();
  w.receive(10, 'PAS-LOC-300', 'LOC-T'); // costo logístico sin definir en la semilla
  w.receive(10);
  const a1 = w.order(w.alm1, 2, 'PAS-LOC-300');
  w.ok(w.alm1, 'pedido.confirmar', { orderId: a1 });
  w.flow(a1);
  let a = D.analytics(w.state, TODAY, TODAY, TODAY);
  assert.equal(a.cur.margen, null);
  assert.equal(a.cur.coberturaMargen, 0);
  const a2 = w.order(w.alm1, 2);
  w.ok(w.alm1, 'pedido.confirmar', { orderId: a2 });
  w.flow(a2);
  a = D.analytics(w.state, TODAY, TODAY, TODAY);
  assert.equal(a.cur.ingresoEntregado, 26000 + 25000);
  assert.equal(a.cur.coberturaMargen, 25000 / 51000);
  assert.equal(a.cur.margen, (25000 - 2 * 9800) / 25000);
});

test('faltante: se registra recalculado, una vez por pedido y día, y no se inventa', () => {
  const w = world();
  w.receive(4);
  const id = w.order(w.alm1, 6);
  assert.equal(w.run(w.alm1, 'pedido.confirmar', { orderId: id }).code, 'STOCK_INSUFICIENTE');
  w.ok(w.alm1, 'pedido.registrarFaltante', { orderId: id });
  w.ok(w.alm1, 'pedido.registrarFaltante', { orderId: id });
  assert.equal(w.state.shortages.length, 1);
  assert.equal(w.state.shortages[0].attempts, 2);
  assert.deepEqual(w.state.shortages[0].lines.map((l) => [l.requested, l.available, l.missing, l.unitPrice]), [[6, 4, 2, 12500]]);
  // Otro almacén no puede registrar faltantes en pedidos ajenos.
  assert.equal(w.run(w.alm2, 'pedido.registrarFaltante', { orderId: id }).code, 'NO_ENCONTRADO');
  // Con stock suficiente no hay faltante que registrar.
  const ok = w.order(w.alm1, 1);
  assert.equal(w.run(w.alm1, 'pedido.registrarFaltante', { orderId: ok }).code, 'SIN_FALTANTE');
  const a = D.analytics(w.state, TODAY, TODAY, TODAY);
  assert.equal(a.cur.faltantes, 1);
  assert.equal(a.cur.ventasPerdidas, 25000);
  assert.deepEqual(a.lostByProduct.map((x) => [x.sku, x.missing]), [[SKU, 2]]);
});

test('indicadores por período: ventas por fecha de confirmación, cancelados aparte, comparación con el período anterior', () => {
  const w = world();
  w.receive(40);
  const old = w.order(w.alm1, 2, SKU, at(-8));
  w.ok(w.alm1, 'pedido.confirmar', { orderId: old }, at(-8));
  const a1 = w.order(w.alm1, 4, SKU, at(-2));
  w.ok(w.alm1, 'pedido.confirmar', { orderId: a1 }, at(-2));
  const a2 = w.order(w.alm2, 2, SKU, at(-1));
  w.ok(w.alm2, 'pedido.confirmar', { orderId: a2 }, at(-1));
  const c = w.order(w.alm2, 1, SKU, at(-1));
  w.ok(w.alm2, 'pedido.confirmar', { orderId: c }, at(-1));
  w.ok(w.alm2, 'pedido.cancelar', { orderId: c, reason: 'Prueba' }, at(-1, 12));
  w.order(w.alm1, 3, SKU, at(-1)); // borrador: no es venta

  const a = D.analytics(w.state, D.addDays(TODAY, -6), TODAY, TODAY);
  assert.equal(a.days, 7);
  assert.equal(a.weekly, false);
  assert.equal(a.series.length, 7);
  assert.equal(a.cur.pedidos, 2);
  assert.equal(a.cur.ventas, 6 * 12500);
  assert.equal(a.cur.ticket, 37500);
  assert.equal(a.cur.confirmados, 3);
  assert.equal(a.cur.cancelados, 1);
  assert.equal(a.cur.tasaCancelacion, 1 / 3);
  assert.equal(a.prev.ventas, 2 * 12500);
  assert.equal(a.prevTo, D.addDays(TODAY, -7));
  assert.equal(a.prevFrom, D.addDays(TODAY, -13));
  assert.equal(a.series.reduce((t, b) => t + b.ventas, 0), a.cur.ventas);
  assert.deepEqual(a.almacenes.map((x) => [x.almacenId, x.pedidos, x.ventas]), [['ALM-001', 1, 50000], ['ALM-002', 1, 25000]]);
  assert.deepEqual(a.products.map((x) => [x.sku, x.qty]), [[SKU, 6]]);
  assert.throws(() => D.analytics(w.state, TODAY, D.addDays(TODAY, -1), TODAY), /período/);
});

test('serie semanal en períodos largos, empezando en lunes', () => {
  const w = world();
  const a = D.analytics(w.state, D.addDays(TODAY, -89), TODAY, TODAY);
  assert.equal(a.weekly, true);
  a.series.forEach((b) => assert.equal(D.mondayOf(b.key), b.key));
  assert.equal(a.series[0].from, D.addDays(TODAY, -89));
  assert.equal(a.series[a.series.length - 1].to, TODAY);
  assert.equal(a.cur.ticket, null);
  assert.equal(a.cur.margen, null);
});

test('stock: valor a costo y días de cobertura según las salidas de 30 días; sin salidas, sin dato', () => {
  const w = world();
  w.receive(40);
  const id = w.order(w.alm1, 30, SKU, at(-1));
  w.ok(w.alm1, 'pedido.confirmar', { orderId: id }, at(-1));
  w.flow(id, at(-1, 12));
  const a = D.analytics(w.state, TODAY, TODAY, TODAY);
  const row = a.stock.find((x) => x.product.sku === SKU);
  assert.equal(row.s.disponible, 10);
  assert.equal(row.valor, 10 * 9000);
  assert.equal(row.salida30, 30);
  assert.equal(row.coberturaDias, 10); // 10 disponibles / (30 salidas / 30 días)
  assert.equal(a.stock.find((x) => x.product.sku === 'PAS-ZAP-300').coberturaDias, null);
});

test('migración: un respaldo de la versión 1 se importa sin inventar costos', () => {
  const w = world();
  w.receive(10);
  const id = w.order(w.alm1, 2);
  w.ok(w.alm1, 'pedido.confirmar', { orderId: id });
  const v1 = JSON.parse(JSON.stringify(w.state));
  v1.schemaVersion = 1;
  delete v1.shortages;
  v1.orders.forEach((o) => o.lines.forEach((ln) => { delete ln.unitCostProveedor; delete ln.unitCostLogistico; }));
  const imp = D.importBackup({ app: D.APP_ID, kind: 'respaldo-de-prueba', schemaVersion: 1, state: v1 });
  assert.equal(imp.ok, true, (imp.errors || []).join(' '));
  assert.equal(imp.state.schemaVersion, D.SCHEMA_VERSION);
  assert.deepEqual(imp.state.shortages, []);
  assert.equal(imp.state.orders[0].lines[0].unitCostProveedor, null);
  assert.equal(D.importBackup({ app: D.APP_ID, kind: 'respaldo-de-prueba', schemaVersion: 99, state: w.state }).ok, false);
});

test('escenario de demostración: determinista, coherente, rotulado y con historia para el panel', () => {
  const s = buildDemo(NOW);
  const again = buildDemo(NOW);
  assert.equal(JSON.stringify(s), JSON.stringify(again));
  assert.deepEqual(D.checkInvariants(s), []);
  assert.equal(s.label, 'Demostración');
  assert.equal(s.demo.weeks, 13);
  assert.ok(s.orders.length > 50);
  assert.ok(s.shortages.length > 0);
  assert.ok(s.orders.some((o) => o.status === 'cancelado'));
  const a = D.analytics(s, D.addDays(TODAY, -89), TODAY, TODAY);
  assert.ok(a.cur.ventas > 0 && a.prev.ventas >= 0);
  assert.ok(a.cur.margen > 0 && a.cur.margen < 1);
  assert.ok(a.series.filter((b) => b.ventas > 0).length >= 10);
  assert.ok(D.dashboard(s, TODAY).nearExpiry.length >= 1);
  // Nada ocurre en el futuro.
  const nowIso = NOW.toISOString();
  assert.ok(s.audit.every((x) => x.at <= nowIso));
  assert.ok(s.movements.every((m) => m.at <= nowIso));
  // Los precios de pedidos viejos no cambiaron con la suba de lista a mitad del período.
  const remPrices = new Set();
  s.orders.forEach((o) => o.lines.forEach((ln) => { if (ln.sku === 'ECO-2148' && o.confirmedAt) remPrices.add(ln.unitPrice); }));
  assert.deepEqual([...remPrices].sort(), [12500, 13000]);
  // Se guarda e importa como cualquier respaldo.
  assert.equal(D.importBackup(JSON.parse(JSON.stringify(D.exportBackup(s, NOW)))).ok, true);
});

test('faltas de oferta del panel: solo demandas con ventana vigente', () => {
  const w = world();
  w.ok(w.alm1, 'demanda.registrar', { sku: SKU, qty: 5, unit: 'paquete', windowFrom: D.addDays(TODAY, 2), windowTo: D.addDays(TODAY, 6), kind: 'interes' });
  const past = D.execute(w.state, w.alm1, { type: 'demanda.registrar', payload: { sku: SKU, qty: 5, unit: 'paquete', windowFrom: D.addDays(TODAY, -9), windowTo: D.addDays(TODAY, -3), kind: 'interes' } }, NOW);
  w.state = past.state;
  const gaps = D.dashboard(w.state, TODAY).gaps.filter((g) => g.sku === SKU);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].demand.windowTo, D.addDays(TODAY, 6));
});
