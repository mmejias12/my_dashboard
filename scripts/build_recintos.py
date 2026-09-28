#!/usr/bin/env python3
# ============================================================================
#  Arma data/recintos-retiro.json para el modulo Programacion de retiros.
#
#  Entradas (los Excel que mantiene Logistica Inversa):
#    - Reporte_Retiros.xlsx      hoja "Direcciones"  (Clave, Recinto, Direccion, Comuna, Region, Zona)
#    - Data registros APP.xlsx   hoja "Direcciones"  (Cadena, Recinto, Direccion, Comuna, Ciudad, Region, Zona)
#    - registro_pallets.html     const RETAIL_LOCALES  (que bodegas puede elegir el ejecutivo)
#
#  Por que las tres: las dos primeras tienen la direccion/comuna/zona que
#  necesita Transportes; la tercera es la unica que dice que bodegas estan
#  habilitadas para registrar y bajo que retail las busca el ejecutivo.
#  Se mantuvieron por separado, asi que no coinciden: el JSON las une y marca
#  el descalce en vez de esconderlo.
#
#  Llave: "clave" = el codigo del recinto cuando lo tiene (00626, ZUN03,
#  A3074...), si no el nombre completo. Reproduce exactamente la columna
#  "Clave (auxiliar)" del Excel en sus 1.057 filas.
# ============================================================================
import openpyxl, json, re, unicodedata, collections, sys, os

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'recintos-retiro.json'

# --- el encoding del catalogo del HTML llego roto: "ï¿½" es un caracter que
# --- ya se habia perdido antes, asi que no hay como recuperarlo por codigo.
# --- Son 23 tokens y todos son inequivocos, asi que van a mano.
FIX = {'CARREï¿½O':'CARREÑO','CAï¿½ETE':'CAÑETE','COMPAï¿½IAS':'COMPAÑIAS',
 'CONCEPCIï¿½N':'CONCEPCIÓN','EGAï¿½A':'EGAÑA','ESPAï¿½A':'ESPAÑA','Mï¿½CKE':'MÜCKE',
 'NUï¿½OA':'ÑUÑOA','Oï¿½HIGGI':"O'HIGGI",'PEï¿½ABLANCA':'PEÑABLANCA','PEï¿½AFLOR':'PEÑAFLOR',
 'PEï¿½ALO':'PEÑALO','PEï¿½ALOL':'PEÑALOL','PEï¿½ALOLEN':'PEÑALOLEN','PEï¿½ON':'PEÑON',
 'PEï¿½UELA':'PEÑUELA','PEï¿½UELAS':'PEÑUELAS','REï¿½ACA':'REÑACA','VICUï¿½A':'VICUÑA',
 'VIï¿½A':'VIÑA','ï¿½Uï¿½':'ÑUÑ','ï¿½Uï¿½O':'ÑUÑO','ï¿½Uï¿½OA':'ÑUÑOA'}

def arregla(s):
    if 'ï¿½' not in s: return s
    s2 = ' '.join(FIX.get(w, w) for w in s.split(' '))
    if 'ï¿½' in s2:
        raise SystemExit('token roto sin traduccion en FIX: ' + s)
    return s2

def clave_de(recinto):
    t = recinto.strip().split(' ')[0]
    if re.fullmatch(r'[A-Z0-9]{3,6}', t) and re.search(r'\d', t) and len(recinto.strip()) > len(t):
        return t
    return recinto.strip()

def hoja(path, nombre, primera_fila):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[nombre]
    filas = [r for i, r in enumerate(ws.iter_rows(values_only=True)) if i >= primera_fila]
    wb.close()
    return filas

def txt(v): return str(v).strip() if v not in (None, '') else ''

# ---------------------------------------------------------------- 1) maestro
maestro = {}
for r in hoja(os.path.join(SRC, 'Reporte_Retiros.xlsx'), 'Direcciones', 2):
    if not r[1]: continue
    rec = txt(r[1]); k = clave_de(rec).upper()
    maestro[k] = dict(clave=clave_de(rec), recinto=rec, cadena='', direccion=txt(r[2]),
                      comuna=txt(r[3]), region=txt(r[4]), zona=txt(r[5]))
for r in hoja(os.path.join(SRC, 'Data registros APP.xlsx'), 'Direcciones', 1):
    if not r[1]: continue
    rec = txt(r[1]); k = clave_de(rec).upper(); prev = maestro.get(k, {})
    maestro[k] = dict(clave=clave_de(rec), recinto=rec, cadena=txt(r[0]) or prev.get('cadena', ''),
                      direccion=txt(r[2]), comuna=txt(r[3]), region=txt(r[5]), zona=txt(r[6]))
CADENAS_MAESTRO = {v['cadena'] for v in maestro.values() if v['cadena']}

