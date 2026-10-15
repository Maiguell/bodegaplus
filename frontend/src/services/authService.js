/**
 * @module authService
 * @description Servicio de autenticación: login, logout y verificación de sesión.
 * Persiste el token JWT y datos del usuario en sessionStorage.
 */

import * as api from './api.js';

const TOKEN_KEY = 'token';
const USER_KEY  = 'user';

/**
 * Envía las credenciales al backend y persiste el token en sessionStorage.
 * @param {string} usuario - Correo o nombre de usuario.
 * @param {string} password - Contraseña del usuario.
 * @returns {Promise<{token: string, user: object}>} Datos de sesión del backend.
 * @throws {Error} Si las credenciales son inválidas o el servidor falla.
 */
export const login = async (usuario, password) => {
  const data = await api.post('/auth/login', { usuario, password });
  sessionStorage.setItem(TOKEN_KEY, data.token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data;
};

/**
 * Cierra la sesión actual eliminando los datos del sessionStorage y
 * redirigiendo al usuario a la pantalla de login.
 * @returns {void}
 */
export const logout = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  window.location.hash = '#/login';
};

/**
 * Verifica si existe una sesión activa (token almacenado).
 * @returns {boolean} true si el usuario está autenticado.
 */
export const isAuthenticated = () => !!sessionStorage.getItem(TOKEN_KEY);

/**
 * Recupera los datos del usuario autenticado desde sessionStorage.
 * @returns {object|null} Objeto de usuario o null si no hay sesión.
 */
export const getUser = () => {
  const raw = sessionStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
};
