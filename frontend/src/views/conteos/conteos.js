/**
 * @module conteosView
 * @description HU12 — Conteo físico por sede.
 * Al iniciar se congela el saldo del sistema; se captura con el lector (cada lectura suma 1) o a mano;
 * al cerrar se muestran las diferencias por variante y se genera el ajuste propuesto para aprobación.
 */

import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { abrirModal } from '../../components/modal.js';
import { getUser } from '../../services/authService.js';
import { getCatalogo } from '../../services/catalogoService.js';
import { getConteos, getConteo, iniciarConteo, capturarConteo, cerrarConteo, cancelarConteo } from '../../services/operacionesService.js';
import { showToast } from '../../utils/toast.js';
import { esc, numero, fechaHora, badgeEstado, badgeAjuste } from '../../utils/format.js';

let ubicaciones = [];
let conteos = [];
/** @type {object|null} conteo abierto en el panel (con detalle) */
let actual = null;
let vista = 'todas'; // todas | contadas | pendientes | diferencias
let texto = '';

const esAdmin = () => getUser()?.rol === 'ADMIN';
const dif = (d) => (d.contada === null ? '' : d.contada - d.sistema);

const renderLista = () => {
  document.getElementById('cf-lista').innerHTML = conteos.length ? conteos.map((c) => `
    <div class="op-item">
      <div>
        <div class="op-item-title">${esc(c.codigo)} · ${esc(c.ubicacion)} ${badgeEstado(c.estado)}</div>
        <div class="op-item-meta">Iniciado ${fechaHora(c.fechaInicio)} por ${esc(c.usuario)}${c.fechaCierre ? ` · cerrado ${fechaHora(c.fechaCierre)}` : ''}</div>
        <div class="op-item-meta">${numero(c.contadas)} de ${numero(c.variantes)} variantes contadas · ${numero(c.diferencias)} con diferencia</div>
      </div>
      <div class="op-item-actions"><button type="button" class="btn btn-sm ${c.estado === 'ABIERTO' ? 'btn-primary' : 'btn-secondary'}" data-abrir="${c.id}">${c.estado === 'ABIERTO' ? 'Contar' : 'Ver'}</button></div>
    </div>`).join('')
    : '<div class="empty-state" style="padding:24px;"><div class="empty-state-title">Sin conteos</div></div>';
};

const filasVisibles = () => actual.detalle.filter((d) => {
  if (vista === 'contadas' && d.contada === null) return false;
  if (vista === 'pendientes' && d.contada !== null) return false;
  if (vista === 'diferencias' && (d.contada === null || d.contada === d.sistema)) return false;
  if (!texto) return true;
  // Búsqueda por palabras: "samba blanco 41" o "Samba OG · Blanco" encuentran la variante
  const palabras = texto.toUpperCase().split(/[\s·]+/).filter(Boolean);
  const texto2 = `${d.sku} ${d.marca} ${d.modelo} ${d.color} EU ${d.eu}`.toUpperCase();
  return palabras.every((p) => texto2.includes(p));
});

