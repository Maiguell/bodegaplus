# Prueba de usabilidad — Guía de aplicación (HT13 · HT14 · HT15)

Kit para evaluar el sistema con un **cliente real ajeno al curso** (vendedor o jefe de bodega de una
tienda de calzado), con el protocolo **Thinking Aloud** y **observación no participante**.

> Estado: el material y los datos de prueba están listos. La sesión con el cliente real, la grabación
> y el diligenciamiento de la ficha y la matriz los hace el equipo (ver sección 8).

## 1. Preparación del sistema (antes de la sesión)

1. Usar una base de datos de demostración (nunca la de producción): los movimientos no se pueden borrar.
2. Cargar los datos de los escenarios (idempotente):
   ```bash
   cd backend
   npm run escenarios
   ```
   Crea el **Tenis Urbano 2045** (tallas 36–42, negro y blanco; sin talla 41 en Local Centro),
   la **Bota Trek Cuero** (café, tallas 37–42; en Local Centro hay 39 pero no 40) y deja la orden
   **OC-0012** pendiente.
3. Entrar con un usuario del rol que tiene el participante:
   - Vendedor de Local Centro: `vendedor` (escenarios 1 y 3).
   - Jefe o auxiliar de bodega: `jefe` o `bodega` (escenario 2).
4. Dejar la aplicación abierta en la pantalla de inicio del rol, con la grabación lista (OBS Studio, Loom,
   Clipchamp o Google Meet: pantalla + audio).

## 2. Ficha técnica (diligenciar)

| Campo | Valor |
|---|---|
| Nombre del participante (o código P-01) | |
| Cargo y empresa | |
| Años de experiencia en tienda/bodega de calzado | |
| Experiencia con sistemas de inventario o POS | Ninguna / Básica / Alta |
| Dispositivo y navegador usados | |
| Fecha y hora de la sesión | |
| Moderador | |
| Observadores | |
| Enlace al video (Drive o YouTube oculto) | |
| Duración total | |

## 3. Consentimiento informado (leer y firmar)

> Yo, ______________________, acepto participar voluntariamente en la evaluación del sistema de
> inventario "Bodega Sneakers" del curso de Desarrollo de Software. Autorizo la **grabación de la pantalla
> y del audio** de la sesión con fines exclusivamente académicos. Entiendo que se evalúa el sistema y
> no a mí, que puedo detener la sesión en cualquier momento y que mis datos personales no se publicarán.
>
> Firma: __________________   Fecha: ____ / ____ / ______

## 4. Guion del moderador

**Introducción (2 min):** "Gracias por ayudarnos. Vamos a pedirle que haga tres tareas en el sistema. No hay
respuestas correctas o incorrectas: estamos evaluando el sistema, no a usted. Le pedimos que **piense en
voz alta**: diga lo que ve, lo que busca y lo que espera que pase. No podremos ayudarle durante las tareas."

**Durante las tareas:** el moderador **no ayuda ni da pistas**. Solo puede decir:
- "¿Qué está pensando en este momento?"
- "Siga diciendo lo que está buscando."
- "¿Qué esperaba que pasara?"

Si el participante se bloquea más de 3 minutos, se registra como **no completado** y se pasa a la siguiente tarea.

**Cierre (5 min):** "¿Qué fue lo más fácil? ¿Lo más difícil? ¿Qué cambiaría? Del 1 al 5, ¿qué tan fácil le pareció?"

## 5. Escenarios (leerlos tal cual)

| # | Tipo | Escenario | Éxito cuando… | Rol |
|---|---|---|---|---|
| 1 | Básico | "Un cliente pregunta si hay el **Tenis Urbano 2045 en talla 41**; averigua si lo tienen y en qué sede." | Indica que en su tienda (Local Centro) no hay, y que hay en **Local Norte (3)** y **Bodega Central (5)**. | Vendedor |
| 2 | Flujo principal | "Llegó la mercancía del proveedor de la orden **OC-0012**; regístrala en el sistema y deja las **etiquetas listas para imprimir**." | La orden queda *Recibida* o *Recibida parcial* y se genera el PDF de etiquetas de lo recibido. | Jefe o auxiliar de bodega |
| 3 | Excepción | "Un cliente quiere **cambiar unas botas talla 39 por talla 40**, pero en tu tienda no hay; resuelve la situación." | Identifica dónde hay talla 40 (Norte o Bodega) y propone una salida: traslado, reserva en otra sede o cambio cuando llegue. | Vendedor |

Rutas esperadas (solo para los observadores, **no se le muestran al participante**):
1. Disponibilidad → buscar "Tenis Urbano" o escanear → leer la fila EU 41.
2. Compras → OC-0012 → *Recibir* → cantidades → *Registrar recepción* → *Imprimir etiquetas de lo recibido* → *Generar PDF*.
3. Cambios y reservas → Cambio de talla (el sistema avisa que no hay 40 y muestra las sedes) → o Disponibilidad → reservar en otra sede / pedir traslado.

## 6. Matriz de observación (una por escenario)

| Escenario | Acciones (clics, pantallas) | Verbalizaciones (citas) | Comportamiento no verbal | Completado (Sí / Con ayuda / No) | Tiempo (mm:ss) | Errores | Minuto del video |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |

Métricas a calcular: **tasa de éxito** por escenario, **tiempo promedio**, **número de errores** y la
calificación de facilidad (1–5).

## 7. Registro de hallazgos (HT15)

Un hallazgo por fila, numerados **U-01, U-02…**

| ID | Escenario | Problema observado | Causa raíz | Evidencia (cita o minuto) | Severidad (Baja/Media/Alta) | Solución propuesta |
|---|---|---|---|---|---|---|
| U-01 | | | | | | |

Criterio de severidad: **Alta** impide completar la tarea; **Media** la retrasa o causa errores recuperables;
**Baja** es cosmética o de preferencia.

**Conclusión reflexiva (redactar después de la sesión):** ¿qué supuestos del equipo sobre cómo trabaja el
usuario quedaron desmentidos al observarlo?

## 8. Pendiente para el equipo

- [ ] Elegir el participante y diligenciar la ficha técnica y el consentimiento.
- [ ] Aplicar la sesión, grabarla y subir el video (Drive o YouTube oculto con permiso de visualización).
- [ ] Diligenciar la matriz de observación de los 3 escenarios.
- [ ] Registrar los hallazgos U-xx con su evidencia y la conclusión reflexiva.
- [ ] Llevar los hallazgos y el enlace del video al informe final (HT16).

La evaluación heurística interna que hizo el equipo antes de la sesión está en
[`evaluacion-heuristica-previa.md`](evaluacion-heuristica-previa.md). **No reemplaza** la sesión con el
cliente; sirve para comparar lo que el equipo creía con lo que se observe.
