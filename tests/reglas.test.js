// Reglas adicionales del núcleo: permisos por rol, FEFO, ajustes, precios e integridad.
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
  Object.assign(w, { alm1: user('U-001'), alm2: user('U-002'), dep: user('U-003'), com: user('U-004'), eco: user('U-005'), agro: user('U-006'), admin: user('U-007') });
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
  w.receive = (code, qty, released, expiryDays, sku) =>
    w.ok(w.dep, 'recepcion.registrar', {
      coopId: 'COOP-ECOAGRO', depositoId: 'DEP-1', sku: sku || SKU, lotCode: code, qtyReceived: qty, qtyReleased: released,
      blockReason: qty > released ? 'Control pendiente' : '', receivedDate: TODAY,
      expiry: expiryDays === null ? null : D.addDays(TODAY, expiryDays), responsible: 'Depósito de prueba'
    }).lotId;
  w.confirmed = (actor, qty, sku) => {
    const id = w.ok(actor, 'pedido.guardarBorrador', { lines: [{ sku: sku || SKU, qty }] }).orderId;
    w.ok(actor, 'pedido.confirmar', { orderId: id });
    return id;
  };
  return w;
}

test('la semilla es coherente y deja el SKU del guion sin stock, oferta ni demanda', () => {
  const s = buildSeed(NOW);
  assert.deepEqual(D.checkInvariants(s), []);
  assert.equal(s.label, 'Escenario de prueba');
  assert.equal(s.fixture, true);
  assert.equal(D.stockSummary(s, SKU, TODAY).fisico, 0);
  assert.equal(s.offers.filter((o) => o.sku === SKU).length, 0);
  assert.equal(s.demands.filter((d) => d.sku === SKU).length, 0);
  // Las líneas potenciales no aparecen en la vitrina; un producto activo sin precio aparece, pero no se puede pedir.
  const shop = D.storefront(s, TODAY);
  const skus = shop.map((p) => p.sku);
  for (const sku of ['GRA-CHIA', 'GRA-SESAMO', 'GRA-MANI', 'GRA-POROTO', 'RAI-MANDIOCA']) assert.ok(!skus.includes(sku), sku);
  const jen = shop.find((p) => p.sku === 'ESP-JEN-050');
  assert.equal(jen.price, null);
  assert.equal(jen.orderable, false);
  assert.equal(shop.find((p) => p.sku === 'PAS-REM-300').orderable, true);
});

test('la vitrina del almacén no expone costos ni márgenes', () => {
  const shop = D.storefront(buildSeed(NOW), TODAY);
  assert.ok(shop.length > 0);
  const text = JSON.stringify(shop);
  assert.ok(!/costo|margen|recargo|pricing/i.test(text), 'ningún campo de costo en la vitrina');
  assert.ok(!text.includes('9000'), 'ningún valor de costo en la vitrina');
});

test('un almacén no ve ni toca pedidos de otro', () => {
  const w = world();
  w.receive('R1', 12, 12, 90);
  const id = w.confirmed(w.alm1, 3);
  assert.equal(D.visibleOrders(w.state, w.alm2).length, 0);
  assert.equal(D.visibleOrders(w.state, w.alm1).length, 1);
  assert.equal(w.run(w.alm2, 'pedido.cancelar', { orderId: id, reason: 'x' }).code, 'NO_ENCONTRADO');
  assert.equal(w.run(w.alm2, 'pedido.guardarBorrador', { almacenId: 'ALM-001', lines: [{ sku: SKU, qty: 1 }] }).code, 'SIN_PERMISO');
  assert.equal(D.stockSummary(w.state, SKU, TODAY).reservado, 3);
});

