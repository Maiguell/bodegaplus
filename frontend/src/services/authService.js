/**
 * @module authService
 * @description Sesión del usuario (HU19 / HU20 / HT02): login, logout, permisos del rol, sede asignada
 * y renovación del token. Persiste el token JWT y el perfil en sessionStorage.
 */

import * as api from './api.js';

const TOKEN_KEY = 'token';
const USER_KEY  = 'user';
const EMITIDO_KEY = 'token_emitido';
const RENOVAR_TRAS_MS = 6 * 3_600_000; // el token dura 8 h; se renueva a las 6 h

const guardar = (data) => {
  sessionStorage.setItem(TOKEN_KEY, data.token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
  sessionStorage.setItem(EMITIDO_KEY, String(Date.now()));
};

/**
 * Envía las credenciales al backend y persiste la sesión.
 * @throws {Error} Credenciales inválidas (401) o cuenta bloqueada (423).
 */
export const login = async (usuario, password) => {
  const data = await api.post('/auth/login', { usuario, password });
  guardar(data);
  return data;
};

/** Cierra la sesión y vuelve al login. */
export const logout = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(EMITIDO_KEY);
  window.location.hash = '#/login';
};

export const isAuthenticated = () => !!sessionStorage.getItem(TOKEN_KEY);

/** Perfil: { id, usuario, nombre, rol, rolNombre, sedeId, sede, permisos[] } */
export const getUser = () => {
  const raw = sessionStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
};

/** ¿El rol del usuario tiene el permiso? (el backend vuelve a validar y responde 403 si no). */
export const puede = (permiso) => {
  const u = getUser();
  return u?.rol === 'ADMIN' || !!u?.permisos?.includes(permiso);
};

/** Vendedores y administradores de tienda solo operan en su sede. */
export const restringidoASede = () => {
  const u = getUser();
  return ['VENDEDOR', 'ADMIN_TIENDA'].includes(u?.rol) && !!u?.sedeId;
};

/** Sedes en las que el usuario puede operar (todas, o solo la suya). */
export const sedesOperables = (ubicaciones) =>
  restringidoASede() ? ubicaciones.filter((u) => u.id === getUser().sedeId) : ubicaciones;

/** Pantalla inicial según el rol (HU20: "me lleva al panel de mi rol"). */
export const rutaInicio = () => {
  const rol = getUser()?.rol;
  if (rol === 'VENDEDOR') return '#/disponibilidad';
  if (rol === 'AUDITOR') return '#/informes';
  return '#/dashboard';
};

/** Renueva el token antes de que expire (HT02). Se llama periódicamente desde main.js. */
export const renovarSiHaceFalta = async () => {
  if (!isAuthenticated()) return;
  const emitido = Number(sessionStorage.getItem(EMITIDO_KEY)) || 0;
  if (Date.now() - emitido < RENOVAR_TRAS_MS) return;
  try { guardar(await api.post('/auth/renovar', {})); } catch { /* si falla, el 401 cerrará la sesión */ }
};

export const cambiarPassword = (actual, nueva) => api.post('/auth/cambiar-password', { actual, nueva });
