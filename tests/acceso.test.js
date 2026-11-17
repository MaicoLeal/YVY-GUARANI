// Cuentas, niveles de acceso, catálogo real y migración a la versión 3.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/domain.js');
const C = require('../js/catalogo.js');
const { buildInicial, buildSeed, buildDemo } = require('../js/seed.js');

const NOW = new Date(2026, 10, 16, 10, 0, 0);
const TODAY = D.localDate(NOW);
const CRED = { algo: 'PBKDF2-SHA256', iter: 210000, salt: 'a'.repeat(32), hash: 'b'.repeat(64) };

function run(state, actor, type, payload) {
  return D.execute(state, actor, { type, payload }, NOW);
}

test('datos iniciales: catálogo real completo, con foto, sin precio y visible en la tienda sin poder pedirse', () => {
  const s = buildInicial(NOW);
  assert.equal(s.products.length, C.count);
  assert.equal(s.users.length, 1);
  assert.equal(s.users[0].role, 'admin');
  assert.equal(s.users[0].cred, null);
  assert.equal(s.orders.length + s.lots.length, 0);
  assert.equal(s.settings.storeName, D.DEFAULT_STORE_NAME);
  assert.deepEqual(D.checkInvariants(s), []);
  s.products.forEach((p) => {
    assert.match(p.photo, /^assets\/productos\/eco-\d+\.jpg$/);
    assert.deepEqual(p.pricing, { costoProveedor: null, costoLogistico: null, precioAlmacen: null, precioSugerido: null });
  });
  const shop = D.storefront(s, TODAY);
  assert.equal(shop.length, C.count);
  assert.ok(shop.every((p) => p.price === null && p.orderable === false && p.available === 0));
  assert.ok(shop.some((p) => p.recipes.length && p.story));
});

test('cada producto del catálogo pasa la validación de la ficha (ida y vuelta por producto.guardar)', () => {
  let s = buildInicial(NOW);
  const admin = s.users[0];
  for (const p of s.products.slice()) {
    const r = run(s, admin, 'producto.guardar', Object.assign({}, p, { isNew: false }));
    assert.equal(r.ok, true, p.sku + ': ' + r.message);
    s = r.state;
    const after = D.productOf(s, p.sku);
    assert.deepEqual(after.recipes, p.recipes, p.sku);
    assert.equal(after.story, p.story);
    assert.deepEqual(after.claims, p.claims);
  }
});

