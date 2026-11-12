/**
 * @module comprasView
 * @description HU05 — Órdenes de compra y recepción de mercancía contra la orden.
 * La recepción aumenta el inventario de la sede, genera la ENTRADA en el kardex y deja la orden
 * "Recibida" o "Recibida parcial". Si lo recibido supera lo pedido, exige una observación.
 */

import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getUser } from '../../services/authService.js';
import { getCatalogo, getInventario } from '../../services/catalogoService.js';
import { getOrdenesCompra, getOrdenCompra, crearOrdenCompra, recibirOrdenCompra, anularOrdenCompra } from '../../services/operacionesService.js';
import { showToast } from '../../utils/toast.js';
import { esc, numero, fechaHora, badgeEstado } from '../../utils/format.js';
import { buscarVariante, datalistVariantes, descVariante } from '../../utils/variantes.js';

let catalogo = { ubicaciones: [], proveedores: [] };
let variantes = [];
let ordenes = [];
let filtro = 'abiertas';
/** Panel derecho: { modo: 'vacio' } | { modo: 'recibir', orden } | { modo: 'nueva', lineas: [] } */
let panel = { modo: 'vacio' };

const esAdmin = () => getUser()?.rol === 'ADMIN';
const abierta = (o) => o.estado === 'PENDIENTE' || o.estado === 'RECIBIDA_PARCIAL';

// ── Lista de órdenes ────────────────────────────────────────────────────────

const renderOrdenes = () => {
  const lista = filtro === 'abiertas' ? ordenes.filter(abierta) : ordenes;
  document.getElementById('oc-lista').innerHTML = lista.length ? lista.map((o) => `
    <div class="op-item">
      <div>
        <div class="op-item-title">${esc(o.codigo)} ${badgeEstado(o.estado)}</div>
        <div class="op-item-meta">${esc(o.proveedor)} → ${esc(o.destino)} · ${fechaHora(o.fecha)}</div>
        <div class="op-item-meta">${numero(o.recibidos)} de ${numero(o.pedidos)} pares recibidos · ${o.lineas} línea(s)</div>
      </div>
      <div class="op-item-actions">
        <button type="button" class="btn btn-sm ${abierta(o) ? 'btn-primary' : 'btn-secondary'}" data-ver="${o.id}">${abierta(o) ? 'Recibir' : 'Ver'}</button>
      </div>
    </div>`).join('')
    : '<div class="empty-state" style="padding:32px;"><div class="empty-state-title">Sin órdenes</div></div>';
};

const recargarOrdenes = async () => {
  ordenes = await getOrdenesCompra();
  renderOrdenes();
};

// ── Recepción contra OC ─────────────────────────────────────────────────────

const renderRecepcion = () => {
  const o = panel.orden;
  const editable = abierta(o);
  return `
    <div class="kardex-head">
      <div><h2 class="section-title" style="margin:0;">${esc(o.codigo)} ${badgeEstado(o.estado)}</h2>
        <div class="op-item-meta">${esc(o.proveedor)} → ${esc(o.destino)} · creada por ${esc(o.usuario)} el ${fechaHora(o.fecha)}</div>
        ${o.observacion ? `<div class="op-item-meta">“${esc(o.observacion)}”</div>` : ''}</div>
      ${esAdmin() && o.estado === 'PENDIENTE' && !o.recibidos ? '<button type="button" id="oc-anular" class="btn btn-sm btn-danger">Anular</button>' : ''}
    </div>
    <form id="oc-recepcion" class="op-form" novalidate>
      <div style="overflow-x:auto;"><table class="data-table">
        <thead><tr><th>Zapatilla</th><th>Pedida</th><th>Recibida</th><th>Pendiente</th>${editable ? '<th>Recibe ahora</th>' : ''}</tr></thead>
        <tbody>${o.detalle.map((d) => `
          <tr>
            <td><div>${esc(d.marca)} ${esc(d.modelo)} · ${esc(d.color)} · EU ${d.eu}</div><span class="product-sku">${esc(d.sku)}</span></td>
            <td>${numero(d.pedida)}</td><td>${numero(d.recibida)}</td>
            <td>${numero(Math.max(0, d.pedida - d.recibida))}</td>
            ${editable ? `<td><input type="number" min="0" class="form-input op-input-sm" data-variante="${d.varianteId}"
              data-pendiente="${Math.max(0, d.pedida - d.recibida)}" value="${Math.max(0, d.pedida - d.recibida)}" /></td>` : ''}
          </tr>`).join('')}</tbody>
      </table></div>
      ${editable ? `
        <div id="oc-exceso"></div>
        <div class="op-row">
          <div class="form-group"><label class="form-label" for="oc-ref">Remisión del proveedor</label>
            <input id="oc-ref" class="form-input" placeholder="Opcional" /></div>
          <div class="form-group" style="flex:2;"><label class="form-label" for="oc-obs" id="oc-obs-lbl">Observación</label>
            <input id="oc-obs" class="form-input" placeholder="Obligatoria si llega más de lo pedido" /></div>
        </div>
        <button type="submit" id="oc-guardar" class="btn btn-primary" style="justify-content:center;padding:14px;">Registrar recepción</button>` : ''}
    </form>`;
};

