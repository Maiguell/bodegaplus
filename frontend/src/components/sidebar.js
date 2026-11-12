/**
 * @module sidebar
 * @description Menú lateral compartido. Muestra solo las opciones que el rol puede usar (HU19),
 * permite cambiar la contraseña (RNF-05) y avisa cuando se trabaja sin conexión (RNF-07).
 */

import { getUser, logout, puede, cambiarPassword } from '../services/authService.js';
import { estaSinConexion } from '../services/api.js';
import { abrirModal } from './modal.js';
import { showToast } from '../utils/toast.js';
import { esc } from '../utils/format.js';

/**
 * Menú agrupado por secciones. `ver` decide si el rol ve la opción (sin `ver` = todos).
 * Debe coincidir con los permisos que exige el router.
 */
export const SECCIONES = [
  ['Principal', [
    { route: 'dashboard',      label: 'Dashboard' },
    { route: 'catalogo',       label: 'Catálogo' },
    { route: 'inventario',     label: 'Inventario' },
    { route: 'disponibilidad', label: 'Disponibilidad' },
  ]],
  ['Operación', [
    { route: 'movimientos',    label: 'Movimientos',        ver: () => puede('ventas') || puede('movimientos.bodega') },
    { route: 'compras',        label: 'Compras',            ver: () => puede('compras.recibir') || puede('compras.crear') },
    { route: 'traslados',      label: 'Traslados',          ver: () => puede('traslados.enviar') || puede('traslados.recibir') },
    { route: 'tienda',         label: 'Cambios y reservas', ver: () => puede('ventas') },
    { route: 'etiquetas',      label: 'Etiquetas',          ver: () => puede('etiquetas') },
  ]],
  ['Control', [
    { route: 'alertas',        label: 'Alertas de stock' },
    { route: 'ajustes',        label: 'Ajustes',            ver: () => puede('ajustes.registrar') || puede('ajustes.aprobar') },
    { route: 'conteos',        label: 'Conteo físico',      ver: () => puede('conteos.capturar') },
    { route: 'kardex',         label: 'Kardex',             ver: () => puede('kardex.ver') },
  ]],
  ['Análisis', [
    { route: 'informes',       label: 'Informes',           ver: () => puede('informes.ver') },
    { route: 'reportes',       label: 'Reportes',           ver: () => puede('informes.ver') },
  ]],
  ['Administración', [
    { route: 'usuarios',       label: 'Usuarios',           ver: () => puede('usuarios') },
    { route: 'parametros',     label: 'Parámetros',         ver: () => puede('parametros') },
  ]],
];

/** ¿El usuario actual puede abrir esta ruta? (lo usa el router). */
export const puedeVerRuta = (route) => {
  for (const [, items] of SECCIONES) {
    const item = items.find((i) => i.route === route);
    if (item) return !item.ver || item.ver();
  }
  return true;
};

const bannerSinConexion = (desde) => `
  <div id="banner-offline" role="status" style="position:fixed;left:0;right:0;bottom:0;z-index:900;padding:10px 16px;
       background:var(--clr-warning);color:#fff;font-size:var(--fs-small);text-align:center;">
    Sin conexión con el servidor: modo consulta${desde ? ` con datos del ${esc(new Date(desde).toLocaleString('es-CO'))}` : ''}.
    Los datos pueden estar desactualizados y no se pueden registrar operaciones.
  </div>`;

// RNF-07: el cliente HTTP emite este evento al perder o recuperar la conexión
window.addEventListener('estado-conexion', (e) => {
  document.getElementById('banner-offline')?.remove();
  if (e.detail.offline) document.body.insertAdjacentHTML('beforeend', bannerSinConexion(e.detail.desde));
});

/**
 * Genera el HTML del sidebar con el nav-item activo marcado.
 * @param {string} [activeRoute='dashboard']
 */
export const buildSidebar = (activeRoute = 'dashboard') => {
  const user = getUser();
  const initials = user?.nombre
    ? user.nombre.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'AD';

  const navItem = (item) => `
          <a href="#/${item.route}"
             class="nav-item ${activeRoute === item.route ? 'active' : ''}"
             aria-current="${activeRoute === item.route ? 'page' : 'false'}">${item.label}</a>`;

  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand-icon">S</div>
        <div>
          <div class="sidebar-brand-name">Sneakers</div>
          <div class="sidebar-brand-sub">Bodega & Locales</div>
        </div>
      </div>

      <nav class="sidebar-nav" aria-label="Navegación principal">
        ${SECCIONES.map(([titulo, items]) => {
          const visibles = items.filter((i) => !i.ver || i.ver());
          return visibles.length ? `<div class="sidebar-section-label">${titulo}</div>${visibles.map(navItem).join('')}` : '';
        }).join('')}
      </nav>

      <div class="sidebar-footer">
        <button id="sidebar-perfil-btn" class="sidebar-avatar" title="Cambiar contraseña" aria-label="Cambiar contraseña" style="cursor:pointer;">${esc(initials)}</button>
        <div>
          <div class="sidebar-user-name">${esc(user?.nombre ?? '')}</div>
          <div class="sidebar-user-role">${esc(user?.rolNombre ?? user?.rol ?? '')}${user?.sede ? ` · ${esc(user.sede)}` : ''}</div>
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

/** RNF-05: cambio de contraseña con la política del servidor. */
const abrirCambioPassword = () => {
  const { overlay, close } = abrirModal('Cambiar contraseña', `
    <form class="op-form" id="pw-form" novalidate>
      <div class="form-group"><label class="form-label" for="pw-actual">Contraseña actual</label>
        <input id="pw-actual" type="password" class="form-input" autocomplete="current-password" /></div>
      <div class="form-group"><label class="form-label" for="pw-nueva">Nueva contraseña</label>
        <input id="pw-nueva" type="password" class="form-input" autocomplete="new-password" />
        <p class="op-hint">Mínimo 8 caracteres, con letras y números.</p></div>
      <div class="form-group"><label class="form-label" for="pw-repite">Repite la nueva contraseña</label>
        <input id="pw-repite" type="password" class="form-input" autocomplete="new-password" /></div>
      <button type="submit" class="btn btn-primary" style="justify-content:center;">Guardar</button>
    </form>`);
  overlay.querySelector('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id) => overlay.querySelector(id).value;
    if (v('#pw-nueva') !== v('#pw-repite')) return showToast('Las contraseñas nuevas no coinciden.', 'error');
    try {
      await cambiarPassword(v('#pw-actual'), v('#pw-nueva'));
      showToast('Contraseña actualizada.', 'success');
      close();
    } catch (err) { showToast(err.message, 'error'); }
  });
};

/** Conecta logout y perfil. Llamar después de renderizar el sidebar. */
export const attachSidebarLogout = () => {
  document.getElementById('sidebar-logout-btn')?.addEventListener('click', logout);
  document.getElementById('sidebar-perfil-btn')?.addEventListener('click', abrirCambioPassword);
  if (estaSinConexion() && !document.getElementById('banner-offline')) document.body.insertAdjacentHTML('beforeend', bannerSinConexion(null));
};
