/**
 * @module router
 * @description Configuración centralizada del enrutador SPA usando la librería Navigo.
 * Implementa guard de autenticación en rutas protegidas y renderizado dinámico de vistas.
 */

import Navigo from 'navigo';
import { isAuthenticated } from './services/authService.js';

/** Instancia global del enrutador Navigo (hash-based para compatibilidad máxima). */
const router = new Navigo('/', { hash: true });

/**
 * Renderiza el HTML de una vista en el contenedor principal (#app).
 * @param {string} html - Markup HTML de la vista.
 * @returns {void}
 */
export const renderView = (html) => {
  const app = document.getElementById('app');
  if (app) app.innerHTML = html;
};

/**
 * Guard de autenticación: redirige al login si no hay sesión activa.
 * Debe llamarse al inicio de cada handler de ruta protegida.
 * @returns {boolean} false si fue redirigido (sesión inválida), true si puede continuar.
 */
const requireAuth = () => {
  if (!isAuthenticated()) {
    router.navigate('/login');
    return false;
  }
  return true;
};

/**
 * Registra y configura todas las rutas de la aplicación.
 * Se apoya en imports dinámicos para cargar cada vista bajo demanda (code-splitting).
 * @returns {Navigo} La instancia del router configurada y resuelta.
 */
export const setupRouter = () => {
  router
    // ── Ruta raíz → redirige según sesión ──────────────────────────────
    .on('/', () => {
      isAuthenticated() ? router.navigate('/dashboard') : router.navigate('/login');
    })

    // ── Login ───────────────────────────────────────────────────────────
    .on('/login', async () => {
      const { initLogin } = await import('./views/login/login.js');
      initLogin();
    })

    // ── Dashboard ───────────────────────────────────────────────────────
    .on('/dashboard', async () => {
      if (!requireAuth()) return;
      const { initDashboard } = await import('./views/dashboard/dashboard.js');
      initDashboard();
    })

    // ── Catálogo (modelos y variantes) ──────────────────────────────────
    .on('/catalogo', async () => {
      if (!requireAuth()) return;
      const { initCatalogo } = await import('./views/catalogo/catalogo.js');
      initCatalogo();
    })

    // ── Inventario (stock por talla y ubicación) ────────────────────────
    .on('/inventario', async () => {
      if (!requireAuth()) return;
      const { initInventario } = await import('./views/inventario/inventario.js');
      initInventario();
    })

    // ── Registro de Movimientos ─────────────────────────────────────────
    .on('/movimientos', async () => {
      if (!requireAuth()) return;
      const { initMovimientos } = await import('./views/movimientos/movimientos.js');
      initMovimientos();
    })

    // ── Compras: órdenes de compra y recepción (HU05) ───────────────────
    .on('/compras', async () => {
      if (!requireAuth()) return;
      const { initCompras } = await import('./views/compras/compras.js');
      initCompras();
    })

    // ── Traslados entre sedes (HU08 / HU09) ─────────────────────────────
    .on('/traslados', async () => {
      if (!requireAuth()) return;
      const { initTraslados } = await import('./views/traslados/traslados.js');
      initTraslados();
    })

    // ── Disponibilidad multisede (HU13) ─────────────────────────────────
    .on('/disponibilidad', async () => {
      if (!requireAuth()) return;
      const { initDisponibilidad } = await import('./views/disponibilidad/disponibilidad.js');
      initDisponibilidad();
    })

    // ── Cambios de talla y reservas (HU10 / HU14) ───────────────────────
    .on('/tienda', async () => {
      if (!requireAuth()) return;
      const { initTienda } = await import('./views/tienda/tienda.js');
      initTienda();
    })

    // ── Kardex (HU07) — admite ?sku= ────────────────────────────────────
    .on('/kardex', async (match) => {
      if (!requireAuth()) return;
      const { initKardex } = await import('./views/kardex/kardex.js');
      initKardex(match?.params ?? {});
    })

    // ── Sprint 5: ajustes (HU11), conteos (HU12) y alertas (HU15) ───────
    .on('/ajustes', async () => {
      if (!requireAuth()) return;
      const { initAjustes } = await import('./views/ajustes/ajustes.js');
      initAjustes();
    })
    .on('/conteos', async () => {
      if (!requireAuth()) return;
      const { initConteos } = await import('./views/conteos/conteos.js');
      initConteos();
    })
    .on('/alertas', async () => {
      if (!requireAuth()) return;
      const { initAlertas } = await import('./views/alertas/alertas.js');
      initAlertas();
    })

    // ── Sprint 6: informes (HU16 / HU17 / HU18) y procesos ──────────────
    .on('/informes', async () => {
      if (!requireAuth()) return;
      const { initInformes } = await import('./views/informes/informes.js');
      initInformes();
    })

    // ── Reportes ────────────────────────────────────────────────────────
    .on('/reportes', async () => {
      if (!requireAuth()) return;
      const { initReportes } = await import('./views/reportes/reportes.js');
      initReportes();
    })

    // ── 404 ─────────────────────────────────────────────────────────────
    .notFound(() => {
      renderView(`
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:16px;">
          <h1 style="font-family:var(--font-display);font-size:4rem;font-weight:700;color:var(--clr-accent);">404</h1>
          <p style="color:var(--clr-text-secondary);">Página no encontrada.</p>
          <a href="#/dashboard" style="color:var(--clr-accent);">← Volver al inicio</a>
        </div>
      `);
    });

  router.resolve();
  return router;
};

export default router;
