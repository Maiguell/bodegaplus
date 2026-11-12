/**
 * @file routes/catalogo.js
 * @description Catálogo y parametrización:
 *   HU01 — Referencia con su matriz de tallas y colores (una transacción, SKU y código de barras por variante)
 *   HU02 — Importación del catálogo desde plantilla CSV con reporte de filas rechazadas
 *   HU03 — Ubicaciones físicas (estantería-nivel) por sede y su asignación a referencias
 *   HT05 — Código de barras interno por variante
 *   RNF-08 — Sedes, tallas, colores, marcas, categorías, proveedores, causales y parámetros desde la app
 */

'use strict';

const express = require('express');
const { getPool } = require('../db');
const { HttpError, h } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { requiere } = require('../lib/permisos');
const inv = require('../lib/inventario');
const parametros = require('../lib/parametros');
const { buildSku } = require('../utils/sku');
const { matrizVariantes, codigoBarrasVariante, leerCSV, validarFilaCatalogo, COLUMNAS_CATALOGO } = require('../lib/reglas');

const router = express.Router();
const db = () => getPool();
const GENEROS = ['HOMBRE', 'MUJER', 'UNISEX', 'NINO'];
const editar = [authMiddleware, requiere('catalogo.editar')];
const admin = [authMiddleware, requiere('parametros')];

// ── Listas auxiliares ─────────────────────────────────────────────────────────

/** GET /api/catalogo — listas para selects (incluye causales y parámetros vigentes). */
router.get('/catalogo', authMiddleware, h(async (req, res) => {
  const q = async (sql) => (await db().query(sql))[0];
  const [marcas, categorias, colores, tallas, ubicaciones, proveedores, causales] = await Promise.all([
    q('SELECT id, nombre FROM marcas WHERE activo = 1 ORDER BY nombre'),
    q('SELECT id, nombre FROM categorias ORDER BY nombre'),
    q('SELECT id, nombre, hex FROM colores ORDER BY nombre'),
    q('SELECT id, genero, us, eu, cm FROM tallas ORDER BY genero, eu'),
    q('SELECT id, nombre, tipo FROM ubicaciones WHERE activo = 1 ORDER BY tipo, id'),
    q('SELECT id, nombre, contacto FROM proveedores ORDER BY nombre'),
    q('SELECT codigo, nombre FROM causales_ajuste WHERE activo = 1 ORDER BY nombre'),
  ]);
  const params = Object.fromEntries((await parametros.listar()).map((p) => [p.clave, p.valor]));
  res.json({ marcas, categorias, colores, tallas, ubicaciones, proveedores, causales, parametros: params });
}));

/** Alta simple por nombre (marcas, categorías, colores, proveedores). */
const altaSimple = (tabla, campos) => h(async (req, res) => {
  const nombre = String(req.body?.nombre ?? '').trim();
  if (!nombre) throw new HttpError(400, 'El nombre es requerido.');
  const valores = campos.map((c) => (c === 'nombre' ? nombre : String(req.body?.[c] ?? '').trim() || null));
  const [r] = await db().query(`INSERT INTO ${tabla} (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`, valores);
  res.status(201).json({ id: r.insertId, ...Object.fromEntries(campos.map((c, i) => [c, valores[i]])) });
});
router.post('/marcas', ...editar, altaSimple('marcas', ['nombre']));
router.post('/categorias', ...editar, altaSimple('categorias', ['nombre']));
router.post('/colores', ...editar, altaSimple('colores', ['nombre', 'hex']));
router.post('/proveedores', ...editar, altaSimple('proveedores', ['nombre', 'contacto']));

// ── Modelos (referencias) ─────────────────────────────────────────────────────

const SELECT_MODELOS = `
  SELECT m.id, m.nombre, m.genero, m.codigo_estilo AS codigoEstilo, m.precio_base AS precioBase,
         m.marca_id AS marcaId, ma.nombre AS marca, m.categoria_id AS categoriaId, c.nombre AS categoria,
         (SELECT COUNT(*) FROM variantes v WHERE v.modelo_id = m.id AND v.activo = 1) AS variantes,
         COALESCE((SELECT SUM(s.cantidad) FROM stock s JOIN variantes v ON v.id = s.variante_id
                   WHERE v.modelo_id = m.id AND v.activo = 1), 0) AS pares,
         (SELECT MIN(v.costo) FROM variantes v WHERE v.modelo_id = m.id AND v.activo = 1) AS costo,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('sedeId', ru.ubicacion_id, 'sede', u.nombre, 'codigo', ub.codigo))
            FROM referencia_ubicacion ru JOIN ubicaciones_bodega ub ON ub.id = ru.ubicacion_bodega_id
            JOIN ubicaciones u ON u.id = ru.ubicacion_id WHERE ru.modelo_id = m.id) AS ubicacionesFisicas
  FROM modelos m
  JOIN marcas ma ON ma.id = m.marca_id
  JOIN categorias c ON c.id = m.categoria_id
  WHERE m.activo = 1`;

