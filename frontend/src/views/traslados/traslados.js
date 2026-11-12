/**
 * @module trasladosView
 * @description HU08 — Enviar pares a otra sede (quedan "en tránsito") ·
 * HU09 — La sede destino confirma lo recibido; las diferencias quedan como novedad para el jefe de bodega.
 */

import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getUser, puede, sedesOperables } from '../../services/authService.js';
import { getCatalogo, getInventario } from '../../services/catalogoService.js';
import { getTraslados, enviarTraslado, recibirTraslado, revisarNovedad } from '../../services/operacionesService.js';
import { showToast } from '../../utils/toast.js';
import { esc, numero, fechaHora, badgeEstado } from '../../utils/format.js';
import { buscarVariante, datalistVariantes, descVariante, mensajeSugerencias } from '../../utils/variantes.js';

let ubicaciones = [];
let variantes = [];
let traslados = [];
let lineas = [];
let tab = 'recibir';
let sedeDestino = '';
let abiertoId = null; // traslado con el formulario de recepción desplegado

/** Permiso del rol (HU19); el backend valida de nuevo. */
const esAdmin = () => puede('traslados.novedad');
const opts = (lista, sel) => lista.map((u) => `<option value="${u.id}" ${String(u.id) === String(sel) ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('');
const origenId = () => Number(document.getElementById('tr-origen').value);

// ── Envío ───────────────────────────────────────────────────────────────────

const actualizarDisponible = () => {
  const v = buscarVariante(variantes, document.getElementById('tr-sku').value);
  const sede = ubicaciones.find((u) => u.id === origenId());
  document.getElementById('tr-disp').textContent = v ? `${descVariante(v)} — disponible en ${sede?.nombre}: ${v.stock[origenId()] ?? 0} pares` : '';
};

const renderLineas = () => {
  const el = document.getElementById('tr-lineas');
  el.innerHTML = lineas.length ? `<table class="data-table"><thead><tr><th>SKU</th><th>Zapatilla</th><th>Pares</th><th></th></tr></thead><tbody>
    ${lineas.map((l, i) => `<tr><td><span class="product-sku">${esc(l.v.sku)}</span></td><td>${esc(descVariante(l.v))}</td>
      <td style="font-weight:700;">${l.cantidad}</td><td><button type="button" class="btn btn-sm btn-danger" data-quitar="${i}">✕</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="op-hint">Aún no hay líneas.</p>';
};

const agregarLinea = () => {
  const v = buscarVariante(variantes, document.getElementById('tr-sku').value);
  const cantidad = parseInt(document.getElementById('tr-cant').value, 10);
  if (!v) return showToast('SKU no encontrado.', 'error');
  if (!cantidad || cantidad < 1) return showToast('Ingresa una cantidad válida.', 'error');
  const ya = lineas.find((l) => l.v.id === v.id);
  const total = (ya?.cantidad ?? 0) + cantidad;
  if (total > (v.stock[origenId()] ?? 0)) return showToast(`Solo hay ${v.stock[origenId()] ?? 0} pares de ${v.sku} en la sede origen.`, 'error');
  if (ya) ya.cantidad = total; else lineas.push({ v, cantidad });
  document.getElementById('tr-sku').value = '';
  document.getElementById('tr-cant').value = '';
  document.getElementById('tr-disp').textContent = '';
  renderLineas();
  document.getElementById('tr-sku').focus();
};

const enviar = async (e) => {
  e.preventDefault();
  if (!lineas.length) return showToast('Agrega al menos una línea.', 'error');
  const destinoId = Number(document.getElementById('tr-destino').value);
  if (destinoId === origenId()) return showToast('La sede destino debe ser distinta a la de origen.', 'error');
  const btn = document.getElementById('tr-enviar');
  btn.disabled = true;
  try {
    const t = await enviarTraslado({
      origenId: origenId(), destinoId, observacion: document.getElementById('tr-obs').value,
      lineas: lineas.map((l) => ({ varianteId: l.v.id, cantidad: l.cantidad })),
    });
    showToast(`Traslado ${t.codigo} enviado a ${t.destino}: ${numero(t.enviados)} pares en tránsito.`, 'success');
    lineas = [];
    e.target.reset();
    renderLineas();
    await recargar();
  } catch (err) {
    showToast(err.data?.sugerencias ? mensajeSugerencias(err) : (err.message ?? 'Error al enviar el traslado.'), 'error');
  } finally {
    btn.disabled = false;
  }
};

// ── Recepción y novedades ───────────────────────────────────────────────────

const formRecepcion = (t) => `
  <form class="op-form tr-recibir-form" data-id="${t.id}" style="margin-top:12px;" novalidate>
    <table class="data-table"><thead><tr><th>Zapatilla</th><th>Enviados</th><th>Recibidos</th></tr></thead><tbody>
      ${t.lineas.map((l) => `<tr><td>${esc(l.marca)} ${esc(l.modelo)} · ${esc(l.color)} · EU ${l.talla} <span class="product-sku">${esc(l.sku)}</span></td>
        <td>${l.enviada}</td>
        <td><input type="number" min="0" max="${l.enviada}" value="${l.enviada}" class="form-input op-input-sm" data-variante="${l.varianteId}" data-enviada="${l.enviada}" /></td></tr>`).join('')}
    </tbody></table>
    <div class="tr-dif"></div>
    <div class="form-group"><label class="form-label">Observación</label><input class="form-input tr-obs-rec" placeholder="Opcional" /></div>
    <div class="op-item-actions" style="justify-content:flex-start;">
      <button type="submit" class="btn btn-primary btn-sm">Confirmar recepción</button>
      <button type="button" class="btn btn-secondary btn-sm" data-cerrar>Cancelar</button>
    </div>
  </form>`;

const itemTraslado = (t) => `
  <div class="op-item">
    <div style="min-width:0;">
      <div class="op-item-title">${esc(t.codigo)} ${badgeEstado(t.estado)}
        ${t.novedadEstado === 'PENDIENTE' ? '<span class="badge badge-danger">Novedad pendiente</span>' : ''}
        ${t.novedadEstado === 'REVISADA' ? '<span class="badge badge-success">Novedad revisada</span>' : ''}</div>
      <div class="op-item-meta">${esc(t.origen)} → ${esc(t.destino)} · enviado ${fechaHora(t.fechaEnvio)} por ${esc(t.enviadoPor)}</div>
      <div class="op-item-meta">${numero(t.enviados)} pares enviados${t.recibidos !== null ? ` · ${numero(t.recibidos)} recibidos ${fechaHora(t.fechaRecepcion)} por ${esc(t.recibidoPor)}` : ''}</div>
      ${t.observacion ? `<div class="op-item-meta">“${esc(t.observacion)}”</div>` : ''}
      ${t.novedad ? `<div class="op-alert ${t.novedadEstado === 'PENDIENTE' ? 'danger' : ''}" style="margin-top:8px;">${esc(t.novedad)}
        ${t.novedadComentario ? `<br><strong>Revisión (${esc(t.novedadRevisadaPor)}):</strong> ${esc(t.novedadComentario)}` : ''}</div>` : ''}
      <details class="mov-lineas" style="margin-top:6px;font-size:var(--fs-small);"><summary style="cursor:pointer;color:var(--clr-accent);">${t.lineas.length} línea(s)</summary>
        <ul style="margin:8px 0 0 18px;">${t.lineas.map((l) => `<li>${esc(l.modelo)} · ${esc(l.color)} · EU ${l.talla} <span class="product-sku">${esc(l.sku)}</span> × ${l.enviada}${l.recibida !== null && l.recibida !== l.enviada ? ` (llegaron ${l.recibida})` : ''}</li>`).join('')}</ul></details>
      ${abiertoId === t.id ? formRecepcion(t) : ''}
    </div>
    <div class="op-item-actions">
      ${t.estado === 'EN_TRANSITO' && abiertoId !== t.id ? `<button type="button" class="btn btn-sm btn-primary" data-recibir="${t.id}">Recibir</button>` : ''}
      ${t.novedadEstado === 'PENDIENTE' && esAdmin() ? `<button type="button" class="btn btn-sm btn-secondary" data-revisar="${t.id}">Marcar revisada</button>` : ''}
    </div>
  </div>`;

const renderTraslados = () => {
  const porRecibir = traslados.filter((t) => t.estado === 'EN_TRANSITO' && (!sedeDestino || String(t.destinoId) === sedeDestino));
  const novedades = traslados.filter((t) => t.novedadEstado === 'PENDIENTE');
  document.getElementById('tr-n-recibir').textContent = porRecibir.length;
  document.getElementById('tr-n-novedad').textContent = novedades.length;
  const lista = tab === 'recibir' ? porRecibir : tab === 'novedades' ? novedades : traslados;
  document.getElementById('tr-filtro-sede').style.display = tab === 'recibir' ? '' : 'none';
  document.getElementById('tr-lista').innerHTML = lista.length ? lista.map(itemTraslado).join('')
    : `<div class="empty-state" style="padding:32px;"><div class="empty-state-title">${tab === 'recibir' ? 'No hay traslados por recibir' : tab === 'novedades' ? 'Sin novedades pendientes' : 'Sin traslados'}</div></div>`;
};

const recargar = async () => {
  [traslados, variantes] = await Promise.all([getTraslados(), getInventario()]);
  renderTraslados();
};

const confirmarRecepcion = async (form) => {
  const inputs = [...form.querySelectorAll('[data-variante]')];
  const datos = inputs.map((i) => ({ varianteId: Number(i.dataset.variante), cantidad: parseInt(i.value, 10) }));
  if (datos.some((d, k) => !Number.isInteger(d.cantidad) || d.cantidad < 0 || d.cantidad > Number(inputs[k].dataset.enviada))) {
    return showToast('Cada cantidad recibida debe estar entre 0 y lo enviado.', 'error');
  }
  const faltan = inputs.reduce((a, i) => a + Number(i.dataset.enviada) - parseInt(i.value, 10), 0);
  if (faltan > 0 && !confirm(`Faltan ${faltan} par(es). Se registrará una novedad para el jefe de bodega. ¿Continuar?`)) return;
  try {
    const t = await recibirTraslado(form.dataset.id, { lineas: datos, observacion: form.querySelector('.tr-obs-rec').value });
    showToast(t.novedad ? `${t.codigo} recibido con novedad.` : `${t.codigo} recibido: ${numero(t.recibidos)} pares ingresados a ${t.destino}.`, t.novedad ? 'info' : 'success');
    abiertoId = null;
    await recargar();
  } catch (err) {
    showToast(err.message ?? 'Error al confirmar la recepción.', 'error');
  }
};

// ── Inicializador ───────────────────────────────────────────────────────────

export const initTraslados = async () => {
  renderView(`<div class="app-shell">${buildSidebar('traslados')}<main class="main-content"><div class="page-wrapper">
    <div class="loader-container"><div class="spinner"></div> Cargando…</div></div></main></div>`);
  try {
    const [cat, inv, trs] = await Promise.all([getCatalogo(), getInventario(), getTraslados()]);
    ubicaciones = cat.ubicaciones; variantes = inv; traslados = trs;
  } catch (err) {
    showToast(err.message ?? 'Error al cargar datos.', 'error');
  }
  lineas = []; tab = 'recibir'; abiertoId = null; sedeDestino = '';
  const bodega = ubicaciones.find((u) => u.tipo === 'BODEGA');
  const primerLocal = ubicaciones.find((u) => u.tipo === 'LOCAL');

  renderView(`
    <div class="app-shell">
      ${buildSidebar('traslados')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header"><div>
          <h1 class="page-title">Traslados</h1>
          <p class="page-subtitle">Equilibra las tallas entre sedes. Los pares quedan en tránsito hasta que el destino confirma.</p>
        </div></header>
        <div class="op-layout">
          <div class="card op-card">
            <h2 class="section-title">Enviar traslado</h2>
            <form id="tr-form" class="op-form" novalidate>
              <div class="op-row">
                <div class="form-group"><label class="form-label" for="tr-origen">Sede origen *</label>
                  <select id="tr-origen" class="form-select">${opts(sedesOperables(ubicaciones), bodega?.id)}</select></div>
                <div class="form-group"><label class="form-label" for="tr-destino">Sede destino *</label>
                  <select id="tr-destino" class="form-select">${opts(ubicaciones, primerLocal?.id)}</select></div>
              </div>
              <div style="display:flex;flex-direction:column;gap:10px;padding:14px;border:1px dashed var(--clr-ink);">
                <div class="form-group"><label class="form-label" for="tr-sku">SKU</label>
                  <input id="tr-sku" class="form-input" list="tr-skus" placeholder="Escribe o escanea…" autocomplete="off" />${datalistVariantes('tr-skus', variantes)}</div>
                <div id="tr-disp" class="op-hint"></div>
                <div class="op-row">
                  <div class="form-group"><label class="form-label" for="tr-cant">Pares *</label><input id="tr-cant" type="number" min="1" class="form-input" /></div>
                  <button type="button" id="tr-add" class="btn btn-secondary">＋ Agregar</button>
                </div>
              </div>
              <div id="tr-lineas"></div>
              <div class="form-group"><label class="form-label" for="tr-obs">Observación</label><input id="tr-obs" class="form-input" placeholder="Opcional" /></div>
              <button type="submit" id="tr-enviar" class="btn btn-primary" style="justify-content:center;padding:14px;">Enviar traslado</button>
            </form>
          </div>

          <div class="card op-card">
            <div class="op-tabs">
              <button type="button" class="btn btn-sm btn-primary tr-tab" data-tab="recibir">Por recibir (<span id="tr-n-recibir">0</span>)</button>
              <button type="button" class="btn btn-sm btn-secondary tr-tab" data-tab="novedades">Novedades (<span id="tr-n-novedad">0</span>)</button>
              <button type="button" class="btn btn-sm btn-secondary tr-tab" data-tab="todos">Historial</button>
            </div>
            <div id="tr-filtro-sede" class="form-group" style="max-width:260px;margin-bottom:8px;">
              <label class="form-label" for="tr-sede-dest">Mi sede</label>
              <select id="tr-sede-dest" class="form-select"><option value="">Todas las sedes</option>${opts(ubicaciones)}</select>
            </div>
            <div id="tr-lista" class="op-list"></div>
          </div>
        </div>
      </div></main>
    </div>`);

  attachSidebarLogout();
  renderLineas();
  renderTraslados();

  document.getElementById('tr-origen').addEventListener('change', () => { lineas = []; renderLineas(); actualizarDisponible(); });
  document.getElementById('tr-sku').addEventListener('input', actualizarDisponible);
  document.getElementById('tr-add').addEventListener('click', agregarLinea);
  document.getElementById('tr-cant').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregarLinea(); } });
  document.getElementById('tr-lineas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (b) { lineas.splice(+b.dataset.quitar, 1); renderLineas(); }
  });
  document.getElementById('tr-form').addEventListener('submit', enviar);
  document.getElementById('tr-sede-dest').addEventListener('change', (e) => { sedeDestino = e.target.value; renderTraslados(); });
  document.querySelectorAll('.tr-tab').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.tr-tab').forEach((x) => x.classList.replace('btn-primary', 'btn-secondary'));
    btn.classList.replace('btn-secondary', 'btn-primary');
    tab = btn.dataset.tab;
    renderTraslados();
  }));

  const listaEl = document.getElementById('tr-lista');
  listaEl.addEventListener('click', async (e) => {
    const rec = e.target.closest('[data-recibir]');
    if (rec) { abiertoId = Number(rec.dataset.recibir); renderTraslados(); return; }
    if (e.target.closest('[data-cerrar]')) { abiertoId = null; renderTraslados(); return; }
    const rev = e.target.closest('[data-revisar]');
    if (rev) {
      const comentario = prompt('¿Qué se hizo con la novedad? (p. ej. reclamo a transportadora, ajuste aprobado)');
      if (!comentario?.trim()) return;
      try {
        await revisarNovedad(rev.dataset.revisar, comentario);
        showToast('Novedad marcada como revisada.', 'success');
        await recargar();
      } catch (err) { showToast(err.message, 'error'); }
    }
  });
  listaEl.addEventListener('input', (e) => {
    const form = e.target.closest('.tr-recibir-form');
    if (!form) return;
    const faltan = [...form.querySelectorAll('[data-variante]')].reduce((a, i) => a + Number(i.dataset.enviada) - (parseInt(i.value, 10) || 0), 0);
    form.querySelector('.tr-dif').innerHTML = faltan > 0 ? `<div class="op-alert">Faltan ${faltan} par(es): quedará una novedad para revisión del jefe de bodega.</div>` : '';
  });
  listaEl.addEventListener('submit', (e) => {
    if (!e.target.classList.contains('tr-recibir-form')) return;
    e.preventDefault();
    confirmarRecepcion(e.target);
  });
};
