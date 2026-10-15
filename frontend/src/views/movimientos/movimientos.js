/**
 * @module movimientosView
 * @description Registro de movimientos de la bodega con varias líneas (SKU + pares):
 * ENTRADA de proveedor, DESPACHO a un local, DEVOLUCIÓN desde un local y AJUSTE (solo admin).
 */

import './movimientos.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getUser } from '../../services/authService.js';
import { registrarMovimiento, getMovimientos } from '../../services/movimientosService.js';
import { getCatalogo, getInventario } from '../../services/catalogoService.js';
import { showToast } from '../../utils/toast.js';
import { esc, fechaHora, numero, TIPOS_MOV, MOTIVOS } from '../../utils/format.js';

const MOTIVOS_POR_TIPO = {
  DEVOLUCION: ['TALLA_INCORRECTA', 'DEFECTO', 'SOBRANTE', 'OTRO'],
  AJUSTE: ['CONTEO', 'MERMA', 'OTRO'],
};

let tipo = 'ENTRADA';
/** @type {Array<{variante: object, cantidad: number}>} líneas del movimiento en armado */
let lineas = [];
/** @type {Array<object>} */ let variantes = [];
/** @type {object} */ let catalogo = { ubicaciones: [], proveedores: [] };
/** @type {Array<object>} */ let historial = [];
let filtroHistorial = 'todos';

const bodega = () => catalogo.ubicaciones.find((u) => u.tipo === 'BODEGA');
const locales = () => catalogo.ubicaciones.filter((u) => u.tipo === 'LOCAL');
const descVariante = (v) => `${v.marca} ${v.modelo} · ${v.color} · EU ${v.eu}`;

// ── Formulario ──────────────────────────────────────────────────────────────

/** Ubicación de la que salen los pares (para validar y mostrar disponibilidad). */
const ubicacionOrigen = () => {
  const val = (id) => document.getElementById(id)?.value;
  if (tipo === 'DESPACHO') return bodega()?.id;
  if (tipo === 'DEVOLUCION') return Number(val('mov-local'));
  if (tipo === 'AJUSTE') return Number(val('mov-ubicacion'));
  return bodega()?.id; // ENTRADA: se muestra el stock actual de la bodega
};

const opts = (lista) => lista.map((o) => `<option value="${o.id}">${esc(o.nombre)}</option>`).join('');

/** Dibuja los campos que dependen del tipo de movimiento. */
const renderCamposTipo = () => {
  const el = document.getElementById('campos-tipo');
  const motivos = (MOTIVOS_POR_TIPO[tipo] ?? []).map((m) => `<option value="${m}">${MOTIVOS[m]}</option>`).join('');
  const campos = {
    ENTRADA: `
      <div class="form-group"><label class="form-label" for="mov-proveedor">Proveedor</label>
        <select id="mov-proveedor" class="form-select"><option value="">— Sin proveedor —</option>${opts(catalogo.proveedores)}</select></div>`,
    DESPACHO: `
      <div class="form-group"><label class="form-label" for="mov-local">Local destino *</label>
        <select id="mov-local" class="form-select">${opts(locales())}</select></div>`,
    DEVOLUCION: `
      <div class="form-group"><label class="form-label" for="mov-local">Local que devuelve *</label>
        <select id="mov-local" class="form-select">${opts(locales())}</select></div>
      <div class="form-group"><label class="form-label" for="mov-motivo">Motivo *</label>
        <select id="mov-motivo" class="form-select">${motivos}</select></div>`,
    AJUSTE: `
      <div class="form-group"><label class="form-label" for="mov-ubicacion">Ubicación *</label>
        <select id="mov-ubicacion" class="form-select">${opts(catalogo.ubicaciones)}</select></div>
      <div class="form-group"><label class="form-label" for="mov-motivo">Motivo *</label>
        <select id="mov-motivo" class="form-select">${motivos}</select></div>`,
  };
  el.innerHTML = campos[tipo];
  el.querySelectorAll('select').forEach((s) => s.addEventListener('change', actualizarDisponible));
  document.getElementById('mov-cantidad').min = tipo === 'AJUSTE' ? '' : '1';
  document.getElementById('lbl-cantidad').textContent = tipo === 'AJUSTE' ? 'Diferencia (± pares) *' : 'Pares *';
};

const selectTipo = (t) => {
  tipo = t;
  lineas = []; // las líneas dependen de la ubicación de origen
  document.querySelectorAll('.tipo-btn').forEach((b) =>
    b.classList.toggle(`selected-${b.dataset.tipo.toLowerCase()}`, b.dataset.tipo === t));
  renderCamposTipo();
  renderLineas();
  actualizarDisponible();
};

const varianteDeInput = () => {
  const code = document.getElementById('mov-sku').value.trim().toUpperCase();
  return variantes.find((v) => v.sku.toUpperCase() === code);
};

