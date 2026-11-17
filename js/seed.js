/*
 * Datos de arranque.
 * - buildInicial: catálogo real sin precios, cooperativas conocidas y la cuenta de Administración (datos de trabajo).
 * - buildDemo: varias semanas de actividad ficticia sobre el catálogo real, para presentar el panel.
 * - buildSeed: escenario de prueba ficticio que usan los tests y el guion de aceptación (PAS-REM-300 arranca sin stock).
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var D = node ? require('./domain.js') : root.YvyDomain;
  var C = node ? require('./catalogo.js') : root.YvyCatalogo;
  var api = factory(D, C);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YvySeed = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D, C) {
  'use strict';

  function buildSeed(now) {
    now = now instanceof Date ? now : new Date(now || Date.now());
    var today = D.localDate(now);
    var s = D.emptyState();

    s.orgs = [
      { id: 'COOP-ECOAGRO', type: 'cooperativa', name: 'Ecoagro', active: true },
      { id: 'COOP-AGRONORTE', type: 'cooperativa', name: 'Agronorte', active: true },
      { id: 'ALM-001', type: 'almacen', name: 'Almacén Prueba Uno', zona: 'Zona A (ficticia)', contacto: 'Contacto de prueba', notes: '', active: true },
      { id: 'ALM-002', type: 'almacen', name: 'Almacén Prueba Dos', zona: 'Zona A (ficticia)', contacto: 'Contacto de prueba', notes: '', active: true },
      { id: 'ALM-003', type: 'almacen', name: 'Almacén Prueba Tres', zona: 'Zona B (ficticia)', contacto: 'Contacto de prueba', notes: '', active: true }
    ];
    s.seq.org = 3;
    s.users = [
      { id: 'U-001', name: 'Almacenero de prueba (Uno)', username: 'uno', cred: null, role: 'almacen', orgId: 'ALM-001', active: true },
      { id: 'U-002', name: 'Almacenero de prueba (Dos)', username: 'dos', cred: null, role: 'almacen', orgId: 'ALM-002', active: true },
      { id: 'U-003', name: 'Depósito de prueba', username: 'deposito', cred: null, role: 'operacion', orgId: null, active: true },
      { id: 'U-004', name: 'Comercial de prueba', username: 'comercial', cred: null, role: 'comercial', orgId: null, active: true },
      { id: 'U-005', name: 'Ecoagro de prueba', username: 'ecoagro', cred: null, role: 'cooperativa', orgId: 'COOP-ECOAGRO', active: true },
      { id: 'U-006', name: 'Agronorte de prueba', username: 'agronorte', cred: null, role: 'cooperativa', orgId: 'COOP-AGRONORTE', active: true },
      { id: 'U-007', name: 'Administración de prueba', username: 'admin', cred: null, role: 'admin', orgId: null, active: true }
    ];
    s.seq.user = 7;
    s.depositos = [{ id: 'DEP-1', name: 'Depósito piloto (ubicación por definir)' }];
    s.categories = [
      { id: 'CAT-PASTAS', name: 'Pastas secas', requiresExpiry: true, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
      { id: 'CAT-ESPECIAS', name: 'Especias en polvo', requiresExpiry: true, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
      { id: 'CAT-GRANOS', name: 'Granos y semillas', requiresExpiry: false, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
      { id: 'CAT-RAICES', name: 'Raíces y tubérculos', requiresExpiry: false, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
      { id: 'CAT-AVES', name: 'Aves, huevos y otros perecederos', requiresExpiry: true, requiresDoc: true, fueraDePiloto: true, qualityNote: '' }
    ];

    var admin = s.users[6];
    var state = s;
    function run(type, payload, when) {
      var r = D.execute(state, admin, { type: type, payload: payload }, when || now);
      if (!r.ok) throw new Error('Semilla inválida (' + type + '): ' + r.message);
      state = r.state;
      return r.result;
    }
    function product(sku, name, cat, presentation, unit, status, coopId) {
      run('producto.guardar', {
        isNew: true, sku: sku, name: name, coopId: coopId, origin: '', categoryId: cat, presentation: presentation,
        stockUnit: unit, saleUnit: unit, saleFactor: 1, status: status, docRequired: false, docRef: ''
      });
    }
    var ECO = 'COOP-ECOAGRO';
    product('PAS-REM-300', 'Pasta de remolacha', 'CAT-PASTAS', 'Paquete de 300 g', 'paquete', 'activo', ECO);
    product('PAS-ACP-300', 'Pasta de acelga y perejil', 'CAT-PASTAS', 'Paquete de 300 g', 'paquete', 'activo', ECO);
    product('PAS-LOC-300', 'Pasta de locote rojo', 'CAT-PASTAS', 'Paquete de 300 g', 'paquete', 'activo', ECO);
    product('PAS-ZAP-300', 'Pasta de zapallo y calabaza', 'CAT-PASTAS', 'Paquete de 300 g', 'paquete', 'activo', ECO);
    product('PAS-ZAC-300', 'Pasta de zanahoria y cúrcuma', 'CAT-PASTAS', 'Paquete de 300 g', 'paquete', 'activo', ECO);
    product('ESP-CUR-050', 'Cúrcuma en polvo', 'CAT-ESPECIAS', 'Envase de 50 g', 'unidad', 'activo', ECO);
    product('ESP-JEN-050', 'Jengibre en polvo', 'CAT-ESPECIAS', 'Envase de 50 g', 'unidad', 'activo', ECO);
    // Líneas potenciales: sin precio, sin stock y sin origen asignado hasta que el equipo lo defina.
    product('GRA-CHIA', 'Chía', 'CAT-GRANOS', 'Presentación por definir', 'kg', 'potencial', null);
    product('GRA-SESAMO', 'Sésamo', 'CAT-GRANOS', 'Presentación por definir', 'kg', 'potencial', null);
    product('GRA-MANI', 'Maní', 'CAT-GRANOS', 'Presentación por definir', 'kg', 'potencial', null);
    product('GRA-POROTO', 'Poroto', 'CAT-GRANOS', 'Presentación por definir', 'kg', 'potencial', null);
    product('RAI-MANDIOCA', 'Mandioca', 'CAT-RAICES', 'Presentación por definir', 'kg', 'potencial', null);
    // Ejemplo de conversión explícita (hipótesis de prueba): 1 caja = 12 paquetes.
    state.products.forEach(function (p) {
      if (p.categoryId === 'CAT-PASTAS') p.conversions = [{ unit: 'caja', factor: 12 }];
    });

    // Precios ficticios, solo para que el piloto se pueda recorrer. No son una lista aprobada.
    function price(sku, costo, logistico, almacen, sugerido) {
      run('precio.actualizar', { sku: sku, costoProveedor: costo, costoLogistico: logistico, precioAlmacen: almacen, precioSugerido: sugerido });
    }
    price('PAS-REM-300', 9000, 800, 12500, 16000);
    price('PAS-ACP-300', 9000, 800, 12500, 16000);
    price('PAS-LOC-300', 9500, null, 13000, 16500);
    price('PAS-ZAP-300', 9000, 800, 12500, null);
    price('PAS-ZAC-300', 9500, 800, 13000, 16500);
    price('ESP-CUR-050', 6000, null, 8500, 11000);
    // ESP-JEN-050 queda sin precio a propósito: muestra "Sin datos" y no aparece en la vitrina.

    var past = new Date(now.getTime() - 3 * 86400000);
    function receive(sku, code, qty, released, expiryDays, reason) {
      run('recepcion.registrar', {
        coopId: ECO, depositoId: 'DEP-1', sku: sku, lotCode: code, qtyReceived: qty, qtyReleased: released,
        blockReason: reason || '', receivedDate: D.localDate(past), expiry: D.addDays(today, expiryDays), responsible: 'Depósito de prueba'
      }, past);
    }
    receive('PAS-ACP-300', 'ACP-PRUEBA-01', 24, 24, 150);
    receive('PAS-LOC-300', 'LOC-PRUEBA-01', 10, 10, 12);
    receive('PAS-LOC-300', 'LOC-PRUEBA-02', 18, 18, 160);
    receive('ESP-CUR-050', 'CUR-PRUEBA-01', 30, 0, 300, 'Pendiente de control de calidad (procedimiento por validar)');

    run('oferta.registrar', {
      coopId: ECO, sku: 'PAS-ZAP-300', qty: 40, unit: 'paquete', windowFrom: D.addDays(today, 3), windowTo: D.addDays(today, 9),
      kind: 'capacidad', confirmation: 'probable', origin: '', notes: 'Ejemplo de prueba'
    });
    run('demanda.registrar', {
      almacenId: 'ALM-002', sku: 'PAS-ZAP-300', qty: 15, unit: 'paquete', windowFrom: D.addDays(today, 14), windowTo: D.addDays(today, 20),
      kind: 'interes', notes: 'Ejemplo de prueba: ventana que no coincide con la oferta'
    });
    run('demanda.registrar', {
      almacenId: 'ALM-003', sku: 'GRA-CHIA', qty: 5, unit: 'kg', windowFrom: D.addDays(today, 7), windowTo: D.addDays(today, 21),
      kind: 'interes', notes: 'Ejemplo de prueba: línea potencial sin oferta'
    });

    state.audit = [{ id: 'A-00000', at: now.toISOString(), actor: 'Sistema', action: 'semilla', summary: 'Se cargó el escenario de prueba.' }];
    state.label = 'Escenario de prueba';
    state.fixture = true;
    state.seq.audit = 0;
    return state;
  }

  /**
   * Datos iniciales de trabajo: el catálogo real (fotos y fichas, sin precios ni stock),
   * las cooperativas conocidas y una sola cuenta de Administración, sin contraseña:
   * la contraseña se crea en el primer ingreso.
   */
  function buildInicial(now) {
    now = now instanceof Date ? now : new Date(now || Date.now());
    var s = D.emptyState();
    s.label = '';
    s.orgs = [
      { id: 'COOP-ECOAGRO', type: 'cooperativa', name: 'Ecoagro', zona: 'Itauguá', contacto: '', notes: '', active: true },
      { id: 'COOP-AGRONORTE', type: 'cooperativa', name: 'Agronorte', zona: '', contacto: '', notes: '', active: true }
    ];
    s.users = [{ id: 'U-001', name: 'Administración', username: 'admin', role: 'admin', orgId: null, active: true, cred: null }];
    s.seq.user = 1;
    s.depositos = [{ id: 'DEP-1', name: 'Depósito principal' }];
    s.categories = C.CATEGORIES.map(function (c) { return D.clone(c); });
    s.products = C.products('COOP-ECOAGRO');
    s.audit = [{ id: 'A-00000', at: now.toISOString(), actor: 'Sistema', action: 'inicio', summary: 'Se cargó el catálogo inicial (' + s.products.length + ' productos, sin precios).' }];
    s.seq.audit = 0;
    var problems = D.checkInvariants(s);
    if (problems.length) throw new Error('Datos iniciales inconsistentes: ' + problems.join(' '));
    return s;
  }

  /** Generador pseudoaleatorio con semilla fija: el escenario sale igual cada vez. */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Productos que usa la demostración y sus precios FICTICIOS (Gs.): costo, logística, precio al almacén, sugerido.
  var DEMO_PRODUCTS = [
    { sku: 'ECO-2148', code: 'REM', price: [9000, 800, 12500, 16000], supply: [15, 23], qty: [2, 8] },
    { sku: 'ECO-2146', code: 'ACE', price: [9000, 800, 12500, 16000], supply: [12, 20], qty: [2, 7] },
    { sku: 'ECO-1967', code: 'CAL', price: [9000, 800, 12500, 16000], supply: [8, 16], qty: [2, 7] },
    { sku: 'ECO-1814', code: 'ESP', price: [9000, 800, 12500, 16000], supply: [10, 18], qty: [2, 6] },
    { sku: 'ECO-1810', code: 'ZAN', price: [9000, 800, 12500, 16000], supply: [4, 10], qty: [2, 6] },
    { sku: 'ECO-942', code: 'CUR', price: [6000, null, 8500, 11000], supply: [5, 11], qty: [1, 5] },
    { sku: 'ECO-944', code: 'JEN', price: [6000, 500, 8500, 11000], supply: [3, 7], qty: [1, 4] },
    { sku: 'ECO-963', code: 'MIE', price: [15000, 1000, 21000, 27000], supply: [5, 11], qty: [1, 4] },
    { sku: 'ECO-738', code: 'CHI', price: [7000, 600, 10000, 13000], supply: [5, 11], qty: [1, 5] },
    { sku: 'ECO-1029', code: 'POR', price: [7500, 800, 10500, 14000], supply: [8, 14], qty: [1, 5] },
    { sku: 'ECO-770', code: 'ALM', price: [6500, 700, 9500, 12500], supply: [9, 17], qty: [2, 6] },
    { sku: 'ECO-1035', code: 'MAN', price: [9000, 800, 13000, 17000], supply: [3, 8], qty: [1, 4] }
  ];

  /**
   * Escenario de demostración: varias semanas de actividad FICTICIA sobre el catálogo real,
   * con clientes de ejemplo y precios inventados. Cada paso pasa por las mismas reglas de la aplicación,
   * así que los números cierran. No es una proyección ni un volumen esperado.
   */
  function buildDemo(now, weeks) {
    now = now instanceof Date ? now : new Date(now || Date.now());
    weeks = weeks || 13;
    var days = weeks * 7;
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 7, 0, 0);
    var state = buildInicial(start);
    var rnd = mulberry32(20261116);
    var between = function (a, b) { return a + Math.floor(rnd() * (b - a + 1)); };
    var chance = function (p) { return rnd() < p; };
    var at = function (day, hour, min) { return new Date(start.getFullYear(), start.getMonth(), start.getDate() + day, hour, min || 0, 0); };
    var later = function (t, minutes) { return new Date(t.getTime() + minutes * 60000); };
    var nowDay = D.localDate(now);

    function exec(userId, type, payload, when) {
      var r = D.execute(state, D.byId(state.users, userId), { type: type, payload: payload }, when);
      if (r.ok) state = r.state;
      return r;
    }
    function must(userId, type, payload, when) {
      var r = exec(userId, type, payload, when);
      if (!r.ok) throw new Error('Escenario de demostración (' + type + ' ' + D.localDate(when) + '): ' + r.message);
      return r.result;
    }

    // Clientes, cuentas y precios de ejemplo.
    var ADM = 'U-001';
    var t0 = at(0, 7, 5);
    var almacenes = [
      ['Despensa Ejemplo Norte', 'Zona norte (ejemplo)'],
      ['Almacén Ejemplo Centro', 'Zona centro (ejemplo)'],
      ['Bodega Ejemplo Sur', 'Zona sur (ejemplo)']
    ].map(function (a) { return must(ADM, 'almacen.guardar', { name: a[0], zona: a[1], contacto: '', notes: 'Cliente de demostración', active: true }, t0).id; });
    var COM = must(ADM, 'usuario.guardar', { name: 'Ventas (demostración)', username: 'ventas', role: 'comercial', active: true }, t0).id;
    var DEP = must(ADM, 'usuario.guardar', { name: 'Depósito (demostración)', username: 'deposito', role: 'operacion', active: true }, t0).id;
    var ECO = must(ADM, 'usuario.guardar', { name: 'Ecoagro (demostración)', username: 'ecoagro', role: 'cooperativa', orgId: 'COOP-ECOAGRO', active: true }, t0).id;
    var C1 = must(ADM, 'usuario.guardar', { name: 'Cliente Ejemplo Norte', username: 'norte', role: 'almacen', orgId: almacenes[0], active: true }, t0).id;
    var C2 = must(ADM, 'usuario.guardar', { name: 'Cliente Ejemplo Centro', username: 'centro', role: 'almacen', orgId: almacenes[1], active: true }, t0).id;
    DEMO_PRODUCTS.forEach(function (p, i) {
      must(COM, 'precio.actualizar', { sku: p.sku, costoProveedor: p.price[0], costoLogistico: p.price[1], precioAlmacen: p.price[2], precioSugerido: p.price[3] }, later(t0, i + 1));
    });
    var BUYERS = [
      { almacenId: almacenes[0], userId: C1, size: 1 },
      { almacenId: almacenes[1], userId: C2, size: 1 },
      { almacenId: almacenes[2], userId: COM, size: 1.4 } // sin cuenta propia: lo carga Ventas
    ];

    // Cola de eventos en orden de fecha. Lo que cae después de "ahora" no ocurre: deja pedidos en curso.
    var queue = [];
    var seq = 0;
    function schedule(when, fn) { queue.push({ t: when.getTime(), n: seq++, fn: fn }); }

    // Recepciones semanales de Ecoagro (incluye la de hoy si ya ocurrió).
    for (var w = 0; w <= weeks; w++) {
      (function (week) {
        schedule(at(week * 7, 8), function (t) {
          var day = D.localDate(t);
          DEMO_PRODUCTS.forEach(function (p, i) {
            var qty = between(p.supply[0], p.supply[1]);
            var blocked = chance(0.12) ? between(1, 3) : 0;
            var declared = chance(0.1) ? qty + between(1, 3) : qty;
            // Un lote de la penúltima semana vence pronto, para ver la alerta de vencimiento.
            var shortLot = week === weeks - 2 && p.code === 'CHI';
            if (shortLot) qty += 24;
            var expiry = shortLot ? D.addDays(nowDay, 9) : D.addDays(day, between(120, 180));
            var res = must(DEP, 'recepcion.registrar', {
              coopId: 'COOP-ECOAGRO', depositoId: 'DEP-1', sku: p.sku, lotCode: 'L' + (week + 1) + '-' + p.code,
              qtyDeclared: declared === qty ? null : declared, qtyReceived: qty, qtyReleased: qty - blocked,
              blockReason: blocked ? 'Envase dañado' : '',
              discrepancyNote: declared === qty ? '' : 'Llegaron ' + (declared - qty) + ' menos de lo avisado',
              receivedDate: day, expiry: expiry, responsible: 'Depósito (demostración)'
            }, later(t, i));
            if (blocked) {
              var release = chance(0.5);
              schedule(at(week * 7 + 2, 9), function (t2) {
                var lot = D.byId(state.lots, res.lotId);
                if (!lot || lot.bloqueado < blocked) return;
                if (release) must(DEP, 'lote.liberar', { lotId: lot.id, qty: blocked, note: 'Revisión: envase sano' }, t2);
                else must(DEP, 'lote.ajustar', { lotId: lot.id, bucket: 'bloqueado', delta: -blocked, reason: 'Descarte por envase dañado' }, t2);
              });
            }
          });
        });
      })(w);
    }

    // Cambios de lista a mitad del período: los pedidos ya confirmados conservan su precio y su costo.
    schedule(at(Math.floor(days / 2), 9), function (t) {
      must(COM, 'precio.actualizar', { sku: 'ECO-2148', precioAlmacen: 13000 }, t);
      must(COM, 'precio.actualizar', { sku: 'ECO-2146', precioAlmacen: 13000 }, later(t, 1));
    });
    schedule(at(Math.floor(days * 0.6), 9), function (t) {
      must(COM, 'precio.actualizar', { sku: 'ECO-942', costoLogistico: 500 }, t);
    });

    function pipeline(orderId, t0) {
      if (chance(0.07)) {
        schedule(later(t0, 60 * 20), function (t) {
          must(COM, 'pedido.cancelar', { orderId: orderId, reason: 'El cliente pidió cancelar' }, t);
        });
        return;
      }
      var d0 = Math.round((t0.getTime() - start.getTime()) / 86400000);
      var prep = at(d0 + 1, 9, between(0, 50));
      var disp = at(d0 + between(1, 2), 13, between(0, 50));
      if (disp <= prep) disp = later(prep, 120);
      var deliv = later(disp, between(90, 300));
      schedule(prep, function (t) { must(DEP, 'pedido.preparar', { orderId: orderId }, t); });
      schedule(disp, function (t) {
        var o = D.byId(state.orders, orderId);
        if (o.status !== 'en_preparacion') return;
        var r = exec(DEP, 'pedido.despachar', { orderId: orderId, responsible: chance(0.5) ? 'Reparto A' : 'Reparto B', notes: '' }, t);
        if (r.ok) {
          schedule(deliv, function (t2) { must(DEP, 'pedido.entregar', { orderId: orderId, notes: '' }, t2); });
        } else if (r.code === 'LOTE_VENCIDO') {
          must(COM, 'pedido.cancelar', { orderId: orderId, reason: 'Lote vencido antes del despacho' }, later(t, 5));
        } else {
          throw new Error('Escenario de demostración (despacho): ' + r.message);
        }
      });
    }
    function newOrder(buyer, t) {
      var picks = DEMO_PRODUCTS.slice().sort(function () { return rnd() - 0.5; }).slice(0, between(2, 5));
      var lines = picks.map(function (p) { return { sku: p.sku, qty: Math.max(1, Math.round(between(p.qty[0], p.qty[1]) * buyer.size)) }; });
      var day = D.localDate(t);
      var payload = { lines: lines, windowFrom: D.addDays(day, 1), windowTo: D.addDays(day, 3), notes: '' };
      if (buyer.userId === COM) payload.almacenId = buyer.almacenId;
      var orderId = must(buyer.userId, 'pedido.guardarBorrador', payload, t).orderId;
      var r = exec(buyer.userId, 'pedido.confirmar', { orderId: orderId }, later(t, 3));
      if (r.ok) return pipeline(orderId, t);
      if (r.code !== 'STOCK_INSUFICIENTE') throw new Error('Escenario de demostración (confirmar): ' + r.message);
      must(buyer.userId, 'pedido.registrarFaltante', { orderId: orderId }, later(t, 4));
      if (chance(0.6)) {
        must(COM, 'pedido.ajustarADisponible', { orderId: orderId }, later(t, 40));
        if (D.byId(state.orders, orderId).lines.length) {
          must(COM, 'pedido.confirmar', { orderId: orderId }, later(t, 42));
          return pipeline(orderId, later(t, 42));
        }
      }
      must(COM, 'pedido.cancelar', { orderId: orderId, reason: 'Sin stock suficiente' }, later(t, 45));
    }
    for (var d = 1; d <= days; d++) {
      BUYERS.forEach(function (buyer) {
        if (chance(0.34 + 0.24 * (d / days))) {
          schedule(at(d, between(10, 18), between(0, 59)), function (t) { newOrder(buyer, t); });
        }
      });
    }

    // Oferta y demanda para las próximas semanas.
    schedule(at(days - 1, 10), function (t) {
      must(ECO, 'oferta.registrar', { sku: 'ECO-1810', qty: 30, unit: 'unidad', windowFrom: D.addDays(nowDay, 3), windowTo: D.addDays(nowDay, 10), kind: 'disponible', confirmation: 'confirmada', origin: '', notes: '' }, t);
      must(ECO, 'oferta.registrar', { sku: 'ECO-2148', qty: 40, unit: 'unidad', windowFrom: D.addDays(nowDay, 7), windowTo: D.addDays(nowDay, 14), kind: 'capacidad', confirmation: 'probable', origin: '', notes: '' }, later(t, 1));
      must(C1, 'demanda.registrar', { sku: 'ECO-1810', qty: 20, unit: 'unidad', windowFrom: D.addDays(nowDay, 3), windowTo: D.addDays(nowDay, 7), kind: 'pedido_firme', notes: '' }, later(t, 2));
      must(C2, 'demanda.registrar', { sku: 'ECO-944', qty: 12, unit: 'unidad', windowFrom: D.addDays(nowDay, 4), windowTo: D.addDays(nowDay, 9), kind: 'interes', notes: '' }, later(t, 3));
    });

    while (queue.length) {
      queue.sort(function (a, b) { return a.t - b.t || a.n - b.n; });
      var ev = queue.shift();
      if (ev.t > now.getTime()) continue;
      ev.fn(new Date(ev.t));
    }

    var problems = D.checkInvariants(state);
    if (problems.length) throw new Error('Escenario de demostración inconsistente: ' + problems.join(' '));
    state.label = 'Demostración';
    state.demo = { generatedAt: now.toISOString(), from: D.localDate(start), to: nowDay, weeks: weeks };
    return state;
  }

  return { buildSeed: buildSeed, buildInicial: buildInicial, buildDemo: buildDemo, DEMO_PRODUCTS: DEMO_PRODUCTS };
});
