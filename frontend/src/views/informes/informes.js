/**
 * @module informesView
 * @description Informes gerenciales (Sprint 6) y procesos programados:
 *   HU16 — Rotación por talla · HU17 — Inventario valorizado a costo (PDF y Excel)
 *   HU18 — Sin movimiento · HT06/HT08 — Registro de procesos y respaldos (admin).
 */

import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getUser, puede } from '../../services/authService.js';
import { getCatalogo } from '../../services/catalogoService.js';
import { getRotacion, getValorizado, getSinMovimiento, getProcesos, ejecutarProceso, fijarCostoModelo } from '../../services/operacionesService.js';
import { showToast } from '../../utils/toast.js';
import { esc, numero, moneda, fechaHora, fechaHoraLarga, badgeEstado, descargarCSV, hoyISO, haceDiasISO } from '../../utils/format.js';

let ubicaciones = [];
let tab = 'rotacion';
let datos = null;

/** Permiso del rol (HU19); el backend valida de nuevo. */
const esAdmin = () => puede('procesos');
const optsSede = () => `<option value="">Todas</option>${ubicaciones.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}`;
const val = (id) => document.getElementById(id)?.value;
const vacio = (txt) => `<div class="empty-state" style="padding:32px;"><div class="empty-state-title">${txt}</div></div>`;
const tabla = (cabecera, filas) => `<div style="overflow-x:auto;"><table class="data-table"><thead><tr>${cabecera.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table></div>`;
const nombreSede = (id) => ubicaciones.find((u) => String(u.id) === String(id))?.nombre ?? 'Todas las sedes';

// ── HU16: Rotación ──────────────────────────────────────────────────────────

const filtrosRotacion = () => `
  <div class="op-row">
    <div class="form-group"><label class="form-label" for="f-desde">Desde</label><input id="f-desde" type="date" class="form-input" value="${haceDiasISO(29)}" /></div>
    <div class="form-group"><label class="form-label" for="f-hasta">Hasta</label><input id="f-hasta" type="date" class="form-input" value="${hoyISO()}" /></div>
    <div class="form-group"><label class="form-label" for="f-sede">Sede</label><select id="f-sede" class="form-select">${optsSede()}</select></div>
    <button type="button" id="f-generar" class="btn btn-primary">Generar</button>
  </div>`;

const renderRotacion = () => {
  const d = datos;
  const max = Math.max(0.0001, ...d.filas.map((f) => f.rotacion ?? 0));
  return `
    <div class="kardex-head">
      <div class="op-item-meta">${d.desde} a ${d.hasta} (${d.dias} días) · ${esc(nombreSede(d.ubicacionId))} · <strong>${numero(d.totalVendidas)}</strong> pares vendidos</div>
      <button type="button" class="btn btn-secondary btn-sm no-print" data-export>Exportar a Excel</button>
    </div>
    <p class="op-hint">Rotación = unidades vendidas ÷ existencia promedio del periodo. Más alto = se vende más rápido respecto a lo que se tiene.</p>
    ${d.nota ? `<p class="op-hint">${esc(d.nota)}</p>` : ''}
    ${d.filas.length ? tabla(['Referencia', 'Talla', 'Vendidas', 'Existencia promedio', 'Existencia final', 'Rotación'], d.filas.map((f) => `
      <tr><td>${esc(f.marca)} ${esc(f.modelo)}<br><span class="op-item-meta">${esc(f.categoria)}</span></td>
        <td><strong>EU ${f.eu}</strong></td><td style="font-weight:700;">${numero(f.vendidas)}</td>
        <td>${numero(f.existenciaPromedio)}</td><td>${numero(f.existenciaFinal)}</td>
        <td style="min-width:140px;">${f.rotacion === null ? '—' : `<div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;background:var(--clr-sage);height:8px;"><div style="width:${(f.rotacion / max) * 100}%;height:100%;background:var(--clr-accent);"></div></div>
          <strong>${f.rotacion.toFixed(2)}</strong></div>`}</td></tr>`).join('')) : vacio('Sin ventas ni existencias en el periodo')}`;
};

const exportarRotacion = () => descargarCSV(`rotacion-${datos.desde}-a-${datos.hasta}`,
  ['Marca', 'Referencia', 'Categoría', 'Talla EU', 'Vendidas', 'Existencia promedio', 'Existencia final', 'Rotación'],
  datos.filas.map((f) => [f.marca, f.modelo, f.categoria, f.eu, f.vendidas, f.existenciaPromedio, f.existenciaFinal, f.rotacion ?? '']));

// ── HU17: Valorizado ────────────────────────────────────────────────────────