# ------------------------------------------- 2) catalogo habilitado del HTML
html = open(os.path.join(SRC, 'registro_pallets.html'), encoding='utf-8', errors='replace').read()
blk = html[html.index('const RETAIL_LOCALES'):html.index('FIN CONFIGURACIÓN')]
RL = {}; cur = None
for line in blk.splitlines():
    m = re.match(r'^  "(.+)": \[', line)
    if m: cur = arregla(m.group(1)).strip(); RL[cur] = []; continue
    m = re.match(r'^    "(.+?)",?\s*$', line)
    if m and cur: RL[cur].append(arregla(m.group(1)).strip())

# ------------------------------------------------------------------- 3) union
cat = {}
for k, v in maestro.items():
    cat[k] = dict(v, retail_legal='', sin_direccion=False, habilitado=False)

# Match laxo: varios recintos del HTML son el mismo del maestro escrito distinto
# ("ALISERVICE BOD CON CON" vs "ALISERVICE Bod ConCon"). Se comparan sin
# espacios, puntuacion ni acentos para no inventar recintos nuevos sin direccion.
def laxo(s):
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c)).upper()
    return re.sub(r'[^A-Z0-9]+', '', s)
LAXO = {}
for k, v in cat.items():
    LAXO.setdefault(laxo(v['recinto']), k)

for legal, bodegas in RL.items():
    for b in bodegas:
        k = clave_de(b).upper()
        if k not in cat:
            alt = LAXO.get(laxo(b))
            if alt: k = alt
        if k in cat:
            cat[k]['retail_legal'] = legal; cat[k]['habilitado'] = True
            if len(b) > len(cat[k]['recinto']): cat[k]['recinto'] = b
        else:
            cat[k] = dict(clave=clave_de(b), recinto=b, cadena='', retail_legal=legal,
                          direccion='', comuna='', region='', zona='',
                          sin_direccion=True, habilitado=True)

# ------------------------- 4) una sola dimension de retail (cadena canonica)
pares = collections.defaultdict(collections.Counter)
for v in cat.values():
    if v['retail_legal'] and v['cadena'] and v['retail_legal'] != v['cadena']:
        pares[v['retail_legal']][v['cadena']] += 1
legal2cadena = {L: c.most_common(1)[0][0] for L, c in pares.items()}
for v in cat.values():
    v['cadena'] = legal2cadena.get(v['retail_legal'], v['cadena'] or v['retail_legal'])
    if not v['retail_legal']: v['retail_legal'] = v['cadena']

SUF = r'\b(SA|SPA|LTDA|LIMITADA|EIRL|HIJOS|CIA|COMERCIAL|COMERCIALIZADORA|COMERZIALIZADORA|DISTRIBUIDORA|DIST|SUPERMERCADOS|SUPERMERCADO|SUPER|AGRICOLA|FORESTAL|CHILE|RETAIL|CENTRAL|COMPRAS|DISTRIBUCION|SERVICIOS|INTEGRADOR|PRODUCTOS|ALIMENTICIOS|AGROINDUSTRIALES|AGROINDUSTRIA|CORPORACION|ALIMENTOS|MAYORISTA|Y|DE|E|LA|EL)\b'
def key(s):
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c)).upper()
    s = re.sub(r'[^A-Z0-9 ]+', ' ', s)
    s = re.sub(r'\bS\s+A\b', 'SA', ' '.join(s.split()))
    return ' '.join(re.sub(SUF, ' ', s).split())

grupos = collections.defaultdict(set)
for c in {v['cadena'] for v in cat.values() if v['cadena']}: grupos[key(c)].add(c)
canon = {}
for k, names in grupos.items():
    if not k: continue
    # se prefiere el nombre del maestro (corto y en capitalizacion normal);
    # si ninguno viene del maestro, el mas corto.
    delmaestro = sorted(names & CADENAS_MAESTRO, key=len)
    best = delmaestro[0] if delmaestro else sorted(names, key=lambda n: (len(n), n))[0]
    for n in names: canon[n] = best
for v in cat.values(): v['cadena'] = canon.get(v['cadena'], v['cadena'])

# --------------------------------------------------------------- 5) salida
filas = sorted(cat.values(), key=lambda v: (v['cadena'].upper(), v['recinto'].upper()))
hab = [v for v in filas if v['habilitado']]
meta = dict(
    generado='2026-09-28',
    fuentes=['Reporte_Retiros.xlsx · Direcciones', 'Data registros APP.xlsx · Direcciones',
             'registro_pallets.html · RETAIL_LOCALES v2'],
    total=len(filas), habilitados=len(hab),
    habilitados_sin_direccion=sum(1 for v in hab if v['sin_direccion']),
    con_direccion_no_habilitados=sum(1 for v in filas if not v['habilitado']),
    cadenas=len({v['cadena'] for v in filas}),
    zonas=sorted({v['zona'] for v in filas if v['zona']}),
    llave='clave = codigo del recinto si lo tiene, si no el nombre completo',
)
json.dump({'meta': meta, 'recintos': filas}, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
for k, v in meta.items():
    if k != 'zonas': print(f'  {k}: {v}')
print(f'  zonas: {len(meta["zonas"])}')
print(f'  archivo: {OUT}  ({round(os.path.getsize(OUT)/1024,1)} KB)')
