/**
 * @file lib/reglas.js
 * @description Reglas de negocio puras (sin base de datos ni HTTP), usadas por las rutas y
 * cubiertas por las pruebas unitarias de HT09:
 *   - Política de contraseñas y bloqueo por intentos fallidos (RNF-05, HU20)
 *   - Matriz de variantes talla × color (HU01) y código de barras interno EAN-13 (HT05)
 *   - Saldos del kardex y bloqueo de stock negativo (HT04)
 *   - Causales de ajuste (HU11), vencimiento de reservas (HU14), sugerido de reposición (HU15)
 *   - Existencia promedio e índice de rotación (HU16), agregación del valorizado (HU17)
 *   - Lectura y validación de la plantilla CSV del catálogo (HU02)
 */

'use strict';

// ── RNF-05 / HU20: contraseñas y bloqueo ──────────────────────────────────────

/**
 * Valida una contraseña: mínimo `min` caracteres, al menos una letra y un número.
 * @returns {{ok: boolean, errores: string[]}}
 */
function validarPassword(password, { min = 8 } = {}) {
  const p = String(password ?? '');
  const errores = [];
  if (p.length < min) errores.push(`Debe tener al menos ${min} caracteres.`);
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(p)) errores.push('Debe incluir al menos una letra.');
  if (!/\d/.test(p)) errores.push('Debe incluir al menos un número.');
  if (/^\s|\s$/.test(p)) errores.push('No puede empezar ni terminar con espacios.');
  return { ok: errores.length === 0, errores };
}

/** ¿La cuenta está bloqueada en este momento? */
const estaBloqueado = (bloqueadoHasta, ahora = new Date()) => !!bloqueadoHasta && new Date(bloqueadoHasta) > ahora;

/**
 * Registra un intento fallido: al llegar a `maxIntentos` bloquea por `minutos`.
 * @returns {{intentos: number, bloqueadoHasta: Date|null}}
 */
function registrarIntentoFallido(intentos, { maxIntentos = 5, minutos = 15, ahora = new Date() } = {}) {
  const n = (Number(intentos) || 0) + 1;
  if (n >= maxIntentos) return { intentos: 0, bloqueadoHasta: new Date(ahora.getTime() + minutos * 60_000) };
  return { intentos: n, bloqueadoHasta: null };
}

// ── HU01 / HT05: variantes y código de barras ─────────────────────────────────

/** Todas las combinaciones talla × color, sin repetidos. HU01: 7 tallas × 2 colores = 14 variantes. */
function matrizVariantes(tallaIds, colorIds) {
  const tallas = [...new Set((tallaIds ?? []).map(Number).filter(Boolean))];
  const colores = [...new Set((colorIds ?? []).map(Number).filter(Boolean))];
  return colores.flatMap((colorId) => tallas.map((tallaId) => ({ colorId, tallaId })));
}

/** Dígito de control EAN-13 para 12 dígitos. */
function digitoControlEan13(doce) {
  if (!/^\d{12}$/.test(doce)) throw new Error('Se requieren 12 dígitos.');
  const suma = [...doce].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (suma % 10)) % 10);
}

/**
 * Código interno de una variante: EAN-13 con prefijo 20 (rango reservado para uso interno de la tienda),
 * el id de la variante en 10 dígitos y el dígito de control. Se imprime como Code128.
 */
function codigoBarrasVariante(varianteId) {
  const id = Number(varianteId);
  if (!Number.isInteger(id) || id <= 0 || id > 9_999_999_999) throw new Error('Id de variante inválido.');
  const doce = `20${String(id).padStart(10, '0')}`;
  return doce + digitoControlEan13(doce);
}

const codigoBarrasValido = (codigo) => /^\d{13}$/.test(codigo) && digitoControlEan13(codigo.slice(0, 12)) === codigo[12];

// ── HT04: saldos ──────────────────────────────────────────────────────────────

/** Saldo después de aplicar un movimiento; nunca negativo (lanza "Stock insuficiente"). */
function aplicarMovimiento(saldo, delta) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error('La cantidad debe ser un entero distinto de cero.');
  const nuevo = saldo + delta;
  if (nuevo < 0) throw new Error(`Stock insuficiente: disponible ${saldo}, solicitado ${-delta}.`);
  return nuevo;
}

/** Saldos acumulados de una lista de cantidades con signo (como el kardex). */
const saldosAcumulados = (cantidades, inicial = 0) => {
  let s = inicial;
  return cantidades.map((c) => (s += c));
};

// ── HU11 / HU14 / HU15 ────────────────────────────────────────────────────────

/** Valida la causal contra las causales activas (configurables, RNF-08). */
function validarCausal(causal, causalesActivas) {
  const c = String(causal ?? '').trim().toUpperCase();
  if (!c) return { ok: false, error: 'Indica la causal del ajuste.' };
  if (!causalesActivas.includes(c)) return { ok: false, error: `La causal "${causal}" no existe o está inactiva.` };
  return { ok: true, causal: c };
}

const vencimientoReserva = (creada, horas) => new Date(new Date(creada).getTime() + horas * 3_600_000);
const reservaVencida = (venceEn, ahora = new Date()) => new Date(venceEn) <= ahora;

/** Alerta si la existencia queda POR DEBAJO del mínimo. */
const requiereAlerta = (stock, minimo) => stock < minimo;

/** Sugerido de reposición: lo que falta para llegar a factor × mínimo (por defecto 2 × mínimo). */
const sugeridoReposicion = (stock, minimo, factor = 2) => Math.max(Math.ceil(factor * minimo) - stock, 0);

// ── HU16 / HU17 ───────────────────────────────────────────────────────────────

