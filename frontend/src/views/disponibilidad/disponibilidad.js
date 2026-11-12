/**
 * @module disponibilidadView
 * @description HU13 — Disponibilidad de una referencia por talla en todas las sedes.
 * Busca por código, nombre o con el lector de código de barras y muestra una matriz talla × sede.
 * Desde una celda con existencias se puede reservar la unidad para el cliente (HU14).
 */

import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { abrirModal } from '../../components/modal.js';
import { getDisponibilidad, crearReserva } from '../../services/operacionesService.js';
import { showToast } from '../../utils/toast.js';
import { esc, numero, moneda } from '../../utils/format.js';

/** @type {{q: string, ubicaciones: object[], resultados: object[], ms: number}|null} */
let datos = null;

const celda = (t, u) => {
  const n = t.disponible[u.id] ?? 0;
  const r = t.reservado[u.id] ?? 0;
  const res = r ? `<span class="disp-res">${r} reservada${r > 1 ? 's' : ''}</span>` : '';
  return n > 0
    ? `<td><button type="button" class="disp-celda-btn" data-var="${t.varianteId}" data-ubi="${u.id}" title="Reservar en ${esc(u.nombre)}">${numero(n)}</button>${res}</td>`
    : `<td class="disp-cero">0${res}</td>`;
};