const actualizarDisponible = () => {
  const el = document.getElementById('disponible');
  const v = varianteDeInput();
  if (!v) { el.textContent = ''; return; }
  const ub = ubicacionOrigen();
  const nombre = catalogo.ubicaciones.find((u) => u.id === ub)?.nombre ?? '';
  el.textContent = `${descVariante(v)} — disponible en ${nombre}: ${v.stock[ub] ?? 0} pares`;
};

const renderLineas = () => {
  const el = document.getElementById('lineas');
  if (!lineas.length) {
    el.innerHTML = '<p style="color:var(--clr-text-muted);font-size:0.82rem;">Aún no hay líneas. Escribe o escanea un SKU y agrégalo.</p>';
    return;
  }
  const total = lineas.reduce((a, l) => a + l.cantidad, 0);
  el.innerHTML = `
    <table class="data-table"><thead><tr><th>SKU</th><th>Zapatilla</th><th>Pares</th><th></th></tr></thead><tbody>
      ${lineas.map((l, i) => `
        <tr><td><span class="product-sku">${esc(l.variante.sku)}</span></td><td>${esc(descVariante(l.variante))}</td>
            <td style="font-weight:700;">${l.cantidad}</td>
            <td><button type="button" class="btn btn-sm btn-danger" data-quitar="${i}">✕</button></td></tr>`).join('')}
    </tbody></table>
    <div style="text-align:right;padding-top:8px;font-size:0.85rem;color:var(--clr-text-secondary);">Total: <strong>${numero(total)}</strong> pares</div>`;
};

const agregarLinea = () => {
  const v = varianteDeInput();
  const cantidad = parseInt(document.getElementById('mov-cantidad').value, 10);
  if (!v) return showToast('SKU no encontrado. Elige uno de la lista.', 'error');
  if (!cantidad || (tipo !== 'AJUSTE' && cantidad < 0)) return showToast('Ingresa una cantidad válida.', 'error');

  const existente = lineas.find((l) => l.variante.id === v.id);
  if (existente) existente.cantidad += cantidad; else lineas.push({ variante: v, cantidad });
  document.getElementById('mov-sku').value = '';
  document.getElementById('mov-cantidad').value = '';
  document.getElementById('disponible').textContent = '';
  renderLineas();
  document.getElementById('mov-sku').focus();
};