/** Marca las líneas que superan lo pendiente y exige observación. */
const revisarExceso = () => {
  const excesos = [...document.querySelectorAll('#oc-recepcion [data-variante]')]
    .map((i) => ({ i, exceso: (parseInt(i.value, 10) || 0) - Number(i.dataset.pendiente) }))
    .filter((x) => x.exceso > 0);
  document.getElementById('oc-exceso').innerHTML = excesos.length
    ? `<div class="op-alert">Llegan ${numero(excesos.reduce((a, x) => a + x.exceso, 0))} par(es) más de lo pedido. Escribe una observación para poder guardar.</div>` : '';
  document.getElementById('oc-obs-lbl').textContent = excesos.length ? 'Observación *' : 'Observación';
  return excesos.length > 0;
};

const enviarRecepcion = async (e) => {
  e.preventDefault();
  const lineas = [...document.querySelectorAll('#oc-recepcion [data-variante]')]
    .map((i) => ({ varianteId: Number(i.dataset.variante), cantidad: parseInt(i.value, 10) || 0 }));
  if (lineas.some((l) => l.cantidad < 0)) return showToast('Las cantidades no pueden ser negativas.', 'error');
  if (!lineas.some((l) => l.cantidad > 0)) return showToast('Registra al menos una cantidad recibida.', 'error');
  const observacion = document.getElementById('oc-obs').value.trim();
  if (revisarExceso() && !observacion) {
    document.getElementById('oc-obs').focus();
    return showToast('Lo recibido supera lo pedido: agrega una observación.', 'error');
  }
  const btn = document.getElementById('oc-guardar');
  btn.disabled = true;
  try {
    const r = await recibirOrdenCompra(panel.orden.id, { lineas, observacion, referencia: document.getElementById('oc-ref').value });
    showToast(`${numero(r.pares)} pares ingresados. Orden ${r.estado === 'RECIBIDA' ? 'recibida' : 'recibida parcialmente'}.`, 'success');
    panel = { modo: 'recibir', orden: r.orden };
    renderPanel();
    await recargarOrdenes();
  } catch (err) {
    showToast(err.message ?? 'Error al registrar la recepción.', 'error');
    btn.disabled = false;
  }
};

// ── Nueva orden (admin) ─────────────────────────────────────────────────────

const renderNueva = () => `
  <h2 class="section-title">Nueva orden de compra</h2>
  <form id="oc-nueva" class="op-form" novalidate>
    <div class="op-row">
      <div class="form-group"><label class="form-label" for="on-prov">Proveedor *</label>
        <select id="on-prov" class="form-select">${catalogo.proveedores.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label" for="on-dest">Sede que recibe *</label>
        <select id="on-dest" class="form-select">${catalogo.ubicaciones.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}</select></div>
    </div>
    <div class="linea-box" style="display:flex;flex-direction:column;gap:10px;padding:14px;border:1px dashed var(--clr-ink);">
      <div class="op-row">
        <div class="form-group" style="flex:3;"><label class="form-label" for="on-sku">SKU</label>
          <input id="on-sku" class="form-input" list="on-skus" placeholder="Escribe o escanea…" autocomplete="off" />${datalistVariantes('on-skus', variantes)}</div>
        <div class="form-group"><label class="form-label" for="on-cant">Pares</label><input id="on-cant" type="number" min="1" class="form-input" /></div>
        <button type="button" id="on-add" class="btn btn-secondary">＋ Agregar</button>
      </div>
      <div id="on-desc" class="op-hint"></div>
    </div>
    <div id="on-lineas"></div>
    <div class="form-group"><label class="form-label" for="on-obs">Observación</label><input id="on-obs" class="form-input" placeholder="Opcional" /></div>
    <button type="submit" class="btn btn-primary" style="justify-content:center;padding:14px;">Crear orden</button>
  </form>`;

const renderLineasNueva = () => {
  const el = document.getElementById('on-lineas');
  el.innerHTML = panel.lineas.length ? `<table class="data-table"><thead><tr><th>SKU</th><th>Zapatilla</th><th>Pares</th><th></th></tr></thead><tbody>
    ${panel.lineas.map((l, i) => `<tr><td><span class="product-sku">${esc(l.v.sku)}</span></td><td>${esc(descVariante(l.v))}</td>
      <td>${l.cantidad}</td><td><button type="button" class="btn btn-sm btn-danger" data-quitar="${i}">✕</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="op-hint">Agrega las variantes y cantidades pedidas.</p>';
};

const agregarLineaNueva = () => {
  const v = buscarVariante(variantes, document.getElementById('on-sku').value);
  const cantidad = parseInt(document.getElementById('on-cant').value, 10);
  if (!v) return showToast('SKU no encontrado.', 'error');
  if (!cantidad || cantidad < 1) return showToast('Ingresa una cantidad válida.', 'error');
  const ex = panel.lineas.find((l) => l.v.id === v.id);
  if (ex) ex.cantidad += cantidad; else panel.lineas.push({ v, cantidad });
  document.getElementById('on-sku').value = '';
  document.getElementById('on-cant').value = '';
  document.getElementById('on-desc').textContent = '';
  renderLineasNueva();
  document.getElementById('on-sku').focus();
};