const filtrosValorizado = () => `
  <div class="op-row">
    <div class="form-group"><label class="form-label" for="f-corte">Fecha de corte</label><input id="f-corte" type="date" class="form-input" value="${hoyISO()}" /></div>
    <div class="form-group"><label class="form-label" for="f-sede">Sede</label><select id="f-sede" class="form-select">${optsSede()}</select></div>
    <button type="button" id="f-generar" class="btn btn-primary">Generar</button>
  </div>`;

const renderValorizado = () => {
  const d = datos;
  return `
    <div class="kardex-head">
      <div><h2 class="section-title" style="margin:0;">Inventario valorizado a costo</h2>
        <div class="op-item-meta">Corte: ${d.corte} · ${esc(nombreSede(val('f-sede')))} · generado ${fechaHoraLarga(new Date())}</div></div>
      <div class="op-item-actions no-print">
        <button type="button" class="btn btn-secondary btn-sm" data-export>Excel</button>
        <button type="button" class="btn btn-secondary btn-sm" data-pdf>PDF</button>
      </div>
    </div>
    ${d.advertencia ? `<div class="op-alert" style="margin-bottom:12px;">${esc(d.advertencia)}</div>` : ''}
    ${d.sinCosto.length ? `<div class="op-alert danger" style="margin-bottom:12px;">${d.sinCosto.length} referencia(s) sin costo registrado se valoran en $0:
      ${d.sinCosto.map((s) => `<span style="white-space:nowrap;">${esc(s.marca)} ${esc(s.modelo)}${puede('catalogo.editar') ? ` <button type="button" class="btn btn-sm btn-secondary no-print" data-costo="${s.modeloId}" data-nombre="${esc(s.marca)} ${esc(s.modelo)}">Fijar costo</button>` : ''}</span>`).join(' · ')}</div>` : ''}
    <div class="metrics-grid" style="margin-bottom:20px;">
      <div class="card metric-card indigo"><div class="metric-header"><span class="metric-label">Pares</span></div><div class="metric-value">${numero(d.totales.cantidad)}</div></div>
      <div class="card metric-card green"><div class="metric-header"><span class="metric-label">Valor a costo</span></div><div class="metric-value" style="font-size:var(--fs-h2);">${moneda(d.totales.valor)}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-bottom:20px;">
      <div><h3 class="section-title">Por sede</h3>${tabla(['Sede', 'Pares', 'Valor'], d.porSede.map((s) => `<tr><td>${esc(s.ubicacion)}</td><td>${numero(s.cantidad)}</td><td>${moneda(s.valor)}</td></tr>`).join(''))}</div>
      <div><h3 class="section-title">Por categoría</h3>${tabla(['Categoría', 'Pares', 'Valor'], d.porCategoria.map((s) => `<tr><td>${esc(s.categoria)}</td><td>${numero(s.cantidad)}</td><td>${moneda(s.valor)}</td></tr>`).join(''))}</div>
    </div>
    <h3 class="section-title">Por referencia</h3>
    ${tabla(['Sede', 'Categoría', 'Referencia', 'Pares', 'Valor'], d.porReferencia.map((r) => `
      <tr><td>${esc(r.ubicacion)}</td><td>${esc(r.categoria)}</td><td>${esc(r.marca)} ${esc(r.modelo)}</td><td>${numero(r.cantidad)}</td><td>${moneda(r.valor)}</td></tr>`).join(''))}`;
};

const exportarValorizado = () => descargarCSV(`inventario-valorizado-${datos.corte}`,
  ['Sede', 'Categoría', 'Marca', 'Referencia', 'Color', 'Talla EU', 'SKU', 'Pares', 'Costo unitario', 'Valor'],
  datos.filas.map((f) => [f.ubicacion, f.categoria, f.marca, f.modelo, f.color, f.eu, f.sku, f.cantidad, f.costo ?? '', f.valor]));

// ── HU18: Sin movimiento ────────────────────────────────────────────────────

const filtrosSinMovimiento = () => `
  <div class="op-row">
    <div class="form-group"><label class="form-label" for="f-dias">Días sin movimiento (mínimo)</label><input id="f-dias" type="number" min="0" class="form-input" value="90" /></div>
    <div class="form-group"><label class="form-label" for="f-sede">Sede</label><select id="f-sede" class="form-select">${optsSede()}</select></div>
    <button type="button" id="f-generar" class="btn btn-primary">Generar</button>
  </div>`;

