/**
 * @file server.js
 * @description API REST de la bodega de zapatillas (bodega central + 2 locales), sobre MySQL.
 * Stock por pares y por variante (modelo + color + talla) en cada ubicación.
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const config  = require('./lib/config'); // HT08: carga .env.<NODE_ENV> y valida secretos
const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const { init, getPool } = require('./db');
const { buildSku } = require('./utils/sku');
const { HttpError, h } = require('./lib/http');
const { generarToken, authMiddleware, soloAdmin } = require('./lib/auth');
const inv = require('./lib/inventario');
const tareas = require('./lib/tareas');
const tienda = require('./routes/tienda');

const app  = express();
const PORT = config.port;

app.set('trust proxy', 1); // detrás del proxy HTTPS del hosting
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json());

/** GET /api/salud - Comprobación de vida para el hosting (sin autenticación). */
app.get('/api/salud', h(async (req, res) => {
  await db().query('SELECT 1');
  res.json({ ok: true, ambiente: config.env });
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const db = () => getPool();

const GENEROS = ['HOMBRE', 'MUJER', 'UNISEX', 'NINO'];

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', h(async (req, res) => {
  const { usuario, password } = req.body ?? {};
  if (!usuario || !password) throw new HttpError(400, 'Usuario y contraseña son requeridos.');

  const [[user]] = await db().query('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1', [usuario]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) throw new HttpError(401, 'Credenciales incorrectas.');

  const { password_hash, activo, ...safe } = user;
  res.json({ token: generarToken(user), user: safe });
}));

// ── Catálogo auxiliar ─────────────────────────────────────────────────────────

/** GET /api/catalogo - Listas para selects: marcas, categorías, colores, tallas, ubicaciones, proveedores */
app.get('/api/catalogo', authMiddleware, h(async (req, res) => {
  const q = async (sql) => (await db().query(sql))[0];
  const [marcas, categorias, colores, tallas, ubicaciones, proveedores] = await Promise.all([
    q('SELECT id, nombre FROM marcas WHERE activo = 1 ORDER BY nombre'),
    q('SELECT id, nombre FROM categorias ORDER BY nombre'),
    q('SELECT id, nombre, hex FROM colores ORDER BY nombre'),
    q('SELECT id, genero, us, eu, cm FROM tallas ORDER BY genero, eu'),
    q('SELECT id, nombre, tipo FROM ubicaciones WHERE activo = 1 ORDER BY tipo, id'),
    q('SELECT id, nombre FROM proveedores ORDER BY nombre'),
  ]);
  res.json({ marcas, categorias, colores, tallas, ubicaciones, proveedores });
}));

/** Alta simple de marca / color / categoría (solo admin) */
const altaSimple = (tabla, campos) => h(async (req, res) => {
  const nombre = String(req.body?.nombre ?? '').trim();
  if (!nombre) throw new HttpError(400, 'El nombre es requerido.');
  const valores = campos.map((c) => (c === 'nombre' ? nombre : req.body?.[c] ?? null));
  const [r] = await db().query(`INSERT INTO ${tabla} (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`, valores);
  res.status(201).json({ id: r.insertId, ...Object.fromEntries(campos.map((c, i) => [c, valores[i]])) });
});
app.post('/api/marcas',     authMiddleware, soloAdmin, altaSimple('marcas', ['nombre']));
app.post('/api/categorias', authMiddleware, soloAdmin, altaSimple('categorias', ['nombre']));
app.post('/api/colores',    authMiddleware, soloAdmin, altaSimple('colores', ['nombre', 'hex']));

// ── Modelos ───────────────────────────────────────────────────────────────────

const SELECT_MODELOS = `
  SELECT m.id, m.nombre, m.genero, m.codigo_estilo AS codigoEstilo, m.precio_base AS precioBase,
         m.marca_id AS marcaId, ma.nombre AS marca, m.categoria_id AS categoriaId, c.nombre AS categoria,
         (SELECT COUNT(*) FROM variantes v WHERE v.modelo_id = m.id AND v.activo = 1) AS variantes,
         COALESCE((SELECT SUM(s.cantidad) FROM stock s JOIN variantes v ON v.id = s.variante_id
                   WHERE v.modelo_id = m.id AND v.activo = 1), 0) AS pares
  FROM modelos m
  JOIN marcas ma ON ma.id = m.marca_id
  JOIN categorias c ON c.id = m.categoria_id
  WHERE m.activo = 1`;