router.get('/modelos', authMiddleware, h(async (req, res) => {
  const [rows] = await db().query(`${SELECT_MODELOS} ORDER BY ma.nombre, m.nombre`);
  res.json(rows);
}));

const leerModelo = (b) => {
  const nombre = String(b?.nombre ?? '').trim();
  if (!nombre || !b?.marcaId || !b?.categoriaId) throw new HttpError(400, 'Nombre, marca y categoría son requeridos.');
  const genero = GENEROS.includes(b.genero) ? b.genero : 'UNISEX';
  const precio = Number(b.precioBase) || 0;
  if (precio < 0) throw new HttpError(400, 'El precio no puede ser negativo.');
  return [Number(b.marcaId), Number(b.categoriaId), nombre, genero, b.codigoEstilo?.trim() || null, precio];
};

/**
 * Crea las variantes talla × color que falten para un modelo, con SKU y código de barras (HT05).
 * @returns {Promise<{creadas: number, omitidas: number}>}
 */
async function crearVariantes(conn, modeloId, { colorIds, tallaIds, precio, costo, stockMinimo }) {
  const [[modelo]] = await conn.query(
    'SELECT m.id, m.nombre, m.genero, m.precio_base, ma.nombre AS marca FROM modelos m JOIN marcas ma ON ma.id = m.marca_id WHERE m.id = ? AND m.activo = 1', [modeloId]);
  if (!modelo) throw new HttpError(404, 'Modelo no encontrado.');
  const combos = matrizVariantes(tallaIds, colorIds);
  if (!combos.length) throw new HttpError(400, 'Selecciona al menos un color y una talla.');
  const [colores] = await conn.query('SELECT id, nombre FROM colores WHERE id IN (?)', [[...new Set(combos.map((c) => c.colorId))]]);
  const [tallas] = await conn.query('SELECT id, eu FROM tallas WHERE id IN (?)', [[...new Set(combos.map((c) => c.tallaId))]]);
  const colorPor = new Map(colores.map((c) => [c.id, c])), tallaPor = new Map(tallas.map((t) => [t.id, t]));
  if (colorPor.size !== new Set(combos.map((c) => c.colorId)).size) throw new HttpError(404, 'Algún color no existe.');
  if (tallaPor.size !== new Set(combos.map((c) => c.tallaId)).size) throw new HttpError(404, 'Alguna talla no existe.');

  const [existentes] = await conn.query('SELECT color_id, talla_id FROM variantes WHERE modelo_id = ?', [modelo.id]);
  const ya = new Set(existentes.map((e) => `${e.color_id}-${e.talla_id}`));
  const nuevas = combos.filter((c) => !ya.has(`${c.colorId}-${c.tallaId}`));
  const minimo = Number.isInteger(Number(stockMinimo)) && stockMinimo !== '' && stockMinimo !== undefined && stockMinimo !== null
    ? Number(stockMinimo) : await parametros.obtener('STOCK_MINIMO_DEFECTO');
  for (const c of nuevas) {
    // El SKU recorta el nombre: dos referencias parecidas ("Tenis Urbano 2045/2046") colisionarían.
    // En ese caso se agrega el id del modelo, que hace único el SKU (modelo + color + talla es única).
    let sku = buildSku(modelo.marca, modelo.nombre, colorPor.get(c.colorId).nombre, tallaPor.get(c.tallaId).eu);
    const [[tomado]] = await conn.query('SELECT 1 AS x FROM variantes WHERE sku = ?', [sku]);
    if (tomado) sku = `${sku}-${modelo.id}`;
    const [r] = await conn.query(
      'INSERT INTO variantes (modelo_id, color_id, talla_id, sku, precio, costo, stock_minimo) VALUES (?,?,?,?,?,?,?)',
      [modelo.id, c.colorId, c.tallaId, sku,
        Number(precio) || modelo.precio_base, costo === undefined || costo === null || costo === '' ? null : Number(costo), minimo]);
    await conn.query('UPDATE variantes SET codigo_barras = ? WHERE id = ?', [codigoBarrasVariante(r.insertId), r.insertId]);
  }
  return { creadas: nuevas.length, omitidas: combos.length - nuevas.length };
}

