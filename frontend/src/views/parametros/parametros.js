/**
 * @module parametrosView
 * @description RNF-08 — Parametrización sin tocar código: valores de negocio, sedes, tallas, colores,
 * marcas, categorías, proveedores y causales de ajuste. (Los stocks mínimos por talla y sede se
 * ajustan en Alertas de stock.)
 */

import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getCatalogo } from '../../services/catalogoService.js';
import { getParametros, actualizarParametro, crearSede, actualizarSede, crearTalla, crearCausal, actualizarCausal, crearAlta } from '../../services/adminService.js';
import { showToast } from '../../utils/toast.js';
import { esc } from '../../utils/format.js';

let p = { parametros: [], sedes: [], causales: [] };
let cat = { tallas: [], colores: [], marcas: [], categorias: [], proveedores: [] };
const GENEROS = { HOMBRE: 'Hombre', MUJER: 'Mujer', UNISEX: 'Unisex', NINO: 'Niño/a' };

const tarjeta = (titulo, cuerpo, nota = '') => `<div class="card op-card"><h2 class="section-title">${titulo}</h2>${nota ? `<p class="op-hint">${nota}</p>` : ''}${cuerpo}</div>`;
const chips = (lista, texto) => `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px;">${lista.map((x) => `<span class="badge badge-info">${esc(texto(x))}</span>`).join('') || '<span class="op-hint">Sin registros</span>'}</div>`;
const altaRapida = (tipo, placeholder, extra = '') => `
  <form class="op-row" data-alta="${tipo}">
    <div class="form-group" style="flex:2;"><input name="nombre" class="form-input" placeholder="${placeholder}" /></div>${extra}
    <button type="submit" class="btn btn-secondary">Agregar</button>
  </form>`;

const render = () => {
  document.getElementById('pa-contenido').innerHTML = `
    ${tarjeta('Valores de negocio', `
      <div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Parámetro</th><th>Valor</th><th>Rango</th></tr></thead><tbody>
        ${p.parametros.map((x) => `<tr><td>${esc(x.descripcion)}<br><span class="op-item-meta">${esc(x.clave)} · por defecto ${x.defecto}</span></td>
          <td><input type="number" class="form-input op-input-sm" value="${x.valor}" min="${x.min}" max="${x.max}" data-param="${x.clave}" /></td>
          <td class="op-item-meta">${x.min} – ${x.max}</td></tr>`).join('')}
      </tbody></table></div>`, 'Se aplican de inmediato, sin reiniciar el sistema.')}

    ${tarjeta('Sedes', `
      <div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Sede</th><th>Tipo</th><th>Dirección</th><th>Estado</th><th></th></tr></thead><tbody>
        ${p.sedes.map((s) => `<tr style="${s.activo ? '' : 'opacity:.55;'}"><td><strong>${esc(s.nombre)}</strong></td><td>${s.tipo === 'BODEGA' ? 'Bodega' : 'Local'}</td>
          <td>${esc(s.direccion ?? '—')}</td><td>${s.activo ? '<span class="badge badge-success">Activa</span>' : '<span class="badge badge-danger">Inactiva</span>'}</td>
          <td><div class="op-item-actions"><button type="button" class="btn btn-sm btn-secondary" data-sede-renombrar="${s.id}">Renombrar</button>
            <button type="button" class="btn btn-sm btn-secondary" data-sede-activo="${s.id}">${s.activo ? 'Desactivar' : 'Activar'}</button></div></td></tr>`).join('')}
      </tbody></table></div>
      <form class="op-row" id="pa-sede" style="margin-top:12px;">
        <div class="form-group" style="flex:2;"><input name="nombre" class="form-input" placeholder="Nombre de la nueva sede" /></div>
        <div class="form-group"><select name="tipo" class="form-select"><option value="LOCAL">Local</option><option value="BODEGA">Bodega</option></select></div>
        <div class="form-group" style="flex:2;"><input name="direccion" class="form-input" placeholder="Dirección (opcional)" /></div>
        <button type="submit" class="btn btn-secondary">Agregar sede</button>
      </form>`, 'Una sede con existencias no se puede desactivar.')}

    ${tarjeta('Causales de ajuste', `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px;">
        ${p.causales.map((c) => `<button type="button" class="btn btn-sm ${c.activo ? 'btn-secondary' : ''}" style="${c.activo ? '' : 'opacity:.5;text-decoration:line-through;'}"
          data-causal="${esc(c.codigo)}" data-activo="${c.activo}" title="${c.activo ? 'Clic para desactivar' : 'Clic para activar'}">${esc(c.nombre)}</button>`).join('')}
      </div>
      <form class="op-row" id="pa-causal"><div class="form-group" style="flex:2;"><input name="nombre" class="form-input" placeholder="Nueva causal (ej. Robo)" /></div>
        <button type="submit" class="btn btn-secondary">Agregar</button></form>`, 'Las causales inactivas no aparecen al registrar ajustes; el historial las conserva.')}

    ${tarjeta('Tallas', `
      ${Object.entries(GENEROS).map(([g, n]) => `<div><strong style="font-size:var(--fs-small);">${n}</strong>${chips(cat.tallas.filter((t) => t.genero === g), (t) => `EU ${t.eu} · US ${t.us}`)}</div>`).join('')}
      <form class="op-row" id="pa-talla">
        <div class="form-group"><select name="genero" class="form-select">${Object.entries(GENEROS).map(([g, n]) => `<option value="${g}">${n}</option>`).join('')}</select></div>
        <div class="form-group"><input name="eu" type="number" step="0.5" class="form-input" placeholder="EU" /></div>
        <div class="form-group"><input name="us" type="number" step="0.5" class="form-input" placeholder="US" /></div>
        <button type="submit" class="btn btn-secondary">Agregar talla</button>
      </form>`)}

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:24px;">
      ${tarjeta('Colores', chips(cat.colores, (c) => c.nombre) + altaRapida('colores', 'Nuevo color', '<div class="form-group" style="max-width:80px;"><input name="hex" type="color" class="form-input" value="#888888" style="padding:2px;height:42px;" /></div>'))}
      ${tarjeta('Marcas', chips(cat.marcas, (m) => m.nombre) + altaRapida('marcas', 'Nueva marca'))}
      ${tarjeta('Categorías', chips(cat.categorias, (c) => c.nombre) + altaRapida('categorias', 'Nueva categoría'))}
      ${tarjeta('Proveedores', chips(cat.proveedores, (x) => x.nombre) + altaRapida('proveedores', 'Nuevo proveedor', '<div class="form-group" style="flex:2;"><input name="contacto" class="form-input" placeholder="Contacto (opcional)" /></div>'))}
    </div>`;
};

