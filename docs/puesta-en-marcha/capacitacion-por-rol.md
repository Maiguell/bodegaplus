# Plan de capacitación por rol (SCRUM-45)

Objetivo: que cada persona use el sistema **sin ayuda después de una sesión de máximo una hora** (RNF-01).
Cada sesión es práctica, sobre la base de demostración, con los datos de los escenarios (`npm run escenarios`).

## Guías rápidas por rol

### Vendedor (60 min)
| Min | Tema | Práctica |
|---|---|---|
| 0–10 | Entrar, cambiar la contraseña, recorrido del menú | Iniciar sesión con su usuario; cambiar la clave desde las iniciales en el pie del menú. |
| 10–25 | **Disponibilidad** | Buscar por nombre, por SKU y con el lector; leer la matriz talla × sede; ver la ubicación física. |
| 25–40 | **Venta** (Movimientos → Venta) | Registrar una venta con el lector; qué hacer cuando sale "stock insuficiente" y muestra otras sedes. |
| 40–55 | **Cambio de talla y reservas** | Cambio 39 → 40 con factura; reservar un par 48 h; vender una reserva; qué pasa al vencer. |
| 55–60 | Modo sin conexión y dudas | Qué significa la franja naranja "Sin conexión". |

### Auxiliar de bodega (60 min)
| Min | Tema | Práctica |
|---|---|---|
| 0–10 | Entrar y menú | |
| 10–25 | **Recibir contra orden de compra** | OC-0012: cantidades por talla, observación si llega de más, recepción parcial. |
| 25–35 | **Etiquetas** | Imprimir las etiquetas de lo recibido (PDF 50 × 30 mm, escala 100 %). |
| 35–50 | **Traslados y despachos** | Enviar a una tienda; qué es "en tránsito". |
| 50–60 | **Ajustes y conteo** | Registrar un ajuste con causal; capturar un conteo con el lector. |

### Jefe de bodega (60 min)
| Min | Tema | Práctica |
|---|---|---|
| 0–10 | Panel y avisos | Lectura del Dashboard: alertas, ajustes pendientes, traslados. |
| 10–25 | **Aprobar ajustes** y revisar novedades de traslados | Aprobar uno y rechazar otro con comentario. |
| 25–40 | **Conteo físico** | Iniciar, capturar, cerrar (opción "ignorar no contadas"), imprimir el acta, aprobar el ajuste propuesto. |
| 40–50 | **Alertas y reposición** | Ajustar un mínimo por sede; "Reponer desde Bodega Central". |
| 50–60 | Compras y catálogo | Crear una orden; crear una referencia con su matriz; importar la plantilla. |

### Administrador de tienda (60 min)
| Min | Tema | Práctica |
|---|---|---|
| 0–15 | Todo lo del vendedor, resumido | |
| 15–30 | **Recibir traslados** y registrar faltantes | Confirmar un traslado con un par menos. |
| 30–45 | Alertas de su sede y ajustes | |
| 45–60 | Informes de su tienda | Rotación por talla de su sede. |

### Gerente / Auditor (45 min)
| Min | Tema | Práctica |
|---|---|---|
| 0–15 | **Informes** | Rotación por talla, inventario valorizado (PDF/Excel), sin movimiento. |
| 15–30 | **Kardex** | Consultar una variante, filtrar por fechas, exportar, verificar integridad. |
| 30–45 | Lectura del Dashboard y Reportes | |

## Calendario propuesto (ajustar con la empresa)

| Semana | Sesión | Participantes | Lugar |
|---|---|---|---|
| S-2 (dos semanas antes de salir a producción) | Jefe de bodega + Auxiliares | Bodega Central | Bodega |
| S-2 | Gerente / Auditor | Administración | Oficina |
| S-1 | Administradores de tienda | Centro y Norte | Tienda Centro |
| S-1 | Vendedores (dos grupos, uno por tienda) | Centro, Norte | Cada tienda, antes de abrir |
| S0 | Acompañamiento en sitio el día de salida | Todos | Todas las sedes |

Criterio de éxito: al final de la sesión cada persona completa **sin ayuda** la práctica principal de su rol
(para vendedores y auxiliares: registrar un traslado completo, según RNF-01).
