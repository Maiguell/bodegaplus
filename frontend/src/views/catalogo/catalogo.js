/**
 * @module catalogoView
 * @description Catálogo de modelos de zapatillas. El administrador crea/edita modelos
 * y genera sus variantes (color × tallas) con SKU automático; el operador solo consulta.
 */

import './catalogo.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getUser } from '../../services/authService.js';
import { getCatalogo, getModelos, createModelo, updateModelo, deleteModelo, crearVariantes } from '../../services/catalogoService.js';
import { showToast } from '../../utils/toast.js';
import { esc, moneda, numero, tallaLabel } from '../../utils/format.js';

const GENEROS = { HOMBRE: 'Hombre', MUJER: 'Mujer', UNISEX: 'Unisex', NINO: 'Niño/a' };

/** @type {Array<object>} */ let modelos = [];
/** @type {object} listas de apoyo (marcas, categorías, colores, tallas…) */ let catalogo = {};
const esAdmin = () => getUser()?.rol === 'ADMIN';

// ── Tabla ───────────────────────────────────────────────────────────────────

const buildRow = (m) => `
  <tr>
    <td style="font-weight:500;color:var(--clr-text-primary);">${esc(m.marca)} ${esc(m.nombre)}</td>
    <td>${esc(m.categoria)}</td>
    <td>${GENEROS[m.genero] ?? m.genero}</td>
    <td>${m.codigoEstilo ? `<span class="product-sku">${esc(m.codigoEstilo)}</span>` : '—'}</td>
    <td>${moneda(m.precioBase)}</td>
    <td>${m.variantes}</td>
    <td style="font-weight:700;">${numero(m.pares)}</td>
    <td class="action-buttons">
      <a class="btn btn-sm btn-secondary" href="#/inventario?modelo=${m.id}">📦 Stock</a>
      ${esAdmin() ? `
        <button class="btn btn-sm btn-secondary" data-act="variantes" data-id="${m.id}">＋ Variantes</button>
        <button class="btn btn-sm btn-secondary" data-act="editar" data-id="${m.id}">✏️</button>
        <button class="btn btn-sm btn-danger" data-act="eliminar" data-id="${m.id}">🗑️</button>` : ''}
    </td>
  </tr>`;

const renderTable = (lista) => {
  const tbody = document.getElementById('modelos-tbody');
  if (!tbody) return;
  tbody.innerHTML = lista.length
    ? lista.map(buildRow).join('')
    : `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">👟</div>
         <div class="empty-state-title">Sin modelos</div>
         <div class="empty-state-desc">No se encontraron modelos con ese criterio.</div></div></td></tr>`;
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

/** Crea el overlay del modal y devuelve { overlay, close }. */
const abrirModal = (titulo, cuerpo) => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header"><h3 class="modal-title">${titulo}</h3><button class="modal-close" data-close>✕</button></div>
      ${cuerpo}
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(overlay);
  return { overlay, close };
};

const opciones = (lista, sel) =>
  lista.map((o) => `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('');

const abrirModalModelo = (m = null) => {
  const { overlay, close } = abrirModal(m ? '✏️ Editar modelo' : '➕ Nuevo modelo', `
    <form class="modal-form" novalidate>
      <div class="modal-form-row">
        <div class="form-group"><label class="form-label">Marca *</label>
          <select class="form-select" name="marcaId">${opciones(catalogo.marcas, m?.marcaId)}</select></div>
        <div class="form-group"><label class="form-label">Categoría *</label>
          <select class="form-select" name="categoriaId">${opciones(catalogo.categorias, m?.categoriaId)}</select></div>
      </div>
      <div class="form-group"><label class="form-label">Nombre del modelo *</label>
        <input class="form-input" name="nombre" placeholder="Air Force 1 07" value="${esc(m?.nombre)}" /></div>
      <div class="modal-form-row">
        <div class="form-group"><label class="form-label">Género</label>
          <select class="form-select" name="genero">${Object.entries(GENEROS).map(([k, v]) =>
            `<option value="${k}" ${k === (m?.genero ?? 'UNISEX') ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Código de estilo</label>
          <input class="form-input" name="codigoEstilo" placeholder="CW2288-111" value="${esc(m?.codigoEstilo)}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Precio base (COP)</label>
        <input type="number" min="0" class="form-input" name="precioBase" value="${m?.precioBase ?? 0}" /></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">${m ? 'Guardar cambios' : 'Crear modelo'}</button>
      </div>
    </form>`);

  overlay.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.nombre.trim()) return showToast('El nombre es obligatorio.', 'error');
    try {
      const payload = { ...f, marcaId: +f.marcaId, categoriaId: +f.categoriaId, precioBase: +f.precioBase };
      m ? await updateModelo(m.id, payload) : await createModelo(payload);
      showToast(m ? 'Modelo actualizado.' : 'Modelo creado. Ahora agrega sus variantes.', 'success');
      close();
      await cargar();
    } catch (err) { showToast(err.message, 'error'); }
  });
};

