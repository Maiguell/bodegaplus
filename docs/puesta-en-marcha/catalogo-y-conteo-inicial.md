# Depuración del catálogo (SCRUM-42) y conteo físico general (SCRUM-44)

## A. Depurar el catálogo actual y dejarlo en la plantilla

1. Descargar la plantilla: *Catálogo → Importar catálogo → Descargar plantilla* (CSV separado por `;`).
2. Columnas: `marca; categoria; referencia; genero; codigo_estilo; colores; tallas; costo; precio`.
   - `colores`: separados por `|` (ej. `Negro|Blanco`).
   - `tallas`: rango `36-42` o lista `38|38.5|39` (decimales con punto).
   - `genero`: Hombre, Mujer, Unisex o Nino.
3. Reglas de depuración de las hojas actuales:
   - Una fila por **referencia** (no por talla ni por color): las variantes se generan solas.
   - Unificar nombres de color (`negro`, `NEGRO`, `Negra` → `Negro`) y de marca.
   - Eliminar referencias duplicadas (misma marca + nombre + género).
   - Verificar que las tallas existan para el género (si no, crearlas en *Parámetros → Tallas*).
   - El costo no puede ser mayor que el precio.
4. Importar. El sistema crea lo válido y entrega un **reporte con cada fila rechazada y su motivo**;
   corregir esas filas en la hoja y volver a importar (las referencias ya creadas no se duplican, solo se
   agregan las variantes que falten).

**Entregable:** plantilla validada (importación sin filas rechazadas).

## B. Conteo físico general previo a la puesta en marcha

Objetivo: cargar los **saldos iniciales reales** de cada sede.

1. Requisitos: catálogo importado, mercancía etiquetada (ver `codigos-de-barras.md`), usuarios creados.
2. Por cada sede (*Conteo físico → Iniciar conteo*, rol jefe de bodega): el sistema congela el saldo actual.
3. Contar con el lector (cada lectura suma 1) o digitar las cantidades. Varias personas pueden capturar a la vez.
4. *Cerrar conteo* → para el conteo inicial elegir **"Considerarlas en 0"** (lo no encontrado no existe).
5. Revisar las diferencias, *Imprimir acta* y firmarla (responsable del conteo, jefe de bodega, administrador de la sede).
6. Aprobar el ajuste propuesto en *Ajustes*: ese es el saldo inicial real, trazado en el kardex.
7. Verificar en *Kardex → Integridad del kardex*.

**Entregable:** un acta firmada por sede y los ajustes iniciales aprobados.

> Estado: el sistema y el procedimiento están listos. El conteo real lo ejecuta la empresa en la fecha de
> implantación (ver `implantacion.md`).
