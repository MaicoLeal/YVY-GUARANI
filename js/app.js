/*
 * Interfaz de la tienda y del sistema de gestión. No contiene reglas de negocio: todo cambio pasa por YvyDomain.execute().
 * Los datos y las cuentas viven en el servidor (server/app.mjs): esta pantalla solo pide y muestra lo que el servidor permite.
 */
(function () {
  'use strict';
  var D = window.YvyDomain;
  var Seed = window.YvySeed;
  var Cat = window.YvyCatalogo;
  var UI_KEY = 'yvy-piloto-ui-v1';

  var state;
  var ui = { viewAs: null, draft: null, carts: {}, orderFilter: 'activos', movSku: '', period: '30', pFrom: '', pTo: '' };
  var dialogSubmit = null;
  var toastTimer = null;

  var $ = function (id) { return document.getElementById(id); };

  // ---------- conexión con el servidor ----------

  var server = { rev: 0, setupRequired: false, me: null, viewAs: null, online: true, loaded: false };
  var pendingRefresh = false;

  function apply(snap) {
    state = snap.view;
    server.rev = snap.rev;
    server.setupRequired = !!snap.setupRequired;
    server.me = snap.me || null;
    server.viewAs = snap.viewAs || null;
    server.loaded = true;
    if (ui.viewAs && !snap.viewAs) ui.viewAs = null;
  }
  /** Llama a la API. Nunca lanza: devuelve { ok:false, message } si algo falla. */
  function api(path, body) {
    var headers = { 'X-Yvy': '1' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ui.viewAs) headers['X-Ver-Como'] = ui.viewAs;
    return fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (res) {
        return res.json().catch(function () { return { ok: false, message: 'Respuesta inválida del servidor.' }; }).then(function (data) {
          server.online = true;
          if (data && data.view) apply(data);
          if (res.status === 401 && data.code === 'SIN_SESION') { server.me = null; server.viewAs = null; }
          if (!res.ok && data.ok === undefined) data.ok = false;
          return data;
        });
      }, function () {
        server.online = false;
        return { ok: false, message: 'No se pudo conectar con el servidor. Revisá la conexión e intentá de nuevo.' };
      });
  }
  function refresh(keepScroll) {
    var y = window.scrollY;
    return api('/api/estado').then(function () {
      pendingRefresh = false;
      render();
      if (keepScroll) window.scrollTo(0, y);
    });
  }
  /** Avisos del servidor: si otra persona cambió algo, se actualiza sin pisar lo que se está escribiendo. */
  function connectEvents() {
    if (!window.EventSource) return;
    var es = new EventSource('/api/eventos');
    es.addEventListener('cambio', function (e) {
      var d = {};
      try { d = JSON.parse(e.data); } catch (err) { return; }
      if (d.rev > server.rev) scheduleRefresh();
    });
  }
  function busyEditing() {
    var a = document.activeElement;
    return $('dlg').open || !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#main') && a.type !== 'search');
  }
  function scheduleRefresh() {
    if (busyEditing()) {
      pendingRefresh = true;
      $('update').hidden = false;
      return;
    }
    refresh(true);
  }

  function loadUi() {
    try {
      var raw = localStorage.getItem(UI_KEY);
      if (raw) Object.assign(ui, JSON.parse(raw));
    } catch (e) { /* preferencias: se puede seguir sin ellas */ }
  }
  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* preferencias: se puede seguir sin ellas */ }
  }

  // ---------- sesión y acceso ----------

  var VISITOR = { id: 'visitante', role: 'visitante', name: 'Visitante', active: true, orgId: null };

  /** Cuenta con la que se ingresó (no la que se está mirando con "Ver como"). */
  function sessionUser() {
    if (!server.me) return null;
    return D.byId(state.users, server.me.id) || server.me;
  }
  /** Persona efectiva: Administración puede ver el sistema como otra cuenta (el servidor entrega exactamente su vista). */
  function actor() {
    if (!server.me) return VISITOR;
    if (server.viewAs) return Object.assign({}, server.viewAs, { name: server.viewAs.name + ' (vista de ' + server.me.name + ')', viewedBy: server.me.id });
    return sessionUser();
  }
  function viewing() { return server.viewAs || null; }
  function accessReady() { return !server.setupRequired; }
  function initials(name) {
    var parts = String(name || '?').replace(/\(.*\)/, '').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function storeName() { return state.settings.storeName || D.DEFAULT_STORE_NAME; }
  function passwordProblem(p1, p2) {
    if (!p1 || p1.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (p1 !== p2) return 'Las contraseñas no coinciden.';
    return null;
  }
  function logout() {
    api('/api/salir', {}).then(function () {
      ui.viewAs = null;
      ui.draft = null;
      saveUi();
      location.hash = '#/inicio';
      render();
    });
  }

  // ---------- utilidades ----------

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function today() { return D.localDate(new Date()); }
  function gs(n) { return D.fmtGs(n); }
  function fdate(s) { return D.fmtDate(s); }
  function fdatetime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function pct(x) { return x === null ? 'Sin datos' : (x * 100).toFixed(1).replace('.', ',') + ' %'; }
  function win(a, b) { return !a ? 'Sin definir' : a === b || !b ? fdate(a) : fdate(a) + ' al ' + fdate(b); }
  function qty(n, unit) { return D.qtyLabel(n, unit); }
  function num(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    return Number(String(v).trim());
  }
  function badge(text, tone) { return '<span class="badge ' + (tone || '') + '">' + esc(text) + '</span>'; }
  function can(type) { return D.can(actor(), type); }
  function orgName(id) { var o = D.byId(state.orgs, id); return o ? o.name : '—'; }
  function prodName(sku) { var p = D.productOf(state, sku); return p ? p.name : sku; }
  function orgs(type) { return state.orgs.filter(function (o) { return o.type === type; }); }

  function table(headers, rows, empty) {
    if (!rows.length) return '<p class="empty">' + esc(empty) + '</p>';
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      headers.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c, i) { return '<td data-l="' + esc(headers[i]) + '">' + (c ? '<div class="cv">' + c + '</div>' : '') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function field(label, control, hint, cls) {
    return '<label class="field ' + (cls || '') + '"><span>' + esc(label) + '</span>' + control + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
  }
  function input(name, type, value, attrs) {
    return '<input name="' + name + '" type="' + type + '" value="' + esc(value === null || value === undefined ? '' : value) + '" ' + (attrs || '') + '>';
  }
  function select(name, options, value, attrs) {
    return '<select name="' + name + '" ' + (attrs || '') + '>' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function unitOptions() { return Object.keys(D.UNITS).map(function (u) { return [u, D.UNITS[u].many]; }); }
  function productOptions(filter, withBlank) {
    var list = state.products.filter(filter).map(function (p) {
      return [p.sku, p.name + ' — ' + p.presentation + (p.status === 'potencial' ? ' (línea potencial)' : '')];
    });
    return (withBlank ? [['', 'Elegir producto…']] : []).concat(list);
  }
  function head(title, sub, extra) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (extra || '') + '</div>';
  }

  function toast(msg, bad) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.textContent = ''; }, bad ? 9000 : 4500);
  }

  /** Pide un comando al servidor. Devuelve una promesa con { ok, summary | message, result }. */
  function run(type, payload) {
    return api('/api/comando', { type: type, payload: payload });
  }
  /** Para botones: ejecuta, avisa y vuelve a dibujar. */
  function act(type, payload) {
    return run(type, payload).then(function (r) {
      toast(r.ok ? r.summary : r.message, !r.ok);
      render();
      return r;
    });
  }

  // ---------- diálogo ----------

  function openDialog(title, body, submitLabel, onSubmit, danger) {
    var dlg = $('dlg');
    dlg.innerHTML = '<form method="dialog" novalidate><h2 id="dlg-title">' + esc(title) + '</h2>' + body +
      '<div class="form-error" role="alert"></div><div class="actions">' +
      '<button class="btn ' + (danger ? 'danger' : 'primary') + '" type="submit" value="ok">' + esc(submitLabel) + '</button>' +
      '<button class="btn" type="button" data-close>Volver</button></div></form>';
    dialogSubmit = onSubmit;
    dlg.showModal();
  }
  function closeDialog() {
    dialogSubmit = null;
    if ($('dlg').open) $('dlg').close();
  }

  // ---------- navegación ----------

  var ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    store: '<path d="M4 9l1-5h14l1 5"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/><path d="M5 12v8h14v-8"/>',
    cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.4 11h10.2L20 7H6.2"/>',
    list: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    leaf: '<path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15"/><path d="M5 19c3-5 6-8 10-10"/>',
    inbox: '<path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h5a3 3 0 0 0 6 0h5"/>',
    box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3.5V16h-7"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
    swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 14.5c2 .8 3.5 2.8 3.5 5.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.3"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.6 2.6 5-5.4"/>',
    back: '<path d="M14 6l-6 6 6 6"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
    logout: '<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4M18 12H9"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.8 12.2l2.2 2.2 4.4-4.6"/>',
    chef: '<path d="M7 14.5V20h10v-5.5"/><path d="M7 14.5a4 4 0 1 1 1.2-7.8A4.5 4.5 0 0 1 16 6.7a4 4 0 1 1 1 7.8z"/><path d="M7 17h10"/>'
  };
  function icon(name) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>'; }

  // [ruta, etiqueta, ícono, grupo]. Cada rol ve solo sus secciones; Administración ve todas.
  var NAV = {
    visitante: [['inicio', 'Inicio', 'home'], ['tienda', 'Tienda', 'store'], ['ingresar', 'Ingresar', 'user']],
    almacen: [['inicio', 'Inicio', 'home'], ['tienda', 'Tienda', 'store'], ['mi-pedido', 'Mi pedido', 'cart'], ['mis-pedidos', 'Mis pedidos', 'list'], ['mi-interes', 'Avisar interés', 'bell']],
    cooperativa: [['mi-oferta', 'Mi oferta', 'leaf', 'Mi cooperativa'], ['lo-recibido', 'Lo recibido', 'inbox', 'Mi cooperativa'], ['mis-productos', 'Mis productos', 'box', 'Mi cooperativa']],
    operacion: [['panel', 'Panel de depósito', 'chart', 'Depósito'], ['pedidos', 'Pedidos', 'list', 'Depósito'], ['recepcion', 'Recepción', 'inbox', 'Depósito'],
      ['stock', 'Stock', 'box', 'Depósito'], ['movimientos', 'Movimientos', 'clock', 'Depósito']],
    comercial: [['panel', 'Panel comercial', 'chart', 'Ventas'], ['pedidos', 'Pedidos', 'list', 'Ventas'], ['nuevo-pedido', 'Nuevo pedido', 'cart', 'Ventas'], ['clientes', 'Clientes', 'users', 'Ventas'],
      ['cruce', 'Oferta y demanda', 'swap', 'Abastecimiento'], ['precios', 'Precios', 'tag', 'Abastecimiento'], ['stock', 'Stock', 'box', 'Abastecimiento'], ['tienda', 'Tienda', 'store', 'Tienda']],
    admin: [['panel', 'Panel general', 'chart', 'Gestión'], ['pedidos', 'Pedidos', 'list', 'Gestión'], ['nuevo-pedido', 'Nuevo pedido', 'cart', 'Gestión'], ['clientes', 'Clientes', 'users', 'Gestión'],
      ['stock', 'Stock', 'box', 'Depósito'], ['recepcion', 'Recepción', 'inbox', 'Depósito'], ['movimientos', 'Movimientos', 'clock', 'Depósito'],
      ['cruce', 'Oferta y demanda', 'swap', 'Abastecimiento'], ['precios', 'Precios', 'tag', 'Abastecimiento'], ['catalogo', 'Catálogo', 'leaf', 'Abastecimiento'],
      ['tienda', 'Tienda', 'store', 'Tienda'], ['usuarios', 'Usuarios y accesos', 'shield', 'Sistema'], ['config', 'Configuración', 'gear', 'Sistema'], ['auditoria', 'Historial', 'clock', 'Sistema']]
  };
  var LANDING = { visitante: 'inicio', almacen: 'inicio', cooperativa: 'mi-oferta', operacion: 'panel', comercial: 'panel', admin: 'panel' };
  var STORE_ROLES = { visitante: true, almacen: true };

  function route() {
    var parts = (location.hash || '').replace(/^#\/?/, '').split('/');
    return { page: parts[0], param: parts[1] ? decodeURIComponent(parts[1]) : '' };
  }
  function seesShop() { return actor().role !== 'cooperativa'; }
  /** Páginas a las que puede entrar el rol, estén o no en su menú. */
  function allowedPages(role) {
    var pages = (NAV[role] || []).map(function (n) { return n[0]; });
    if (role !== 'visitante') pages.push('cuenta');
    if (role !== 'cooperativa') pages.push('inicio', 'tienda', 'producto');
    if (role === 'visitante') pages.push('ingresar');
    return pages;
  }
  function currentPage() {
    if (!accessReady()) return 'ingresar';
    var role = actor().role;
    var page = route().page;
    if (page === 'ingresar' && role !== 'visitante') return LANDING[role];
    return allowedPages(role).indexOf(page) !== -1 ? page : (page && role === 'visitante' ? 'ingresar' : LANDING[role]);
  }
  function go(page) {
    if (('#/' + page) === location.hash) render();
    else location.hash = '#/' + page;
  }

  function renderChrome() {
    var a = actor();
    var me = sessionUser();
    var page = currentPage();
    var mode = page === 'ingresar' ? 'auth' : STORE_ROLES[a.role] ? 'store' : 'app';
    document.body.className = 'mode-' + mode;
    var navPage = page === 'producto' ? 'tienda' : page;
    var nav = NAV[a.role] || [];
    var link = function (n) {
      return '<a href="#/' + n[0] + '"' + (n[0] === navPage ? ' aria-current="page"' : '') + '>' + icon(n[2]) + '<span>' + esc(n[1]) + '</span></a>';
    };

    $('brand').innerHTML = '<img src="assets/logo-yvy.jpg" alt="" width="40" height="40"><span><b>' + esc(storeName()) + '</b><small>Yvy Guaraní S.A.</small></span>';
    $('brand').setAttribute('href', '#/' + LANDING[a.role]);
    $('brand').setAttribute('aria-label', storeName() + ', ir al inicio');

    $('topnav').innerHTML = mode === 'store' ? nav.filter(function (n) { return n[0] !== 'ingresar'; }).map(link).join('') : '';

    var env = state.demo ? '<span class="env" title="Pedidos, precios y clientes de este escenario son ficticios">Demostración</span>'
      : state.fixture ? '<span class="env" title="Escenario de prueba ficticio">Escenario de prueba</span>' : '';
    var cartBtn = '';
    if (a.role === 'almacen') {
      var n = cartCount();
      cartBtn = '<a class="iconbtn" href="#/mi-pedido" aria-label="Mi pedido' + (n ? ', ' + n + ' productos' : '') + '">' + icon('cart') + (n ? '<span class="dot">' + n + '</span>' : '') + '</a>';
    }
    var account = '';
    if (me) {
      account = '<details class="acct"><summary aria-label="Cuenta de ' + esc(me.name) + '"><span class="avatar">' + esc(initials(me.name)) + '</span>' +
        '<span class="who"><b>' + esc(me.name) + '</b><small>' + esc(D.ROLES[me.role]) + '</small></span></summary><div class="acct-menu">' +
        '<p class="small muted">' + esc(me.username) + '</p>' +
        (a.viewedBy ? '<button type="button" data-act="salir-vista">' + icon('eye') + 'Volver a mi vista</button>' : '') +
        (me.role !== 'almacen' && me.role !== 'cooperativa' ? '<a href="#/panel">' + icon('chart') + 'Panel</a>' : '') +
        '<a href="#/cuenta">' + icon('user') + 'Mi cuenta</a>' +
        '<button type="button" data-act="logout">' + icon('logout') + 'Cerrar sesión</button></div></details>';
    } else if (mode !== 'auth') {
      account = '<a class="btn sm primary" href="#/ingresar">' + icon('user') + 'Ingresar</a>';
    }
    $('top-actions').innerHTML = env + cartBtn + account;

    var v = viewing();
    $('viewas').hidden = !v;
    $('viewas').innerHTML = v ? '<p>' + icon('eye') + '<span>Estás viendo el sistema como <b>' + esc(v.name) + '</b> · ' + esc(D.ROLES[v.role]) +
      (v.orgId ? ' · ' + esc(orgName(v.orgId)) : '') + '. Lo que hagas queda registrado a su nombre, como vista tuya.</span></p>' +
      '<button class="btn sm light" type="button" data-act="salir-vista">Volver a mi vista</button>' : '';

    // Menú lateral agrupado (sistema de gestión) y barra inferior en el celular.
    var group = null;
    $('side').innerHTML = mode === 'app' ? nav.map(function (n) {
      var h = n[3] && n[3] !== group ? '<p class="side-group">' + esc(n[3]) + '</p>' : '';
      group = n[3] || group;
      return h + link(n);
    }).join('') : '';
    $('side').classList.remove('open');
    var bottom = mode === 'store'
      ? nav.filter(function (n) { return n[0] !== 'mi-interes'; }).concat(me ? [['cuenta', 'Cuenta', 'user']] : [])
      : nav.length <= 5 ? nav : nav.slice(0, 4);
    $('bottom').innerHTML = mode === 'auth' ? '' : bottom.map(link).join('') +
      (mode === 'app' && nav.length > 5 ? '<button type="button" data-act="menu" aria-expanded="false">' + icon('more') + '<span>Más</span></button>' : '');
  }

  // ---------- pedidos: piezas comunes ----------

  var STATUS_TONE = { borrador: '', reservado: 'info', en_preparacion: 'warn', despachado: 'info', entregado: 'ok', cancelado: 'bad' };
  var NEXT_STEP = {
    borrador: 'Próximo paso: confirmar el pedido. Al confirmar se reserva el stock y se fijan los precios.',
    reservado: 'Próximo paso: el depósito inicia la preparación. El stock está reservado, todavía no salió.',
    en_preparacion: 'Próximo paso: el depósito despacha el pedido. Recién ahí el stock sale del depósito.',
    despachado: 'Próximo paso: confirmar la entrega en el almacén.',
    entregado: 'Pedido completo.',
    cancelado: 'Pedido cancelado. Si tenía reserva, se liberó una sola vez.'
  };
  function steps(order) {
    if (order.status === 'cancelado') return '';
    var idx = D.ORDER_FLOW.indexOf(order.status);
    return '<ol class="steps" aria-label="Etapas del pedido">' + D.ORDER_FLOW.map(function (s, i) {
      return '<li class="' + (i < idx ? 'done' : i === idx ? 'now' : '') + '"' + (i === idx ? ' aria-current="step"' : '') + '>' + esc(D.ORDER_STATUS[s]) + '</li>';
    }).join('') + '</ol>';
  }
  function totalsHtml(v) {
    var fee = v.deliveryFee === null
      ? '<span>Entrega</span><span class="muted">Sin definir (no incluida)</span>'
      : '<span>Entrega</span><span>' + gs(v.deliveryFee) + '</span>';
    return '<div class="totals"><span>Subtotal</span><span>' + (v.subtotal === null ? 'Sin datos' : gs(v.subtotal)) + '</span>' + fee +
      '<span class="grand">Total</span><span class="grand">' + (v.total === null ? 'Sin datos' : gs(v.total)) + '</span></div>';
  }
  function orderCard(o) {
    var a = actor();
    var internal = a.role !== 'almacen';
    var v = D.orderView(state, o, today());
    var shortage = false;
    var lines = v.lines.map(function (ln) {
      var extra = '';
      if (!ln.frozen) {
        if (ln.notSellable) { extra = '<br><small class="badge bad">' + esc(ln.notSellable) + '</small>'; shortage = true; }
        else if (ln.available < ln.qty) { extra = '<br>' + badge('Disponible: ' + qty(ln.available, ln.unit), 'bad'); shortage = true; }
      } else if (internal && ln.allocations.length) {
        extra = '<br><small class="muted">Lotes: ' + ln.allocations.map(function (al) { return esc(al.lotCode) + ' (' + al.qty + ')'; }).join(', ') + '</small>';
      }
      return '<li><div><b>' + esc(ln.name) + '</b> <small class="muted">' + esc(ln.presentation) + '</small><br>' +
        '<small>' + esc(qty(ln.qty, ln.unit)) + ' × ' + (ln.unitPrice === null ? 'Sin precio' : gs(ln.unitPrice)) + '</small>' + extra + '</div>' +
        '<div>' + (ln.lineTotal === null ? 'Sin datos' : gs(ln.lineTotal)) + '</div></li>';
    }).join('');
    var meta = '<dl class="kv">' +
      (internal ? '<dt>Almacén</dt><dd>' + esc(orgName(o.almacenId)) + '</dd>' : '') +
      '<dt>Creado</dt><dd>' + fdatetime(o.createdAt) + '</dd>' +
      '<dt>Entrega deseada</dt><dd>' + win(o.windowFrom, o.windowTo) + '</dd>' +
      (o.notes ? '<dt>Observaciones</dt><dd>' + esc(o.notes) + '</dd>' : '') +
      (o.delivery ? '<dt>Entrega a cargo de</dt><dd>' + esc(o.delivery.responsible) + '</dd><dt>Ventana de entrega</dt><dd>' + win(o.delivery.windowFrom, o.delivery.windowTo) + '</dd>' +
        '<dt>Despachado</dt><dd>' + fdatetime(o.delivery.dispatchedAt) + '</dd>' +
        (o.delivery.notes ? '<dt>Nota de despacho</dt><dd>' + esc(o.delivery.notes) + '</dd>' : '') +
        (o.delivery.deliveredAt ? '<dt>Entregado</dt><dd>' + fdatetime(o.delivery.deliveredAt) + (o.delivery.deliveryNotes ? ' — ' + esc(o.delivery.deliveryNotes) : '') + '</dd>' : '') : '') +
      (o.status === 'cancelado' && o.cancelReason ? '<dt>Motivo de cancelación</dt><dd>' + esc(o.cancelReason) + '</dd>' : '') +
      '</dl>';
    var btn = function (act, label, cls) { return '<button class="btn ' + (cls || '') + '" type="button" data-act="' + act + '" data-id="' + o.id + '">' + label + '</button>'; };
    var actions = [];
    if (o.status === 'borrador') {
      if (can('pedido.confirmar')) actions.push(btn('confirmar', 'Confirmar y reservar', 'primary'));
      if (internal && can('pedido.guardarBorrador')) actions.push(btn('editar-borrador', 'Editar'));
      if (!internal) actions.push(btn('borrador-a-carrito', 'Editar en Mi pedido'));
      if (shortage && can('pedido.ajustarADisponible')) actions.push(btn('ajustar-disponible', 'Ajustar a lo disponible'));
    }
    if (o.status === 'reservado' && can('pedido.preparar')) actions.push(btn('preparar', 'Iniciar preparación', 'primary'));
    if (o.status === 'en_preparacion' && can('pedido.despachar')) actions.push(btn('despachar', 'Despachar…', 'primary'));
    if (o.status === 'despachado' && can('pedido.entregar')) actions.push(btn('entregar', 'Marcar entregado…', 'primary'));
    var cancellable = o.status === 'borrador' || o.status === 'reservado' || (o.status === 'en_preparacion' && internal);
    if (cancellable && can('pedido.cancelar')) actions.push(btn('cancelar', 'Cancelar pedido…', 'danger'));
    var hist = o.history.length ? '<details><summary class="small">Historial del pedido</summary><ul class="small">' + o.history.map(function (h) {
      return '<li>' + fdatetime(h.at) + ' — ' + esc(D.ORDER_STATUS[h.from]) + ' → ' + esc(D.ORDER_STATUS[h.to]) + ' — ' + esc(h.actor) + (h.note ? ' — ' + esc(h.note) : '') + '</li>';
    }).join('') + '</ul></details>' : '';
    return '<article class="card" aria-label="Pedido ' + o.id + '">' +
      '<div class="row between"><h2>Pedido ' + o.id + '</h2>' + badge(D.ORDER_STATUS[o.status], STATUS_TONE[o.status]) + '</div>' +
      steps(o) + '<p class="next">' + NEXT_STEP[o.status] + '</p>' + meta +
      (lines ? '<ul class="lines">' + lines + '</ul>' + totalsHtml(v) : '<p class="muted small">Sin productos.</p>') +
      (v.frozen ? '<p class="small muted" style="margin-top:6px">Precios y unidades registrados al confirmar el ' + fdatetime(o.confirmedAt) + '. No cambian si cambia la lista.</p>' : '') +
      (o.status === 'despachado' || o.status === 'entregado' ? '<p class="small muted">Las devoluciones se gestionan aparte: el stock nunca se repone de forma automática.</p>' : '') +
      (actions.length ? '<div class="actions" style="margin-top:10px">' + actions.join('') + '</div>' : '') + hist + '</article>';
  }
  function orderList(list, empty) {
    list = list.slice().sort(function (x, y) { return x.id < y.id ? 1 : -1; });
    return list.length ? '<div class="stack">' + list.map(orderCard).join('') + '</div>' : '<p class="empty">' + esc(empty) + '</p>';
  }

  // ---------- páginas: almacén ----------

  function cart() {
    var id = actor().orgId;
    if (!ui.carts[id]) ui.carts[id] = { lines: {}, orderId: null, windowFrom: '', windowTo: '', notes: '' };
    var c = ui.carts[id];
    // Si el borrador vinculado ya no existe como borrador, el carrito empieza de nuevo.
    if (c.orderId) {
      var o = D.byId(state.orders, c.orderId);
      if (!o || o.status !== 'borrador') c.orderId = null;
    }
    return c;
  }
  function cartSummary(shop) {
    var c = cart();
    var units = 0, total = 0, count = 0;
    shop.forEach(function (p) {
      var q = c.lines[p.sku] || 0;
      if (q > 0 && p.orderable) { units += q; total += q * p.price; count++; }
    });
    return { units: units, total: total, count: count };
  }
  function qtyControl(p, q) {
    return '<div class="qty" role="group" aria-label="Cantidad de ' + esc(p.name) + '">' +
      '<button type="button" data-act="cart-dec" data-sku="' + p.sku + '" aria-label="Quitar uno de ' + esc(p.name) + '"' + (q <= 0 ? ' disabled' : '') + '>−</button>' +
      '<input type="number" inputmode="numeric" min="0" step="1" value="' + q + '" data-cart-qty="' + p.sku + '" aria-label="Cantidad de ' + esc(p.name) + ' en ' + esc(D.UNITS[p.unit].many) + '">' +
      '<button type="button" data-act="cart-inc" data-sku="' + p.sku + '" aria-label="Agregar uno de ' + esc(p.name) + '">+</button>' +
      '<span class="small muted">' + esc(D.UNITS[p.unit].many) + '</span></div>';
  }
  // ---------- tienda: piezas ----------

  function isBuyer() { return actor().role === 'almacen'; }
  function isStaff() { var r = actor().role; return r === 'admin' || r === 'comercial' || r === 'operacion'; }
  function cartCount() {
    if (!isBuyer()) return 0;
    var c = cart();
    return Object.keys(c.lines).filter(function (k) { return c.lines[k] > 0; }).length;
  }
  function availBadge(p) {
    if (!p.orderable) return badge('Precio a confirmar', '');
    return p.available > 0 ? badge(qty(p.available, p.unit) + ' disponibles', 'ok') : badge('Sin stock por ahora', 'warn');
  }
  /** Precio visible solo para cuentas registradas (venta mayorista a almacenes). */
  function priceHtml(p, big) {
    var unit = '<small>por ' + esc(D.unitLabel(p.unit, 1)) + '</small>';
    if (p.priceHidden || (p.price !== null && actor().role === 'visitante')) return '<span class="price pending' + (big ? ' big' : '') + '">Precio para clientes registrados</span>';
    if (p.price === null) return '<span class="price pending' + (big ? ' big' : '') + '">Precio a confirmar</span>';
    return '<span class="price' + (big ? ' big' : '') + '">' + gs(p.price) + ' ' + unit + '</span>';
  }
  /** Foto del producto o, si todavía no se cargó, un espacio neutro con el logo (sin inventar imágenes). */
  function photoBox(p, linked) {
    var inner = p.photo
      ? '<img class="photo" src="' + esc(p.photo) + '" alt="' + esc(p.name + ' ' + p.presentation) + '" loading="lazy">'
      : '<img src="assets/logo-yvy.jpg" alt=""><span>Foto por cargar</span>';
    var extra = (linked && p.video ? '<span class="play">' + icon('play') + 'Video</span>' : '') +
      (linked && p.recipes && p.recipes.length ? '<span class="tagchip">' + icon('chef') + 'Receta</span>' : '');
    var cls = 'media' + (p.photo ? '' : ' ph');
    return linked
      ? '<a class="' + cls + '" href="#/producto/' + encodeURIComponent(p.sku) + '" tabindex="-1" aria-hidden="true">' + inner + extra + '</a>'
      : '<div class="' + cls + '">' + inner + '</div>';
  }
  /** Video del producto: YouTube (sin cookies), archivo de video o enlace. Nunca se reproduce solo. */
  function videoBox(p) {
    if (!p.video) return '';
    var yt = p.video.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
    if (yt) {
      return '<div class="media video"><iframe src="https://www.youtube-nocookie.com/embed/' + yt[1] + '" title="Video de ' + esc(p.name) + '" loading="lazy" ' +
        'allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
    }
    if (/\.(mp4|webm|ogv|mov)(\?.*)?$/i.test(p.video) || /^assets\//.test(p.video)) {
      return '<div class="media video"><video controls preload="metadata" playsinline src="' + esc(p.video) + '" aria-label="Video de ' + esc(p.name) + '"></video></div>';
    }
    return '<p><a class="btn" href="' + esc(p.video) + '" target="_blank" rel="noopener noreferrer">' + icon('play') + 'Ver el video</a></p>';
  }
  function buyControls(p, q, compact) {
    if (actor().role === 'visitante') return '<a class="btn" href="#/ingresar">Ingresar para pedir</a>';
    if (!isBuyer()) return '';
    if (!p.orderable) return '<a class="btn" href="#/mi-interes">' + icon('bell') + 'Avisar que me interesa</a>';
    if (p.available <= 0 && q <= 0) return '<a class="btn" href="#/mi-interes">' + icon('bell') + 'Avisar cuando haya</a>';
    var html = q > 0 ? qtyControl(p, q) : '<button class="btn primary' + (compact ? '' : ' lg') + '" type="button" data-act="cart-inc" data-sku="' + p.sku + '">' + icon('cart') + 'Agregar</button>';
    if (q > p.available) html += '<p class="note bad small">Pediste ' + q + ' y hay ' + p.available + '. Así el pedido completo será rechazado.</p>';
    return html;
  }
  function productCard(p, q, level) {
    var h = level || 'h2';
    var stock = p.orderable && actor().role !== 'visitante' ? '<div>' + availBadge(p) + '</div>' : '';
    return '<article class="pcard" data-search="' + esc((p.name + ' ' + p.category + ' ' + p.origin + ' ' + p.originDetail + ' ' + p.presentation).toLowerCase()) + '" data-cat="' + esc(p.category) + '" data-name="' + esc(p.name.toLowerCase()) + '" data-av="' + (p.orderable ? p.available : -1) + '">' +
      photoBox(p, true) + '<div class="body"><div><p class="eyebrow">' + esc(p.category) + '</p><' + h + '><a href="#/producto/' + encodeURIComponent(p.sku) + '">' + esc(p.name) + '</a></' + h + '>' +
      '<p class="muted small">' + esc(p.presentation) + (p.originDetail ? ' · ' + esc(p.originDetail.replace(/^Marca: /, '')) : '') + '</p></div>' +
      '<div class="foot-row">' + priceHtml(p) + stock + buyControls(p, q, true) + '</div></div></article>';
  }
  function cartBar(shop) {
    if (!isBuyer()) return '';
    var sum = cartSummary(shop);
    return sum.count ? '<a class="cartbar" href="#/mi-pedido"><span><b>' + sum.count + '</b> producto' + (sum.count === 1 ? '' : 's') + ' · <b>' + gs(sum.total) + '</b></span><span class="go">Ver mi pedido</span></a>' : '';
  }
  function recipeCard(r, p) {
    return '<a class="rcard" href="#/producto/' + encodeURIComponent(p.sku) + '">' +
      '<span class="rimg"><img src="' + esc(p.photo || 'assets/logo-yvy.jpg') + '" alt="" loading="lazy"></span>' +
      '<span class="rbody"><span class="eyebrow">Receta</span><b>' + esc(r.title) + '</b>' +
      '<small>' + [r.minutes ? r.minutes + ' min' : '', r.servings ? r.servings + ' porciones' : '', 'con ' + esc(p.name.toLowerCase())].filter(Boolean).join(' · ') + '</small></span></a>';
  }
  function allRecipes(shop) {
    var out = [];
    shop.forEach(function (p) { (p.recipes || []).forEach(function (r) { out.push({ r: r, p: p }); }); });
    return out;
  }
  function categoriesOf(shop) {
    var cats = [];
    shop.forEach(function (p) {
      var c = null;
      cats.forEach(function (x) { if (x.name === p.category) c = x; });
      if (!c) { c = { name: p.category, count: 0, photo: null }; cats.push(c); }
      c.count++;
      if (!c.photo && p.photo) c.photo = p.photo;
    });
    return cats;
  }

  function pageInicio() {
    var a = actor();
    var shop = D.storefront(state, today());
    var c = isBuyer() ? cart() : { lines: {} };
    var cats = categoriesOf(shop);
    var featured = shop.filter(function (p) { return p.story || (p.recipes && p.recipes.length); }).slice(0, 8);
    if (featured.length < 8) featured = featured.concat(shop.filter(function (p) { return featured.indexOf(p) === -1; }).slice(0, 8 - featured.length));
    var collage = shop.filter(function (p) { return p.photo; }).filter(function (p) { return ['ECO-2148', 'ECO-942', 'ECO-963', 'ECO-770'].indexOf(p.sku) !== -1; });
    if (collage.length < 4) collage = shop.filter(function (p) { return p.photo; }).slice(0, 4);
    var cta = a.role === 'visitante'
      ? '<a class="btn light lg" href="#/tienda">' + icon('store') + 'Ver la tienda</a><a class="btn ghost lg" href="#/ingresar">' + icon('user') + 'Ingresar</a>'
      : isBuyer() ? '<a class="btn light lg" href="#/tienda">' + icon('store') + 'Comprar ahora</a><a class="btn ghost lg" href="#/mis-pedidos">Mis pedidos</a>'
        : '<a class="btn light lg" href="#/tienda">' + icon('store') + 'Ver la tienda</a><a class="btn ghost lg" href="#/panel">' + icon('chart') + 'Ir al panel</a>';
    var hero = '<section class="shero"><div class="shero-text"><p class="eyebrow">Productos de cooperativas paraguayas</p>' +
      '<h1>Del campo paraguayo <em>a tu almacén</em></h1>' +
      '<p class="lead">' + esc(storeName()) + ' reúne la producción de cooperativas y la lleva directo a los almacenes del barrio: pastas, especias, mieles, granos, harinas y yuyos, con stock real y entrega coordinada.</p>' +
      '<div class="actions">' + cta + '</div></div>' +
      '<div class="shero-art" aria-hidden="true">' + collage.slice(0, 4).map(function (p, i) {
        return '<span class="tile t' + i + '"><img src="' + esc(p.photo) + '" alt=""></span>';
      }).join('') + '</div></section>';
    var trust = '<ul class="trust">' +
      '<li>' + icon('leaf') + '<span><b>De cooperativas</b><small>Producción de cooperativas y agricultura familiar del Paraguay</small></span></li>' +
      '<li>' + icon('box') + '<span><b>Stock real</b><small>Lo que ves disponible ya fue recibido y revisado en el depósito</small></span></li>' +
      '<li>' + icon('tag') + '<span><b>Precio fijo</b><small>El precio queda confirmado en el momento de tu pedido</small></span></li>' +
      '<li>' + icon('truck') + '<span><b>Seguimiento</b><small>Ves cada etapa: reservado, en preparación, despachado y entregado</small></span></li></ul>';
    var catGrid = !cats.length ? '' :
      '<div class="section-title"><div><p class="eyebrow">Categorías</p><h2>Encontrá lo que buscás</h2></div><a class="more" href="#/tienda">Ver toda la tienda →</a></div><div class="cats">' +
      cats.map(function (k) {
        return '<a class="cat" href="#/tienda/' + encodeURIComponent(k.name) + '"><span><b>' + esc(k.name) + '</b><small>' + plural(k.count, 'producto', 'productos') + '</small></span>' +
          '<span class="pic">' + (k.photo ? '<img src="' + esc(k.photo) + '" alt="" loading="lazy">' : '<img class="ph" src="assets/logo-yvy.jpg" alt="">') + '</span></a>';
      }).join('') + '</div>';
    var products = '<div class="section-title"><div><p class="eyebrow">Destacados</p><h2>Para conocer y probar</h2></div><a class="more" href="#/tienda">Ver todos →</a></div>' +
      (shop.length ? '<div class="pgrid">' + featured.map(function (p) { return productCard(p, c.lines[p.sku] || 0, 'h3'); }).join('') + '</div>' : '<p class="empty">Todavía no hay productos en la tienda.</p>');
    var recs = allRecipes(shop);
    var recipes = !recs.length ? '' : '<div class="section-title"><div><p class="eyebrow">Recetas</p><h2>Ideas para cocinar con nuestros productos</h2></div></div>' +
      '<div class="rgrid">' + recs.slice(0, 6).map(function (x) { return recipeCard(x.r, x.p); }).join('') + '</div>';
    var how = '<section class="band"><p class="eyebrow">Cómo comprar</p><h2>Tu almacén abastecido en tres pasos</h2><ol class="steps3">' +
      '<li><b>Pedí tu cuenta</b><span>Yvy Guaraní registra tu almacén y te da un usuario para ingresar.</span></li>' +
      '<li><b>Armá tu pedido</b><span>Elegí productos con precio y disponibilidad real, desde el celular o la computadora.</span></li>' +
      '<li><b>Seguilo hasta tu puerta</b><span>Al confirmar, el stock queda reservado. Ves cuándo se prepara, sale y se entrega.</span></li></ol></section>';
    var coops = orgs('cooperativa').filter(function (o) { return o.active !== false; });
    var nav = NAV[a.role] || [];
    var foot = '<footer class="sitefoot"><div class="cols"><div><p class="brandline"><img src="assets/logo-yvy.jpg" alt="">' + esc(storeName()) + '</p>' +
      '<p>Una iniciativa de Yvy Guaraní S.A. para acercar la producción de las cooperativas a los almacenes de barrio.</p></div>' +
      '<div><h3>Tienda</h3><ul>' + nav.filter(function (n) { return n[0] !== 'inicio'; }).slice(0, 5).map(function (n) { return '<li><a href="#/' + n[0] + '">' + esc(n[1]) + '</a></li>'; }).join('') + '</ul></div>' +
      '<div><h3>Categorías</h3><ul>' + cats.slice(0, 6).map(function (k) { return '<li><a href="#/tienda/' + encodeURIComponent(k.name) + '">' + esc(k.name) + '</a></li>'; }).join('') + '</ul></div>' +
      '<div><h3>Cooperativas</h3><ul>' + coops.map(function (o) { return '<li>' + esc(o.name) + '</li>'; }).join('') + '</ul></div></div>' +
      '<p class="legal"><span>© ' + new Date().getFullYear() + ' Yvy Guaraní S.A.</span><span>Fotos de productos: Ecoagro.</span></p></footer>';
    return hero + trust + catGrid + products + recipes + how + foot + cartBar(shop);
  }

  function pageTienda() {
    var shop = D.storefront(state, today());
    var c = isBuyer() ? cart() : { lines: {} };
    var cats = categoriesOf(shop);
    var current = route().param;
    var inCat = cats.some(function (k) { return k.name === current; }) ? current : '';
    var side = '<aside class="shop-side" aria-label="Categorías"><p class="side-title">Categorías</p><ul>' +
      '<li><a href="#/tienda"' + (!inCat ? ' aria-current="true"' : '') + '>Todo<span>' + shop.length + '</span></a></li>' +
      cats.map(function (k) { return '<li><a href="#/tienda/' + encodeURIComponent(k.name) + '"' + (k.name === inCat ? ' aria-current="true"' : '') + '>' + esc(k.name) + '<span>' + k.count + '</span></a></li>'; }).join('') +
      '</ul></aside>';
    var chips = '<div class="chips shop-chips" role="group" aria-label="Filtrar por categoría"><button class="chip" type="button" data-act="shop-cat" data-id="" aria-pressed="' + !inCat + '">Todo</button>' +
      cats.map(function (k) { return '<button class="chip" type="button" data-act="shop-cat" data-id="' + esc(k.name) + '" aria-pressed="' + (k.name === inCat) + '">' + esc(k.name) + '</button>'; }).join('') + '</div>';
    var bar = '<div class="shopbar"><label class="search"><span class="sr-only">Buscar producto</span>' + icon('search') +
      '<input type="search" id="shop-search" placeholder="Buscar producto, categoría o marca" autocomplete="off"></label>' +
      '<label class="sort"><span class="sr-only">Ordenar</span><select id="shop-sort"><option value="">Destacados</option><option value="name">Nombre A–Z</option>' +
      (isBuyer() || isStaff() ? '<option value="av">Disponibles primero</option>' : '') + '</select></label></div>';
    var banner = '<section class="shop-head"><div><p class="eyebrow">Tienda</p><h1>' + esc(inCat || 'Todos los productos') + '</h1>' +
      '<p class="muted"><span id="shop-count">' + plural(inCat ? cats.filter(function (k) { return k.name === inCat; })[0].count : shop.length, 'producto', 'productos') + '</span> de cooperativas paraguayas' +
      (actor().role === 'visitante' ? ' · Ingresá con tu cuenta de almacén para ver precios y pedir.' : '.') + '</p></div></section>';
    return banner + '<div class="shop-layout">' + side + '<div class="shop-main">' + bar + chips +
      (shop.length ? '<div class="pgrid" id="shop-grid">' + shop.map(function (p) { return productCard(p, c.lines[p.sku] || 0); }).join('') + '</div>' +
        '<p class="empty" id="shop-none" hidden>Ningún producto coincide con la búsqueda.</p>' : '<p class="empty">Todavía no hay productos en la tienda.</p>') +
      '</div></div>' + cartBar(shop);
  }

  function recipeBlock(r, shop) {
    var uses = (r.uses || []).map(function (sku) { var x = shop.filter(function (p) { return p.sku === sku; })[0]; return x ? '<a href="#/producto/' + encodeURIComponent(x.sku) + '">' + esc(x.name) + '</a>' : ''; }).filter(Boolean);
    return '<article class="recipe"><div class="recipe-head"><p class="eyebrow">' + icon('chef') + 'Receta</p><h3>' + esc(r.title) + '</h3>' +
      '<p class="chips">' + (r.minutes ? '<span class="badge">' + icon('clock') + r.minutes + ' min</span>' : '') + (r.servings ? '<span class="badge">' + r.servings + ' porciones</span>' : '') + '</p></div>' +
      '<div class="recipe-body"><div><h4>Ingredientes</h4><ul class="ingr">' + r.ingredients.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '<div><h4>Preparación</h4><ol class="stepsl">' + r.steps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol></div></div>' +
      (uses.length ? '<p class="small muted">También usa: ' + uses.join(', ') + '</p>' : '') + '</article>';
  }

  function pageProducto() {
    var sku = route().param;
    var shop = D.storefront(state, today());
    var p = null;
    shop.forEach(function (x) { if (x.sku === sku) p = x; });
    if (!p) return '<nav class="trail" aria-label="Ruta"><a href="#/inicio">Inicio</a><span>/</span><a href="#/tienda">Tienda</a></nav><p class="empty">Este producto no está en la tienda por ahora.</p>';
    var q = isBuyer() ? cart().lines[p.sku] || 0 : 0;
    var trail = '<nav class="trail" aria-label="Ruta"><a href="#/inicio">Inicio</a><span>/</span><a href="#/tienda">Tienda</a><span>/</span>' +
      '<a href="#/tienda/' + encodeURIComponent(p.category) + '">' + esc(p.category) + '</a><span>/</span><span>' + esc(p.name) + '</span></nav>';
    var claims = p.claims && p.claims.length ? '<div class="claims"><p class="small muted">Según declara el proveedor:</p><p class="chips">' +
      p.claims.map(function (c) { return '<span class="badge ok">' + esc(c) + '</span>'; }).join('') + '</p></div>' : '';
    var buy = buyControls(p, q, false);
    if (isBuyer() && q > 0) buy += '<a class="btn primary lg" href="#/mi-pedido">' + icon('cart') + 'Ver mi pedido · ' + gs(q * p.price) + '</a>';
    var margin = isBuyer() && p.price !== null && p.suggestedPrice !== null && p.suggestedPrice > p.price
      ? '<p class="small muted">Precio sugerido de venta al público: ' + gs(p.suggestedPrice) + '. El precio final lo decide cada almacén.</p>' : '';
    var assure = '<ul class="assure">' + ['Disponibilidad real: lo que ves está recibido en el depósito', 'El precio queda fijo al confirmar el pedido',
      'Origen: ' + p.origin + (p.originDetail ? ' · ' + p.originDetail : '')].map(function (x) { return '<li>' + icon('check') + '<span>' + esc(x) + '</span></li>'; }).join('') + '</ul>';
    var spec = [['Presentación', p.presentation], ['Se vende por', D.unitLabel(p.unit, 1) + (p.unitNote ? ' (' + p.unitNote + ')' : '')], ['Categoría', p.category],
      ['Cooperativa', p.origin], ['Origen', p.originDetail || '—'], ['Código', p.sku]]
      .concat(isBuyer() || isStaff() ? [['Disponible hoy', p.orderable ? qty(p.available, p.unit) : '—'], ['Vence el lote que sale primero', p.orderable && p.available > 0 && p.nextExpiry ? fdate(p.nextExpiry) : '—']] : [])
      .map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
    var editHint = can('producto.guardar') ? '<p class="small"><button class="btn sm" type="button" data-act="editar-producto" data-id="' + esc(p.sku) + '">Editar ficha, foto, video y recetas</button></p>' : '';
    var sections = '<section class="pd-section"><h2>Sobre el producto</h2><p>' + esc(p.description || 'Descripción en preparación.') + '</p></section>' +
      (p.story ? '<section class="pd-section story"><h2>Historia</h2><p>' + esc(p.story) + '</p></section>' : '') +
      (p.video ? '<section class="pd-section"><h2>Video</h2>' + videoBox(p) + '</section>' : '') +
      (p.recipes && p.recipes.length ? '<section class="pd-section"><h2>' + (p.recipes.length > 1 ? 'Recetas' : 'Receta') + '</h2>' + p.recipes.map(function (r) { return recipeBlock(r, shop); }).join('') + '</section>' : '') +
      '<section class="pd-section"><h2>Ficha</h2><dl class="spec">' + spec + '</dl></section>';
    var rel = shop.filter(function (x) { return x.sku !== p.sku && x.category === p.category; }).slice(0, 4);
    var c = isBuyer() ? cart() : { lines: {} };
    var related = rel.length ? '<div class="section-title"><div><h2>Productos relacionados</h2></div><a class="more" href="#/tienda/' + encodeURIComponent(p.category) + '">Ver ' + esc(p.category.toLowerCase()) + ' →</a></div>' +
      '<div class="pgrid">' + rel.map(function (x) { return productCard(x, c.lines[x.sku] || 0, 'h3'); }).join('') + '</div>' : '';
    return trail + '<div class="pdp"><div class="gallery">' + photoBox(p, false) + '</div>' +
      '<div class="buy"><div><p class="eyebrow">' + esc(p.category) + ' · ' + esc(p.origin) + '</p><h1>' + esc(p.name) + '</h1><p class="muted">' + esc(p.presentation) +
      (p.originDetail ? ' · ' + esc(p.originDetail) : '') + '</p></div>' +
      '<div class="price-row">' + priceHtml(p, true) + (p.orderable && actor().role !== 'visitante' ? availBadge(p) : '') + '</div>' + margin + claims +
      '<div class="buy-actions">' + buy + '</div>' + assure + editHint + '</div></div>' +
      '<div class="pd-sections">' + sections + '</div>' + related + cartBar(shop);
  }

  function pageMiPedido() {
    var shop = D.storefront(state, today());
    var c = cart();
    var chosen = shop.filter(function (p) { return (c.lines[p.sku] || 0) > 0 && p.orderable; });
    if (!chosen.length) {
      return head('Mi pedido') + '<p class="empty">Tu pedido está vacío. <a href="#/tienda">Ir a la tienda</a></p>';
    }
    var subtotal = 0;
    var problem = false;
    var lines = chosen.map(function (p) {
      var q = c.lines[p.sku];
      subtotal += q * p.price;
      if (q > p.available) problem = true;
      return '<article class="card"><div class="row between"><div><h2>' + esc(p.name) + '</h2><p class="small muted">' + esc(p.presentation) + ' · ' + gs(p.price) + ' por ' + esc(D.unitLabel(p.unit, 1)) + '</p></div>' +
        '<b class="num">' + gs(q * p.price) + '</b></div><div style="margin-top:8px">' + qtyControl(p, q) + '</div>' +
        (q > p.available ? '<p class="note bad small" style="margin-top:8px">Hay ' + qty(p.available, p.unit) + ' disponibles. Bajá la cantidad o el pedido completo será rechazado.</p>' : '') +
        '</article>';
    }).join('');
    var fee = state.settings.deliveryFee;
    return head('Mi pedido', 'Revisá cantidades y confirmá. Al confirmar se reserva el stock y se fijan estos precios.') +
      '<div class="stack">' + lines +
      '<section class="card"><h2>Entrega</h2><div class="form">' +
      field('Entrega deseada: desde', input('windowFrom', 'date', c.windowFrom, 'data-cart-field="windowFrom" min="' + today() + '"'), 'Opcional') +
      field('Hasta', input('windowTo', 'date', c.windowTo, 'data-cart-field="windowTo" min="' + today() + '"'), 'Opcional') +
      field('Observaciones', '<textarea name="notes" data-cart-field="notes">' + esc(c.notes) + '</textarea>', 'Opcional. Horarios, referencias del local.', 'wide') +
      '</div></section>' +
      '<section class="card"><h2>Total</h2>' + totalsHtml({ subtotal: subtotal, deliveryFee: fee, total: subtotal + (fee || 0) }) +
      '<p class="small muted" style="margin-top:6px">El pago y la factura se coordinan con Yvy Guaraní al momento de la entrega.</p>' +
      (problem ? '<p class="note bad" style="margin-top:10px">Hay productos con más cantidad que la disponible. No se reserva en forma parcial: corregí las cantidades para confirmar.</p>' : '') +
      '<div class="form-error" role="alert" id="cart-error" style="margin-top:10px"></div>' +
      '<div class="actions" style="margin-top:12px"><button class="btn primary" type="button" data-act="cart-confirm">Confirmar pedido</button>' +
      '<button class="btn" type="button" data-act="cart-clear">Vaciar</button></div></section></div>';
  }
  function pageMisPedidos() {
    return head('Mis pedidos', 'Estado de cada pedido de ' + esc(orgName(actor().orgId)) + '.') +
      orderList(D.visibleOrders(state, actor()), 'Todavía no hiciste pedidos.');
  }
  function demandForm(internal) {
    var a = actor();
    var t = today();
    return '<form class="form" data-form="demanda" novalidate>' +
      (internal ? field('Almacén', select('almacenId', orgs('almacen').map(function (o) { return [o.id, o.name]; }), '')) : '') +
      field('Producto', select('sku', productOptions(function (p) { return p.status !== 'inactivo'; }, true), '', 'data-unit-source required')) +
      field('Cantidad', input('qty', 'number', '', 'min="1" step="1" inputmode="numeric" required')) +
      field('Unidad', select('unit', unitOptions(), 'paquete', 'data-unit-target')) +
      field('Lo necesito desde', input('windowFrom', 'date', D.addDays(t, 1), 'required')) +
      field('Hasta', input('windowTo', 'date', D.addDays(t, 7), 'required')) +
      field('Tipo', select('kind', [['interes', 'Interés (sin compromiso)'], ['pedido_firme', 'Pedido firme a futuro']], 'interes'), 'Ninguno de los dos reserva stock.') +
      field('Observaciones', input('notes', 'text', ''), 'Opcional', 'wide') +
      '<div class="form-error" role="alert"></div>' +
      '<div class="actions wide"><button class="btn primary" type="submit">Registrar ' + (a.role === 'almacen' ? 'interés' : 'demanda') + '</button></div></form>';
  }
  function demandRows(list, internal) {
    return list.slice().reverse().map(function (x) {
      var cells = [];
      if (internal) cells.push(esc(orgName(x.almacenId)));
      cells.push('<b>' + esc(prodName(x.sku)) + '</b>', esc(qty(x.qty, x.unit)), win(x.windowFrom, x.windowTo), badge(D.DEMAND_KIND[x.kind], x.kind === 'pedido_firme' ? 'info' : ''),
        esc(x.notes), x.anulada ? badge('Anulada', 'bad') : '<button class="btn sm" type="button" data-act="anular-demanda" data-id="' + x.id + '">Anular</button>');
      return cells;
    });
  }
  function pageMiInteres() {
    return head('Avisar interés', 'Contanos qué te gustaría comprar y para cuándo. Sirve para planificar con las cooperativas: no es un pedido y no reserva stock.') +
      '<div class="stack"><section class="card"><h2>Nuevo aviso</h2>' + demandForm(false) + '</section>' +
      '<section><h2 style="margin-bottom:8px">Mis avisos</h2>' +
      table(['Producto', 'Cantidad', 'Ventana', 'Tipo', 'Observaciones', ''], demandRows(D.visibleDemands(state, actor()), false), 'Todavía no registraste avisos.') + '</section></div>';
  }

  // ---------- páginas: cooperativa ----------

  function offerForm(internal) {
    var a = actor();
    var t = today();
    var filter = internal
      ? function (p) { return p.status !== 'inactivo'; }
      : function (p) { return p.status !== 'inactivo' && (!p.coopId || p.coopId === a.orgId); };
    return '<form class="form" data-form="oferta" novalidate>' +
      (internal ? field('Cooperativa', select('coopId', orgs('cooperativa').map(function (o) { return [o.id, o.name]; }), '')) : '') +
      field('Producto', select('sku', productOptions(filter, true), '', 'data-unit-source required')) +
      field('Cantidad', input('qty', 'number', '', 'min="1" step="1" inputmode="numeric" required')) +
      field('Unidad', select('unit', unitOptions(), 'paquete', 'data-unit-target')) +
      field('Disponible desde', input('windowFrom', 'date', D.addDays(t, 1), 'required')) +
      field('Hasta', input('windowTo', 'date', D.addDays(t, 7), 'required')) +
      field('Tipo', select('kind', [['disponible', 'Disponible ahora'], ['capacidad', 'Capacidad futura (puede producirse)']], 'disponible')) +
      field('Nivel de confirmación', select('confirmation', [['estimacion', 'Estimación'], ['probable', 'Probable'], ['confirmada', 'Confirmada por la cooperativa']], 'estimacion')) +
      field('Origen', input('origin', 'text', ''), 'Opcional. Comité, zona o finca de origen.') +
      field('Observaciones', input('notes', 'text', ''), 'Opcional') +
      '<div class="form-error" role="alert"></div>' +
      '<div class="actions wide"><button class="btn primary" type="submit">Registrar oferta</button></div></form>';
  }
  function offerRows(list, internal) {
    return list.slice().reverse().map(function (o) {
      var cells = [];
      if (internal) cells.push(esc(orgName(o.coopId)));
      cells.push('<b>' + esc(prodName(o.sku)) + '</b>', esc(qty(o.qty, o.unit)), win(o.windowFrom, o.windowTo), esc(D.OFFER_KIND[o.kind]),
        badge(D.OFFER_CONFIRMATION[o.confirmation], o.confirmation === 'confirmada' ? 'ok' : o.confirmation === 'probable' ? 'info' : ''),
        esc([o.origin, o.notes].filter(Boolean).join(' · ')),
        o.anulada ? badge('Anulada', 'bad') : '<button class="btn sm" type="button" data-act="anular-oferta" data-id="' + o.id + '">Anular</button>');
      return cells;
    });
  }
  function pageMiOferta() {
    return head('Mi oferta', 'Informá lo que ' + esc(orgName(actor().orgId)) + ' tiene o puede producir. Es información para planificar: el stock recién existe cuando el depósito recibe y verifica la mercadería.') +
      '<div class="stack"><section class="card"><h2>Nueva oferta</h2>' + offerForm(false) + '</section>' +
      '<section><h2 style="margin-bottom:8px">Ofertas informadas</h2>' +
      table(['Producto', 'Cantidad', 'Ventana', 'Tipo', 'Confirmación', 'Origen y notas', ''], offerRows(D.visibleOffers(state, actor()), false), 'Todavía no informaste ofertas.') + '</section></div>';
  }
  function pageLoRecibido() {
    var rows = D.visibleLots(state, actor()).slice().reverse().map(function (l) {
      var p = D.productOf(state, l.sku);
      return ['<b>' + esc(p.name) + '</b>', esc(l.code), fdate(l.receivedDate), l.declaredQty === null ? '—' : esc(qty(l.declaredQty, p.stockUnit)), esc(qty(l.receivedQty, p.stockUnit)),
        l.discrepancyNote ? esc(l.discrepancyNote) : '', l.bloqueado > 0 ? badge(l.bloqueado + ' en observación', 'warn') + ' ' + esc(l.blockReason) : badge('Sin observaciones', 'ok')];
    });
    return head('Lo recibido', 'Lo que el depósito recibió y verificó de ' + esc(orgName(actor().orgId)) + ', lote por lote.') +
      table(['Producto', 'Lote', 'Fecha', 'Declarado', 'Recibido', 'Diferencia', 'Control'], rows, 'El depósito todavía no registró recepciones de esta cooperativa.');
  }
  function pageMisProductos() {
    var rows = D.coopProducts(state, actor()).map(function (p) {
      return ['<b>' + esc(p.name) + '</b>', esc(p.sku), esc(p.presentation), esc(D.UNITS[p.stockUnit].many), esc(p.category),
        p.own ? badge(D.PRODUCT_STATUS[p.status], p.status === 'activo' ? 'ok' : '') : badge('Línea potencial, origen por definir')];
    });
    return head('Mis productos', 'Productos de la cooperativa en el catálogo y líneas potenciales abiertas. Los precios internos de la distribuidora no se muestran aquí.') +
      table(['Producto', 'SKU', 'Presentación', 'Unidad', 'Categoría', 'Estado'], rows, 'No hay productos asociados.');
  }

  // ---------- páginas internas ----------

  function stockLine(s, unit) {
    return '<div class="stockline"><span>Disponible <b>' + s.disponible + '</b></span><span>Reservado <b>' + s.reservado + '</b></span><span>Bloqueado <b>' + s.bloqueado + '</b></span>' +
      (s.vencido ? '<span>Vencido <b>' + s.vencido + '</b></span>' : '') + '<span>Físico <b>' + s.fisico + '</b></span><span class="muted">' + esc(D.UNITS[unit].many) + '</span></div>';
  }
  // ---------- panel de gestión ----------

  /** Ventas, márgenes y valores en guaraníes: solo Comercial y Administración. */
  function seesFinance() { var r = actor().role; return r === 'comercial' || r === 'admin'; }
  var PERIODS = [['1', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['custom', 'Personalizado']];
  var WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  function periodRange() {
    var t = today();
    if (ui.period === 'custom' && D.isDate(ui.pFrom) && D.isDate(ui.pTo) && ui.pFrom <= ui.pTo) return { from: ui.pFrom, to: ui.pTo };
    var n = Number(ui.period) || 30;
    return { from: D.addDays(t, -(n - 1)), to: t };
  }
  function ddmm(day) { return day.slice(8, 10) + '/' + day.slice(5, 7); }
  function weekday(day) {
    var p = day.split('-').map(Number);
    return WEEKDAYS[new Date(p[0], p[1] - 1, p[2]).getDay()];
  }
  function bucketLabel(b, weekly) {
    return weekly ? 'Semana del ' + ddmm(b.from) + ' al ' + ddmm(b.to) : weekday(b.from) + ' ' + ddmm(b.from);
  }
  /** Montos abreviados para el eje: "1,2 M", "850 mil". */
  function shortGs(n) {
    if (n >= 1e6) return String(Math.round(n / 1e5) / 10).replace('.', ',') + ' M';
    if (n >= 1e3) return Math.round(n / 1e3) + ' mil';
    return String(n);
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }
  function hoursTxt(h) {
    if (h === null || h === undefined) return 'Sin datos';
    if (h < 48) return Math.max(1, Math.round(h)) + ' h';
    return String(Math.round(h / 2.4) / 10).replace('.', ',') + ' días';
  }
  function plural(n, one, many) { return D.fmtInt(n) + ' ' + (n === 1 ? one : many); }

  /** Variación contra el período anterior, con signo y palabras (nunca solo color). */
  function delta(cur, prev, goodUp, points) {
    if (cur === null || prev === null || cur === undefined || prev === undefined) return '<span class="delta">Sin comparación posible</span>';
    if (points) {
      var pp = (cur - prev) * 100;
      if (Math.abs(pp) < 0.05) return '<span class="delta">Igual que el período anterior</span>';
      return '<span class="delta ' + ((pp > 0) === goodUp ? 'up' : 'down') + '">' + (pp > 0 ? '▲ +' : '▼ −') + String(Math.abs(pp).toFixed(1)).replace('.', ',') + ' p. p. vs. período anterior</span>';
    }
    if (prev === 0) return '<span class="delta">' + (cur === 0 ? 'Igual que el período anterior' : 'Sin actividad en el período anterior') + '</span>';
    var d = (cur - prev) / prev;
    if (Math.abs(d) < 0.005) return '<span class="delta">Igual que el período anterior</span>';
    return '<span class="delta ' + ((d > 0) === goodUp ? 'up' : 'down') + '">' + (d > 0 ? '▲ +' : '▼ −') + String(Math.abs(d * 100).toFixed(0)) + ' % vs. período anterior</span>';
  }
  function mkpi(ic, label, value, deltaHtml, note, tone) {
    return '<div class="mkpi ' + (tone || '') + '"><p class="mkpi-l">' + icon(ic) + '<span>' + label + '</span></p><b class="mkpi-v">' + value + '</b>' +
      (deltaHtml || '') + (note ? '<small>' + note + '</small>' : '') + '</div>';
  }

  /** Gráfico de columnas en HTML: una serie, eje Y con 3 líneas, aviso al pasar el mouse o con el teclado, y tabla equivalente. */
  function columnChart(series, weekly, key, fmtVal, title) {
    var max = 0;
    series.forEach(function (b) { if (b[key] > max) max = b[key]; });
    if (!max) return '<p class="empty">Sin ' + (key === 'ventas' ? 'ventas' : 'pedidos') + ' confirmados en el período.</p>';
    var top = key === 'pedidos' ? Math.max(2, Math.ceil(max / 2) * 2) : niceMax(max);
    var axis = function (v) { return key === 'ventas' ? shortGs(v) : String(v); };
    var n = series.length;
    var every = Math.ceil(n / 8);
    var grid = [1, 0.5, 0].map(function (f) {
      return '<span class="gl" style="bottom:' + (f * 100) + '%"><em>' + axis(top * f) + '</em></span>';
    }).join('');
    var cols = series.map(function (b, i) {
      var tip = bucketLabel(b, weekly) + '\n' + fmtVal(b[key]) + (key === 'ventas' ? ' · ' + plural(b.pedidos, 'pedido', 'pedidos') : '');
      var pos = i < n / 3 ? 'l' : i >= (2 * n) / 3 ? 'r' : 'c';
      return '<div class="col ' + pos + '" role="listitem" tabindex="0" data-tip="' + esc(tip) + '" aria-label="' + esc(tip.replace('\n', ': ')) + '">' +
        '<i style="height:' + ((b[key] / top) * 100).toFixed(2) + '%"></i></div>';
    }).join('');
    var xs = series.map(function (b, i) { return '<span>' + (i % every === 0 ? ddmm(b.from) : '') + '</span>'; }).join('');
    var tableRows = series.map(function (b) { return [bucketLabel(b, weekly), fmtVal(b[key]), String(b.pedidos)]; });
    return '<figure class="chart"><div class="chart-plot"><div class="chart-grid" aria-hidden="true">' + grid + '</div>' +
      '<div class="chart-cols" role="list" aria-label="' + esc(title) + '" style="grid-template-columns:repeat(' + n + ',minmax(0,1fr))">' + cols + '</div></div>' +
      '<div class="chart-x" aria-hidden="true" style="grid-template-columns:repeat(' + n + ',minmax(0,1fr))">' + xs + '</div>' +
      (key === 'ventas' ? '<figcaption class="small muted">Eje en guaraníes. Pasá el mouse o el foco por una columna para ver el detalle.</figcaption>' : '') + '</figure>' +
      '<details class="tview"><summary class="small">Ver como tabla</summary>' +
      (key === 'ventas' ? table([weekly ? 'Semana' : 'Día', 'Ventas', 'Pedidos'], tableRows, 'Sin datos.') : table([weekly ? 'Semana' : 'Día', 'Pedidos'], tableRows.map(function (r) { return [r[0], r[2]]; }), 'Sin datos.')) + '</details>';
  }

  /** Barras horizontales para rankings: valor como texto al lado, barra como apoyo. */
  function hbars(rows, valueOf, valueTxt, nameOf, subOf, empty) {
    if (!rows.length) return '<p class="muted small">' + empty + '</p>';
    var max = Math.max.apply(null, rows.map(valueOf)) || 1;
    return '<ul class="hbars">' + rows.map(function (r) {
      return '<li><div class="hb-top"><span class="hb-name">' + nameOf(r) + '</span><b class="hb-val">' + valueTxt(r) + '</b></div>' +
        '<div class="hb-track" aria-hidden="true"><i style="width:' + Math.max(2, (valueOf(r) / max) * 100).toFixed(1) + '%"></i></div>' +
        (subOf ? '<small>' + subOf(r) + '</small>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function csvDownload(name, headers, rows) {
    var cell = function (v) {
      var s = v === null || v === undefined ? '' : String(v);
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var text = '﻿' + [headers].concat(rows).map(function (r) { return r.map(cell).join(';'); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function csvButton(id) {
    return '<button class="btn sm" type="button" data-act="csv" data-id="' + id + '" title="Descargar como planilla CSV">CSV</button>';
  }
  function exportCsv(id) {
    var r = periodRange();
    var a = D.analytics(state, r.from, r.to, today());
    var fin = seesFinance();
    var name = 'yvy-' + id + '-' + r.from + '-a-' + r.to + '.csv';
    var unit = function (u, n) { return D.unitLabel(u, n === undefined ? 2 : n); };
    if (id === 'ventas') {
      csvDownload(name, ['Desde', 'Hasta', fin ? 'Ventas (Gs.)' : null, 'Pedidos'].filter(Boolean), a.series.map(function (b) {
        return [b.from, b.to].concat(fin ? [b.ventas] : []).concat([b.pedidos]);
      }));
    } else if (id === 'productos') {
      csvDownload(name, ['SKU', 'Producto', 'Unidad', 'Cantidad', 'Pedidos'].concat(fin ? ['Ventas (Gs.)'] : []), a.products.map(function (p) {
        return [p.sku, p.name, unit(p.unit), p.qty, p.pedidos].concat(fin ? [p.ventas] : []);
      }));
    } else if (id === 'almacenes') {
      csvDownload(name, ['Almacén', 'Pedidos', 'Último pedido'].concat(fin ? ['Ventas (Gs.)'] : []), a.almacenes.map(function (x) {
        return [x.name, x.pedidos, D.localDate(new Date(x.ultimo))].concat(fin ? [x.ventas] : []);
      }));
    } else if (id === 'faltantes') {
      csvDownload(name, ['SKU', 'Producto', 'Unidad', 'Faltante', 'Veces'].concat(fin ? ['Valor estimado (Gs.)'] : []), a.lostByProduct.map(function (x) {
        return [x.sku, x.name, unit(x.unit), x.missing, x.veces].concat(fin ? [x.sinPrecio ? '' : x.valor] : []);
      }));
    } else if (id === 'stock') {
      csvDownload('yvy-stock-' + today() + '.csv', ['SKU', 'Producto', 'Unidad', 'Disponible', 'Reservado', 'Bloqueado', 'Vencido', 'Físico', 'Salidas 30 días', 'Cobertura (días)'].concat(fin ? ['Valor a costo vigente (Gs.)'] : []), a.stock.map(function (x) {
        var s = x.s;
        return [x.product.sku, x.product.name, unit(x.product.stockUnit), s.disponible, s.reservado, s.bloqueado, s.vencido, s.fisico, x.salida30, x.coberturaDias === null ? '' : x.coberturaDias].concat(fin ? [x.valor === null ? '' : x.valor] : []);
      }));
    }
    toast('Planilla descargada: ' + name);
  }

  function pagePanel() {
    var t = today();
    var fin = seesFinance();
    var range = periodRange();
    var a = D.analytics(state, range.from, range.to, t);
    var c = a.cur, p = a.prev;
    var dash = D.dashboard(state, t);
    var by = dash.ordersByStatus;
    var everConfirmed = state.orders.some(function (o) { return o.confirmedAt; });

    // Aviso de datos: escenario de demostración o panel todavía sin historia.
    var notice = '';
    if (state.demo) {
      notice = '<p class="note warn">Escenario de demostración: ' + state.demo.weeks + ' semanas de actividad <b>ficticia</b> (desde el ' + fdate(state.demo.from) +
        '), generada con las mismas reglas del sistema. No es una proyección ni un volumen esperado.' +
        (can('config.actualizar') ? ' Para volver a los datos iniciales, usá Configuración.' : '') + '</p>';
    } else if (!everConfirmed) {
      notice = '<div class="note"><p><b>Todavía no hay pedidos confirmados.</b> Los gráficos se llenan a medida que se registran ventas y entregas.</p>' +
        (can('config.actualizar')
          ? '<div class="actions" style="margin-top:8px"><button class="btn sm" type="button" data-act="demo">Cargar escenario de demostración…</button></div>'
          : '<p class="small" style="margin-top:4px">Administración puede cargar un escenario de demostración desde Configuración.</p>') + '</div>';
    }

    var chips = '<div class="chips" role="group" aria-label="Período">' + PERIODS.map(function (x) {
      return '<button class="chip" type="button" data-act="periodo" data-id="' + x[0] + '" aria-pressed="' + ((ui.period || '30') === x[0]) + '">' + x[1] + '</button>';
    }).join('') + '</div>';
    var custom = ui.period === 'custom'
      ? '<form class="range" data-form="periodo" novalidate>' + field('Desde', input('from', 'date', range.from, 'max="' + t + '"')) + field('Hasta', input('to', 'date', range.to, 'max="' + t + '"')) +
        '<button class="btn sm primary" type="submit">Aplicar</button><div class="form-error" role="alert"></div></form>'
      : '';
    var periodBar = '<div class="periodbar">' + chips + custom + '<p class="small muted">' + (a.days === 1 ? fdate(a.from) : 'Del ' + fdate(a.from) + ' al ' + fdate(a.to)) +
      ' · comparado con ' + (a.days === 1 ? fdate(a.prevFrom) : 'el ' + fdate(a.prevFrom) + ' al ' + fdate(a.prevTo)) + '</p></div>';

    var kpis = fin
      ? mkpi('tag', 'Ventas', gs(c.ventas), delta(c.ventas, p.ventas, true), 'Pedidos confirmados y no cancelados, sin costo de entrega.') +
        mkpi('list', 'Pedidos', D.fmtInt(c.pedidos), delta(c.pedidos, p.pedidos, true), 'Ticket medio: ' + (c.ticket === null ? 'Sin datos' : gs(c.ticket))) +
        mkpi('chart', 'Margen realizado', c.margen === null ? 'Sin datos' : pct(c.margen), delta(c.margen, p.margen, true, true),
          c.margen === null ? 'Sin entregas con costo registrado en el período.' : 'Ganancia bruta ' + gs(c.gananciaBruta) + ' sobre pedidos entregados' +
          (c.coberturaMargen < 0.995 ? ' (calculado sobre el ' + pct(c.coberturaMargen) + ' de lo entregado; el resto no tiene costo cargado)' : '') + '.',
          c.margen === null ? 'warn' : '') +
        mkpi('alert', 'Ventas perdidas', gs(c.ventasPerdidas), delta(c.ventasPerdidas, p.ventasPerdidas, false),
          plural(c.faltantes, 'pedido', 'pedidos') + ' con faltante de stock. Estimado al precio de ese momento' + (c.ventasPerdidasIncompleto ? '; hay productos sin precio' : '') + '.',
          c.faltantes ? 'warn' : '')
      : mkpi('list', 'Pedidos confirmados', D.fmtInt(c.confirmados), delta(c.confirmados, p.confirmados, true), plural(c.cancelados, 'cancelado', 'cancelados') + ' en el período.') +
        mkpi('truck', 'Pedidos entregados', D.fmtInt(c.entregados), delta(c.entregados, p.entregados, true), plural(c.despachados, 'despacho', 'despachos') + ' en el período.') +
        mkpi('clock', 'Hasta el despacho', hoursTxt(c.horasHastaDespacho), '', 'Promedio desde la confirmación.') +
        mkpi('alert', 'Pedidos con faltante', D.fmtInt(c.faltantes), delta(c.faltantes, p.faltantes, false), 'Intentos que no se pudieron reservar por falta de stock.', c.faltantes ? 'warn' : '');

    var chartCard = '<section class="card"><div class="card-head"><div><h2>' + (fin ? 'Ventas' : 'Pedidos confirmados') + ' por ' + (a.weekly ? 'semana' : 'día') + '</h2>' +
      '<p class="small muted">Por fecha de confirmación. Los cancelados no cuentan.</p></div>' + csvButton('ventas') + '</div>' +
      columnChart(a.series, a.weekly, fin ? 'ventas' : 'pedidos', fin ? gs : function (n) { return plural(n, 'pedido', 'pedidos'); }, (fin ? 'Ventas' : 'Pedidos') + ' por ' + (a.weekly ? 'semana' : 'día')) + '</section>';

    var totalVentas = c.ventas || 1;
    var prodCard = '<section class="card"><div class="card-head"><h2>Productos más vendidos</h2>' + csvButton('productos') + '</div>' +
      hbars(a.products.slice(0, 6), fin ? function (r) { return r.ventas; } : function (r) { return r.qty; },
        fin ? function (r) { return gs(r.ventas); } : function (r) { return qty(r.qty, r.unit); },
        function (r) { return esc(r.name); },
        function (r) { return esc(qty(r.qty, r.unit)) + ' · ' + plural(r.pedidos, 'pedido', 'pedidos') + (fin ? ' · ' + pct(r.ventas / totalVentas) + ' de las ventas' : ''); },
        'Sin ventas en el período.') + '</section>';
    var almCard = '<section class="card"><div class="card-head"><h2>Almacenes</h2>' + csvButton('almacenes') + '</div>' +
      hbars(a.almacenes.slice(0, 6), fin ? function (r) { return r.ventas; } : function (r) { return r.pedidos; },
        fin ? function (r) { return gs(r.ventas); } : function (r) { return plural(r.pedidos, 'pedido', 'pedidos'); },
        function (r) { return esc(r.name); },
        function (r) { return (fin ? plural(r.pedidos, 'pedido', 'pedidos') + ' · ticket ' + gs(Math.round(r.ventas / r.pedidos)) + ' · ' : '') + 'último pedido el ' + fdate(D.localDate(new Date(r.ultimo))); },
        'Ningún almacén confirmó pedidos en el período.') + '</section>';

    var pipe = '<ol class="pipe" aria-label="Pedidos por etapa, hoy">' + D.ORDER_FLOW.map(function (s) {
      return '<li class="' + (by[s] ? 'on' : '') + '"><b>' + by[s] + '</b><span>' + esc(D.ORDER_STATUS[s]) + '</span></li>';
    }).join('') + '</ol>';
    var opsCard = '<section class="card"><div class="card-head"><h2>Operación</h2><a class="more small" href="#/pedidos">Ver pedidos →</a></div>' +
      '<p class="small muted" style="margin-bottom:8px">Pedidos por etapa, hoy</p>' + pipe +
      '<dl class="kv kv-num" style="margin-top:14px"><dt>Promedio confirmación → despacho</dt><dd>' + hoursTxt(c.horasHastaDespacho) + '</dd>' +
      '<dt>Promedio despacho → entrega</dt><dd>' + hoursTxt(c.horasHastaEntrega) + '</dd>' +
      '<dt>Despachos en el período</dt><dd>' + D.fmtInt(c.despachados) + '</dd>' +
      '<dt>Entregas en el período</dt><dd>' + D.fmtInt(c.entregados) + '</dd>' +
      '<dt>Cancelación (de los confirmados)</dt><dd>' + (c.tasaCancelacion === null ? 'Sin datos' : pct(c.tasaCancelacion)) + '</dd></dl>' +
      '<p style="margin-top:6px">' + delta(c.tasaCancelacion, p.tasaCancelacion, false, true) + '</p></section>';

    // Próximas acciones: salen de los estados registrados, no de una lista aparte.
    var todo = [];
    var push = function (title, detail, href, label) {
      todo.push('<li><div><b>' + title + '</b><small>' + detail + '</small></div><a class="btn sm" href="#/' + href + '">' + label + '</a></li>');
    };
    state.orders.forEach(function (o) {
      var who = esc(orgName(o.almacenId));
      if (o.status === 'reservado') push('Preparar el pedido ' + o.id, who + ' · reservado el ' + fdatetime(o.confirmedAt), 'pedidos', 'Preparar');
      if (o.status === 'en_preparacion') push('Despachar el pedido ' + o.id, who + ' · en preparación', 'pedidos', 'Despachar');
      if (o.status === 'despachado') push('Confirmar la entrega del pedido ' + o.id, who + ' · a cargo de ' + esc(o.delivery.responsible), 'pedidos', 'Entregas');
    });
    state.lots.forEach(function (l) {
      if (l.bloqueado > 0 && !D.isExpired(l, t)) push('Revisar el lote ' + esc(l.code), esc(prodName(l.sku)) + ' · ' + l.bloqueado + ' bloqueado: ' + esc(l.blockReason), 'stock', 'Ver stock');
    });
    dash.nearExpiry.forEach(function (x) {
      if (x.expired) push('Dar de baja el lote vencido ' + esc(x.lot.code), esc(prodName(x.lot.sku)) + ' · venció el ' + fdate(x.lot.expiry), 'stock', 'Ver stock');
    });
    a.stock.forEach(function (x) {
      if (x.product.status === 'activo' && x.coberturaDias !== null && x.coberturaDias < 7) {
        push('Reponer ' + esc(x.product.name), 'Alcanza para ' + plural(x.coberturaDias, 'día', 'días') + ' al ritmo de los últimos 30 días', can('oferta.registrar') ? 'cruce' : 'stock', can('oferta.registrar') ? 'Ver oferta' : 'Ver stock');
      }
    });
    var listOr = function (html, empty) { return html ? '<ul class="todo">' + html + '</ul>' : '<p class="muted small">' + empty + '</p>'; };
    var todoCard = '<section class="card"><h2>Para hacer ahora</h2>' + listOr(todo.slice(0, 7).join(''), 'Nada pendiente: no hay pedidos por mover, lotes por revisar ni productos por reponer.') +
      (todo.length > 7 ? '<p class="small muted" style="margin-top:8px">Y ' + (todo.length - 7) + ' más.</p>' : '') + '</section>';

    // Stock con cobertura y, para Comercial y Administración, valor a costo.
    var rows = a.stock.map(function (x) {
      var s = x.s;
      var u = D.UNITS[x.product.stockUnit].many;
      var seg = function (n, cls, name) {
        return n > 0 ? '<i class="' + cls + '" style="flex:' + n + '" title="' + name + ': ' + n + ' ' + esc(u) + '"></i>' : '';
      };
      var bar = s.fisico > 0
        ? '<div class="sbar" role="img" aria-label="Disponible ' + s.disponible + ', reservado ' + s.reservado + ', bloqueado ' + s.bloqueado + ', vencido ' + s.vencido + ' ' + esc(u) + '">' +
          seg(s.disponible, 'c-disp', 'Disponible') + seg(s.reservado, 'c-res', 'Reservado') + seg(s.bloqueado, 'c-bloq', 'Bloqueado') + seg(s.vencido, 'c-venc', 'Vencido') + '</div>'
        : '<div class="sbar none" role="img" aria-label="Sin stock en depósito"></div>';
      var cov = x.coberturaDias === null ? (s.disponible > 0 ? 'Sin salidas en 30 días' : 'Sin stock') : 'Alcanza para ' + plural(x.coberturaDias, 'día', 'días');
      var parts = '<div class="parts"><span>' + (x.coberturaDias !== null && x.coberturaDias < 7 ? badge(cov, 'warn') : cov) + '</span>' +
        (s.fisico > 0 ? '<span>Reservado ' + s.reservado + '</span><span>Bloqueado ' + s.bloqueado + '</span>' + (s.vencido ? '<span>Vencido ' + s.vencido + '</span>' : '') : '') +
        (fin ? '<span>Valor ' + (x.valor === null ? 'sin costo cargado' : gs(x.valor)) + '</span>' : '') + '</div>';
      return '<div class="srow"><div class="name"><b>' + esc(x.product.name) + '</b><small>' + esc(x.product.sku) + '</small></div>' + bar +
        '<div class="val"><b>' + s.disponible + '</b> ' + esc(u) + '<br><small class="muted">disponible</small></div>' + parts + '</div>';
    }).join('');
    var legend = '<div class="legend"><span><i class="c-disp"></i>Disponible</span><span><i class="c-res"></i>Reservado</span><span><i class="c-bloq"></i>Bloqueado</span><span><i class="c-venc"></i>Vencido</span></div>';
    var stockTable = table(['Producto', 'Disponible', 'Reservado', 'Bloqueado', 'Vencido', 'Físico', 'Cobertura'].concat(fin ? ['Valor a costo'] : []), a.stock.map(function (x) {
      return ['<b>' + esc(x.product.name) + '</b>', x.s.disponible + ' ' + esc(D.UNITS[x.product.stockUnit].many), String(x.s.reservado), String(x.s.bloqueado), String(x.s.vencido), String(x.s.fisico),
        x.coberturaDias === null ? 'Sin datos' : plural(x.coberturaDias, 'día', 'días')].concat(fin ? [x.valor === null ? 'Sin datos' : gs(x.valor)] : []);
    }), 'Sin productos activos.');
    var stockCard = '<section class="card"><div class="card-head"><div><h2>Stock por producto</h2>' +
      (fin ? '<p class="small muted">Valor del stock vendible (disponible + reservado) a costo vigente: <b>' + gs(a.stockValue) + '</b>' + (a.stockValueIncompleto ? ' (hay productos sin costo cargado)' : '') + '</p>' : '') +
      '</div><div class="actions">' + csvButton('stock') + '<a class="btn sm" href="#/stock">Ver lotes</a></div></div>' +
      '<p class="small muted" style="margin-bottom:10px">Cada producto en su propia unidad. La cobertura divide lo disponible por las salidas de los últimos 30 días.</p>' +
      legend + (rows || '<p class="muted small">Sin productos activos.</p>') +
      '<details class="tview"><summary class="small">Ver como tabla</summary>' + stockTable + '</details></section>';

    var lostCard = '<section class="card"><div class="card-head"><h2>Faltantes de stock</h2>' + csvButton('faltantes') + '</div>' +
      '<p class="small muted" style="margin-bottom:8px">Pedidos que no se pudieron reservar en el período, por producto.</p>' +
      hbars(a.lostByProduct.slice(0, 6), function (r) { return r.missing; }, function (r) { return qty(r.missing, r.unit); }, function (r) { return esc(r.name); },
        function (r) { return plural(r.veces, 'vez', 'veces') + (fin ? ' · ' + (r.sinPrecio ? 'sin precio para estimar' : gs(r.valor) + ' estimado') : ''); },
        'Sin faltantes registrados en el período.') + '</section>';

    var coopCard = !fin ? '' : '<section class="card"><h2>Recepciones por cooperativa</h2><p class="small muted" style="margin-bottom:8px">Lotes recibidos en el período, valorizados a costo vigente (el lote no registra el precio pagado).</p>' +
      (a.coops.length ? '<ul class="todo">' + a.coops.map(function (x) {
        return '<li><div><b>' + esc(x.name) + '</b><small>' + plural(x.lotes, 'lote', 'lotes') + ' · ' + plural(x.diferencias, 'con diferencia', 'con diferencia') + ' entre lo avisado y lo recibido · ' + plural(x.conBloqueo, 'con bloqueo', 'con bloqueo') + ' hoy' + (x.sinCosto ? ' · hay productos sin costo cargado' : '') + '</small></div><b class="num" style="white-space:nowrap">' + gs(x.valor) + '</b></li>';
      }).join('') + '</ul>' : '<p class="muted small">Sin recepciones en el período.</p>') + '</section>';

    var item = function (title, detail, right) { return '<li><div><b>' + title + '</b><small>' + detail + '</small></div>' + right + '</li>'; };
    var exp = dash.nearExpiry.map(function (x) {
      var pr = D.productOf(state, x.lot.sku);
      return item(esc(pr.name), 'Lote ' + esc(x.lot.code) + ' · vence el ' + fdate(x.lot.expiry) + ' · ' + esc(qty(x.lot.liberado + x.lot.bloqueado, pr.stockUnit)) + ' en depósito',
        x.expired ? badge('Vencido', 'bad') : badge(x.days === 0 ? 'Vence hoy' : 'En ' + x.days + ' días', 'warn'));
    }).join('');
    var deliv = dash.openDeliveries.map(function (o) {
      return item('Pedido ' + o.id + ' · ' + esc(orgName(o.almacenId)), 'A cargo de ' + esc(o.delivery.responsible) + ' · ventana ' + win(o.delivery.windowFrom, o.delivery.windowTo) + ' · salió el ' + fdatetime(o.delivery.dispatchedAt), badge('En camino', 'info'));
    }).join('');
    var gaps = dash.gaps.map(function (g) {
      return item(esc(g.product.name) + ' · ' + esc(qty(g.demand.qty, g.demand.unit)), esc(orgName(g.demand.almacenId)) + ' · ' + win(g.demand.windowFrom, g.demand.windowTo) + '<br>' + esc(g.reasons.join(' ')), '');
    }).join('');

    var title = { admin: 'Panel general', comercial: 'Panel comercial', operacion: 'Panel de depósito' }[actor().role] || 'Panel';
    return head(title, 'Hola, ' + esc(actor().name.split(' (')[0]) + '. Hoy es ' + fdate(t) + '. Todo se calcula a partir de lo registrado.') + '<div class="stack">' + notice + periodBar +
      '<div class="mkpis">' + kpis + '</div>' + chartCard +
      '<div class="cols-2">' + prodCard + almCard + '</div>' +
      '<div class="cols-2">' + opsCard + todoCard + '</div>' + stockCard +
      '<div class="cols-2">' + lostCard + (coopCard || '<section class="card"><h2>Lotes cerca del vencimiento</h2>' + listOr(exp, 'Ningún lote vence en los próximos ' + state.settings.nearExpiryDays + ' días.') + '</section>') + '</div>' +
      '<div class="cols-2">' + (coopCard ? '<section class="card"><h2>Lotes cerca del vencimiento</h2>' + listOr(exp, 'Ningún lote vence en los próximos ' + state.settings.nearExpiryDays + ' días.') + '</section>' : '') +
      '<section class="card"><h2>Entregas abiertas</h2>' + listOr(deliv, 'No hay pedidos despachados pendientes de entrega.') + '</section>' +
      (coopCard ? '' : '<section class="card"><h2>Faltas de oferta</h2>' + listOr(gaps, 'Toda la demanda registrada tiene oferta que la cubre.') + '</section>') + '</div>' +
      (coopCard ? '<section class="card"><h2>Faltas de oferta</h2>' + listOr(gaps, 'Toda la demanda registrada tiene oferta que la cubre.') + '</section>' : '') + '</div>';
  }

  function pageRecepcion() {
    var a = actor();
    var coops = orgs('cooperativa').map(function (o) { return [o.id, o.name]; });
    var form = '<form class="form" data-form="recepcion" novalidate>' +
      field('Proveedor', select('coopId', coops, coops[0] && coops[0][0])) +
      field('Depósito', select('depositoId', state.depositos.map(function (d) { return [d.id, d.name]; }), '')) +
      field('Producto', select('sku', productOptions(function (p) { return p.status === 'activo'; }, true), '', 'data-unit-hint required'), 'Solo productos activos del catálogo.') +
      field('Código de lote', input('lotCode', 'text', '', 'required autocomplete="off"')) +
      field('Cantidad declarada por el proveedor', input('qtyDeclared', 'number', '', 'min="1" step="1" inputmode="numeric"'), 'Opcional. Según remisión o aviso.') +
      field('Cantidad recibida', input('qtyReceived', 'number', '', 'min="1" step="1" inputmode="numeric" required'), '<span data-unit-label>En la unidad de stock del producto.</span>') +
      field('De esa cantidad, liberada para la venta', input('qtyReleased', 'number', '', 'min="0" step="1" inputmode="numeric" required'), 'El resto queda bloqueado y no se puede vender.') +
      field('Motivo del bloqueo', input('blockReason', 'text', ''), 'Obligatorio si queda algo bloqueado.') +
      field('Diferencia con lo declarado', input('discrepancyNote', 'text', ''), 'Obligatorio si lo recibido no coincide.') +
      field('Fecha de recepción', input('receivedDate', 'date', today(), 'max="' + today() + '" required')) +
      field('Vencimiento', input('expiry', 'date', ''), 'Si aplica a la categoría.') +
      field('Responsable', input('responsible', 'text', a.name, 'required')) +
      field('Observaciones', input('notes', 'text', ''), 'Opcional', 'wide') +
      '<p class="note warn wide">Procedimiento de calidad: <b>por validar</b>. Hoy “liberado” solo significa que la persona responsable lo revisó; no es una liberación formal.</p>' +
      '<div class="form-error" role="alert"></div>' +
      '<div class="actions wide"><button class="btn primary" type="submit">Registrar recepción</button></div></form>';
    var rows = state.lots.slice().reverse().slice(0, 12).map(function (l) {
      var p = D.productOf(state, l.sku);
      return [fdate(l.receivedDate), '<b>' + esc(p.name) + '</b>', esc(l.code), esc(orgName(l.coopId)), esc(qty(l.receivedQty, p.stockUnit)) + (l.declaredQty !== null && l.declaredQty !== l.receivedQty ? '<br>' + badge('Declarado: ' + l.declaredQty, 'warn') : ''),
        fdate(l.expiry), esc(l.responsible)];
    });
    return head('Recepción', 'Registrá lo que de verdad llegó, lote por lote. Solo lo recibido y liberado se puede vender.') +
      '<div class="stack"><section class="card"><h2>Nueva recepción</h2>' + form + '</section>' +
      '<section><h2 style="margin-bottom:8px">Últimas recepciones</h2>' + table(['Fecha', 'Producto', 'Lote', 'Proveedor', 'Recibido', 'Vence', 'Responsable'], rows, 'Todavía no hay recepciones.') + '</section></div>';
  }

  function pageStock() {
    var t = today();
    var editable = can('lote.ajustar');
    var limit = D.addDays(t, state.settings.nearExpiryDays);
    var blocks = state.products.filter(function (p) {
      return p.status === 'activo' || state.lots.some(function (l) { return l.sku === p.sku; });
    }).map(function (p) {
      var s = D.stockSummary(state, p.sku, t);
      var lots = D.fefoLots(state, p.sku, t).concat(state.lots.filter(function (l) { return l.sku === p.sku && D.lotAvailable(l, t) === 0; }));
      var rows = lots.map(function (l, i) {
        var expired = D.isExpired(l, t);
        var st = expired ? badge('Vencido', 'bad') : l.expiry && l.expiry <= limit ? badge('Por vencer', 'warn') : '';
        var fefo = D.lotAvailable(l, t) > 0 && i === 0 ? badge('Sale primero', 'info') : '';
        var b = function (act, label) { return '<button class="btn sm" type="button" data-act="' + act + '" data-id="' + l.id + '">' + label + '</button>'; };
        var actions = editable ? '<div class="actions">' + (l.liberado - l.reserved > 0 ? b('lote-bloquear', 'Bloquear…') : '') + (l.bloqueado > 0 && !expired ? b('lote-liberar', 'Liberar…') : '') + b('lote-ajustar', 'Ajustar…') + '</div>' : '';
        return ['<b>' + esc(l.code) + '</b> ' + fefo, fdate(l.expiry) + ' ' + st, '<b class="num">' + D.lotAvailable(l, t) + '</b>', String(l.reserved), String(l.liberado),
          l.bloqueado ? l.bloqueado + '<br><small class="muted">' + esc(l.blockReason) + '</small>' : '0', actions];
      });
      return '<section class="card"><div class="row between"><h2>' + esc(p.name) + ' <small class="muted">' + esc(p.sku) + ' · ' + esc(p.presentation) + '</small></h2>' +
        (s.disponible > 0 ? badge('Disponible', 'ok') : badge('Sin stock vendible', 'warn')) + '</div>' + stockLine(s, p.stockUnit) +
        '<div style="margin-top:10px">' + table(['Lote', 'Vence', 'Disponible', 'Reservado', 'Liberado', 'Bloqueado', ''], rows, 'Sin lotes recibidos. La oferta informada por las cooperativas no cuenta como stock.') + '</div></section>';
    }).join('');
    return head('Stock', 'Por producto y por lote. Los lotes vendibles se ordenan por vencimiento más cercano (FEFO). Reservar no es salida física.') +
      '<div class="stack">' + (blocks || '<p class="empty">Sin productos activos.</p>') + '</div>';
  }

  function pagePedidos() {
    var filters = [['activos', 'En curso'], ['borrador', 'Borradores'], ['despachado', 'Despachados'], ['entregado', 'Entregados'], ['cancelado', 'Cancelados'], ['todos', 'Todos']];
    var f = ui.orderFilter;
    var list = state.orders.filter(function (o) {
      if (f === 'todos') return true;
      if (f === 'activos') return o.status === 'reservado' || o.status === 'en_preparacion' || o.status === 'despachado';
      return o.status === f;
    });
    var chips = '<div class="chips" role="group" aria-label="Filtrar pedidos">' + filters.map(function (x) {
      return '<button class="chip" type="button" data-act="filtro-pedidos" data-id="' + x[0] + '" aria-pressed="' + (x[0] === f) + '">' + x[1] + '</button>';
    }).join('') + '</div>';
    var nuevo = can('pedido.guardarBorrador') ? '<button class="btn primary" type="button" data-act="nuevo-pedido">Nuevo pedido…</button>' : '';
    return head('Pedidos', 'Borrador → Reservado → En preparación → Despachado → Entregado. Se puede cancelar hasta antes del despacho.', nuevo) +
      '<div class="stack">' + chips + orderList(list, 'No hay pedidos en esta vista.') + '</div>';
  }

  function pageCruce() {
    var t = today();
    var rows = D.matchSupplyDemand(state);
    var blocks = rows.map(function (r) {
      var u = r.unit;
      var s = D.stockSummary(state, r.sku, t);
      var dem = r.demands.map(function (x) {
        var d = x.demand;
        var result = x.need === null ? badge('Sin cruce', 'bad')
          : x.missing === 0 ? badge('Cubierta: ' + qty(x.matched, u), 'ok')
            : x.matched > 0 ? badge('Parcial: ' + qty(x.matched, u), 'warn') : badge('Sin cruce', 'bad');
        return [esc(orgName(d.almacenId)), esc(qty(d.qty, d.unit)), win(d.windowFrom, d.windowTo), esc(D.DEMAND_KIND[d.kind]), result,
          esc(x.reasons.join(' ')) || (x.matches.length ? 'Coincide del ' + x.matches.map(function (m) { return win(m.from, m.to); }).join('; ') + '.' : '')];
      });
      var off = r.offers.map(function (o) {
        return [esc(orgName(o.offer.coopId)), esc(qty(o.offer.qty, o.offer.unit)) + (o.base !== null && o.offer.unit !== u ? ' = ' + esc(qty(o.base, u)) : ''), win(o.offer.windowFrom, o.offer.windowTo),
          esc(D.OFFER_CONFIRMATION[o.offer.confirmation]), o.base === null ? badge('Unidad sin conversión a ' + D.UNITS[u].many, 'bad') : esc(qty(o.remaining, u)) + ' sin asignar'];
      });
      return '<section class="card"><h2>' + esc(r.product.name) + ' <small class="muted">' + esc(r.sku) + '</small></h2>' +
        '<div class="stockline" style="margin:6px 0"><span>Oferta <b>' + r.offered + '</b></span><span>Demanda <b>' + r.demanded + '</b></span><span>Sugerido <b>' + r.suggested + '</b></span>' +
        '<span>Saldo de oferta <b>' + r.offerBalance + '</b></span><span>Falta <b>' + r.shortfall + '</b></span><span class="muted">' + esc(D.UNITS[u].many) + '</span></div>' +
        '<p class="note small">Stock real disponible hoy: <b>' + qty(s.disponible, u) + '</b>. El cruce es una sugerencia para planificar: no crea stock ni pedidos.</p>' +
        '<h3 style="margin:12px 0 6px">Demanda</h3>' + table(['Almacén', 'Cantidad', 'Ventana', 'Tipo', 'Resultado', 'Explicación'], dem, 'Sin demanda registrada para este producto.') +
        '<h3 style="margin:12px 0 6px">Oferta</h3>' + table(['Cooperativa', 'Cantidad', 'Ventana', 'Confirmación', 'Saldo'], off, 'Sin oferta registrada para este producto.') + '</section>';
    }).join('');
    return head('Oferta y demanda', 'Compara por producto, unidades convertibles y ventanas que se superponen. Interés, previsión, stock, venta y entrega son cosas distintas.') +
      '<div class="stack">' +
      '<details class="card"><summary>Registrar oferta de una cooperativa</summary>' + offerForm(true) + '</details>' +
      '<details class="card"><summary>Registrar demanda de un almacén</summary>' + demandForm(true) + '</details>' +
      (blocks || '<p class="empty">Todavía no hay oferta ni demanda registradas.</p>') +
      '<details class="card"><summary>Todas las ofertas (' + state.offers.length + ')</summary>' +
      table(['Cooperativa', 'Producto', 'Cantidad', 'Ventana', 'Tipo', 'Confirmación', 'Origen y notas', ''], offerRows(state.offers, true), 'Sin ofertas.') + '</details>' +
      '<details class="card"><summary>Todas las demandas (' + state.demands.length + ')</summary>' +
      table(['Almacén', 'Producto', 'Cantidad', 'Ventana', 'Tipo', 'Observaciones', ''], demandRows(state.demands, true), 'Sin demandas.') + '</details></div>';
  }

  function pagePrecios() {
    var cards = state.products.filter(function (p) { return p.status !== 'inactivo'; }).map(function (p) {
      var pr = p.pricing;
      var k = D.priceIndicators(pr);
      var v = function (n) { return n === null ? '<span class="muted">Sin datos</span>' : gs(n); };
      var unit = D.unitLabel(p.saleUnit, 1);
      var calc = '<details><summary class="small">Cómo se calcula</summary><ul class="small">' +
        '<li>Costo total = costo al proveedor + costo logístico = ' + (k.costoTotal === null ? 'Sin datos (falta ' + (pr.costoProveedor === null ? 'el costo al proveedor' : 'el costo logístico') + ')' : gs(pr.costoProveedor) + ' + ' + gs(pr.costoLogistico) + ' = ' + gs(k.costoTotal)) + '</li>' +
        '<li>Margen de la distribuidora (sobre el precio de venta) = (precio al almacén − costo total) ÷ precio al almacén = ' + (k.margenDistribuidora === null ? 'Sin datos' : gs(k.gananciaDistribuidora) + ' ÷ ' + gs(pr.precioAlmacen) + ' = ' + pct(k.margenDistribuidora)) + '</li>' +
        '<li>Recargo de la distribuidora (sobre el costo) = (precio al almacén − costo total) ÷ costo total = ' + (k.recargoDistribuidora === null ? 'Sin datos' : gs(k.gananciaDistribuidora) + ' ÷ ' + gs(k.costoTotal) + ' = ' + pct(k.recargoDistribuidora)) + '</li>' +
        '<li>Margen del almacén = (precio sugerido − precio al almacén) ÷ precio sugerido = ' + (k.margenAlmacen === null ? 'Sin datos' : gs(k.gananciaAlmacen) + ' ÷ ' + gs(pr.precioSugerido) + ' = ' + pct(k.margenAlmacen)) + '</li>' +
        '<li>Recargo del almacén = (precio sugerido − precio al almacén) ÷ precio al almacén = ' + pct(k.recargoAlmacen) + '</li>' +
        '<li>Parte del productor en el precio final = costo al proveedor ÷ precio sugerido = ' + pct(k.participacionProductor) + '</li></ul></details>';
      return '<article class="card"><div class="row between"><h2>' + esc(p.name) + ' <small class="muted">' + esc(p.sku) + ' · por ' + esc(unit) + '</small></h2>' +
        (p.status === 'potencial' ? badge('Línea potencial') : pr.precioAlmacen === null ? badge('Sin precio: no se vende', 'warn') : badge('En la tienda', 'ok')) + '</div>' +
        '<dl class="kv kv-num" style="margin:8px 0"><dt>Costo pagado al proveedor</dt><dd class="num">' + v(pr.costoProveedor) + '</dd>' +
        '<dt>Costo logístico por unidad</dt><dd class="num">' + v(pr.costoLogistico) + '</dd>' +
        '<dt>Precio al almacén</dt><dd class="num"><b>' + v(pr.precioAlmacen) + '</b></dd>' +
        '<dt>Precio final sugerido</dt><dd class="num">' + v(pr.precioSugerido) + '</dd>' +
        '<dt>Margen distribuidora (sobre venta)</dt><dd class="num">' + pct(k.margenDistribuidora) + '</dd>' +
        '<dt>Recargo distribuidora (sobre costo)</dt><dd class="num">' + pct(k.recargoDistribuidora) + '</dd>' +
        '<dt>Margen del almacén (sobre venta)</dt><dd class="num">' + pct(k.margenAlmacen) + '</dd>' +
        '<dt>Parte del productor en el precio final</dt><dd class="num">' + pct(k.participacionProductor) + '</dd></dl>' + calc +
        '<div class="actions" style="margin-top:8px"><button class="btn sm" type="button" data-act="editar-precio" data-id="' + p.sku + '">Editar precios…</button></div></article>';
    }).join('');
    return head('Precios', 'Cuatro valores separados por producto. Margen (sobre el precio de venta) y recargo (sobre el costo) no son lo mismo. Si falta un dato, se muestra “Sin datos”, nunca cero.') +
      '<div class="stack"><p class="note warn">Plazos de crédito, límites, fletes, pagos a las cooperativas y condiciones comerciales son decisiones abiertas: todavía no son reglas del sistema. Cambiar un precio no modifica pedidos ya confirmados.</p>' +
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))">' + cards + '</div></div>';
  }

  function pageCatalogo() {
    var rows = state.products.map(function (p) {
      var cat = D.byId(state.categories, p.categoryId);
      var why = D.notSellableReason(state, p);
      return ['<b>' + esc(p.name) + '</b><br><small class="muted">' + esc(p.sku) + '</small>', esc(p.coopId ? orgName(p.coopId) : 'Origen por definir') + (p.origin ? '<br><small>' + esc(p.origin) + '</small>' : ''),
        esc(cat.name), esc(p.presentation), 'Stock: ' + esc(D.UNITS[p.stockUnit].many) + '<br>Venta: ' + esc(D.unitLabel(p.saleUnit, 1)) + (p.saleFactor > 1 ? ' = ' + esc(qty(p.saleFactor, p.stockUnit)) : '') +
        (p.conversions && p.conversions.length ? '<br><small class="muted">' + p.conversions.map(function (c) { return '1 ' + esc(D.unitLabel(c.unit, 1)) + ' = ' + esc(qty(c.factor, p.stockUnit)); }).join('; ') + '</small>' : ''),
        p.docRequired ? (p.docRef ? esc(p.docRef) : badge('Falta documento', 'bad')) : '<span class="muted">No exigido (por validar)</span>',
        badge(D.PRODUCT_STATUS[p.status], p.status === 'activo' ? 'ok' : '') + (p.status === 'activo' && why ? '<br><small class="muted">' + esc(why) + '</small>' : ''),
        '<button class="btn sm" type="button" data-act="editar-producto" data-id="' + p.sku + '">Editar</button>'];
    });
    return head('Catálogo', 'Productos, unidades y conversiones. Las líneas potenciales no se venden ni se reciben hasta activarlas. Fotos: solo cuando las cooperativas las provean (carga no incluida en este prototipo).',
      '<button class="btn primary" type="button" data-act="editar-producto" data-id="">Nuevo producto…</button>') +
      table(['Producto', 'Cooperativa / origen', 'Categoría', 'Presentación', 'Unidades', 'Documento', 'Estado', ''], rows, 'Sin productos.');
  }

  function pageMovimientos() {
    var physical = { entrada: true, salida: true, ajuste: true };
    var all = state.movements.filter(function (m) { return !ui.movSku || m.sku === ui.movSku; });
    var list = all.slice(-300).reverse();
    var rows = list.map(function (m) {
      var lot = D.byId(state.lots, m.lotId);
      var eff = m.fisico > 0 ? badge('+' + m.fisico + ' físico', 'ok') : m.fisico < 0 ? badge(m.fisico + ' físico', 'bad') : badge('Sin movimiento físico');
      return [fdatetime(m.at), '<b>' + esc(D.MOVEMENT_TYPES[m.type]) + '</b>', esc(prodName(m.sku)), esc(lot ? lot.code : m.lotId), esc(qty(m.qty, m.unit)), physical[m.type] || m.fisico ? eff : eff,
        esc(m.orderId || ''), esc(m.reason), esc(m.actor)];
    });
    var skus = [['', 'Todos los productos']].concat(state.products.filter(function (p) { return state.movements.some(function (m) { return m.sku === p.sku; }); }).map(function (p) { return [p.sku, p.name]; }));
    return head('Movimientos', 'Historial de stock: entradas, ajustes, bloqueos, liberaciones, reservas y salidas. Reservar y liberar una reserva no mueven mercadería.') +
      '<div class="stack"><div class="card">' + field('Producto', select('movSku', skus, ui.movSku, 'data-change="mov-sku"')) + '</div>' +
      (all.length > list.length ? '<p class="small muted">Se muestran los últimos ' + list.length + ' de ' + D.fmtInt(all.length) + ' movimientos.</p>' : '') +
      table(['Fecha', 'Tipo', 'Producto', 'Lote', 'Cantidad', 'Efecto', 'Pedido', 'Motivo', 'Quién'], rows, 'Sin movimientos para esta vista.') + '</div>';
  }

  function pageAuditoria() {
    var shown = state.audit.slice(-300).reverse();
    var rows = shown.map(function (a) {
      return [fdatetime(a.at), esc(a.actor), '<code class="small">' + esc(a.action) + '</code>', esc(a.summary)];
    });
    return head('Historial de cambios', 'Cada cambio aceptado deja un registro. Los intentos rechazados no modifican nada y no figuran aquí.') +
      (state.audit.length > shown.length ? '<p class="small muted" style="margin-bottom:8px">Se muestran los últimos ' + shown.length + ' de ' + D.fmtInt(state.audit.length) + ' registros.</p>' : '') +
      table(['Fecha', 'Quién', 'Acción', 'Qué cambió'], rows, 'Sin registros.');
  }

  // ---------- ingreso, cuenta y accesos ----------

  function pageIngresar() {
    var setup = !accessReady();
    var admin = state.users.filter(function (u) { return u.role === 'admin' && u.active !== false; })[0];
    var shop = D.storefront(state, today()).filter(function (p) { return p.photo; }).slice(0, 6);
    var art = '<div class="auth-art" aria-hidden="true"><div class="auth-art-in"><p class="eyebrow">' + esc(storeName()) + '</p><h2>Pedidos, stock y tienda de las cooperativas, en un solo lugar.</h2>' +
      '<div class="auth-tiles">' + shop.map(function (p) { return '<span><img src="' + esc(p.photo) + '" alt=""></span>'; }).join('') + '</div></div></div>';
    var form = setup
      ? '<h1>Configurá el acceso</h1><p class="muted">Es el primer ingreso. Creá la cuenta de Administración: con ella se dan de alta las demás cuentas y sus niveles de acceso.</p>' +
        '<form class="form auth-form" data-form="setup" novalidate>' +
        field('Nombre', input('name', 'text', admin ? admin.name : 'Administración', 'required autocomplete="name"'), '', 'wide') +
        field('Usuario', input('username', 'text', admin ? admin.username : 'admin', 'required autocomplete="username" autocapitalize="none" spellcheck="false"'), 'Letras sin acento, números, punto o guion.', 'wide') +
        field('Contraseña', input('p1', 'password', '', 'required autocomplete="new-password" minlength="8"'), 'Al menos 8 caracteres.', 'wide') +
        field('Repetir contraseña', input('p2', 'password', '', 'required autocomplete="new-password" minlength="8"'), '', 'wide') +
        '<div class="form-error" role="alert"></div><button class="btn primary lg wide" type="submit">Crear acceso y entrar</button></form>'
      : '<h1>Ingresar</h1><p class="muted">Usá el usuario y la contraseña que te dio Yvy Guaraní.</p>' +
        '<form class="form auth-form" data-form="login" novalidate>' +
        field('Usuario', input('username', 'text', '', 'required autocomplete="username" autocapitalize="none" spellcheck="false" autofocus'), '', 'wide') +
        field('Contraseña', input('password', 'password', '', 'required autocomplete="current-password"'), '', 'wide') +
        '<div class="form-error" role="alert"></div><button class="btn primary lg wide" type="submit">Ingresar</button></form>' +
        '<p class="small muted">¿Olvidaste tu contraseña? Pedí a Administración que la restablezca.</p>' +
        '<p><a class="more" href="#/tienda">← Ver la tienda sin ingresar</a></p>';
    return '<div class="auth"><div class="auth-card"><a class="auth-brand" href="#/inicio"><img src="assets/logo-yvy.jpg" alt="" width="48" height="48"><span><b>' + esc(storeName()) + '</b><small>Yvy Guaraní S.A.</small></span></a>' +
      form + '</div>' + art + '</div>';
  }

  function pageCuenta() {
    var me = sessionUser();
    var a = actor();
    var u = a.viewedBy ? D.byId(state.users, a.id) : me;
    return head('Mi cuenta', a.viewedBy ? 'Estás viendo la cuenta de otra persona. Para cambiar su contraseña, usá Usuarios y accesos.' : 'Tus datos de acceso.') +
      '<div class="cols-2"><section class="card"><h2>Datos</h2><dl class="kv">' +
      '<dt>Nombre</dt><dd>' + esc(u.name) + '</dd><dt>Usuario</dt><dd>' + esc(u.username) + '</dd><dt>Rol</dt><dd>' + esc(D.ROLES[u.role]) + '</dd>' +
      (u.orgId ? '<dt>Organización</dt><dd>' + esc(orgName(u.orgId)) + '</dd>' : '') + '</dl>' +
      '<p class="small muted" style="margin-top:10px">Para cambiar el nombre, el usuario o el rol, hablá con Administración.</p></section>' +
      (a.viewedBy ? '' : '<section class="card"><h2>Cambiar contraseña</h2><form class="form" data-form="password" novalidate>' +
        field('Contraseña actual', input('current', 'password', '', 'autocomplete="current-password" required'), '', 'wide') +
        field('Nueva contraseña', input('p1', 'password', '', 'autocomplete="new-password" required minlength="8"'), 'Al menos 8 caracteres.') +
        field('Repetir nueva contraseña', input('p2', 'password', '', 'autocomplete="new-password" required minlength="8"')) +
        '<div class="form-error" role="alert"></div><div class="actions wide"><button class="btn primary" type="submit">Guardar contraseña</button></div></form></section>') + '</div>';
  }

  /** Matriz de accesos: sale del mismo menú que usa cada rol, así nunca queda desactualizada. */
  function accessMatrix() {
    var roles = ['admin', 'comercial', 'operacion', 'cooperativa', 'almacen'];
    var mods = [];
    roles.forEach(function (r) {
      NAV[r].forEach(function (n) { if (!mods.some(function (m) { return m[0] === n[0]; })) mods.push([n[0], n[1].replace(/^Panel .*/, 'Panel')]); });
    });
    var has = function (r, page) { return NAV[r].some(function (n) { return n[0] === page; }); };
    return '<div class="tbl-wrap"><table class="tbl matrix"><thead><tr><th scope="col">Sección</th>' + roles.map(function (r) { return '<th scope="col">' + esc(D.ROLES[r]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      mods.map(function (m) {
        return '<tr><th scope="row">' + esc(m[1]) + '</th>' + roles.map(function (r) {
          return '<td data-l="' + esc(D.ROLES[r]) + '">' + (has(r, m[0]) ? '<span class="yes">' + icon('check') + '<span>Sí</span></span>' : '<span class="no">—<span class="sr-only">No</span></span>') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function pageUsuarios() {
    var me = sessionUser();
    var order = { admin: 0, comercial: 1, operacion: 2, cooperativa: 3, almacen: 4 };
    var rows = state.users.slice().sort(function (x, y) { return order[x.role] - order[y.role] || x.name.localeCompare(y.name); }).map(function (u) {
      var acts = '<div class="actions"><button class="btn sm" type="button" data-act="editar-usuario" data-id="' + u.id + '">Editar</button>' +
        '<button class="btn sm" type="button" data-act="credencial" data-id="' + u.id + '">' + (u.cred ? 'Nueva contraseña' : 'Crear acceso') + '</button>' +
        (u.id !== me.id && u.active !== false ? '<button class="btn sm" type="button" data-act="ver-como" data-id="' + u.id + '">' + icon('eye') + 'Ver como</button>' : '') + '</div>';
      return ['<span class="ucell"><span class="avatar sm">' + esc(initials(u.name)) + '</span><span><b>' + esc(u.name) + '</b>' + (u.id === me.id ? ' <small class="muted">(vos)</small>' : '') + '</span></span>',
        '<code>' + esc(u.username) + '</code>', esc(D.ROLES[u.role]), esc(u.orgId ? orgName(u.orgId) : 'Yvy Guaraní S.A.'),
        u.cred ? badge('Con contraseña', 'ok') : badge('Sin acceso todavía', 'warn'), u.active === false ? badge('Inactiva') : badge('Activa', 'ok'), acts];
    });
    var counts = Object.keys(D.ROLES).map(function (r) { return '<span class="badge">' + esc(D.ROLES[r]) + ': ' + state.users.filter(function (u) { return u.role === r; }).length + '</span>'; }).join('');
    return head('Usuarios y accesos', 'Cada cuenta entra con su usuario y contraseña y ve solo las secciones de su rol. Administración ve todo y puede mirar el sistema como cualquier cuenta.',
      '<button class="btn primary" type="button" data-act="editar-usuario" data-id="">' + icon('user') + 'Nueva cuenta…</button>') +
      '<div class="stack"><p class="chips">' + counts + '</p>' + table(['Cuenta', 'Usuario', 'Rol', 'Organización', 'Acceso', 'Estado', ''], rows, 'Sin cuentas.') +
      '<section class="card"><div class="card-head"><div><h2>Qué ve cada rol</h2><p class="small muted">Secciones del menú de cada rol. Las acciones también se controlan en las reglas: un rol sin permiso no puede ejecutarlas aunque llegue a la pantalla.</p></div></div>' +
      accessMatrix() + '</section></div>';
  }

  function pageClientes() {
    var rows = orgs('almacen').map(function (o) {
      var mine = state.orders.filter(function (x) { return x.almacenId === o.id && x.confirmedAt && x.status !== 'cancelado'; });
      var last = mine.map(function (x) { return x.confirmedAt; }).sort().pop();
      var accounts = state.users.filter(function (u) { return u.orgId === o.id; });
      return ['<b>' + esc(o.name) + '</b>' + (o.notes ? '<br><small class="muted">' + esc(o.notes) + '</small>' : ''), esc(o.zona || '—'), esc(o.contacto || '—'),
        accounts.length ? esc(accounts.map(function (u) { return u.username; }).join(', ')) : '<button class="btn sm" type="button" data-act="cuenta-cliente" data-id="' + o.id + '">Crear cuenta</button>',
        String(mine.length), last ? fdate(D.localDate(new Date(last))) : '—', o.active ? badge('Activo', 'ok') : badge('Inactivo'),
        '<div class="actions"><button class="btn sm" type="button" data-act="editar-almacen" data-id="' + o.id + '">Editar</button>' +
        (can('pedido.guardarBorrador') && o.active ? '<button class="btn sm" type="button" data-act="pedido-para" data-id="' + o.id + '">Nuevo pedido</button>' : '') + '</div>'];
    });
    return head('Clientes', 'Almacenes y bodegas que compran en ' + esc(storeName()) + '.',
      '<button class="btn primary" type="button" data-act="editar-almacen" data-id="">' + icon('users') + 'Nuevo cliente…</button>') +
      table(['Cliente', 'Zona', 'Contacto', 'Cuentas de acceso', 'Pedidos', 'Último pedido', 'Estado', ''], rows, 'Todavía no hay clientes. Creá el primero con “Nuevo cliente”.');
  }

  function pageConfig() {
    var s = state.settings;
    var cats = state.categories.map(function (c) {
      return '<form class="card form" data-form="categoria" novalidate><input type="hidden" name="id" value="' + c.id + '">' +
        '<div class="wide row between"><h3>' + esc(c.name) + '</h3>' + (c.fueraDePiloto ? badge('Fuera de la operación inicial', 'bad') : badge('Requisitos por validar', 'warn')) + '</div>' +
        '<label class="check"><input type="checkbox" name="requiresExpiry"' + (c.requiresExpiry ? ' checked' : '') + '> Exigir vencimiento al recibir</label>' +
        '<label class="check"><input type="checkbox" name="requiresDoc"' + (c.requiresDoc ? ' checked' : '') + '> Sugerir documento de regularización</label>' +
        field('Procedimiento de calidad', input('qualityNote', 'text', c.qualityNote, 'placeholder="Por definir con la cooperativa"'), '', 'wide') +
        '<div class="form-error" role="alert"></div><div class="actions wide"><button class="btn sm" type="submit">Guardar categoría</button></div></form>';
    }).join('');
    var coops = table(['Cooperativa o proveedor', 'Zona', 'Contacto', 'Productos', 'Cuentas', 'Estado', ''], orgs('cooperativa').map(function (o) {
      return ['<b>' + esc(o.name) + '</b>', esc(o.zona || '—'), esc(o.contacto || '—'), String(state.products.filter(function (p) { return p.coopId === o.id; }).length),
        String(state.users.filter(function (u) { return u.orgId === o.id; }).length), o.active !== false ? badge('Activa', 'ok') : badge('Inactiva'),
        '<button class="btn sm" type="button" data-act="editar-cooperativa" data-id="' + o.id + '">Editar</button>'];
    }), 'Sin cooperativas.');
    return head('Configuración', 'Datos de la tienda, proveedores, reglas de operación y respaldo.') + '<div class="stack">' +
      '<div class="cols-2"><section class="card"><h2>Tienda</h2><form class="form" data-form="tienda" novalidate>' +
      field('Nombre comercial', input('storeName', 'text', s.storeName || D.DEFAULT_STORE_NAME, 'required maxlength="40"'), 'Aparece en la tienda, el ingreso y el encabezado. Se puede cambiar cuando se defina la marca.', 'wide') +
      '<div class="form-error" role="alert"></div><div class="actions wide"><button class="btn primary" type="submit">Guardar nombre</button></div></form></section>' +
      '<section class="card"><h2>Operación</h2><form class="form" data-form="config" novalidate>' +
      field('Costo de entrega por pedido (Gs.)', input('deliveryFee', 'number', s.deliveryFee, 'min="0" step="1" inputmode="numeric"'), 'Vacío = a definir. Se registra en cada pedido al confirmar.') +
      field('Avisar vencimientos con (días)', input('nearExpiryDays', 'number', s.nearExpiryDays, 'min="1" max="365" step="1" inputmode="numeric"')) +
      '<div class="form-error" role="alert"></div><div class="actions wide"><button class="btn primary" type="submit">Guardar</button></div></form></section></div>' +
      '<section><div class="row between" style="margin-bottom:10px"><h2>Cooperativas y proveedores</h2><button class="btn sm" type="button" data-act="editar-cooperativa" data-id="">Nueva cooperativa…</button></div>' + coops + '</section>' +
      '<section><h2 style="margin-bottom:8px">Categorías y requisitos</h2><p class="note warn" style="margin-bottom:10px">Los requisitos legales y de calidad de cada categoría están <b>por validar</b> con las cooperativas y la autoridad correspondiente.</p><div class="grid">' + cats + '</div></section>' +
      '<section class="card"><h2>Datos y respaldo</h2><p class="small muted" style="margin-bottom:10px">Los datos se guardan en el servidor, que hace una copia de seguridad automática al iniciar, cada 24 horas y antes de reemplazar datos. También podés descargar un respaldo en JSON (incluye las cuentas: guardalo en un lugar seguro).</p>' +
      '<div class="actions"><button class="btn" type="button" data-act="exportar">Exportar respaldo</button>' +
      '<label class="btn" for="import-file">Importar respaldo…</label><input class="sr-only" type="file" id="import-file" accept="application/json,.json"></div>' +
      '<div class="form-error" role="alert" id="import-error" style="margin-top:10px"></div>' +
      '<details style="margin-top:14px"><summary>Escenarios para presentar y probar</summary><p class="small muted" style="margin:6px 0 10px">Reemplazan los datos del servidor para todas las personas. Tu cuenta de Administración se conserva.</p><div class="actions">' +
      '<button class="btn" type="button" data-act="demo">Cargar demostración (13 semanas ficticias)…</button>' +
      '<button class="btn" type="button" data-act="cargar-prueba">Cargar escenario de prueba…</button>' +
      '<button class="btn danger" type="button" data-act="cargar-inicial">Volver al catálogo inicial…</button></div>' +
      (state.demo ? '<p class="note warn small" style="margin-top:10px">Está cargada la demostración: clientes, precios y movimientos ficticios desde el ' + fdate(state.demo.from) + '.</p>' : '') +
      (state.fixture ? '<p class="note warn small" style="margin-top:10px">Está cargado el escenario de prueba (datos ficticios para el guion de aceptación).</p>' : '') +
      '</details></section></div>';
  }

  // ---------- nuevo pedido (pantalla completa) ----------

  function draft() {
    if (!ui.draft) ui.draft = { almacenId: '', lines: {}, windowFrom: '', windowTo: '', notes: '', orderId: null };
    if (ui.draft.orderId) {
      var o = D.byId(state.orders, ui.draft.orderId);
      if (!o || o.status !== 'borrador') ui.draft.orderId = null;
    }
    return ui.draft;
  }
  function pageNuevoPedido() {
    var t = today();
    var dr = draft();
    var shop = D.storefront(state, t);
    var orderable = shop.filter(function (p) { return p.orderable; });
    var pending = shop.length - orderable.length;
    var clients = orgs('almacen').filter(function (o) { return o.active; });
    var cats = categoriesOf(orderable);
    var lines = orderable.filter(function (p) { return (dr.lines[p.sku] || 0) > 0; });
    var subtotal = 0, problems = 0;
    lines.forEach(function (p) { subtotal += dr.lines[p.sku] * p.price; if (dr.lines[p.sku] > p.available) problems++; });
    var fee = state.settings.deliveryFee;
    var rows = orderable.map(function (p) {
      var q = dr.lines[p.sku] || 0;
      return '<li class="np-row' + (q ? ' on' : '') + '" data-search="' + esc((p.name + ' ' + p.category + ' ' + p.originDetail).toLowerCase()) + '" data-cat="' + esc(p.category) + '">' +
        '<img src="' + esc(p.photo || 'assets/logo-yvy.jpg') + '" alt="" loading="lazy">' +
        '<div class="np-info"><b>' + esc(p.name) + '</b><small>' + esc(p.presentation) + ' · ' + esc(p.category) + '</small>' +
        '<small>' + gs(p.price) + ' por ' + esc(D.unitLabel(p.unit, 1)) + ' · ' + (p.available > 0 ? '<span class="okt">' + plural(p.available, 'disponible', 'disponibles') + '</span>' : '<span class="badt">Sin stock</span>') + '</small></div>' +
        '<div class="qty" role="group" aria-label="Cantidad de ' + esc(p.name) + '">' +
        '<button type="button" data-act="np-dec" data-sku="' + p.sku + '" aria-label="Quitar uno"' + (q <= 0 ? ' disabled' : '') + '>−</button>' +
        '<input type="number" inputmode="numeric" min="0" step="1" value="' + q + '" data-np-qty="' + p.sku + '" aria-label="Cantidad de ' + esc(p.name) + '">' +
        '<button type="button" data-act="np-inc" data-sku="' + p.sku + '" aria-label="Agregar uno">+</button></div>' +
        (q > p.available ? '<p class="np-warn">Pedís ' + q + ', hay ' + p.available + '</p>' : '') + '</li>';
    }).join('');
    var clientSel = '<label class="field"><span>Cliente</span><select id="np-client" required><option value="">Elegí el almacén…</option>' +
      clients.map(function (o) { return '<option value="' + o.id + '"' + (o.id === dr.almacenId ? ' selected' : '') + '>' + esc(o.name) + (o.zona ? ' · ' + esc(o.zona) : '') + '</option>'; }).join('') + '</select>' +
      (clients.length ? '' : '<small>No hay clientes activos. <a href="#/clientes">Crear un cliente</a></small>') + '</label>';
    var summary = '<aside class="np-summary card" id="np-summary" tabindex="-1" aria-label="Resumen del pedido"><h2>' + (dr.orderId ? 'Borrador ' + esc(dr.orderId) : 'Resumen') + '</h2>' + clientSel +
      (lines.length ? '<ul class="lines">' + lines.map(function (p) {
        var q = dr.lines[p.sku];
        return '<li><div><b>' + esc(p.name) + '</b><br><small>' + q + ' × ' + gs(p.price) + '</small></div><div>' + gs(q * p.price) + '</div></li>';
      }).join('') + '</ul>' : '<p class="muted small" style="margin:10px 0">Todavía no agregaste productos.</p>') +
      totalsHtml({ subtotal: subtotal, deliveryFee: fee, total: subtotal + (fee || 0) }) +
      '<div class="form" style="margin-top:12px">' + field('Entrega desde', '<input type="date" data-np-field="windowFrom" value="' + esc(dr.windowFrom) + '" min="' + t + '">') +
      field('Hasta', '<input type="date" data-np-field="windowTo" value="' + esc(dr.windowTo) + '" min="' + t + '">') +
      field('Observaciones', '<textarea data-np-field="notes" rows="2">' + esc(dr.notes) + '</textarea>', '', 'wide') + '</div>' +
      (problems ? '<p class="note bad small">Hay ' + plural(problems, 'producto', 'productos') + ' con más cantidad que la disponible: no se reserva en forma parcial.</p>' : '') +
      '<div class="form-error" role="alert" id="np-error"></div>' +
      '<div class="actions np-actions"><button class="btn primary lg" type="button" data-act="np-confirm"' + (lines.length ? '' : ' disabled') + '>Confirmar y reservar</button>' +
      '<button class="btn" type="button" data-act="np-save"' + (lines.length ? '' : ' disabled') + '>Guardar borrador</button>' +
      (lines.length || dr.almacenId ? '<button class="btn" type="button" data-act="np-clear">Vaciar</button>' : '') + '</div></aside>';
    var picker = '<section class="np-picker card"><div class="np-tools"><label class="search"><span class="sr-only">Buscar producto</span>' + icon('search') +
      '<input type="search" id="np-search" placeholder="Buscar producto o categoría" autocomplete="off"></label>' +
      '<div class="chips" role="group" aria-label="Categoría"><button class="chip" type="button" data-act="np-cat" data-id="" aria-pressed="true">Todo</button>' +
      cats.map(function (k) { return '<button class="chip" type="button" data-act="np-cat" data-id="' + esc(k.name) + '" aria-pressed="false">' + esc(k.name) + '</button>'; }).join('') + '</div></div>' +
      (orderable.length ? '<ul class="np-list" id="np-list">' + rows + '</ul><p class="empty" id="np-none" hidden>Ningún producto coincide con la búsqueda.</p>'
        : '<p class="empty">Todavía no hay productos con precio. Cargá los precios en <a href="#/precios">Precios</a> para poder armar pedidos.</p>') +
      (pending && orderable.length ? '<p class="small muted" style="margin-top:10px">' + plural(pending, 'producto', 'productos') + ' del catálogo todavía sin precio no aparecen acá.</p>' : '') + '</section>';
    var mobileBar = lines.length ? '<button type="button" class="cartbar np-bar" data-act="np-ver-resumen"><span><b>' + lines.length + '</b> producto' + (lines.length === 1 ? '' : 's') + ' · <b>' + gs(subtotal) + '</b></span><span class="go">Ver resumen</span></button>' : '';
    return head(dr.orderId ? 'Editar pedido ' + dr.orderId : 'Nuevo pedido', 'Elegí el cliente y los productos. Al confirmar se reserva el stock y se fijan los precios.',
      '<a class="btn" href="#/pedidos">Ver pedidos</a>') +
      '<div class="np-layout">' + picker + summary + '</div>' + mobileBar;
  }

  var PAGES = {
    'ingresar': pageIngresar, 'cuenta': pageCuenta,
    'inicio': pageInicio, 'producto': pageProducto, 'tienda': pageTienda, 'mi-pedido': pageMiPedido, 'mis-pedidos': pageMisPedidos, 'mi-interes': pageMiInteres,
    'mi-oferta': pageMiOferta, 'lo-recibido': pageLoRecibido, 'mis-productos': pageMisProductos,
    'panel': pagePanel, 'recepcion': pageRecepcion, 'stock': pageStock, 'pedidos': pagePedidos, 'nuevo-pedido': pageNuevoPedido, 'cruce': pageCruce,
    'clientes': pageClientes, 'precios': pagePrecios, 'catalogo': pageCatalogo, 'movimientos': pageMovimientos,
    'usuarios': pageUsuarios, 'auditoria': pageAuditoria, 'config': pageConfig
  };

  function render() {
    if (!server.loaded) {
      document.body.className = 'mode-auth';
      $('main').innerHTML = '<div class="offline"><img src="assets/logo-yvy.jpg" alt="" width="64" height="64"><h1>No se pudo conectar con el servidor</h1>' +
        '<p class="muted">Revisá la conexión a internet o que el servidor esté encendido.</p><button class="btn primary" type="button" data-act="reconectar">Intentar de nuevo</button></div>';
      return;
    }
    renderChrome();
    var warn = !server.online ? '<p class="note bad" style="margin-bottom:12px">Sin conexión con el servidor: lo que ves puede no estar actualizado y los cambios no se guardan hasta reconectar.</p>' : '';
    $('main').innerHTML = warn + PAGES[currentPage()]();
    filterShop();
    filterDraft();
    saveUi();
  }

  // ---------- formularios de página ----------

  function fdObj(form) {
    var o = {};
    new FormData(form).forEach(function (v, k) { o[k] = v; });
    return o;
  }
  var FORMS = {
    login: function (f) {
      return api('/api/ingresar', { username: f.username, password: f.password }).then(function (r) {
        if (r.ok) {
          ui.viewAs = null;
          saveUi();
          location.hash = '#/' + LANDING[r.me.role];
        }
        return r;
      });
    },
    setup: function (f) {
      var problem = passwordProblem(f.p1, f.p2);
      if (problem) return { ok: false, message: problem };
      return api('/api/configurar', { name: f.name, username: f.username, password: f.p1 }).then(function (r) {
        if (r.ok) location.hash = '#/panel';
        return r;
      });
    },
    password: function (f) {
      var me = sessionUser();
      var problem = passwordProblem(f.p1, f.p2);
      if (problem) return { ok: false, message: problem };
      return api('/api/contrasena', { id: me.id, current: f.current, password: f.p1 });
    },
    tienda: function (f) {
      return run('config.actualizar', { storeName: f.storeName });
    },
    oferta: function (f) {
      return run('oferta.registrar', { coopId: f.coopId, sku: f.sku, qty: num(f.qty), unit: f.unit, windowFrom: f.windowFrom, windowTo: f.windowTo, kind: f.kind, confirmation: f.confirmation, origin: f.origin, notes: f.notes });
    },
    demanda: function (f) {
      return run('demanda.registrar', { almacenId: f.almacenId, sku: f.sku, qty: num(f.qty), unit: f.unit, windowFrom: f.windowFrom, windowTo: f.windowTo, kind: f.kind, notes: f.notes });
    },
    periodo: function (f) {
      if (!D.isDate(f.from) || !D.isDate(f.to)) return { ok: false, message: 'Elegí las dos fechas del período.' };
      if (f.to < f.from) return { ok: false, message: 'La fecha "hasta" es anterior a "desde".' };
      if (f.to > today()) return { ok: false, message: 'El período no puede terminar en el futuro.' };
      ui.pFrom = f.from;
      ui.pTo = f.to;
      saveUi();
      return { ok: true, summary: 'Período: del ' + fdate(f.from) + ' al ' + fdate(f.to) + '.' };
    },
    recepcion: function (f) {
      return run('recepcion.registrar', {
        coopId: f.coopId, depositoId: f.depositoId, sku: f.sku, lotCode: f.lotCode, qtyDeclared: num(f.qtyDeclared), qtyReceived: num(f.qtyReceived), qtyReleased: num(f.qtyReleased),
        blockReason: f.blockReason, discrepancyNote: f.discrepancyNote, receivedDate: f.receivedDate, expiry: f.expiry || null, responsible: f.responsible, notes: f.notes
      });
    },
    config: function (f) {
      return run('config.actualizar', { deliveryFee: num(f.deliveryFee), nearExpiryDays: num(f.nearExpiryDays) });
    },
    categoria: function (f) {
      return run('categoria.actualizar', { id: f.id, requiresExpiry: f.requiresExpiry === 'on', requiresDoc: f.requiresDoc === 'on', qualityNote: f.qualityNote });
    }
  };

  // ---------- diálogos ----------

  function lotDialog(kind, lotId) {
    var l = D.byId(state.lots, lotId);
    var p = D.productOf(state, l.sku);
    var u = D.UNITS[p.stockUnit].many;
    var info = '<p class="small muted">' + esc(p.name) + ' · lote ' + esc(l.code) + ' · liberado ' + l.liberado + ', bloqueado ' + l.bloqueado + ', reservado ' + l.reserved + ' ' + esc(u) + '</p>';
    if (kind === 'bloquear') {
      openDialog('Bloquear mercadería', info + field('Cantidad a bloquear (' + u + ')', input('qty', 'number', '', 'min="1" step="1" inputmode="numeric" required')) + field('Motivo', input('reason', 'text', '', 'required')), 'Bloquear', function (f) {
        return run('lote.bloquear', { lotId: lotId, qty: num(f.qty), reason: f.reason });
      });
    } else if (kind === 'liberar') {
      openDialog('Liberar para la venta', info + '<p class="note warn small">Procedimiento de calidad por validar. Dejá constancia de qué se verificó.</p>' +
        field('Cantidad a liberar (' + u + ')', input('qty', 'number', l.bloqueado, 'min="1" step="1" inputmode="numeric" required')) + field('Verificación realizada', input('note', 'text', '', 'required')), 'Liberar', function (f) {
        return run('lote.liberar', { lotId: lotId, qty: num(f.qty), note: f.note });
      });
    } else {
      openDialog('Ajustar stock del lote', info +
        field('Sobre', select('bucket', [['liberado', 'Stock liberado'], ['bloqueado', 'Stock bloqueado']], 'liberado')) +
        field('Diferencia (' + u + ')', input('delta', 'number', '', 'step="1" inputmode="numeric" required'), 'Negativo para dar de baja (por ejemplo −2), positivo para sumar.') +
        field('Motivo', input('reason', 'text', '', 'required'), 'Rotura, descarte, error de conteo…'), 'Registrar ajuste', function (f) {
        return run('lote.ajustar', { lotId: lotId, bucket: f.bucket, delta: num(f.delta), reason: f.reason });
      });
    }
  }
  function precioDialog(sku) {
    var p = D.productOf(state, sku);
    var pr = p.pricing;
    var n = function (name, label, hint) { return field(label + ' (Gs.)', input(name, 'number', pr[name], 'min="0" step="1" inputmode="numeric"'), hint); };
    openDialog('Precios de ' + p.name, '<p class="small muted">Por ' + esc(D.unitLabel(p.saleUnit, 1)) + '. Dejá vacío lo que todavía no se sabe: se mostrará “Sin datos”.</p>' +
      n('costoProveedor', 'Costo pagado al proveedor', 'Lo que recibe la cooperativa.') + n('costoLogistico', 'Costo logístico por unidad', 'Si todavía no se midió, dejar vacío.') +
      n('precioAlmacen', 'Precio al almacén', 'Sin este precio el producto se muestra como “Precio a confirmar” y no se puede pedir.') + n('precioSugerido', 'Precio final sugerido', 'Opcional. Es una sugerencia para el almacén.'),
      'Guardar precios', function (f) {
        return run('precio.actualizar', { sku: sku, costoProveedor: num(f.costoProveedor), costoLogistico: num(f.costoLogistico), precioAlmacen: num(f.precioAlmacen), precioSugerido: num(f.precioSugerido) });
      });
  }
  function productoDialog(sku) {
    var p = sku ? D.productOf(state, sku) : { sku: '', name: '', coopId: '', origin: '', categoryId: state.categories[0].id, presentation: '', stockUnit: 'unidad', saleUnit: 'unidad', saleFactor: 1, status: 'activo', docRequired: false, docRef: '', recipes: [], story: '', claims: [] };
    var coops = [['', 'Origen por definir']].concat(orgs('cooperativa').map(function (o) { return [o.id, o.name]; }));
    var r0 = (p.recipes || [])[0] || { title: '', minutes: null, servings: null, ingredients: [], steps: [] };
    var extra = (p.recipes || []).length > 1 ? '<p class="small muted">Este producto tiene ' + p.recipes.length + ' recetas; acá se edita la primera y las demás se conservan.</p>' : '';
    openDialog(sku ? 'Editar ' + p.name : 'Nuevo producto',
      '<div class="dlg-cols">' +
      field('SKU', input('sku', 'text', p.sku, sku ? 'readonly' : 'required autocomplete="off"'), sku ? 'El código no se cambia.' : 'Letras, números y guiones.') +
      field('Nombre', input('name', 'text', p.name, 'required')) +
      field('Cooperativa', select('coopId', coops, p.coopId || '')) + field('Marca u origen', input('origin', 'text', p.origin), 'Opcional') +
      field('Categoría', select('categoryId', state.categories.map(function (c) { return [c.id, c.name]; }), p.categoryId)) +
      field('Presentación', input('presentation', 'text', p.presentation, 'required'), 'Ej.: 300 g') +
      field('Unidad de stock', select('stockUnit', unitOptions(), p.stockUnit)) +
      field('Unidad de venta', select('saleUnit', unitOptions(), p.saleUnit)) +
      field('Unidades de stock por unidad de venta', input('saleFactor', 'number', p.saleFactor, 'min="1" step="1" inputmode="numeric"'), 'Si ambas unidades son iguales, es 1.') +
      field('Estado', select('status', Object.keys(D.PRODUCT_STATUS).map(function (k) { return [k, D.PRODUCT_STATUS[k]]; }), p.status), 'Solo “Activo” aparece en la tienda.') + '</div>' +
      '<label class="check"><input type="checkbox" name="docRequired"' + (p.docRequired ? ' checked' : '') + '> Exigir documento de regularización para vender</label>' +
      field('Documento de regularización (referencia)', input('docRef', 'text', p.docRef), 'Requisito por validar.') +
      '<h3 class="dlg-sec">Ficha de la tienda</h3>' +
      field('Descripción', '<textarea name="description" maxlength="1200" rows="3">' + esc(p.description || '') + '</textarea>') +
      field('Historia', '<textarea name="story" maxlength="1500" rows="4">' + esc(p.story || '') + '</textarea>', 'Opcional. Quién lo produce, de dónde viene, cómo se hace.') +
      field('Sellos declarados por el proveedor', input('claims', 'text', (p.claims || []).join(', ')), 'Separados por coma. Se muestran como “según declara el proveedor”.') +
      '<div class="field"><span>Foto</span><div class="row"><img class="thumb" id="photo-thumb" alt="" src="' + esc(p.photo || 'assets/logo-yvy.jpg') + '">' +
      '<label class="btn sm" for="photo-file">Elegir foto…</label><input class="sr-only" type="file" id="photo-file" accept="image/*">' +
      '<button class="btn sm" type="button" data-act="quitar-foto">Quitar</button></div><input type="hidden" name="photo" value="' + esc(p.photo || '') + '">' +
      '<small>La foto nueva se reduce y se guarda en este equipo.</small></div>' +
      field('Video (enlace)', input('video', 'text', p.video || '', 'inputmode="url" placeholder="https://… o assets/videos/archivo.mp4"'), 'YouTube, un enlace https a un archivo de video o un archivo dentro de assets/.') +
      '<h3 class="dlg-sec">Receta</h3>' + extra +
      '<div class="dlg-cols">' + field('Título', input('rTitle', 'text', r0.title, 'maxlength="90"'), 'Vacío = sin receta.') +
      field('Minutos', input('rMinutes', 'number', r0.minutes, 'min="1" step="1" inputmode="numeric"')) +
      field('Porciones', input('rServings', 'number', r0.servings, 'min="1" step="1" inputmode="numeric"')) + '</div>' +
      field('Ingredientes (uno por línea)', '<textarea name="rIngredients" rows="5">' + esc(r0.ingredients.join('\n')) + '</textarea>') +
      field('Preparación (un paso por línea)', '<textarea name="rSteps" rows="5">' + esc(r0.steps.join('\n')) + '</textarea>'),
      'Guardar producto', function (f) {
        var recipes = (p.recipes || []).slice(1);
        var lines = function (v) { return String(v || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); };
        if (f.rTitle.trim()) {
          recipes.unshift({ title: f.rTitle, minutes: num(f.rMinutes), servings: num(f.rServings), ingredients: lines(f.rIngredients), steps: lines(f.rSteps), uses: r0.uses || [] });
        }
        return run('producto.guardar', {
          isNew: !sku, sku: f.sku, name: f.name, coopId: f.coopId || null, origin: f.origin, categoryId: f.categoryId, presentation: f.presentation,
          stockUnit: f.stockUnit, saleUnit: f.saleUnit, saleFactor: num(f.saleFactor), status: f.status, docRequired: f.docRequired === 'on', docRef: f.docRef,
          description: f.description, story: f.story, claims: f.claims.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
          photo: f.photo, video: f.video, recipes: recipes
        });
      });
  }
  function usuarioDialog(id, preset) {
    var u = id ? D.byId(state.users, id) : Object.assign({ name: '', username: '', role: 'almacen', orgId: '', active: true }, preset || {});
    var orgOpts = [['', 'Yvy Guaraní S.A. (equipo interno)']].concat(state.orgs.map(function (o) { return [o.id, o.name + ' (' + (o.type === 'almacen' ? 'cliente' : 'cooperativa') + ')']; }));
    var roleHelp = '<ul class="small muted rolehelp"><li><b>Administración</b>: todo el sistema.</li><li><b>Ventas</b>: panel comercial, pedidos, clientes, precios y tienda.</li>' +
      '<li><b>Depósito</b>: recepción, stock, preparación y despacho.</li><li><b>Cooperativa</b>: su oferta y lo que el depósito recibió de ella.</li><li><b>Cliente (almacén)</b>: la tienda, su pedido y su historial.</li></ul>';
    openDialog(id ? 'Editar cuenta' : 'Nueva cuenta',
      '<div class="dlg-cols">' + field('Nombre', input('name', 'text', u.name, 'required')) +
      field('Usuario para ingresar', input('username', 'text', u.username || D.slug(u.name), 'required autocapitalize="none" spellcheck="false"'), 'Letras sin acento, números, punto o guion.') +
      field('Rol', select('role', Object.keys(D.ROLES).map(function (k) { return [k, D.ROLES[k]]; }), u.role)) +
      field('Organización', select('orgId', orgOpts, u.orgId || ''), 'Obligatoria para Cooperativa y Cliente.') + '</div>' + roleHelp +
      '<label class="check"><input type="checkbox" name="active"' + (u.active !== false ? ' checked' : '') + '> Cuenta activa</label>' +
      (id ? '' : '<p class="small muted">Después de guardar, usá “Crear acceso” para darle una contraseña.</p>'),
      'Guardar', function (f) {
        return run('usuario.guardar', { id: id || null, name: f.name, username: f.username, role: f.role, orgId: f.orgId || null, active: f.active === 'on' });
      });
  }
  function credencialDialog(id) {
    var u = D.byId(state.users, id);
    openDialog((u.cred ? 'Nueva contraseña para ' : 'Crear acceso para ') + u.name,
      '<p class="small muted">Usuario: <code>' + esc(u.username) + '</code>. Comunicá la contraseña a la persona por un medio seguro; podrá cambiarla en “Mi cuenta”.</p>' +
      field('Contraseña', input('p1', 'password', '', 'autocomplete="new-password" required minlength="8"'), 'Al menos 8 caracteres.') +
      field('Repetir contraseña', input('p2', 'password', '', 'autocomplete="new-password" required minlength="8"')),
      'Guardar contraseña', function (f) {
        var problem = passwordProblem(f.p1, f.p2);
        if (problem) return { ok: false, message: problem };
        return api('/api/contrasena', { id: id, password: f.p1 });
      });
  }
  function cooperativaDialog(id) {
    var o = id ? D.byId(state.orgs, id) : { name: '', zona: '', contacto: '', notes: '', active: true };
    openDialog(id ? 'Editar cooperativa' : 'Nueva cooperativa o proveedor',
      field('Nombre', input('name', 'text', o.name, 'required')) + field('Zona o localidad', input('zona', 'text', o.zona)) +
      field('Contacto', input('contacto', 'text', o.contacto)) + field('Notas', input('notes', 'text', o.notes)) +
      '<label class="check"><input type="checkbox" name="active"' + (o.active !== false ? ' checked' : '') + '> Activa</label>',
      'Guardar', function (f) {
        return run('cooperativa.guardar', { id: id || null, name: f.name, zona: f.zona, contacto: f.contacto, notes: f.notes, active: f.active === 'on' });
      });
  }
  function almacenDialog(id) {
    var o = id ? D.byId(state.orgs, id) : { name: '', zona: '', contacto: '', notes: '', active: true };
    openDialog(id ? 'Editar cliente' : 'Nuevo cliente',
      field('Nombre del almacén', input('name', 'text', o.name, 'required')) + field('Zona o barrio', input('zona', 'text', o.zona)) +
      field('Contacto', input('contacto', 'text', o.contacto)) + field('Notas', input('notes', 'text', o.notes)) +
      '<label class="check"><input type="checkbox" name="active"' + (o.active ? ' checked' : '') + '> Activo (puede hacer pedidos)</label>',
      'Guardar', function (f) {
        return run('almacen.guardar', { id: id || null, name: f.name, zona: f.zona, contacto: f.contacto, notes: f.notes, active: f.active === 'on' });
      });
  }
  /** Reemplaza los datos de este equipo conservando la cuenta de Administración en uso. */
  function replaceData(title, body, label, nombre) {
    openDialog(title, body + '<p class="small muted">Antes de reemplazar, el servidor guarda una copia de seguridad. Tu cuenta se conserva; las demás sesiones se cierran.</p>', label, function () {
      return api('/api/escenario', { nombre: nombre }).then(function (r) {
        if (r.ok) {
          ui.carts = {};
          ui.draft = null;
          ui.viewAs = null;
          ui.period = '30';
          saveUi();
        }
        return r;
      });
    }, true);
  }

  function setCartQty(sku, q) {
    var c = cart();
    if (!isFinite(q) || q <= 0) delete c.lines[sku];
    else c.lines[sku] = Math.floor(q);
    saveUi();
    render();
  }
  function confirmCart() {
    var c = cart();
    var lines = Object.keys(c.lines).map(function (sku) { return { sku: sku, qty: c.lines[sku] }; });
    return run('pedido.guardarBorrador', { orderId: c.orderId, lines: lines, windowFrom: c.windowFrom || null, windowTo: c.windowTo || null, notes: c.notes }).then(function (saved) {
      if (!saved.ok) { render(); return cartError(saved.message); }
      c.orderId = saved.result.orderId;
      saveUi();
      return run('pedido.confirmar', { orderId: c.orderId }).then(function (r) {
        if (!r.ok) {
          render();
          return cartError(r.message + ' Quedó guardado como borrador ' + c.orderId + '.');
        }
        delete ui.carts[actor().orgId];
        saveUi();
        toast(r.summary);
        go('mis-pedidos');
      });
    });
  }
  function cartError(msg) {
    var el = $('cart-error');
    if (el) { el.textContent = msg; el.scrollIntoView({ block: 'nearest' }); }
    toast(msg, true);
  }

  // ---------- acciones ----------

  var ACTIONS = {
    'logout': function () { logout(); },
    'reconectar': function () { refresh(); },
    'skip': function () { $('main').focus(); },
    'np-ver-resumen': function () { var s = $('np-summary'); if (s) { s.scrollIntoView({ block: 'start' }); s.focus({ preventScroll: true }); } },
    'salir-vista': function () {
      ui.viewAs = null;
      saveUi();
      refresh().then(function () { go('usuarios'); });
    },
    'actualizar': function () { $('update').hidden = true; refresh(true); },
    'ver-como': function (el) {
      var u = D.byId(state.users, el.dataset.id);
      if (!u) return;
      ui.viewAs = u.id;
      saveUi();
      refresh().then(function () {
        location.hash = '#/' + LANDING[u.role];
        render();
        window.scrollTo(0, 0);
      });
    },
    'credencial': function (el) { credencialDialog(el.dataset.id); },
    'cuenta-cliente': function (el) {
      var o = D.byId(state.orgs, el.dataset.id);
      usuarioDialog(null, { name: o.name, username: D.slug(o.name), role: 'almacen', orgId: o.id });
    },
    'editar-cooperativa': function (el) { cooperativaDialog(el.dataset.id); },
    'pedido-para': function (el) {
      ui.draft = { almacenId: el.dataset.id, lines: {}, windowFrom: '', windowTo: '', notes: '', orderId: null };
      saveUi();
      go('nuevo-pedido');
    },
    'nuevo-pedido': function () {
      var d = draft();
      if (d.orderId) ui.draft = null;
      saveUi();
      go('nuevo-pedido');
    },
    'editar-borrador': function (el) {
      var o = D.byId(state.orders, el.dataset.id);
      var lines = {};
      o.lines.forEach(function (ln) { lines[ln.sku] = ln.qty; });
      ui.draft = { almacenId: o.almacenId, lines: lines, windowFrom: o.windowFrom || '', windowTo: o.windowTo || '', notes: o.notes || '', orderId: o.id };
      saveUi();
      go('nuevo-pedido');
    },
    'np-inc': function (el) { setDraftQty(el.dataset.sku, (draft().lines[el.dataset.sku] || 0) + 1); },
    'np-dec': function (el) { setDraftQty(el.dataset.sku, (draft().lines[el.dataset.sku] || 0) - 1); },
    'np-cat': function (el) {
      document.querySelectorAll('[data-act="np-cat"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === el)); });
      filterDraft();
    },
    'np-clear': function () { ui.draft = null; saveUi(); render(); },
    'np-save': function () { saveDraft(false); },
    'np-confirm': function () { saveDraft(true); },
    'cargar-inicial': function () {
      replaceData('Volver al catálogo inicial', '<p>Se borran pedidos, stock, clientes y cuentas de este equipo y se vuelve al catálogo inicial de ' + D.fmtInt(Cat.count) + ' productos, sin precios.</p>',
        'Volver al catálogo inicial', 'inicial');
    },
    'cargar-prueba': function () {
      replaceData('Cargar escenario de prueba', '<p>Se reemplazan los datos por el escenario ficticio del guion de aceptación (productos de prueba, sin el catálogo real).</p>',
        'Cargar escenario de prueba', 'prueba');
    },
    'demo': function () {
      replaceData('Cargar demostración', '<p>Se generan <b>13 semanas de actividad ficticia</b> sobre el catálogo real: clientes de ejemplo, precios inventados en 12 productos, recepciones, pedidos, faltantes y entregas, con las mismas reglas del sistema.</p>' +
        '<p class="note warn small">Sirve para presentar el panel con historia. No es una proyección ni un volumen esperado. Los precios no son los definitivos.</p>',
        'Cargar demostración', 'demo');
    },
    'menu': function (el) {
      var open = $('side').classList.toggle('open');
      el.setAttribute('aria-expanded', String(open));
    },
    'shop-cat': function (el) {
      document.querySelectorAll('[data-act="shop-cat"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === el)); });
      filterShop();
    },
    'quitar-foto': function (el) {
      el.form.elements.photo.value = '';
      $('photo-thumb').src = 'assets/logo-yvy.jpg';
    },
    'cart-inc': function (el) { setCartQty(el.dataset.sku, (cart().lines[el.dataset.sku] || 0) + 1); },
    'cart-dec': function (el) { setCartQty(el.dataset.sku, (cart().lines[el.dataset.sku] || 0) - 1); },
    'cart-clear': function () { delete ui.carts[actor().orgId]; saveUi(); render(); },
    'cart-confirm': confirmCart,
    'borrador-a-carrito': function (el) {
      var o = D.byId(state.orders, el.dataset.id);
      var c = cart();
      c.lines = {};
      o.lines.forEach(function (ln) { c.lines[ln.sku] = ln.qty; });
      c.orderId = o.id; c.windowFrom = o.windowFrom || ''; c.windowTo = o.windowTo || ''; c.notes = o.notes || '';
      saveUi();
      go('mi-pedido');
    },
    'confirmar': function (el) { act('pedido.confirmar', { orderId: el.dataset.id }); },
    'preparar': function (el) { act('pedido.preparar', { orderId: el.dataset.id }); },
    'ajustar-disponible': function (el) {
      var id = el.dataset.id;
      openDialog('Ajustar a lo disponible', '<p>Las cantidades del borrador ' + id + ' se bajan al stock disponible hoy y se quitan los productos sin stock. Es una decisión del operador: conviene avisar al almacén antes de confirmar.</p>', 'Ajustar borrador', function () {
        return run('pedido.ajustarADisponible', { orderId: id });
      });
    },
    'despachar': function (el) {
      var o = D.byId(state.orders, el.dataset.id);
      openDialog('Despachar pedido ' + o.id, '<p class="small muted">' + esc(orgName(o.almacenId)) + '. Al despachar, el stock sale del depósito. No se puede deshacer.</p>' +
        field('Responsable de la entrega', input('responsible', 'text', '', 'required')) +
        field('Ventana de entrega: desde', input('windowFrom', 'date', o.windowFrom || today())) + field('Hasta', input('windowTo', 'date', o.windowTo || o.windowFrom || today())) +
        field('Observación', input('notes', 'text', ''), 'Opcional. Ruta, vehículo, referencia.'), 'Despachar', function (f) {
        return run('pedido.despachar', { orderId: o.id, responsible: f.responsible, windowFrom: f.windowFrom || null, windowTo: f.windowTo || null, notes: f.notes });
      });
    },
    'entregar': function (el) {
      var id = el.dataset.id;
      openDialog('Marcar entregado el pedido ' + id, field('Observación de entrega', input('notes', 'text', ''), 'Opcional. Quién recibió, novedades.'), 'Marcar entregado', function (f) {
        return run('pedido.entregar', { orderId: id, notes: f.notes });
      });
    },
    'cancelar': function (el) {
      var o = D.byId(state.orders, el.dataset.id);
      openDialog('Cancelar pedido ' + o.id, '<p>' + (o.status === 'borrador' ? 'El borrador no tiene stock reservado.' : 'Se libera el stock reservado, una sola vez.') + '</p>' +
        field('Motivo', input('reason', 'text', '', o.status === 'borrador' ? '' : 'required')), 'Cancelar pedido', function (f) {
        return run('pedido.cancelar', { orderId: o.id, reason: f.reason });
      }, true);
    },
    'filtro-pedidos': function (el) { ui.orderFilter = el.dataset.id; render(); },
    'anular-oferta': function (el) { act('oferta.anular', { id: el.dataset.id }); },
    'anular-demanda': function (el) { act('demanda.anular', { id: el.dataset.id }); },
    'lote-bloquear': function (el) { lotDialog('bloquear', el.dataset.id); },
    'lote-liberar': function (el) { lotDialog('liberar', el.dataset.id); },
    'lote-ajustar': function (el) { lotDialog('ajustar', el.dataset.id); },
    'editar-almacen': function (el) { almacenDialog(el.dataset.id); },
    'editar-precio': function (el) { precioDialog(el.dataset.id); },
    'editar-producto': function (el) { productoDialog(el.dataset.id); },
    'editar-usuario': function (el) { usuarioDialog(el.dataset.id); },
    'exportar': function () {
      var a = document.createElement('a');
      a.href = '/api/respaldo';
      a.download = 'yvy-respaldo-' + today() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('Descargando el respaldo…');
    },
    'periodo': function (el) {
      ui.period = el.dataset.id;
      if (ui.period === 'custom' && !(D.isDate(ui.pFrom) && D.isDate(ui.pTo))) {
        ui.pTo = today();
        ui.pFrom = D.addDays(ui.pTo, -29);
      }
      saveUi();
      render();
    },
    'csv': function (el) { exportCsv(el.dataset.id); },
  };

  // ---------- eventos ----------

  document.addEventListener('click', function (e) {
    var close = e.target.closest('[data-close]');
    if (close) return closeDialog();
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el.tagName === 'A') e.preventDefault();
    var fn = ACTIONS[el.dataset.act];
    if (fn) fn(el);
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    e.preventDefault();
    var err = form.querySelector('.form-error');
    var r;
    var busy = form.querySelector('[type="submit"]');
    var finish = function (res, inDialog) {
      if (busy) busy.disabled = false;
      if (res && res.ok === false) {
        if (err) { err.textContent = res.message; err.scrollIntoView({ block: 'nearest' }); }
        return;
      }
      if (inDialog) closeDialog();
      if (res && res.summary) toast(res.summary);
      render();
    };
    if (form.closest('#dlg')) {
      if (!dialogSubmit) return;
      r = dialogSubmit(fdObj(form));
      if (r && typeof r.then === 'function') {
        if (busy) busy.disabled = true;
        r.then(function (res) { finish(res, true); }, function (ex) { finish({ ok: false, message: 'No se pudo completar: ' + ex.message }, true); });
        return;
      }
      return finish(r, true);
    }
    var handler = FORMS[form.dataset.form];
    if (!handler) return;
    r = handler(fdObj(form));
    if (r && typeof r.then === 'function') {
      if (busy) busy.disabled = true;
      r.then(function (res) { finish(res, false); }, function (ex) { finish({ ok: false, message: 'No se pudo completar: ' + ex.message }, false); });
      return;
    }
    finish(r, false);
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'np-client') {
      draft().almacenId = t.value;
      saveUi();
      return render();
    }
    if (t.dataset.npQty) return setDraftQty(t.dataset.npQty, Number(t.value));
    if (t.id === 'shop-sort') return filterShop();
    if (t.dataset.cartQty) return setCartQty(t.dataset.cartQty, Number(t.value));
    if (t.dataset.cartField) {
      cart()[t.dataset.cartField] = t.value;
      return saveUi();
    }
    if (t.dataset.change === 'mov-sku') {
      ui.movSku = t.value;
      return render();
    }
    if (t.hasAttribute('data-unit-source')) {
      // Al elegir producto, se propone su unidad de stock (se puede cambiar: el cruce avisa si no convierte).
      var p = D.productOf(state, t.value);
      var target = t.form.querySelector('[data-unit-target]');
      if (p && target) target.value = p.stockUnit;
    }
    if (t.hasAttribute('data-unit-hint')) {
      var prod = D.productOf(state, t.value);
      var label = t.form.querySelector('[data-unit-label]');
      if (label) label.textContent = prod ? 'En ' + D.UNITS[prod.stockUnit].many + ' (' + prod.presentation + ').' : 'En la unidad de stock del producto.';
    }
    if (t.id === 'import-file' && t.files && t.files[0]) importFile(t.files[0]);
    if (t.id === 'photo-file' && t.files && t.files[0]) loadPhoto(t.files[0], t.form);
  });

  // ---------- nuevo pedido: acciones ----------

  function setDraftQty(sku, q) {
    var d = draft();
    if (!isFinite(q) || q <= 0) delete d.lines[sku];
    else d.lines[sku] = Math.floor(q);
    saveUi();
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }
  function draftError(msg) {
    var el = $('np-error');
    if (el) { el.textContent = msg; el.scrollIntoView({ block: 'nearest' }); }
    toast(msg, true);
  }
  function saveDraft(confirm) {
    var d = draft();
    if (!d.almacenId) return draftError('Elegí el cliente del pedido.');
    var lines = Object.keys(d.lines).filter(function (k) { return d.lines[k] > 0; }).map(function (sku) { return { sku: sku, qty: d.lines[sku] }; });
    if (!lines.length) return draftError('Agregá al menos un producto.');
    document.querySelectorAll('.np-actions .btn').forEach(function (b) { b.disabled = true; });
    return run('pedido.guardarBorrador', { orderId: d.orderId, almacenId: d.almacenId, lines: lines, windowFrom: d.windowFrom || null, windowTo: d.windowTo || null, notes: d.notes }).then(function (saved) {
      if (!saved.ok) { render(); return draftError(saved.message); }
      d.orderId = saved.result.orderId;
      saveUi();
      if (!confirm) {
        ui.draft = null;
        ui.orderFilter = 'borrador';
        saveUi();
        toast('Borrador ' + saved.result.orderId + ' guardado.');
        return go('pedidos');
      }
      return run('pedido.confirmar', { orderId: d.orderId }).then(function (r) {
        if (!r.ok) {
          render();
          return draftError(r.message + ' Quedó guardado como borrador ' + d.orderId + '.');
        }
        ui.draft = null;
        ui.orderFilter = 'activos';
        saveUi();
        toast(r.summary);
        go('pedidos');
      });
    });
  }
  function filterDraft() {
    var list = $('np-list');
    if (!list) return;
    var q = ($('np-search').value || '').trim().toLowerCase();
    var pressed = document.querySelector('[data-act="np-cat"][aria-pressed="true"]');
    var cat = pressed ? pressed.dataset.id : '';
    var shown = 0;
    list.querySelectorAll('.np-row').forEach(function (row) {
      var ok = (!q || row.dataset.search.indexOf(q) !== -1) && (!cat || row.dataset.cat === cat);
      row.hidden = !ok;
      if (ok) shown++;
    });
    $('np-none').hidden = shown > 0;
  }

  /** Filtra y ordena la tienda sin volver a dibujar (no se pierde el foco del buscador). */
  function filterShop() {
    var grid = $('shop-grid');
    if (!grid) return;
    var q = ($('shop-search').value || '').trim().toLowerCase();
    var pressed = document.querySelector('[data-act="shop-cat"][aria-pressed="true"]');
    var cat = pressed ? pressed.dataset.id : '';
    var sort = $('shop-sort') ? $('shop-sort').value : '';
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.pcard'));
    if (!grid.dataset.ordered) cards.forEach(function (c, i) { c.dataset.i = i; });
    grid.dataset.ordered = '1';
    cards.sort(function (a, b) {
      if (sort === 'name') return a.dataset.name.localeCompare(b.dataset.name);
      if (sort === 'av') return Number(b.dataset.av) - Number(a.dataset.av) || a.dataset.i - b.dataset.i;
      return a.dataset.i - b.dataset.i;
    }).forEach(function (c) { grid.appendChild(c); });
    var shown = 0;
    cards.forEach(function (card) {
      var ok = (!q || card.dataset.search.indexOf(q) !== -1) && (!cat || card.dataset.cat === cat);
      card.hidden = !ok;
      if (ok) shown++;
    });
    $('shop-none').hidden = shown > 0;
    if ($('shop-count')) $('shop-count').textContent = plural(shown, 'producto', 'productos');
  }

  document.addEventListener('input', function (e) {
    if (e.target.id === 'shop-search') filterShop();
    if (e.target.id === 'np-search') filterDraft();
    if (e.target.dataset && e.target.dataset.npField) {
      draft()[e.target.dataset.npField] = e.target.value;
      saveUi();
    }
  });

  /** Reduce la foto antes de guardarla: el almacenamiento del navegador es chico. */
  function loadPhoto(file, form) {
    var err = form.querySelector('.form-error');
    if (!/^image\//.test(file.type)) { err.textContent = 'El archivo elegido no es una imagen.'; return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var max = 900;
      var k = Math.min(1, max / Math.max(img.width, img.height));
      var cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k);
      cv.height = Math.round(img.height * k);
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      var data = cv.toDataURL('image/jpeg', 0.8);
      form.elements.photo.value = data;
      $('photo-thumb').src = data;
      err.textContent = '';
    };
    img.onerror = function () { URL.revokeObjectURL(url); err.textContent = 'No se pudo leer la imagen.'; };
    img.src = url;
  }

  function importFile(file) {
    var errBox = $('import-error');
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(String(reader.result)); } catch (e) { errBox.textContent = 'El archivo no es un JSON válido. No se cambió nada.'; return; }
      var imp = D.importBackup(parsed);
      if (!imp.ok) { errBox.textContent = 'No se importó. ' + imp.errors.join(' '); return; }
      openDialog('Importar respaldo', '<p>El archivo es válido (exportado el ' + fdatetime(parsed.exportedAt) + '). Al importar se reemplazan todos los datos del servidor. Antes se guarda una copia de seguridad.</p>', 'Reemplazar datos', function () {
        return api('/api/respaldo', { backup: parsed }).then(function (r) {
          if (r.ok) { ui.carts = {}; ui.draft = null; saveUi(); }
          return r;
        });
      }, true);
    };
    reader.readAsText(file);
  }

  window.addEventListener('hashchange', function () {
    render();
    window.scrollTo(0, 0);
  });
  // Al cerrar un diálogo o salir de un campo, se aplican los cambios de otras personas que quedaron pendientes.
  document.addEventListener('focusout', function () { setTimeout(function () { if (pendingRefresh && !busyEditing()) { $('update').hidden = true; refresh(true); } }, 200); });
  $('dlg').addEventListener('close', function () { if (pendingRefresh) { $('update').hidden = true; refresh(true); } });

  window.addEventListener('scroll', function () {
    document.querySelector('.top').classList.toggle('scrolled', window.scrollY > 24);
  }, { passive: true });

  loadUi();
  state = D.emptyState();
  refresh().then(connectEvents);
})();