const renderTabla = () => {
  const abierto = actual.estado === 'ABIERTO';
  const filas = filasVisibles();
  document.getElementById('cf-progreso').textContent =
    `${numero(actual.detalle.filter((d) => d.contada !== null).length)} de ${numero(actual.detalle.length)} contadas · ${numero(actual.detalle.filter((d) => d.contada !== null && d.contada !== d.sistema).length)} con diferencia`;
  document.getElementById('cf-tabla').innerHTML = `
    <table class="data-table"><thead><tr><th>Zapatilla</th><th>Sistema</th><th>Contado</th><th>Diferencia</th></tr></thead><tbody>
    ${filas.slice(0, 300).map((d) => {
      const df = dif(d);
      return `<tr>
        <td>${esc(d.marca)} ${esc(d.modelo)} · ${esc(d.color)} · EU ${d.eu}<br><span class="product-sku">${esc(d.sku)}</span></td>
        <td>${d.sistema}</td>
        <td>${abierto ? `<input type="number" min="0" class="form-input op-input-sm" data-var="${d.varianteId}" value="${d.contada ?? ''}" placeholder="—" />` : (d.contada ?? '—')}</td>
        <td class="${df > 0 ? 'kardex-pos' : df < 0 ? 'kardex-neg' : ''}">${df === '' ? '' : df > 0 ? `+${df}` : df}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--clr-text-muted);">Nada que mostrar</td></tr>'}
    </tbody></table>
    ${filas.length > 300 ? `<p class="op-hint">Mostrando 300 de ${filas.length}. Usa el buscador para acotar.</p>` : ''}`;
};

const renderPanel = (resultado) => {
  const el = document.getElementById('cf-panel');
  if (!actual) {
    el.innerHTML = '<div class="empty-state" style="padding:32px;"><div class="empty-state-title">Selecciona un conteo</div><p class="empty-state-desc">Inicia uno nuevo o abre un conteo en curso.</p></div>';
    return;
  }
  const abierto = actual.estado === 'ABIERTO';
  el.innerHTML = `
    <div class="kardex-head">
      <div><h2 class="section-title" style="margin:0;">${esc(actual.codigo)} · ${esc(actual.ubicacion)} ${badgeEstado(actual.estado)}</h2>
        <div class="op-item-meta" id="cf-progreso"></div></div>
      ${abierto && esAdmin() ? `<div class="op-item-actions">
        <button type="button" id="cf-cerrar" class="btn btn-sm btn-primary">Cerrar conteo</button>
        <button type="button" id="cf-cancelar" class="btn btn-sm btn-secondary">Cancelar</button></div>` : ''}
    </div>
    ${resultado ?? ''}
    ${abierto ? `
      <div class="op-row" style="margin-bottom:12px;">
        <div class="form-group" style="flex:2;"><label class="form-label" for="cf-scan">Lector de código de barras</label>
          <input id="cf-scan" class="form-input" placeholder="Escanea: cada lectura suma 1 par" autocomplete="off" /></div>
      </div>
      <div id="cf-ultimo" class="op-hint" style="margin-bottom:8px;"></div>` : ''}
    <div class="op-row" style="margin-bottom:12px;">
      <div class="form-group" style="flex:2;"><label class="form-label" for="cf-buscar">Buscar</label>
        <input id="cf-buscar" class="form-input" placeholder="SKU, modelo, color o talla" value="${esc(texto)}" /></div>
      <div class="form-group"><label class="form-label" for="cf-vista">Mostrar</label>
        <select id="cf-vista" class="form-select">
          ${[['todas', 'Todas'], ['pendientes', 'Sin contar'], ['contadas', 'Contadas'], ['diferencias', 'Con diferencia']]
            .map(([k, v]) => `<option value="${k}" ${vista === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
    </div>
    <div id="cf-tabla" style="overflow-x:auto;"></div>`;
  renderTabla();

  document.getElementById('cf-buscar').addEventListener('input', (e) => { texto = e.target.value.trim(); renderTabla(); });
  document.getElementById('cf-vista').addEventListener('change', (e) => { vista = e.target.value; renderTabla(); });
  if (!abierto) return;

  const scan = document.getElementById('cf-scan');
  scan.focus();
  scan.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const codigo = scan.value.trim();
    scan.value = '';
    if (!codigo) return;
    try {
      const { capturadas: [d] } = await capturarConteo(actual.id, [{ codigo, cantidad: 1, modo: 'sumar' }]);
      actualizarFila(d);
      document.getElementById('cf-ultimo').innerHTML = `✓ ${esc(d.marca)} ${esc(d.modelo)} · ${esc(d.color)} · EU ${d.eu} — contados: <strong>${d.contada}</strong>`;
    } catch (err) {
      document.getElementById('cf-ultimo').innerHTML = `<span class="kardex-neg">✕ ${esc(err.message)}</span>`;
    }
  });
  document.getElementById('cf-tabla').addEventListener('change', async (e) => {
    const input = e.target.closest('[data-var]');
    if (!input || input.value === '') return;
    const cantidad = parseInt(input.value, 10);
    if (!Number.isInteger(cantidad) || cantidad < 0) return showToast('Cantidad inválida.', 'error');
    try {
      const { capturadas: [d] } = await capturarConteo(actual.id, [{ varianteId: Number(input.dataset.var), cantidad, modo: 'fijar' }]);
      actualizarFila(d, false);
    } catch (err) { showToast(err.message, 'error'); }
  });
  document.getElementById('cf-cerrar')?.addEventListener('click', cerrar);
  document.getElementById('cf-cancelar')?.addEventListener('click', async () => {
    if (!confirm('¿Cancelar el conteo? Lo capturado se descarta.')) return;
    try { await cancelarConteo(actual.id); actual = null; renderPanel(); await recargarLista(); } catch (err) { showToast(err.message, 'error'); }
  });
};

/** Actualiza la fila capturada sin redibujar todo (para no perder el foco). */
const actualizarFila = (d, redibujar = true) => {
  const fila = actual.detalle.find((x) => x.varianteId === d.varianteId);
  if (fila) fila.contada = d.contada;
  else actual.detalle.push({ ...d });
  if (redibujar) renderTabla(); else {
    const pendientes = actual.detalle.filter((x) => x.contada !== null).length;
    document.getElementById('cf-progreso').textContent = `${numero(pendientes)} de ${numero(actual.detalle.length)} contadas`;
    const td = document.querySelector(`[data-var="${d.varianteId}"]`)?.closest('tr')?.lastElementChild;
    if (td) { const df = d.contada - d.sistema; td.className = df > 0 ? 'kardex-pos' : df < 0 ? 'kardex-neg' : ''; td.textContent = df > 0 ? `+${df}` : String(df); }
  }
};

