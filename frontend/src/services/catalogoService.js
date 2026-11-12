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

/**
 * HU01 — Crea la referencia y todas sus variantes talla × color en una sola operación.
 * @param {{marcaId:number, categoriaId:number, nombre:string, genero:string, codigoEstilo?:string,
 *          precioBase:number, costo?:number, stockMinimo?:number, colorIds:number[], tallaIds:number[]}} ref
 */
export const crearReferencia = (ref) => api.post('/referencias', ref);

/** HU02 — Importa el catálogo desde el texto CSV de la plantilla; devuelve el reporte de filas. */
export const importarCatalogo = (csv) => api.post('/catalogo/importar', { csv });

/** HU02 — Descarga la plantilla CSV (requiere sesión, por eso no es un enlace directo). */
export const descargarPlantilla = async () => {
  const texto = await api.get('/catalogo/plantilla');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'plantilla-catalogo.csv' });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};

// HU03 — Ubicaciones físicas (estantería-nivel) por sede
export const getUbicacionesBodega = (sedeId) => api.get(sedeId ? `/ubicaciones-bodega?sedeId=${sedeId}` : '/ubicaciones-bodega');
export const crearUbicacionBodega = (sedeId, codigo, descripcion) => api.post('/ubicaciones-bodega', { sedeId, codigo, descripcion });
export const asignarUbicacion = (modeloId, sedeId, ubicacionBodegaId) => api.put(`/modelos/${modeloId}/ubicacion`, { sedeId, ubicacionBodegaId });
