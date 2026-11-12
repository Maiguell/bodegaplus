/**
 * @module api
 * @description Cliente HTTP centralizado.
 *   - Agrega el token JWT y normaliza los errores del backend.
 *   - Si el backend responde 401 con sesión abierta, la cierra (token vencido o cuenta desactivada).
 *   - RNF-07 (modo consulta sin conexión): guarda la última respuesta de las consultas de inventario
 *     y disponibilidad; si se pierde la conexión, devuelve esa copia y avisa que puede estar desactualizada.
 */

/**
 * URL base del backend. En producción el backend sirve el frontend en el mismo dominio (HT07),
 * así que basta la ruta relativa. Se puede sobreescribir con VITE_API_URL al compilar.
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '/api' : 'http://localhost:8080/api');

/** Consultas que se guardan para el modo sin conexión. */
const CACHEABLES = [/^\/catalogo$/, /^\/inventario$/, /^\/disponibilidad\?/, /^\/modelos$/];
const CACHE_PREFIJO = 'offline:';

const getToken = () => sessionStorage.getItem('token');

const buildHeaders = () => {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const guardarCopia = (endpoint, data) => {
  try { localStorage.setItem(CACHE_PREFIJO + endpoint, JSON.stringify({ t: Date.now(), data })); }
  catch { /* almacenamiento lleno o bloqueado: el modo sin conexión no tendrá esta consulta */ }
};

/** Última copia guardada de una consulta: { t, data } o null. */
export const copiaSinConexion = (endpoint) => {
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIJO + endpoint) ?? 'null'); } catch { return null; }
};

let sinConexion = false;
const avisar = (offline, desde) => {
  if (offline === sinConexion && !offline) return;
  sinConexion = offline;
  window.dispatchEvent(new CustomEvent('estado-conexion', { detail: { offline, desde } }));
};
export const estaSinConexion = () => sinConexion;

const request = async (endpoint, options = {}) => {
  const url = `${BASE_URL}${endpoint}`;
  const config = { ...options, headers: { ...buildHeaders(), ...(options.headers ?? {}) } };
  const esGet = (options.method ?? 'GET') === 'GET';
  const cacheable = esGet && CACHEABLES.some((re) => re.test(endpoint));

  let response;
  try {
    response = await fetch(url, config);
  } catch (err) {
    // Sin red o servidor caído: modo consulta con la última copia (RNF-07)
    const copia = cacheable ? copiaSinConexion(endpoint) : null;
    if (copia) {
      avisar(true, copia.t);
      return copia.data;
    }
    avisar(true, null);
    const e = new Error(esGet ? 'Sin conexión con el servidor y sin datos guardados para esta consulta.' : 'Sin conexión: no se pudo guardar. Intenta cuando vuelva la red.');
    e.sinConexion = true;
    throw e;
  }
  avisar(false);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    if (response.status === 401 && getToken() && !endpoint.startsWith('/auth/login')) {
      sessionStorage.clear();
      window.location.hash = '#/login';
    }
    const error = new Error(errorData.message ?? `Error HTTP ${response.status}`);
    error.status = response.status;
    error.data = errorData; // p. ej. { codigo: 'STOCK_INSUFICIENTE', sugerencias: [...] }
    throw error;
  }

  if (response.status === 204) return null;
  const tipo = response.headers.get('Content-Type') ?? '';
  const data = tipo.includes('application/json') ? await response.json() : await response.text();
  if (cacheable) guardarCopia(endpoint, data);
  return data;
};

export const get = (endpoint) => request(endpoint, { method: 'GET' });
export const post = (endpoint, data) => request(endpoint, { method: 'POST', body: JSON.stringify(data) });
export const put = (endpoint, data) => request(endpoint, { method: 'PUT', body: JSON.stringify(data) });
export const patch = (endpoint, data) => request(endpoint, { method: 'PATCH', body: JSON.stringify(data) });
export const del = (endpoint) => request(endpoint, { method: 'DELETE' });
