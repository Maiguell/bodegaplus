/**
 * @module alertasView
 * @description HU15 — Alertas de stock mínimo por talla y sede, y sugeridos de reposición.
 * Se refresca sola cada 30 s. El jefe de bodega puede ajustar el mínimo de una talla en una sede
 * y generar con un clic el traslado de reposición desde la bodega central.
 */

import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getUser, puede, restringidoASede } from '../../services/authService.js';
import { getCatalogo } from '../../services/catalogoService.js';
import { getAlertas, fijarMinimo, enviarTraslado } from '../../services/operacionesService.js';
import { showToast } from '../../utils/toast.js';
import { esc, numero, fechaHora, descargarCSV } from '../../utils/format.js';

let ubicaciones = [];
let alertas = [];
let sede = '';
let estado = 'ACTIVA';
let reloj = null;

/** Permiso del rol (HU19); el backend valida de nuevo. */
const esAdmin = () => puede('alertas.minimos');
const bodega = () => ubicaciones.find((u) => u.tipo === 'BODEGA');

const render = () => {
  const el = document.getElementById('al-contenido');
  if (!el) return;
  document.getElementById('al-actualizado').textContent = `Actualizado ${new Date().toLocaleTimeString('es-CO')}`;
  if (!alertas.length) {
    el.innerHTML = `<div class="card op-card"><div class="empty-state" style="padding:32px;"><div class="empty-state-title">${estado === 'ACTIVA' ? '✓ Ninguna talla por debajo del mínimo' : 'Sin alertas'}</div></div></div>`;
    return;
  }
  const porSede = new Map();
  for (const a of alertas) {
    if (!porSede.has(a.ubicacionId)) porSede.set(a.ubicacionId, { nombre: a.ubicacion, tipo: a.ubicacionTipo, filas: [] });
    porSede.get(a.ubicacionId).filas.push(a);
  }
  el.innerHTML = [...porSede].map(([id, g]) => {
    const reponibles = g.filas.filter((a) => a.estado === 'ACTIVA' && a.enBodega > 0 && a.sugerido > 0);
    return `
    <div class="card op-card">
      <div class="kardex-head">
        <div><h2 class="section-title" style="margin:0;">${esc(g.nombre)}</h2>
          <div class="op-item-meta">${g.filas.length} talla(s) ${estado === 'ACTIVA' ? 'por debajo del mínimo' : ''}</div></div>
        ${g.tipo === 'LOCAL' && reponibles.length && estado === 'ACTIVA'
          ? `<button type="button" class="btn btn-sm btn-primary" data-reponer="${id}">Reponer desde ${esc(bodega()?.nombre ?? 'Bodega')}</button>` : ''}
      </div>
      <div style="overflow-x:auto;"><table class="data-table">
        <thead><tr><th>Zapatilla</th><th>Existencia</th><th>Mínimo</th><th>Sugerido</th>${g.tipo === 'LOCAL' ? '<th>En bodega</th>' : ''}<th>Desde</th></tr></thead>
        <tbody>${g.filas.map((a) => `
          <tr>
            <td>${esc(a.marca)} ${esc(a.modelo)} · ${esc(a.color)} · <strong>EU ${a.eu}</strong><br><span class="product-sku">${esc(a.sku)}</span></td>
            <td class="${a.stock === 0 ? 'kardex-neg' : ''}" style="font-weight:700;">${numero(a.stock)}</td>
            <td>${esAdmin() && (!restringidoASede() || a.ubicacionId === getUser().sedeId)
              ? `<input type="number" min="0" class="form-input op-input-sm" value="${a.minimo}" data-min-var="${a.varianteId}" data-min-ubi="${a.ubicacionId}" title="${a.minimoPropio ? 'Mínimo propio de esta sede' : 'Mínimo general de la variante'}" />`
              : a.minimo}</td>
            <td>${a.estado === 'ACTIVA' ? `<strong>${numero(a.sugerido)}</strong>` : '—'}</td>
            ${g.tipo === 'LOCAL' ? `<td>${numero(a.enBodega)}</td>` : ''}
            <td class="op-item-meta">${fechaHora(a.creadaEn)}${a.resueltaEn ? `<br>resuelta ${fechaHora(a.resueltaEn)}` : ''}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }).join('');
};

const cargar = async () => {
  alertas = await getAlertas({ estado, ubicacionId: sede });
  render();
};

