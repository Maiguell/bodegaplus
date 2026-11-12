/**
 * @module tiendaView
 * @description Operación de tienda:
 *   HU10 — Cambio de talla del cliente (un solo movimiento CAMBIO trazable con la factura original).
 *   HU14 — Reservas: crear, vender, cancelar; las vencidas se liberan solas.
 */

import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getCatalogo, getInventario } from '../../services/catalogoService.js';
import { sedesOperables } from '../../services/authService.js';
import { registrarCambio, getReservas, crearReserva, venderReserva, cancelarReserva } from '../../services/operacionesService.js';
import { showToast } from '../../utils/toast.js';
import { esc, fechaHora, badgeEstado } from '../../utils/format.js';
import { buscarVariante, datalistVariantes, descVariante } from '../../utils/variantes.js';

let ubicaciones = [];
let variantes = [];
let reservas = [];
let filtroRes = 'ACTIVA';
let reloj = null;

const opts = (lista) => lista.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('');
/** Locales primero: son las sedes que atienden clientes. */
const sedesTienda = () => sedesOperables([...ubicaciones.filter((u) => u.tipo === 'LOCAL'), ...ubicaciones.filter((u) => u.tipo !== 'LOCAL')]);

const restante = (iso) => {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'vencida';
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  return h ? `vence en ${h} h ${m} min` : `vence en ${m} min`;
};

// ── HU10: Cambio de talla ───────────────────────────────────────────────────

const sedeCambio = () => Number(document.getElementById('cb-sede').value);

const actualizarCambio = () => {
  const dev = buscarVariante(variantes, document.getElementById('cb-dev').value);
  const lleva = buscarVariante(variantes, document.getElementById('cb-lleva').value);
  document.getElementById('cb-dev-desc').textContent = dev ? descVariante(dev) : '';
  // La talla nueva solo puede ser de la misma referencia
  const mismas = dev ? variantes.filter((v) => v.modeloId === dev.modeloId && v.id !== dev.id) : variantes;
  document.getElementById('cb-skus-lleva').innerHTML = mismas
    .map((v) => `<option value="${esc(v.sku)}">${esc(descVariante(v))} — ${v.stock[sedeCambio()] ?? 0} en sede</option>`).join('');
  const el = document.getElementById('cb-lleva-desc');
  if (!lleva) { el.textContent = ''; return; }
  if (dev && lleva.modeloId !== dev.modeloId) { el.textContent = 'Debe ser la misma referencia que la devuelta.'; return; }
  el.textContent = `${descVariante(lleva)} — disponible en la sede: ${lleva.stock[sedeCambio()] ?? 0}`;
};

const enviarCambio = async (e) => {
  e.preventDefault();
  const alerta = document.getElementById('cb-alerta');
  alerta.innerHTML = '';
  const dev = buscarVariante(variantes, document.getElementById('cb-dev').value);
  const lleva = buscarVariante(variantes, document.getElementById('cb-lleva').value);
  const factura = document.getElementById('cb-factura').value.trim();
  if (!factura) return showToast('Indica la factura original.', 'error');
  if (!dev || !lleva) return showToast('Indica la talla devuelta y la nueva (SKU).', 'error');
  if (dev.modeloId !== lleva.modeloId) return showToast('El cambio debe ser sobre la misma referencia.', 'error');
  if (dev.id === lleva.id) return showToast('La talla nueva debe ser distinta.', 'error');
  const btn = document.getElementById('cb-guardar');
  btn.disabled = true;
  try {
    await registrarCambio({
      ubicacionId: sedeCambio(), facturaOriginal: factura, devuelveVarianteId: dev.id, llevaVarianteId: lleva.id,
      cantidad: parseInt(document.getElementById('cb-cant').value, 10) || 1, observacion: document.getElementById('cb-obs').value,
    });
    showToast(`Cambio registrado: entra EU ${dev.eu}, sale EU ${lleva.eu}.`, 'success');
    e.target.reset();
    variantes = await getInventario();
    actualizarCambio();
  } catch (err) {
    const s = err.data?.sugerencias;
    if (Array.isArray(s)) {
      alerta.innerHTML = `<div class="op-alert">La talla EU ${lleva.eu} no está disponible en esta sede.
        ${s.length ? `Hay existencia en: <strong>${s.map((x) => `${esc(x.nombre)} (${x.cantidad})`).join(', ')}</strong>.` : 'No hay existencia en otras sedes.'}</div>`;
    } else {
      showToast(err.message ?? 'Error al registrar el cambio.', 'error');
    }
  } finally {
    btn.disabled = false;
  }
};

// ── HU14: Reservas ──────────────────────────────────────────────────────────

