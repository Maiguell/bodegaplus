/**
 * @file server.js
 * @description API REST de la bodega de zapatillas (bodega central + 2 locales), sobre MySQL.
 * Stock por pares y por variante (modelo + color + talla) en cada ubicación.
 */

'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { init, getPool } = require('./db');
const { buildSku } = require('./utils/sku');

const app  = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'bodega-sneakers-dev-secret';

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// ── Helpers ───────────────────────────────────────────────────────────────────

const db = () => getPool();

/** Error HTTP controlado */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Envuelve handlers async para delegar errores al middleware final */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const generarToken = (u) => jwt.sign({ id: u.id, usuario: u.usuario, rol: u.rol }, JWT_SECRET, { expiresIn: '8h' });

const authMiddleware = (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ message: 'Token requerido.' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Token inválido o expirado.' });
  }
};

const soloAdmin = (req, res, next) =>
  req.user.rol === 'ADMIN' ? next() : res.status(403).json({ message: 'Solo un administrador puede hacer esto.' });

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
    SELECT v.id, v.sku, v.precio, v.stock_minimo AS stockMinimo,
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

const TIPOS = ['ENTRADA', 'DESPACHO', 'DEVOLUCION', 'AJUSTE'];
const MOTIVOS_DEVOLUCION = ['TALLA_INCORRECTA', 'DEFECTO', 'SOBRANTE', 'OTRO'];
const MOTIVOS_AJUSTE = ['CONTEO', 'MERMA', 'OTRO'];

app.get('/api/movimientos', authMiddleware, h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const [rows] = await db().query(`
    SELECT mv.id, mv.tipo, mv.fecha, mv.motivo, mv.referencia, mv.observacion,
           u.nombre AS usuario, p.nombre AS proveedor, uo.nombre AS origen, ud.nombre AS destino,
           (SELECT COALESCE(SUM(d.cantidad), 0) FROM movimiento_detalle d WHERE d.movimiento_id = mv.id) AS pares,
           (SELECT JSON_ARRAYAGG(JSON_OBJECT('sku', v.sku, 'modelo', m.nombre, 'color', co.nombre, 'talla', t.eu, 'cantidad', d.cantidad))
              FROM movimiento_detalle d JOIN variantes v ON v.id = d.variante_id JOIN modelos m ON m.id = v.modelo_id
              JOIN colores co ON co.id = v.color_id JOIN tallas t ON t.id = v.talla_id
             WHERE d.movimiento_id = mv.id) AS lineas
    FROM movimientos mv
    JOIN usuarios u ON u.id = mv.usuario_id
    LEFT JOIN proveedores p ON p.id = mv.proveedor_id
    LEFT JOIN ubicaciones uo ON uo.id = mv.origen_id
    LEFT JOIN ubicaciones ud ON ud.id = mv.destino_id
    ORDER BY mv.fecha DESC, mv.id DESC LIMIT ?`, [limit]);
  res.json(rows);
}));

/** Suma o resta pares de una variante en una ubicación; la resta falla si no alcanza. */
async function moverStock(conn, varianteId, ubicacionId, delta) {
  if (delta >= 0) {
    await conn.query(
      `INSERT INTO stock (variante_id, ubicacion_id, cantidad) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad)`, [varianteId, ubicacionId, delta]);
    return;
  }
  const [r] = await conn.query(
    'UPDATE stock SET cantidad = cantidad + ? WHERE variante_id = ? AND ubicacion_id = ? AND cantidad >= ?',
    [delta, varianteId, ubicacionId, -delta]);
  if (!r.affectedRows) {
    const [[v]] = await conn.query(
      `SELECT v.sku, COALESCE(s.cantidad, 0) AS disponible FROM variantes v
       LEFT JOIN stock s ON s.variante_id = v.id AND s.ubicacion_id = ? WHERE v.id = ?`, [ubicacionId, varianteId]);
    throw new HttpError(409, `Stock insuficiente de ${v?.sku ?? varianteId}: disponible ${v?.disponible ?? 0}, solicitado ${-delta}.`);
  }
}

/**
 * POST /api/movimientos
 * Body: { tipo, localId?, proveedorId?, motivo?, referencia?, observacion?, detalle: [{ varianteId, cantidad }] }
 *   ENTRADA    → proveedor → bodega
 *   DESPACHO   → bodega → localId
 *   DEVOLUCION → localId → bodega (motivo requerido)
 *   AJUSTE     → sobre ubicacionId (localId o bodega); cantidad con signo (solo admin)
 */