const enviar = async (e) => {
  e.preventDefault();
  if (!lineas.length) return showToast('Agrega al menos una línea.', 'error');
  const val = (id) => document.getElementById(id)?.value;
  const payload = {
    tipo,
    detalle: lineas.map((l) => ({ varianteId: l.variante.id, cantidad: l.cantidad })),
    referencia: val('mov-ref'),
    observacion: val('mov-obs'),
    proveedorId: Number(val('mov-proveedor')) || undefined,
    localId: Number(val('mov-local')) || undefined,
    ubicacionId: Number(val('mov-ubicacion')) || undefined,
    motivo: val('mov-motivo') || undefined,
  };

  const btn = document.getElementById('mov-save-btn');
  btn.disabled = true;
  btn.textContent = 'Registrando…';
  try {
    const r = await registrarMovimiento(payload);
    showToast(`${TIPOS_MOV[tipo].label} registrada: ${numero(r.pares)} pares.`, 'success');
    lineas = [];
    e.target.reset();
    renderLineas();
    [variantes, historial] = await Promise.all([getInventario(), getMovimientos()]); // el stock cambió
    renderHistorial();
  } catch (err) {
    showToast(err.message ?? 'Error al registrar el movimiento.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Registrar movimiento';
  }
};

// ── Historial ───────────────────────────────────────────────────────────────

const buildItem = (m) => {
  const t = TIPOS_MOV[m.tipo];
  const ruta = m.tipo === 'ENTRADA' ? `${m.proveedor ?? 'Sin proveedor'} → ${m.destino}`
    : m.tipo === 'AJUSTE' ? m.destino : `${m.origen} → ${m.destino}`;
  const lineasHtml = (m.lineas ?? []).map((l) =>
    `<li>${esc(l.modelo)} · ${esc(l.color)} · EU ${l.talla} <span class="product-sku">${esc(l.sku)}</span> × ${l.cantidad}</li>`).join('');
  return `
    <div class="mov-list-item">
      <div class="mov-tipo-pill ${t.clase}">${t.icon}</div>
      <div style="min-width:0;">
        <div class="mov-detail-nombre">${t.label} · ${esc(ruta)}</div>
        <div class="mov-detail-obs">${fechaHora(m.fecha)} · ${esc(m.usuario)}${m.motivo ? ` · ${MOTIVOS[m.motivo]}` : ''}${m.referencia ? ` · Ref. ${esc(m.referencia)}` : ''}</div>
        <details class="mov-lineas"><summary>${(m.lineas ?? []).length} línea(s)</summary><ul>${lineasHtml}</ul>
          ${m.observacion ? `<p class="mov-detail-obs">“${esc(m.observacion)}”</p>` : ''}</details>
      </div>
      <span class="mov-qty ${t.clase}">${numero(m.pares)}</span>
    </div>`;
};

const renderHistorial = () => {
  const cont = document.getElementById('historial-container');
  if (!cont) return;
  const lista = filtroHistorial === 'todos' ? historial : historial.filter((m) => m.tipo === filtroHistorial);
  cont.innerHTML = lista.length
    ? lista.map(buildItem).join('')
    : `<div class="empty-state" style="padding:32px;"><div class="empty-state-icon">📋</div><div class="empty-state-title">Sin movimientos</div></div>`;
};

// ── Inicializador ───────────────────────────────────────────────────────────

export const initMovimientos = async () => {
  renderView(`
    <div class="app-shell">
      ${buildSidebar('movimientos')}
      <main class="main-content"><div class="page-wrapper">
        <div class="loader-container"><div class="spinner"></div> Cargando…</div>
      </div></main>
    </div>`);

  try {
    [catalogo, variantes, historial] = await Promise.all([getCatalogo(), getInventario(), getMovimientos()]);
  } catch (err) {
    showToast(err.message ?? 'Error al cargar datos.', 'error');
  }

  const tipos = Object.keys(TIPOS_MOV).filter((t) => t !== 'AJUSTE' || getUser()?.rol === 'ADMIN');
  tipo = 'ENTRADA';
  lineas = [];
  filtroHistorial = 'todos';

  renderView(`
    <div class="app-shell">
      ${buildSidebar('movimientos')}
      <main class="main-content">
        <div class="page-wrapper">
          <header class="page-header">
            <div>
              <h1 class="page-title">Movimientos</h1>
              <p class="page-subtitle">Entradas de proveedor, despachos a locales, devoluciones y ajustes.</p>
            </div>
          </header>

          <div class="movimientos-layout">
            <div class="card movimiento-form-card">
              <h2 class="section-title">Registrar movimiento</h2>
              <div class="tipo-selector">
                ${tipos.map((t) => `<button type="button" class="tipo-btn ${t === 'ENTRADA' ? 'selected-entrada' : ''}" data-tipo="${t}">${TIPOS_MOV[t].icon} ${TIPOS_MOV[t].label}</button>`).join('')}
              </div>

              <form id="movimiento-form" class="movimiento-form" novalidate>
                <div id="campos-tipo" class="movimiento-form" style="margin-top:0;"></div>

                <div class="linea-box">
                  <div class="form-group">
                    <label class="form-label" for="mov-sku">SKU de la zapatilla</label>
                    <input id="mov-sku" class="form-input" list="skus" placeholder="Escribe o escanea el SKU…" autocomplete="off" />
                    <datalist id="skus">${variantes.map((v) => `<option value="${esc(v.sku)}">${esc(descVariante(v))}</option>`).join('')}</datalist>
                  </div>
                  <div id="disponible" class="mov-detail-obs" style="min-height:1.2em;"></div>
                  <div class="linea-add">
                    <div class="form-group" style="flex:1;">
                      <label class="form-label" id="lbl-cantidad" for="mov-cantidad">Pares *</label>
                      <input type="number" id="mov-cantidad" class="form-input" min="1" placeholder="0" />
                    </div>
                    <button type="button" id="btn-agregar" class="btn btn-secondary">＋ Agregar</button>
                  </div>
                </div>

                <div id="lineas"></div>

                <div class="form-group"><label class="form-label" for="mov-ref">Referencia (factura / guía)</label>
                  <input id="mov-ref" class="form-input" placeholder="Opcional" /></div>
                <div class="form-group"><label class="form-label" for="mov-obs">Observación</label>
                  <input id="mov-obs" class="form-input" placeholder="Opcional" /></div>

                <button type="submit" id="mov-save-btn" class="btn btn-primary" style="width:100%;justify-content:center;padding:14px;">Registrar movimiento</button>
              </form>
            </div>

            <div class="card historial-card">
              <h2 class="section-title">Historial</h2>
              <div class="filter-bar">
                <button class="btn btn-sm btn-primary filter-btn" data-filter="todos">Todos</button>
                ${Object.entries(TIPOS_MOV).map(([k, v]) => `<button class="btn btn-sm btn-secondary filter-btn" data-filter="${k}">${v.icon} ${v.label}</button>`).join('')}
              </div>
              <div id="historial-container"></div>
            </div>
          </div>
        </div>
      </main>
    </div>`);

  attachSidebarLogout();
  renderCamposTipo();
  renderLineas();
  renderHistorial();

  document.querySelectorAll('.tipo-btn').forEach((b) => b.addEventListener('click', () => selectTipo(b.dataset.tipo)));
  document.getElementById('mov-sku').addEventListener('input', actualizarDisponible);
  document.getElementById('btn-agregar').addEventListener('click', agregarLinea);
  document.getElementById('mov-cantidad').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregarLinea(); } });
  document.getElementById('lineas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (b) { lineas.splice(+b.dataset.quitar, 1); renderLineas(); }
  });
  document.getElementById('movimiento-form').addEventListener('submit', enviar);
  document.querySelectorAll('.filter-btn').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
    btn.classList.add('btn-primary');
    btn.classList.remove('btn-secondary');
    filtroHistorial = btn.dataset.filter;
    renderHistorial();
  }));
};