const abrirModalVariantes = (m) => {
  const tallas = catalogo.tallas.filter((t) => m.genero === 'UNISEX' || t.genero === m.genero || t.genero === 'UNISEX');
  const { overlay, close } = abrirModal(`＋ Variantes · ${esc(m.marca)} ${esc(m.nombre)}`, `
    <form class="modal-form" novalidate>
      <div class="form-group"><label class="form-label">Color *</label>
        <select class="form-select" name="colorId">${opciones(catalogo.colores)}</select></div>
      <div class="form-group">
        <label class="form-label">Tallas * <a href="#" data-todas style="text-transform:none;margin-left:8px;">marcar todas</a></label>
        <div class="talla-picker">${tallas.length ? tallas.map((t) =>
          `<label class="talla-chip"><input type="checkbox" name="talla" value="${t.id}" />${tallaLabel(t)}</label>`).join('')
          : '<span style="color:var(--clr-text-muted);">No hay tallas cargadas para este género.</span>'}</div>
      </div>
      <p style="font-size:0.78rem;color:var(--clr-text-muted);">El SKU se genera solo (marca-modelo-color-talla). Las variantes que ya existen se omiten.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Crear variantes</button>
      </div>
    </form>`);

  overlay.querySelector('[data-todas]').addEventListener('click', (e) => {
    e.preventDefault();
    overlay.querySelectorAll('input[name=talla]').forEach((c) => (c.checked = true));
  });
  overlay.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tallaIds = [...overlay.querySelectorAll('input[name=talla]:checked')].map((c) => +c.value);
    if (!tallaIds.length) return showToast('Selecciona al menos una talla.', 'error');
    try {
      const r = await crearVariantes(m.id, { colorId: +e.target.colorId.value, tallaIds });
      showToast(`${r.creadas} variante(s) creada(s)${r.omitidas ? `, ${r.omitidas} ya existían` : ''}.`, 'success');
      close();
      await cargar();
    } catch (err) { showToast(err.message, 'error'); }
  });
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
              <p class="page-subtitle">Modelos de zapatillas y sus variantes por color y talla.</p>
            </div>
            ${esAdmin() ? '<button id="btn-nuevo" class="btn btn-primary">+ Nuevo modelo</button>' : ''}
          </header>

          <div class="toolbar">
            <div class="search-bar" style="max-width:420px;flex:1;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" id="search-input" placeholder="Buscar por marca, modelo o código…" />
            </div>
          </div>

          <div class="table-container card">
            <table class="data-table">
              <thead><tr><th>Modelo</th><th>Categoría</th><th>Género</th><th>Estilo</th><th>Precio base</th><th>Variantes</th><th>Pares</th><th>Acciones</th></tr></thead>
              <tbody id="modelos-tbody"><tr><td colspan="8"><div class="loader-container"><div class="spinner"></div> Cargando…</div></td></tr></tbody>
            </table>
          </div>
        </div>
      </main>
    </div>`);

  attachSidebarLogout();
  await cargar();

  document.getElementById('search-input')?.addEventListener('input', filtrar);
  document.getElementById('btn-nuevo')?.addEventListener('click', () => abrirModalModelo());

  document.getElementById('modelos-tbody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const m = modelos.find((x) => x.id === +btn.dataset.id);
    if (btn.dataset.act === 'editar') return abrirModalModelo(m);
    if (btn.dataset.act === 'variantes') return abrirModalVariantes(m);
    if (btn.dataset.act === 'eliminar') {
      if (!confirm(`¿Eliminar "${m.marca} ${m.nombre}"? Debe tener el stock en cero.`)) return;
      try { await deleteModelo(m.id); showToast('Modelo eliminado.', 'success'); await cargar(); }
      catch (err) { showToast(err.message, 'error'); }
    }
  });
};
