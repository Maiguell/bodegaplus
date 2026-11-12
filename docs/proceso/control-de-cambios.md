# Procedimiento de control de cambios sobre la línea base (SCRUM-46)

> Estado: propuesta del equipo, **pendiente de aprobación** por el Product Owner.

**Línea base:** el backlog del proyecto SCRUM en Jira (épicas, historias HU/HT y RNF con sus criterios de
aceptación y estimación) tal como quedó al planificar los sprints INV 1 a 7.

## 1. Quién puede solicitar un cambio
Cualquier integrante del equipo, el Product Owner o el cliente (a través del Product Owner).

## 2. Cómo se solicita
Se crea en Jira un issue de tipo **Task** con el prefijo `CC-` en el resumen (ej. *CC-03: dividir HU12 en
dos historias*), con:
- Qué cambia (historia, criterio de aceptación, estimación, prioridad o sprint).
- Por qué (hallazgo de usabilidad, cambio del negocio, defecto, riesgo técnico).
- Impacto estimado en puntos y en el sprint en curso.

## 3. Quién aprueba
| Tipo de cambio | Aprueba |
|---|---|
| Redacción o aclaración sin cambiar el alcance | Scrum Master |
| Cambio de criterio de aceptación, estimación o prioridad | **Product Owner** |
| Nueva historia o retiro de una historia | **Product Owner**, en el refinamiento o la planificación |
| Cambio dentro del sprint en curso | Product Owner + equipo, solo si no compromete el objetivo del sprint |

## 4. Cómo se registra
1. El Product Owner comenta la decisión en el issue `CC-` (aprobado / rechazado / aplazado) con la fecha.
2. Si se aprueba, se edita la historia afectada en Jira y se enlaza con el `CC-` (*relates to*).
3. Los cambios aprobados se revisan en la siguiente retrospectiva.

## 5. Cambios ya aplicados durante el desarrollo (para regularizar en Jira)
| Cambio | Motivo |
|---|---|
| Los ajustes ya no se registran como movimiento directo: siempre pasan por aprobación (HU11). | Criterio de aceptación de HU11. |
| El stock mínimo es por talla **y por sede** (HU15). | El criterio menciona "talla 38 … en la sede Norte". |
| Se agregó `costo` a las variantes (HU17). | El informe valorizado lo requiere. |
| Las causales de ajuste pasaron de lista fija a tabla configurable. | RNF-08. |
| Rol "Auxiliar de bodega" además de los cinco roles de HU19. | HU11 lo menciona como quien registra ajustes. |
