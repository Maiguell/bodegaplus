/**
 * @module sidebar
 * @description Componente compartido del sidebar de navegación.
 * Genera el markup del sidebar y conecta el botón de logout.
 * Se importa desde todas las vistas protegidas para evitar duplicación.
 */

import { getUser, logout } from '../services/authService.js';

/**
 * Genera el HTML del sidebar con el nav-item activo marcado.
 * @param {string} [activeRoute='dashboard'] - Identificador de la ruta activa.
 * @returns {string} Markup HTML del sidebar completo.
 */
export const buildSidebar = (activeRoute = 'dashboard') => {
  const user = getUser();
  const initials = user?.nombre
    ? user.nombre.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'AD';

  /** @type {Array<{route: string, label: string, icon: string}>} */
  const navItems = [
    { route: 'dashboard',   label: 'Dashboard',   icon: '⊞' },
    { route: 'catalogo',    label: 'Catálogo',    icon: '👟' },
    { route: 'inventario',  label: 'Inventario',  icon: '📦' },
    { route: 'movimientos', label: 'Movimientos', icon: '↕️' },
    { route: 'reportes',    label: 'Reportes',    icon: '📊' },
  ];

  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand-icon">👟</div>
        <div>
          <div class="sidebar-brand-name">Sneakers</div>
          <div class="sidebar-brand-sub">Bodega & Locales</div>
        </div>
      </div>

      <nav class="sidebar-nav" aria-label="Navegación principal">
        <div class="sidebar-section-label">Menú Principal</div>
        ${navItems.map(item => `
          <a href="#/${item.route}"
             class="nav-item ${activeRoute === item.route ? 'active' : ''}"
             aria-current="${activeRoute === item.route ? 'page' : 'false'}">
            <span aria-hidden="true">${item.icon}</span>
            ${item.label}
          </a>
        `).join('')}
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-avatar" aria-hidden="true">${initials}</div>
        <div>
          <div class="sidebar-user-name">${user?.nombre ?? 'Administrador'}</div>
          <div class="sidebar-user-role">${user?.rol ?? 'Admin'}</div>
        </div>
        <button id="sidebar-logout-btn" class="sidebar-logout" title="Cerrar sesión" aria-label="Cerrar sesión">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </aside>
  `;
};

/**
 * Conecta el listener de logout al botón del sidebar.
 * Debe llamarse después de que el sidebar se haya renderizado en el DOM.
 * @returns {void}
 */
export const attachSidebarLogout = () => {
  document.getElementById('sidebar-logout-btn')?.addEventListener('click', logout);
};
