# Pendientes del proyecto

Todo el **código** de los sprints INV 1 a 7 y del backlog (RNF-01 a RNF-09) está implementado y probado.
Lo que queda depende de una persona, de una cuenta externa o de una aprobación.

| # | Historia / tarea | Qué falta | Quién | Material listo |
|---|---|---|---|---|
| 1 | HT07 Despliegue (RNF-03) | Publicar en un hosting con URL pública y HTTPS; probar la imagen Docker (requiere Docker Desktop encendido). | Equipo (con cuenta de hosting) | `Dockerfile`, `DEPLOY.md`, `backend/.env.production.example` |
| 2 | HT08 Base en la nube | Crear la base MySQL administrada y activar sus respaldos automáticos. | Equipo | `DEPLOY.md` §3–4 (respaldo/restauración ya probados en local) |
| 3 | HT13 Preparación de usabilidad | Elegir el cliente real, ficha técnica y consentimiento firmados. | Equipo | `docs/usabilidad/guia-prueba-usabilidad.md`, `npm run escenarios` |
| 4 | HT14 Sesión Thinking Aloud | Aplicar la sesión, grabar y subir el video; diligenciar la matriz de observación. | Equipo + cliente | Guion, escenarios y matriz en la guía |
| 5 | HT15 Hallazgos | Registrar U-01, U-02… con evidencia y la conclusión reflexiva. | Equipo | Plantilla en la guía; línea base en `evaluacion-heuristica-previa.md` |
| 6 | HT16 Informe final PDF | Completar la sección de usabilidad (40 %) con los datos reales y el enlace al video; subirlo al campus. | Equipo | Borrador `docs/Informe_Validacion_Sprint7.pdf` con funcionales y rendimiento |
| 7 | SCRUM-47 Implantación | Aprobar el cronograma propuesto (salida el 16 de marzo de 2027). | Product Owner / gerencia | `docs/puesta-en-marcha/implantacion.md` |
| 8 | SCRUM-46 Control de cambios | Aprobar el procedimiento y registrar en Jira los cambios ya aplicados. | Product Owner | `docs/proceso/control-de-cambios.md` |
| 9 | SCRUM-42 Catálogo real | Depurar las hojas de la empresa e importarlas sin filas rechazadas. | Empresa + equipo | Plantilla e importación con reporte |
| 10 | SCRUM-43 / SCRUM-44 | Etiquetar la mercancía existente y hacer el conteo general con actas firmadas. | Empresa | Etiquetas PDF, conteo con lector, acta imprimible |
| 11 | SCRUM-45 Capacitación | Dictar las sesiones por rol según el calendario. | Equipo | `docs/puesta-en-marcha/capacitacion-por-rol.md` |
| 12 | RNF-01 / RNF-03 | Medir en uso real: traslado sin ayuda tras 1 h de capacitación; disponibilidad del 99 % (monitorear `/api/salud`). | Equipo | Health check y guía de monitoreo en `DEPLOY.md` |
| 13 | Jira | Mover a "Finalizada" los issues terminados (no se ha cambiado ningún estado). | Equipo | — |