/** Arma un traslado Bodega → sede con lo sugerido (limitado a lo que hay en bodega). */
const reponer = async (ubicacionId) => {
  const lineas = alertas
    .filter((a) => a.ubicacionId === ubicacionId && a.estado === 'ACTIVA' && a.enBodega > 0 && a.sugerido > 0)
    .map((a) => ({ varianteId: a.varianteId, cantidad: Math.min(a.sugerido, a.enBodega), sku: a.sku }));
  const total = lineas.reduce((s, l) => s + l.cantidad, 0);
  const destino = ubicaciones.find((u) => u.id === ubicacionId);
  if (!confirm(`Enviar ${total} par(es) en ${lineas.length} talla(s) de ${bodega().nombre} a ${destino.nombre}?\nQuedarán en tránsito hasta que la sede confirme.`)) return;
  try {
    const t = await enviarTraslado({
      origenId: bodega().id, destinoId: ubicacionId, observacion: 'Reposición sugerida por alertas de stock mínimo',
      lineas: lineas.map(({ varianteId, cantidad }) => ({ varianteId, cantidad })),
    });
    showToast(`Traslado ${t.codigo} enviado a ${t.destino}: ${numero(t.enviados)} pares en tránsito.`, 'success');
    await cargar();
  } catch (err) { showToast(err.message, 'error'); }
};

export const initAlertas = async () => {
  clearInterval(reloj);
  renderView(`<div class="app-shell">${buildSidebar('alertas')}<main class="main-content"><div class="page-wrapper">
    <div class="loader-container"><div class="spinner"></div> Cargando…</div></div></main></div>`);
  try { ubicaciones = (await getCatalogo()).ubicaciones; } catch (err) { showToast(err.message, 'error'); }
  sede = ''; estado = 'ACTIVA';

  renderView(`
    <div class="app-shell">
      ${buildSidebar('alertas')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header">
          <div><h1 class="page-title">Alertas de stock</h1>
            <p class="page-subtitle">Tallas por debajo de su mínimo en cada sede y lo sugerido para reponer (hasta 2 × mínimo).</p></div>
          <button type="button" id="al-csv" class="btn btn-secondary btn-sm">Exportar sugeridos</button>
        </header>
        <div class="card op-card" style="margin-bottom:24px;">
          <div class="op-row">
            <div class="form-group"><label class="form-label" for="al-sede">Sede</label>
              <select id="al-sede" class="form-select"><option value="">Todas</option>${ubicaciones.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}</select></div>
            <div class="form-group"><label class="form-label" for="al-estado">Estado</label>
              <select id="al-estado" class="form-select"><option value="ACTIVA">Activas</option><option value="RESUELTA">Resueltas</option></select></div>
          </div>
          <div id="al-actualizado" class="op-hint" style="margin-top:8px;"></div>
        </div>
        <div id="al-contenido"></div>
      </div></main>
    </div>`);
  attachSidebarLogout();
  try { await cargar(); } catch (err) { showToast(err.message, 'error'); }

  document.getElementById('al-sede').addEventListener('change', (e) => { sede = e.target.value; cargar(); });
  document.getElementById('al-estado').addEventListener('change', (e) => { estado = e.target.value; cargar(); });
  const cont = document.getElementById('al-contenido');
  cont.addEventListener('click', (e) => { const b = e.target.closest('[data-reponer]'); if (b) reponer(Number(b.dataset.reponer)); });
  cont.addEventListener('change', async (e) => {
    const i = e.target.closest('[data-min-var]');
    if (!i) return;
    const minimo = parseInt(i.value, 10);
    if (!Number.isInteger(minimo) || minimo < 0) return showToast('Mínimo inválido.', 'error');
    try {
      await fijarMinimo(Number(i.dataset.minVar), Number(i.dataset.minUbi), minimo);
      showToast(`Mínimo actualizado a ${minimo} para esta talla en esta sede.`, 'success');
      await cargar();
    } catch (err) { showToast(err.message, 'error'); }
  });
  document.getElementById('al-csv').addEventListener('click', () => {
    descargarCSV(`sugeridos-reposicion-${new Date().toLocaleDateString('en-CA')}`,
      ['Sede', 'SKU', 'Marca', 'Modelo', 'Color', 'Talla EU', 'Existencia', 'Mínimo', 'Sugerido', 'En bodega'],
      alertas.filter((a) => a.estado === 'ACTIVA').map((a) => [a.ubicacion, a.sku, a.marca, a.modelo, a.color, a.eu, a.stock, a.minimo, a.sugerido, a.enBodega ?? '']));
  });
  // HT06: el panel muestra alertas nuevas en menos de 1 minuto
  reloj = setInterval(() => {
    if (!document.getElementById('al-contenido')) { clearInterval(reloj); return; }
    if (document.activeElement?.matches?.('[data-min-var]')) return; // no interrumpir una edición
    cargar().catch(() => {});
  }, 30_000);
};
