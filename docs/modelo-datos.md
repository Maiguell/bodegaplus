# Modelo de datos (HT01)

Base MySQL 8. El esquema completo está en [`backend/db/schema.sql`](../backend/db/schema.sql) y las
migraciones para bases existentes en [`backend/db/index.js`](../backend/db/index.js).

## Diagrama entidad-relación

```mermaid
erDiagram
    UBICACIONES ||--o{ STOCK : "tiene"
    UBICACIONES ||--o{ UBICACIONES_BODEGA : "contiene"
    UBICACIONES ||--o{ USUARIOS : "sede de"
    MARCAS ||--o{ MODELOS : ""
    CATEGORIAS ||--o{ MODELOS : ""
    MODELOS ||--o{ VARIANTES : "talla x color"
    COLORES ||--o{ VARIANTES : ""
    TALLAS ||--o{ VARIANTES : ""
    MODELOS ||--o{ REFERENCIA_UBICACION : "ubicada en"
    UBICACIONES_BODEGA ||--o{ REFERENCIA_UBICACION : ""
    VARIANTES ||--o{ STOCK : "saldo por sede"
    VARIANTES ||--o{ KARDEX : ""
    UBICACIONES ||--o{ KARDEX : ""
    MOVIMIENTOS ||--o{ MOVIMIENTO_DETALLE : ""
    MOVIMIENTOS ||--o{ KARDEX : "genera"
    USUARIOS ||--o{ MOVIMIENTOS : "registra"
    PROVEEDORES ||--o{ ORDENES_COMPRA : ""
    ORDENES_COMPRA ||--o{ ORDEN_COMPRA_DETALLE : ""
    ORDENES_COMPRA ||--o{ MOVIMIENTOS : "entrada"
    TRASLADOS ||--o{ TRASLADO_DETALLE : ""
    TRASLADOS ||--o{ MOVIMIENTOS : "envio / recepcion"
    RESERVAS ||--o{ MOVIMIENTOS : ""
    AJUSTES ||--o{ AJUSTE_DETALLE : ""
    AJUSTES ||--o| MOVIMIENTOS : "al aprobar"
    CAUSALES_AJUSTE ||--o{ AJUSTES : ""
    CONTEOS ||--o{ CONTEO_DETALLE : "saldo congelado"
    CONTEOS ||--o| AJUSTES : "propone"
    VARIANTES ||--o{ STOCK_MINIMOS : "minimo por sede"
    VARIANTES ||--o{ ALERTAS : ""
    VARIANTES ||--o{ INDICADORES_VARIANTE : ""

    VARIANTES { int id PK; varchar sku UK; varchar codigo_barras UK; decimal precio; decimal costo; int stock_minimo }
    STOCK { int variante_id PK; int ubicacion_id PK; int cantidad "CHECK >= 0" }
    KARDEX { bigint id PK; int movimiento_id FK; int cantidad "con signo"; int saldo; datetime fecha }
    MOVIMIENTOS { int id PK; enum tipo; int usuario_id FK; int origen_id; int destino_id; varchar referencia }
    USUARIOS { int id PK; varchar usuario UK; enum rol; int sede_id; int intentos_fallidos; datetime bloqueado_hasta }
```

## Reglas que garantiza la base

| Regla | Cómo |
|---|---|
| El stock nunca es negativo | `CHECK (cantidad >= 0)` en `stock` y restas con `UPDATE … WHERE cantidad >= n` (bloqueo de fila). |
| Bitácora inalterable (RNF-04) | Triggers que rechazan `UPDATE` y `DELETE` en `kardex`, `movimientos` y `movimiento_detalle`. |
| Saldo trazable | Cada cambio de stock escribe una fila en `kardex` con el saldo resultante; `/api/kardex/verificacion` compara. |
| Variante única | `UNIQUE (modelo_id, color_id, talla_id)`; SKU y código de barras únicos. |
| Una alerta activa por talla y sede | `UNIQUE (variante_id, ubicacion_id, abierta)` con `abierta = NULL` al resolver. |
| Contraseñas | Hash bcrypt (`password_hash`), nunca texto plano. |

## Entidades por historia

| Historia | Tablas |
|---|---|
| HU01–HU04, HT05 | modelos, variantes, marcas, categorias, colores, tallas, ubicaciones_bodega, referencia_ubicacion |
| HU05 | ordenes_compra, orden_compra_detalle |
| HU06–HU07, HT04 | movimientos, movimiento_detalle, kardex, stock |
| HU08–HU09 | traslados, traslado_detalle |
| HU10, HU13, HU14 | movimientos (CAMBIO), reservas |
| HU11–HU12 | ajustes, ajuste_detalle, causales_ajuste, conteos, conteo_detalle |
| HU15–HU18, HT06 | stock_minimos, alertas, indicadores_variante, ejecuciones_proceso |
| HU19–HU20, RNF-05, RNF-08 | usuarios, parametros, causales_ajuste |