test('recetas: se validan y la ficha nunca expone costos', () => {
  const s = buildInicial(NOW);
  const admin = s.users[0];
  const p = Object.assign({}, D.productOf(s, 'ECO-770'), { isNew: false });
  const save = (recipes) => run(s, admin, 'producto.guardar', Object.assign({}, p, { recipes }));
  assert.equal(save([{ title: '', ingredients: ['x'], steps: ['y'] }]).code, 'CAMPO_REQUERIDO');
  assert.equal(save([{ title: 'A', ingredients: [], steps: ['y'] }]).code, 'CAMPO_REQUERIDO');
  assert.equal(save([1, 2, 3, 4].map(() => ({ title: 'A', ingredients: ['x'], steps: ['y'] }))).code, 'VALOR_INVALIDO');
  assert.equal(save([{ title: 'A', minutes: 0, ingredients: ['x'], steps: ['y'] }]).code, 'VALOR_INVALIDO');
  const ok = save([{ title: 'A', minutes: 10, servings: 2, ingredients: ['x', ''], steps: ['y'], uses: ['ECO-889', 'NO-EXISTE'] }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(D.productOf(ok.state, 'ECO-770').recipes[0], { title: 'A', minutes: 10, servings: 2, ingredients: ['x'], steps: ['y'], uses: ['ECO-889'] });
  assert.ok(!/costo|pricing/i.test(JSON.stringify(D.storefront(ok.state, TODAY))));
});

test('cuentas: usuario único y obligatorio; la contraseña solo se guarda como hash válido', () => {
  let s = buildInicial(NOW);
  const admin = s.users[0];
  assert.equal(run(s, admin, 'usuario.guardar', { name: 'Ventas', role: 'comercial' }).code, 'USUARIO_INVALIDO');
  assert.equal(run(s, admin, 'usuario.guardar', { name: 'Ventas', username: 'Admin', role: 'comercial' }).code, 'USUARIO_DUPLICADO');
  let r = run(s, admin, 'usuario.guardar', { name: 'Ventas', username: 'Ventas.Uno', role: 'comercial' });
  assert.equal(r.ok, true);
  s = r.state;
  const ventas = D.byId(s.users, r.result.id);
  assert.equal(ventas.username, 'ventas.uno');
  assert.equal(ventas.cred, null);
  assert.equal(run(s, admin, 'usuario.credencial', { id: ventas.id, cred: Object.assign({}, CRED, { iter: 1000 }) }).code, 'VALOR_INVALIDO');
  assert.equal(run(s, admin, 'usuario.credencial', { id: ventas.id, cred: Object.assign({}, CRED, { salt: 'zz' }) }).code, 'VALOR_INVALIDO');
  r = run(s, admin, 'usuario.credencial', { id: ventas.id, cred: CRED });
  assert.equal(r.ok, true);
  s = r.state;
  assert.equal(D.byId(s.users, ventas.id).cred.hash, CRED.hash);
  // Cada uno cambia solo su propia contraseña; quitar accesos es de Administración.
  const v = D.byId(s.users, ventas.id);
  assert.equal(run(s, v, 'usuario.credencial', { id: admin.id, cred: CRED }).code, 'SIN_PERMISO');
  assert.equal(run(s, v, 'usuario.credencial', { id: v.id, cred: CRED }).ok, true);
  assert.equal(run(s, v, 'usuario.credencial', { id: v.id, cred: null }).code, 'SIN_PERMISO');
  // La auditoría nunca guarda el hash.
  assert.ok(!s.audit.some((a) => a.summary.includes(CRED.hash)));
});

test('siempre queda una cuenta de Administración activa y con acceso', () => {
  let s = buildInicial(NOW);
  const admin = s.users[0];
  assert.equal(run(s, admin, 'usuario.guardar', { id: admin.id, name: 'A', username: 'admin', role: 'comercial' }).code, 'ULTIMO_ADMIN');
  assert.equal(run(s, admin, 'usuario.guardar', { id: admin.id, name: 'A', username: 'admin', role: 'admin', active: false }).code, 'ULTIMO_ADMIN');
  s = run(s, admin, 'usuario.credencial', { id: admin.id, cred: CRED }).state;
  assert.equal(run(s, admin, 'usuario.credencial', { id: admin.id, cred: null }).code, 'ULTIMO_ADMIN');
  s = run(s, admin, 'usuario.guardar', { name: 'Otra admin', username: 'admin2', role: 'admin' }).state;
  assert.equal(run(s, admin, 'usuario.guardar', { id: admin.id, name: 'A', username: 'admin', role: 'comercial' }).ok, true);
});

test('niveles de acceso: cada rol solo hace lo suyo', () => {
  const s = buildSeed(NOW);
  const by = (role) => s.users.find((u) => u.role === role);
  const check = (role, type, expected) => assert.equal(D.can(by(role), type), expected, role + ' → ' + type);
  ['usuario.guardar', 'config.actualizar', 'cooperativa.guardar', 'producto.guardar'].forEach((t) => {
    check('admin', t, true);
    ['comercial', 'operacion', 'cooperativa', 'almacen'].forEach((r) => check(r, t, false));
  });
  check('comercial', 'precio.actualizar', true);
  check('operacion', 'precio.actualizar', false);
  check('almacen', 'precio.actualizar', false);
  check('operacion', 'recepcion.registrar', true);
  check('comercial', 'recepcion.registrar', false);
  check('almacen', 'pedido.confirmar', true);
  check('cooperativa', 'pedido.confirmar', false);
  check('cooperativa', 'oferta.registrar', true);
  check('almacen', 'oferta.registrar', false);
  // Un visitante sin cuenta no puede nada.
  assert.equal(D.can({ id: 'x', role: 'visitante' }, 'pedido.guardarBorrador'), false);
});

test('cooperativas y nombre comercial: solo Administración, con validación', () => {
  let s = buildInicial(NOW);
  const admin = s.users[0];
  assert.equal(run(s, admin, 'cooperativa.guardar', { name: 'ecoagro' }).code, 'DUPLICADO');
  let r = run(s, admin, 'cooperativa.guardar', { name: 'Proveedor de yuyos', zona: 'Central' });
  assert.equal(r.ok, true);
  s = r.state;
  assert.equal(D.byId(s.orgs, r.result.id).type, 'cooperativa');
  assert.equal(run(s, admin, 'config.actualizar', { storeName: '' }).code, 'CAMPO_REQUERIDO');
  r = run(s, admin, 'config.actualizar', { storeName: 'Yvy Kokue' });
  assert.equal(r.state.settings.storeName, 'Yvy Kokue');
});

test('migración 2 → 3: cuentas con usuario, sin contraseña, y fichas vacías', () => {
  const v2 = JSON.parse(JSON.stringify(buildSeed(NOW)));
  v2.schemaVersion = 2;
  delete v2.settings.storeName;
  v2.users.forEach((u) => { delete u.username; delete u.cred; });
  v2.users[1].name = v2.users[0].name; // dos nombres iguales → usuarios distintos
  v2.products.forEach((p) => { delete p.story; delete p.recipes; delete p.claims; });
  const imp = D.importBackup({ app: D.APP_ID, kind: 'respaldo-de-prueba', schemaVersion: 2, state: v2 });
  assert.equal(imp.ok, true, (imp.errors || []).join(' '));
  const st = imp.state;
  assert.equal(st.schemaVersion, D.SCHEMA_VERSION);
  assert.equal(st.settings.storeName, D.DEFAULT_STORE_NAME);
  const names = st.users.map((u) => u.username);
  assert.equal(new Set(names).size, names.length);
  assert.ok(st.users.every((u) => u.cred === null && /^[a-z0-9._-]{3,30}$/.test(u.username)));
  assert.ok(st.products.every((p) => p.story === '' && Array.isArray(p.recipes) && Array.isArray(p.claims)));
});

test('demostración sobre el catálogo real: clientes de ejemplo y precios ficticios solo en los productos usados', () => {
  const s = buildDemo(NOW);
  assert.equal(s.label, 'Demostración');
  const priced = s.products.filter((p) => p.pricing.precioAlmacen !== null);
  assert.equal(priced.length, 12);
  assert.ok(s.orgs.filter((o) => o.type === 'almacen').every((o) => /Ejemplo/.test(o.name)));
  assert.ok(s.users.every((u) => u.cred === null));
  assert.equal(D.storefront(s, TODAY).filter((p) => p.orderable).length, 12);
});