app.post('/api/movimientos', authMiddleware, h(async (req, res) => {
  const { tipo, localId, ubicacionId, proveedorId, motivo, referencia, observacion, detalle } = req.body ?? {};
  if (!TIPOS.includes(tipo)) throw new HttpError(400, 'Tipo de movimiento inválido.');
  if (!Array.isArray(detalle) || !detalle.length) throw new HttpError(400, 'Agrega al menos una línea.');
  if (tipo === 'AJUSTE' && req.user.rol !== 'ADMIN') throw new HttpError(403, 'Solo un administrador puede hacer ajustes.');

  // Consolida líneas repetidas de la misma variante
  const lineas = new Map();
  for (const l of detalle) {
    const id = Number(l.varianteId), cant = Number(l.cantidad);
    if (!id || !Number.isInteger(cant) || cant === 0 || (tipo !== 'AJUSTE' && cant < 0)) {
      throw new HttpError(400, 'Cada línea necesita variante y una cantidad entera válida.');
    }
    lineas.set(id, (lineas.get(id) ?? 0) + cant);
  }

  const [[bodega]] = await db().query("SELECT id FROM ubicaciones WHERE tipo = 'BODEGA' AND activo = 1 LIMIT 1");
  let origenId = null, destinoId = null;

  if (tipo === 'ENTRADA') {
    destinoId = bodega.id;
  } else if (tipo === 'AJUSTE') {
    if (!MOTIVOS_AJUSTE.includes(motivo)) throw new HttpError(400, 'Motivo de ajuste inválido.');
    destinoId = Number(ubicacionId) || bodega.id;
  } else {
    const [[local]] = await db().query("SELECT id FROM ubicaciones WHERE id = ? AND tipo = 'LOCAL' AND activo = 1", [localId ?? 0]);
    if (!local) throw new HttpError(400, 'Selecciona un local válido.');
    if (tipo === 'DESPACHO') { origenId = bodega.id; destinoId = local.id; }
    else {
      if (!MOTIVOS_DEVOLUCION.includes(motivo)) throw new HttpError(400, 'Motivo de devolución inválido.');
      origenId = local.id; destinoId = bodega.id;
    }
  }

  const ids = [...lineas.keys()];
  const [existentes] = await db().query('SELECT id FROM variantes WHERE id IN (?) AND activo = 1', [ids]);
  if (existentes.length !== ids.length) throw new HttpError(404, 'Alguna variante no existe.');

  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const [mv] = await conn.query(
      `INSERT INTO movimientos (tipo, usuario_id, proveedor_id, origen_id, destino_id, motivo, referencia, observacion)
       VALUES (?,?,?,?,?,?,?,?)`,
      [tipo, req.user.id, tipo === 'ENTRADA' ? proveedorId || null : null, origenId, destinoId,
        tipo === 'DEVOLUCION' || tipo === 'AJUSTE' ? motivo : null, referencia?.trim() || null, observacion?.trim() || null]);

    for (const [varianteId, cant] of lineas) {
      await conn.query('INSERT INTO movimiento_detalle (movimiento_id, variante_id, cantidad) VALUES (?,?,?)', [mv.insertId, varianteId, cant]);
      if (origenId) await moverStock(conn, varianteId, origenId, -cant);
      await moverStock(conn, varianteId, destinoId, cant);
    }
    await conn.commit();
    res.status(201).json({ id: mv.insertId, tipo, lineas: lineas.size, pares: [...lineas.values()].reduce((a, b) => a + b, 0) });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
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
           COALESCE(SUM(tipo = 'ENTRADA'), 0) AS entradasHoy,
           COALESCE(SUM(tipo = 'DESPACHO'), 0) AS despachosHoy
    FROM movimientos WHERE fecha >= CURDATE()`);

  res.json({ ...tot, ...hoy, porUbicacion, bajoStock });
}));

// ── Errores ───────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Ya existe un registro con esos datos.' });
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ message: 'Referencia inválida (marca, color o talla no existe).' });
  console.error(err);
  res.status(500).json({ message: 'Error interno del servidor.' });
});

// ── Iniciar ───────────────────────────────────────────────────────────────────

init()
  .then(() => app.listen(PORT, () => {
    console.log(`\n👟 Backend Bodega Sneakers en http://localhost:${PORT}`);
    console.log('   admin / admin123   (Administrador)');
    console.log('   bodega / bodega123 (Operador)\n');
  }))
  .catch((err) => { console.error('❌ No se pudo iniciar la base de datos:', err.message); process.exit(1); });
