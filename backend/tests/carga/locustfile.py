"""
HT11 / HT12 — Pruebas de rendimiento y estrés con Locust.

Flujos (HU20, HU13, HU06): iniciar sesión, consultar disponibilidad multisede y registrar una venta.

Carga normal (HT11): 50 usuarios, 4 minutos
    locust -f locustfile.py --host http://localhost:8096 --headless -u 50 -r 5 -t 4m \
           --csv resultados/normal --html resultados/normal.html

Estrés en rampa (HT12): escalones de +25 usuarios cada 30 s hasta 400 y luego baja a 0 (recuperación)
    ESTRES=1 locust -f locustfile.py --host http://localhost:8096 --headless \
           --csv resultados/estres --html resultados/estres.html

Usar SIEMPRE una base de datos aparte (los movimientos del kardex no se pueden borrar).
"""

import os
import random
from locust import HttpUser, LoadTestShape, between, events, task

USUARIO = os.environ.get("CARGA_USUARIO", "vendedor")
CLAVE = os.environ.get("CARGA_CLAVE", "demo1234")
ADMIN = os.environ.get("CARGA_ADMIN", "admin")
CLAVE_ADMIN = os.environ.get("CARGA_ADMIN_CLAVE", "admin123")
BUSQUEDAS = ["Samba", "Air Force", "Tenis Urbano 2045", "Pegasus", "Dunk", "574", "Clyde", "Ultraboost", "Bota Trek"]

# Variantes con stock en la sede del vendedor (se llenan al iniciar la prueba)
VENDIBLES = []
SEDE_VENTA = {"id": None}


@events.test_start.add_listener
def preparar(environment, **_):
    """Repone stock en la sede del vendedor para que las ventas no lo agoten durante la prueba."""
    import requests
    host = environment.host
    tk = requests.post(f"{host}/api/auth/login", json={"usuario": ADMIN, "password": CLAVE_ADMIN}).json()["token"]
    h = {"Authorization": f"Bearer {tk}"}
    yo = requests.post(f"{host}/api/auth/login", json={"usuario": USUARIO, "password": CLAVE}).json()["user"]
    SEDE_VENTA["id"] = yo["sedeId"]
    inv = requests.get(f"{host}/api/inventario", headers=h).json()
    elegidas = [v["id"] for v in inv][:60]
    lineas = [{"varianteId": vid, "cantidad": 400} for vid in elegidas]
    requests.post(f"{host}/api/movimientos", headers=h, json={"tipo": "ENTRADA", "referencia": "CARGA-HT11", "detalle": lineas})
    requests.post(f"{host}/api/movimientos", headers=h, json={"tipo": "DESPACHO", "localId": SEDE_VENTA["id"], "referencia": "CARGA-HT11",
                                                                 "detalle": [{"varianteId": vid, "cantidad": 380} for vid in elegidas]})
    VENDIBLES.extend(elegidas)
    print(f"Preparación: {len(elegidas)} variantes con stock en la sede {SEDE_VENTA['id']}")


class Vendedor(HttpUser):
    """Un vendedor de tienda: consulta mucho, vende a menudo y de vez en cuando vuelve a entrar."""
    wait_time = between(0.5, 1.5) if os.environ.get("ESTRES") else between(1, 3)

    def on_start(self):
        self.iniciar_sesion()

    def iniciar_sesion(self):
        with self.client.post("/api/auth/login", json={"usuario": USUARIO, "password": CLAVE}, name="1. Iniciar sesión", catch_response=True) as r:
            if r.status_code == 200:
                self.client.headers["Authorization"] = f"Bearer {r.json()['token']}"
            else:
                r.failure(f"login {r.status_code}")

    @task(1)
    def volver_a_entrar(self):
        self.iniciar_sesion()

    @task(6)
    def consultar_disponibilidad(self):
        q = random.choice(BUSQUEDAS)
        with self.client.get("/api/disponibilidad", params={"q": q}, name="2. Consultar disponibilidad", catch_response=True) as r:
            if r.status_code != 200:
                r.failure(f"{r.status_code}")
            elif r.elapsed.total_seconds() >= 3:
                r.failure("RNF-02: más de 3 s")

    @task(3)
    def registrar_venta(self):
        if not VENDIBLES:
            return
        venta = {"tipo": "VENTA", "ubicacionId": SEDE_VENTA["id"], "referencia": "FV-CARGA",
                 "detalle": [{"varianteId": random.choice(VENDIBLES), "cantidad": 1}]}
        with self.client.post("/api/movimientos", json=venta, name="3. Registrar venta", catch_response=True) as r:
            if r.status_code == 409 and "Otra operación" in r.text:
                r.failure("bloqueo de concurrencia")
            elif r.status_code not in (201, 409):  # 409 de stock insuficiente es una respuesta de negocio válida
                r.failure(f"{r.status_code}")


if os.environ.get("ESTRES"):
    class Rampa(LoadTestShape):
        """HT12: +25 usuarios cada 30 s hasta 400; luego 0 usuarios durante 60 s para observar la recuperación."""
        paso, duracion_paso, maximo, recuperacion = 25, 30, 400, 60

        def tick(self):
            t = self.get_run_time()
            pasos = self.maximo // self.paso
            if t < pasos * self.duracion_paso:
                return (self.paso * (int(t // self.duracion_paso) + 1), 25)
            if t < pasos * self.duracion_paso + 20:
                return (0, 100)        # baja la carga de golpe
            if t < pasos * self.duracion_paso + 20 + self.recuperacion:
                return (5, 5)          # carga mínima para medir la recuperación
            return None
