/**
 * @module dashboardView
 * @description Tablero principal: pares en bodega y locales, alertas de bajo stock
 * de la bodega central y movimientos recientes.
 */

import './dashboard.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getDashboardMetrics, getMovimientos } from '../../services/movimientosService.js';
import { showToast } from '../../utils/toast.js';
import { esc, fechaHora, moneda, numero, TIPOS_MOV, rutaMovimiento } from '../../utils/format.js';

export { buildSidebar };

const buildMetricCards = (m) => {
  const bodega = m.porUbicacion?.find((u) => u.tipo === 'BODEGA');
  const locales = (m.porUbicacion ?? []).filter((u) => u.tipo === 'LOCAL');
  const paresLocales = locales.reduce((a, u) => a + u.pares, 0);
  return `
  <div class="metrics-grid">
    <div class="card metric-card indigo">
      <div class="metric-header"><span class="metric-label">Pares en bodega</span></div>
      <div class="metric-value">${numero(bodega?.pares)}</div>
      <div class="metric-trend"><span>${m.totalModelos ?? 0} modelos · ${m.totalVariantes ?? 0} variantes</span></div>
    </div>
    <div class="card metric-card sky">
      <div class="metric-header"><span class="metric-label">Pares en locales</span></div>
      <div class="metric-value">${numero(paresLocales)}</div>
      <div class="metric-trend"><span>${locales.map((u) => `${esc(u.nombre)}: ${numero(u.pares)}`).join(' · ')}</span></div>
    </div>
    <div class="card metric-card amber">
      <div class="metric-header"><span class="metric-label">Bajo mínimo (bodega)</span></div>
      <div class="metric-value">${m.bajoStock?.length ?? 0}</div>
      <div class="metric-trend"><span class="trend-down">Variantes por reponer</span></div>
    </div>
    <div class="card metric-card green">
      <div class="metric-header"><span class="metric-label">Valor del inventario</span></div>
      <div class="metric-value" style="font-size:var(--fs-h2);">${moneda(m.valorInventario)}</div>
      <div class="metric-trend"><span>${m.movimientosHoy ?? 0} movimientos hoy · ${m.ventasHoy ?? 0} ventas</span></div>
    </div>
  </div>
  ${pendientes(m)}`;
};

/** Avisos operativos: traslados por recibir, novedades, OC abiertas y reservas activas. */
const pendientes = (m) => {
  const avisos = [
    [m.trasladosEnTransito, 'traslado(s) en tránsito por recibir', '#/traslados'],
    [m.novedadesPendientes, 'novedad(es) de traslado por revisar', '#/traslados'],
    [m.ordenesAbiertas, 'orden(es) de compra por recibir', '#/compras'],
    [m.reservasActivas, 'reserva(s) activa(s)', '#/tienda'],
  ].filter(([n]) => n > 0);
  if (!avisos.length) return '';
  return `<div class="card" style="padding:16px 20px;margin-top:20px;display:flex;gap:20px;flex-wrap:wrap;font-size:var(--fs-small);">
    ${avisos.map(([n, txt, href]) => `<a href="${href}" style="color:var(--clr-text-primary);"><strong>${numero(n)}</strong> ${txt} →</a>`).join('')}
  </div>`;
};

const buildMovimientoItem = (mov) => {
  const t = TIPOS_MOV[mov.tipo] ?? { label: mov.tipo, signo: '·', clase: 'ajuste' };
  const ruta = rutaMovimiento(mov);
  return `
    <div class="movimiento-item">
      <div class="movimiento-icon ${t.clase}">${t.signo}</div>
      <div class="movimiento-info">
        <div class="movimiento-nombre">${t.label} · ${esc(ruta)}</div>
        <div class="movimiento-fecha">${fechaHora(mov.fecha)} · ${(mov.lineas ?? []).length} línea(s)</div>
      </div>
      <span class="movimiento-cantidad ${t.clase}">${numero(mov.pares)}</span>
    </div>`;
};

const buildAlertItem = (v) => `
  <div class="alert-item">
    <div style="display:flex;align-items:center;min-width:0;">
      <div class="alert-dot"></div>
      <span class="alert-nombre" title="${esc(v.sku)}">${esc(v.marca)} ${esc(v.modelo)} · ${esc(v.color)} · EU ${v.eu}</span>
    </div>
    <span class="alert-stock">${v.stock === 0 ? 'Agotado' : `${v.stock} par(es)`}</span>
  </div>`;

const buildDashboardHTML = (metrics, movimientos) => `
<div class="app-shell">
  ${buildSidebar('dashboard')}
  <main class="main-content">
    <div class="page-wrapper">
      <header class="page-header">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">Resumen de la bodega central y los locales.</p>
        </div>
        <a href="#/movimientos" class="btn btn-primary">+ Registrar movimiento</a>
      </header>

      ${buildMetricCards(metrics)}

      <div class="dashboard-grid">
        <div class="card" style="padding:24px;">
          <h2 class="section-title">Últimos movimientos</h2>
          ${movimientos.length
            ? movimientos.slice(0, 8).map(buildMovimientoItem).join('')
            : '<p style="color:var(--clr-text-muted);font-size:var(--fs-small);padding:16px 0;">Sin movimientos registrados.</p>'}
          <a href="#/movimientos" style="display:block;text-align:center;margin-top:16px;font-size:var(--fs-small);color:var(--clr-accent);">Ver todos →</a>
        </div>

        <div style="display:flex;flex-direction:column;gap:24px;">
          <div class="card" style="padding:24px;">
            <h2 class="section-title">Reponer en bodega</h2>
            ${metrics.bajoStock?.length
              ? metrics.bajoStock.slice(0, 7).map(buildAlertItem).join('')
              : '<p style="color:var(--clr-text-muted);font-size:var(--fs-small);">Sin alertas activas.</p>'}
            ${metrics.bajoStock?.length > 7 ? `<p style="font-size:var(--fs-small);color:var(--clr-text-muted);padding-top:8px;">y ${metrics.bajoStock.length - 7} más…</p>` : ''}
          </div>

          <div class="card" style="padding:24px;">
            <h2 class="section-title">Acciones rápidas</h2>
            <div class="quick-actions">
              <a href="#/movimientos" class="quick-action-btn"><span></span> Entrada</a>
              <a href="#/movimientos" class="quick-action-btn"><span></span> Despachar a local</a>
              <a href="#/inventario" class="quick-action-btn"><span></span> Ver inventario</a>
              <a href="#/reportes" class="quick-action-btn"><span></span> Reportes</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
</div>`;

export const initDashboard = async () => {
  renderView(`
    <div class="app-shell">
      ${buildSidebar('dashboard')}
      <main class="main-content"><div class="page-wrapper">
        <div class="loader-container"><div class="spinner"></div> Cargando dashboard…</div>
      </div></main>
    </div>`);

  const [metrics, movimientos] = await Promise.allSettled([getDashboardMetrics(), getMovimientos(8)]);
  if (metrics.status === 'rejected') showToast('Error al cargar el dashboard.', 'error');

  renderView(buildDashboardHTML(
    metrics.status === 'fulfilled' ? metrics.value : {},
    movimientos.status === 'fulfilled' ? movimientos.value : [],
  ));
  attachSidebarLogout();
};
