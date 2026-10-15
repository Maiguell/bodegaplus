/**
 * @module api
 * @description Cliente HTTP centralizado para comunicación con el backend.
 * Todas las peticiones pasan por este módulo para mantener una única fuente
 * de verdad para la URL base, headers y manejo de errores HTTP.
 */

/** URL base del backend. Puede sobreescribirse mediante variable de entorno de Vite. */
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api';

/**
 * Recupera el token JWT almacenado en sessionStorage.
 * @returns {string|null} Token JWT o null si no existe.
 */
const getToken = () => sessionStorage.getItem('token');

/**
 * Construye los headers HTTP comunes para todas las peticiones.
 * Agrega el header Authorization si existe un token JWT activo.
 * @returns {HeadersInit} Objeto de headers HTTP.
 */
const buildHeaders = () => {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

/**
 * Función base que encapsula la lógica de fetch, manejo de respuesta y errores.
 * @param {string} endpoint - Ruta relativa al BASE_URL (ej: '/productos').
 * @param {RequestInit} [options={}] - Opciones de fetch (method, body, etc.).
 * @returns {Promise<any>} Datos JSON de la respuesta.
 * @throws {Error} Si la respuesta HTTP no es exitosa (status >= 400).
 */
const request = async (endpoint, options = {}) => {
  const url = `${BASE_URL}${endpoint}`;
  const config = {
    ...options,
    headers: { ...buildHeaders(), ...(options.headers ?? {}) },
  };

  const response = await fetch(url, config);

  if (!response.ok) {
    // Intenta parsear el mensaje de error del backend
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(errorData.message ?? `Error HTTP ${response.status}`);
  }

  // 204 No Content no tiene cuerpo
  if (response.status === 204) return null;

  return response.json();
};

// ── Métodos HTTP públicos ─────────────────────────────────────────────────────

/**
 * Realiza una petición GET.
 * @param {string} endpoint - Ruta del recurso.
 * @returns {Promise<any>}
 */
export const get = (endpoint) => request(endpoint, { method: 'GET' });

/**
 * Realiza una petición POST enviando datos JSON.
 * @param {string} endpoint - Ruta del recurso.
 * @param {object} data - Objeto a serializar como JSON en el body.
 * @returns {Promise<any>}
 */
export const post = (endpoint, data) =>
  request(endpoint, { method: 'POST', body: JSON.stringify(data) });

/**
 * Realiza una petición PUT (reemplazo completo de recurso).
 * @param {string} endpoint - Ruta del recurso con ID (ej: '/productos/5').
 * @param {object} data - Datos actualizados del recurso.
 * @returns {Promise<any>}
 */
export const put = (endpoint, data) =>
  request(endpoint, { method: 'PUT', body: JSON.stringify(data) });

/**
 * Realiza una petición PATCH (actualización parcial de recurso).
 * @param {string} endpoint - Ruta del recurso con ID.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<any>}
 */
export const patch = (endpoint, data) =>
  request(endpoint, { method: 'PATCH', body: JSON.stringify(data) });

/**
 * Realiza una petición DELETE.
 * @param {string} endpoint - Ruta del recurso con ID (ej: '/productos/5').
 * @returns {Promise<any>}
 */
export const del = (endpoint) => request(endpoint, { method: 'DELETE' });