const renderSinMovimiento = () => {
  const d = datos;
  return `
    <div class="kardex-head">
      <div class="op-item-meta">≥ ${d.dias} días sin ventas ni traslados · <strong>${numero(d.totales.variantes)}</strong> variantes · <strong>${numero(d.totales.pares)}</strong> pares ·
        valor inmovilizado <strong>${moneda(d.totales.valor)}</strong></div>
      <div class="op-item-actions no-print">
        ${esAdmin() ? '<button type="button" class="btn btn-secondary btn-sm" data-recalcular>Recalcular ahora</button>' : ''}
        <button type="button" class="btn btn-secondary btn-sm" data-export ${d.filas.length ? '' : 'disabled'}>Exportar a Excel</button>
      </div>
    </div>
    <p class="op-hint">Indicadores calculados por el proceso nocturno: ${d.calculadoEn ? fechaHoraLarga(d.calculadoEn) : 'aún no se han calculado'}.</p>
    ${d.filas.length ? tabla(['Zapatilla', 'Sede', 'Existencia', 'Último movimiento', 'Días', 'Valor inmovilizado'], d.filas.map((f) => `
      <tr><td>${esc(f.marca)} ${esc(f.modelo)} · ${esc(f.color)} · EU ${f.eu}<br><span class="product-sku">${esc(f.sku)}</span></td>
        <td>${esc(f.ubicacion)}</td><td>${numero(f.stock)}</td>
        <td>${f.ultimoMovimiento ? fechaHora(f.ultimoMovimiento) : '<span class="op-item-meta">Nunca</span>'}</td>
        <td style="font-weight:700;">${numero(f.diasSinMovimiento)}</td><td>${moneda(f.valorInmovilizado)}</td></tr>`).join(''))
      : vacio(`No hay mercancía con ${d.dias} días o más sin movimiento`)}`;
};

const exportarSinMovimiento = () => descargarCSV(`sin-movimiento-${datos.dias}-dias`,
  ['Sede', 'SKU', 'Marca', 'Referencia', 'Color', 'Talla EU', 'Existencia', 'Último movimiento', 'Días sin movimiento', 'Valor inmovilizado'],
  datos.filas.map((f) => [f.ubicacion, f.sku, f.marca, f.modelo, f.color, f.eu, f.stock, f.ultimoMovimiento ? fechaHoraLarga(f.ultimoMovimiento) : '', f.diasSinMovimiento, f.valorInmovilizado]));

// ── HT06 / HT08: Procesos ───────────────────────────────────────────────────

const NOMBRES_PROCESO = { INDICADORES: 'Indicadores (nocturno)', ALERTAS: 'Barrido de alertas', RESPALDO: 'Copia de seguridad' };

const renderProcesos = () => {
  const d = datos;
  return `
    <div class="op-item-actions" style="justify-content:flex-start;margin-bottom:16px;">
      ${d.procesos.map((p) => `<button type="button" class="btn btn-sm btn-secondary" data-ejecutar="${p}">Ejecutar: ${NOMBRES_PROCESO[p] ?? p}</button>`).join('')}
    </div>
    <h3 class="section-title">Últimas ejecuciones</h3>
    ${d.ejecuciones.length ? tabla(['Proceso', 'Origen', 'Inicio', 'Duración', 'Estado', 'Filas', 'Mensaje'], d.ejecuciones.map((e) => `
      <tr><td>${esc(NOMBRES_PROCESO[e.proceso] ?? e.proceso)}</td><td>${e.origen === 'MANUAL' ? 'Manual' : 'Programado'}</td>
        <td style="white-space:nowrap;">${fechaHoraLarga(e.inicio)}</td>
        <td>${e.fin ? `${Math.max(0, Math.round((new Date(e.fin) - new Date(e.inicio)) / 1000))} s` : '—'}</td>
        <td>${badgeEstado(e.estado)}</td><td>${e.filas ?? '—'}</td><td class="op-item-meta">${esc(e.mensaje ?? '')}</td></tr>`).join('')) : vacio('Sin ejecuciones')}
    <h3 class="section-title" style="margin-top:20px;">Copias de seguridad (retención 30 días)</h3>
    ${d.respaldos.length ? tabla(['Archivo', 'Fecha', 'Tamaño'], d.respaldos.map((r) => `
      <tr><td><span class="product-sku">${esc(r.archivo)}</span></td><td>${fechaHoraLarga(r.fecha)}</td><td>${numero(Math.round(r.bytes / 1024))} KB</td></tr>`).join(''))
      : '<p class="op-hint">Aún no hay respaldos en este servidor. Se programan con BACKUP_ENABLED=true (ver DEPLOY.md).</p>'}`;
};

// ── Controlador de pestañas ─────────────────────────────────────────────────

