/**
 * @module inventarioView
 * @description Inventario por modelo: grilla color × talla con los pares disponibles,
 * filtrable por ubicación (bodega central, cada local o total).
 */

import './inventario.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getCatalogo, getModelos, getInventario } from '../../services/catalogoService.js';
import { showToast } from '../../utils/toast.js';
import { esc, numero, moneda } from '../../utils/format.js';

/** @type {Array<object>} */ let modelos = [];
/** @type {Array<object>} */ let ubicaciones = [];
/** @type {Array<object>} variantes del modelo seleccionado */ let variantes = [];
let modeloId = null;
let ubicacionSel = 'total'; // 'total' | id de ubicación

/** Pares de una variante en la ubicación seleccionada. */
const paresDe = (v) => (ubicacionSel === 'total' ? v.total : v.stock[ubicacionSel] ?? 0);

const claseCelda = (v) => {
  const n = paresDe(v);
  if (n === 0) return 'zero';
  // El mínimo aplica por ubicación; en el total se compara contra el mismo mínimo
  return n <= v.stockMinimo ? 'low' : '';
};

const renderGrid = () => {
  const cont = document.getElementById('grid-container');
  if (!cont) return;
  if (!variantes.length) {
    cont.innerHTML = `<div class="empty-state" style="padding:48px;"><div class="empty-state-icon">👟</div>
      <div class="empty-state-title">Este modelo aún no tiene variantes</div>
      <div class="empty-state-desc">Créalas desde el Catálogo (＋ Variantes).</div></div>`;
    return;
  }

  // Columnas = tallas ordenadas por EU; filas = colores
  const tallas = [...new Map(variantes.map((v) => [v.eu, v])).values()].sort((a, b) => a.eu - b.eu);
  const colores = [...new Map(variantes.map((v) => [v.color, v])).values()];
  const porClave = new Map(variantes.map((v) => [`${v.color}|${v.eu}`, v]));

  const totalPares = variantes.reduce((a, v) => a + paresDe(v), 0);
  const agotadas = variantes.filter((v) => paresDe(v) === 0).length;
  const valor = variantes.reduce((a, v) => a + paresDe(v) * v.precio, 0);

  cont.innerHTML = `
    <div class="inv-summary">
      <span><strong>${numero(totalPares)}</strong> pares</span>
      <span><strong>${variantes.length}</strong> variantes</span>
      <span><strong>${agotadas}</strong> agotadas</span>
      <span>Valor: <strong>${moneda(valor)}</strong></span>
    </div>
    <div class="grid-wrap">
      <table class="talla-grid">
        <thead><tr><th></th>${tallas.map((t) => `<th>EU ${t.eu}<small>US ${t.us}</small></th>`).join('')}</tr></thead>
        <tbody>
          ${colores.map((c) => `
            <tr>
              <td class="color-cell"><span class="color-dot" style="background:${esc(c.colorHex ?? '#888')}"></span>${esc(c.color)}</td>
              ${tallas.map((t) => {
                const v = porClave.get(`${c.color}|${t.eu}`);
                return v
                  ? `<td><div class="stock-cell ${claseCelda(v)}" title="${esc(v.sku)}">${paresDe(v)}</div></td>`
                  : '<td><div class="stock-cell empty">·</div></td>';
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="grid-legend">
      <span class="ok">Disponible</span><span class="low">En o bajo el mínimo</span><span class="zero">Agotado</span>
      <span style="margin-left:auto;">Pasa el cursor sobre una celda para ver el SKU</span>
    </div>`;
};

const renderTabs = () => {
  const el = document.getElementById('ubi-tabs');
  if (!el) return;
  const tabs = [{ id: 'total', nombre: 'Total' }, ...ubicaciones];
  el.innerHTML = tabs.map((u) =>
    `<button class="ubi-tab ${String(u.id) === String(ubicacionSel) ? 'active' : ''}" data-ubi="${u.id}">${esc(u.nombre)}</button>`).join('');
};

const cargarVariantes = async () => {
  const cont = document.getElementById('grid-container');
  cont.innerHTML = '<div class="loader-container"><div class="spinner"></div> Cargando…</div>';
  try {
    variantes = await getInventario(modeloId);
    renderGrid();
  } catch (err) {
    showToast(err.message ?? 'Error al cargar el inventario.', 'error');
  }
};

export const initInventario = async () => {
  renderView(`
    <div class="app-shell">
      ${buildSidebar('inventario')}
      <main class="main-content">
        <div class="page-wrapper">
          <header class="page-header">
            <div>
              <h1 class="page-title">Inventario</h1>
              <p class="page-subtitle">Pares disponibles por modelo, color y talla.</p>
            </div>
            <a href="#/movimientos" class="btn btn-primary">+ Registrar movimiento</a>
          </header>

          <div class="inv-toolbar">
            <div class="form-group">
              <label class="form-label" for="sel-modelo">Modelo</label>
              <select id="sel-modelo" class="form-select"></select>
            </div>
            <div class="form-group">
              <label class="form-label">Ubicación</label>
              <div class="ubi-tabs" id="ubi-tabs"></div>
            </div>
          </div>

          <div class="card" id="grid-container">
            <div class="loader-container"><div class="spinner"></div> Cargando…</div>
          </div>
        </div>
      </main>
    </div>`);
  attachSidebarLogout();

  try {
    const [m, cat] = await Promise.all([getModelos(), getCatalogo()]);
    modelos = m;
    ubicaciones = cat.ubicaciones;
  } catch (err) {
    return showToast(err.message ?? 'Error al cargar datos.', 'error');
  }

  if (!modelos.length) {
    document.getElementById('grid-container').innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">👟</div><div class="empty-state-title">Aún no hay modelos</div></div>';
    return;
  }

  // Permite llegar desde el Catálogo con #/inventario?modelo=ID
  const pedido = Number(new URLSearchParams((window.location.hash.split('?')[1]) ?? '').get('modelo'));
  modeloId = modelos.some((x) => x.id === pedido) ? pedido : modelos[0].id;
  ubicacionSel = 'total';

  const sel = document.getElementById('sel-modelo');
  sel.innerHTML = modelos.map((x) =>
    `<option value="${x.id}" ${x.id === modeloId ? 'selected' : ''}>${esc(x.marca)} ${esc(x.nombre)} (${esc(x.genero.toLowerCase())})</option>`).join('');
  sel.addEventListener('change', () => { modeloId = Number(sel.value); cargarVariantes(); });

  renderTabs();
  document.getElementById('ubi-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ubi]');
    if (!b) return;
    ubicacionSel = b.dataset.ubi;
    renderTabs();
    renderGrid();
  });

  await cargarVariantes();
};
