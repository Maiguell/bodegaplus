/**
 * @file routes/usuarios.js
 * @description HU19 — Administración de usuarios: rol, sede, activación, restablecer contraseña y desbloquear.
 */

'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { getPool } = require('../db');
const { HttpError, h } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { requiere, ROLES, ROLES_CON_SEDE } = require('../lib/permisos');
const { validarPassword } = require('../lib/reglas');
const parametros = require('../lib/parametros');

const router = express.Router();
const db = () => getPool();
router.use(authMiddleware, requiere('usuarios'));

const SELECT = `
  SELECT u.id, u.usuario, u.nombre, u.rol, u.sede_id AS sedeId, s.nombre AS sede, u.activo,
         u.bloqueado_hasta > NOW() AS bloqueado, u.bloqueado_hasta AS bloqueadoHasta, u.ultimo_acceso AS ultimoAcceso
  FROM usuarios u LEFT JOIN ubicaciones s ON s.id = u.sede_id`;

const leer = async (id) => {
  const [[u]] = await db().query(`${SELECT} WHERE u.id = ?`, [id]);
  if (!u) throw new HttpError(404, 'Usuario no encontrado.');
  return { ...u, rolNombre: ROLES[u.rol] };
};

/** Valida rol y sede: los roles de tienda deben tener sede. */
async function validarRolSede(rol, sedeId) {
  if (!ROLES[rol]) throw new HttpError(400, 'Rol inválido.');
  if (ROLES_CON_SEDE.includes(rol) && !sedeId) throw new HttpError(400, `El rol ${ROLES[rol]} requiere una sede.`);
  if (sedeId) {
    const [[s]] = await db().query('SELECT id FROM ubicaciones WHERE id = ? AND activo = 1', [sedeId]);
    if (!s) throw new HttpError(400, 'Sede inválida.');
  }
  return sedeId ? Number(sedeId) : null;
}

async function exigirPolitica(password) {
  const r = validarPassword(password, { min: await parametros.obtener('PASSWORD_MIN') });
  if (!r.ok) throw new HttpError(400, r.errores.join(' '), { errores: r.errores });
}

router.get('/', h(async (req, res) => {
  const [rows] = await db().query(`${SELECT} ORDER BY u.activo DESC, u.nombre`);
  res.json({ usuarios: rows.map((u) => ({ ...u, rolNombre: ROLES[u.rol] })), roles: ROLES, rolesConSede: ROLES_CON_SEDE });
}));

/** POST /api/usuarios { usuario, nombre, rol, sedeId?, password } */
router.post('/', h(async (req, res) => {
  const { rol, sedeId, password } = req.body ?? {};
  const usuario = String(req.body?.usuario ?? '').trim().toLowerCase();
  const nombre = String(req.body?.nombre ?? '').trim();
  if (!/^[a-z0-9._-]{3,50}$/.test(usuario)) throw new HttpError(400, 'Usuario de 3 a 50 caracteres: letras, números, punto, guion.');
  if (!nombre) throw new HttpError(400, 'El nombre es requerido.');
  const sede = await validarRolSede(rol, sedeId);
  await exigirPolitica(password);
  const [r] = await db().query('INSERT INTO usuarios (usuario, password_hash, nombre, rol, sede_id) VALUES (?,?,?,?,?)',
    [usuario, await bcrypt.hash(password, 10), nombre.slice(0, 100), rol, sede]);
  res.status(201).json(await leer(r.insertId));
}));

/** PUT /api/usuarios/:id { nombre, rol, sedeId, activo } */
router.put('/:id', h(async (req, res) => {
  const actual = await leer(req.params.id);
  const rol = req.body?.rol ?? actual.rol;
  const sede = await validarRolSede(rol, req.body?.sedeId === undefined ? actual.sedeId : req.body.sedeId);
  const activo = req.body?.activo === undefined ? actual.activo : (req.body.activo ? 1 : 0);
  if (Number(req.params.id) === req.user.id && (rol !== 'ADMIN' || !activo)) {
    throw new HttpError(400, 'No puedes quitarte el rol de administrador ni desactivar tu propia cuenta.');
  }
  const nombre = String(req.body?.nombre ?? actual.nombre).trim() || actual.nombre;
  await db().query('UPDATE usuarios SET nombre = ?, rol = ?, sede_id = ?, activo = ? WHERE id = ?', [nombre, rol, sede, activo, req.params.id]);
  res.json(await leer(req.params.id));
}));

/** POST /api/usuarios/:id/password { password } — restablece la contraseña. */
router.post('/:id/password', h(async (req, res) => {
  await leer(req.params.id);
  await exigirPolitica(req.body?.password);
  await db().query('UPDATE usuarios SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?',
    [await bcrypt.hash(req.body.password, 10), req.params.id]);
  res.json(await leer(req.params.id));
}));

router.post('/:id/desbloquear', h(async (req, res) => {
  await db().query('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', [req.params.id]);
  res.json(await leer(req.params.id));
}));

module.exports = router;
