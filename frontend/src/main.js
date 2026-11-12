/**
 * @module main
 * @description Punto de entrada: estilos globales, router, renovación del token (HT02)
 * y service worker para abrir la app sin conexión (RNF-07, solo en producción).
 */

import './assets/styles.css';
import { setupRouter } from './router.js';
import { renovarSiHaceFalta } from './services/authService.js';

setupRouter();

// HT02: renueva el token antes de que venza (revisa cada 15 minutos)
renovarSiHaceFalta();
setInterval(renovarSiHaceFalta, 15 * 60_000);

// RNF-07: guarda la aplicación para poder abrirla sin red y consultar la última disponibilidad
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
