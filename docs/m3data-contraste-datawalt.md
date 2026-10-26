# M3DATA contra Datawalt · contraste del stock de pallet rojo

**Fecha de la medición:** 25 de octubre de 2026
**Alcance:** SKU 11111111110 (pallet rojo 1,00 × 1,20), base CLPRDREDTEC.

## Por qué el contraste sirve

Las dos cifras salen de SAP por caminos que no comparten ningún paso
intermedio.

| | M3DATA | Datawalt |
|---|---|---|
| Acceso | SAP B1 Service Layer (HTTPS) | réplica en ClickHouse |
| Nivel por bodega | `ItemWarehouseInfoCollection.InStock` | `v_inventario_stock`, neto de OINM |
| Nivel por socio | asignaciones de ubicación documento por documento | `v_inventario_bin`, desde `hx_binpallets` |
| Cálculo | hacia atrás desde el saldo vivo | acumulación de movimientos |

Un error de programación de un lado no se puede reproducir del otro. Que las
dos den el mismo número es evidencia; que una sola dé un número no lo es.

## Resultado 1 · nivel por bodega: coincidencia total

Las 22 bodegas con movimiento del SKU coinciden **al pallet**, sin excepción.

| Bodega | M3DATA | Datawalt |
|---|---:|---:|
| BODEGA RETAILERS | 579.026 | 579.026 |
| BODEGA CLIENTES | 212.945 | 212.945 |
| SANTIAGO INSPECCION | 5.447 | 5.447 |
| SANTIAGO PINTURA | 3.664 | 3.664 |
| SANTIAGO MERMA | 2.620 | 2.620 |
| SANTIAGO REPARACION | 1.711 | 1.711 |
| SANTIAGO EXTRAÑOS | 1.544 | 1.544 |
| TALCA INSPECCION | 1.249 | 1.249 |
| SANTIAGO DISPONIBLE | 1.231 | 1.231 |
| TALCA DISPONIBLE | 559 | 559 |
| TALCA PINTURA | 262 | 262 |
| COQUIMBO TRANSITO | 225 | 225 |
| TALCA TRANSITO | 142 | 142 |
| TALCA REPARACION | 0 | 0 |
| (ocho bodegas más, todas en 0) | 0 | 0 |
| **Flota** | **810.625** | **810.625** |

## Resultado 2 · nivel por socio: 42 de los 50 mayores coinciden al pallet

De los 25 socios mayores de retail y los 25 mayores de clientes, 42 dan el
mismo número por los dos caminos. Las ocho diferencias son éstas:

| Socio | M3DATA | Datawalt | Diferencia |
|---|---:|---:|---:|
| WALMART CHILE COMERCIAL | 309.016 | 297.794 | +11.222 |
| RENDIC HERMANOS (Unimarc) | 73.386 | 75.179 | −1.793 |
| ILKO CHILE | 10.472 | 11.255 | −783 |
| CENCOSUD RETAIL | 47.732 | 48.350 | −618 |
| SMU MAYORISTA | 27.234 | 27.649 | −415 |
| ALVI SUPERMERCADO MAYORISTA | 21.786 | 21.983 | −197 |
| LESAFFRE INDUSTRIAL CHILE | 4.637 | 4.641 | −4 |
| FARMACIAS AHUMADA | 499 | 498 | +1 |

Ninguna diferencia es aleatoria: cada una corresponde a ubicaciones cuyo
nombre no permite resolver el socio y que los dos métodos reparten distinto.
La de WALMART es la más grande y tiene candidato identificado: la ubicación
4380, `ZWM11 CD WM EL PENON`, con −11.218 pallets. Datawalt la carga a
WALMART; M3DATA, al no poder resolver el socio desde la descripción, la deja
sin atribuir.

En el resto de la cartera:

| | M3DATA | Datawalt |
|---|---:|---:|
| Socios de retail con saldo | 59 | 59 |
| Socios de clientes con saldo | 69 | 68 |
| Cola de retail (fuera del top 25) | −1.161 en 36 socios | 5.537 en 34 socios |
| Cola de clientes (fuera del top 25) | 21.826 en 56 socios | 21.340 en 43 socios |

La diferencia de −6.698 en la cola de retail la explica casi por completo un
registro que sólo existe en M3DATA: `R11111111-1`, "RETAIL NO HABILITADO",
con −6.488 pallets. Es un saldo imposible y está en revisión.

## Resultado 3 · el pallet sin ubicación existe en los dos métodos

