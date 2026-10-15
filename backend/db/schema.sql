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

-- Cabecera de movimiento. origen/destino según tipo:
--   ENTRADA: proveedor -> bodega | DESPACHO: bodega -> local
--   DEVOLUCION: local -> bodega  | AJUSTE: sobre una ubicación (diferencia con signo)
CREATE TABLE IF NOT EXISTS movimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('ENTRADA','DESPACHO','DEVOLUCION','AJUSTE') NOT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_id INT NOT NULL,
  proveedor_id INT NULL,
  origen_id INT NULL,
  destino_id INT NULL,
  motivo ENUM('TALLA_INCORRECTA','DEFECTO','SOBRANTE','CONTEO','MERMA','OTRO') NULL,
  referencia VARCHAR(60) NULL,
  observacion VARCHAR(255) NULL,
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