router.post('/modelos', ...editar, h(async (req, res) => {
  const [r] = await db().query(
    'INSERT INTO modelos (marca_id, categoria_id, nombre, genero, codigo_estilo, precio_base) VALUES (?,?,?,?,?,?)', leerModelo(req.body));
  const [[row]] = await db().query(`${SELECT_MODELOS} AND m.id = ?`, [r.insertId]);
  res.status(201).json(row);
}));

/**
 * POST /api/referencias — HU01: crea la referencia y TODAS sus variantes talla × color en una transacción.
 * Body: { marcaId, categoriaId, nombre, genero, codigoEstilo?, precioBase, costo?, stockMinimo?, colorIds[], tallaIds[] }
 * Las existencias iniciales quedan en 0 en todas las sedes (entran luego por compras, ajustes o conteo).
 */
router.post('/referencias', ...editar, h(async (req, res) => {
  const datos = leerModelo(req.body);
  const r = await inv.enTransaccion(async (conn) => {
    const [m] = await conn.query(
      'INSERT INTO modelos (marca_id, categoria_id, nombre, genero, codigo_estilo, precio_base) VALUES (?,?,?,?,?,?)', datos);
    const v = await crearVariantes(conn, m.insertId, { ...req.body, precio: req.body?.precioBase });
    return { modeloId: m.insertId, ...v };
  });
  const [[modelo]] = await db().query(`${SELECT_MODELOS} AND m.id = ?`, [r.modeloId]);
  const [variantes] = await db().query(
    `SELECT v.id, v.sku, v.codigo_barras AS codigoBarras, co.nombre AS color, t.eu FROM variantes v
     JOIN colores co ON co.id = v.color_id JOIN tallas t ON t.id = v.talla_id WHERE v.modelo_id = ? ORDER BY co.nombre, t.eu`, [r.modeloId]);
  res.status(201).json({ ...modelo, creadas: r.creadas, variantesCreadas: variantes });
}));