const enviarNueva = async (e) => {
  e.preventDefault();
  if (!panel.lineas.length) return showToast('Agrega al menos una línea.', 'error');
  try {
    const orden = await crearOrdenCompra({
      proveedorId: Number(document.getElementById('on-prov').value),
      destinoId: Number(document.getElementById('on-dest').value),
      observacion: document.getElementById('on-obs').value,
      lineas: panel.lineas.map((l) => ({ varianteId: l.v.id, cantidad: l.cantidad })),
    });
    showToast(`Orden ${orden.codigo} creada.`, 'success');
    panel = { modo: 'recibir', orden };
    renderPanel();
    await recargarOrdenes();
  } catch (err) {
    showToast(err.message ?? 'Error al crear la orden.', 'error');
  }
};

// ── Panel derecho ───────────────────────────────────────────────────────────

const renderPanel = () => {
  const el = document.getElementById('oc-panel');
  if (panel.modo === 'recibir') {
    el.innerHTML = renderRecepcion();
    const form = document.getElementById('oc-recepcion');
    form.addEventListener('submit', enviarRecepcion);
    form.addEventListener('input', (e) => { if (e.target.dataset.variante) revisarExceso(); });
    document.getElementById('oc-anular')?.addEventListener('click', async () => {
      if (!confirm(`¿Anular la orden ${panel.orden.codigo}?`)) return;
      try {
        panel = { modo: 'recibir', orden: await anularOrdenCompra(panel.orden.id) };
        renderPanel();
        await recargarOrdenes();
      } catch (err) { showToast(err.message, 'error'); }
    });
  } else if (panel.modo === 'nueva') {
    el.innerHTML = renderNueva();
    renderLineasNueva();
    const sku = document.getElementById('on-sku');
    sku.addEventListener('input', () => { const v = buscarVariante(variantes, sku.value); document.getElementById('on-desc').textContent = v ? descVariante(v) : ''; });
    document.getElementById('on-add').addEventListener('click', agregarLineaNueva);
    document.getElementById('on-cant').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregarLineaNueva(); } });
    document.getElementById('on-lineas').addEventListener('click', (e) => {
      const b = e.target.closest('[data-quitar]');
      if (b) { panel.lineas.splice(+b.dataset.quitar, 1); renderLineasNueva(); }
    });
    document.getElementById('oc-nueva').addEventListener('submit', enviarNueva);
  } else {
    el.innerHTML = '<div class="empty-state" style="padding:32px;"><div class="empty-state-title">Selecciona una orden</div><p class="empty-state-desc">Elige una orden pendiente para registrar lo recibido por talla y color.</p></div>';
  }
};

// ── Inicializador ───────────────────────────────────────────────────────────

export const initCompras = async () => {
  renderView(`<div class="app-shell">${buildSidebar('compras')}<main class="main-content"><div class="page-wrapper">
    <div class="loader-container"><div class="spinner"></div> Cargando…</div></div></main></div>`);
  try {
    [catalogo, variantes, ordenes] = await Promise.all([getCatalogo(), getInventario(), getOrdenesCompra()]);
  } catch (err) {
    showToast(err.message ?? 'Error al cargar datos.', 'error');
  }
  panel = { modo: 'vacio' };
  filtro = 'abiertas';

  renderView(`
    <div class="app-shell">
      ${buildSidebar('compras')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header">
          <div><h1 class="page-title">Compras</h1>
            <p class="page-subtitle">Recibe la mercancía contra la orden de compra del proveedor.</p></div>
          ${esAdmin() ? '<button type="button" id="oc-nueva-btn" class="btn btn-primary">＋ Nueva orden</button>' : ''}
        </header>
        <div class="op-layout">
          <div class="card op-card">
            <div class="op-tabs">
              <button type="button" class="btn btn-sm btn-primary oc-filtro" data-f="abiertas">Abiertas</button>
              <button type="button" class="btn btn-sm btn-secondary oc-filtro" data-f="todas">Todas</button>
            </div>
            <div id="oc-lista" class="op-list"></div>
          </div>
          <div class="card op-card" id="oc-panel"></div>
        </div>
      </div></main>
    </div>`);

  attachSidebarLogout();
  renderOrdenes();
  renderPanel();

  document.getElementById('oc-nueva-btn')?.addEventListener('click', () => { panel = { modo: 'nueva', lineas: [] }; renderPanel(); });
  document.getElementById('oc-lista').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ver]');
    if (!b) return;
    try {
      panel = { modo: 'recibir', orden: await getOrdenCompra(b.dataset.ver) };
      renderPanel();
    } catch (err) { showToast(err.message, 'error'); }
  });
  document.querySelectorAll('.oc-filtro').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.oc-filtro').forEach((x) => x.classList.replace('btn-primary', 'btn-secondary'));
    btn.classList.replace('btn-secondary', 'btn-primary');
    filtro = btn.dataset.f;
    renderOrdenes();
  }));
};
