/*
 * Yvy Guaraní S.A. — núcleo de reglas del piloto (sin dependencias).
 *
 * Todo cambio pasa por execute(state, actor, cmd, now): valida permisos y reglas,
 * trabaja sobre una copia y devuelve el estado nuevo, o el estado original intacto
 * si algo falla (ninguna operación queda a medias).
 * El mismo archivo corre en el navegador (window.YvyDomain) y en Node (require).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YvyDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCHEMA_VERSION = 3;
  var DEFAULT_STORE_NAME = 'Mercado Yvy';
  var APP_ID = 'yvy-guarani-piloto';

  var UNITS = {
    paquete: { one: 'paquete', many: 'paquetes' },
    unidad: { one: 'unidad', many: 'unidades' },
    caja: { one: 'caja', many: 'cajas' },
    bolsa: { one: 'bolsa', many: 'bolsas' },
    kg: { one: 'kg', many: 'kg' }
  };

  var ROLES = {
    admin: 'Administración',
    comercial: 'Ventas',
    operacion: 'Depósito',
    cooperativa: 'Cooperativa',
    almacen: 'Cliente (almacén)'
  };

  var ORDER_STATUS = {
    borrador: 'Borrador',
    reservado: 'Reservado',
    en_preparacion: 'En preparación',
    despachado: 'Despachado',
    entregado: 'Entregado',
    cancelado: 'Cancelado'
  };
  var ORDER_FLOW = ['borrador', 'reservado', 'en_preparacion', 'despachado', 'entregado'];
  var TRANSITIONS = {
    borrador: ['reservado', 'cancelado'],
    reservado: ['en_preparacion', 'cancelado'],
    en_preparacion: ['despachado', 'cancelado'],
    despachado: ['entregado'],
    entregado: [],
    cancelado: []
  };

  var PRODUCT_STATUS = { activo: 'Activo', potencial: 'Línea potencial', inactivo: 'Inactivo' };
  var OFFER_CONFIRMATION = {
    estimacion: 'Estimación',
    probable: 'Probable',
    confirmada: 'Confirmada por la cooperativa'
  };
  var OFFER_KIND = { disponible: 'Disponible ahora', capacidad: 'Capacidad futura' };
  var DEMAND_KIND = { interes: 'Interés', pedido_firme: 'Pedido firme a futuro' };
  var MOVEMENT_TYPES = {
    entrada: 'Entrada',
    ajuste: 'Ajuste',
    bloqueo: 'Bloqueo',
    liberacion: 'Liberación para venta',
    reserva: 'Reserva',
    liberacion_reserva: 'Liberación de reserva',
    salida: 'Salida'
  };
  var PAYMENT_METHODS = {
    sipap_qr: 'QR SIPAP / SPI',
    transferencia: 'Transferencia bancaria',
    contra_entrega: 'Pago contra entrega'
  };
  var PAYMENT_STATUS = {
    pendiente: 'Pendiente de pago',
    en_verificacion: 'Comprobante informado',
    acreditado: 'Pago acreditado'
  };

  var PERMISSIONS = {
    'producto.guardar': ['admin'],
    'precio.actualizar': ['comercial', 'admin'],
    'almacen.guardar': ['comercial', 'admin'],
    'usuario.guardar': ['admin'],
    'config.actualizar': ['admin'],
    'categoria.actualizar': ['admin'],
    'oferta.registrar': ['cooperativa', 'comercial', 'admin'],
    'oferta.anular': ['cooperativa', 'comercial', 'admin'],
    'demanda.registrar': ['almacen', 'comercial', 'admin'],
    'demanda.anular': ['almacen', 'comercial', 'admin'],
    'recepcion.registrar': ['operacion', 'admin'],
    'lote.bloquear': ['operacion', 'admin'],
    'lote.liberar': ['operacion', 'admin'],
    'lote.ajustar': ['operacion', 'admin'],
    'pedido.guardarBorrador': ['almacen', 'comercial', 'admin'],
    'pedido.confirmar': ['almacen', 'comercial', 'admin'],
    'pedido.ajustarADisponible': ['operacion', 'comercial', 'admin'],
    'pedido.preparar': ['operacion', 'admin'],
    'pedido.despachar': ['operacion', 'admin'],
    'pedido.entregar': ['operacion', 'comercial', 'admin'],
    'pedido.cancelar': ['almacen', 'operacion', 'comercial', 'admin'],
    'pedido.registrarFaltante': ['almacen', 'comercial', 'admin'],
    'pedido.informarPago': ['almacen', 'comercial', 'admin'],
    'pedido.confirmarPago': ['comercial', 'admin'],
    'usuario.credencial': ['admin', 'comercial', 'operacion', 'cooperativa', 'almacen'],
    'cooperativa.guardar': ['admin']
  };

  // ---------- utilidades ----------

  function DomainError(code, message, details) {
    this.name = 'DomainError';
    this.code = code;
    this.message = message;
    this.details = details || null;
  }
  DomainError.prototype = Object.create(Error.prototype);

  function fail(code, message, details) {
    throw new DomainError(code, message, details);
  }

  function clone(o) {
    return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function localDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
  }
  function addDays(dateStr, n) {
    var p = dateStr.split('-').map(Number);
    return localDate(new Date(p[0], p[1] - 1, p[2] + n));
  }
  function daysBetween(a, b) {
    var pa = a.split('-').map(Number);
    var pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function isInt(n) {
    return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
  }
  function text(v) {
    return typeof v === 'string' ? v.trim() : '';
  }
  function reqText(v, label) {
    var t = text(v);
    if (!t) fail('CAMPO_REQUERIDO', 'Falta completar: ' + label + '.');
    return t;
  }
  function reqQty(v, label) {
    if (!isInt(v) || v <= 0) {
      fail('CANTIDAD_INVALIDA', (label || 'La cantidad') + ' debe ser un número entero mayor que cero.');
    }
    return v;
  }
  function reqDate(v, label) {
    if (!isDate(v)) fail('FECHA_INVALIDA', 'Fecha inválida: ' + label + '.');
    return v;
  }
  function reqWindow(from, to) {
    reqDate(from, 'inicio de la ventana');
    reqDate(to, 'fin de la ventana');
    if (to < from) fail('VENTANA_INVALIDA', 'La ventana termina antes de empezar.');
  }
  function unitLabel(unit, qty) {
    var u = UNITS[unit];
    if (!u) return unit;
    return qty === 1 ? u.one : u.many;
  }
  function qtyLabel(qty, unit) {
    return fmtInt(qty) + ' ' + unitLabel(unit, qty);
  }
  function fmtInt(n) {
    var s = String(Math.abs(Math.round(n)));
    var out = '';
    while (s.length > 3) {
      out = '.' + s.slice(-3) + out;
      s = s.slice(0, -3);
    }
    return (n < 0 ? '-' : '') + s + out;
  }
  function fmtGs(n) {
    return n === null || n === undefined ? 'Sin datos' : 'Gs. ' + fmtInt(n);
  }
  function fmtDate(s) {
    if (!s) return '—';
    var d = s.slice(0, 10).split('-');
    return d[2] + '/' + d[1] + '/' + d[0];
  }

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function productOf(state, sku) {
    for (var i = 0; i < state.products.length; i++) if (state.products[i].sku === sku) return state.products[i];
    return null;
  }
  function nextId(d, key, prefix, width) {
    d.seq[key] = (d.seq[key] || 0) + 1;
    var s = String(d.seq[key]);
    while (s.length < (width || 4)) s = '0' + s;
    return prefix + s;
  }

  /**
   * Foto o video de un producto: enlace https, archivo dentro de assets/ o (solo foto) imagen incrustada.
   * Cualquier otro esquema se rechaza para no ejecutar contenido ajeno.
   */
  function mediaRef(v, label, allowData) {
    var t = text(v);
    if (!t) return null;
    if (allowData && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(t)) {
      if (t.length > 400000) fail('ARCHIVO_GRANDE', 'La foto es demasiado pesada para guardarse en el navegador.');
      return t;
    }
    var ok = /^https:\/\/[^\s"'<>]+$/.test(t) || /^assets\/[A-Za-z0-9._\/-]+$/.test(t);
    if (!ok || t.indexOf('..') !== -1) {
      fail('ENLACE_INVALIDO', 'El enlace de ' + label + ' debe empezar con https:// o ser un archivo dentro de assets/.');
    }
    return t;
  }

  /** Recetas de un producto: hasta 3, con ingredientes y pasos. */
  function cleanRecipes(list, d) {
    if (!Array.isArray(list)) fail('VALOR_INVALIDO', 'Las recetas deben ser una lista.');
    if (list.length > 3) fail('VALOR_INVALIDO', 'Cada producto admite hasta 3 recetas.');
    return list.map(function (r, i) {
      var label = 'Receta ' + (i + 1);
      var title = reqText(r && r.title, 'título de la ' + label.toLowerCase());
      if (title.length > 90) fail('TEXTO_LARGO', label + ': el título admite hasta 90 caracteres.');
      var lines = function (arr, what, max, maxLen) {
        if (!Array.isArray(arr)) fail('VALOR_INVALIDO', label + ': faltan ' + what + '.');
        var out = arr.map(function (x) { return text(x); }).filter(Boolean);
        if (!out.length) fail('CAMPO_REQUERIDO', label + ': faltan ' + what + '.');
        if (out.length > max) fail('VALOR_INVALIDO', label + ': hasta ' + max + ' ' + what + '.');
        out.forEach(function (x) { if (x.length > maxLen) fail('TEXTO_LARGO', label + ': hay ' + what + ' demasiado largos.'); });
        return out;
      };
      var optInt = function (v, max, what) {
        if (v === null || v === undefined || v === '') return null;
        if (!isInt(v) || v < 1 || v > max) fail('VALOR_INVALIDO', label + ': ' + what + ' debe ser un entero entre 1 y ' + max + '.');
        return v;
      };
      return {
        title: title,
        minutes: optInt(r.minutes, 1440, 'el tiempo'),
        servings: optInt(r.servings, 100, 'las porciones'),
        ingredients: lines(r.ingredients, 'ingredientes', 25, 160),
        steps: lines(r.steps, 'pasos', 15, 500),
        uses: (Array.isArray(r.uses) ? r.uses : []).filter(function (sku) { return !!productOf(d, sku); })
      };
    });
  }

  /** Nombre de usuario para ingresar: minúsculas, números, punto, guion o guion bajo. */
  function cleanUsername(v) {
    var u = text(v).toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) fail('USUARIO_INVALIDO', 'El usuario debe tener de 3 a 30 caracteres: letras sin acento, números, punto, guion o guion bajo.');
    return u;
  }
  function slug(v) {
    return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 24) || 'usuario';
  }
  function activeAdmins(d) {
    return d.users.filter(function (u) { return u.role === 'admin' && u.active !== false; });
  }

  // ---------- estado vacío ----------

  function emptyState() {
    return {
      app: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      label: 'Datos de prueba',
      seq: {},
      settings: { deliveryFee: null, nearExpiryDays: 30, storeName: DEFAULT_STORE_NAME },
      orgs: [],
      users: [],
      depositos: [],
      categories: [],
      products: [],
      offers: [],
      demands: [],
      lots: [],
      movements: [],
      orders: [],
      shortages: [],
      audit: []
    };
  }

  // ---------- unidades ----------

  /** Convierte a la unidad de stock del producto. Devuelve null si no hay conversión explícita. */
  function toBaseQty(product, qty, unit) {
    if (unit === product.stockUnit) return qty;
    if (unit === product.saleUnit) return qty * product.saleFactor;
    var convs = product.conversions || [];
    for (var i = 0; i < convs.length; i++) if (convs[i].unit === unit) return qty * convs[i].factor;
    return null;
  }

  // ---------- stock ----------

  function isExpired(lot, today) {
    return !!lot.expiry && lot.expiry < today;
  }
  function lotAvailable(lot, today) {
    return isExpired(lot, today) ? 0 : Math.max(0, lot.liberado - lot.reserved);
  }
  /** Lotes vendibles en orden FEFO: primero el vencimiento más cercano; sin vencimiento, al final. */
  function fefoLots(state, sku, today) {
    return state.lots
      .filter(function (l) {
        return l.sku === sku && lotAvailable(l, today) > 0;
      })
      .sort(function (a, b) {
        var ea = a.expiry || '9999-12-31';
        var eb = b.expiry || '9999-12-31';
        if (ea !== eb) return ea < eb ? -1 : 1;
        if (a.receivedDate !== b.receivedDate) return a.receivedDate < b.receivedDate ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
  }
  /** Saldos por SKU, en unidad de stock. "disponible" es lo único que se puede prometer. */
  function stockSummary(state, sku, today) {
    var s = { fisico: 0, bloqueado: 0, liberado: 0, vencido: 0, reservado: 0, disponible: 0 };
    state.lots.forEach(function (l) {
      if (l.sku !== sku) return;
      s.fisico += l.liberado + l.bloqueado;
      s.bloqueado += l.bloqueado;
      s.reservado += l.reserved;
      if (isExpired(l, today)) s.vencido += l.liberado;
      else {
        s.liberado += l.liberado;
        s.disponible += lotAvailable(l, today);
      }
    });
    return s;
  }
  function availableInSaleUnits(state, product, today) {
    return Math.floor(stockSummary(state, product.sku, today).disponible / product.saleFactor);
  }

  function addMovement(d, ctx, m) {
    m.id = nextId(d, 'mov', 'M-', 5);
    m.at = ctx.nowIso;
    m.actor = ctx.actorLabel;
    d.movements.push(m);
  }

  // ---------- productos y precios ----------

  function categoryOf(state, product) {
    return byId(state.categories, product.categoryId);
  }
  /** Motivo por el que un producto no puede venderse todavía, o null si puede. */
  function notSellableReason(state, product) {
    if (!product) return 'Producto inexistente.';
    if (product.status !== 'activo') return 'El producto no está activo en el catálogo.';
    var cat = categoryOf(state, product);
    if (cat && cat.fueraDePiloto) return 'Categoría fuera del piloto hasta su validación operativa y regulatoria.';
    if (product.docRequired && !text(product.docRef)) return 'Falta el documento de regularización del producto.';
    if (product.pricing.precioAlmacen === null) return 'Precio al almacén sin definir.';
    return null;
  }

  /**
   * Indicadores de precio. Cada valor es null ("Sin datos") si falta una entrada.
   * margen = ganancia / precio de venta; recargo = ganancia / costo. No son lo mismo.
   */
  function priceIndicators(pricing) {
    var c = pricing.costoProveedor;
    var l = pricing.costoLogistico;
    var p = pricing.precioAlmacen;
    var s = pricing.precioSugerido;
    var out = {
      costoTotal: null,
      gananciaDistribuidora: null,
      margenDistribuidora: null,
      recargoDistribuidora: null,
      gananciaAlmacen: null,
      margenAlmacen: null,
      recargoAlmacen: null,
      participacionProductor: null
    };
    if (c !== null && l !== null) out.costoTotal = c + l;
    if (out.costoTotal !== null && p !== null) {
      out.gananciaDistribuidora = p - out.costoTotal;
      if (p > 0) out.margenDistribuidora = out.gananciaDistribuidora / p;
      if (out.costoTotal > 0) out.recargoDistribuidora = out.gananciaDistribuidora / out.costoTotal;
    }
    if (p !== null && s !== null) {
      out.gananciaAlmacen = s - p;
      if (s > 0) out.margenAlmacen = out.gananciaAlmacen / s;
      if (p > 0) out.recargoAlmacen = out.gananciaAlmacen / p;
    }
    if (c !== null && s !== null && s > 0) out.participacionProductor = c / s;
    return out;
  }

  // ---------- cruce de oferta y demanda ----------

  function windowsOverlap(a, b) {
    return a.windowFrom <= b.windowTo && b.windowFrom <= a.windowTo;
  }

  /**
   * Compara oferta y demanda por SKU, unidades convertibles y ventanas superpuestas.
   * Es solo una sugerencia: no crea stock, reservas ni pedidos.
   */
  function matchSupplyDemand(state) {
    var skus = [];
    state.offers.concat(state.demands).forEach(function (x) {
      if (!x.anulada && skus.indexOf(x.sku) === -1) skus.push(x.sku);
    });
    var rank = { confirmada: 0, probable: 1, estimacion: 2 };
    return skus.sort().map(function (sku) {
      var product = productOf(state, sku);
      var offers = state.offers
        .filter(function (o) {
          return o.sku === sku && !o.anulada;
        })
        .map(function (o) {
          var base = toBaseQty(product, o.qty, o.unit);
          return { offer: o, base: base, remaining: base === null ? 0 : base };
        })
        .sort(function (a, b) {
          var r = rank[a.offer.confirmation] - rank[b.offer.confirmation];
          if (r) return r;
          return a.offer.windowFrom < b.offer.windowFrom ? -1 : a.offer.windowFrom > b.offer.windowFrom ? 1 : 0;
        });
      var demands = state.demands
        .filter(function (x) {
          return x.sku === sku && !x.anulada;
        })
        .sort(function (a, b) {
          if (a.windowFrom !== b.windowFrom) return a.windowFrom < b.windowFrom ? -1 : 1;
          return a.id < b.id ? -1 : 1;
        })
        .map(function (dm) {
          var need = toBaseQty(product, dm.qty, dm.unit);
          var row = { demand: dm, need: need, matched: 0, missing: 0, matches: [], reasons: [] };
          if (need === null) {
            row.reasons.push(
              'Unidad incompatible: la demanda está en ' + unitLabel(dm.unit, 2) + ' y este producto se controla en ' +
                unitLabel(product.stockUnit, 2) + ', sin conversión definida.'
            );
            return row;
          }
          row.missing = need;
          if (!offers.length) {
            row.reasons.push('No hay oferta registrada para este producto.');
            return row;
          }
          var compatible = offers.filter(function (o) {
            return o.base !== null;
          });
          if (!compatible.length) {
            row.reasons.push(
              'Unidad incompatible: la oferta está en una unidad que no se convierte a ' + unitLabel(product.stockUnit, 2) + '.'
            );
            return row;
          }
          var overlapping = compatible.filter(function (o) {
            return windowsOverlap(o.offer, dm);
          });
          if (!overlapping.length) {
            row.reasons.push(
              'Ventanas que no se superponen: la demanda es del ' + fmtDate(dm.windowFrom) + ' al ' + fmtDate(dm.windowTo) +
                ' y la oferta, del ' +
                compatible
                  .map(function (o) {
                    return fmtDate(o.offer.windowFrom) + ' al ' + fmtDate(o.offer.windowTo);
                  })
                  .join(' y del ') + '.'
            );
            return row;
          }
          overlapping.forEach(function (o) {
            if (row.missing <= 0 || o.remaining <= 0) return;
            var q = Math.min(row.missing, o.remaining);
            o.remaining -= q;
            row.missing -= q;
            row.matched += q;
            row.matches.push({
              offerId: o.offer.id,
              qty: q,
              from: o.offer.windowFrom > dm.windowFrom ? o.offer.windowFrom : dm.windowFrom,
              to: o.offer.windowTo < dm.windowTo ? o.offer.windowTo : dm.windowTo
            });
          });
          if (row.missing > 0) {
            row.reasons.push(
              'Oferta insuficiente en la ventana: faltan ' + qtyLabel(row.missing, product.stockUnit) + '.'
            );
          }
          return row;
        });
      var sum = function (list, f) {
        return list.reduce(function (t, x) {
          return t + f(x);
        }, 0);
      };
      return {
        sku: sku,
        product: product,
        unit: product.stockUnit,
        offered: sum(offers, function (o) {
          return o.base || 0;
        }),
        demanded: sum(demands, function (x) {
          return x.need || 0;
        }),
        suggested: sum(demands, function (x) {
          return x.matched;
        }),
        offerBalance: sum(offers, function (o) {
          return o.remaining;
        }),
        shortfall: sum(demands, function (x) {
          return x.missing;
        }),
        offers: offers,
        demands: demands
      };
    });
  }

  // ---------- pedidos ----------

  function activeAllocations(order) {
    return order.status === 'reservado' || order.status === 'en_preparacion';
  }

  function assertTransition(order, to) {
    if (TRANSITIONS[order.status].indexOf(to) === -1) {
      fail(
        'TRANSICION_INVALIDA',
        'El pedido ' + order.id + ' está en estado "' + ORDER_STATUS[order.status] + '" y no puede pasar a "' +
          ORDER_STATUS[to] + '".'
      );
    }
  }
  function setStatus(order, to, ctx, note) {
    order.history.push({ at: ctx.nowIso, from: order.status, to: to, actor: ctx.actorLabel, note: note || '' });
    order.status = to;
  }
  function getOrder(d, ctx, id) {
    var o = byId(d.orders, id);
    if (!o || (ctx.actor.role === 'almacen' && o.almacenId !== ctx.actor.orgId)) {
      fail('NO_ENCONTRADO', 'No se encontró el pedido.');
    }
    return o;
  }

  /** Vista de un pedido con importes. En borrador usa la lista vigente; confirmado, lo que quedó registrado. */
  function orderView(state, order, today) {
    var frozen = order.status !== 'borrador' && !(order.status === 'cancelado' && !order.confirmedAt);
    var lines = order.lines.map(function (ln) {
      var p = productOf(state, ln.sku);
      if (frozen) return Object.assign({ frozen: true }, ln);
      var price = p ? p.pricing.precioAlmacen : null;
      return {
        frozen: false,
        sku: ln.sku,
        qty: ln.qty,
        name: p ? p.name : ln.sku,
        presentation: p ? p.presentation : '',
        unit: p ? p.saleUnit : '',
        unitPrice: price,
        lineTotal: price === null ? null : price * ln.qty,
        available: p && today ? availableInSaleUnits(state, p, today) : null,
        notSellable: notSellableReason(state, p)
      };
    });
    var subtotal = 0;
    var complete = true;
    lines.forEach(function (ln) {
      if (ln.lineTotal === null) complete = false;
      else subtotal += ln.lineTotal;
    });
    var fee = frozen ? order.deliveryFee : state.settings.deliveryFee;
    return {
      frozen: frozen,
      lines: lines,
      subtotal: complete ? subtotal : null,
      deliveryFee: fee,
      total: complete ? subtotal + (fee || 0) : null,
      units: lines.reduce(function (t, l) {
        return t + l.qty;
      }, 0)
    };
  }

  function normalizeLines(d, rawLines) {
    var merged = {};
    var order = [];
    (rawLines || []).forEach(function (raw) {
      var p = productOf(d, raw.sku);
      if (!p) fail('NO_ENCONTRADO', 'Producto inexistente: ' + raw.sku + '.');
      reqQty(raw.qty, 'La cantidad de ' + p.name);
      if (raw.unit && raw.unit !== p.saleUnit) {
        fail(
          'UNIDAD_INCOMPATIBLE',
          p.name + ' se vende por ' + unitLabel(p.saleUnit, 1) + ', no por ' + unitLabel(raw.unit, 1) + '.'
        );
      }
      var why = notSellableReason(d, p);
      if (why) fail('PRODUCTO_NO_DISPONIBLE', p.name + ': ' + why);
      if (!merged[p.sku]) {
        merged[p.sku] = { sku: p.sku, qty: 0 };
        order.push(p.sku);
      }
      merged[p.sku].qty += raw.qty;
    });
    return order.map(function (sku) {
      return merged[sku];
    });
  }

  // ---------- comandos ----------

  var HANDLERS = {
    'producto.guardar': function (d, ctx, p) {
      var sku = text(p.sku).toUpperCase();
      if (!/^[A-Z0-9-]{3,20}$/.test(sku)) {
        fail('SKU_INVALIDO', 'El SKU debe tener de 3 a 20 caracteres: letras, números o guiones.');
      }
      var existing = productOf(d, sku);
      if (p.isNew && existing) fail('SKU_DUPLICADO', 'Ya existe un producto con el SKU ' + sku + '.');
      if (!p.isNew && !existing) fail('NO_ENCONTRADO', 'Producto inexistente: ' + sku + '.');
      var name = reqText(p.name, 'nombre');
      var cat = byId(d.categories, p.categoryId);
      if (!cat) fail('CAMPO_REQUERIDO', 'Falta elegir la categoría.');
      if (p.coopId) {
        var coop = byId(d.orgs, p.coopId);
        if (!coop || coop.type !== 'cooperativa') fail('NO_ENCONTRADO', 'Cooperativa inexistente.');
      }
      if (!UNITS[p.stockUnit] || !UNITS[p.saleUnit]) fail('UNIDAD_INVALIDA', 'Unidad no reconocida.');
      var factor = p.saleUnit === p.stockUnit ? 1 : p.saleFactor;
      if (!isInt(factor) || factor <= 0) {
        fail('CONVERSION_INVALIDA', 'Indique cuántas unidades de stock tiene una unidad de venta (entero mayor que cero).');
      }
      if (!PRODUCT_STATUS[p.status]) fail('CAMPO_REQUERIDO', 'Falta el estado del producto.');
      if (p.status === 'activo' && cat.fueraDePiloto) {
        fail('FUERA_DE_PILOTO', 'La categoría "' + cat.name + '" queda fuera del piloto hasta su validación operativa y regulatoria.');
      }
      if (existing && existing.stockUnit !== p.stockUnit) {
        var hasLots = d.lots.some(function (l) {
          return l.sku === sku;
        });
        if (hasLots) fail('UNIDAD_EN_USO', 'No se puede cambiar la unidad de stock de un producto con lotes registrados.');
      }
      var rec = existing || { sku: sku, pricing: { costoProveedor: null, costoLogistico: null, precioAlmacen: null, precioSugerido: null }, photo: null };
      rec.name = name;
      rec.coopId = p.coopId || null;
      rec.origin = text(p.origin);
      rec.categoryId = cat.id;
      rec.presentation = reqText(p.presentation, 'presentación');
      rec.stockUnit = p.stockUnit;
      rec.saleUnit = p.saleUnit;
      rec.saleFactor = factor;
      rec.conversions = (p.conversions || (existing && existing.conversions) || []).filter(function (c) {
        return UNITS[c.unit] && isInt(c.factor) && c.factor > 0 && c.unit !== p.stockUnit;
      });
      rec.status = p.status;
      rec.docRequired = !!p.docRequired;
      rec.docRef = text(p.docRef);
      if ('description' in p) {
        rec.description = text(p.description);
        if (rec.description.length > 1200) fail('TEXTO_LARGO', 'La descripción admite hasta 1.200 caracteres.');
      }
      if ('photo' in p) rec.photo = mediaRef(p.photo, 'foto', true);
      if ('video' in p) rec.video = mediaRef(p.video, 'video', false);
      if ('story' in p) {
        rec.story = text(p.story);
        if (rec.story.length > 1500) fail('TEXTO_LARGO', 'La historia admite hasta 1.500 caracteres.');
      }
      if ('recipes' in p) rec.recipes = cleanRecipes(p.recipes, d);
      if ('claims' in p) {
        if (!Array.isArray(p.claims) || p.claims.length > 10) fail('VALOR_INVALIDO', 'Los sellos deben ser una lista de hasta 10.');
        rec.claims = p.claims.map(function (c) { return text(c); }).filter(function (c) { return c && c.length <= 40; });
      }
      if (!rec.story) rec.story = rec.story || '';
      if (!Array.isArray(rec.recipes)) rec.recipes = [];
      if (!Array.isArray(rec.claims)) rec.claims = [];
      if (!existing) d.products.push(rec);
      return { summary: (existing ? 'Producto actualizado: ' : 'Producto creado: ') + sku + ' — ' + name + ' (' + PRODUCT_STATUS[rec.status] + ')' };
    },

    'precio.actualizar': function (d, ctx, p) {
      var prod = productOf(d, p.sku);
      if (!prod) fail('NO_ENCONTRADO', 'Producto inexistente.');
      var labels = {
        costoProveedor: 'Costo pagado al proveedor',
        costoLogistico: 'Costo logístico por unidad',
        precioAlmacen: 'Precio al almacén',
        precioSugerido: 'Precio final sugerido'
      };
      var changes = [];
      Object.keys(labels).forEach(function (k) {
        if (!(k in p)) return;
        var v = p[k];
        if (v !== null) {
          var min = k === 'costoLogistico' ? 0 : 1;
          if (!isInt(v) || v < min) {
            fail('PRECIO_INVALIDO', labels[k] + ': debe ser un monto entero en guaraníes' + (min ? ' mayor que cero' : '') + ', o quedar vacío.');
          }
        }
        if (prod.pricing[k] !== v) {
          changes.push(labels[k] + ': ' + fmtGs(prod.pricing[k]) + ' → ' + fmtGs(v));
          prod.pricing[k] = v;
        }
      });
      return { summary: 'Precios de ' + prod.sku + ': ' + (changes.length ? changes.join('; ') : 'sin cambios') };
    },

    'almacen.guardar': function (d, ctx, p) {
      var name = reqText(p.name, 'nombre del almacén');
      var rec = p.id ? byId(d.orgs, p.id) : null;
      if (p.id && (!rec || rec.type !== 'almacen')) fail('NO_ENCONTRADO', 'Almacén inexistente.');
      if (!rec) {
        rec = { id: nextId(d, 'org', 'ALM-', 3), type: 'almacen' };
        d.orgs.push(rec);
      }
      rec.name = name;
      rec.zona = text(p.zona);
      rec.contacto = text(p.contacto);
      rec.notes = text(p.notes);
      rec.active = p.active !== false;
      return { summary: 'Almacén guardado: ' + name + (rec.active ? '' : ' (inactivo)'), result: { id: rec.id } };
    },

    'usuario.guardar': function (d, ctx, p) {
      var name = reqText(p.name, 'nombre del usuario');
      if (!ROLES[p.role]) fail('CAMPO_REQUERIDO', 'Falta elegir el rol.');
      var orgId = null;
      if (p.role === 'cooperativa' || p.role === 'almacen') {
        var org = byId(d.orgs, p.orgId);
        if (!org || org.type !== p.role) fail('CAMPO_REQUERIDO', 'Falta elegir la organización del usuario.');
        orgId = org.id;
      }
      var rec = p.id ? byId(d.users, p.id) : null;
      if (p.id && !rec) fail('NO_ENCONTRADO', 'Usuario inexistente.');
      var username = cleanUsername(p.username);
      d.users.forEach(function (u) {
        if (u !== rec && (u.username || '') === username) fail('USUARIO_DUPLICADO', 'Ya existe una cuenta con el usuario "' + username + '".');
      });
      var willBeAdmin = p.role === 'admin' && p.active !== false;
      if (rec && rec.role === 'admin' && rec.active !== false && !willBeAdmin && activeAdmins(d).length === 1) {
        fail('ULTIMO_ADMIN', 'Debe quedar al menos una cuenta de Administración activa.');
      }
      if (!rec) {
        rec = { id: nextId(d, 'user', 'U-', 3), cred: null };
        d.users.push(rec);
      }
      rec.name = name;
      rec.username = username;
      rec.role = p.role;
      rec.orgId = orgId;
      rec.active = p.active !== false;
      if (!('cred' in rec)) rec.cred = null;
      return { summary: 'Usuario guardado: ' + name + ' — ' + ROLES[rec.role], result: { id: rec.id } };
    },

    /**
     * Guarda la contraseña de una cuenta (la pantalla manda solo el hash PBKDF2, nunca la contraseña).
     * Administración puede restablecer cualquier cuenta; el resto, solo la propia.
     */
    'usuario.credencial': function (d, ctx, p) {
      var rec = byId(d.users, p.id);
      if (!rec) fail('NO_ENCONTRADO', 'Usuario inexistente.');
      if (ctx.actor.role !== 'admin' && ctx.actor.id !== rec.id) fail('SIN_PERMISO', 'Solo podés cambiar tu propia contraseña.');
      var c = p.cred;
      if (c === null) {
        if (ctx.actor.role !== 'admin') fail('SIN_PERMISO', 'Solo Administración puede quitar un acceso.');
        if (rec.role === 'admin' && activeAdmins(d).filter(function (u) { return u.cred; }).length === 1 && rec.cred) {
          fail('ULTIMO_ADMIN', 'Debe quedar al menos una cuenta de Administración con acceso.');
        }
        rec.cred = null;
        return { summary: 'Acceso quitado: ' + rec.name + '.' };
      }
      if (!c || c.algo !== 'PBKDF2-SHA256' || !isInt(c.iter) || c.iter < 100000 || !/^[0-9a-f]{32}$/.test(c.salt || '') || !/^[0-9a-f]{64}$/.test(c.hash || '')) {
        fail('VALOR_INVALIDO', 'Credencial con formato inválido.');
      }
      rec.cred = { algo: c.algo, iter: c.iter, salt: c.salt, hash: c.hash, at: ctx.nowIso };
      return { summary: (ctx.actor.id === rec.id ? 'Contraseña actualizada.' : 'Contraseña restablecida para ' + rec.name + '.') };
    },

    'cooperativa.guardar': function (d, ctx, p) {
      var name = reqText(p.name, 'nombre de la cooperativa o proveedor');
      var rec = p.id ? byId(d.orgs, p.id) : null;
      if (p.id && (!rec || rec.type !== 'cooperativa')) fail('NO_ENCONTRADO', 'Cooperativa inexistente.');
      d.orgs.forEach(function (o) {
        if (o !== rec && o.type === 'cooperativa' && o.name.toLowerCase() === name.toLowerCase()) fail('DUPLICADO', 'Ya existe una cooperativa con ese nombre.');
      });
      if (!rec) {
        rec = { id: nextId(d, 'coop', 'COOP-', 3), type: 'cooperativa' };
        d.orgs.push(rec);
      }
      rec.name = name;
      rec.zona = text(p.zona);
      rec.contacto = text(p.contacto);
      rec.notes = text(p.notes);
      rec.active = p.active !== false;
      return { summary: 'Cooperativa guardada: ' + name + '.', result: { id: rec.id } };
    },

    'config.actualizar': function (d, ctx, p) {
      var parts = [];
      if ('storeName' in p) {
        var sn = reqText(p.storeName, 'nombre comercial');
        if (sn.length > 40) fail('TEXTO_LARGO', 'El nombre comercial admite hasta 40 caracteres.');
        parts.push('Nombre comercial: ' + (d.settings.storeName || DEFAULT_STORE_NAME) + ' → ' + sn);
        d.settings.storeName = sn;
      }
      if ('deliveryFee' in p) {
        if (p.deliveryFee !== null && (!isInt(p.deliveryFee) || p.deliveryFee < 0)) {
          fail('PRECIO_INVALIDO', 'El costo de entrega debe ser un monto entero en guaraníes, o quedar vacío.');
        }
        parts.push('Costo de entrega: ' + (d.settings.deliveryFee === null ? 'sin definir' : fmtGs(d.settings.deliveryFee)) + ' → ' + (p.deliveryFee === null ? 'sin definir' : fmtGs(p.deliveryFee)));
        d.settings.deliveryFee = p.deliveryFee;
      }
      if ('nearExpiryDays' in p) {
        if (!isInt(p.nearExpiryDays) || p.nearExpiryDays < 1 || p.nearExpiryDays > 365) {
          fail('VALOR_INVALIDO', 'Los días de aviso de vencimiento deben estar entre 1 y 365.');
        }
        parts.push('Aviso de vencimiento: ' + d.settings.nearExpiryDays + ' → ' + p.nearExpiryDays + ' días');
        d.settings.nearExpiryDays = p.nearExpiryDays;
      }
      ['sipapAlias', 'sipapBank', 'sipapHolder', 'sipapRuc', 'whatsappPhone'].forEach(function (k) {
        if (k in p) {
          var v = text(p[k]);
          if (v.length > 120) fail('TEXTO_LARGO', 'El campo ' + k + ' admite hasta 120 caracteres.');
          d.settings[k] = v;
          parts.push(k + ' actualizado');
        }
      });
      return { summary: 'Configuración: ' + parts.join('; ') };
    },

    'categoria.actualizar': function (d, ctx, p) {
      var cat = byId(d.categories, p.id);
      if (!cat) fail('NO_ENCONTRADO', 'Categoría inexistente.');
      cat.requiresExpiry = !!p.requiresExpiry;
      cat.requiresDoc = !!p.requiresDoc;
      cat.qualityNote = text(p.qualityNote);
      return { summary: 'Categoría "' + cat.name + '": vencimiento ' + (cat.requiresExpiry ? 'obligatorio' : 'opcional') + ', documento ' + (cat.requiresDoc ? 'obligatorio' : 'opcional') };
    },

    'oferta.registrar': function (d, ctx, p) {
      var coopId = ctx.actor.role === 'cooperativa' ? ctx.actor.orgId : p.coopId;
      if (ctx.actor.role === 'cooperativa' && p.coopId && p.coopId !== coopId) fail('SIN_PERMISO', 'Solo puede registrar oferta de su propia cooperativa.');
      var coop = byId(d.orgs, coopId);
      if (!coop || coop.type !== 'cooperativa') fail('CAMPO_REQUERIDO', 'Falta elegir la cooperativa.');
      var prod = productOf(d, p.sku);
      if (!prod || prod.status === 'inactivo') fail('CAMPO_REQUERIDO', 'Falta elegir el producto.');
      if (prod.coopId && prod.coopId !== coopId) fail('SIN_PERMISO', prod.name + ' pertenece al catálogo de otra cooperativa.');
      reqQty(p.qty);
      if (!UNITS[p.unit]) fail('UNIDAD_INVALIDA', 'Falta elegir la unidad.');
      reqWindow(p.windowFrom, p.windowTo);
      if (!OFFER_CONFIRMATION[p.confirmation]) fail('CAMPO_REQUERIDO', 'Falta el nivel de confirmación.');
      var rec = {
        id: nextId(d, 'offer', 'OF-', 4),
        coopId: coopId,
        sku: prod.sku,
        qty: p.qty,
        unit: p.unit,
        windowFrom: p.windowFrom,
        windowTo: p.windowTo,
        kind: OFFER_KIND[p.kind] ? p.kind : 'disponible',
        confirmation: p.confirmation,
        origin: text(p.origin),
        notes: text(p.notes),
        createdAt: ctx.nowIso,
        anulada: false
      };
      d.offers.push(rec);
      return {
        summary: 'Oferta ' + rec.id + ': ' + coop.name + ' informa ' + qtyLabel(rec.qty, rec.unit) + ' de ' + prod.name + ' (' + OFFER_CONFIRMATION[rec.confirmation] + '). No modifica el stock.',
        result: { id: rec.id }
      };
    },

    'oferta.anular': function (d, ctx, p) {
      var rec = byId(d.offers, p.id);
      if (!rec || (ctx.actor.role === 'cooperativa' && rec.coopId !== ctx.actor.orgId)) fail('NO_ENCONTRADO', 'No se encontró la oferta.');
      if (rec.anulada) fail('YA_ANULADA', 'La oferta ya estaba anulada.');
      rec.anulada = true;
      return { summary: 'Oferta ' + rec.id + ' anulada.' };
    },

    'demanda.registrar': function (d, ctx, p) {
      var almId = ctx.actor.role === 'almacen' ? ctx.actor.orgId : p.almacenId;
      if (ctx.actor.role === 'almacen' && p.almacenId && p.almacenId !== almId) fail('SIN_PERMISO', 'Solo puede registrar demanda de su propio almacén.');
      var alm = byId(d.orgs, almId);
      if (!alm || alm.type !== 'almacen') fail('CAMPO_REQUERIDO', 'Falta elegir el almacén.');
      var prod = productOf(d, p.sku);
      if (!prod || prod.status === 'inactivo') fail('CAMPO_REQUERIDO', 'Falta elegir el producto.');
      reqQty(p.qty);
      if (!UNITS[p.unit]) fail('UNIDAD_INVALIDA', 'Falta elegir la unidad.');
      reqWindow(p.windowFrom, p.windowTo);
      if (!DEMAND_KIND[p.kind]) fail('CAMPO_REQUERIDO', 'Indique si es interés o pedido firme a futuro.');
      var rec = {
        id: nextId(d, 'demand', 'DE-', 4),
        almacenId: almId,
        sku: prod.sku,
        qty: p.qty,
        unit: p.unit,
        windowFrom: p.windowFrom,
        windowTo: p.windowTo,
        kind: p.kind,
        notes: text(p.notes),
        createdAt: ctx.nowIso,
        anulada: false
      };
      d.demands.push(rec);
      return {
        summary: 'Demanda ' + rec.id + ': ' + alm.name + ' — ' + qtyLabel(rec.qty, rec.unit) + ' de ' + prod.name + ' (' + DEMAND_KIND[rec.kind] + '). No reserva stock.',
        result: { id: rec.id }
      };
    },

    'demanda.anular': function (d, ctx, p) {
      var rec = byId(d.demands, p.id);
      if (!rec || (ctx.actor.role === 'almacen' && rec.almacenId !== ctx.actor.orgId)) fail('NO_ENCONTRADO', 'No se encontró la demanda.');
      if (rec.anulada) fail('YA_ANULADA', 'La demanda ya estaba anulada.');
      rec.anulada = true;
      return { summary: 'Demanda ' + rec.id + ' anulada.' };
    },

    'recepcion.registrar': function (d, ctx, p) {
      var prod = productOf(d, p.sku);
      if (!prod) fail('CAMPO_REQUERIDO', 'Falta elegir el producto.');
      if (prod.status !== 'activo') fail('PRODUCTO_NO_DISPONIBLE', prod.name + ' no está activo en el catálogo. Debe activarse antes de recibir mercadería.');
      var cat = categoryOf(d, prod);
      if (cat && cat.fueraDePiloto) fail('FUERA_DE_PILOTO', 'La categoría "' + cat.name + '" queda fuera del piloto.');
      var coop = byId(d.orgs, p.coopId);
      if (!coop || coop.type !== 'cooperativa') fail('CAMPO_REQUERIDO', 'Falta elegir el proveedor.');
      if (prod.coopId && prod.coopId !== coop.id) fail('PROVEEDOR_INCORRECTO', prod.name + ' pertenece al catálogo de otra cooperativa.');
      var dep = byId(d.depositos, p.depositoId);
      if (!dep) fail('CAMPO_REQUERIDO', 'Falta elegir el depósito.');
      var code = reqText(p.lotCode, 'código de lote');
      if (d.lots.some(function (l) { return l.sku === prod.sku && l.code.toLowerCase() === code.toLowerCase(); })) {
        fail('LOTE_DUPLICADO', 'Ya existe el lote ' + code + ' para este producto. Use un ajuste si necesita corregirlo.');
      }
      var received = reqQty(p.qtyReceived, 'La cantidad recibida');
      var released = p.qtyReleased;
      if (!isInt(released) || released < 0 || released > received) {
        fail('CANTIDAD_INVALIDA', 'La cantidad liberada para la venta debe estar entre 0 y la cantidad recibida.');
      }
      var blocked = received - released;
      var blockReason = text(p.blockReason);
      if (blocked > 0 && !blockReason) fail('CAMPO_REQUERIDO', 'Indique el motivo del bloqueo de ' + qtyLabel(blocked, prod.stockUnit) + '.');
      var declared = p.qtyDeclared === null || p.qtyDeclared === undefined ? null : p.qtyDeclared;
      if (declared !== null && (!isInt(declared) || declared <= 0)) fail('CANTIDAD_INVALIDA', 'La cantidad declarada por el proveedor debe ser un entero mayor que cero, o quedar vacía.');
      var discrepancy = text(p.discrepancyNote);
      if (declared !== null && declared !== received && !discrepancy) {
        fail('CAMPO_REQUERIDO', 'Lo recibido (' + received + ') difiere de lo declarado (' + declared + '). Describa la diferencia.');
      }
      var date = reqDate(p.receivedDate, 'fecha de recepción');
      if (date > ctx.today) fail('FECHA_INVALIDA', 'La fecha de recepción no puede ser futura.');
      var expiry = p.expiry || null;
      if (expiry) reqDate(expiry, 'vencimiento');
      if (!expiry && cat && cat.requiresExpiry) fail('CAMPO_REQUERIDO', 'Esta categoría exige fecha de vencimiento.');
      if (expiry && expiry < ctx.today && released > 0) {
        fail('LOTE_VENCIDO', 'El lote está vencido (' + fmtDate(expiry) + '): no puede liberarse para la venta. Debe registrarse como bloqueado.');
      }
      var responsible = reqText(p.responsible, 'responsable de la recepción');
      var lot = {
        id: nextId(d, 'lot', 'L-', 4),
        code: code,
        sku: prod.sku,
        coopId: coop.id,
        depositoId: dep.id,
        receivedQty: received,
        declaredQty: declared,
        discrepancyNote: discrepancy,
        liberado: released,
        bloqueado: blocked,
        reserved: 0,
        blockReason: blockReason,
        receivedDate: date,
        expiry: expiry,
        responsible: responsible,
        notes: text(p.notes),
        createdAt: ctx.nowIso
      };
      d.lots.push(lot);
      addMovement(d, ctx, {
        type: 'entrada', lotId: lot.id, sku: prod.sku, qty: received, unit: prod.stockUnit, fisico: received,
        reason: 'Recepción de ' + coop.name + ': ' + released + ' liberado, ' + blocked + ' bloqueado' + (blocked ? ' (' + blockReason + ')' : '') +
          (declared !== null && declared !== received ? '. Diferencia con lo declarado (' + declared + '): ' + discrepancy : '')
      });
      return {
        summary: 'Recepción del lote ' + code + ' de ' + prod.name + ': ' + received + ' recibido, ' + released + ' liberado, ' + blocked + ' bloqueado.',
        result: { lotId: lot.id }
      };
    },

    'lote.bloquear': function (d, ctx, p) {
      var lot = byId(d.lots, p.lotId);
      if (!lot) fail('NO_ENCONTRADO', 'Lote inexistente.');
      var qty = reqQty(p.qty);
      var reason = reqText(p.reason, 'motivo del bloqueo');
      var free = lot.liberado - lot.reserved;
      if (qty > free) {
        fail('STOCK_INSUFICIENTE', 'Solo se pueden bloquear ' + free + ': hay ' + lot.reserved + ' reservadas para pedidos. Cancele el pedido antes de bloquear esa mercadería.');
      }
      lot.liberado -= qty;
      lot.bloqueado += qty;
      lot.blockReason = reason;
      addMovement(d, ctx, { type: 'bloqueo', lotId: lot.id, sku: lot.sku, qty: qty, unit: productOf(d, lot.sku).stockUnit, fisico: 0, reason: reason });
      return { summary: 'Lote ' + lot.code + ': ' + qty + ' bloqueado. Motivo: ' + reason };
    },

    'lote.liberar': function (d, ctx, p) {
      var lot = byId(d.lots, p.lotId);
      if (!lot) fail('NO_ENCONTRADO', 'Lote inexistente.');
      var qty = reqQty(p.qty);
      var note = reqText(p.note, 'verificación realizada');
      if (isExpired(lot, ctx.today)) fail('LOTE_VENCIDO', 'El lote venció el ' + fmtDate(lot.expiry) + ': no puede liberarse para la venta.');
      if (qty > lot.bloqueado) fail('STOCK_INSUFICIENTE', 'El lote solo tiene ' + lot.bloqueado + ' bloqueado.');
      lot.bloqueado -= qty;
      lot.liberado += qty;
      addMovement(d, ctx, { type: 'liberacion', lotId: lot.id, sku: lot.sku, qty: qty, unit: productOf(d, lot.sku).stockUnit, fisico: 0, reason: note });
      return { summary: 'Lote ' + lot.code + ': ' + qty + ' liberado para la venta. Verificación: ' + note };
    },

    'lote.ajustar': function (d, ctx, p) {
      var lot = byId(d.lots, p.lotId);
      if (!lot) fail('NO_ENCONTRADO', 'Lote inexistente.');
      if (p.bucket !== 'liberado' && p.bucket !== 'bloqueado') fail('CAMPO_REQUERIDO', 'Indique si el ajuste es sobre lo liberado o lo bloqueado.');
      if (!isInt(p.delta) || p.delta === 0) fail('CANTIDAD_INVALIDA', 'El ajuste debe ser un número entero distinto de cero.');
      var reason = reqText(p.reason, 'motivo del ajuste');
      var after = lot[p.bucket] + p.delta;
      if (after < 0) fail('SALDO_NEGATIVO', 'El ajuste dejaría el saldo en negativo (' + after + ').');
      if (p.bucket === 'liberado' && after < lot.reserved) {
        fail('SALDO_NEGATIVO', 'El ajuste dejaría menos stock que lo reservado (' + lot.reserved + '). Cancele el pedido antes de ajustar.');
      }
      lot[p.bucket] = after;
      addMovement(d, ctx, { type: 'ajuste', lotId: lot.id, sku: lot.sku, qty: Math.abs(p.delta), unit: productOf(d, lot.sku).stockUnit, fisico: p.delta, reason: reason + ' (sobre ' + p.bucket + ')' });
      return { summary: 'Lote ' + lot.code + ': ajuste de ' + (p.delta > 0 ? '+' : '') + p.delta + ' sobre ' + p.bucket + '. Motivo: ' + reason };
    },

    'pedido.guardarBorrador': function (d, ctx, p) {
      var almId = ctx.actor.role === 'almacen' ? ctx.actor.orgId : p.almacenId;
      if (ctx.actor.role === 'almacen' && p.almacenId && p.almacenId !== almId) fail('SIN_PERMISO', 'Solo puede armar pedidos de su propio almacén.');
      var order = null;
      if (p.orderId) {
        order = getOrder(d, ctx, p.orderId);
        if (order.status !== 'borrador') fail('TRANSICION_INVALIDA', 'El pedido ' + order.id + ' ya no es un borrador y no se puede editar.');
        almId = order.almacenId;
      }
      var alm = byId(d.orgs, almId);
      if (!alm || alm.type !== 'almacen') fail('CAMPO_REQUERIDO', 'Falta elegir el almacén.');
      if (!alm.active) fail('ALMACEN_INACTIVO', 'El almacén está inactivo.');
      var lines = normalizeLines(d, p.lines);
      var wf = p.windowFrom || null;
      var wt = p.windowTo || null;
      if (wf || wt) reqWindow(wf || wt, wt || wf);
      if (!order) {
        order = {
          id: nextId(d, 'order', 'P-', 4), almacenId: almId, status: 'borrador', lines: [], createdAt: ctx.nowIso,
          createdBy: ctx.actorLabel, confirmedAt: null, deliveryFee: null, subtotal: null, total: null,
          windowFrom: null, windowTo: null, notes: '', history: [], delivery: null, cancelReason: '', reservationReleased: false
        };
        d.orders.push(order);
      }
      order.lines = lines;
      order.windowFrom = wf || wt;
      order.windowTo = wt || wf;
      order.notes = text(p.notes);
      if (p.deliveryAddress || p.deliveryZone || p.deliverySlot || 'deliveryAddress' in p) {
        order.checkout = {
          address: text(p.deliveryAddress),
          zone: text(p.deliveryZone),
          slot: text(p.deliverySlot)
        };
      }
      if (p.paymentMethod) {
        if (!PAYMENT_METHODS[p.paymentMethod]) fail('VALOR_INVALIDO', 'Forma de pago desconocida.');
        order.payment = order.payment || { method: p.paymentMethod, status: 'pendiente', ref: '', reportedAt: null, confirmedAt: null, confirmedBy: '' };
        order.payment.method = p.paymentMethod;
      }
      return { summary: 'Borrador ' + order.id + ' de ' + alm.name + ': ' + lines.length + ' producto(s).', result: { orderId: order.id } };
    },

    /** Borrador → Reservado. Reserva todo o nada: si falta un solo producto, no se reserva ninguno. */
    'pedido.confirmar': function (d, ctx, p) {
      var order = getOrder(d, ctx, p.orderId);
      assertTransition(order, 'reservado');
      if (!order.lines.length) fail('PEDIDO_VACIO', 'El pedido no tiene productos.');
      var alm = byId(d.orgs, order.almacenId);
      if (!alm.active) fail('ALMACEN_INACTIVO', 'El almacén está inactivo.');
      var shortages = [];
      var plan = order.lines.map(function (ln) {
        var prod = productOf(d, ln.sku);
        var why = notSellableReason(d, prod);
        if (why) fail('PRODUCTO_NO_DISPONIBLE', (prod ? prod.name : ln.sku) + ': ' + why);
        reqQty(ln.qty, 'La cantidad de ' + prod.name);
        var need = ln.qty * prod.saleFactor;
        var lots = fefoLots(d, prod.sku, ctx.today);
        var availableBase = lots.reduce(function (t, l) { return t + lotAvailable(l, ctx.today); }, 0);
        if (availableBase < need) {
          shortages.push({ sku: prod.sku, name: prod.name, unit: prod.saleUnit, requested: ln.qty, available: Math.floor(availableBase / prod.saleFactor) });
        }
        return { ln: ln, prod: prod, need: need, lots: lots };
      });
      if (shortages.length) {
        fail(
          'STOCK_INSUFICIENTE',
          'No se reservó nada. Stock insuficiente: ' +
            shortages.map(function (s) {
              return s.name + ' (pedido ' + qtyLabel(s.requested, s.unit) + ', disponible ' + qtyLabel(s.available, s.unit) + ')';
            }).join('; ') + '.',
          { shortages: shortages }
        );
      }
      var subtotal = 0;
      order.lines = plan.map(function (x) {
        var left = x.need;
        var allocations = [];
        x.lots.forEach(function (lot) {
          if (left <= 0) return;
          var q = Math.min(left, lotAvailable(lot, ctx.today));
          lot.reserved += q;
          left -= q;
          allocations.push({ lotId: lot.id, lotCode: lot.code, qty: q });
          addMovement(d, ctx, { type: 'reserva', lotId: lot.id, sku: x.prod.sku, qty: q, unit: x.prod.stockUnit, fisico: 0, orderId: order.id, reason: 'Reserva para el pedido ' + order.id + ' (no es salida física)' });
        });
        var unitPrice = x.prod.pricing.precioAlmacen;
        subtotal += unitPrice * x.ln.qty;
        // Precio, unidad y descripción quedan registrados en la línea: la lista de precios puede cambiar después.
        return {
          sku: x.prod.sku, name: x.prod.name, presentation: x.prod.presentation, unit: x.prod.saleUnit,
          saleFactor: x.prod.saleFactor, stockUnit: x.prod.stockUnit, qty: x.ln.qty, unitPrice: unitPrice,
          lineTotal: unitPrice * x.ln.qty, allocations: allocations,
          // Costo vigente al confirmar (interno): el margen de pedidos viejos no cambia si cambia el costo.
          unitCostProveedor: x.prod.pricing.costoProveedor, unitCostLogistico: x.prod.pricing.costoLogistico
        };
      });
      order.deliveryFee = d.settings.deliveryFee;
      order.subtotal = subtotal;
      order.total = subtotal + (order.deliveryFee || 0);
      order.confirmedAt = ctx.nowIso;
      setStatus(order, 'reservado', ctx);
      return { summary: 'Pedido ' + order.id + ' de ' + alm.name + ' confirmado y reservado. Total ' + fmtGs(order.total) + '.' };
    },

    /**
     * Deja constancia de una venta que no se pudo reservar por falta de stock (venta perdida).
     * No confía en lo que manda la pantalla: vuelve a calcular el faltante con el stock actual.
     * Varios intentos del mismo pedido en el mismo día cuentan una sola vez.
     */
    'pedido.registrarFaltante': function (d, ctx, p) {
      var order = getOrder(d, ctx, p.orderId);
      if (order.status !== 'borrador') fail('TRANSICION_INVALIDA', 'Solo se registran faltantes de pedidos en borrador.');
      var lines = [];
      order.lines.forEach(function (ln) {
        var prod = productOf(d, ln.sku);
        if (!prod) return;
        var av = availableInSaleUnits(d, prod, ctx.today);
        if (ln.qty > av) {
          lines.push({ sku: prod.sku, name: prod.name, unit: prod.saleUnit, requested: ln.qty, available: av, missing: ln.qty - av, unitPrice: prod.pricing.precioAlmacen });
        }
      });
      if (!lines.length) fail('SIN_FALTANTE', 'El pedido entra en el stock disponible: no hay faltante que registrar.');
      var existing = null;
      d.shortages.forEach(function (x) { if (x.orderId === order.id && x.date === ctx.today) existing = x; });
      if (existing) {
        existing.lines = lines;
        existing.at = ctx.nowIso;
        existing.attempts++;
      } else {
        d.shortages.push({ id: nextId(d, 'short', 'F-', 4), orderId: order.id, almacenId: order.almacenId, date: ctx.today, at: ctx.nowIso, attempts: 1, lines: lines });
      }
      return {
        summary: 'Faltante registrado en el pedido ' + order.id + ': ' + lines.map(function (l) { return l.name + ' (faltan ' + qtyLabel(l.missing, l.unit) + ')'; }).join('; ') + '.'
      };
    },

    /** Decisión explícita del operador ante un faltante: baja las cantidades del borrador a lo disponible. */
    'pedido.ajustarADisponible': function (d, ctx, p) {
      var order = getOrder(d, ctx, p.orderId);
      if (order.status !== 'borrador') fail('TRANSICION_INVALIDA', 'Solo se pueden ajustar pedidos en borrador.');
      var changes = [];
      order.lines = order.lines.filter(function (ln) {
        var prod = productOf(d, ln.sku);
        var av = availableInSaleUnits(d, prod, ctx.today);
        if (ln.qty > av) {
          changes.push(prod.name + ': ' + ln.qty + ' → ' + av);
          ln.qty = av;
        }
        return ln.qty > 0;
      });
      if (!changes.length) fail('SIN_CAMBIOS', 'El borrador ya entra en el stock disponible.');
      return { summary: 'Borrador ' + order.id + ' ajustado al stock disponible por decisión del operador: ' + changes.join('; ') + '.' };
    },

    'pedido.preparar': function (d, ctx, p) {
      var order = getOrder(d, ctx, p.orderId);
      assertTransition(order, 'en_preparacion');
      setStatus(order, 'en_preparacion', ctx);
      return { summary: 'Pedido ' + order.id + ' en preparación.' };
    },

    /** Única salida física de stock. Un segundo intento choca con el estado y no vuelve a descontar. */
    'pedido.despachar': function (d, ctx, p) {
      var order = getOrder(d, ctx, p.orderId);
      assertTransition(order, 'despachado');
      var responsible = reqText(p.responsible, 'responsable de la entrega');
      var wf = p.windowFrom || order.windowFrom || null;
      var wt = p.windowTo || order.windowTo || wf;
      if (wf) reqWindow(wf, wt);
      order.lines.forEach(function (ln) {
        ln.allocations.forEach(function (a) {
          var lot = byId(d.lots, a.lotId);
          if (isExpired(lot, ctx.today)) {
            fail('LOTE_VENCIDO', 'El lote ' + lot.code + ' reservado para ' + ln.name + ' venció el ' + fmtDate(lot.expiry) + '. Cancele el pedido y vuelva a armarlo con stock vigente.');
          }
          if (lot.reserved < a.qty || lot.liberado < a.qty) {
            fail('SALDO_NEGATIVO', 'El lote ' + lot.code + ' no tiene el stock reservado para este pedido. Revise los movimientos.');
          }
          lot.reserved -= a.qty;
          lot.liberado -= a.qty;
          addMovement(d, ctx, { type: 'salida', lotId: lot.id, sku: ln.sku, qty: a.qty, unit: ln.stockUnit, fisico: -a.qty, orderId: order.id, reason: 'Despacho del pedido ' + order.id });
        });
      });
      order.delivery = {
        responsible: responsible, windowFrom: wf, windowTo: wt, notes: text(p.notes),
        dispatchedAt: ctx.nowIso, deliveredAt: null, deliveryNotes: ''
      };
      setStatus(order, 'despachado', ctx);
      return { summary: 'Pedido ' + order.id + ' despachado. Responsable: ' + responsible + '.' };
    },

    'pedido.entregar': function (d, ctx, p) {
      var order = getOrder(d, ctx, p.orderId);
      assertTransition(order, 'entregado');
      order.delivery.deliveredAt = ctx.nowIso;
      order.delivery.deliveryNotes = text(p.notes);
      setStatus(order, 'entregado', ctx);
      return { summary: 'Pedido ' + order.id + ' entregado.' };
    },

    /** Solo antes del despacho. Libera la reserva una única vez: repetirlo falla sin tocar el stock. */
    'pedido.cancelar': function (d, ctx, p) {
      var order = getOrder(d, ctx, p.orderId);
      if (order.status === 'cancelado') fail('YA_CANCELADO', 'El pedido ' + order.id + ' ya estaba cancelado. No se modificó el stock.');
      if (order.status === 'despachado' || order.status === 'entregado') {
        fail('TRANSICION_INVALIDA', 'El pedido ' + order.id + ' ya fue despachado: no se puede cancelar. Las devoluciones quedan fuera del piloto y nunca reponen stock de forma automática.');
      }
      if (ctx.actor.role === 'almacen' && order.status === 'en_preparacion') {
        fail('SIN_PERMISO', 'El pedido ya está en preparación. Para cancelarlo, comuníquese con la distribuidora.');
      }
      var reason = order.status === 'borrador' ? text(p.reason) : reqText(p.reason, 'motivo de la cancelación');
      if (activeAllocations(order) && !order.reservationReleased) {
        order.lines.forEach(function (ln) {
          ln.allocations.forEach(function (a) {
            var lot = byId(d.lots, a.lotId);
            lot.reserved -= a.qty;
            addMovement(d, ctx, { type: 'liberacion_reserva', lotId: lot.id, sku: ln.sku, qty: a.qty, unit: ln.stockUnit, fisico: 0, orderId: order.id, reason: 'Cancelación del pedido ' + order.id });
          });
        });
        order.reservationReleased = true;
      }
      order.cancelReason = reason;
      setStatus(order, 'cancelado', ctx, reason);
      return { summary: 'Pedido ' + order.id + ' cancelado' + (reason ? '. Motivo: ' + reason : '') + '.' };
    },

    /** El cliente (o el equipo) informa que realizó la transferencia / QR SIPAP. Queda para verificación manual. */
    'pedido.informarPago': function (d, ctx, p) {
      var order = getOrder(d, ctx, p.orderId);
      if (order.status === 'cancelado') fail('TRANSICION_INVALIDA', 'No se puede informar pago de un pedido cancelado.');
      var method = p.method || (order.payment && order.payment.method) || 'sipap_qr';
      if (!PAYMENT_METHODS[method]) fail('VALOR_INVALIDO', 'Forma de pago desconocida.');
      var ref = text(p.ref);
      order.payment = Object.assign({ method: method, status: 'pendiente', ref: '', reportedAt: null, confirmedAt: null, confirmedBy: '' }, order.payment || {});
      order.payment.method = method;
      if (order.payment.status !== 'acreditado') order.payment.status = 'en_verificacion';
      if (ref) order.payment.ref = ref;
      order.payment.reportedAt = ctx.nowIso;
      return { summary: 'Pago informado en pedido ' + order.id + ' (' + PAYMENT_METHODS[method] + (ref ? ', ref. ' + ref : '') + '). Pendiente de verificación manual.' };
    },

    /** Confirmación manual del pago por Administración / Ventas. */
    'pedido.confirmarPago': function (d, ctx, p) {
      var order = getOrder(d, ctx, p.orderId);
      if (order.status === 'cancelado') fail('TRANSICION_INVALIDA', 'No se puede acreditar pago de un pedido cancelado.');
      var method = p.method || (order.payment && order.payment.method) || 'sipap_qr';
      if (!PAYMENT_METHODS[method]) fail('VALOR_INVALIDO', 'Forma de pago desconocida.');
      var ref = text(p.ref);
      order.payment = Object.assign({ method: method, status: 'pendiente', ref: '', reportedAt: null, confirmedAt: null, confirmedBy: '' }, order.payment || {});
      order.payment.method = method;
      order.payment.status = 'acreditado';
      if (ref) order.payment.ref = ref;
      order.payment.confirmedAt = ctx.nowIso;
      order.payment.confirmedBy = ctx.actorLabel;
      return { summary: 'Pago acreditado en pedido ' + order.id + ' (' + PAYMENT_METHODS[method] + (ref ? ', ref. ' + ref : '') + ').' };
    }
  };

  function can(actor, type) {
    return !!actor && !!PERMISSIONS[type] && PERMISSIONS[type].indexOf(actor.role) !== -1;
  }

  /**
   * Ejecuta un comando. Devuelve { ok:true, state, result } o { ok:false, state (sin cambios), code, message }.
   */
  function execute(state, actor, cmd, now) {
    try {
      var handler = HANDLERS[cmd && cmd.type];
      if (!handler) fail('COMANDO_DESCONOCIDO', 'Acción desconocida.');
      if (!can(actor, cmd.type)) fail('SIN_PERMISO', 'Su rol no permite esta acción.');
      if (actor.active === false) fail('SIN_PERMISO', 'El usuario está inactivo.');
      var when = now instanceof Date ? now : new Date(now);
      var ctx = {
        actor: actor,
        actorLabel: actor.name + ' (' + ROLES[actor.role] + ')',
        nowIso: when.toISOString(),
        today: localDate(when)
      };
      var draft = clone(state);
      var out = handler(draft, ctx, cmd.payload || {}) || {};
      draft.audit.push({ id: nextId(draft, 'audit', 'A-', 5), at: ctx.nowIso, actor: ctx.actorLabel, action: cmd.type, summary: out.summary || '' });
      return { ok: true, state: draft, result: out.result || null, summary: out.summary || '' };
    } catch (e) {
      if (e instanceof DomainError) return { ok: false, state: state, code: e.code, message: e.message, details: e.details };
      throw e;
    }
  }

  // ---------- vistas por rol (lo que cada rol puede leer) ----------

  /** Vitrina para el almacén: precio, unidad, presentación y disponibilidad real. Nunca costos ni márgenes. */
  /** Motivo por el que un producto activo no se muestra en la vitrina (un precio pendiente sí se muestra). */
  function hiddenFromStoreReason(state, p) {
    if (p.status !== 'activo') return 'El producto no está activo en el catálogo.';
    var cat = categoryOf(state, p);
    if (cat && cat.fueraDePiloto) return 'Categoría fuera del piloto.';
    if (p.docRequired && !text(p.docRef)) return 'Falta el documento de regularización del producto.';
    return null;
  }

  function storefront(state, today) {
    return state.products
      .filter(function (p) {
        return !hiddenFromStoreReason(state, p);
      })
      .map(function (p) {
        var coop = p.coopId ? byId(state.orgs, p.coopId) : null;
        var cat = categoryOf(state, p);
        return {
          sku: p.sku,
          name: p.name,
          presentation: p.presentation,
          category: cat ? cat.name : '',
          origin: coop ? coop.name : 'Origen por definir',
          originDetail: p.origin,
          unit: p.saleUnit,
          unitNote: p.saleFactor > 1 ? '1 ' + unitLabel(p.saleUnit, 1) + ' = ' + qtyLabel(p.saleFactor, p.stockUnit) : '',
          price: p.pricing.precioAlmacen,
          suggestedPrice: p.pricing.precioSugerido,
          available: availableInSaleUnits(state, p, today),
          nextExpiry: (fefoLots(state, p.sku, today)[0] || {}).expiry || null,
          description: p.description || '',
          story: p.story || '',
          recipes: (p.recipes || []).map(function (r) { return clone(r); }),
          claims: (p.claims || []).slice(),
          categoryId: p.categoryId,
          orderable: !notSellableReason(state, p),
          priceHidden: !!p.pricing.hidden,
          photo: p.photo || null,
          video: p.video || null
        };
      });
  }

  function visibleOrders(state, actor) {
    if (actor.role === 'almacen') {
      return state.orders.filter(function (o) { return o.almacenId === actor.orgId; }).map(function (o) {
        var c = clone(o);
        c.lines.forEach(function (ln) { delete ln.unitCostProveedor; delete ln.unitCostLogistico; });
        return c;
      });
    }
    if (actor.role === 'cooperativa') return [];
    return state.orders.slice();
  }
  function visibleOffers(state, actor) {
    if (actor.role === 'cooperativa') return state.offers.filter(function (o) { return o.coopId === actor.orgId; });
    if (actor.role === 'almacen') return [];
    return state.offers.slice();
  }
  function visibleDemands(state, actor) {
    if (actor.role === 'almacen') return state.demands.filter(function (x) { return x.almacenId === actor.orgId; });
    if (actor.role === 'cooperativa') return [];
    return state.demands.slice();
  }
  function visibleLots(state, actor) {
    if (actor.role === 'cooperativa') return state.lots.filter(function (l) { return l.coopId === actor.orgId; });
    if (actor.role === 'almacen') return [];
    return state.lots.slice();
  }
  /** Productos sin datos de precio, para la cooperativa (solo los propios y las líneas sin origen asignado). */
  function coopProducts(state, actor) {
    return state.products
      .filter(function (p) {
        return p.status !== 'inactivo' && (!p.coopId || p.coopId === actor.orgId);
      })
      .map(function (p) {
        var cat = categoryOf(state, p);
        return { sku: p.sku, name: p.name, presentation: p.presentation, stockUnit: p.stockUnit, status: p.status, own: p.coopId === actor.orgId, category: cat ? cat.name : '' };
      });
  }

  // ---------- vista por cuenta (servidor) ----------

  /** Una cuenta tal como la ve otra persona: nunca viaja el hash de la contraseña. */
  function publicUser(u) {
    return { id: u.id, name: u.name, username: u.username, role: u.role, orgId: u.orgId || null, active: u.active !== false, cred: u.cred ? { set: true, at: u.cred.at || null } : null };
  }

  /**
   * Datos que recibe cada cuenta desde el servidor.
   * - Nadie recibe hashes de contraseña.
   * - Equipo interno (Administración, Ventas, Depósito): todo lo operativo.
   * - Cliente: catálogo con su precio (sin costos), disponibilidad, sus pedidos y sus avisos. Nada de otros clientes.
   * - Cooperativa: sus productos (sin precios), sus lotes y su oferta. Nada de otras cooperativas ni de clientes.
   * - Visitante: catálogo sin precios ni stock.
   */
  function viewFor(state, user) {
    var role = user && user.active !== false ? user.role : 'visitante';
    var v = clone(state);
    v.users = v.users.map(publicUser);
    if (role === 'admin' || role === 'comercial' || role === 'operacion') return v;

    var empty = ['offers', 'demands', 'orders', 'movements', 'audit', 'shortages', 'depositos'];
    empty.forEach(function (k) { v[k] = []; });
    v.seq = {};
    v.users = v.users.filter(function (u) { return user && u.id === user.id; });
    var stripPricing = function (p, keepPrice) {
      var had = p.pricing.precioAlmacen !== null;
      p.pricing = {
        costoProveedor: null, costoLogistico: null,
        precioAlmacen: keepPrice ? p.pricing.precioAlmacen : null,
        precioSugerido: keepPrice ? p.pricing.precioSugerido : null
      };
      if (!keepPrice && had && role === 'visitante') p.pricing.hidden = true;
    };
    var lotForStock = function (l) {
      return { id: l.id, code: l.code, sku: l.sku, liberado: l.liberado, bloqueado: l.bloqueado, reserved: l.reserved, expiry: l.expiry, receivedDate: l.receivedDate };
    };

    if (role === 'almacen') {
      v.orgs = v.orgs.filter(function (o) { return o.id === user.orgId || o.type === 'cooperativa'; }).map(function (o) {
        return o.id === user.orgId ? o : { id: o.id, type: o.type, name: o.name, active: o.active !== false };
      });
      v.products.forEach(function (p) { stripPricing(p, true); });
      v.lots = v.lots.map(lotForStock);
      v.orders = visibleOrders(state, user);
      v.demands = state.demands.filter(function (x) { return x.almacenId === user.orgId; }).map(clone);
      v.shortages = (state.shortages || []).filter(function (x) { return x.almacenId === user.orgId; }).map(clone);
      return v;
    }
    if (role === 'cooperativa') {
      v.orgs = v.orgs.filter(function (o) { return o.id === user.orgId; });
      v.products = v.products.filter(function (p) { return !p.coopId || p.coopId === user.orgId; });
      v.products.forEach(function (p) { stripPricing(p, false); });
      v.lots = v.lots.filter(function (l) { return l.coopId === user.orgId; });
      v.offers = state.offers.filter(function (o) { return o.coopId === user.orgId; }).map(clone);
      return v;
    }
    // Visitante
    v.orgs = v.orgs.filter(function (o) { return o.type === 'cooperativa'; }).map(function (o) { return { id: o.id, type: o.type, name: o.name, active: o.active !== false }; });
    v.products.forEach(function (p) { stripPricing(p, false); });
    v.lots = [];
    return v;
  }

  // ---------- panel ----------

  function dashboard(state, today) {
    var ordersByStatus = {};
    Object.keys(ORDER_STATUS).forEach(function (k) { ordersByStatus[k] = 0; });
    state.orders.forEach(function (o) { ordersByStatus[o.status]++; });
    var stock = state.products
      .map(function (p) { return { product: p, s: stockSummary(state, p.sku, today) }; })
      .filter(function (x) { return x.s.fisico > 0 || x.product.status === 'activo'; });
    var limit = addDays(today, state.settings.nearExpiryDays);
    var nearExpiry = state.lots
      .filter(function (l) { return l.expiry && l.liberado + l.bloqueado > 0 && l.expiry <= limit; })
      .map(function (l) { return { lot: l, expired: isExpired(l, today), days: daysBetween(today, l.expiry) }; })
      .sort(function (a, b) { return a.lot.expiry < b.lot.expiry ? -1 : 1; });
    var gaps = [];
    matchSupplyDemand(state).forEach(function (row) {
      row.demands.forEach(function (dm) {
        // Solo demandas vigentes: una ventana que ya pasó no es una falta para resolver.
        if (dm.reasons.length && dm.demand.windowTo >= today) gaps.push({ sku: row.sku, product: row.product, demand: dm.demand, missing: dm.missing, reasons: dm.reasons });
      });
    });
    return {
      stock: stock,
      ordersByStatus: ordersByStatus,
      nearExpiry: nearExpiry,
      gaps: gaps,
      openDeliveries: state.orders.filter(function (o) { return o.status === 'despachado'; }),
      toPrepare: state.orders.filter(function (o) { return o.status === 'reservado' || o.status === 'en_preparacion'; })
    };
  }

  // ---------- indicadores por período ----------

  function dayOfIso(iso) { return iso ? localDate(new Date(iso)) : null; }
  function inRange(day, from, to) { return !!day && day >= from && day <= to; }
  /** Lunes de la semana del día dado (las series semanales empiezan en lunes). */
  function mondayOf(day) {
    var p = day.split('-').map(Number);
    var dow = (new Date(p[0], p[1] - 1, p[2]).getDay() + 6) % 7;
    return addDays(day, -dow);
  }
  function hasCost(ln) {
    return typeof ln.unitCostProveedor === 'number' && typeof ln.unitCostLogistico === 'number';
  }
  function average(list) {
    return list.length ? list.reduce(function (t, x) { return t + x; }, 0) / list.length : null;
  }
  function hoursBetween(a, b) { return (new Date(b).getTime() - new Date(a).getTime()) / 3600000; }

  /** Totales de un período. Cada indicador dice sobre qué pedidos se calcula. */
  function periodTotals(state, from, to) {
    var confirmed = state.orders.filter(function (o) { return o.confirmedAt && inRange(dayOfIso(o.confirmedAt), from, to); });
    // Venta = pedido confirmado (stock reservado) que no se canceló, por fecha de confirmación.
    var sold = confirmed.filter(function (o) { return o.status !== 'cancelado'; });
    var cancelled = confirmed.filter(function (o) { return o.status === 'cancelado'; });
    var ventas = sold.reduce(function (t, o) { return t + o.subtotal; }, 0);
    // Margen realizado = solo pedidos entregados en el período, con el costo registrado al confirmar.
    var delivered = state.orders.filter(function (o) {
      return o.status === 'entregado' && o.delivery && inRange(dayOfIso(o.delivery.deliveredAt), from, to);
    });
    var revAll = 0, revKnown = 0, costKnown = 0;
    delivered.forEach(function (o) {
      o.lines.forEach(function (ln) {
        revAll += ln.lineTotal;
        if (hasCost(ln)) {
          revKnown += ln.lineTotal;
          costKnown += (ln.unitCostProveedor + ln.unitCostLogistico) * ln.qty;
        }
      });
    });
    var dispatched = state.orders.filter(function (o) { return o.delivery && inRange(dayOfIso(o.delivery.dispatchedAt), from, to); });
    var lost = (state.shortages || []).filter(function (x) { return inRange(x.date, from, to); });
    var lostValue = 0, lostUnpriced = false;
    lost.forEach(function (x) {
      x.lines.forEach(function (l) {
        if (l.unitPrice === null) lostUnpriced = true;
        else lostValue += l.missing * l.unitPrice;
      });
    });
    return {
      ventas: ventas,
      pedidos: sold.length,
      ticket: sold.length ? Math.round(ventas / sold.length) : null,
      confirmados: confirmed.length,
      cancelados: cancelled.length,
      tasaCancelacion: confirmed.length ? cancelled.length / confirmed.length : null,
      despachados: dispatched.length,
      entregados: delivered.length,
      ingresoEntregado: revAll,
      ingresoConCosto: revKnown,
      gananciaBruta: revKnown > 0 ? revKnown - costKnown : null,
      margen: revKnown > 0 ? (revKnown - costKnown) / revKnown : null,
      coberturaMargen: revAll > 0 ? revKnown / revAll : null,
      faltantes: lost.length,
      ventasPerdidas: lostValue,
      ventasPerdidasIncompleto: lostUnpriced,
      horasHastaDespacho: average(dispatched.map(function (o) { return hoursBetween(o.confirmedAt, o.delivery.dispatchedAt); })),
      horasHastaEntrega: average(delivered.map(function (o) { return hoursBetween(o.delivery.dispatchedAt, o.delivery.deliveredAt); })),
      sold: sold,
      lost: lost
    };
  }

  /**
   * Indicadores del panel para el período [from, to], comparados con el período anterior de igual largo.
   * Todo sale de lo registrado: pedidos confirmados, entregas, faltantes, lotes y movimientos.
   */
  function analytics(state, from, to, today) {
    if (!isDate(from) || !isDate(to) || to < from) fail('FECHA_INVALIDA', 'El período elegido no es válido.');
    var len = daysBetween(from, to) + 1;
    var prevTo = addDays(from, -1);
    var prevFrom = addDays(prevTo, -(len - 1));
    var cur = periodTotals(state, from, to);
    var prev = periodTotals(state, prevFrom, prevTo);

    // Serie de ventas: por día hasta 31 días; por semana (lunes a domingo) en períodos más largos.
    var weekly = len > 31;
    var series = [];
    var index = {};
    for (var day = weekly ? mondayOf(from) : from; day <= to; day = addDays(day, weekly ? 7 : 1)) {
      var end = weekly ? addDays(day, 6) : day;
      var b = { key: day, from: day < from ? from : day, to: end > to ? to : end, ventas: 0, pedidos: 0 };
      index[day] = b;
      series.push(b);
    }
    cur.sold.forEach(function (o) {
      var dd = dayOfIso(o.confirmedAt);
      var bucket = index[weekly ? mondayOf(dd) : dd];
      if (bucket) {
        bucket.ventas += o.subtotal;
        bucket.pedidos++;
      }
    });

    var byProduct = {};
    var byAlmacen = {};
    cur.sold.forEach(function (o) {
      var a = byAlmacen[o.almacenId];
      if (!a) {
        var org = byId(state.orgs, o.almacenId);
        a = byAlmacen[o.almacenId] = { almacenId: o.almacenId, name: org ? org.name : o.almacenId, ventas: 0, pedidos: 0, ultimo: null };
      }
      a.ventas += o.subtotal;
      a.pedidos++;
      if (!a.ultimo || o.confirmedAt > a.ultimo) a.ultimo = o.confirmedAt;
      o.lines.forEach(function (ln) {
        var r = byProduct[ln.sku] || (byProduct[ln.sku] = { sku: ln.sku, name: ln.name, unit: ln.unit, qty: 0, ventas: 0, pedidos: 0 });
        r.qty += ln.qty;
        r.ventas += ln.lineTotal;
        r.pedidos++;
      });
    });
    var lostByProduct = {};
    cur.lost.forEach(function (x) {
      x.lines.forEach(function (l) {
        var r = lostByProduct[l.sku] || (lostByProduct[l.sku] = { sku: l.sku, name: l.name, unit: l.unit, missing: 0, valor: 0, sinPrecio: false, veces: 0 });
        r.missing += l.missing;
        r.veces++;
        if (l.unitPrice === null) r.sinPrecio = true;
        else r.valor += l.missing * l.unitPrice;
      });
    });

    // Stock: valor a costo vigente y días de cobertura según las salidas de los últimos 30 días.
    var since = addDays(today, -29);
    var outBySku = {};
    state.movements.forEach(function (m) {
      if (m.type === 'salida' && inRange(dayOfIso(m.at), since, today)) outBySku[m.sku] = (outBySku[m.sku] || 0) + m.qty;
    });
    var stockValue = 0;
    var stockValueIncompleto = false;
    var stock = state.products.filter(function (p) {
      return p.status === 'activo' || state.lots.some(function (l) { return l.sku === p.sku; });
    }).map(function (p) {
      var sm = stockSummary(state, p.sku, today);
      var vendible = sm.disponible + sm.reservado;
      var unitCost = p.pricing.costoProveedor === null ? null : p.pricing.costoProveedor / p.saleFactor;
      var valor = unitCost === null ? null : Math.round(vendible * unitCost);
      if (valor === null) { if (vendible > 0) stockValueIncompleto = true; } else stockValue += valor;
      var daily = (outBySku[p.sku] || 0) / 30;
      return { product: p, s: sm, valor: valor, salida30: outBySku[p.sku] || 0, coberturaDias: daily > 0 ? Math.floor(sm.disponible / daily) : null };
    });

    // Recepciones del período por cooperativa (valor a costo vigente: el lote no registra precio pagado).
    var byCoop = {};
    state.lots.forEach(function (l) {
      if (!inRange(l.receivedDate, from, to)) return;
      var p = productOf(state, l.sku);
      var org = byId(state.orgs, l.coopId);
      var r = byCoop[l.coopId] || (byCoop[l.coopId] = { coopId: l.coopId, name: org ? org.name : l.coopId, lotes: 0, valor: 0, sinCosto: false, diferencias: 0, conBloqueo: 0 });
      r.lotes++;
      if (p.pricing.costoProveedor === null) r.sinCosto = true;
      else r.valor += Math.round(l.receivedQty * p.pricing.costoProveedor / p.saleFactor);
      if (l.declaredQty !== null && l.declaredQty !== undefined && l.declaredQty !== l.receivedQty) r.diferencias++;
      if (l.bloqueado > 0) r.conBloqueo++;
    });

    var desc = function (k) { return function (a, b) { return b[k] - a[k]; }; };
    delete cur.sold; delete cur.lost; delete prev.sold; delete prev.lost;
    return {
      from: from, to: to, prevFrom: prevFrom, prevTo: prevTo, days: len, weekly: weekly,
      cur: cur, prev: prev, series: series,
      products: Object.keys(byProduct).map(function (k) { return byProduct[k]; }).sort(desc('ventas')),
      almacenes: Object.keys(byAlmacen).map(function (k) { return byAlmacen[k]; }).sort(desc('ventas')),
      lostByProduct: Object.keys(lostByProduct).map(function (k) { return lostByProduct[k]; }).sort(desc('missing')),
      stock: stock, stockValue: stockValue, stockValueIncompleto: stockValueIncompleto,
      coops: Object.keys(byCoop).map(function (k) { return byCoop[k]; }).sort(desc('valor'))
    };
  }

  // ---------- integridad y respaldo ----------

  /** Reglas que nunca deben romperse. Devuelve la lista de problemas (vacía si todo cierra). */
  function checkInvariants(state) {
    var problems = [];
    var reservedByLot = {};
    state.orders.forEach(function (o) {
      if (!ORDER_STATUS[o.status]) problems.push('Pedido ' + o.id + ' con estado desconocido.');
      if (!activeAllocations(o)) return;
      o.lines.forEach(function (ln) {
        (ln.allocations || []).forEach(function (a) {
          reservedByLot[a.lotId] = (reservedByLot[a.lotId] || 0) + a.qty;
        });
      });
    });
    state.lots.forEach(function (l) {
      ['liberado', 'bloqueado', 'reserved'].forEach(function (k) {
        if (!isInt(l[k]) || l[k] < 0) problems.push('Lote ' + l.id + ': ' + k + ' inválido (' + l[k] + ').');
      });
      if (l.reserved > l.liberado) problems.push('Lote ' + l.id + ': reservado mayor que liberado.');
      if ((reservedByLot[l.id] || 0) !== l.reserved) problems.push('Lote ' + l.id + ': la reserva no coincide con los pedidos activos.');
      if (!productOf(state, l.sku)) problems.push('Lote ' + l.id + ': producto inexistente.');
    });
    return problems;
  }

  function exportBackup(state, now) {
    return { app: APP_ID, kind: 'respaldo-de-prueba', schemaVersion: SCHEMA_VERSION, exportedAt: new Date(now).toISOString(), notice: 'Datos de prueba. Este archivo no es una fuente oficial.', state: state };
  }

  /** Lleva datos de la versión 1 a la 2 sin inventar nada: lo que no se registró queda como "sin dato". */
  function migrate(s) {
    var m = clone(s);
    if (m.schemaVersion === 1) {
      if (!Array.isArray(m.shortages)) m.shortages = [];
      (m.orders || []).forEach(function (o) {
        if (!o.confirmedAt) return;
        (o.lines || []).forEach(function (ln) {
          if (!('unitCostProveedor' in ln)) ln.unitCostProveedor = null;
          if (!('unitCostLogistico' in ln)) ln.unitCostLogistico = null;
        });
      });
      m.schemaVersion = 2;
    }
    if (m.schemaVersion === 2) {
      m.settings = m.settings || {};
      if (!m.settings.storeName) m.settings.storeName = DEFAULT_STORE_NAME;
      var taken = {};
      (m.users || []).forEach(function (u) {
        if (!('cred' in u)) u.cred = null;
        if (!u.username) {
          var base = slug(u.name);
          var name = base;
          var n = 2;
          while (taken[name]) name = base + n++;
          u.username = name;
        }
        taken[u.username] = true;
      });
      (m.products || []).forEach(function (p) {
        if (typeof p.story !== 'string') p.story = '';
        if (!Array.isArray(p.recipes)) p.recipes = [];
        if (!Array.isArray(p.claims)) p.claims = [];
      });
      m.schemaVersion = 3;
    }
    return m;
  }

  /** Valida un respaldo antes de reemplazar los datos. Devuelve { ok, state } o { ok:false, errors }. */
  function importBackup(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object') return { ok: false, errors: ['El archivo no contiene un respaldo válido.'] };
    if (obj.app !== APP_ID || obj.kind !== 'respaldo-de-prueba') errors.push('El archivo no es un respaldo de este piloto.');
    if ([1, 2, SCHEMA_VERSION].indexOf(obj.schemaVersion) === -1) errors.push('Versión de respaldo no compatible: ' + obj.schemaVersion + ' (se esperaba de 1 a ' + SCHEMA_VERSION + ').');
    var s = obj.state;
    if (!s || typeof s !== 'object') errors.push('El respaldo no trae datos.');
    if (errors.length) return { ok: false, errors: errors };
    if (s.schemaVersion === 1 || s.schemaVersion === 2) s = migrate(s);
    var base = emptyState();
    Object.keys(base).forEach(function (k) {
      if (Array.isArray(base[k]) && !Array.isArray(s[k])) errors.push('Falta la lista "' + k + '".');
    });
    if (!s.settings || typeof s.settings !== 'object' || !s.seq || typeof s.seq !== 'object') errors.push('Falta la configuración.');
    if (s.schemaVersion !== SCHEMA_VERSION) errors.push('Los datos tienen otra versión de esquema.');
    if (errors.length) return { ok: false, errors: errors };
    try {
      s.products.forEach(function (p) {
        if (!p.sku || !p.pricing || !UNITS[p.stockUnit] || !UNITS[p.saleUnit] || !isInt(p.saleFactor) || p.saleFactor < 1) throw new Error('Producto mal formado: ' + (p.sku || '?'));
      });
      s.orders.forEach(function (o) {
        if (!o.id || !Array.isArray(o.lines) || !Array.isArray(o.history)) throw new Error('Pedido mal formado: ' + (o.id || '?'));
      });
      errors = errors.concat(checkInvariants(s));
    } catch (e) {
      errors.push(e.message);
    }
    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, state: clone(s) };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION, APP_ID: APP_ID, DEFAULT_STORE_NAME: DEFAULT_STORE_NAME, slug: slug, hiddenFromStoreReason: hiddenFromStoreReason, UNITS: UNITS, ROLES: ROLES, ORDER_STATUS: ORDER_STATUS, ORDER_FLOW: ORDER_FLOW,
    TRANSITIONS: TRANSITIONS, PRODUCT_STATUS: PRODUCT_STATUS, OFFER_CONFIRMATION: OFFER_CONFIRMATION, OFFER_KIND: OFFER_KIND,
    DEMAND_KIND: DEMAND_KIND, MOVEMENT_TYPES: MOVEMENT_TYPES, PAYMENT_METHODS: PAYMENT_METHODS, PAYMENT_STATUS: PAYMENT_STATUS, PERMISSIONS: PERMISSIONS,
    emptyState: emptyState, execute: execute, can: can,
    toBaseQty: toBaseQty, isExpired: isExpired, lotAvailable: lotAvailable, fefoLots: fefoLots, stockSummary: stockSummary,
    availableInSaleUnits: availableInSaleUnits, notSellableReason: notSellableReason, priceIndicators: priceIndicators,
    windowsOverlap: windowsOverlap, matchSupplyDemand: matchSupplyDemand, orderView: orderView,
    storefront: storefront, viewFor: viewFor, publicUser: publicUser, visibleOrders: visibleOrders, visibleOffers: visibleOffers, visibleDemands: visibleDemands,
    visibleLots: visibleLots, coopProducts: coopProducts, dashboard: dashboard, analytics: analytics, mondayOf: mondayOf,
    checkInvariants: checkInvariants, exportBackup: exportBackup, importBackup: importBackup,
    localDate: localDate, addDays: addDays, daysBetween: daysBetween, isDate: isDate,
    fmtInt: fmtInt, fmtGs: fmtGs, fmtDate: fmtDate, unitLabel: unitLabel, qtyLabel: qtyLabel,
    byId: byId, productOf: productOf, clone: clone
  };
});