test('permisos por rol: cada acción solo para quien corresponde', () => {
  const w = world();
  const denied = (actor, type, payload) => assert.equal(w.run(actor, type, payload || {}).code, 'SIN_PERMISO', actor.role + ' → ' + type);
  denied(w.alm1, 'precio.actualizar', { sku: SKU, precioAlmacen: 1 });
  denied(w.alm1, 'recepcion.registrar');
  denied(w.alm1, 'pedido.despachar', { orderId: 'P-0001' });
  denied(w.eco, 'precio.actualizar', { sku: SKU, precioAlmacen: 1 });
  denied(w.eco, 'pedido.guardarBorrador', { almacenId: 'ALM-001', lines: [] });
  denied(w.eco, 'recepcion.registrar');
  denied(w.com, 'recepcion.registrar');
  denied(w.com, 'pedido.despachar', { orderId: 'P-0001' });
  denied(w.dep, 'precio.actualizar', { sku: SKU, precioAlmacen: 1 });
  denied(w.dep, 'producto.guardar');
  denied(w.com, 'usuario.guardar');
  // La cooperativa solo ofrece lo suyo y solo ve lo suyo.
  denied(w.agro, 'oferta.registrar', { sku: SKU, qty: 5, unit: 'paquete', windowFrom: TODAY, windowTo: TODAY, confirmation: 'probable' });
  denied(w.agro, 'oferta.registrar', { coopId: 'COOP-ECOAGRO', sku: 'GRA-CHIA', qty: 5, unit: 'kg', windowFrom: TODAY, windowTo: TODAY, confirmation: 'probable' });
  assert.equal(D.visibleOffers(w.state, w.agro).length, 0);
  assert.equal(D.visibleOffers(w.state, w.eco).length, 1);
  assert.equal(D.visibleLots(w.state, w.agro).length, 0);
  assert.ok(!/pricing|costo|precio/i.test(JSON.stringify(D.coopProducts(w.state, w.eco))));
});

test('FEFO: reserva primero el lote liberado que vence antes y reparte entre lotes', () => {
  const w = world();
  const late = w.receive('TARDE', 10, 10, 200);
  const soon = w.receive('PRONTO', 5, 5, 20);
  const none = w.receive('SIN-FECHA-NO', 4, 0, 5); // bloqueado: no participa aunque venza antes
  const id = w.confirmed(w.alm1, 7);
  const allocs = w.state.orders.find((o) => o.id === id).lines[0].allocations;
  assert.deepEqual(allocs.map((a) => [a.lotId, a.qty]), [[soon, 5], [late, 2]]);
  assert.equal(D.byId(w.state.lots, none).reserved, 0);
  assert.deepEqual(D.checkInvariants(w.state), []);
});

test('transiciones inválidas se rechazan sin efectos', () => {
  const w = world();
  w.receive('R1', 12, 12, 90);
  const id = w.confirmed(w.alm1, 8);
  const snap = () => JSON.stringify(w.state);
  let before = snap();
  assert.equal(w.run(w.alm1, 'pedido.confirmar', { orderId: id }).code, 'TRANSICION_INVALIDA'); // doble reserva
  assert.equal(w.run(w.dep, 'pedido.despachar', { orderId: id, responsible: 'x' }).code, 'TRANSICION_INVALIDA'); // sin preparar
  assert.equal(w.run(w.dep, 'pedido.entregar', { orderId: id }).code, 'TRANSICION_INVALIDA');
  assert.equal(w.run(w.alm1, 'pedido.guardarBorrador', { orderId: id, lines: [{ sku: SKU, qty: 1 }] }).code, 'TRANSICION_INVALIDA');
  assert.equal(snap(), before);
  assert.equal(D.stockSummary(w.state, SKU, TODAY).reservado, 8);

  w.ok(w.dep, 'pedido.preparar', { orderId: id });
  assert.equal(w.run(w.dep, 'pedido.despachar', { orderId: id, responsible: '  ' }).code, 'CAMPO_REQUERIDO');
  assert.equal(w.run(w.alm1, 'pedido.cancelar', { orderId: id, reason: 'x' }).code, 'SIN_PERMISO'); // ya en preparación
  w.ok(w.com, 'pedido.cancelar', { orderId: id, reason: 'Pedido del cliente' });
  assert.equal(D.stockSummary(w.state, SKU, TODAY).disponible, 12);
  assert.equal(w.run(w.dep, 'pedido.despachar', { orderId: id, responsible: 'x' }).code, 'TRANSICION_INVALIDA');
  assert.equal(D.stockSummary(w.state, SKU, TODAY).fisico, 12);
});

