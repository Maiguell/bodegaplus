# Evaluación heurística previa (interna del equipo)

> **Importante:** esto **no** es la prueba de usabilidad con el cliente (HT14). Es una revisión del equipo
> con las heurísticas de Nielsen y lo detectado al recorrer la aplicación con pruebas automatizadas en
> escritorio y celular. Sirve como línea base para contrastar con los hallazgos reales de la sesión.

## Problemas detectados y ya corregidos

| ID | Pantalla | Problema | Heurística | Severidad | Corrección aplicada |
|---|---|---|---|---|---|
| H-01 | Conteo físico | Al cerrar, un "Aceptar/Cancelar" decidía si las variantes no contadas se consideraban en 0; en una prueba generó un ajuste de −820 pares. | Prevención de errores | Alta | Modal con dos opciones explícitas y la segura (ignorarlas) marcada por defecto. |
| H-02 | Ajustes | Se podía registrar un ajuste que restaba más de lo existente y luego no se podía aprobar. | Prevención de errores | Media | Validación al registrar, en pantalla y en el servidor. |
| H-03 | Conteo físico | El buscador no encontraba "Samba OG · Blanco" (texto copiado de la tabla). | Flexibilidad | Media | Búsqueda por palabras, ignora el separador "·". |
| H-04 | Todas (celular) | En celular el contenido se cortaba por los costados. | Consistencia / estándares | Alta | Columnas con `minmax(0, 1fr)`; tablas con desplazamiento interno. |
| H-05 | Dashboard | "Local Centro → null" en ventas y reservas. | Visibilidad del estado | Baja | Ruta legible por tipo ("→ Cliente", códigos TR/OC). |
| H-06 | Informes | La existencia promedio salía baja por contar días anteriores al kardex. | Correspondencia con el mundo real | Media | Promedio desde la apertura del kardex, con nota explicativa. |

## Riesgos a observar en la sesión con el cliente

| Pantalla | Qué observar | Supuesto del equipo |
|---|---|---|
| Disponibilidad | ¿Entiende que los números de la matriz son pares por sede? ¿Descubre que puede tocar el número para reservar? | El vendedor lee la tabla talla × sede sin explicación. |
| Compras | ¿Encuentra la orden OC-0012 y entiende "Recibe ahora" (precargado con lo pendiente)? | El jefe de bodega solo corrige lo que llegó distinto. |
| Etiquetas | ¿Encuentra el botón tras recibir? ¿Imprime a escala 100 %? | El aviso verde después de recibir es suficiente. |
| Cambios y reservas | Cuando no hay la talla nueva, ¿lee el aviso con las sedes y decide qué hacer? | El aviso naranja con las sedes es claro. |
| Menú | Con 14+ opciones, ¿encuentra la correcta? | Las secciones (Operación, Control…) orientan. |

## Conclusión previa

El equipo supone que el vocabulario (talla EU, sede, traslado, kardex) es el del usuario. La sesión real debe
confirmar especialmente **"kardex"** y **"ajuste"**, que pueden ser términos contables poco usados en tienda.
