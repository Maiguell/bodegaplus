/**
 * @module modal
 * @description Modal simple reutilizable (mismo marcado que el del catálogo).
 */

/**
 * Abre un modal con título y cuerpo HTML.
 * @param {string} titulo - Texto ya escapado.
 * @param {string} cuerpo - HTML del cuerpo.
 * @returns {{overlay: HTMLElement, close: () => void}}
 */
export const abrirModal = (titulo, cuerpo) => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header"><h3 class="modal-title">${titulo}</h3><button class="modal-close" data-close aria-label="Cerrar">✕</button></div>
      ${cuerpo}
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(overlay);
  return { overlay, close };
};