const renderResultados = () => {
  const el = document.getElementById('disp-resultados');
  if (!datos) { el.innerHTML = ''; return; }
  const { ubicaciones, resultados, ms } = datos;
  document.getElementById('disp-meta').textContent = `${resultados.length} referencia(s) · respuesta en ${ms} ms`;
  el.innerHTML = resultados.length ? resultados.map((g) => `
    <div class="card op-card disp-grupo">
      <div class="disp-grupo-head">
        <span class="disp-swatch" style="background:${esc(g.colorHex ?? '#ccc')};"></span>
        <strong>${esc(g.marca)} ${esc(g.modelo)}</strong> · ${esc(g.color)}
        ${g.codigoEstilo ? `<span class="product-sku">${esc(g.codigoEstilo)}</span>` : ''}
        <span class="op-item-meta" style="margin-left:auto;">${moneda(g.precio)}</span>
      </div>
      <div style="overflow-x:auto;"><table class="data-table disp-matriz">
        <thead><tr><th>Talla</th>${ubicaciones.map((u) => `<th>${esc(u.nombre)}</th>`).join('')}<th>Total</th><th></th></tr></thead>
        <tbody>${g.tallas.map((t) => `
          <tr class="${t.exacta ? 'disp-exacta' : ''}">
            <td><strong>EU ${t.eu}</strong> <span class="op-item-meta">US ${t.us}</span></td>
            ${ubicaciones.map((u) => celda(t, u)).join('')}
            <td style="font-weight:700;">${numero(t.total)}</td>
            <td><a href="#/kardex?sku=${encodeURIComponent(t.sku)}" class="op-item-meta" title="Ver kardex de ${esc(t.sku)}">Kardex</a></td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`).join('')
    : '<div class="card op-card"><div class="empty-state" style="padding:32px;"><div class="empty-state-title">Sin resultados</div><p class="empty-state-desc">Prueba con otro código o nombre.</p></div></div>';
};

const buscar = async () => {
  const input = document.getElementById('disp-q');
  const q = input.value.trim();
  if (q.length < 2) return showToast('Escribe al menos 2 caracteres o escanea un código.', 'error');
  document.getElementById('disp-meta').textContent = 'Buscando…';
  try {
    datos = await getDisponibilidad(q);
    renderResultados();
    input.select(); // listo para el siguiente escaneo
  } catch (err) {
    document.getElementById('disp-meta').textContent = '';
    showToast(err.message ?? 'Error al consultar la disponibilidad.', 'error');
  }
};

/** Modal de reserva (HU14) para la variante y sede de la celda. */
const reservar = (varianteId, ubicacionId) => {
  const t = datos.resultados.flatMap((g) => g.tallas.map((x) => ({ ...x, g }))).find((x) => x.varianteId === varianteId);
  const u = datos.ubicaciones.find((x) => x.id === ubicacionId);
  const max = t.disponible[ubicacionId] ?? 0;
  const { overlay, close } = abrirModal('Reservar para un cliente', `
    <form class="op-form" id="res-form" novalidate>
      <p class="op-item-meta">${esc(t.g.marca)} ${esc(t.g.modelo)} · ${esc(t.g.color)} · EU ${t.eu} <span class="product-sku">${esc(t.sku)}</span><br>
        en <strong>${esc(u.nombre)}</strong> (${max} disponible${max > 1 ? 's' : ''})</p>
      <div class="form-group"><label class="form-label" for="res-nombre">Cliente *</label><input id="res-nombre" class="form-input" maxlength="100" /></div>
      <div class="op-row">
        <div class="form-group"><label class="form-label" for="res-tel">Teléfono</label><input id="res-tel" class="form-input" maxlength="30" /></div>
        <div class="form-group"><label class="form-label" for="res-cant">Pares</label><input id="res-cant" type="number" min="1" max="${max}" value="1" class="form-input" /></div>
        <div class="form-group"><label class="form-label" for="res-horas">Vigencia (horas)</label><input id="res-horas" type="number" min="1" max="168" value="48" class="form-input" /></div>
      </div>
      <button type="submit" class="btn btn-primary" style="justify-content:center;">Reservar</button>
    </form>`);
  overlay.querySelector('#res-nombre').focus();
  overlay.querySelector('#res-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (id) => overlay.querySelector(id).value;
    if (!val('#res-nombre').trim()) return showToast('El nombre del cliente es requerido.', 'error');
    try {
      const r = await crearReserva({
        varianteId, ubicacionId, clienteNombre: val('#res-nombre'), clienteTelefono: val('#res-tel'),
        cantidad: parseInt(val('#res-cant'), 10), horas: parseInt(val('#res-horas'), 10),
      });
      showToast(`Reserva ${r.codigo} creada. Vence ${new Date(r.venceEn).toLocaleString('es-CO')}.`, 'success');
      close();
      datos = await getDisponibilidad(datos.q);
      renderResultados();
    } catch (err) {
      showToast(err.message ?? 'Error al reservar.', 'error');
    }
  });
};

export const initDisponibilidad = async () => {
  datos = null;
  renderView(`
    <div class="app-shell">
      ${buildSidebar('disponibilidad')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header"><div>
          <h1 class="page-title">Disponibilidad</h1>
          <p class="page-subtitle">¿Hay esa talla en alguna sede? Busca por código, nombre o con el lector de código de barras.</p>
        </div></header>
        <div class="card op-card" style="margin-bottom:24px;">
          <div class="op-row">
            <div class="form-group" style="flex:1;">
              <label class="form-label" for="disp-q">Referencia</label>
              <input id="disp-q" class="form-input" placeholder="SKU, código de barras, código de estilo, modelo o marca…" autocomplete="off" autofocus />
            </div>
            <button type="button" id="disp-buscar" class="btn btn-primary">Buscar</button>
          </div>
          <div id="disp-meta" class="op-hint" style="margin-top:8px;"></div>
          <p class="op-hint">Toca un número para reservar esa unidad para un cliente.</p>
        </div>
        <div id="disp-resultados"></div>
      </div></main>
    </div>`);
  attachSidebarLogout();

  const input = document.getElementById('disp-q');
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });
  document.getElementById('disp-buscar').addEventListener('click', buscar);
  document.getElementById('disp-resultados').addEventListener('click', (e) => {
    const b = e.target.closest('[data-var]');
    if (b) reservar(Number(b.dataset.var), Number(b.dataset.ubi));
  });
};
