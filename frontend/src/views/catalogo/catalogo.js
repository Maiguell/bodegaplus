/**
 * @module catalogoView
 * @description Catálogo de referencias:
 *   HU01 — Nueva referencia con su matriz de colores × tallas (SKU y código de barras automáticos)
 *   HU02 — Importar catálogo desde la plantilla CSV, con reporte de filas rechazadas
 *   HU03 — Ubicación física (estantería-nivel) de la referencia en cada sede
 *   HU04 — Acceso directo a sus etiquetas
 */

import './catalogo.css';
import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { abrirModal } from '../../components/modal.js';
import { puede, sedesOperables } from '../../services/authService.js';
import {
  getCatalogo, getModelos, updateModelo, deleteModelo, crearVariantes, crearReferencia,
  importarCatalogo, descargarPlantilla, getUbicacionesBodega, crearUbicacionBodega, asignarUbicacion,
} from '../../services/catalogoService.js';
import { showToast } from '../../utils/toast.js';
import { esc, moneda, numero, tallaLabel } from '../../utils/format.js';

const GENEROS = { HOMBRE: 'Hombre', MUJER: 'Mujer', UNISEX: 'Unisex', NINO: 'Niño/a' };

/** @type {Array<object>} */ let modelos = [];
/** @type {object} listas de apoyo (marcas, categorías, colores, tallas…) */ let catalogo = {};
/** Permiso del rol (HU19); el backend valida de nuevo. */
const esAdmin = () => puede('catalogo.editar');

// ── Tabla ───────────────────────────────────────────────────────────────────

const buildRow = (m) => `
  <tr>
    <td style="font-weight:600;color:var(--clr-text-primary);">${esc(m.marca)} ${esc(m.nombre)}</td>
    <td>${esc(m.categoria)}</td>
    <td>${GENEROS[m.genero] ?? m.genero}</td>
    <td>${m.codigoEstilo ? `<span class="product-sku">${esc(m.codigoEstilo)}</span>` : '—'}</td>
    <td>${moneda(m.precioBase)}</td>
    <td>${m.variantes}</td>
    <td style="font-weight:700;">${numero(m.pares)}</td>
    <td class="op-item-meta">${(m.ubicacionesFisicas ?? []).map((u) => `${esc(u.sede)}: <strong>${esc(u.codigo)}</strong>`).join('<br>') || '—'}</td>
    <td class="action-buttons">
      <a class="btn btn-sm btn-secondary" href="#/inventario?modelo=${m.id}">Stock</a>
      ${puede('etiquetas') ? `<a class="btn btn-sm btn-secondary" href="#/etiquetas?modelo=${m.id}">Etiquetas</a>` : ''}
      ${puede('movimientos.bodega') ? `<button class="btn btn-sm btn-secondary" data-act="ubicacion" data-id="${m.id}">Ubicación</button>` : ''}
      ${esAdmin() ? `
        <button class="btn btn-sm btn-secondary" data-act="variantes" data-id="${m.id}">＋ Variantes</button>
        <button class="btn btn-sm btn-secondary" data-act="editar" data-id="${m.id}">Editar</button>
        <button class="btn btn-sm btn-danger" data-act="eliminar" data-id="${m.id}">Eliminar</button>` : ''}
    </td>
  </tr>`;

const renderTable = (lista) => {
  const tbody = document.getElementById('modelos-tbody');
  if (!tbody) return;
  tbody.innerHTML = lista.length
    ? lista.map(buildRow).join('')
    : `<tr><td colspan="9"><div class="empty-state">
         <div class="empty-state-title">Sin referencias</div>
         <div class="empty-state-desc">No se encontraron referencias con ese criterio.</div></div></td></tr>`;
};

const filtrar = () => {
  const q = document.getElementById('search-input')?.value.toLowerCase().trim() ?? '';
  renderTable(!q ? modelos : modelos.filter((m) =>
    `${m.marca} ${m.nombre} ${m.categoria} ${m.codigoEstilo ?? ''}`.toLowerCase().includes(q)));
};