test('faltante: por defecto no hay reserva parcial; el operador puede ajustar el borrador de forma explícita', () => {
  const w = world();
  w.receive('R1', 4, 4, 90);
  w.receive('ACP-2', 5, 5, 90, 'PAS-ZAC-300');
  const id = w.ok(w.alm1, 'pedido.guardarBorrador', { lines: [{ sku: SKU, qty: 6 }, { sku: 'PAS-ZAC-300', qty: 2 }] }).orderId;
  const r = w.run(w.alm1, 'pedido.confirmar', { orderId: id });
  assert.equal(r.code, 'STOCK_INSUFICIENTE');
  assert.equal(D.stockSummary(w.state, 'PAS-ZAC-300', TODAY).reservado, 0, 'la línea con stock tampoco se reserva');
  assert.equal(w.run(w.alm1, 'pedido.ajustarADisponible', { orderId: id }).code, 'SIN_PERMISO');
  w.ok(w.com, 'pedido.ajustarADisponible', { orderId: id });
  w.ok(w.com, 'pedido.confirmar', { orderId: id });
  assert.equal(D.stockSummary(w.state, SKU, TODAY).reservado, 4);
  assert.equal(D.stockSummary(w.state, 'PAS-ZAC-300', TODAY).reservado, 2);
});

test('bloqueos y ajustes nunca dejan saldo negativo ni por debajo de lo reservado', () => {
  const w = world();
  const lot = w.receive('R1', 15, 12, 90);
  w.confirmed(w.alm1, 8);
  assert.equal(w.run(w.dep, 'lote.bloquear', { lotId: lot, qty: 5, reason: 'Humedad' }).code, 'STOCK_INSUFICIENTE');
  assert.equal(w.run(w.dep, 'lote.ajustar', { lotId: lot, bucket: 'liberado', delta: -5, reason: 'Rotura' }).code, 'SALDO_NEGATIVO');
  assert.equal(w.run(w.dep, 'lote.ajustar', { lotId: lot, bucket: 'bloqueado', delta: -4, reason: 'Descarte' }).code, 'SALDO_NEGATIVO');
  assert.equal(w.run(w.dep, 'lote.ajustar', { lotId: lot, bucket: 'liberado', delta: -1, reason: '' }).code, 'CAMPO_REQUERIDO');
  w.ok(w.dep, 'lote.bloquear', { lotId: lot, qty: 4, reason: 'Humedad' });
  assert.deepEqual(D.stockSummary(w.state, SKU, TODAY), { fisico: 15, bloqueado: 7, liberado: 8, vencido: 0, reservado: 8, disponible: 0 });
  w.ok(w.dep, 'lote.liberar', { lotId: lot, qty: 2, note: 'Revisión visual' });
  w.ok(w.dep, 'lote.ajustar', { lotId: lot, bucket: 'bloqueado', delta: -5, reason: 'Descarte' });
  assert.deepEqual(D.stockSummary(w.state, SKU, TODAY), { fisico: 10, bloqueado: 0, liberado: 10, vencido: 0, reservado: 8, disponible: 2 });
  const types = w.state.movements.filter((m) => m.lotId === lot).map((m) => m.type);
  assert.deepEqual(types, ['entrada', 'reserva', 'bloqueo', 'liberacion', 'ajuste']);
  assert.deepEqual(D.checkInvariants(w.state), []);
});

test('un lote reservado que vence antes del despacho bloquea el despacho', () => {
  const w = world();
  w.receive('CORTO', 5, 5, 1);
  const id = w.confirmed(w.alm1, 2);
  w.ok(w.dep, 'pedido.preparar', { orderId: id });
  const later = new Date(NOW.getTime() + 3 * 86400000);
  assert.equal(w.run(w.dep, 'pedido.despachar', { orderId: id, responsible: 'x' }, later).code, 'LOTE_VENCIDO');
  assert.equal(D.byId(w.state.lots, w.state.orders.find((o) => o.id === id).lines[0].allocations[0].lotId).liberado, 5);
});

test('recepción: diferencia con lo declarado exige nota; lote duplicado y fecha futura se rechazan', () => {
  const w = world();
  const base = { coopId: 'COOP-ECOAGRO', depositoId: 'DEP-1', sku: SKU, lotCode: 'D1', qtyReceived: 15, qtyReleased: 15, receivedDate: TODAY, expiry: D.addDays(TODAY, 30), responsible: 'x' };
  assert.equal(w.run(w.dep, 'recepcion.registrar', { ...base, qtyDeclared: 20 }).code, 'CAMPO_REQUERIDO');
  assert.equal(w.run(w.dep, 'recepcion.registrar', { ...base, qtyReleased: 12 }).code, 'CAMPO_REQUERIDO'); // bloqueo sin motivo
  assert.equal(w.run(w.dep, 'recepcion.registrar', { ...base, qtyReleased: 16 }).code, 'CANTIDAD_INVALIDA');
  assert.equal(w.run(w.dep, 'recepcion.registrar', { ...base, receivedDate: D.addDays(TODAY, 1) }).code, 'FECHA_INVALIDA');
  assert.equal(w.run(w.dep, 'recepcion.registrar', { ...base, expiry: null }).code, 'CAMPO_REQUERIDO'); // categoría exige vencimiento
  assert.equal(w.run(w.dep, 'recepcion.registrar', { ...base, sku: 'GRA-CHIA' }).code, 'PRODUCTO_NO_DISPONIBLE'); // línea potencial
  assert.equal(w.run(w.dep, 'recepcion.registrar', { ...base, coopId: 'COOP-AGRONORTE' }).code, 'PROVEEDOR_INCORRECTO');
  w.ok(w.dep, 'recepcion.registrar', { ...base, qtyDeclared: 20, discrepancyNote: 'Llegaron 5 menos' });
  assert.equal(w.run(w.dep, 'recepcion.registrar', base).code, 'LOTE_DUPLICADO');
});

