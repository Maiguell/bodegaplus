/**
 * @module kardexView
 * @description HU07 — Kardex de una variante: movimientos en orden cronológico con tipo, documento,
 * usuario, cantidad y saldo, filtrable por sede y rango de fechas, exportable a Excel (CSV).
 * Incluye la verificación kardex ↔ stock almacenado (HT04).
 */

import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getCatalogo, getInventario } from '../../services/catalogoService.js';
import { getKardex, verificarKardex } from '../../services/operacionesService.js';
import { showToast } from '../../utils/toast.js';
import { esc, numero, fechaHoraLarga, TIPOS_MOV, descargarCSV } from '../../utils/format.js';
import { buscarVariante, datalistVariantes, descVariante } from '../../utils/variantes.js';

let variantes = [];
let ubicaciones = [];
/** @type {{variante: object, movimientos: object[], stock: object[]}|null} */
let resultado = null;
let filtros = {};

const signo = (n) => (n > 0 ? `<span class="kardex-pos">+${numero(n)}</span>` : `<span class="kardex-neg">${numero(n)}</span>`);

const renderResultado = () => {
  const el = document.getElementById('kardex-resultado');
  if (!resultado) {
    el.innerHTML = '<div class="empty-state" style="padding:32px;"><div class="empty-state-title">Elige una variante</div><p class="empty-state-desc">Escribe o escanea el SKU y pulsa Consultar.</p></div>';
    return;
  }
  const { variante, movimientos, stock } = resultado;
  const sede = ubicaciones.find((u) => String(u.id) === String(filtros.ubicacionId));
  const saldoActual = sede
    ? (stock.find((s) => s.ubicacionId === sede.id)?.cantidad ?? 0)
    : stock.reduce((a, s) => a + s.cantidad, 0);

  el.innerHTML = `
    <div class="kardex-head">
      <div>
        <div class="op-item-title">${esc(variante.marca)} ${esc(variante.modelo)} · ${esc(variante.color)} · EU ${variante.eu}
          <span class="product-sku">${esc(variante.sku)}</span></div>
        <div class="op-item-meta">${sede ? `Sede: ${esc(sede.nombre)}` : 'Todas las sedes'} · ${movimientos.length} movimiento(s) · Saldo actual: <strong>${numero(saldoActual)}</strong> pares</div>
      </div>
      <button type="button" id="kardex-export" class="btn btn-secondary btn-sm" ${movimientos.length ? '' : 'disabled'}>Exportar a Excel</button>
    </div>
    <div class="table-container" style="overflow-x:auto;">
      <table class="data-table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Documento</th><th>Sede</th><th>Usuario</th><th style="text-align:right;">Cantidad</th><th style="text-align:right;">Saldo</th></tr></thead>
        <tbody>
          ${movimientos.map((m) => `
            <tr>
              <td style="white-space:nowrap;">${fechaHoraLarga(m.fecha)}</td>
              <td>${esc(TIPOS_MOV[m.tipo]?.label ?? m.tipo)}</td>
              <td>${esc(m.documento)}</td>
              <td>${esc(m.ubicacion)}</td>
              <td>${esc(m.usuario ?? '—')}</td>
              <td style="text-align:right;">${signo(m.cantidad)}</td>
              <td style="text-align:right;font-weight:700;">${numero(m.saldo)}</td>
            </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--clr-text-muted);">Sin movimientos en el rango.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  document.getElementById('kardex-export')?.addEventListener('click', () => {
    descargarCSV(`kardex-${variante.sku}`, ['Fecha', 'Tipo', 'Documento', 'Sede', 'Usuario', 'Cantidad', 'Saldo', 'Observación'],
      movimientos.map((m) => [fechaHoraLarga(m.fecha), TIPOS_MOV[m.tipo]?.label ?? m.tipo, m.documento, m.ubicacion,
        m.usuario ?? '', m.cantidad, m.saldo, m.observacion ?? '']));
  });
};

const consultar = async () => {
  const v = buscarVariante(variantes, document.getElementById('kx-sku').value);
  if (!v) return showToast('SKU no encontrado. Elige uno de la lista.', 'error');
  filtros = {
    varianteId: v.id,
    ubicacionId: document.getElementById('kx-sede').value,
    desde: document.getElementById('kx-desde').value,
    hasta: document.getElementById('kx-hasta').value,
  };
  if (filtros.desde && filtros.hasta && filtros.desde > filtros.hasta) return showToast('La fecha inicial es posterior a la final.', 'error');
  const btn = document.getElementById('kx-consultar');
  btn.disabled = true;
  try {
    resultado = await getKardex(filtros);
    renderResultado();
  } catch (err) {
    showToast(err.message ?? 'Error al consultar el kardex.', 'error');
  } finally {
    btn.disabled = false;
  }
};

