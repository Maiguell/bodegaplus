/**
 * @module ajustesView
 * @description HU11 — Ajustes de inventario con causal y aprobación.
 * Cualquier usuario registra el ajuste (queda "Pendiente de aprobación"); solo el jefe de bodega
 * (rol ADMIN) lo aprueba, y solo entonces se modifica el stock. También recibe los ajustes
 * propuestos por los conteos físicos (HU12).
 */

import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getUser } from '../../services/authService.js';
import { getCatalogo, getInventario } from '../../services/catalogoService.js';
import { getAjustes, crearAjuste, aprobarAjuste, rechazarAjuste } from '../../services/operacionesService.js';
import { showToast } from '../../utils/toast.js';
import { esc, numero, fechaHora, badgeAjuste, CAUSALES } from '../../utils/format.js';
import { buscarVariante, datalistVariantes, descVariante, mensajeSugerencias } from '../../utils/variantes.js';

let ubicaciones = [];
let variantes = [];
let ajustes = [];
let lineas = [];
let filtro = 'PENDIENTE';

const esAdmin = () => getUser()?.rol === 'ADMIN';
const sedeId = () => Number(document.getElementById('aj-sede').value);
const signo = (n) => (n > 0 ? `+${n}` : String(n));

const renderLineas = () => {
  const el = document.getElementById('aj-lineas');
  el.innerHTML = lineas.length ? `<table class="data-table"><thead><tr><th>SKU</th><th>Zapatilla</th><th>Sistema</th><th>Diferencia</th><th></th></tr></thead><tbody>
    ${lineas.map((l, i) => `<tr><td><span class="product-sku">${esc(l.v.sku)}</span></td><td>${esc(descVariante(l.v))}</td>
      <td>${l.v.stock[sedeId()] ?? 0}</td>
      <td class="${l.cantidad > 0 ? 'kardex-pos' : 'kardex-neg'}">${signo(l.cantidad)}</td>
      <td><button type="button" class="btn btn-sm btn-danger" data-quitar="${i}">✕</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="op-hint">Agrega las variantes con su diferencia: negativa si faltan pares, positiva si sobran.</p>';
};

const agregarLinea = () => {
  const v = buscarVariante(variantes, document.getElementById('aj-sku').value);
  const cantidad = parseInt(document.getElementById('aj-cant').value, 10);
  if (!v) return showToast('SKU no encontrado.', 'error');
  if (!cantidad) return showToast('Ingresa una diferencia distinta de cero (ej. -2 o 1).', 'error');
  const ya = lineas.find((l) => l.v.id === v.id);
  const enSistema = v.stock[sedeId()] ?? 0;
  if (enSistema + (ya?.cantidad ?? 0) + cantidad < 0) {
    return showToast(`No puedes restar más de lo que hay: ${v.sku} tiene ${enSistema} par(es) en esta sede.`, 'error');
  }
  if (ya) {
    ya.cantidad += cantidad;
    if (!ya.cantidad) lineas = lineas.filter((l) => l !== ya);
  } else lineas.push({ v, cantidad });
  document.getElementById('aj-sku').value = '';
  document.getElementById('aj-cant').value = '';
  document.getElementById('aj-desc').textContent = '';
  renderLineas();
  document.getElementById('aj-sku').focus();
};

const enviar = async (e) => {
  e.preventDefault();
  const observacion = document.getElementById('aj-obs').value.trim();
  if (!lineas.length) return showToast('Agrega al menos una línea.', 'error');
  if (!observacion) return showToast('La observación es obligatoria.', 'error');
  try {
    const a = await crearAjuste({
      ubicacionId: sedeId(), causal: document.getElementById('aj-causal').value, observacion,
      lineas: lineas.map((l) => ({ varianteId: l.v.id, cantidad: l.cantidad })),
    });
    showToast(`Ajuste ${a.codigo} registrado: pendiente de aprobación del jefe de bodega.`, 'success');
    lineas = [];
    e.target.reset();
    renderLineas();
    await recargar();
  } catch (err) {
    showToast(err.message ?? 'Error al registrar el ajuste.', 'error');
  }
};

