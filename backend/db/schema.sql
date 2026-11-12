-- Esquema MySQL: Bodega central de zapatillas que distribuye a 2 locales (stock por pares)
CREATE DATABASE IF NOT EXISTS bodega_sneakers CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bodega_sneakers;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  rol ENUM('ADMIN','OPERADOR') NOT NULL DEFAULT 'OPERADOR',
  activo TINYINT(1) NOT NULL DEFAULT 1
);

-- Una bodega central y los locales a los que despacha
CREATE TABLE IF NOT EXISTS ubicaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE,
  tipo ENUM('BODEGA','LOCAL') NOT NULL,
  direccion VARCHAR(150) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS marcas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL UNIQUE,
  activo TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS colores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(40) NOT NULL UNIQUE,
  hex CHAR(7) NULL
);

-- Equivalencias de talla (CO usa la escala EU)
CREATE TABLE IF NOT EXISTS tallas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  genero ENUM('HOMBRE','MUJER','UNISEX','NINO') NOT NULL,
  us DECIMAL(3,1) NOT NULL,
  eu DECIMAL(3,1) NOT NULL,
  cm DECIMAL(4,1) NULL,
  UNIQUE KEY uq_talla (genero, us, eu)
);

CREATE TABLE IF NOT EXISTS modelos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  marca_id INT NOT NULL,
  categoria_id INT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  genero ENUM('HOMBRE','MUJER','UNISEX','NINO') NOT NULL DEFAULT 'UNISEX',
  codigo_estilo VARCHAR(40) NULL,
  precio_base DECIMAL(12,2) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (marca_id) REFERENCES marcas(id),
  FOREIGN KEY (categoria_id) REFERENCES categorias(id),
  UNIQUE KEY uq_modelo (marca_id, nombre, genero)
);

-- Unidad de inventario: modelo + color + talla
CREATE TABLE IF NOT EXISTS variantes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  modelo_id INT NOT NULL,
  color_id INT NOT NULL,
  talla_id INT NOT NULL,
  sku VARCHAR(40) NOT NULL UNIQUE,
  codigo_barras VARCHAR(40) NULL UNIQUE,
  precio DECIMAL(12,2) NOT NULL DEFAULT 0,
  stock_minimo INT NOT NULL DEFAULT 2,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (modelo_id) REFERENCES modelos(id),
  FOREIGN KEY (color_id) REFERENCES colores(id),
  FOREIGN KEY (talla_id) REFERENCES tallas(id),
  UNIQUE KEY uq_variante (modelo_id, color_id, talla_id)
);

-- Pares disponibles por variante en cada ubicación (bodega o local)
CREATE TABLE IF NOT EXISTS stock (
  variante_id INT NOT NULL,
  ubicacion_id INT NOT NULL,
  cantidad INT NOT NULL DEFAULT 0,
  PRIMARY KEY (variante_id, ubicacion_id),
  FOREIGN KEY (variante_id) REFERENCES variantes(id),
  FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id),
  CONSTRAINT chk_stock_no_negativo CHECK (cantidad >= 0)
);

CREATE TABLE IF NOT EXISTS proveedores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  contacto VARCHAR(100) NULL
);

-- HU05: Órdenes de compra a proveedor y lo recibido contra cada una
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,            -- OC-0012
  proveedor_id INT NOT NULL,
  destino_id INT NOT NULL,                       -- sede que recibe
  estado ENUM('PENDIENTE','RECIBIDA_PARCIAL','RECIBIDA','ANULADA') NOT NULL DEFAULT 'PENDIENTE',
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_id INT NOT NULL,
  observacion VARCHAR(255) NULL,
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
  FOREIGN KEY (destino_id) REFERENCES ubicaciones(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS orden_compra_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orden_id INT NOT NULL,
  variante_id INT NOT NULL,
  cantidad_pedida INT NOT NULL,
  cantidad_recibida INT NOT NULL DEFAULT 0,
  FOREIGN KEY (orden_id) REFERENCES ordenes_compra(id),
  FOREIGN KEY (variante_id) REFERENCES variantes(id),
  UNIQUE KEY uq_oc_variante (orden_id, variante_id),
  CONSTRAINT chk_oc_pedida CHECK (cantidad_pedida > 0)
);