| | M3DATA | Datawalt |
|---|---:|---:|
| Retail · atribuido a un socio | 544.963 | 543.461 |
| Retail · sin ubicación asignada | **34.063 (5,9%)** | **35.565 (6,1%)** |
| Clientes · atribuido a un socio | 211.905 | 212.206 |
| Clientes · sin ubicación asignada | **1.040 (0,5%)** | **739 (0,3%)** |

Es el hallazgo que más cambia la conversación. SAP registra el ingreso de
esos pallets a la bodega sin asignarles ubicación, y ninguna herramienta
construida sobre ubicaciones los puede atribuir: ni la de Datawalt ni la
nuestra. M3DATA atribuye 1.502 pallets de retail **más** que Datawalt, no
menos.

La pregunta que queda abierta es para operaciones, no para sistemas: si ese
movimiento a granel es intencional o es un hueco de registro. De la respuesta
depende si el 5,9% es una categoría legítima o pallet cuya tenencia nadie
puede acreditar.

## Resultado 4 · flujo del año: idéntico en los meses cerrados

Movimiento neto acumulado del 1 de enero al 30 de septiembre, con el mes
cerrado por los dos lados:

| Bodega | M3DATA | Datawalt |
|---|---:|---:|
| BODEGA RETAILERS | 35.759 | 35.759 |
| BODEGA CLIENTES | 22.464 | 22.464 |

Octubre está abierto y ahí las dos cifras se separan. CLIENTES sigue
coincidiendo al pallet (+2.649); RETAIL da +679 por M3DATA y −83 por
Datawalt, 762 de diferencia. La causa es el corte de cada lectura: la réplica
de Datawalt está cortada al 25 de octubre y no registra ningún movimiento de
retail entre el 25 y el 31, mientras que nuestra extracción ya tomó
documentos fechados el 26. SAP acepta documentos post-fechados, así que un
mes en curso siempre va a diferir entre dos lecturas tomadas en momentos
distintos. No es un error de ninguna de las dos.

Esto confirma además la convención de cierre: con el mes cerrado, el
acumulado no se mueve, y el cierre de un día es la apertura del siguiente.

## Qué habilita este contraste

1. El tablero de stock puede presentarse a gerencia con segunda fuente: el
   total de la flota y el saldo de cada bodega están verificados contra un
   sistema independiente.
2. El reemplazo de M2LINK no depende de resolver el 5,9%: el proveedor actual
   tampoco lo resuelve.
3. Las ocho diferencias por socio son una lista finita de ubicaciones a
   corregir, no una incertidumbre de fondo.

## Trabajo que queda, en orden de impacto

1. **Atribuir por código de ubicación cuando la descripción no resuelve.** Los
   códigos siguen el patrón `RETAIL-<GRUPO>-<CADENA>-…`, que identifica al
   socio aunque la descripción no lo haga. Recupera la ubicación 4380 y cierra
   la diferencia de WALMART.
2. **Corregir en SAP los datos que ninguna regla puede salvar:** la ubicación
   5458 (`CLIENTES-TAK-TAK-TAK-001`), la 5253 (`AUSTRAL GRANOS TEMUCO`), el
   RUT `R11111111-1` con −6.488, y el `CardCode` `C969299607` de ORIZON, que
   va sin guión.
3. **Resolver con operaciones** el destino del pallet sin ubicación.

## Cómo reproducir

Nivel por bodega y por socio desde Datawalt, capa semántica `inventario`:

- `inventario_stock`, medida `stock_unidades`, dimensiones `whs_code` y
  `whs_name`, segmento `pallet_rojo`.
- `inventario_bin`, medida `stock_q`, dimensiones `card_code`, `card_name` y
  `tipo_cliente`, segmento `pallet_rojo`.

Lo mismo desde M3DATA:

```
node backfill/sonda-oinm-bodega.js --salida=data/bodegas-hoy.json
node scripts/saldo-pool.js --bodega=RETAIL   --semilla=backfill/s0-semilla-retail-2025-12-31.json --bodegas=data/bodegas-hoy.json --json=data/stock-retail.json
node scripts/saldo-pool.js --bodega=CLIENTES --semilla=backfill/s0-semilla-2025-12-31.json        --bodegas=data/bodegas-hoy.json --json=data/stock-clientes.json
```

Ambos scripts sólo leen. Las credenciales se toman del entorno y el proceso
se detiene nombrando la variable que falte, nunca su valor.