const itemAjuste = (a) => `
  <div class="op-item">
    <div style="min-width:0;">
      <div class="op-item-title">${esc(a.codigo)} · ${esc(CAUSALES[a.causal] ?? a.causal)} ${badgeAjuste(a.estado)}
        ${a.conteoId ? `<span class="badge badge-info">Conteo CF-${String(a.conteoId).padStart(4, '0')}</span>` : ''}</div>
      <div class="op-item-meta">${esc(a.ubicacion)} · ${fechaHora(a.fecha)} por ${esc(a.usuario)} · neto ${signo(a.neto)} pares</div>
      <div class="op-item-meta">“${esc(a.observacion)}”</div>
      ${a.estado !== 'PENDIENTE' ? `<div class="op-item-meta">${a.estado === 'APROBADO' ? 'Aprobado' : 'Rechazado'} por ${esc(a.resueltoPor)} el ${fechaHora(a.fechaResolucion)}${a.comentarioResolucion ? ` — ${esc(a.comentarioResolucion)}` : ''}</div>` : ''}
      <details class="mov-lineas" style="margin-top:6px;font-size:var(--fs-small);" ${a.estado === 'PENDIENTE' ? 'open' : ''}>
        <summary style="cursor:pointer;color:var(--clr-accent);">${(a.lineas ?? []).length} línea(s)</summary>
        <ul style="margin:8px 0 0 18px;">${(a.lineas ?? []).map((l) => `<li>${esc(l.marca)} ${esc(l.modelo)} · ${esc(l.color)} · EU ${l.talla}
          <span class="product-sku">${esc(l.sku)}</span> <strong class="${l.cantidad > 0 ? 'kardex-pos' : 'kardex-neg'}">${signo(l.cantidad)}</strong></li>`).join('')}</ul>
      </details>
    </div>
    <div class="op-item-actions">
      ${a.estado === 'PENDIENTE' && esAdmin() ? `
        <button type="button" class="btn btn-sm btn-primary" data-aprobar="${a.id}">Aprobar</button>
        <button type="button" class="btn btn-sm btn-secondary" data-rechazar="${a.id}">Rechazar</button>` : ''}
    </div>
  </div>`;

const renderAjustes = () => {
  const lista = filtro === 'PENDIENTE' ? ajustes.filter((a) => a.estado === 'PENDIENTE') : ajustes;
  document.getElementById('aj-n').textContent = ajustes.filter((a) => a.estado === 'PENDIENTE').length;
  document.getElementById('aj-lista').innerHTML = lista.length ? lista.map(itemAjuste).join('')
    : '<div class="empty-state" style="padding:32px;"><div class="empty-state-title">Sin ajustes</div></div>';
};

const recargar = async () => {
  [ajustes, variantes] = await Promise.all([getAjustes(), getInventario()]);
  renderAjustes();
};

