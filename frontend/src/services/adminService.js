/**
 * @module adminService
 * @description Administración: usuarios y roles (HU19) y parametrización sin tocar código (RNF-08).
 */

import * as api from './api.js';

// ── HU19: Usuarios ────────────────────────────────────────────────────────────
export const getUsuarios = () => api.get('/usuarios');
/** @param {{usuario:string, nombre:string, rol:string, sedeId?:number, password:string}} u */
export const crearUsuario = (u) => api.post('/usuarios', u);
export const actualizarUsuario = (id, datos) => api.put(`/usuarios/${id}`, datos);
export const restablecerPassword = (id, password) => api.post(`/usuarios/${id}/password`, { password });
export const desbloquearUsuario = (id) => api.post(`/usuarios/${id}/desbloquear`, {});

// ── RNF-08: Parámetros ────────────────────────────────────────────────────────
export const getParametros = () => api.get('/parametros');
export const actualizarParametro = (clave, valor) => api.put(`/parametros/${clave}`, { valor });
export const crearSede = (sede) => api.post('/ubicaciones', sede);
export const actualizarSede = (id, datos) => api.put(`/ubicaciones/${id}`, datos);
export const crearTalla = (talla) => api.post('/tallas', talla);
export const crearCausal = (nombre) => api.post('/causales', { nombre });
export const actualizarCausal = (codigo, datos) => api.put(`/causales/${codigo}`, datos);
export const crearAlta = (tipo, datos) => api.post(`/${tipo}`, datos); // marcas | categorias | colores | proveedores