-- HU08 / HU09: Traslados entre sedes (los pares quedan "en tránsito" hasta que el destino confirma)
CREATE TABLE IF NOT EXISTS traslados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  origen_id INT NOT NULL,
  destino_id INT NOT NULL,
  estado ENUM('EN_TRANSITO','RECIBIDO','RECIBIDO_CON_NOVEDAD') NOT NULL DEFAULT 'EN_TRANSITO',
  usuario_envia_id INT NOT NULL,
  fecha_envio DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_recibe_id INT NULL,
  fecha_recepcion DATETIME NULL,
  observacion VARCHAR(255) NULL,
  novedad VARCHAR(500) NULL,                     -- diferencias detectadas al recibir
  novedad_estado ENUM('PENDIENTE','REVISADA') NULL,
  novedad_comentario VARCHAR(255) NULL,
  novedad_revisada_por INT NULL,
  FOREIGN KEY (origen_id) REFERENCES ubicaciones(id),
  FOREIGN KEY (destino_id) REFERENCES ubicaciones(id),
  FOREIGN KEY (usuario_envia_id) REFERENCES usuarios(id),
  FOREIGN KEY (usuario_recibe_id) REFERENCES usuarios(id),
  FOREIGN KEY (novedad_revisada_por) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS traslado_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  traslado_id INT NOT NULL,
  variante_id INT NOT NULL,
  cantidad_enviada INT NOT NULL,
  cantidad_recibida INT NULL,
  FOREIGN KEY (traslado_id) REFERENCES traslados(id),
  FOREIGN KEY (variante_id) REFERENCES variantes(id),
  UNIQUE KEY uq_traslado_variante (traslado_id, variante_id)
);

-- HU14: Reservas temporales de unidades para un cliente
CREATE TABLE IF NOT EXISTS reservas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  variante_id INT NOT NULL,
  ubicacion_id INT NOT NULL,
  cantidad INT NOT NULL DEFAULT 1,
  cliente_nombre VARCHAR(100) NOT NULL,
  cliente_telefono VARCHAR(30) NULL,
  estado ENUM('ACTIVA','VENDIDA','VENCIDA','CANCELADA') NOT NULL DEFAULT 'ACTIVA',
  creada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vence_en DATETIME NOT NULL,
  cerrada_en DATETIME NULL,
  usuario_id INT NOT NULL,
  FOREIGN KEY (variante_id) REFERENCES variantes(id),
  FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_reserva_estado (estado, vence_en)
);

-- Cabecera de movimiento. origen/destino según tipo:
--   ENTRADA: proveedor -> sede        | DESPACHO: bodega -> local
--   DEVOLUCION: local -> bodega       | AJUSTE: sobre una sede (diferencia con signo)
--   VENTA: sede -> cliente            | CAMBIO: misma sede (+talla devuelta, -talla nueva)
--   TRASLADO_ENVIO: origen -> tránsito | TRASLADO_RECEPCION: tránsito -> destino
--   RESERVA / LIBERACION_RESERVA: aparta o devuelve unidades al disponible de la sede
-- Solo inserción: los triggers de db/index.js impiden editar o borrar (RNF-04).
CREATE TABLE IF NOT EXISTS movimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('ENTRADA','DESPACHO','DEVOLUCION','AJUSTE','VENTA','CAMBIO',
            'TRASLADO_ENVIO','TRASLADO_RECEPCION','RESERVA','LIBERACION_RESERVA') NOT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_id INT NOT NULL,
  proveedor_id INT NULL,
  origen_id INT NULL,
  destino_id INT NULL,
  motivo ENUM('TALLA_INCORRECTA','DEFECTO','SOBRANTE','CONTEO','MERMA','OTRO') NULL,
  referencia VARCHAR(60) NULL,
  observacion VARCHAR(255) NULL,
  orden_compra_id INT NULL,
  traslado_id INT NULL,
  reserva_id INT NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
  FOREIGN KEY (origen_id) REFERENCES ubicaciones(id),
  FOREIGN KEY (destino_id) REFERENCES ubicaciones(id)
);

CREATE TABLE IF NOT EXISTS movimiento_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  movimiento_id INT NOT NULL,
  variante_id INT NOT NULL,
  cantidad INT NOT NULL,  -- pares; en AJUSTE puede ser negativa
  FOREIGN KEY (movimiento_id) REFERENCES movimientos(id) ON DELETE CASCADE,
  FOREIGN KEY (variante_id) REFERENCES variantes(id)
);

-- HT04 / HU07: Kardex. Una fila por cada cambio de stock de una variante en una sede,
-- con el saldo resultante. movimiento_id NULL = saldo inicial al activar el kardex.
CREATE TABLE IF NOT EXISTS kardex (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  movimiento_id INT NULL,
  variante_id INT NOT NULL,
  ubicacion_id INT NOT NULL,
  cantidad INT NOT NULL,                         -- con signo
  saldo INT NOT NULL,                            -- saldo en la sede después del cambio
  fecha DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (movimiento_id) REFERENCES movimientos(id),
  FOREIGN KEY (variante_id) REFERENCES variantes(id),
  FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id),
  INDEX idx_kardex_variante (variante_id, id)
);