export const initAjustes = async () => {
  renderView(`<div class="app-shell">${buildSidebar('ajustes')}<main class="main-content"><div class="page-wrapper">
    <div class="loader-container"><div class="spinner"></div> Cargando…</div></div></main></div>`);
  try {
    const [cat, inv, ajs] = await Promise.all([getCatalogo(), getInventario(), getAjustes()]);
    ubicaciones = cat.ubicaciones; variantes = inv; ajustes = ajs;
  } catch (err) {
    showToast(err.message ?? 'Error al cargar datos.', 'error');
  }
  lineas = []; filtro = 'PENDIENTE';

  renderView(`
    <div class="app-shell">
      ${buildSidebar('ajustes')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header"><div>
          <h1 class="page-title">Ajustes</h1>
          <p class="page-subtitle">Corrige diferencias con causal y trazabilidad. El stock solo cambia cuando el jefe de bodega aprueba.</p>
        </div></header>
        <div class="op-layout">
          <div class="card op-card">
            <h2 class="section-title">Registrar ajuste</h2>
            <form id="aj-form" class="op-form" novalidate>
              <div class="op-row">
                <div class="form-group"><label class="form-label" for="aj-sede">Sede *</label>
                  <select id="aj-sede" class="form-select">${ubicaciones.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}</select></div>
                <div class="form-group"><label class="form-label" for="aj-causal">Causal *</label>
                  <select id="aj-causal" class="form-select">${Object.entries(CAUSALES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
              </div>
              <div style="display:flex;flex-direction:column;gap:10px;padding:14px;border:1px dashed var(--clr-ink);">
                <div class="form-group"><label class="form-label" for="aj-sku">SKU</label>
                  <input id="aj-sku" class="form-input" list="aj-skus" placeholder="Escribe o escanea…" autocomplete="off" />${datalistVariantes('aj-skus', variantes)}</div>
                <div id="aj-desc" class="op-hint"></div>
                <div class="op-row">
                  <div class="form-group"><label class="form-label" for="aj-cant">Diferencia (± pares) *</label><input id="aj-cant" type="number" class="form-input" placeholder="-1" /></div>
                  <button type="button" id="aj-add" class="btn btn-secondary">＋ Agregar</button>
                </div>
              </div>
              <div id="aj-lineas"></div>
              <div class="form-group"><label class="form-label" for="aj-obs">Observación *</label>
                <input id="aj-obs" class="form-input" maxlength="255" placeholder="Qué pasó y cómo se detectó" /></div>
              <button type="submit" class="btn btn-primary" style="justify-content:center;padding:14px;">Registrar ajuste</button>
            </form>
          </div>
          <div class="card op-card">
            <div class="op-tabs">
              <button type="button" class="btn btn-sm btn-primary aj-filtro" data-f="PENDIENTE">Pendientes (<span id="aj-n">0</span>)</button>
              <button type="button" class="btn btn-sm btn-secondary aj-filtro" data-f="todos">Todos</button>
            </div>
            ${esAdmin() ? '' : '<p class="op-hint">Solo el jefe de bodega puede aprobar o rechazar.</p>'}
            <div id="aj-lista" class="op-list"></div>
          </div>
        </div>
      </div></main>
    </div>`);

  attachSidebarLogout();
  renderLineas();
  renderAjustes();

  const desc = () => {
    const v = buscarVariante(variantes, document.getElementById('aj-sku').value);
    document.getElementById('aj-desc').textContent = v ? `${descVariante(v)} — en el sistema: ${v.stock[sedeId()] ?? 0} pares` : '';
  };
  document.getElementById('aj-sku').addEventListener('input', desc);
  document.getElementById('aj-sede').addEventListener('change', () => { desc(); renderLineas(); });
  document.getElementById('aj-add').addEventListener('click', agregarLinea);
  document.getElementById('aj-cant').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregarLinea(); } });
  document.getElementById('aj-lineas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (b) { lineas.splice(+b.dataset.quitar, 1); renderLineas(); }
  });
  document.getElementById('aj-form').addEventListener('submit', enviar);
  document.querySelectorAll('.aj-filtro').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.aj-filtro').forEach((x) => x.classList.replace('btn-primary', 'btn-secondary'));
    btn.classList.replace('btn-secondary', 'btn-primary');
    filtro = btn.dataset.f;
    renderAjustes();
  }));
  document.getElementById('aj-lista').addEventListener('click', async (e) => {
    const ap = e.target.closest('[data-aprobar]');
    const re = e.target.closest('[data-rechazar]');
    try {
      if (ap) {
        const comentario = prompt('Comentario de aprobación (opcional):');
        if (comentario === null) return;
        const a = await aprobarAjuste(ap.dataset.aprobar, comentario);
        showToast(`${a.codigo} aprobado: stock actualizado (${signo(a.neto)} pares).`, 'success');
      } else if (re) {
        const comentario = prompt('Motivo del rechazo:');
        if (!comentario?.trim()) return;
        const a = await rechazarAjuste(re.dataset.rechazar, comentario);
        showToast(`${a.codigo} rechazado.`, 'info');
      } else return;
      await recargar();
    } catch (err) {
      showToast(err.data?.sugerencias ? mensajeSugerencias(err) : (err.message ?? 'Error.'), 'error');
    }
  });
};
