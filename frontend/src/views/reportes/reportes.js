/**
 * @module reportesView
 * @description Reportes: pares por marca y ubicación, tallas más agotadas en bodega,
 * devoluciones por motivo y estado de stock por modelo.
 */

import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getMovimientos } from '../../services/movimientosService.js';
import { getInventario, getModelos, getCatalogo } from '../../services/catalogoService.js';
import { showToast } from '../../utils/toast.js';
import { esc, moneda, numero, MOTIVOS } from '../../utils/format.js';

/** Barra horizontal simple: [{ label, valor }] */
const barras = (items, color = 'var(--clr-accent)') => {
  const max = Math.max(1, ...items.map((i) => i.valor));
  return items.length ? items.map((i) => `
    <div style="display:grid;grid-template-columns:130px 1fr 60px;gap:12px;align-items:center;padding:6px 0;font-size:0.82rem;">
      <span style="color:var(--clr-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(i.label)}</span>
      <div style="background:rgba(255,255,255,0.05);border-radius:4px;height:10px;">
        <div style="width:${(i.valor / max) * 100}%;height:100%;background:${color};border-radius:4px;"></div></div>
      <strong style="text-align:right;">${numero(i.valor)}</strong>
    </div>`).join('') : '<p style="color:var(--clr-text-muted);font-size:0.82rem;">Sin datos.</p>';
};

const suma = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const agrupar = (arr, clave, valor) => {
  const m = new Map();
  for (const x of arr) m.set(clave(x), (m.get(clave(x)) ?? 0) + valor(x));
  return [...m].map(([label, v]) => ({ label, valor: v }));
};

export const initReportes = async () => {
  const shell = (contenido) => `
    <div class="app-shell">
      ${buildSidebar('reportes')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header"><div>
          <h1 class="page-title">Reportes</h1>
          <p class="page-subtitle">Análisis del inventario y la operación.</p>
        </div></header>
        ${contenido}
      </div></main>
    </div>`;

  renderView(shell('<div class="loader-container"><div class="spinner"></div> Generando reporte…</div>'));

  try {
    const [variantes, modelos, movimientos, cat] = await Promise.all([getInventario(), getModelos(), getMovimientos(500), getCatalogo()]);
    const bodega = cat.ubicaciones.find((u) => u.tipo === 'BODEGA');

    const totalPares = suma(variantes, (v) => v.total);
    const valor = suma(variantes, (v) => v.total * v.precio);
    const agotadasBodega = variantes.filter((v) => (v.stock[bodega.id] ?? 0) === 0).length;
    const devoluciones = movimientos.filter((m) => m.tipo === 'DEVOLUCION');

    const porMarca = agrupar(variantes, (v) => v.marca, (v) => v.total).sort((a, b) => b.valor - a.valor);
    const porUbicacion = cat.ubicaciones.map((u) => ({ label: u.nombre, valor: suma(variantes, (v) => v.stock[u.id] ?? 0) }));
    const tallasAgotadas = agrupar(variantes.filter((v) => (v.stock[bodega.id] ?? 0) === 0), (v) => `EU ${v.eu}`, () => 1)
      .sort((a, b) => b.valor - a.valor).slice(0, 8);
    const devPorMotivo = agrupar(devoluciones, (m) => MOTIVOS[m.motivo] ?? 'Otro', (m) => m.pares);

    const filasModelo = modelos.map((m) => {
      const vs = variantes.filter((v) => v.modeloId === m.id);
      const bajo = vs.filter((v) => (v.stock[bodega.id] ?? 0) <= v.stockMinimo).length;
      return `<tr>
        <td style="font-weight:500;color:var(--clr-text-primary);">${esc(m.marca)} ${esc(m.nombre)}</td>
        <td>${esc(m.categoria)}</td>
        <td>${vs.length}</td>
        <td style="font-weight:700;">${numero(suma(vs, (v) => v.stock[bodega.id] ?? 0))}</td>
        <td>${numero(suma(vs, (v) => v.total) - suma(vs, (v) => v.stock[bodega.id] ?? 0))}</td>
        <td>${bajo ? `<span class="badge badge-warning">${bajo} por reponer</span>` : '<span class="badge badge-success">Normal</span>'}</td>
      </tr>`;
    }).join('');

    renderView(shell(`
      <div class="metrics-grid" style="margin-bottom:28px;">
        <div class="card metric-card indigo"><div class="metric-header"><span class="metric-label">Total de pares</span><div class="metric-icon indigo">👟</div></div>
          <div class="metric-value">${numero(totalPares)}</div></div>
        <div class="card metric-card green"><div class="metric-header"><span class="metric-label">Valor inventario</span><div class="metric-icon green">💰</div></div>
          <div class="metric-value" style="font-size:1.5rem;">${moneda(valor)}</div></div>
        <div class="card metric-card amber"><div class="metric-header"><span class="metric-label">Agotadas en bodega</span><div class="metric-icon amber">⚠️</div></div>
          <div class="metric-value">${agotadasBodega}</div></div>
        <div class="card metric-card sky"><div class="metric-header"><span class="metric-label">Devoluciones</span><div class="metric-icon sky">↩️</div></div>
          <div class="metric-value">${numero(suma(devoluciones, (m) => m.pares))}</div>
          <div class="metric-trend"><span>pares (últimos 500 mov.)</span></div></div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;margin-bottom:28px;">
        <div class="card" style="padding:24px;"><h2 class="section-title">Pares por marca</h2>${barras(porMarca)}</div>
        <div class="card" style="padding:24px;"><h2 class="section-title">Pares por ubicación</h2>${barras(porUbicacion, 'var(--clr-info)')}</div>
        <div class="card" style="padding:24px;"><h2 class="section-title">Tallas más agotadas en bodega</h2>${barras(tallasAgotadas, 'var(--clr-warning)')}
          <p style="font-size:0.72rem;color:var(--clr-text-muted);padding-top:8px;">Variantes con 0 pares, agrupadas por talla.</p></div>
        <div class="card" style="padding:24px;"><h2 class="section-title">Devoluciones por motivo</h2>${barras(devPorMotivo, 'var(--clr-danger)')}</div>
      </div>

      <div class="card" style="overflow:hidden;">
        <div style="padding:20px 24px;border-bottom:1px solid var(--clr-border);"><h2 style="font-size:1rem;font-weight:700;">Estado por modelo</h2></div>
        <div style="overflow-x:auto;"><table class="data-table">
          <thead><tr><th>Modelo</th><th>Categoría</th><th>Variantes</th><th>Pares en bodega</th><th>Pares en locales</th><th>Estado</th></tr></thead>
          <tbody>${filasModelo || '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--clr-text-muted);">Sin datos</td></tr>'}</tbody>
        </table></div>
      </div>`));
  } catch (err) {
    showToast(err.message ?? 'Error al generar el reporte.', 'error');
  }
  attachSidebarLogout();
};
