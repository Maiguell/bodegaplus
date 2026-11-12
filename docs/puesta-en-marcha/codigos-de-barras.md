# Estándar de codificación interna y plan de etiquetado (SCRUM-43 · HT05 · HU04)

## Formato del código

Cada variante (referencia + color + talla) tiene un código único de **13 dígitos con estructura EAN-13**:

```
20 0000000123 5
│  │          └─ dígito de control (algoritmo EAN-13)
│  └──────────── id de la variante en el sistema (10 dígitos)
└─────────────── prefijo 20: rango GS1 reservado para uso interno de la tienda
```

- Se asigna **automáticamente** al crear la variante (también al importar el catálogo).
- Se imprime en **Code128**, legible por cualquier lector USB en modo teclado.
- Los campos de búsqueda (disponibilidad, ventas, traslados, conteos, ajustes, kardex) aceptan indistintamente
  el **SKU** (`NIK-AIRFORCE10-BLA-42`) o el **código de barras**.
- El prefijo 20 evita choques con los códigos EAN de los fabricantes, que también pueden leerse si se
  registran en el campo `codigo_barras`.

## Etiqueta

Rollo térmico de **50 × 30 mm**, una etiqueta por par: marca y referencia, color, talla EU, precio,
código de barras y SKU. Se genera en *Etiquetas* (PDF) desde una recepción de compra o desde el catálogo.

## Plan de etiquetado de la mercancía existente

| Paso | Sede | Cuándo | Cómo |
|---|---|---|---|
| 1 | Bodega Central | Semana previa al conteo general | Por referencia: Catálogo → *Etiquetas* → cantidad = pares en bodega. Etiquetar por estantería (B1-E1 … ). |
| 2 | Local Centro | Mismo día del conteo general, antes de contar | Igual, con las existencias de la tienda. |
| 3 | Local Norte | Mismo día del conteo general | Igual. |
| 4 | Mercancía nueva | Desde la salida a producción | Al recibir cada orden de compra: *Imprimir etiquetas de lo recibido*. |

Recomendación: etiquetar **antes** del conteo general (SCRUM-44) para contar con el lector y reducir errores.