router.put('/modelos/:id', ...editar, h(async (req, res) => {
  const [r] = await db().query(
    'UPDATE modelos SET marca_id=?, categoria_id=?, nombre=?, genero=?, codigo_estilo=?, precio_base=? WHERE id=? AND activo=1',
    [...leerModelo(req.body), req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, 'Modelo no encontrado.');
  const [[row]] = await db().query(`${SELECT_MODELOS} AND m.id = ?`, [req.params.id]);
  res.json(row);
}));

/** DELETE /api/modelos/:id — baja lógica (modelo y variantes). Exige stock en cero. */
router.delete('/modelos/:id', ...editar, h(async (req, res) => {
  const [[m]] = await db().query(`${SELECT_MODELOS} AND m.id = ?`, [req.params.id]);
  if (!m) throw new HttpError(404, 'Modelo no encontrado.');
  if (m.pares > 0) throw new HttpError(409, `No se puede eliminar: aún hay ${m.pares} pares en stock.`);
  await db().query('UPDATE modelos SET activo = 0 WHERE id = ?', [req.params.id]);
  await db().query('UPDATE variantes SET activo = 0 WHERE modelo_id = ?', [req.params.id]);
  res.status(204).send();
}));

/** POST /api/modelos/:id/variantes { colorIds[] | colorId, tallaIds[], precio?, costo?, stockMinimo? } — omite las existentes. */
router.post('/modelos/:id/variantes', ...editar, h(async (req, res) => {
  const colorIds = req.body?.colorIds ?? (req.body?.colorId ? [req.body.colorId] : []);
  const r = await inv.enTransaccion((conn) => crearVariantes(conn, req.params.id, { ...req.body, colorIds }));
  if (!r.creadas) throw new HttpError(409, 'Todas esas variantes ya existen.');
  res.status(201).json(r);
}));

/** PUT /api/modelos/:id/costo { costo } — costo unitario de todas las variantes del modelo (HU17). */
router.put('/modelos/:id/costo', ...editar, h(async (req, res) => {
  const costo = Number(req.body?.costo);
  if (!Number.isFinite(costo) || costo < 0) throw new HttpError(400, 'Costo inválido.');
  const [r] = await db().query('UPDATE variantes SET costo = ? WHERE modelo_id = ? AND activo = 1', [costo, req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, 'El modelo no tiene variantes activas.');
  res.json({ modeloId: Number(req.params.id), costo, variantes: r.affectedRows });
}));

// ── HU02: Importar catálogo ───────────────────────────────────────────────────

/** Plantilla CSV (separador ;) con dos filas de ejemplo. */
router.get('/catalogo/plantilla', authMiddleware, (req, res) => {
  const csv = [COLUMNAS_CATALOGO.join(';'),
    'Calzado Urbano;Lifestyle;Tenis Urbano 3000;Unisex;URB-3000;Negro|Blanco;36-42;98000;179900',
    'Montaña;Botas;Bota Andina;Hombre;MTN-AND;Café;40|41|42|43;150000;289900'].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-catalogo.csv"');
  res.send('﻿' + csv);
});

/**
 * POST /api/catalogo/importar { csv } — crea referencias y variantes válidas; marcas, categorías y colores nuevos
 * se crean solos; tallas inexistentes rechazan la fila. Si la referencia existe, solo agrega variantes faltantes.
 * Devuelve el reporte: creadas, actualizadas, variantes y filas rechazadas con su motivo.
 */
router.post('/catalogo/importar', ...editar, h(async (req, res) => {
  const { columnas, filas } = leerCSV(req.body?.csv);
  const faltan = ['marca', 'categoria', 'referencia', 'colores', 'tallas', 'precio'].filter((c) => !columnas.includes(c));
  if (faltan.length) throw new HttpError(400, `La plantilla no tiene las columnas: ${faltan.join(', ')}. Descarga la plantilla oficial.`);
  if (!filas.length) throw new HttpError(400, 'El archivo no tiene filas.');
  if (filas.length > 2000) throw new HttpError(400, 'Máximo 2000 filas por archivo.');

  const reporte = { total: filas.length, creadas: 0, actualizadas: 0, variantes: 0, rechazadas: [] };
  const idPor = async (conn, tabla, nombre, extra = {}) => {
    const [[r]] = await conn.query(`SELECT id FROM ${tabla} WHERE LOWER(nombre) = LOWER(?)`, [nombre]);
    if (r) return r.id;
    const cols = ['nombre', ...Object.keys(extra)];
    const [ins] = await conn.query(`INSERT INTO ${tabla} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [nombre, ...Object.values(extra)]);
    return ins.insertId;
  };

  for (const fila of filas) {
    const v = validarFilaCatalogo(fila);
    if (!v.ok) { reporte.rechazadas.push({ fila: fila._fila, referencia: fila.referencia ?? '', motivo: v.motivo }); continue; }
    const d = v.datos;
    try {
      await inv.enTransaccion(async (conn) => {
        const [tallas] = await conn.query('SELECT id, eu FROM tallas WHERE genero = ? AND eu IN (?)', [d.genero, d.tallas]);
        const faltantes = d.tallas.filter((eu) => !tallas.some((t) => Number(t.eu) === eu));
        if (faltantes.length) throw new HttpError(400, `Tallas no configuradas para ${d.genero.toLowerCase()}: ${faltantes.join(', ')} (agrégalas en Parámetros).`);
        const marcaId = await idPor(conn, 'marcas', d.marca);
        const categoriaId = await idPor(conn, 'categorias', d.categoria);
        const colorIds = [];
        for (const c of d.colores) colorIds.push(await idPor(conn, 'colores', c));
        const [[existe]] = await conn.query('SELECT id FROM modelos WHERE marca_id = ? AND LOWER(nombre) = LOWER(?) AND genero = ? AND activo = 1', [marcaId, d.referencia, d.genero]);
        let modeloId = existe?.id;
        if (!modeloId) {
          const [m] = await conn.query('INSERT INTO modelos (marca_id, categoria_id, nombre, genero, codigo_estilo, precio_base) VALUES (?,?,?,?,?,?)',
            [marcaId, categoriaId, d.referencia, d.genero, d.codigoEstilo, d.precio]);
          modeloId = m.insertId;
        }
        const r = await crearVariantes(conn, modeloId, { colorIds, tallaIds: tallas.map((t) => t.id), precio: d.precio, costo: d.costo });
        if (existe) reporte.actualizadas++; else reporte.creadas++;
        reporte.variantes += r.creadas;
      });
    } catch (err) {
      reporte.rechazadas.push({ fila: fila._fila, referencia: d.referencia, motivo: err.status ? err.message : `Error: ${err.message}` });
    }
  }
  res.json(reporte);
}));

// ── HU03: Ubicaciones físicas ─────────────────────────────────────────────────

router.get('/ubicaciones-bodega', authMiddleware, h(async (req, res) => {
  const params = [];
  let where = 'ub.activo = 1';
  if (req.query.sedeId) { where += ' AND ub.ubicacion_id = ?'; params.push(Number(req.query.sedeId)); }
  const [rows] = await db().query(`
    SELECT ub.id, ub.codigo, ub.descripcion, ub.ubicacion_id AS sedeId, u.nombre AS sede,
           (SELECT COUNT(*) FROM referencia_ubicacion ru WHERE ru.ubicacion_bodega_id = ub.id) AS referencias
    FROM ubicaciones_bodega ub JOIN ubicaciones u ON u.id = ub.ubicacion_id
    WHERE ${where} ORDER BY u.id, ub.codigo`, params);
  res.json(rows);
}));

/** POST /api/ubicaciones-bodega { sedeId, codigo, descripcion? } — código tipo B1-E3-N2. */
router.post('/ubicaciones-bodega', authMiddleware, requiere('movimientos.bodega'), h(async (req, res) => {
  const codigo = String(req.body?.codigo ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,4}(-[A-Z0-9]{1,4}){0,3}$/.test(codigo)) throw new HttpError(400, 'Código inválido. Usa el formato bodega-estantería-nivel, ej. B1-E3-N2.');
  const sede = await inv.sedeActiva(db(), req.body?.sedeId);
  const [r] = await db().query('INSERT INTO ubicaciones_bodega (ubicacion_id, codigo, descripcion) VALUES (?,?,?)',
    [sede.id, codigo, String(req.body?.descripcion ?? '').trim().slice(0, 100) || null]);
  res.status(201).json({ id: r.insertId, sedeId: sede.id, sede: sede.nombre, codigo });
}));

/** PUT /api/modelos/:id/ubicacion { sedeId, ubicacionBodegaId | null } — asigna o quita la ubicación de la referencia en la sede. */
router.put('/modelos/:id/ubicacion', authMiddleware, requiere('movimientos.bodega'), h(async (req, res) => {
  const sede = await inv.sedeActiva(db(), req.body?.sedeId);
  const [[m]] = await db().query('SELECT id FROM modelos WHERE id = ? AND activo = 1', [req.params.id]);
  if (!m) throw new HttpError(404, 'Referencia no encontrada.');
  if (!req.body?.ubicacionBodegaId) {
    await db().query('DELETE FROM referencia_ubicacion WHERE modelo_id = ? AND ubicacion_id = ?', [m.id, sede.id]);
    return res.json({ modeloId: m.id, sedeId: sede.id, codigo: null });
  }
  const [[ub]] = await db().query('SELECT id, codigo FROM ubicaciones_bodega WHERE id = ? AND ubicacion_id = ? AND activo = 1', [req.body.ubicacionBodegaId, sede.id]);
  if (!ub) throw new HttpError(400, `La ubicación no existe en ${sede.nombre}.`);
  await db().query(
    'INSERT INTO referencia_ubicacion (modelo_id, ubicacion_id, ubicacion_bodega_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ubicacion_bodega_id = VALUES(ubicacion_bodega_id)',
    [m.id, sede.id, ub.id]);
  res.json({ modeloId: m.id, sedeId: sede.id, codigo: ub.codigo });
}));

// ── RNF-08: Parametrización (administrador) ───────────────────────────────────

router.get('/parametros', ...admin, h(async (req, res) => {
  const [sedes] = await db().query('SELECT id, nombre, tipo, direccion, activo FROM ubicaciones ORDER BY tipo, id');
  const [causales] = await db().query('SELECT codigo, nombre, activo FROM causales_ajuste ORDER BY nombre');
  res.json({ parametros: await parametros.listar(), sedes, causales });
}));

router.put('/parametros/:clave', ...admin, h(async (req, res) => {
  try {
    res.json({ clave: req.params.clave, valor: await parametros.actualizar(req.params.clave, req.body?.valor) });
  } catch (err) {
    throw new HttpError(err.status ?? 400, err.message);
  }
}));

/** POST /api/ubicaciones { nombre, tipo: BODEGA|LOCAL, direccion? } — nueva sede. */
router.post('/ubicaciones', ...admin, h(async (req, res) => {
  const nombre = String(req.body?.nombre ?? '').trim();
  const tipo = req.body?.tipo === 'BODEGA' ? 'BODEGA' : 'LOCAL';
  if (!nombre) throw new HttpError(400, 'El nombre de la sede es requerido.');
  const [r] = await db().query('INSERT INTO ubicaciones (nombre, tipo, direccion) VALUES (?,?,?)', [nombre, tipo, String(req.body?.direccion ?? '').trim() || null]);
  res.status(201).json({ id: r.insertId, nombre, tipo, activo: 1 });
}));

/** PUT /api/ubicaciones/:id { nombre?, direccion?, activo? } — desactivar exige que no tenga stock. */
router.put('/ubicaciones/:id', ...admin, h(async (req, res) => {
  const [[s]] = await db().query('SELECT * FROM ubicaciones WHERE id = ?', [req.params.id]);
  if (!s) throw new HttpError(404, 'Sede no encontrada.');
  const activo = req.body?.activo === undefined ? s.activo : (req.body.activo ? 1 : 0);
  if (!activo && s.activo) {
    const [[{ pares }]] = await db().query('SELECT COALESCE(SUM(cantidad), 0) AS pares FROM stock WHERE ubicacion_id = ?', [s.id]);
    if (pares > 0) throw new HttpError(409, `No se puede desactivar: la sede tiene ${pares} pares. Trasládalos primero.`);
  }
  const nombre = String(req.body?.nombre ?? s.nombre).trim() || s.nombre;
  await db().query('UPDATE ubicaciones SET nombre = ?, direccion = ?, activo = ? WHERE id = ?',
    [nombre, req.body?.direccion === undefined ? s.direccion : (String(req.body.direccion).trim() || null), activo, s.id]);
  res.json({ id: s.id, nombre, activo });
}));

/** POST /api/tallas { genero, eu, us, cm? } */
router.post('/tallas', ...admin, h(async (req, res) => {
  const genero = GENEROS.includes(req.body?.genero) ? req.body.genero : null;
  const eu = Number(req.body?.eu), us = Number(req.body?.us);
  if (!genero || !(eu > 0) || !(us > 0)) throw new HttpError(400, 'Género, talla EU y talla US son requeridos.');
  const [r] = await db().query('INSERT INTO tallas (genero, us, eu, cm) VALUES (?,?,?,?)', [genero, us, eu, Number(req.body?.cm) || null]);
  res.status(201).json({ id: r.insertId, genero, eu, us });
}));

/** POST /api/causales { codigo, nombre } · PUT /api/causales/:codigo { nombre?, activo? } */
router.post('/causales', ...admin, h(async (req, res) => {
  const nombre = String(req.body?.nombre ?? '').trim();
  const codigo = String(req.body?.codigo || nombre).trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').slice(0, 30);
  if (!nombre || !codigo) throw new HttpError(400, 'El nombre de la causal es requerido.');
  await db().query('INSERT INTO causales_ajuste (codigo, nombre) VALUES (?,?)', [codigo, nombre.slice(0, 60)]);
  res.status(201).json({ codigo, nombre, activo: 1 });
}));

router.put('/causales/:codigo', ...admin, h(async (req, res) => {
  const [[c]] = await db().query('SELECT * FROM causales_ajuste WHERE codigo = ?', [req.params.codigo]);
  if (!c) throw new HttpError(404, 'Causal no encontrada.');
  const nombre = String(req.body?.nombre ?? c.nombre).trim() || c.nombre;
  const activo = req.body?.activo === undefined ? c.activo : (req.body.activo ? 1 : 0);
  await db().query('UPDATE causales_ajuste SET nombre = ?, activo = ? WHERE codigo = ?', [nombre, activo, c.codigo]);
  res.json({ codigo: c.codigo, nombre, activo });
}));

module.exports = router;
