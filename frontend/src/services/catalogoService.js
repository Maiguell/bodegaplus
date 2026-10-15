/**
 * @module catalogoService
 * @description Catálogo de zapatillas: marcas, colores, tallas, modelos y variantes (SKU por talla).
 */

import * as api from './api.js';

/** Listas para selects: marcas, categorías, colores, tallas, ubicaciones y proveedores. */
export const getCatalogo = () => api.get('/catalogo');

export const getModelos = () => api.get('/modelos');
export const createModelo = (modelo) => api.post('/modelos', modelo);
export const updateModelo = (id, modelo) => api.put(`/modelos/${id}`, modelo);
export const deleteModelo = (id) => api.del(`/modelos/${id}`);

/**
 * Crea variantes en lote para un modelo: un color y varias tallas.
 * @param {number} modeloId
 * @param {{colorId: number, tallaIds: number[], precio?: number, stockMinimo?: number}} datos
 */
export const crearVariantes = (modeloId, datos) => api.post(`/modelos/${modeloId}/variantes`, datos);

export const createMarca = (nombre) => api.post('/marcas', { nombre });
export const createColor = (nombre, hex) => api.post('/colores', { nombre, hex });

/** Una fila por variante con su stock en cada ubicación ({ [ubicacionId]: pares }). */
export const getInventario = (modeloId) => api.get(modeloId ? `/inventario?modeloId=${modeloId}` : '/inventario');