const renderReservas = () => {
  const lista = filtroRes === 'ACTIVA' ? reservas.filter((r) => r.estado === 'ACTIVA') : reservas;
  document.getElementById('res-lista').innerHTML = lista.length ? lista.map((r) => `
    <div class="op-item">
      <div>
        <div class="op-item-title">${esc(r.codigo)} · ${esc(r.clienteNombre)} ${badgeEstado(r.estado)}</div>
        <div class="op-item-meta">${esc(r.marca)} ${esc(r.modelo)} · ${esc(r.color)} · EU ${r.eu} <span class="product-sku">${esc(r.sku)}</span> × ${r.cantidad}</div>
        <div class="op-item-meta">${esc(r.ubicacion)} · ${r.clienteTelefono ? `☎ ${esc(r.clienteTelefono)} · ` : ''}creada ${fechaHora(r.creadaEn)} por ${esc(r.usuario)}
          · ${r.estado === 'ACTIVA' ? `<strong data-vence="${esc(r.venceEn)}">${restante(r.venceEn)}</strong>` : `cerrada ${fechaHora(r.cerradaEn)}`}</div>
      </div>
      ${r.estado === 'ACTIVA' ? `<div class="op-item-actions">
        <button type="button" class="btn btn-sm btn-primary" data-vender="${r.id}">Vender</button>
        <button type="button" class="btn btn-sm btn-secondary" data-cancelar="${r.id}">Cancelar</button></div>` : '<div></div>'}
    </div>`).join('')
    : '<div class="empty-state" style="padding:32px;"><div class="empty-state-title">Sin reservas</div></div>';
};

const recargarReservas = async () => {
  reservas = await getReservas();
  renderReservas();
};

const enviarReserva = async (e) => {
  e.preventDefault();
  const v = buscarVariante(variantes, document.getElementById('rn-sku').value);
  if (!v) return showToast('SKU no encontrado.', 'error');
  const nombre = document.getElementById('rn-nombre').value.trim();
  if (!nombre) return showToast('El nombre del cliente es requerido.', 'error');
  try {
    const r = await crearReserva({
      varianteId: v.id, ubicacionId: Number(document.getElementById('rn-sede').value), clienteNombre: nombre,
      clienteTelefono: document.getElementById('rn-tel').value, horas: parseInt(document.getElementById('rn-horas').value, 10) || 48,
    });
    showToast(`Reserva ${r.codigo} creada.`, 'success');
    e.target.reset();
    document.getElementById('rn-horas').value = 48;
    variantes = await getInventario();
    await recargarReservas();
  } catch (err) {
    showToast(err.message ?? 'Error al reservar.', 'error');
  }
};

// ── Inicializador ───────────────────────────────────────────────────────────

