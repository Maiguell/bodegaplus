/**
 * @module loginView
 * @description Vista y controlador de la pantalla de autenticación.
 * Gestiona el formulario de login, valida los campos en el cliente,
 * envía las credenciales al backend vía authService y navega al dashboard.
 */

import './login.css';
import { login, isAuthenticated } from '../../services/authService.js';
import { renderView } from '../../router.js';

/** Markup HTML estático de la vista de login. */
const loginHTML = `
<div class="login-page">

  <!-- Panel Hero / Branding -->
  <div class="login-hero">
    <div class="login-hero-content">
      <div class="login-hero-icon">👟</div>
      <h1 class="login-hero-title">Sneakers<br/>Bodega &amp; Locales</h1>
      <p class="login-hero-subtitle">
        Control de inventario de zapatillas por modelo, color y talla, desde la bodega central hasta tus locales.
      </p>
      <div class="login-features">
        <div class="login-feature-item">
          <span class="login-feature-dot"></span>
          Stock por talla en bodega y locales
        </div>
        <div class="login-feature-item">
          <span class="login-feature-dot"></span>
          Entradas, despachos y devoluciones
        </div>
        <div class="login-feature-item">
          <span class="login-feature-dot"></span>
          Alertas de reposición por talla
        </div>
        <div class="login-feature-item">
          <span class="login-feature-dot"></span>
          Reportes y métricas del negocio
        </div>
      </div>
    </div>
  </div>

  <!-- Panel Formulario -->
  <div class="login-form-panel">
    <div class="login-form-box">
      <div class="login-form-header">
        <h2 class="login-form-title">Bienvenido</h2>
        <p class="login-form-desc">Ingresa tus credenciales para continuar.</p>
      </div>

      <form id="login-form" class="login-form" novalidate>

        <!-- Campo usuario -->
        <div class="form-group">
          <label class="form-label" for="login-usuario">Usuario o correo</label>
          <div class="login-input-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            <input
              type="text"
              id="login-usuario"
              name="usuario"
              class="form-input"
              placeholder="admin"
              autocomplete="username"
              required
            />
          </div>
        </div>

        <!-- Campo contraseña -->
        <div class="form-group">
          <label class="form-label" for="login-password">Contraseña</label>
          <div class="login-input-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <input
              type="password"
              id="login-password"
              name="password"
              class="form-input"
              placeholder="••••••••"
              autocomplete="current-password"
              required
            />
          </div>
        </div>

        <!-- Mensaje de error -->
        <div id="login-error" class="login-error" role="alert" aria-live="assertive"></div>

        <!-- Botón de envío -->
        <button type="submit" id="login-submit-btn" class="btn btn-primary login-btn">
          <span class="btn-text">Iniciar sesión</span>
          <div class="btn-spinner"></div>
        </button>

      </form>

      <footer class="login-footer">
        &copy; 2026 Sneakers · Bodega &amp; Locales. Todos los derechos reservados.
      </footer>
    </div>
  </div>

</div>
`;

/**
 * Inicializa la vista de login: renderiza el HTML y adjunta los event listeners.
 * Si el usuario ya tiene sesión activa, redirige directamente al dashboard.
 * @returns {void}
 */
export const initLogin = () => {
  // Guard: redirigir si ya hay sesión
  if (isAuthenticated()) {
    window.location.hash = '#/dashboard';
    return;
  }

  renderView(loginHTML);
  attachLoginListeners();
};

/**
 * Adjunta el listener de submit al formulario de login.
 * Recolecta los datos, llama al authService y maneja el resultado.
 * @returns {void}
 */
const attachLoginListeners = () => {
  const form      = document.getElementById('login-form');
  const errorBox  = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit-btn');

  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const usuario  = form.usuario.value.trim();
    const password = form.password.value;

    // ── Validación básica en cliente ──────────────────────────────────
    if (!usuario || !password) {
      showError(errorBox, 'Por favor completa todos los campos.');
      return;
    }

    setLoading(submitBtn, true);
    hideError(errorBox);

    try {
      await login(usuario, password);
      // Navegación al dashboard tras login exitoso
      window.location.hash = '#/dashboard';
    } catch (err) {
      showError(errorBox, err.message ?? 'Credenciales incorrectas. Intenta de nuevo.');
    } finally {
      setLoading(submitBtn, false);
    }
  });
};

/**
 * Muestra un mensaje de error en el contenedor de error del formulario.
 * @param {HTMLElement} el - Elemento contenedor del error.
 * @param {string} message - Mensaje a mostrar.
 * @returns {void}
 */
const showError = (el, message) => {
  el.textContent = message;
  el.classList.add('visible');
};

/**
 * Oculta el mensaje de error del formulario.
 * @param {HTMLElement} el - Elemento contenedor del error.
 * @returns {void}
 */
const hideError = (el) => {
  el.textContent = '';
  el.classList.remove('visible');
};

/**
 * Activa o desactiva el estado de carga en el botón de submit.
 * @param {HTMLButtonElement} btn - El botón a modificar.
 * @param {boolean} loading - true para mostrar spinner, false para restaurar.
 * @returns {void}
 */
const setLoading = (btn, loading) => {
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
};
