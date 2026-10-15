/**
 * @module toast
 * @description Utilidad para mostrar notificaciones tipo toast en la UI.
 * Crea el contenedor si no existe y auto-destruye los toasts luego de 3.5s.
 */

/**
 * Muestra una notificación toast.
 * @param {string} message - Mensaje a mostrar.
 * @param {'success'|'error'|'info'} [type='info'] - Tipo visual del toast.
 * @param {number} [duration=3500] - Duración en ms antes de desaparecer.
 * @returns {void}
 */
export const showToast = (message, type = 'info', duration = 3500) => {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.classList.add('toast', `toast-${type}`);
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    setTimeout(() => toast.remove(), 320);
  }, duration);
};
