/**
 * @file lib/auth.js
 * @description Emisión y verificación de JWT, y guardas de rol.
 */

'use strict';

const jwt = require('jsonwebtoken');
const { jwtSecret: JWT_SECRET } = require('./config');

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

module.exports = { generarToken, authMiddleware, soloAdmin };
