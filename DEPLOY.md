# Despliegue y operación — Bodega Sneakers

Procedimiento documentado para publicar el sistema (HT07), configurar sus ambientes y proteger
los datos con respaldos (HT08 / RNF-09).

## 1. Arquitectura en producción

```
Navegador (escritorio o celular)
        │  HTTPS (certificado del hosting)
        ▼
Servicio web (Docker)  ── Express sirve /api y el frontend compilado en el mismo dominio
        │  TLS (DB_SSL=true)
        ▼
MySQL 8 administrado en la nube  ── respaldos automáticos del proveedor + respaldo diario propio
```

Un solo servicio: el `Dockerfile` compila el frontend con Vite y el backend lo sirve, así no hace
falta configurar CORS ni dos dominios.

## 2. Ambientes

| Ambiente | Cómo se activa | Archivo de referencia | Base de datos |
|---|---|---|---|
| Desarrollo | `NODE_ENV=development` (por defecto) | `backend/.env.example` → copiar a `backend/.env` | `bodega_sneakers` local |
| Pruebas | `NODE_ENV=test` | `backend/.env.test.example` → `backend/.env.test` | `bodega_sneakers_test` |
| Producción | `NODE_ENV=production` | `backend/.env.production.example` (variables en el panel del hosting) | MySQL en la nube |

- El servidor carga `backend/.env.<NODE_ENV>` y luego `backend/.env`. Las variables que ya existan
  en el entorno (las del panel del hosting) tienen prioridad.
- **Ninguna credencial está en el código.** En producción el servidor no arranca si falta
  `JWT_SECRET` (mínimo 32 caracteres), `DB_HOST`, `DB_USER` o `DB_PASSWORD`.
- Los archivos `.env*` están en `.gitignore`; solo se versionan las plantillas `*.example`.
- Los usuarios iniciales solo se crean con la base vacía, con las claves de
  `SEED_ADMIN_PASSWORD` y `SEED_OPERADOR_PASSWORD` (obligatorias en producción). Los usuarios de
  demostración por rol (jefe, tienda, vendedor, auditor) solo se crean si se define `SEED_DEMO_PASSWORD`.
- Las contraseñas deben cumplir la política (RNF-05): mínimo 8 caracteres con letras y números; tras 5
  intentos fallidos la cuenta se bloquea 15 minutos (configurable en *Parámetros*).

Generar un `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 3. Publicar en Railway (recomendado)

Railway da HTTPS automático, MySQL administrado y despliega desde GitHub.

1. Sube el repositorio a GitHub.
2. En <https://railway.app> crea un proyecto → **Deploy from GitHub repo** → elige el repositorio.
   Railway detecta el `Dockerfile`.
3. En el mismo proyecto: **New → Database → MySQL**.
4. En el servicio web → **Variables**, agrega (usa las referencias de la base de datos de Railway):

   | Variable | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | (el generado arriba) |
   | `DB_HOST` | `${{MySQL.MYSQLHOST}}` |
   | `DB_PORT` | `${{MySQL.MYSQLPORT}}` |
   | `DB_USER` | `${{MySQL.MYSQLUSER}}` |
   | `DB_PASSWORD` | `${{MySQL.MYSQLPASSWORD}}` |
   | `DB_NAME` | `${{MySQL.MYSQLDATABASE}}` |
   | `SEED_ADMIN_PASSWORD` / `SEED_OPERADOR_PASSWORD` | claves iniciales |
   | `BACKUP_ENABLED` | `true` |

   Si la conexión exige TLS, agrega `DB_SSL=true`.
5. **Settings → Networking → Generate Domain**: queda una URL pública `https://<algo>.up.railway.app`.
6. Para conservar los respaldos entre despliegues, agrega un **Volume** montado en `/data`.
7. Verifica: `https://<tu-dominio>/api/salud` responde `{"ok":true,"ambiente":"production"}`.