/**
 * Existencia promedio diaria: saldo inicial + cambios por día; promedia los saldos al cierre
 * desde el día `desde` (índice) para excluir días sin datos (antes de abrir el kardex).
 */
function existenciaPromedio(saldoInicial, deltasPorDia, desde = 0) {
  const dias = deltasPorDia.length;
  if (!dias || desde >= dias) return { promedio: 0, final: saldoInicial };
  let s = saldoInicial, acum = 0;
  for (let i = 0; i < dias; i++) { s += deltasPorDia[i] || 0; if (i >= desde) acum += s; }
  return { promedio: acum / (dias - desde), final: s };
}

/** Índice de rotación = vendidas / existencia promedio (null si no hubo existencia). */
const indiceRotacion = (vendidas, promedio) => (promedio > 0 ? Math.round((vendidas / promedio) * 1000) / 1000 : null);

/** Agrupa filas sumando campos numéricos; `clave(fila)` devuelve { id, ...campos descriptivos }. */
function agrupar(filas, clave, campos) {
  const m = new Map();
  for (const f of filas) {
    const k = clave(f);
    if (!m.has(k.id)) m.set(k.id, { ...k, ...Object.fromEntries(campos.map((c) => [c, 0])) });
    const g = m.get(k.id);
    for (const c of campos) g[c] += Number(f[c]) || 0;
  }
  return [...m.values()];
}

// ── HU02: plantilla CSV del catálogo ──────────────────────────────────────────

const COLUMNAS_CATALOGO = ['marca', 'categoria', 'referencia', 'genero', 'codigo_estilo', 'colores', 'tallas', 'costo', 'precio'];

/** Lee CSV (separador ; o , detectado en la cabecera; comillas dobles). Devuelve filas como objetos. */
function leerCSV(texto) {
  const limpio = String(texto ?? '').replace(/^﻿/, '');
  const primera = limpio.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primera.match(/;/g) ?? []).length >= (primera.match(/,/g) ?? []).length ? ';' : ',';
  const filas = [];
  let campo = '', fila = [], comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') comillas = false; else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  const datos = filas.filter((f) => f.some((c) => c.trim() !== ''));
  if (!datos.length) return { columnas: [], filas: [] };
  const columnas = datos[0].map((c) => c.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_'));
  return {
    columnas,
    filas: datos.slice(1).map((f, i) => ({ _fila: i + 2, ...Object.fromEntries(columnas.map((c, j) => [c, (f[j] ?? '').trim()])) })),
  };
}

/** "36-42" → [36..42]; "38, 38.5, 39" o "38|38.5|39" → [38, 38.5, 39] (decimales con punto). null si no se entiende. */
function expandirTallas(texto) {
  const t = String(texto ?? '').replace(/\s/g, '');
  if (!t) return null;
  const rango = t.match(/^(\d+(?:\.5)?)-(\d+(?:\.5)?)$/);
  if (rango) {
    const [a, b] = [Number(rango[1]), Number(rango[2])];
    if (a > b || b - a > 20) return null;
    const out = [];
    for (let x = a; x <= b; x += 1) out.push(x);
    return out;
  }
  const lista = t.split(/[,|;/]/).map(Number);
  return lista.every((n) => Number.isFinite(n) && n > 0) ? [...new Set(lista)] : null;
}

const GENEROS = ['HOMBRE', 'MUJER', 'UNISEX', 'NINO'];

/** Valida una fila de la plantilla; devuelve { ok, datos } o { ok: false, motivo }. */
function validarFilaCatalogo(fila) {
  const v = (k) => String(fila[k] ?? '').trim();
  const faltan = ['marca', 'categoria', 'referencia', 'colores', 'tallas', 'precio'].filter((k) => !v(k));
  if (faltan.length) return { ok: false, motivo: `Faltan datos: ${faltan.join(', ')}.` };
  const genero = (v('genero') || 'UNISEX').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!GENEROS.includes(genero)) return { ok: false, motivo: `Género inválido "${v('genero')}" (usa Hombre, Mujer, Unisex o Nino).` };
  const tallas = expandirTallas(v('tallas'));
  if (!tallas) return { ok: false, motivo: `Tallas inválidas "${v('tallas')}" (ej. 36-42 o 38|39|40).` };
  const colores = [...new Set(v('colores').split(/[|/;,]/).map((c) => c.trim()).filter(Boolean))];
  if (!colores.length) return { ok: false, motivo: 'Indica al menos un color.' };
  const num = (s) => Number(String(s).replace(/[$\s.]/g, '').replace(',', '.'));
  const precio = num(v('precio'));
  const costo = v('costo') ? num(v('costo')) : null;
  if (!Number.isFinite(precio) || precio <= 0) return { ok: false, motivo: `Precio inválido "${v('precio')}".` };
  if (costo !== null && (!Number.isFinite(costo) || costo < 0)) return { ok: false, motivo: `Costo inválido "${v('costo')}".` };
  if (costo !== null && costo > precio) return { ok: false, motivo: 'El costo es mayor que el precio.' };
  return {
    ok: true,
    datos: { marca: v('marca'), categoria: v('categoria'), referencia: v('referencia'), genero, codigoEstilo: v('codigo_estilo') || null, colores, tallas, costo, precio },
  };
}

module.exports = {
  validarPassword, estaBloqueado, registrarIntentoFallido,
  matrizVariantes, digitoControlEan13, codigoBarrasVariante, codigoBarrasValido,
  aplicarMovimiento, saldosAcumulados,
  validarCausal, vencimientoReserva, reservaVencida, requiereAlerta, sugeridoReposicion,
  existenciaPromedio, indiceRotacion, agrupar,
  COLUMNAS_CATALOGO, leerCSV, expandirTallas, validarFilaCatalogo,
};