test('categoría fuera del piloto no se puede activar', () => {
  const w = world();
  const r = w.run(w.admin, 'producto.guardar', { isNew: true, sku: 'HUE-DOC', name: 'Huevos', categoryId: 'CAT-AVES', presentation: 'Docena', stockUnit: 'unidad', saleUnit: 'unidad', saleFactor: 1, status: 'activo' });
  assert.equal(r.code, 'FUERA_DE_PILOTO');
});

test('unidad de venta distinta de la de stock: la conversión es explícita', () => {
  const w = world();
  w.ok(w.admin, 'producto.guardar', { isNew: true, sku: 'PAS-CAJA', name: 'Pasta surtida', coopId: 'COOP-ECOAGRO', categoryId: 'CAT-PASTAS', presentation: 'Caja de 12 paquetes', stockUnit: 'paquete', saleUnit: 'caja', saleFactor: 12, status: 'activo' });
  w.ok(w.com, 'precio.actualizar', { sku: 'PAS-CAJA', precioAlmacen: 140000 });
  w.receive('CJ1', 30, 30, 90, 'PAS-CAJA');
  assert.equal(D.storefront(w.state, TODAY).find((p) => p.sku === 'PAS-CAJA').available, 2); // 30 paquetes = 2 cajas completas
  const id = w.ok(w.alm1, 'pedido.guardarBorrador', { lines: [{ sku: 'PAS-CAJA', qty: 3 }] }).orderId;
  assert.equal(w.run(w.alm1, 'pedido.confirmar', { orderId: id }).code, 'STOCK_INSUFICIENTE');
  const id2 = w.confirmed(w.alm2, 2, 'PAS-CAJA');
  assert.equal(D.stockSummary(w.state, 'PAS-CAJA', TODAY).reservado, 24);
  assert.equal(w.state.orders.find((o) => o.id === id2).total, 280000);
});

test('indicadores de precio: margen sobre venta ≠ recargo sobre costo; sin dato → null', () => {
  const full = D.priceIndicators({ costoProveedor: 9000, costoLogistico: 1000, precioAlmacen: 12500, precioSugerido: 16000 });
  assert.equal(full.costoTotal, 10000);
  assert.equal(full.gananciaDistribuidora, 2500);
  assert.equal(full.margenDistribuidora, 0.2); // 2.500 / 12.500
  assert.equal(full.recargoDistribuidora, 0.25); // 2.500 / 10.000
  assert.equal(full.margenAlmacen, 3500 / 16000);
  assert.equal(full.recargoAlmacen, 0.28);
  assert.equal(full.participacionProductor, 9000 / 16000);
  const noLog = D.priceIndicators({ costoProveedor: 9000, costoLogistico: null, precioAlmacen: 12500, precioSugerido: null });
  assert.equal(noLog.costoTotal, null);
  assert.equal(noLog.margenDistribuidora, null);
  assert.equal(noLog.margenAlmacen, null);
  assert.equal(noLog.participacionProductor, null);
});

test('costo de entrega: queda registrado en el pedido al confirmar', () => {
  const w = world();
  w.receive('R1', 12, 12, 90);
  const a = w.confirmed(w.alm1, 2);
  w.ok(w.admin, 'config.actualizar', { deliveryFee: 15000 });
  const b = w.confirmed(w.alm2, 2);
  w.ok(w.admin, 'config.actualizar', { deliveryFee: 30000 });
  const get = (id) => w.state.orders.find((o) => o.id === id);
  assert.equal(get(a).deliveryFee, null);
  assert.equal(get(a).total, 25000);
  assert.equal(get(b).deliveryFee, 15000);
  assert.equal(get(b).total, 40000);
});

