/**
 * @module main
 * @description Punto de entrada principal de la aplicación.
 * Únicamente responsable de importar estilos globales e inicializar el router.
 */

import './assets/styles.css';
import { setupRouter } from './router.js';

// Inicializa el enrutador SPA al cargar la aplicación
setupRouter();
