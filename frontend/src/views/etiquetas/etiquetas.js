/**
 * @module etiquetasView
 * @description HU04 / HT05 — Etiquetas con el código de barras interno (Code128) de cada variante.
 * Genera un PDF listo para impresora térmica (una etiqueta de 50 × 30 mm por página) con código de barras,
 * referencia, talla, color y precio. Se puede abrir con un modelo (?modelo=) o con lo recibido en una
 * orden de compra (Compras → "Imprimir etiquetas").
 */

import '../../assets/operaciones.css';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { getInventario } from '../../services/catalogoService.js';
import { showToast } from '../../utils/toast.js';
import { esc, moneda, numero } from '../../utils/format.js';
import { buscarVariante, datalistVariantes, descVariante } from '../../utils/variantes.js';

/** Clave de sessionStorage con las etiquetas pendientes de una recepción de compra. */
export const ETIQUETAS_PENDIENTES = 'etiquetas-pendientes';

let variantes = [];
/** @type {Array<{v: object, cantidad: number}>} */
let lista = [];

const total = () => lista.reduce((s, l) => s + l.cantidad, 0);

/** Código de barras en SVG para la vista previa. */
const svgCodigo = (codigo) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, codigo, { format: 'CODE128', height: 40, width: 1.6, fontSize: 12, margin: 4 });
  return svg.outerHTML;
};

const vistaPrevia = (v) => `
  <div style="width:250px;border:1px dashed var(--clr-ink);padding:8px 10px;background:#fff;color:#111;font-family:Arial,sans-serif;">
    <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(v.marca)} ${esc(v.modelo)}</div>
    <div style="display:flex;justify-content:space-between;font-size:12px;"><span>${esc(v.color)} · <strong>EU ${v.eu}</strong></span><strong>${moneda(v.precio)}</strong></div>
    <div style="text-align:center;">${svgCodigo(v.codigoBarras)}</div>
    <div style="font-size:9px;text-align:center;">${esc(v.sku)}</div>
  </div>`;

const render = () => {
  document.getElementById('et-total').textContent = `${numero(total())} etiqueta(s) de ${lista.length} variante(s)`;
  document.getElementById('et-generar').disabled = !lista.length;
  document.getElementById('et-lista').innerHTML = lista.length ? `
    <table class="data-table"><thead><tr><th>Zapatilla</th><th>Código</th><th>Cantidad</th><th></th></tr></thead><tbody>
    ${lista.map((l, i) => `<tr>
      <td>${esc(descVariante(l.v))}<br><span class="product-sku">${esc(l.v.sku)}</span></td>
      <td style="font-family:'Courier New',monospace;">${esc(l.v.codigoBarras)}</td>
      <td><input type="number" min="1" max="500" class="form-input op-input-sm" value="${l.cantidad}" data-cant="${i}" /></td>
      <td><button type="button" class="btn btn-sm btn-danger" data-quitar="${i}">✕</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="op-hint">Agrega variantes por SKU o código de barras, o ábrelas desde el catálogo o una recepción de compra.</p>';
  document.getElementById('et-preview').innerHTML = lista.length ? vistaPrevia(lista[0].v) : '';
};

const agregar = (v, cantidad = 1) => {
  if (!v.codigoBarras) return showToast(`${v.sku} no tiene código de barras asignado.`, 'error');
  const ya = lista.find((l) => l.v.id === v.id);
  if (ya) ya.cantidad += cantidad; else lista.push({ v, cantidad });
};

/** PDF: una etiqueta de 50 × 30 mm por página (formato de rollo de impresora térmica). */
const generarPDF = () => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [30, 50] });
  const canvas = document.createElement('canvas');
  let primera = true;
  for (const { v, cantidad } of lista) {
    JsBarcode(canvas, v.codigoBarras, { format: 'CODE128', height: 60, width: 2, displayValue: true, fontSize: 18, margin: 0 });
    const img = canvas.toDataURL('image/png');
    const titulo = doc.splitTextToSize(`${v.marca} ${v.modelo}`, 46)[0];
    for (let i = 0; i < cantidad; i++) {
      if (!primera) doc.addPage([30, 50], 'landscape');
      primera = false;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.text(titulo, 2, 4.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.text(`${v.color} · EU ${v.eu}`, 2, 8.3);
      doc.setFont('helvetica', 'bold');
      doc.text(moneda(v.precio).replace(/ /g, ' '), 48, 8.3, { align: 'right' });
      doc.addImage(img, 'PNG', 4, 10, 42, 15);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
      doc.text(v.sku, 25, 28, { align: 'center' });
    }
  }
  doc.save(`etiquetas-${new Date().toLocaleDateString('en-CA')}.pdf`);
  showToast(`PDF generado con ${numero(total())} etiqueta(s).`, 'success');
};