/** Modal de cierre: qué hacer con las variantes sin contar (por defecto, ignorarlas). */
const cerrar = () => {
  const sinContar = actual.detalle.filter((d) => d.contada === null);
  const conSaldo = sinContar.filter((d) => d.sistema > 0);
  const { overlay, close } = abrirModal('Cerrar conteo', `
    <form id="cf-cierre" class="op-form" novalidate>
      <p class="op-item-meta">Se compararán las cantidades contadas con el saldo congelado y se generará un ajuste
        <strong>pendiente de aprobación</strong> con las diferencias.</p>
      ${sinContar.length ? `
        <div class="op-alert">Hay <strong>${sinContar.length}</strong> variante(s) sin contar${conSaldo.length ? ` (${conSaldo.length} con existencias en el sistema, ${numero(conSaldo.reduce((s, d) => s + d.sistema, 0))} pares)` : ''}.</div>
        <label style="display:flex;gap:8px;align-items:flex-start;"><input type="radio" name="nc" value="ignorar" checked />
          <span><strong>Ignorarlas</strong> — no se ajustan (conteo parcial).</span></label>
        <label style="display:flex;gap:8px;align-items:flex-start;"><input type="radio" name="nc" value="cero" />
          <span><strong>Considerarlas en 0</strong> — no se encontraron; se propone restar su saldo.</span></label>` : '<p class="op-hint">Todas las variantes fueron contadas.</p>'}
      <button type="submit" class="btn btn-primary" style="justify-content:center;">Cerrar y generar ajustes</button>
    </form>`);
  overlay.querySelector('#cf-cierre').addEventListener('submit', (e) => {
    e.preventDefault();
    const enCero = overlay.querySelector('input[name="nc"]:checked')?.value === 'cero';
    close();
    confirmarCierre(enCero);
  });
};

const confirmarCierre = async (enCero) => {
  try {
    const r = await cerrarConteo(actual.id, enCero);
    actual = r.conteo;
    vista = 'diferencias';
    const resultado = r.ajuste
      ? `<div class="op-alert" style="margin-bottom:12px;">Se generó el ajuste <strong>${esc(r.ajuste.codigo)}</strong> ${badgeAjuste(r.ajuste.estado)} con ${r.ajuste.lineas.length} diferencia(s), neto ${r.ajuste.neto > 0 ? '+' : ''}${r.ajuste.neto} pares.
         <a href="#/ajustes">Ir a aprobarlo →</a></div>`
      : '<div class="op-alert" style="border-color:var(--clr-success);margin-bottom:12px;">✓ Sin diferencias: lo contado coincide con el sistema.</div>';
    renderPanel(resultado);
    await recargarLista();
  } catch (err) { showToast(err.message, 'error'); }
};

const recargarLista = async () => { conteos = await getConteos(); renderLista(); };

const abrir = async (id) => {
  try { actual = await getConteo(id); vista = actual.estado === 'ABIERTO' ? 'todas' : 'diferencias'; texto = ''; renderPanel(); }
  catch (err) { showToast(err.message, 'error'); }
};

export const initConteos = async () => {
  renderView(`<div class="app-shell">${buildSidebar('conteos')}<main class="main-content"><div class="page-wrapper">
    <div class="loader-container"><div class="spinner"></div> Cargando…</div></div></main></div>`);
  try {
    const [cat, cs] = await Promise.all([getCatalogo(), getConteos()]);
    ubicaciones = cat.ubicaciones; conteos = cs;
  } catch (err) { showToast(err.message ?? 'Error al cargar datos.', 'error'); }
  actual = null;

  renderView(`
    <div class="app-shell">
      ${buildSidebar('conteos')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header"><div>
          <h1 class="page-title">Conteo físico</h1>
          <p class="page-subtitle">Compara lo contado con lo que dice el sistema y genera los ajustes para aprobación.</p>
        </div></header>
        <div class="op-layout">
          <div>
            ${esAdmin() ? `<div class="card op-card">
              <h2 class="section-title">Iniciar conteo</h2>
              <form id="cf-form" class="op-form" novalidate>
                <div class="form-group"><label class="form-label" for="cf-sede">Sede *</label>
                  <select id="cf-sede" class="form-select">${ubicaciones.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}</select></div>
                <div class="form-group"><label class="form-label" for="cf-obs">Observación</label><input id="cf-obs" class="form-input" placeholder="Opcional" /></div>
                <button type="submit" class="btn btn-primary" style="justify-content:center;">Iniciar y congelar saldos</button>
              </form>
            </div>` : ''}
            <div class="card op-card"><h2 class="section-title">Conteos</h2><div id="cf-lista" class="op-list"></div></div>
          </div>
          <div class="card op-card" id="cf-panel"></div>
        </div>
      </div></main>
    </div>`);

  attachSidebarLogout();
  renderLista();
  renderPanel();
  document.getElementById('cf-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const c = await iniciarConteo(Number(document.getElementById('cf-sede').value), document.getElementById('cf-obs').value);
      showToast(`${c.codigo} iniciado en ${c.ubicacion}: ${numero(c.variantes)} variantes con saldo congelado.`, 'success');
      await recargarLista();
      await abrir(c.id);
    } catch (err) { showToast(err.message, 'error'); }
  });
  document.getElementById('cf-lista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-abrir]');
    if (b) abrir(b.dataset.abrir);
  });
  const abierto = conteos.find((c) => c.estado === 'ABIERTO');
  if (abierto) abrir(abierto.id);
};