const recargar = async () => { [p, cat] = await Promise.all([getParametros(), getCatalogo()]); render(); };

export const initParametros = async () => {
  renderView(`<div class="app-shell">${buildSidebar('parametros')}<main class="main-content"><div class="page-wrapper">
    <div class="loader-container"><div class="spinner"></div> Cargando…</div></div></main></div>`);
  try { [p, cat] = await Promise.all([getParametros(), getCatalogo()]); } catch (err) { showToast(err.message, 'error'); }

  renderView(`
    <div class="app-shell">
      ${buildSidebar('parametros')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header"><div>
          <h1 class="page-title">Parámetros</h1>
          <p class="page-subtitle">Configura el sistema sin tocar código. Los stocks mínimos por talla y sede se ajustan en Alertas de stock.</p>
        </div></header>
        <div id="pa-contenido" style="display:flex;flex-direction:column;gap:24px;"></div>
      </div></main>
    </div>`);
  attachSidebarLogout();
  render();

  const cont = document.getElementById('pa-contenido');
  const ejecutar = async (fn, ok) => { try { await fn(); showToast(ok, 'success'); await recargar(); } catch (err) { showToast(err.message, 'error'); } };

  cont.addEventListener('change', (e) => {
    const i = e.target.closest('[data-param]');
    if (i) ejecutar(() => actualizarParametro(i.dataset.param, Number(i.value)), 'Parámetro actualizado.');
  });
  cont.addEventListener('click', (e) => {
    const ren = e.target.closest('[data-sede-renombrar]'), act = e.target.closest('[data-sede-activo]'), cau = e.target.closest('[data-causal]');
    if (ren) {
      const s = p.sedes.find((x) => x.id === Number(ren.dataset.sedeRenombrar));
      const nombre = prompt('Nuevo nombre de la sede:', s.nombre);
      if (nombre?.trim()) ejecutar(() => actualizarSede(s.id, { nombre }), 'Sede actualizada.');
    } else if (act) {
      const s = p.sedes.find((x) => x.id === Number(act.dataset.sedeActivo));
      ejecutar(() => actualizarSede(s.id, { activo: !s.activo }), s.activo ? 'Sede desactivada.' : 'Sede activada.');
    } else if (cau) {
      ejecutar(() => actualizarCausal(cau.dataset.causal, { activo: cau.dataset.activo !== '1' }), 'Causal actualizada.');
    }
  });
  cont.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (e.target.id === 'pa-sede') ejecutar(() => crearSede(f), 'Sede creada.');
    else if (e.target.id === 'pa-causal') ejecutar(() => crearCausal(f.nombre), 'Causal creada.');
    else if (e.target.id === 'pa-talla') ejecutar(() => crearTalla({ genero: f.genero, eu: Number(f.eu), us: Number(f.us) }), 'Talla creada.');
    else if (e.target.dataset.alta) ejecutar(() => crearAlta(e.target.dataset.alta, f), 'Registro agregado.');
  });
};