const TABS = {
  rotacion:      { titulo: 'Rotación por talla',  filtros: filtrosRotacion,      cargar: () => getRotacion({ desde: val('f-desde'), hasta: val('f-hasta'), ubicacionId: val('f-sede') }), render: renderRotacion, exportar: exportarRotacion },
  valorizado:    { titulo: 'Inventario valorizado', filtros: filtrosValorizado,  cargar: () => getValorizado({ corte: val('f-corte'), ubicacionId: val('f-sede') }), render: renderValorizado, exportar: exportarValorizado },
  sinMovimiento: { titulo: 'Sin movimiento',      filtros: filtrosSinMovimiento, cargar: () => getSinMovimiento({ dias: val('f-dias'), ubicacionId: val('f-sede') }), render: renderSinMovimiento, exportar: exportarSinMovimiento },
  procesos:      { titulo: 'Procesos',            filtros: () => '',             cargar: () => getProcesos(), render: renderProcesos, soloAdmin: true },
};

const generar = async () => {
  const el = document.getElementById('inf-resultado');
  el.innerHTML = '<div class="loader-container"><div class="spinner"></div> Generando…</div>';
  try {
    datos = await TABS[tab].cargar();
    el.innerHTML = TABS[tab].render();
  } catch (err) {
    el.innerHTML = '';
    showToast(err.message ?? 'Error al generar el informe.', 'error');
  }
};

const seleccionarTab = (t) => {
  tab = t;
  datos = null;
  document.querySelectorAll('.inf-tab').forEach((b) => b.classList.toggle('btn-primary', b.dataset.tab === t));
  document.querySelectorAll('.inf-tab').forEach((b) => b.classList.toggle('btn-secondary', b.dataset.tab !== t));
  const f = document.getElementById('inf-filtros');
  f.innerHTML = TABS[t].filtros();
  f.style.display = f.innerHTML ? '' : 'none';
  document.getElementById('f-generar')?.addEventListener('click', generar);
  generar();
};

export const initInformes = async () => {
  renderView(`<div class="app-shell">${buildSidebar('informes')}<main class="main-content"><div class="page-wrapper">
    <div class="loader-container"><div class="spinner"></div> Cargando…</div></div></main></div>`);
  try { ubicaciones = (await getCatalogo()).ubicaciones; } catch (err) { showToast(err.message, 'error'); }

  const tabs = Object.entries(TABS).filter(([, v]) => !v.soloAdmin || esAdmin());
  renderView(`
    <div class="app-shell">
      ${buildSidebar('informes')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header"><div>
          <h1 class="page-title">Informes</h1>
          <p class="page-subtitle">Rotación por talla, inventario valorizado y mercancía sin movimiento.</p>
        </div></header>
        <div class="op-tabs no-print">${tabs.map(([k, v]) => `<button type="button" class="btn btn-sm btn-secondary inf-tab" data-tab="${k}">${v.titulo}</button>`).join('')}</div>
        <div class="card op-card no-print" id="inf-filtros" style="margin-bottom:24px;"></div>
        <div class="card op-card" id="inf-resultado"></div>
      </div></main>
    </div>`);
  attachSidebarLogout();

  document.querySelectorAll('.inf-tab').forEach((b) => b.addEventListener('click', () => seleccionarTab(b.dataset.tab)));
  document.getElementById('inf-resultado').addEventListener('click', async (e) => {
    if (e.target.closest('[data-export]')) return TABS[tab].exportar?.();
    if (e.target.closest('[data-pdf]')) return window.print(); // "Guardar como PDF" del navegador, con estilos de impresión
    if (e.target.closest('[data-recalcular]')) {
      try { const r = await ejecutarProceso('INDICADORES'); showToast(r.mensaje, 'success'); await generar(); } catch (err) { showToast(err.message, 'error'); }
      return;
    }
    const costo = e.target.closest('[data-costo]');
    if (costo) {
      const v = prompt(`Costo unitario para todas las tallas y colores de ${costo.dataset.nombre}:`);
      if (v === null) return;
      try { await fijarCostoModelo(costo.dataset.costo, Number(v)); showToast('Costo registrado.', 'success'); await generar(); } catch (err) { showToast(err.message, 'error'); }
      return;
    }
    const ej = e.target.closest('[data-ejecutar]');
    if (ej) {
      ej.disabled = true;
      try { const r = await ejecutarProceso(ej.dataset.ejecutar); showToast(r.mensaje ?? 'Proceso ejecutado.', 'success'); } catch (err) { showToast(err.message, 'error'); }
      await generar();
    }
  });
  seleccionarTab('rotacion');
};
