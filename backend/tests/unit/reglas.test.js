/**
 * HT09 — Pruebas unitarias de la lógica de negocio (node:test, sin base de datos).
 * Ejecutar:  npm run test:unit          Cobertura:  npm run test:cobertura
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const r = require('../../lib/reglas');
const { buildSku } = require('../../utils/sku');
const { puede, permisosDe, exigirSede } = require('../../lib/permisos');

describe('HU01 · Generación de variantes (matriz talla × color)', () => {
  it('7 tallas × 2 colores generan 14 variantes únicas', () => {
    const v = r.matrizVariantes([1, 2, 3, 4, 5, 6, 7], [10, 20]);
    assert.equal(v.length, 14);
    assert.equal(new Set(v.map((x) => `${x.colorId}-${x.tallaId}`)).size, 14);
  });
  it('ignora ids repetidos o vacíos', () => {
    assert.equal(r.matrizVariantes([1, 1, 2, null], [5, 5]).length, 2);
    assert.deepEqual(r.matrizVariantes([], [1]), []);
  });
  it('el SKU sigue el formato MARCA-MODELO-COLOR-TALLA sin tildes ni espacios', () => {
    assert.equal(buildSku('Calzado Urbano', 'Tenis Urbano 2045', 'Café', 41), 'CAL-TENISURBAN-CAF-41');
    assert.equal(buildSku('Nike', 'Air Force 1 07', 'Blanco', 42.5), 'NIK-AIRFORCE10-BLA-42.5');
  });
});

describe('HT05 · Código de barras interno', () => {
  it('genera un EAN-13 con prefijo 20 y dígito de control válido', () => {
    const c = r.codigoBarrasVariante(1);
    // 2·1 + 0 + … + 1·3 = 5 → dígito de control (10 − 5) % 10 = 5
    assert.equal(c, '2000000000015');
    assert.ok(r.codigoBarrasValido(c));
  });
  it('es único por variante y detecta códigos alterados', () => {
    const a = r.codigoBarrasVariante(123), b = r.codigoBarrasVariante(124);
    assert.notEqual(a, b);
    assert.equal(r.codigoBarrasValido(a.slice(0, 12) + ((Number(a[12]) + 1) % 10)), false);
  });
  it('rechaza ids inválidos', () => {
    assert.throws(() => r.codigoBarrasVariante(0));
    assert.throws(() => r.codigoBarrasVariante(-5));
    assert.throws(() => r.digitoControlEan13('123'));
  });
});

describe('HT04 · Cálculo de saldo y bloqueo de stock negativo', () => {
  it('suma y resta pares sobre el saldo', () => {
    assert.equal(r.aplicarMovimiento(5, 3), 8);
    assert.equal(r.aplicarMovimiento(5, -5), 0);
  });
  it('nunca deja el saldo negativo ("stock insuficiente")', () => {
    assert.throws(() => r.aplicarMovimiento(1, -2), /Stock insuficiente: disponible 1, solicitado 2/);
  });
  it('rechaza cantidades cero o no enteras', () => {
    assert.throws(() => r.aplicarMovimiento(5, 0));
    assert.throws(() => r.aplicarMovimiento(5, 1.5));
  });
  it('el saldo acumulado del kardex coincide con la suma de movimientos', () => {
    assert.deepEqual(r.saldosAcumulados([10, -2, 5, -13]), [10, 8, 13, 0]);
  });
});

describe('HU11 · Validación de causales de ajuste', () => {
  const activas = ['AVERIA', 'PERDIDA', 'ERROR_CONTEO'];
  it('acepta una causal activa sin importar mayúsculas', () => {
    assert.deepEqual(r.validarCausal('averia', activas), { ok: true, causal: 'AVERIA' });
  });
  it('rechaza causal vacía, inexistente o inactiva', () => {
    assert.equal(r.validarCausal('', activas).ok, false);
    assert.equal(r.validarCausal('ROBO', activas).ok, false);
    assert.match(r.validarCausal('OTRO', activas).error, /no existe o está inactiva/);
  });
});

describe('HU14 · Expiración de reservas', () => {
  it('una reserva de 48 h vence exactamente 48 h después', () => {
    const creada = new Date('2026-11-10T10:00:00');
    assert.equal(r.vencimientoReserva(creada, 48).toISOString(), new Date('2026-11-12T10:00:00').toISOString());
  });
  it('está vigente antes del vencimiento y vencida en el instante o después', () => {
    const vence = new Date('2026-11-12T10:00:00');
    assert.equal(r.reservaVencida(vence, new Date('2026-11-12T09:59:59')), false);
    assert.equal(r.reservaVencida(vence, vence), true);
  });
});

describe('HU15 · Alerta de stock mínimo y sugerido de reposición', () => {
  it('alerta solo por debajo del mínimo (mín. 3: con 3 no, con 2 sí)', () => {
    assert.equal(r.requiereAlerta(3, 3), false);
    assert.equal(r.requiereAlerta(2, 3), true);
  });
  it('sugiere llegar a factor × mínimo y nunca un valor negativo', () => {
    assert.equal(r.sugeridoReposicion(2, 3), 4);
    assert.equal(r.sugeridoReposicion(0, 3, 3), 9);
    assert.equal(r.sugeridoReposicion(10, 3), 0);
  });
});

describe('HU16 · Cálculo de rotación', () => {
  it('existencia promedio diaria con saldo inicial y movimientos', () => {
    // saldo 10; día 0: -2 (8); día 1: 0 (8); día 2: +4 (12) → promedio (8+8+12)/3
    const { promedio, final } = r.existenciaPromedio(10, [-2, 0, 4]);
    assert.ok(Math.abs(promedio - 28 / 3) < 1e-9);
    assert.equal(final, 12);
  });
  it('excluye los días anteriores a la apertura del kardex', () => {
    assert.equal(r.existenciaPromedio(0, [0, 0, 6, 0]).promedio, 3);
    assert.equal(r.existenciaPromedio(0, [0, 0, 6, 0], 2).promedio, 6);
  });
  it('índice = vendidas / existencia promedio; null sin existencia', () => {
    assert.equal(r.indiceRotacion(6, 12), 0.5);
    assert.equal(r.indiceRotacion(3, 0), null);
  });
});

describe('HU17 · Valorización del inventario', () => {
  const filas = [
    { sede: 'Centro', categoria: 'Running', cantidad: 2, valor: 200 },
    { sede: 'Centro', categoria: 'Lifestyle', cantidad: 1, valor: 150 },
    { sede: 'Norte', categoria: 'Running', cantidad: 4, valor: 400 },
  ];
  it('agrupa cantidades y valor por sede', () => {
    const porSede = r.agrupar(filas, (f) => ({ id: f.sede, sede: f.sede }), ['cantidad', 'valor']);
    assert.deepEqual(porSede, [{ id: 'Centro', sede: 'Centro', cantidad: 3, valor: 350 }, { id: 'Norte', sede: 'Norte', cantidad: 4, valor: 400 }]);
  });
  it('el total por categoría coincide con el total general', () => {
    const porCat = r.agrupar(filas, (f) => ({ id: f.categoria }), ['valor']);
    assert.equal(porCat.reduce((s, g) => s + g.valor, 0), 750);
  });
});

describe('RNF-05 / HU20 · Política de contraseñas y bloqueo', () => {
  it('acepta 8+ caracteres con letras y números', () => {
    assert.deepEqual(r.validarPassword('Bodega2026'), { ok: true, errores: [] });
  });
  it('rechaza contraseñas cortas, sin números o sin letras', () => {
    assert.equal(r.validarPassword('abc12').ok, false);
    assert.match(r.validarPassword('solamenteletras').errores.join(), /número/);
    assert.match(r.validarPassword('12345678').errores.join(), /letra/);
    assert.equal(r.validarPassword(undefined).ok, false);
  });
  it('bloquea 15 minutos al quinto intento fallido', () => {
    const ahora = new Date('2026-11-11T10:00:00');
    assert.deepEqual(r.registrarIntentoFallido(3, { ahora }), { intentos: 4, bloqueadoHasta: null });
    const quinto = r.registrarIntentoFallido(4, { ahora });
    assert.equal(quinto.bloqueadoHasta.toISOString(), new Date('2026-11-11T10:15:00').toISOString());
    assert.equal(r.estaBloqueado(quinto.bloqueadoHasta, ahora), true);
    assert.equal(r.estaBloqueado(quinto.bloqueadoHasta, new Date('2026-11-11T10:15:01')), false);
  });
});

describe('HU02 · Plantilla CSV del catálogo', () => {
  it('lee CSV con ; o , y comillas', () => {
    const { columnas, filas } = r.leerCSV('﻿Marca;Categoría;Referencia\r\nNike;"Running; trail";"Pegasus ""40"""\n');
    assert.deepEqual(columnas, ['marca', 'categoria', 'referencia']);
    assert.equal(filas[0].categoria, 'Running; trail');
    assert.equal(filas[0].referencia, 'Pegasus "40"');
    assert.equal(r.leerCSV('a,b\n1,2').filas[0].b, '2');
  });
  it('expande rangos y listas de tallas', () => {
    assert.deepEqual(r.expandirTallas('36-42'), [36, 37, 38, 39, 40, 41, 42]);
    assert.deepEqual(r.expandirTallas('38|38.5| 39'), [38, 38.5, 39]);
    assert.equal(r.expandirTallas('42-36'), null);
    assert.equal(r.expandirTallas('grande'), null);
  });
  it('valida filas y explica el motivo del rechazo', () => {
    const ok = r.validarFilaCatalogo({ marca: 'X', categoria: 'Y', referencia: 'Z', genero: 'Unisex', colores: 'Negro|Blanco', tallas: '36-42', costo: '90000', precio: '179.900' });
    assert.equal(ok.ok, true);
    assert.equal(ok.datos.precio, 179900);
    assert.equal(ok.datos.colores.length, 2);
    assert.match(r.validarFilaCatalogo({ marca: 'X', categoria: 'Y', referencia: 'Z', colores: 'N', tallas: '40' }).motivo, /precio/);
    assert.match(r.validarFilaCatalogo({ marca: 'X', categoria: 'Y', referencia: 'Z', colores: 'N', tallas: '40', precio: '100', costo: '200' }).motivo, /costo es mayor/);
    assert.match(r.validarFilaCatalogo({ marca: 'X', categoria: 'Y', referencia: 'Z', genero: 'Gato', colores: 'N', tallas: '40', precio: '100' }).motivo, /Género/);
  });
});

describe('HU19 · Permisos por rol y sede', () => {
  it('el administrador puede todo; el auditor solo consulta', () => {
    assert.ok(puede('ADMIN', 'usuarios'));
    assert.ok(puede('AUDITOR', 'kardex.ver'));
    assert.equal(puede('AUDITOR', 'ventas'), false);
  });
  it('el vendedor vende pero no aprueba ajustes ni administra usuarios', () => {
    assert.ok(puede('VENDEDOR', 'ventas'));
    assert.equal(puede('VENDEDOR', 'ajustes.aprobar'), false);
    assert.equal(permisosDe('VENDEDOR').includes('usuarios'), false);
  });
  it('un vendedor solo opera en su sede (403 en otra)', () => {
    const vendedor = { rol: 'VENDEDOR', sedeId: 2 };
    assert.doesNotThrow(() => exigirSede(vendedor, 2));
    assert.throws(() => exigirSede(vendedor, 3), (e) => e.status === 403);
    assert.doesNotThrow(() => exigirSede({ rol: 'JEFE_BODEGA', sedeId: 1 }, 3));
  });
});
