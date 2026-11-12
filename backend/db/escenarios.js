/**
 * @file db/escenarios.js
 * @description HT13 — Datos para los 3 escenarios de la prueba de usabilidad (idempotente):
 *   1. "¿Hay el Tenis Urbano 2045 en talla 41? ¿En qué sede?" → no hay en Local Centro, sí en Norte y Bodega.
 *   2. "Llegó la mercancía de la orden OC-0012" → OC-0012 pendiente.
 *   3. "Cambiar unas botas talla 39 por 40, pero en tu tienda no hay" → en Local Centro hay 39 y no 40.
 * Si la base ya tiene kardex, las existencias entran como movimiento ENTRADA (no se rompe kardex = stock).
 */

'use strict';

const { buildSku } = require('../utils/sku');
const { codigoBarrasVariante } = require('../lib/reglas');

const TALLAS_UNISEX = [[3, 34], [4, 35], [4.5, 36], [5.5, 37], [6, 38], [7, 39], [7.5, 40], [8.5, 41], [9, 42], [10, 43], [10.5, 44]];

/** [marca, categoría, referencia, estilo, precio, costo, colores [nombre, hex][], tallas EU[], stock(talla, color, sede) ] */
const PRODUCTOS = [
  ['Calzado Urbano', 'Lifestyle', 'Tenis Urbano 2045', 'URB-2045', 189900, 104000,
    [['Negro', '#111111'], ['Blanco', '#ffffff']], [36, 37, 38, 39, 40, 41, 42],
    (eu, color, sede) => (eu === 41 ? { 'Bodega Central': 5, 'Local Centro': 0, 'Local Norte': 3 }[sede]
      : { 'Bodega Central': 6, 'Local Centro': 2, 'Local Norte': 2 }[sede] - (color === 'Blanco' ? 1 : 0))],
  ['Montaña', 'Botas', 'Bota Trek Cuero', 'MTN-TREK', 329900, 181000,
    [['Café', '#7c4a1e']], [37, 38, 39, 40, 41, 42],
    (eu, color, sede) => (eu === 40 ? { 'Bodega Central': 4, 'Local Centro': 0, 'Local Norte': 2 }[sede]
      : eu === 39 ? { 'Bodega Central': 3, 'Local Centro': 2, 'Local Norte': 1 }[sede]
        : { 'Bodega Central': 3, 'Local Centro': 1, 'Local Norte': 1 }[sede])],
];

async function idPor(pool, tabla, nombre, extra = {}) {
  const [[r]] = await pool.query(`SELECT id FROM ${tabla} WHERE nombre = ?`, [nombre]);
  if (r) return r.id;
  const cols = ['nombre', ...Object.keys(extra)];
  const [ins] = await pool.query(`INSERT INTO ${tabla} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [nombre, ...Object.values(extra)]);
  return ins.insertId;
}

/** @returns {Promise<string[]>} resumen de lo creado */
async function cargarEscenarios(pool) {
  const hecho = [];
  await pool.query('INSERT IGNORE INTO tallas (genero, us, eu) VALUES ?', [TALLAS_UNISEX.map(([us, eu]) => ['UNISEX', us, eu])]);
  const [sedes] = await pool.query('SELECT id, nombre FROM ubicaciones WHERE activo = 1');
  const [[admin]] = await pool.query("SELECT id FROM usuarios WHERE rol = 'ADMIN' ORDER BY id LIMIT 1");
  const [[{ k }]] = await pool.query('SELECT COUNT(*) AS k FROM kardex');
  const conKardex = k > 0;

  for (const [marca, categoria, nombre, estilo, precio, costo, colores, tallas, stockDe] of PRODUCTOS) {
    const marcaId = await idPor(pool, 'marcas', marca);
    const categoriaId = await idPor(pool, 'categorias', categoria);
    const [[existe]] = await pool.query("SELECT id FROM modelos WHERE marca_id = ? AND nombre = ? AND genero = 'UNISEX'", [marcaId, nombre]);
    if (existe) continue;

    const [m] = await pool.query(
      "INSERT INTO modelos (marca_id, categoria_id, nombre, genero, codigo_estilo, precio_base) VALUES (?,?,?,'UNISEX',?,?)",
      [marcaId, categoriaId, nombre, estilo, precio]);
    const lineas = [];
    for (const [color, hex] of colores) {
      const colorId = await idPor(pool, 'colores', color, { hex });
      for (const eu of tallas) {
        const [[t]] = await pool.query("SELECT id FROM tallas WHERE genero = 'UNISEX' AND eu = ?", [eu]);
        const [v] = await pool.query(
          'INSERT INTO variantes (modelo_id, color_id, talla_id, sku, precio, costo, stock_minimo) VALUES (?,?,?,?,?,?,3)',
          [m.insertId, colorId, t.id, buildSku(marca, nombre, color, eu), precio, costo]);
        await pool.query('UPDATE variantes SET codigo_barras = ? WHERE id = ?', [codigoBarrasVariante(v.insertId), v.insertId]);
        for (const s of sedes) {
          const cant = Math.max(0, stockDe(eu, color, s.nombre) ?? 0);
          if (cant > 0) lineas.push([v.insertId, s.id, cant]);
        }
      }
    }

    if (!lineas.length) continue;
    if (!conKardex) {
      await pool.query('INSERT INTO stock (variante_id, ubicacion_id, cantidad) VALUES ?', [lineas]);
    } else {
      // Base en operación: las existencias entran por el motor de inventario para quedar en el kardex
      const inv = require('../lib/inventario');
      await inv.enTransaccion(async (conn) => {
        for (const s of sedes) {
          const deSede = lineas.filter(([, sid]) => sid === s.id);
          if (!deSede.length) continue;
          const movId = await inv.insertarMovimiento(conn, {
            tipo: 'ENTRADA', usuarioId: admin.id, destinoId: s.id, referencia: 'ESCENARIOS-HT13',
            observacion: 'Carga de datos para la prueba de usabilidad',
          });
          for (const [vid, , cant] of deSede) {
            await inv.insertarDetalle(conn, movId, vid, cant);
            await inv.moverStock(conn, movId, vid, s.id, cant);
          }
        }
      });
    }
    hecho.push(`${marca} ${nombre}: ${colores.length * tallas.length} variantes`);
  }

  // Escenario 2: la orden OC-0012 debe existir y estar pendiente
  const [[oc]] = await pool.query("SELECT id FROM ordenes_compra WHERE codigo = 'OC-0012'");
  if (!oc && admin) {
    const [[prov]] = await pool.query('SELECT id FROM proveedores ORDER BY id LIMIT 1');
    const [[bodega]] = await pool.query("SELECT id FROM ubicaciones WHERE tipo = 'BODEGA' AND activo = 1 LIMIT 1");
    const [vars] = await pool.query(`SELECT v.id FROM variantes v JOIN modelos m ON m.id = v.modelo_id
      WHERE m.nombre = 'Tenis Urbano 2045' ORDER BY v.id LIMIT 6`);
    if (prov && bodega && vars.length) {
      const [r] = await pool.query("INSERT INTO ordenes_compra (codigo, proveedor_id, destino_id, usuario_id, observacion) VALUES ('OC-0012',?,?,?,?)",
        [prov.id, bodega.id, admin.id, 'Reposición Tenis Urbano 2045']);
      await pool.query('INSERT INTO orden_compra_detalle (orden_id, variante_id, cantidad_pedida) VALUES ?', [vars.map((v) => [r.insertId, v.id, 6])]);
      hecho.push('Orden OC-0012 pendiente');
    }
  }
  return hecho;
}

module.exports = { cargarEscenarios };