const cargar = async () => {
  try {
    [modelos, catalogo] = await Promise.all([getModelos(), getCatalogo()]);
    filtrar();
  } catch (err) {
    showToast(err.message ?? 'Error al cargar el catálogo.', 'error');
    renderTable([]);
  }
};

// ── Modales ─────────────────────────────────────────────────────────────────

const opciones = (lista, sel) =>
  lista.map((o) => `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('');

const tallasDe = (genero) => catalogo.tallas.filter((t) => genero === 'UNISEX' ? t.genero === 'UNISEX' : t.genero === genero || t.genero === 'UNISEX');

const pickerColores = () => `<div class="talla-picker">${catalogo.colores.map((c) =>
  `<label class="talla-chip"><input type="checkbox" name="color" value="${c.id}" /><span style="display:inline-block;width:10px;height:10px;border:1px solid #333;background:${esc(c.hex ?? '#ccc')};margin-right:4px;"></span>${esc(c.nombre)}</label>`).join('')}</div>`;

const pickerTallas = (genero) => {
  const ts = tallasDe(genero);
  return ts.length ? ts.map((t) => `<label class="talla-chip"><input type="checkbox" name="talla" value="${t.id}" />${tallaLabel(t)}</label>`).join('')
    : '<span style="color:var(--clr-text-muted);">No hay tallas para este género (agrégalas en Parámetros).</span>';
};

/** Cuenta en vivo cuántas variantes se crearán (colores × tallas). */
const contador = (overlay) => {
  const n = () => overlay.querySelectorAll('input[name=color]:checked').length * overlay.querySelectorAll('input[name=talla]:checked').length;
  const el = overlay.querySelector('[data-conteo]');
  const act = () => { el.textContent = `${n()} variante(s) se crearán, cada una con su SKU y código de barras.`; };
  overlay.addEventListener('change', act); act();
};

/** HU01: referencia + matriz de variantes en una sola operación. */
const abrirModalReferencia = () => {
  const { overlay, close } = abrirModal('Nueva referencia', `
    <form class="modal-form" novalidate>
      <div class="modal-form-row">
        <div class="form-group"><label class="form-label">Marca *</label><select class="form-select" name="marcaId">${opciones(catalogo.marcas)}</select></div>
        <div class="form-group"><label class="form-label">Categoría *</label><select class="form-select" name="categoriaId">${opciones(catalogo.categorias)}</select></div>
      </div>
      <div class="form-group"><label class="form-label">Nombre de la referencia *</label><input class="form-input" name="nombre" placeholder="Tenis Urbano 2045" /></div>
      <div class="modal-form-row">
        <div class="form-group"><label class="form-label">Género</label>
          <select class="form-select" name="genero">${Object.entries(GENEROS).map(([k, v]) => `<option value="${k}" ${k === 'UNISEX' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Código de estilo</label><input class="form-input" name="codigoEstilo" /></div>
      </div>
      <div class="modal-form-row">
        <div class="form-group"><label class="form-label">Precio de venta *</label><input type="number" min="0" class="form-input" name="precioBase" /></div>
        <div class="form-group"><label class="form-label">Costo</label><input type="number" min="0" class="form-input" name="costo" /></div>
      </div>
      <div class="form-group"><label class="form-label">Colores *</label>${pickerColores()}</div>
      <div class="form-group"><label class="form-label">Tallas * <a href="#" data-todas style="text-transform:none;margin-left:8px;">marcar todas</a></label>
        <div class="talla-picker" data-tallas>${pickerTallas('UNISEX')}</div></div>
      <p class="op-hint" data-conteo></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Crear referencia</button>
      </div>
    </form>`);
  const form = overlay.querySelector('form');
  form.genero.addEventListener('change', () => { overlay.querySelector('[data-tallas]').innerHTML = pickerTallas(form.genero.value); overlay.dispatchEvent(new Event('change')); });
  overlay.querySelector('[data-todas]').addEventListener('click', (e) => { e.preventDefault(); overlay.querySelectorAll('input[name=talla]').forEach((c) => (c.checked = true)); overlay.dispatchEvent(new Event('change')); });
  contador(overlay);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const colorIds = [...overlay.querySelectorAll('input[name=color]:checked')].map((c) => +c.value);
    const tallaIds = [...overlay.querySelectorAll('input[name=talla]:checked')].map((c) => +c.value);
    if (!f.nombre.trim()) return showToast('El nombre es obligatorio.', 'error');
    if (!(+f.precioBase > 0)) return showToast('Indica el precio de venta.', 'error');
    if (!colorIds.length || !tallaIds.length) return showToast('Selecciona al menos un color y una talla.', 'error');
    try {
      const r = await crearReferencia({ ...f, marcaId: +f.marcaId, categoriaId: +f.categoriaId, precioBase: +f.precioBase,
        costo: f.costo === '' ? undefined : +f.costo, colorIds, tallaIds });
      showToast(`${r.marca} ${r.nombre}: ${r.creadas} variante(s) creada(s).`, 'success');
      close();
      await cargar();
    } catch (err) { showToast(err.message, 'error'); }
  });
};

