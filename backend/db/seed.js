/**
 * @file db/seed.js
 * @description Datos de ejemplo: usuarios, bodega + 2 locales, catálogo de sneakers y stock inicial.
 * Las equivalencias de talla son aproximadas (varían por marca); editables desde la tabla `tallas`.
 */

'use strict';

const bcrypt = require('bcryptjs');
const { buildSku } = require('../utils/sku');

// US → EU (la talla CO usa la escala EU)
const TALLAS_HOMBRE = [[7, 40], [7.5, 40.5], [8, 41], [8.5, 42], [9, 42.5], [9.5, 43], [10, 44], [10.5, 44.5], [11, 45]];
const TALLAS_MUJER  = [[5, 35.5], [5.5, 36], [6, 36.5], [6.5, 37.5], [7, 38], [7.5, 38.5], [8, 39], [8.5, 40]];

const MARCAS     = ['Nike', 'Adidas', 'New Balance', 'Puma'];
const CATEGORIAS = ['Running', 'Lifestyle', 'Basket', 'Skate'];
const COLORES    = [['Blanco', '#ffffff'], ['Negro', '#111111'], ['Gris', '#9ca3af'], ['Rojo', '#dc2626'], ['Azul', '#2563eb'], ['Verde', '#16a34a']];

// [marca, categoria, nombre, genero, codigoEstilo, precio, colores[]]
const MODELOS = [
  ['Nike',        'Lifestyle', 'Air Force 1 07',   'HOMBRE', 'CW2288-111', 429900, ['Blanco', 'Negro']],
  ['Nike',        'Running',   'Pegasus 40',       'HOMBRE', 'DV3853-001', 489900, ['Negro', 'Azul']],
  ['Nike',        'Lifestyle', 'Dunk Low',         'MUJER',  'DD1503-101', 399900, ['Blanco', 'Verde']],
  ['Adidas',      'Lifestyle', 'Samba OG',         'HOMBRE', 'B75806',     379900, ['Negro', 'Blanco']],
  ['Adidas',      'Running',   'Ultraboost Light', 'HOMBRE', 'HQ6340',     659900, ['Gris', 'Negro']],
  ['New Balance', 'Lifestyle', '574 Classic',      'MUJER',  'ML574EVG',   349900, ['Gris', 'Azul']],
  ['New Balance', 'Running',   'Fresh Foam 1080',  'HOMBRE', 'M1080K13',   599900, ['Negro', 'Gris']],
  ['Puma',        'Basket',    'Clyde All-Pro',    'HOMBRE', '309691-01',  449900, ['Blanco', 'Rojo']],
];

/** Genera stock inicial determinista para que la demo se vea variada (incluye algunos agotados). */
const stockDemo = (v, u) => ((v * 7 + u * 13) % 9 === 0 ? 0 : ((v * 5 + u * 11) % 12) + (u === 1 ? 6 : 1));

async function seed(pool) {
  // Usuarios
  const hash = (p) => bcrypt.hashSync(p, 10);
  await pool.query('INSERT INTO usuarios (usuario, password_hash, nombre, rol) VALUES ?', [[
    ['admin',  hash('admin123'),  'Administrador',   'ADMIN'],
    ['bodega', hash('bodega123'), 'Operador Bodega', 'OPERADOR'],
  ]]);

  // Ubicaciones: bodega central y 2 locales
  await pool.query('INSERT INTO ubicaciones (nombre, tipo, direccion) VALUES ?', [[
    ['Bodega Central', 'BODEGA', null],
    ['Local Centro',   'LOCAL',  'Centro'],
    ['Local Norte',    'LOCAL',  'Norte'],
  ]]);

  await pool.query('INSERT INTO marcas (nombre) VALUES ?', [MARCAS.map((m) => [m])]);
  await pool.query('INSERT INTO categorias (nombre) VALUES ?', [CATEGORIAS.map((c) => [c])]);
  await pool.query('INSERT INTO colores (nombre, hex) VALUES ?', [COLORES]);
  await pool.query('INSERT INTO proveedores (nombre, contacto) VALUES ?', [[
    ['Distribuidora Deportiva SAS', 'ventas@distdeportiva.example'],
    ['Importadora Sneakers Ltda',   'pedidos@impsneakers.example'],
  ]]);

  await pool.query('INSERT INTO tallas (genero, us, eu) VALUES ?', [[
    ...TALLAS_HOMBRE.map(([us, eu]) => ['HOMBRE', us, eu]),
    ...TALLAS_MUJER.map(([us, eu]) => ['MUJER', us, eu]),
  ]]);

  const q = async (sql, p) => (await pool.query(sql, p))[0];
  const marcas = Object.fromEntries((await q('SELECT id, nombre FROM marcas')).map((r) => [r.nombre, r.id]));
  const cats   = Object.fromEntries((await q('SELECT id, nombre FROM categorias')).map((r) => [r.nombre, r.id]));
  const cols   = Object.fromEntries((await q('SELECT id, nombre FROM colores')).map((r) => [r.nombre, r.id]));
  const tallas = await q('SELECT id, genero, eu FROM tallas');

  for (const [marca, cat, nombre, genero, estilo, precio, colores] of MODELOS) {
    const [res] = await pool.query(
      'INSERT INTO modelos (marca_id, categoria_id, nombre, genero, codigo_estilo, precio_base) VALUES (?,?,?,?,?,?)',
      [marcas[marca], cats[cat], nombre, genero, estilo, precio]);
    for (const color of colores) {
      for (const t of tallas.filter((x) => x.genero === genero)) {
        await pool.query(
          'INSERT INTO variantes (modelo_id, color_id, talla_id, sku, precio, stock_minimo) VALUES (?,?,?,?,?,?)',
          [res.insertId, cols[color], t.id, buildSku(marca, nombre, color, t.eu), precio, 3]);
      }
    }
  }

  // Stock inicial: bodega (1) y los 2 locales (2, 3)
  const variantes = await q('SELECT id FROM variantes');
  const filas = [];
  for (const { id } of variantes) for (const u of [1, 2, 3]) {
    const c = u === 1 && id % 11 === 0 ? 2 : stockDemo(id, u) + (u === 1 ? 2 : 0);
    filas.push([id, u, c]);
  }
  await pool.query('INSERT INTO stock (variante_id, ubicacion_id, cantidad) VALUES ?', [filas]);
}

module.exports = { seed };
