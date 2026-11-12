# Ventana de implantación y plan de contingencia (SCRUM-47)

> **Estado: propuesta pendiente de aprobación** por el Product Owner y la gerencia de la empresa.

## Restricciones del negocio

- **Evitar diciembre** (prima de servicios y temporada navideña: pico de ventas).
- **Evitar la temporada escolar** (calendario A: enero y febrero, compra de zapatos escolares).
- Evitar fines de mes (cierres contables) y fines de semana con alta venta.

## Fecha propuesta

| Hito | Fecha propuesta | Responsable |
|---|---|---|
| Despliegue en la nube y prueba de humo (HT07) | Antes del 30 de noviembre de 2026 | Equipo |
| Prueba de usabilidad y ajustes de interfaz (HT13–HT15) | Noviembre de 2026 | Equipo |
| Depuración del catálogo y plantilla validada (SCRUM-42) | Febrero de 2027 | Empresa + equipo |
| Capacitación por rol (SCRUM-45) | 1 al 12 de marzo de 2027 | Equipo |
| Conteo físico general y carga de saldos (SCRUM-44) | Domingo 14 de marzo de 2027 (tiendas cerradas o horario reducido) | Jefe de bodega |
| **Salida a producción** | **Martes 16 de marzo de 2027** | Todos |
| Operación en paralelo con hojas de cálculo | 16 al 31 de marzo de 2027 | Jefe de bodega |
| Cierre de la implantación | 1 de abril de 2027 | Product Owner |

Se elige **martes** para tener el lunes de preparación y no salir el día de mayor carga del fin de semana.

## Pasos del día de salida

1. Respaldo completo de la base (`npm run respaldo`) y verificación de que se puede restaurar.
2. Carga de los saldos del conteo general (ajustes aprobados del conteo).
3. Verificación: `GET /api/salud`, *Kardex → Verificar ahora* sin diferencias, inicio de sesión de un usuario por rol.
4. Comunicación a las tiendas: desde este momento las ventas se registran en el sistema.

## Plan de contingencia

| Situación | Acción | Responsable |
|---|---|---|
| El servicio no responde | Revisar `/api/salud` y el panel del hosting; reiniciar el servicio. Las tiendas consultan en **modo sin conexión** (RNF-07) y anotan las ventas en el formato de respaldo. | Equipo |
| Datos incorrectos tras la carga | Restaurar el respaldo previo en una base nueva, corregir la plantilla y repetir la carga. | Equipo + jefe de bodega |
| Falla grave sin solución en 4 horas | **Volver a las hojas de cálculo** (se mantienen en paralelo dos semanas); registrar en el sistema lo vendido cuando se recupere. | Product Owner |
| Usuario bloqueado o sin acceso | El administrador lo desbloquea en *Usuarios*. | Administrador |
| Diferencias de inventario | Conteo de la sede afectada y ajuste aprobado. | Jefe de bodega |

## Aprobación

| Rol | Nombre | Firma | Fecha |
|---|---|---|---|
| Product Owner | | | |
| Gerencia | | | |
| Equipo de desarrollo | | | |