const abrirModalEditar = (m) => {
  const { overlay, close } = abrirModal('Editar referencia', `
    <form class="modal-form" novalidate>
      <div class="modal-form-row">
        <div class="form-group"><label class="form-label">Marca *</label><select class="form-select" name="marcaId">${opciones(catalogo.marcas, m.marcaId)}</select></div>
        <div class="form-group"><label class="form-label">Categoría *</label><select class="form-select" name="categoriaId">${opciones(catalogo.categorias, m.categoriaId)}</select></div>
      </div>
      <div class="form-group"><label class="form-label">Nombre *</label><input class="form-input" name="nombre" value="${esc(m.nombre)}" /></div>
      <div class="modal-form-row">
        <div class="form-group"><label class="form-label">Género</label>
          <select class="form-select" name="genero">${Object.entries(GENEROS).map(([k, v]) => `<option value="${k}" ${k === m.genero ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Código de estilo</label><input class="form-input" name="codigoEstilo" value="${esc(m.codigoEstilo)}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Precio base (COP)</label><input type="number" min="0" class="form-input" name="precioBase" value="${m.precioBase ?? 0}" /></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar cambios</button>
      </div>
    </form>`);
  overlay.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.nombre.trim()) return showToast('El nombre es obligatorio.', 'error');
    try {
      await updateModelo(m.id, { ...f, marcaId: +f.marcaId, categoriaId: +f.categoriaId, precioBase: +f.precioBase });
      showToast('Referencia actualizada.', 'success');
      close();
      await cargar();
    } catch (err) { showToast(err.message, 'error'); }
  });
};

const abrirModalVariantes = (m) => {
  const { overlay, close } = abrirModal(`＋ Variantes · ${esc(m.marca)} ${esc(m.nombre)}`, `
    <form class="modal-form" novalidate>
      <div class="form-group"><label class="form-label">Colores *</label>${pickerColores()}</div>
      <div class="form-group">
        <label class="form-label">Tallas * <a href="#" data-todas style="text-transform:none;margin-left:8px;">marcar todas</a></label>
        <div class="talla-picker">${pickerTallas(m.genero)}</div>
      </div>
      <p class="op-hint" data-conteo></p>
      <p style="font-size:var(--fs-small);color:var(--clr-text-muted);">Las variantes que ya existen se omiten.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Crear variantes</button>
      </div>
    </form>`);
  overlay.querySelector('[data-todas]').addEventListener('click', (e) => { e.preventDefault(); overlay.querySelectorAll('input[name=talla]').forEach((c) => (c.checked = true)); overlay.dispatchEvent(new Event('change')); });
  contador(overlay);
  overlay.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const colorIds = [...overlay.querySelectorAll('input[name=color]:checked')].map((c) => +c.value);
    const tallaIds = [...overlay.querySelectorAll('input[name=talla]:checked')].map((c) => +c.value);
    if (!colorIds.length || !tallaIds.length) return showToast('Selecciona al menos un color y una talla.', 'error');
    try {
      const r = await crearVariantes(m.id, { colorIds, tallaIds });
      showToast(`${r.creadas} variante(s) creada(s)${r.omitidas ? `, ${r.omitidas} ya existían` : ''}.`, 'success');
      close();
      await cargar();
    } catch (err) { showToast(err.message, 'error'); }
  });
};

/** HU02: importar la plantilla CSV y mostrar el reporte. */
const abrirModalImportar = () => {
  const { overlay } = abrirModal('Importar catálogo', `
    <form class="op-form" id="imp-form" novalidate>
      <p class="op-item-meta">Columnas: marca, categoría, referencia, género, código de estilo, colores (separados por |), tallas (36-42 o 38|39|40), costo y precio.
        Excel: <em>Guardar como → CSV (delimitado por comas o punto y coma)</em>.</p>
      <button type="button" id="imp-plantilla" class="btn btn-secondary btn-sm" style="align-self:flex-start;">Descargar plantilla</button>
      <div class="form-group"><label class="form-label" for="imp-archivo">Archivo CSV *</label><input id="imp-archivo" type="file" accept=".csv,text/csv" class="form-input" /></div>
      <p id="imp-info" class="op-hint"></p>
      <button type="submit" class="btn btn-primary" style="justify-content:center;">Importar</button>
      <div id="imp-reporte"></div>
    </form>`);
  let texto = '';
  overlay.querySelector('#imp-plantilla').addEventListener('click', () => descargarPlantilla().catch((err) => showToast(err.message, 'error')));
  overlay.querySelector('#imp-archivo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 4_000_000) { showToast('El archivo supera 4 MB.', 'error'); e.target.value = ''; return; }
    texto = await f.text();
    overlay.querySelector('#imp-info').textContent = `${f.name}: ${texto.split(/\r?\n/).filter((l) => l.trim()).length - 1} fila(s) de datos.`;
  });
  overlay.querySelector('#imp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!texto) return showToast('Selecciona el archivo CSV.', 'error');
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Importando…';
    try {
      const r = await importarCatalogo(texto);
      overlay.querySelector('#imp-reporte').innerHTML = `
        <div class="op-alert" style="border-color:${r.rechazadas.length ? 'var(--clr-warning)' : 'var(--clr-success)'};">
          ${r.total} fila(s): <strong>${r.creadas}</strong> referencia(s) nueva(s), <strong>${r.actualizadas}</strong> actualizada(s),
          <strong>${r.variantes}</strong> variante(s) creada(s), <strong>${r.rechazadas.length}</strong> rechazada(s).</div>
        ${r.rechazadas.length ? `<div style="overflow-x:auto;max-height:240px;"><table class="data-table"><thead><tr><th>Fila</th><th>Referencia</th><th>Motivo</th></tr></thead><tbody>
          ${r.rechazadas.map((x) => `<tr><td>${x.fila}</td><td>${esc(x.referencia)}</td><td>${esc(x.motivo)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
      showToast('Importación terminada.', r.rechazadas.length ? 'info' : 'success');
      await cargar();
    } catch (err) { showToast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Importar'; }
  });
};

/** HU03: asignar la ubicación física de la referencia en una sede. */
const abrirModalUbicacion = (m) => {
  const sedes = sedesOperables(catalogo.ubicaciones);
  const { overlay, close } = abrirModal(`Ubicación · ${esc(m.marca)} ${esc(m.nombre)}`, `
    <form class="op-form" id="ub-form" novalidate>
      <div class="form-group"><label class="form-label">Sede</label><select id="ub-sede" class="form-select">${opciones(sedes)}</select></div>
      <div class="form-group"><label class="form-label">Ubicación (bodega-estantería-nivel)</label><select id="ub-sel" class="form-select"></select></div>
      <div class="op-row">
        <div class="form-group" style="flex:2;"><input id="ub-nueva" class="form-input" placeholder="Nueva, ej. B1-E3-N2" /></div>
        <button type="button" id="ub-crear" class="btn btn-secondary">Crear</button>
      </div>
      <button type="submit" class="btn btn-primary" style="justify-content:center;">Guardar</button>
    </form>`);
  const sedeEl = overlay.querySelector('#ub-sede'), sel = overlay.querySelector('#ub-sel');
  const cargarUbic = async (elegir) => {
    const lista = await getUbicacionesBodega(sedeEl.value);
    const actual = (m.ubicacionesFisicas ?? []).find((u) => String(u.sedeId) === sedeEl.value)?.codigo;
    sel.innerHTML = `<option value="">— Sin ubicación —</option>${lista.map((u) => `<option value="${u.id}" ${(elegir ? u.id === elegir : u.codigo === actual) ? 'selected' : ''}>${esc(u.codigo)}</option>`).join('')}`;
  };
  sedeEl.addEventListener('change', () => cargarUbic());
  overlay.querySelector('#ub-crear').addEventListener('click', async () => {
    try {
      const u = await crearUbicacionBodega(Number(sedeEl.value), overlay.querySelector('#ub-nueva').value);
      overlay.querySelector('#ub-nueva').value = '';
      await cargarUbic(u.id);
      showToast(`Ubicación ${u.codigo} creada en ${u.sede}.`, 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });
  overlay.querySelector('#ub-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await asignarUbicacion(m.id, Number(sedeEl.value), sel.value ? Number(sel.value) : null);
      showToast(r.codigo ? `Ubicación ${r.codigo} asignada.` : 'Ubicación retirada.', 'success');
      close();
      await cargar();
    } catch (err) { showToast(err.message, 'error'); }
  });
  cargarUbic().catch((err) => showToast(err.message, 'error'));
};

// ── Inicializador ───────────────────────────────────────────────────────────

export const initCatalogo = async () => {
  renderView(`
    <div class="app-shell">
      ${buildSidebar('catalogo')}
      <main class="main-content">
        <div class="page-wrapper">
          <header class="page-header">
            <div>
              <h1 class="page-title">Catálogo</h1>
              <p class="page-subtitle">Referencias y sus variantes por color y talla, con SKU y código de barras.</p>
            </div>
            ${esAdmin() ? `<div class="op-item-actions">
              <button id="btn-importar" class="btn btn-secondary">Importar catálogo</button>
              <button id="btn-nuevo" class="btn btn-primary">+ Nueva referencia</button></div>` : ''}
          </header>

          <div class="toolbar">
            <div class="search-bar" style="max-width:420px;flex:1;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" id="search-input" placeholder="Buscar por marca, referencia o código…" />
            </div>
          </div>

          <div class="table-container card">
            <table class="data-table">
              <thead><tr><th>Referencia</th><th>Categoría</th><th>Género</th><th>Estilo</th><th>Precio base</th><th>Variantes</th><th>Pares</th><th>Ubicación</th><th>Acciones</th></tr></thead>
              <tbody id="modelos-tbody"><tr><td colspan="9"><div class="loader-container"><div class="spinner"></div> Cargando…</div></td></tr></tbody>
            </table>
          </div>
        </div>
      </main>
    </div>`);

  attachSidebarLogout();
  await cargar();

  document.getElementById('search-input')?.addEventListener('input', filtrar);
  document.getElementById('btn-nuevo')?.addEventListener('click', abrirModalReferencia);
  document.getElementById('btn-importar')?.addEventListener('click', abrirModalImportar);

  document.getElementById('modelos-tbody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const m = modelos.find((x) => x.id === +btn.dataset.id);
    if (btn.dataset.act === 'editar') return abrirModalEditar(m);
    if (btn.dataset.act === 'variantes') return abrirModalVariantes(m);
    if (btn.dataset.act === 'ubicacion') return abrirModalUbicacion(m);
    if (btn.dataset.act === 'eliminar') {
      if (!confirm(`¿Eliminar "${m.marca} ${m.nombre}"? Debe tener el stock en cero.`)) return;
      try { await deleteModelo(m.id); showToast('Referencia eliminada.', 'success'); await cargar(); }
      catch (err) { showToast(err.message, 'error'); }
    }
  });
};