test('auditoría: cada cambio aceptado deja un registro; los rechazados no', () => {
  const w = world();
  const n = w.state.audit.length;
  w.ok(w.com, 'precio.actualizar', { sku: SKU, precioAlmacen: 13000 });
  assert.equal(w.state.audit.length, n + 1);
  assert.match(w.state.audit[n].summary, /Gs\. 12\.500 → Gs\. 13\.000/);
  w.run(w.com, 'precio.actualizar', { sku: SKU, precioAlmacen: -5 });
  assert.equal(w.state.audit.length, n + 1);
});

test('formato local: guaraníes sin centavos y fechas dd/mm/aaaa', () => {
  assert.equal(D.fmtGs(1250000), 'Gs. 1.250.000');
  assert.equal(D.fmtGs(null), 'Sin datos');
  assert.equal(D.fmtDate('2026-11-14'), '14/11/2026');
  assert.equal(D.qtyLabel(1, 'paquete'), '1 paquete');
  assert.equal(D.qtyLabel(8, 'paquete'), '8 paquetes');
});

test('ficha de producto: descripción, foto y video se validan y llegan a la vitrina sin costos', () => {
  const w = world();
  const base = Object.assign({}, w.state.products.find((p) => p.sku === SKU), { isNew: false });
  const save = (extra) => w.run(w.admin, 'producto.guardar', Object.assign({}, base, extra));
  assert.equal(save({ video: 'javascript:alert(1)' }).code, 'ENLACE_INVALIDO');
  assert.equal(save({ video: 'http://sin-cifrar.example/v.mp4' }).code, 'ENLACE_INVALIDO');
  assert.equal(save({ photo: 'assets/../secreto.jpg' }).code, 'ENLACE_INVALIDO');
  assert.equal(save({ video: 'data:image/png;base64,AAAA' }).code, 'ENLACE_INVALIDO');
  assert.equal(save({ description: 'Texto de prueba', photo: 'data:image/jpeg;base64,AAAA', video: 'assets/videos/remolacha.mp4' }).ok, true);
  w.receive('R1', 6, 6, 40);
  const item = D.storefront(w.state, TODAY).find((p) => p.sku === SKU);
  assert.equal(item.description, 'Texto de prueba');
  assert.equal(item.video, 'assets/videos/remolacha.mp4');
  assert.equal(item.nextExpiry, D.addDays(TODAY, 40));
  assert.ok(!/costo|margen|pricing/i.test(JSON.stringify(item)));
});

test('checkout y pago SIPAP: dirección, forma de pago, aviso del cliente y confirmación manual por Administración', () => {
  const w = world();
  w.receive('R1', 12, 12, 90);
  const b = w.ok(w.alm1, 'pedido.guardarBorrador', {
    lines: [{ sku: SKU, qty: 2 }],
    deliveryAddress: 'Av. España 1234',
    deliveryZone: 'Las Mercedes',
    deliverySlot: 'Mañana (08:00 a 12:00)',
    paymentMethod: 'sipap_qr'
  });
  const oid = b.orderId;
  w.ok(w.alm1, 'pedido.confirmar', { orderId: oid });
  let ord = w.state.orders.find((o) => o.id === oid);
  assert.equal(ord.checkout.address, 'Av. España 1234');
  assert.equal(ord.checkout.zone, 'Las Mercedes');
  assert.equal(ord.payment.method, 'sipap_qr');
  assert.equal(ord.payment.status, 'pendiente');

  // El cliente informa su transferencia pero no puede acreditarse a sí mismo.
  w.ok(w.alm1, 'pedido.informarPago', { orderId: oid, ref: 'SPI-774912' });
  ord = w.state.orders.find((o) => o.id === oid);
  assert.equal(ord.payment.status, 'en_verificacion');
  assert.equal(ord.payment.ref, 'SPI-774912');
  assert.equal(w.run(w.alm1, 'pedido.confirmarPago', { orderId: oid }).code, 'SIN_PERMISO');

  // Administración confirma el pago manualmente.
  w.ok(w.admin, 'pedido.confirmarPago', { orderId: oid, ref: 'SPI-774912-OK' });
  ord = w.state.orders.find((o) => o.id === oid);
  assert.equal(ord.payment.status, 'acreditado');
  assert.equal(ord.payment.ref, 'SPI-774912-OK');
  assert.ok(ord.payment.confirmedAt);
});