app.get('/api/modelos', authMiddleware, h(async (req, res) => {
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

app.post('/api/modelos', authMiddleware, soloAdmin, h(async (req, res) => {
  const [r] = await db().query(
    'INSERT INTO modelos (marca_id, categoria_id, nombre, genero, codigo_estilo, precio_base) VALUES (?,?,?,?,?,?)', leerModelo(req.body));
  const [[row]] = await db().query(`${SELECT_MODELOS} AND m.id = ?`, [r.insertId]);
  res.status(201).json(row);
}));

app.put('/api/modelos/:id', authMiddleware, soloAdmin, h(async (req, res) => {
  const [r] = await db().query(
    'UPDATE modelos SET marca_id=?, categoria_id=?, nombre=?, genero=?, codigo_estilo=?, precio_base=? WHERE id=? AND activo=1',
    [...leerModelo(req.body), req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, 'Modelo no encontrado.');
  const [[row]] = await db().query(`${SELECT_MODELOS} AND m.id = ?`, [req.params.id]);
  res.json(row);
}));

/** DELETE /api/modelos/:id - Baja lógica (modelo y variantes). Exige stock en cero. */
app.delete('/api/modelos/:id', authMiddleware, soloAdmin, h(async (req, res) => {
  const [[m]] = await db().query(`${SELECT_MODELOS} AND m.id = ?`, [req.params.id]);
  if (!m) throw new HttpError(404, 'Modelo no encontrado.');
  if (m.pares > 0) throw new HttpError(409, `No se puede eliminar: aún hay ${m.pares} pares en stock.`);
  await db().query('UPDATE modelos SET activo = 0 WHERE id = ?', [req.params.id]);
  await db().query('UPDATE variantes SET activo = 0 WHERE modelo_id = ?', [req.params.id]);
  res.status(204).send();
}));

/**
 * POST /api/modelos/:id/variantes - Crea variantes en lote para un color y varias tallas.
 * Body: { colorId, tallaIds: number[], precio?, stockMinimo? }. Omite las que ya existen.
 */
app.post('/api/modelos/:id/variantes', authMiddleware, soloAdmin, h(async (req, res) => {
  const { colorId, tallaIds, precio, stockMinimo } = req.body ?? {};
  if (!colorId || !Array.isArray(tallaIds) || !tallaIds.length) throw new HttpError(400, 'Color y al menos una talla son requeridos.');

  const [[modelo]] = await db().query(
    'SELECT m.id, m.nombre, m.precio_base, ma.nombre AS marca FROM modelos m JOIN marcas ma ON ma.id = m.marca_id WHERE m.id = ? AND m.activo = 1', [req.params.id]);
  if (!modelo) throw new HttpError(404, 'Modelo no encontrado.');
  const [[color]] = await db().query('SELECT nombre FROM colores WHERE id = ?', [colorId]);
  if (!color) throw new HttpError(404, 'Color no encontrado.');
  const [tallas] = await db().query('SELECT id, eu FROM tallas WHERE id IN (?)', [tallaIds]);

  const [existentes] = await db().query('SELECT talla_id FROM variantes WHERE modelo_id = ? AND color_id = ?', [modelo.id, colorId]);
  const yaExisten = new Set(existentes.map((e) => e.talla_id));
  const nuevas = tallas.filter((t) => !yaExisten.has(t.id));
  if (!nuevas.length) throw new HttpError(409, 'Todas esas variantes ya existen.');

  await db().query('INSERT INTO variantes (modelo_id, color_id, talla_id, sku, precio, stock_minimo) VALUES ?', [
    nuevas.map((t) => [modelo.id, colorId, t.id, buildSku(modelo.marca, modelo.nombre, color.nombre, t.eu),
      Number(precio) || modelo.precio_base, Number.isInteger(Number(stockMinimo)) ? Number(stockMinimo) : 3]),
  ]);
  res.status(201).json({ creadas: nuevas.length, omitidas: tallas.length - nuevas.length });
}));

// ── Inventario ────────────────────────────────────────────────────────────────

/**
 * GET /api/inventario - Una fila por variante con el stock en cada ubicación.
 * Query opcional: modeloId.
 */
app.get('/api/inventario', authMiddleware, h(async (req, res) => {
  const params = [];
  let where = 'v.activo = 1 AND m.activo = 1';
  if (req.query.modeloId) { where += ' AND v.modelo_id = ?'; params.push(req.query.modeloId); }

  const [rows] = await db().query(`
    SELECT v.id, v.sku, v.codigo_barras AS codigoBarras, v.precio, v.stock_minimo AS stockMinimo,
           m.id AS modeloId, m.nombre AS modelo, ma.nombre AS marca, c.nombre AS categoria,
           co.nombre AS color, co.hex AS colorHex, t.genero, t.us, t.eu
    FROM variantes v
    JOIN modelos m ON m.id = v.modelo_id
    JOIN marcas ma ON ma.id = m.marca_id
    JOIN categorias c ON c.id = m.categoria_id
    JOIN colores co ON co.id = v.color_id
    JOIN tallas t ON t.id = v.talla_id
    WHERE ${where}
    ORDER BY ma.nombre, m.nombre, co.nombre, t.eu`, params);

  if (rows.length) {
    const [stocks] = await db().query('SELECT variante_id, ubicacion_id, cantidad FROM stock WHERE variante_id IN (?)', [rows.map((r) => r.id)]);
    const porVariante = new Map();
    for (const s of stocks) {
      if (!porVariante.has(s.variante_id)) porVariante.set(s.variante_id, {});
      porVariante.get(s.variante_id)[s.ubicacion_id] = s.cantidad;
    }
    for (const r of rows) {
      r.stock = porVariante.get(r.id) ?? {};
      r.total = Object.values(r.stock).reduce((a, b) => a + b, 0);
    }
  }
  res.json(rows);
}));

// ── Movimientos ───────────────────────────────────────────────────────────────

/**
 * Tipos que se registran desde el formulario general (los demás tienen su propio endpoint).
 * Los ajustes van por /api/ajustes: quedan pendientes y solo mueven stock al aprobarse (HU11).
 */
const TIPOS = ['ENTRADA', 'DESPACHO', 'DEVOLUCION', 'VENTA'];
const MOTIVOS_DEVOLUCION = ['TALLA_INCORRECTA', 'DEFECTO', 'SOBRANTE', 'OTRO'];

app.get('/api/movimientos', authMiddleware, h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const [rows] = await db().query(`
    SELECT mv.id, mv.tipo, mv.fecha, mv.motivo, mv.referencia, mv.observacion,
           u.nombre AS usuario, p.nombre AS proveedor, uo.nombre AS origen, ud.nombre AS destino,
           oc.codigo AS ordenCompra, mv.traslado_id AS trasladoId, mv.reserva_id AS reservaId,
           (SELECT CAST(COALESCE(IF(mv.tipo = 'CAMBIO', SUM(GREATEST(d.cantidad, 0)), SUM(d.cantidad)), 0) AS SIGNED)
              FROM movimiento_detalle d WHERE d.movimiento_id = mv.id) AS pares,
           (SELECT JSON_ARRAYAGG(JSON_OBJECT('sku', v.sku, 'modelo', m.nombre, 'color', co.nombre, 'talla', t.eu, 'cantidad', d.cantidad))
              FROM movimiento_detalle d JOIN variantes v ON v.id = d.variante_id JOIN modelos m ON m.id = v.modelo_id
              JOIN colores co ON co.id = v.color_id JOIN tallas t ON t.id = v.talla_id
             WHERE d.movimiento_id = mv.id) AS lineas
    FROM movimientos mv
    JOIN usuarios u ON u.id = mv.usuario_id
    LEFT JOIN proveedores p ON p.id = mv.proveedor_id
    LEFT JOIN ubicaciones uo ON uo.id = mv.origen_id
    LEFT JOIN ubicaciones ud ON ud.id = mv.destino_id
    LEFT JOIN ordenes_compra oc ON oc.id = mv.orden_compra_id
    ORDER BY mv.fecha DESC, mv.id DESC LIMIT ?`, [limit]);
  res.json(rows);
}));

/**
 * POST /api/movimientos
 * Body: { tipo, localId?, ubicacionId?, proveedorId?, motivo?, referencia?, observacion?, detalle: [{ varianteId, cantidad }] }
 *   ENTRADA    → proveedor → bodega (entrada directa; contra OC usar /api/ordenes-compra/:id/recepcion)
 *   DESPACHO   → bodega → localId
 *   DEVOLUCION → localId → bodega (motivo requerido)
 *   VENTA      → ubicacionId → cliente (HU06). Sin stock: 409 con las sedes que sí tienen.
 * Cada línea pasa por el motor de inventario (lib/inventario.js), que deja traza en el kardex.
 */
app.post('/api/movimientos', authMiddleware, h(async (req, res) => {
  const { tipo, localId, ubicacionId, proveedorId, motivo, referencia, observacion, detalle } = req.body ?? {};
  if (tipo === 'AJUSTE') throw new HttpError(400, 'Los ajustes se registran en Ajustes y requieren aprobación del jefe de bodega.');
  if (!TIPOS.includes(tipo)) throw new HttpError(400, 'Tipo de movimiento inválido.');
  const lineas = inv.consolidarLineas(detalle);

  const [[bodega]] = await db().query("SELECT id FROM ubicaciones WHERE tipo = 'BODEGA' AND activo = 1 LIMIT 1");
  let origenId = null, destinoId = null;

  if (tipo === 'ENTRADA') {
    destinoId = bodega.id;
  } else if (tipo === 'VENTA') {
    origenId = (await inv.sedeActiva(db(), ubicacionId)).id;
  } else {
    const [[local]] = await db().query("SELECT id FROM ubicaciones WHERE id = ? AND tipo = 'LOCAL' AND activo = 1", [localId ?? 0]);
    if (!local) throw new HttpError(400, 'Selecciona un local válido.');
    if (tipo === 'DESPACHO') { origenId = bodega.id; destinoId = local.id; }
    else {
      if (!MOTIVOS_DEVOLUCION.includes(motivo)) throw new HttpError(400, 'Motivo de devolución inválido.');
      origenId = local.id; destinoId = bodega.id;
    }
  }

  await inv.validarVariantes(db(), lineas.map(([id]) => id));

  const id = await inv.enTransaccion(async (conn) => {
    const movId = await inv.insertarMovimiento(conn, {
      tipo, usuarioId: req.user.id, proveedorId: tipo === 'ENTRADA' ? proveedorId || null : null, origenId, destinoId,
      motivo: tipo === 'DEVOLUCION' ? motivo : null, referencia, observacion,
    });
    for (const [varianteId, cant] of lineas) {
      await inv.insertarDetalle(conn, movId, varianteId, cant);
      if (origenId) await inv.moverStock(conn, movId, varianteId, origenId, -cant);
      if (destinoId) await inv.moverStock(conn, movId, varianteId, destinoId, cant);
    }
    return movId;
  });
  res.status(201).json({ id, tipo, lineas: lineas.length, pares: lineas.reduce((a, [, c]) => a + c, 0) });
}));

// ── Sprint 3 y 4: compras, kardex, traslados y tienda ─────────────────────────

app.use('/api/ordenes-compra', require('./routes/compras'));
app.use('/api/kardex', require('./routes/kardex'));
app.use('/api/traslados', require('./routes/traslados'));
app.use('/api', tienda.router);

// ── Sprint 5 y 6: control, alertas e informes ─────────────────────────────────

app.use('/api', require('./routes/control'));
app.use('/api/informes', require('./routes/informes'));

/** PUT /api/modelos/:id/costo { costo } - Costo unitario de todas las variantes del modelo (HU17, admin). */
app.put('/api/modelos/:id/costo', authMiddleware, soloAdmin, h(async (req, res) => {
  const costo = Number(req.body?.costo);
  if (!Number.isFinite(costo) || costo < 0) throw new HttpError(400, 'Costo inválido.');
  const [r] = await db().query('UPDATE variantes SET costo = ? WHERE modelo_id = ? AND activo = 1', [costo, req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, 'El modelo no tiene variantes activas.');
  res.json({ modeloId: Number(req.params.id), costo, variantes: r.affectedRows });
}));

// ── Dashboard ─────────────────────────────────────────────────────────────────

app.get('/api/dashboard/metrics', authMiddleware, h(async (req, res) => {
  const [[tot]] = await db().query(`
    SELECT (SELECT COUNT(*) FROM modelos WHERE activo = 1) AS totalModelos,
           (SELECT COUNT(*) FROM variantes WHERE activo = 1) AS totalVariantes,
           COALESCE(SUM(s.cantidad * v.precio), 0) AS valorInventario
    FROM stock s JOIN variantes v ON v.id = s.variante_id WHERE v.activo = 1`);

  const [porUbicacion] = await db().query(`
    SELECT u.id, u.nombre, u.tipo, COALESCE(SUM(s.cantidad), 0) AS pares
    FROM ubicaciones u LEFT JOIN stock s ON s.ubicacion_id = u.id
    LEFT JOIN variantes v ON v.id = s.variante_id AND v.activo = 1
    WHERE u.activo = 1 GROUP BY u.id ORDER BY u.tipo, u.id`);

  // Variantes de la bodega central en o por debajo de su mínimo (incluye agotadas)
  const [bajoStock] = await db().query(`
    SELECT v.id, v.sku, m.nombre AS modelo, ma.nombre AS marca, co.nombre AS color, t.eu,
           v.stock_minimo AS stockMinimo, COALESCE(s.cantidad, 0) AS stock
    FROM variantes v
    JOIN modelos m ON m.id = v.modelo_id AND m.activo = 1
    JOIN marcas ma ON ma.id = m.marca_id
    JOIN colores co ON co.id = v.color_id
    JOIN tallas t ON t.id = v.talla_id
    LEFT JOIN stock s ON s.variante_id = v.id AND s.ubicacion_id = (SELECT id FROM ubicaciones WHERE tipo = 'BODEGA' LIMIT 1)
    WHERE v.activo = 1 AND COALESCE(s.cantidad, 0) <= v.stock_minimo
    ORDER BY stock, m.nombre LIMIT 100`);

  const [[hoy]] = await db().query(`
    SELECT COUNT(*) AS movimientosHoy,
           CAST(COALESCE(SUM(tipo = 'ENTRADA'), 0) AS SIGNED) AS entradasHoy,
           CAST(COALESCE(SUM(tipo = 'DESPACHO'), 0) AS SIGNED) AS despachosHoy,
           CAST(COALESCE(SUM(tipo = 'VENTA'), 0) AS SIGNED) AS ventasHoy
    FROM movimientos WHERE fecha >= CURDATE()`);

  const [[pend]] = await db().query(`
    SELECT (SELECT COUNT(*) FROM traslados WHERE estado = 'EN_TRANSITO') AS trasladosEnTransito,
           (SELECT COUNT(*) FROM traslados WHERE novedad_estado = 'PENDIENTE') AS novedadesPendientes,
           (SELECT COUNT(*) FROM ordenes_compra WHERE estado IN ('PENDIENTE','RECIBIDA_PARCIAL')) AS ordenesAbiertas,
           (SELECT COUNT(*) FROM reservas WHERE estado = 'ACTIVA') AS reservasActivas,
           (SELECT COUNT(*) FROM alertas WHERE estado = 'ACTIVA') AS alertasActivas,
           (SELECT COUNT(*) FROM ajustes WHERE estado = 'PENDIENTE') AS ajustesPendientes,
           (SELECT COUNT(*) FROM conteos WHERE estado = 'ABIERTO') AS conteosAbiertos`);

  res.json({ ...tot, ...hoy, ...pend, porUbicacion, bajoStock });
}));

app.use('/api', (req, res) => res.status(404).json({ message: 'Ruta no encontrada.' }));

// ── Frontend (HT07): en producción el backend sirve el build de Vite en el mismo dominio ──

if (fs.existsSync(path.join(config.frontendDist, 'index.html'))) {
  app.use(express.static(config.frontendDist, { maxAge: '1h', index: false }));
  app.get('*', (req, res) => res.sendFile(path.join(config.frontendDist, 'index.html')));
}

// ── Errores ───────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.status) return res.status(err.status).json({ message: err.message, ...err.extra });
  if (err.sqlState === '45000') return res.status(409).json({ message: err.sqlMessage });
  if (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') {
    return res.status(409).json({ message: 'Otra operación estaba usando ese inventario. Intenta de nuevo.' });
  }
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Ya existe un registro con esos datos.' });
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ message: 'Referencia inválida (marca, color o talla no existe).' });
  console.error(err);
  res.status(500).json({ message: 'Error interno del servidor.' });
});

// ── Iniciar ───────────────────────────────────────────────────────────────────

init()
  .then(() => app.listen(PORT, () => {
    tareas.iniciar({ liberarReservas: tienda.liberarReservasVencidas }); // HT06
    console.log(`\n👟 Backend Bodega Sneakers (${config.env}) en http://localhost:${PORT} · base ${config.db.database}`);
    if (!config.produccion) console.log('   Usuarios de ejemplo: admin / bodega (claves en SEED_*_PASSWORD o las de demo)\n');
  }))
  .catch((err) => { console.error('❌ No se pudo iniciar la base de datos:', err.message); process.exit(1); });