/** @param {{modelo?: string}} [params] */
export const initEtiquetas = async (params = {}) => {
  renderView(`<div class="app-shell">${buildSidebar('etiquetas')}<main class="main-content"><div class="page-wrapper">
    <div class="loader-container"><div class="spinner"></div> Cargando…</div></div></main></div>`);
  try { variantes = await getInventario(); } catch (err) { showToast(err.message, 'error'); }
  lista = [];

  // Precarga: lo recibido en una orden de compra o todas las variantes de un modelo
  try {
    const pendientes = JSON.parse(sessionStorage.getItem(ETIQUETAS_PENDIENTES) ?? 'null');
    sessionStorage.removeItem(ETIQUETAS_PENDIENTES);
    for (const p of pendientes ?? []) { const v = variantes.find((x) => x.id === p.varianteId); if (v && p.cantidad > 0) agregar(v, p.cantidad); }
  } catch { /* sin precarga */ }
  if (params.modelo) variantes.filter((v) => String(v.modeloId) === String(params.modelo)).forEach((v) => agregar(v, 1));

  renderView(`
    <div class="app-shell">
      ${buildSidebar('etiquetas')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header"><div>
          <h1 class="page-title">Etiquetas</h1>
          <p class="page-subtitle">Código de barras interno por variante, listo para la impresora térmica (50 × 30 mm).</p>
        </div></header>
        <div class="op-layout">
          <div class="card op-card">
            <h2 class="section-title">Variantes a etiquetar</h2>
            <div class="op-row">
              <div class="form-group" style="flex:2;"><label class="form-label" for="et-sku">SKU o código de barras</label>
                <input id="et-sku" class="form-input" list="et-skus" placeholder="Escribe o escanea…" autocomplete="off" />${datalistVariantes('et-skus', variantes)}</div>
              <div class="form-group" style="max-width:110px;"><label class="form-label" for="et-cant">Cantidad</label><input id="et-cant" type="number" min="1" value="1" class="form-input" /></div>
              <button type="button" id="et-add" class="btn btn-secondary">＋ Agregar</button>
            </div>
            <div id="et-lista" style="margin-top:12px;overflow-x:auto;"></div>
          </div>
          <div class="card op-card">
            <h2 class="section-title">Vista previa</h2>
            <div id="et-preview" style="margin-bottom:16px;"></div>
            <p id="et-total" class="op-item-meta" style="margin-bottom:12px;"></p>
            <button type="button" id="et-generar" class="btn btn-primary" style="width:100%;justify-content:center;padding:14px;">Generar PDF de etiquetas</button>
            <p class="op-hint" style="margin-top:8px;">Código Code128 legible por lectores USB en modo teclado. Imprime a escala 100 %.</p>
          </div>
        </div>
      </div></main>
    </div>`);
  attachSidebarLogout();
  render();

  const add = () => {
    const v = buscarVariante(variantes, document.getElementById('et-sku').value);
    const cant = parseInt(document.getElementById('et-cant').value, 10) || 1;
    if (!v) return showToast('SKU no encontrado.', 'error');
    agregar(v, cant);
    document.getElementById('et-sku').value = '';
    render();
    document.getElementById('et-sku').focus();
  };
  document.getElementById('et-add').addEventListener('click', add);
  document.getElementById('et-sku').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  document.getElementById('et-generar').addEventListener('click', generarPDF);
  const cont = document.getElementById('et-lista');
  cont.addEventListener('change', (e) => {
    const i = e.target.closest('[data-cant]');
    if (i) { lista[+i.dataset.cant].cantidad = Math.min(500, Math.max(1, parseInt(i.value, 10) || 1)); render(); }
  });
  cont.addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (b) { lista.splice(+b.dataset.quitar, 1); render(); }
  });
};
