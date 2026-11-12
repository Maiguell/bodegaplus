/**
 * HT10 — Pruebas de integración de la API con Supertest (controlador → servicios → MySQL).
 * Cada prueba valida código de respuesta, cuerpo y efecto en la base de datos.
 * Usa una base aparte que se recrea en cada corrida (el kardex es inmutable).
 *   npm run test:integracion
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.DB_NAME_TEST || 'bodega_sneakers_it';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const request = require('supertest');
const config = require('../../lib/config');
const { init, getPool, cerrar } = require('../../db');
const { app } = require('../../app');

let tk = {};          // tokens por usuario
let sedes = {};       // nombre → id
const q = async (sql, p) => (await getPool().query(sql, p))[0];
const stock = async (varianteId, ubicacionId) =>
  (await q('SELECT COALESCE(SUM(cantidad), 0) AS n FROM stock WHERE variante_id = ? AND ubicacion_id = ?', [varianteId, ubicacionId]))[0].n;
const login = async (usuario, password) => (await request(app).post('/api/auth/login').send({ usuario, password })).body.token;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

before(async () => {
  const { database, ...cfg } = config.db;
  const c = await mysql.createConnection(cfg);
  await c.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await c.end();
  await init();
  for (const s of await q('SELECT id, nombre FROM ubicaciones')) sedes[s.nombre] = s.id;
  tk.admin = await login('admin', config.seed.adminPassword);
  tk.vendedor = await login('vendedor', config.seed.demoPassword);
  tk.jefe = await login('jefe', config.seed.demoPassword);
});

after(async () => { await cerrar(); });

describe('HT10 · Integración de la API', () => {
  it('1. Autenticación JWT: login, ruta protegida, 401 sin token, 403 sin permiso y bloqueo tras 5 intentos', async () => {
    const ok = await request(app).post('/api/auth/login').send({ usuario: 'admin', password: config.seed.adminPassword });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token.split('.').length === 3, 'token JWT');
    assert.equal(ok.body.user.rol, 'ADMIN');
    assert.ok(ok.body.user.permisos.includes('usuarios'));

    assert.equal((await request(app).get('/api/inventario')).status, 401);
    assert.equal((await request(app).get('/api/auth/yo').set(auth(ok.body.token))).status, 200);
    assert.equal((await request(app).get('/api/usuarios').set(auth(tk.vendedor))).status, 403);

    const renov = await request(app).post('/api/auth/renovar').set(auth(ok.body.token));
    assert.equal(renov.status, 200);
    assert.ok(renov.body.token);

    for (let i = 1; i <= 4; i++) {
      const r = await request(app).post('/api/auth/login').send({ usuario: 'auditor', password: 'incorrecta1' });
      assert.equal(r.status, 401);
      assert.match(r.body.message, new RegExp(`${5 - i} intento`));
    }
    const quinto = await request(app).post('/api/auth/login').send({ usuario: 'auditor', password: 'incorrecta1' });
    assert.equal(quinto.status, 423);
    const [u] = await q("SELECT bloqueado_hasta FROM usuarios WHERE usuario = 'auditor'");
    assert.ok(new Date(u.bloqueado_hasta) > new Date(), 'quedó bloqueado en la BD');
    const conClaveBuena = await request(app).post('/api/auth/login').send({ usuario: 'auditor', password: config.seed.demoPassword });
    assert.equal(conClaveBuena.status, 423, 'sigue bloqueado aunque la clave sea correcta');
  });

  it('2. Entrada contra orden de compra hasta el kardex', async () => {
    const [oc] = await q("SELECT id FROM ordenes_compra WHERE codigo = 'OC-0012'");
    const det = await q('SELECT variante_id, cantidad_pedida FROM orden_compra_detalle WHERE orden_id = ? ORDER BY variante_id', [oc.id]);
    const [v1, v2] = det;
    const antes = await stock(v1.variante_id, sedes['Bodega Central']);

    const r = await request(app).post(`/api/ordenes-compra/${oc.id}/recepcion`).set(auth(tk.jefe))
      .send({ lineas: [{ varianteId: v1.variante_id, cantidad: v1.cantidad_pedida }] });
    assert.equal(r.status, 201);
    assert.equal(r.body.estado, 'RECIBIDA_PARCIAL');
    assert.equal(r.body.orden.codigo, 'OC-0012');

    assert.equal(await stock(v1.variante_id, sedes['Bodega Central']), antes + v1.cantidad_pedida);
    const [k] = await q(`SELECT k.cantidad, k.saldo, mv.tipo, mv.orden_compra_id FROM kardex k JOIN movimientos mv ON mv.id = k.movimiento_id
                         WHERE k.variante_id = ? ORDER BY k.id DESC LIMIT 1`, [v1.variante_id]);
    assert.deepEqual([k.tipo, k.cantidad, k.saldo, k.orden_compra_id], ['ENTRADA', v1.cantidad_pedida, antes + v1.cantidad_pedida, oc.id]);

    const exceso = await request(app).post(`/api/ordenes-compra/${oc.id}/recepcion`).set(auth(tk.jefe))
      .send({ lineas: [{ varianteId: v2.variante_id, cantidad: v2.cantidad_pedida + 1 }] });
    assert.equal(exceso.status, 400);
    assert.equal(exceso.body.codigo, 'OBSERVACION_REQUERIDA');
  });

  it('3. Venta que descuenta stock y vendedor limitado a su sede', async () => {
    const [v] = await q('SELECT variante_id FROM stock WHERE ubicacion_id = ? AND cantidad >= 2 ORDER BY variante_id LIMIT 1', [sedes['Local Centro']]);
    const antes = await stock(v.variante_id, sedes['Local Centro']);
    const r = await request(app).post('/api/movimientos').set(auth(tk.vendedor))
      .send({ tipo: 'VENTA', ubicacionId: sedes['Local Centro'], referencia: 'FV-IT-1', detalle: [{ varianteId: v.variante_id, cantidad: 1 }] });
    assert.equal(r.status, 201);
    assert.equal(r.body.pares, 1);
    assert.equal(await stock(v.variante_id, sedes['Local Centro']), antes - 1);
    const [mv] = await q('SELECT tipo, referencia, usuario_id FROM movimientos WHERE id = ?', [r.body.id]);
    assert.equal(mv.tipo, 'VENTA');
    assert.equal(mv.referencia, 'FV-IT-1');

    const otraSede = await request(app).post('/api/movimientos').set(auth(tk.vendedor))
      .send({ tipo: 'VENTA', ubicacionId: sedes['Local Norte'], detalle: [{ varianteId: v.variante_id, cantidad: 1 }] });
    assert.equal(otraSede.status, 403);

    const sinStock = await request(app).post('/api/movimientos').set(auth(tk.vendedor))
      .send({ tipo: 'VENTA', ubicacionId: sedes['Local Centro'], detalle: [{ varianteId: v.variante_id, cantidad: 999 }] });
    assert.equal(sinStock.status, 409);
    assert.ok(Array.isArray(sinStock.body.sugerencias));
    assert.equal(await stock(v.variante_id, sedes['Local Centro']), antes - 1, 'la venta rechazada no movió stock');
  });

  it('4. Traslado: envío (en tránsito) y recepción en la sede destino', async () => {
    const [v] = await q('SELECT variante_id FROM stock WHERE ubicacion_id = ? AND cantidad >= 3 ORDER BY variante_id LIMIT 1', [sedes['Bodega Central']]);
    const [o0, d0] = [await stock(v.variante_id, sedes['Bodega Central']), await stock(v.variante_id, sedes['Local Norte'])];

    const env = await request(app).post('/api/traslados').set(auth(tk.jefe))
      .send({ origenId: sedes['Bodega Central'], destinoId: sedes['Local Norte'], lineas: [{ varianteId: v.variante_id, cantidad: 3 }] });
    assert.equal(env.status, 201);
    assert.equal(env.body.estado, 'EN_TRANSITO');
    assert.equal(await stock(v.variante_id, sedes['Bodega Central']), o0 - 3);
    assert.equal(await stock(v.variante_id, sedes['Local Norte']), d0, 'en tránsito no suma en destino');

    const rec = await request(app).post(`/api/traslados/${env.body.id}/recepcion`).set(auth(tk.admin))
      .send({ lineas: [{ varianteId: v.variante_id, cantidad: 3 }] });
    assert.equal(rec.status, 200);
    assert.equal(rec.body.estado, 'RECIBIDO');
    assert.equal(await stock(v.variante_id, sedes['Local Norte']), d0 + 3);
    const [t] = await q('SELECT estado, usuario_recibe_id FROM traslados WHERE id = ?', [env.body.id]);
    assert.equal(t.estado, 'RECIBIDO');
    assert.ok(t.usuario_recibe_id);
  });

  it('5. Disponibilidad multisede: matriz talla × sede igual a la BD y en menos de 3 s', async () => {
    const t0 = Date.now();
    const r = await request(app).get('/api/disponibilidad').query({ q: 'Tenis Urbano 2045' }).set(auth(tk.vendedor));
    assert.equal(r.status, 200);
    assert.ok(Date.now() - t0 < 3000);
    assert.equal(r.body.ubicaciones.length, 3);
    const t41 = r.body.resultados.find((g) => g.color === 'Negro').tallas.find((t) => Number(t.eu) === 41);
    assert.equal(t41.disponible[sedes['Local Centro']] ?? 0, 0, 'escenario de usabilidad: no hay 41 en Centro');
    assert.equal(t41.disponible[sedes['Local Norte']], await stock(t41.varianteId, sedes['Local Norte']));
    assert.equal(t41.disponible[sedes['Bodega Central']], await stock(t41.varianteId, sedes['Bodega Central']));
  });

  it('6. Referencia con matriz talla × color (HU01): 14 variantes con SKU y código de barras', async () => {
    const [marca] = await q("SELECT id FROM marcas WHERE nombre = 'Calzado Urbano'");
    const [cat] = await q("SELECT id FROM categorias WHERE nombre = 'Lifestyle'");
    const colores = await q("SELECT id FROM colores WHERE nombre IN ('Negro', 'Blanco')");
    const tallas = await q("SELECT id FROM tallas WHERE genero = 'UNISEX' AND eu BETWEEN 36 AND 42");
    const r = await request(app).post('/api/referencias').set(auth(tk.jefe)).send({
      marcaId: marca.id, categoriaId: cat.id, nombre: 'Tenis Urbano 2046', genero: 'UNISEX', precioBase: 199900, costo: 110000,
      colorIds: colores.map((c) => c.id), tallaIds: tallas.map((t) => t.id),
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.creadas, 14);
    const vs = await q('SELECT sku, codigo_barras FROM variantes WHERE modelo_id = ?', [r.body.id]);
    assert.equal(vs.length, 14);
    assert.ok(vs.every((v) => /^20\d{11}$/.test(v.codigo_barras)));
    assert.equal(new Set(vs.map((v) => v.sku)).size, 14);
    assert.equal((await request(app).post('/api/referencias').set(auth(tk.vendedor)).send({})).status, 403);
  });

  it('7. Ajuste con aprobación: pendiente no mueve stock; aprobado sí, con kardex', async () => {
    const [v] = await q('SELECT variante_id, cantidad FROM stock WHERE ubicacion_id = ? AND cantidad >= 2 ORDER BY variante_id DESC LIMIT 1', [sedes['Local Norte']]);
    const aj = await request(app).post('/api/ajustes').set(auth(tk.admin))
      .send({ ubicacionId: sedes['Local Norte'], causal: 'AVERIA', observacion: 'Prueba de integración', lineas: [{ varianteId: v.variante_id, cantidad: -1 }] });
    assert.equal(aj.status, 201);
    assert.equal(aj.body.estado, 'PENDIENTE');
    assert.equal(await stock(v.variante_id, sedes['Local Norte']), v.cantidad);
    assert.equal((await request(app).post(`/api/ajustes/${aj.body.id}/aprobar`).set(auth(tk.vendedor))).status, 403);
    const ap = await request(app).post(`/api/ajustes/${aj.body.id}/aprobar`).set(auth(tk.jefe));
    assert.equal(ap.status, 200);
    assert.equal(ap.body.estado, 'APROBADO');
    assert.equal(await stock(v.variante_id, sedes['Local Norte']), v.cantidad - 1);
  });

  it('8. Importación de catálogo CSV con reporte de filas rechazadas', async () => {
    const csv = [
      'marca;categoria;referencia;genero;codigo_estilo;colores;tallas;costo;precio',
      'Calzado Urbano;Lifestyle;Tenis Importado;Unisex;IMP-1;Negro|Verde;38-40;90000;169900',
      'Calzado Urbano;Lifestyle;Sin Precio;Unisex;;Negro;38;;',
      'Calzado Urbano;Lifestyle;Talla Rara;Unisex;;Negro;99;1;2',
    ].join('\n');
    const r = await request(app).post('/api/catalogo/importar').set(auth(tk.jefe)).send({ csv });
    assert.equal(r.status, 200);
    assert.equal(r.body.creadas, 1);
    assert.equal(r.body.variantes, 6);
    assert.deepEqual(r.body.rechazadas.map((x) => x.fila), [3, 4]);
    const [m] = await q("SELECT COUNT(*) AS n FROM variantes v JOIN modelos m ON m.id = v.modelo_id WHERE m.nombre = 'Tenis Importado'");
    assert.equal(m.n, 6);
  });

  it('9. Integridad: el kardex cuadra con el stock tras todas las operaciones', async () => {
    const r = await request(app).get('/api/kardex/verificacion').set(auth(tk.admin));
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true, JSON.stringify(r.body.diferencias));
  });
});
