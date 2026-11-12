# Pruebas de rendimiento y estrés (HT11 · HT12)

Herramienta: **Locust** (Python). Resultados y gráficas en `docs/evidencias/rendimiento/`.

```bash
python -m venv venv && venv\Scripts\activate      # Linux/macOS: source venv/bin/activate
pip install locust

# Backend dedicado y base aparte (los movimientos no se pueden borrar)
cd backend && set PORT=8096 && set DB_NAME=bodega_sneakers_carga && set NODE_ENV=test && node server.js

# HT11 — carga normal: 50 usuarios, 4 minutos
locust -f locustfile.py --host http://localhost:8096 --headless -u 50 -r 5 -t 4m \
       --csv ../../../docs/evidencias/rendimiento/normal --csv-full-history --html ../../../docs/evidencias/rendimiento/normal.html

# HT12 — estrés en rampa: +25 usuarios cada 30 s hasta 400, luego recuperación
set ESTRES=1
locust -f locustfile.py --host http://localhost:8096 --headless \
       --csv ../../../docs/evidencias/rendimiento/estres --csv-full-history --html ../../../docs/evidencias/rendimiento/estres.html

# Monitoreo de CPU y RAM (node y MySQL) en paralelo
powershell -File monitor.ps1 -Salida ../../../docs/evidencias/rendimiento/recursos-estres.csv -PidNode <PID de node> -Segundos 600
```

Flujos simulados por cada usuario (vendedor): iniciar sesión (peso 1), consultar disponibilidad (peso 6),
registrar venta (peso 3). Antes de empezar se repone stock con movimientos reales para que las ventas no
lo agoten. Una venta rechazada por "stock insuficiente" es una respuesta válida del negocio (no cuenta como fallo).