En Render el procedimiento es equivalente: *New Web Service* desde el repositorio con el
`Dockerfile`, una base MySQL externa (Aiven, PlanetScale-compatible o similar) y las mismas variables.

### Probar la imagen en local

```bash
docker build -t bodega-sneakers .
docker run -p 8080:8080 --env-file backend/.env.production bodega-sneakers
```

## 4. Copias de seguridad (RNF-09)

- **Diaria y automática:** con `BACKUP_ENABLED=true` el servidor genera cada día, a la hora
  `BACKUP_HOUR` (3 a. m. por defecto), `respaldo_<base>_<fecha>.sql.gz` en `BACKUP_DIR`.
- **Retención:** se borran los respaldos con más de `BACKUP_RETENTION_DAYS` días (30 por defecto).
- **Registro:** cada ejecución queda en *Informes → Procesos*, con su estado y tamaño.
- **Manual:** `npm run respaldo` (en `backend/`) o el botón *Ejecutar: Copia de seguridad* en *Informes → Procesos*.
- **Programador del sistema** (si prefieres no depender del servidor web):
  - Linux: `0 3 * * * cd /ruta/backend && NODE_ENV=production npm run respaldo`
  - Windows: Programador de tareas → acción `npm run respaldo` con inicio en la carpeta `backend`.
- Además, activa los respaldos automáticos del proveedor de MySQL (Railway, Aiven, etc.).

### Restaurar

```bash
cd backend
# 1) Restaurar en una base nueva y revisar
npm run restaurar -- backups/respaldo_bodega_sneakers_20261111-030000.sql.gz bodega_restaurada
# 2) Si todo está bien, apuntar DB_NAME a la base restaurada, o restaurar sobre la principal:
npm run restaurar -- backups/respaldo_bodega_sneakers_20261111-030000.sql.gz bodega_sneakers --forzar
```

**Prueba de restauración realizada:** se respaldó la base de pruebas, se restauró en una base nueva
y se compararon las 26 tablas (mismo número de filas) y los 6 triggers de inmutabilidad del kardex.
La retención se probó con un respaldo de 31 días (eliminado) y uno de 22 días (conservado).

## 5. Procesos programados (HT06)

| Proceso | Frecuencia | Qué hace |
|---|---|---|
| Reservas vencidas | cada minuto | Libera las reservas vencidas (HU14) |
| Alertas de stock | por evento + barrido cada 5 min | Crea o resuelve alertas de stock mínimo (HU15) |
| Indicadores | cada noche (`INDICADORES_HOUR`, 2 a. m.) y al primer arranque | Días sin movimiento y ventas 30/90 días (HU16, HU18) |
| Copia de seguridad | cada noche (`BACKUP_HOUR`) si `BACKUP_ENABLED=true` | Respaldo con retención |

## 6. Disponibilidad y monitoreo (RNF-03)

- `GET /api/salud` responde `{ ok: true }` solo si la base de datos contesta: úsalo como *health check*
  del hosting (el `Dockerfile` ya lo declara) y en un monitor externo gratuito (UptimeRobot, Better Stack)
  cada 5 minutos en horario comercial. El porcentaje de disponibilidad del monitor es la evidencia de RNF-03.
- Si el servicio cae, las tiendas siguen consultando la última disponibilidad descargada (RNF-07).
- Capacidad medida (ver `docs/evidencias/rendimiento/` y el informe final): con una instancia, 50 usuarios
  concurrentes se atienden sin errores; para más carga, escalar a 2+ instancias detrás del balanceador del hosting.

## 7. Lista de verificación después de desplegar

- [ ] `GET /api/salud` responde `ok: true` por HTTPS.
- [ ] Iniciar sesión con el administrador y cambiar las claves iniciales.
- [ ] *Informes → Procesos*: el proceso de indicadores aparece en estado OK.
- [ ] Ejecutar una copia de seguridad manual y verla en la lista.
- [ ] Abrir Disponibilidad, Kardex e Informes desde un celular (RNF-06).