export const initTienda = async () => {
  clearInterval(reloj);
  renderView(`<div class="app-shell">${buildSidebar('tienda')}<main class="main-content"><div class="page-wrapper">
    <div class="loader-container"><div class="spinner"></div> Cargando…</div></div></main></div>`);
  try {
    const [cat, inv, res] = await Promise.all([getCatalogo(), getInventario(), getReservas()]);
    ubicaciones = cat.ubicaciones; variantes = inv; reservas = res;
  } catch (err) {
    showToast(err.message ?? 'Error al cargar datos.', 'error');
  }
  filtroRes = 'ACTIVA';

  renderView(`
    <div class="app-shell">
      ${buildSidebar('tienda')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header"><div>
          <h1 class="page-title">Cambios y reservas</h1>
          <p class="page-subtitle">Cambios de talla del cliente y unidades apartadas por tiempo limitado.</p>
        </div></header>
        <div class="op-layout">
          <div>
            <div class="card op-card">
              <h2 class="section-title">Cambio de talla</h2>
              <form id="cb-form" class="op-form" novalidate>
                <div class="op-row">
                  <div class="form-group"><label class="form-label" for="cb-sede">Sede *</label><select id="cb-sede" class="form-select">${opts(sedesTienda())}</select></div>
                  <div class="form-group"><label class="form-label" for="cb-factura">Factura original *</label><input id="cb-factura" class="form-input" maxlength="60" /></div>
                </div>
                <div class="form-group"><label class="form-label" for="cb-dev">Talla que devuelve (SKU) *</label>
                  <input id="cb-dev" class="form-input" list="cb-skus-dev" placeholder="Escribe o escanea…" autocomplete="off" />${datalistVariantes('cb-skus-dev', variantes)}
                  <div id="cb-dev-desc" class="op-hint"></div></div>
                <div class="form-group"><label class="form-label" for="cb-lleva">Talla que se lleva (SKU) *</label>
                  <input id="cb-lleva" class="form-input" list="cb-skus-lleva" placeholder="Misma referencia…" autocomplete="off" /><datalist id="cb-skus-lleva"></datalist>
                  <div id="cb-lleva-desc" class="op-hint"></div></div>
                <div class="op-row">
                  <div class="form-group" style="max-width:120px;"><label class="form-label" for="cb-cant">Pares</label><input id="cb-cant" type="number" min="1" value="1" class="form-input" /></div>
                  <div class="form-group"><label class="form-label" for="cb-obs">Observación</label><input id="cb-obs" class="form-input" placeholder="Opcional" /></div>
                </div>
                <div id="cb-alerta"></div>
                <button type="submit" id="cb-guardar" class="btn btn-primary" style="justify-content:center;padding:14px;">Registrar cambio</button>
              </form>
            </div>

            <div class="card op-card">
              <h2 class="section-title">Nueva reserva</h2>
              <form id="rn-form" class="op-form" novalidate>
                <div class="op-row">
                  <div class="form-group" style="flex:2;"><label class="form-label" for="rn-sku">SKU *</label>
                    <input id="rn-sku" class="form-input" list="rn-skus" placeholder="Escribe o escanea…" autocomplete="off" />${datalistVariantes('rn-skus', variantes)}</div>
                  <div class="form-group"><label class="form-label" for="rn-sede">Sede *</label><select id="rn-sede" class="form-select">${opts(sedesTienda())}</select></div>
                </div>
                <div id="rn-desc" class="op-hint"></div>
                <div class="op-row">
                  <div class="form-group" style="flex:2;"><label class="form-label" for="rn-nombre">Cliente *</label><input id="rn-nombre" class="form-input" maxlength="100" /></div>
                  <div class="form-group"><label class="form-label" for="rn-tel">Teléfono</label><input id="rn-tel" class="form-input" maxlength="30" /></div>
                  <div class="form-group" style="max-width:120px;"><label class="form-label" for="rn-horas">Horas</label><input id="rn-horas" type="number" min="1" max="168" value="48" class="form-input" /></div>
                </div>
                <button type="submit" class="btn btn-secondary" style="justify-content:center;">Reservar</button>
              </form>
            </div>
          </div>

          <div class="card op-card">
            <h2 class="section-title">Reservas</h2>
            <div class="op-tabs">
              <button type="button" class="btn btn-sm btn-primary res-filtro" data-f="ACTIVA">Activas</button>
              <button type="button" class="btn btn-sm btn-secondary res-filtro" data-f="todas">Todas</button>
            </div>
            <p class="op-hint">Si una reserva vence sin venderse, la unidad vuelve sola al disponible.</p>
            <div id="res-lista" class="op-list"></div>
          </div>
        </div>
      </div></main>
    </div>`);

  attachSidebarLogout();
  actualizarCambio();
  renderReservas();

  ['cb-dev', 'cb-lleva'].forEach((id) => document.getElementById(id).addEventListener('input', actualizarCambio));
  document.getElementById('cb-sede').addEventListener('change', actualizarCambio);
  document.getElementById('cb-form').addEventListener('submit', enviarCambio);

  const rnDesc = () => {
    const v = buscarVariante(variantes, document.getElementById('rn-sku').value);
    const sede = Number(document.getElementById('rn-sede').value);
    document.getElementById('rn-desc').textContent = v ? `${descVariante(v)} — disponible en la sede: ${v.stock[sede] ?? 0}` : '';
  };
  document.getElementById('rn-sku').addEventListener('input', rnDesc);
  document.getElementById('rn-sede').addEventListener('change', rnDesc);
  document.getElementById('rn-form').addEventListener('submit', enviarReserva);

  document.querySelectorAll('.res-filtro').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.res-filtro').forEach((x) => x.classList.replace('btn-primary', 'btn-secondary'));
    btn.classList.replace('btn-secondary', 'btn-primary');
    filtroRes = btn.dataset.f;
    renderReservas();
  }));
  document.getElementById('res-lista').addEventListener('click', async (e) => {
    const vender = e.target.closest('[data-vender]');
    const cancelar = e.target.closest('[data-cancelar]');
    try {
      if (vender) {
        const factura = prompt('Factura de venta (opcional):');
        if (factura === null) return;
        const r = await venderReserva(vender.dataset.vender, factura);
        showToast(`Reserva ${r.codigo} vendida.`, 'success');
      } else if (cancelar) {
        if (!confirm('¿Cancelar la reserva? La unidad vuelve al disponible.')) return;
        await cancelarReserva(cancelar.dataset.cancelar);
        showToast('Reserva cancelada.', 'success');
      } else return;
    } catch (err) {
      showToast(err.message ?? 'Error.', 'error');
    }
    variantes = await getInventario();
    await recargarReservas();
  });

  // Cuenta regresiva; si alguna venció, recarga para ver la liberación automática
  reloj = setInterval(() => {
    const marcas = document.querySelectorAll('[data-vence]');
    if (!marcas.length && !document.getElementById('res-lista')) { clearInterval(reloj); return; }
    let vencio = false;
    marcas.forEach((m) => { const t = restante(m.dataset.vence); if (t === 'vencida') vencio = true; m.textContent = t; });
    if (vencio) recargarReservas().catch(() => {});
  }, 30_000);
};
