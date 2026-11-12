/**
 * @module router
 * @description Enrutador SPA (Navigo, por hash). Cada ruta protegida exige sesión y que el rol pueda
 * ver la opción (HU19); si no, redirige a la pantalla de inicio del rol. Las vistas se cargan bajo demanda.
 */

import Navigo from 'navigo';
import { isAuthenticated, rutaInicio } from './services/authService.js';
import { puedeVerRuta } from './components/sidebar.js';
import { showToast } from './utils/toast.js';

/** Instancia global del enrutador Navigo (hash-based para compatibilidad máxima). */
const router = new Navigo('/', { hash: true });

/** Renderiza el HTML de una vista en el contenedor principal (#app). */
export const renderView = (html) => {
  const app = document.getElementById('app');
  if (app) app.innerHTML = html;
};

/** Guard: sesión activa y permiso del rol para la ruta. */
const permitir = (ruta) => {
  if (!isAuthenticated()) { router.navigate('/login'); return false; }
  if (!puedeVerRuta(ruta)) {
    showToast('Tu rol no tiene acceso a esa opción.', 'error');
    window.location.hash = rutaInicio();
    return false;
  }
  return true;
};

/** ruta → [cargador del módulo, nombre de la función de inicio] */
const VISTAS = {
  dashboard:      [() => import('./views/dashboard/dashboard.js'), 'initDashboard'],
  catalogo:       [() => import('./views/catalogo/catalogo.js'), 'initCatalogo'],
  inventario:     [() => import('./views/inventario/inventario.js'), 'initInventario'],
  disponibilidad: [() => import('./views/disponibilidad/disponibilidad.js'), 'initDisponibilidad'],
  movimientos:    [() => import('./views/movimientos/movimientos.js'), 'initMovimientos'],
  compras:        [() => import('./views/compras/compras.js'), 'initCompras'],
  traslados:      [() => import('./views/traslados/traslados.js'), 'initTraslados'],
  tienda:         [() => import('./views/tienda/tienda.js'), 'initTienda'],
  etiquetas:      [() => import('./views/etiquetas/etiquetas.js'), 'initEtiquetas'],
  alertas:        [() => import('./views/alertas/alertas.js'), 'initAlertas'],
  ajustes:        [() => import('./views/ajustes/ajustes.js'), 'initAjustes'],
  conteos:        [() => import('./views/conteos/conteos.js'), 'initConteos'],
  kardex:         [() => import('./views/kardex/kardex.js'), 'initKardex'],
  informes:       [() => import('./views/informes/informes.js'), 'initInformes'],
  reportes:       [() => import('./views/reportes/reportes.js'), 'initReportes'],
  usuarios:       [() => import('./views/usuarios/usuarios.js'), 'initUsuarios'],
  parametros:     [() => import('./views/parametros/parametros.js'), 'initParametros'],
};

/** Registra las rutas y resuelve la actual. */
export const setupRouter = () => {
  router
    .on('/', () => { window.location.hash = isAuthenticated() ? rutaInicio() : '#/login'; })
    .on('/login', async () => {
      const { initLogin } = await import('./views/login/login.js');
      initLogin();
    });

  for (const [ruta, [cargar, init]] of Object.entries(VISTAS)) {
    // match.params trae la query (?sku=, ?modelo=…) para las vistas que la usan
    router.on(`/${ruta}`, async (match) => {
      if (!permitir(ruta)) return;
      try {
        const mod = await cargar();
        mod[init](match?.params ?? {});
      } catch (err) {
        // Sin conexión y la vista aún no se había descargado (RNF-07)
        renderView(`<div style="padding:48px;text-align:center;">No se pudo cargar esta pantalla. Revisa la conexión e intenta de nuevo.<br>
          <a href="#/disponibilidad">Ir a Disponibilidad</a></div>`);
        console.error(err);
      }
    });
  }

  router.notFound(() => {
    renderView(`
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:16px;">
        <h1 style="font-family:var(--font-display);font-size:4rem;font-weight:700;color:var(--clr-accent);">404</h1>
        <p style="color:var(--clr-text-secondary);">Página no encontrada.</p>
        <a href="#/" style="color:var(--clr-accent);">← Volver al inicio</a>
      </div>`);
  });

  router.resolve();
  return router;
};

export default router;