const verificar = async () => {
  const el = document.getElementById('kx-verificacion');
  el.innerHTML = '<span class="op-hint">Verificando…</span>';
  try {
    const r = await verificarKardex();
    el.innerHTML = r.ok
      ? `<div class="op-alert" style="border-color:var(--clr-success);">✓ El saldo calculado desde el kardex coincide con el stock almacenado en los ${numero(r.revisados)} saldos revisados.</div>`
      : `<div class="op-alert danger">✕ ${r.diferencias.length} diferencia(s): ${r.diferencias.slice(0, 5).map((d) =>
        `${esc(d.sku)} en ${esc(d.ubicacion)} (stock ${d.almacenado}, kardex ${d.calculado})`).join('; ')}</div>`;
  } catch (err) {
    el.innerHTML = '';
    showToast(err.message ?? 'Error al verificar.', 'error');
  }
};

/** @param {{sku?: string}} [params] - Permite abrir el kardex de un SKU desde otra vista. */
export const initKardex = async (params = {}) => {
  renderView(`<div class="app-shell">${buildSidebar('kardex')}<main class="main-content"><div class="page-wrapper">
    <div class="loader-container"><div class="spinner"></div> Cargando…</div></div></main></div>`);
  try {
    const [cat, inv] = await Promise.all([getCatalogo(), getInventario()]);
    ubicaciones = cat.ubicaciones;
    variantes = inv;
  } catch (err) {
    showToast(err.message ?? 'Error al cargar datos.', 'error');
  }
  resultado = null;

  renderView(`
    <div class="app-shell">
      ${buildSidebar('kardex')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header"><div>
          <h1 class="page-title">Kardex</h1>
          <p class="page-subtitle">Cada entrada, salida, traslado y ajuste de una variante con su saldo resultante.</p>
        </div></header>

        <div class="card op-card">
          <div class="op-row">
            <div class="form-group" style="flex:2;min-width:220px;">
              <label class="form-label" for="kx-sku">SKU o código de barras *</label>
              <input id="kx-sku" class="form-input" list="kx-skus" placeholder="Escribe o escanea…" autocomplete="off" value="${esc(params.sku ?? '')}" />
              ${datalistVariantes('kx-skus', variantes)}
            </div>
            <div class="form-group">
              <label class="form-label" for="kx-sede">Sede</label>
              <select id="kx-sede" class="form-select"><option value="">Todas</option>
                ${ubicaciones.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}</select>
            </div>
            <div class="form-group"><label class="form-label" for="kx-desde">Desde</label><input id="kx-desde" type="date" class="form-input" /></div>
            <div class="form-group"><label class="form-label" for="kx-hasta">Hasta</label><input id="kx-hasta" type="date" class="form-input" /></div>
            <button type="button" id="kx-consultar" class="btn btn-primary">Consultar</button>
          </div>
          <div id="kx-desc" class="op-hint" style="margin-top:8px;"></div>
        </div>

        <div class="card op-card" id="kardex-resultado"></div>

        <div class="card op-card">
          <div class="kardex-head" style="margin-bottom:0;">
            <div><h2 class="section-title" style="margin:0;">Integridad del kardex</h2>
              <p class="op-item-meta">Compara el saldo calculado desde el kardex con el stock almacenado. El kardex no se puede editar ni eliminar.</p></div>
            <button type="button" id="kx-verificar" class="btn btn-secondary btn-sm">Verificar ahora</button>
          </div>
          <div id="kx-verificacion" style="margin-top:12px;"></div>
        </div>
      </div></main>
    </div>`);

  attachSidebarLogout();
  renderResultado();
  const sku = document.getElementById('kx-sku');
  const desc = () => { const v = buscarVariante(variantes, sku.value); document.getElementById('kx-desc').textContent = v ? descVariante(v) : ''; };
  sku.addEventListener('input', desc);
  sku.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); consultar(); } });
  document.getElementById('kx-consultar').addEventListener('click', consultar);
  document.getElementById('kx-verificar').addEventListener('click', verificar);
  if (params.sku) { desc(); consultar(); }
};
