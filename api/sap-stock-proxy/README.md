# SAP-STOCK-PROXY

Proxy en Azure Function (Node.js) para consultar el stock de clientes desde SAP B1 Service Layer.

## Estructura

```
sap-stock-proxy/
├── index.js          # lógica del proxy (login + query + cache)
└── function.json     # configuración de Azure Function (HTTP trigger)
```

## Configuración requerida

En la Function App (Azure Portal → Configuration → Application settings):

| Setting          | Valor                                                                                          |
|------------------|------------------------------------------------------------------------------------------------|
| SAP_USER         | virtualdv\red.sistemas (un solo backslash)                                                     |
| SAP_PASS         | (password actualizado)                                                                         |
| SAP_DB           | CLPRDREDTEC                                                                                    |
| SAP_LOGIN_URL    | https://hwvdvc02sbo01.virtualdv.cloud:50000/b1s/v2/Login                                       |
| SAP_DATA_URL     | https://hwvdvc02sbo01.virtualdv.cloud:50000/b1s/v1/sml.svc/STOCKHISTCLIENTE                    |

## CORS requerido

Function App → CORS, agregar:
- https://ashy-island-0089d900f.2.azurestaticapps.net
- (opcional) http://localhost:8080
- (opcional) http://127.0.0.1:5500

Marcar "Enable Access-Control-Allow-Credentials".

## Despliegue

### Opción 1: Subir a GitHub y deploy automático
Si la Function App está conectada al repo, hacer commit de la carpeta `sap-stock-proxy/` en `/api/sap-stock-proxy/` (o donde correspondan las Functions).

### Opción 2: VS Code (Azure Functions extension)
- Instalar extensión "Azure Functions" de Microsoft
- Comando: "Azure Functions: Deploy to Function App..."
- Seleccionar Function App `func-redtec-sap`

### Opción 3: Azure CLI
```bash
cd sap-stock-proxy
func azure functionapp publish func-redtec-sap
```

## Endpoints

### Test de login (sin consultar data)
```
GET /api/sap-stock-proxy?test=1
```
Respuesta exitosa:
```json
{
  "ok": true,
  "mensaje": "Login a SAP exitoso",
  "sessionId": "abc12345...",
  "routeId": "...",
  "tomo_ms": 1234
}
```

### Consultar stock con filtros
```
GET /api/sap-stock-proxy?cliente=XXXX
GET /api/sap-stock-proxy?desde=2026-01-01&hasta=2026-04-30
GET /api/sap-stock-proxy?cliente=XXXX&desde=2026-01-01&hasta=2026-04-30
```

### Consultar todo (CUIDADO: puede ser muy grande)
```
GET /api/sap-stock-proxy
```

## Errores comunes

| Error                                         | Causa probable                                          | Solución                                                           |
|-----------------------------------------------|---------------------------------------------------------|--------------------------------------------------------------------|
| Application Settings incompletas              | Faltan variables en Configuration                       | Agregarlas y "Save" en Azure Portal                                |
| Login SAP falló (HTTP 401)                    | Credenciales inválidas                                  | Verificar SAP_USER, SAP_PASS, SAP_DB                               |
| Login SAP falló (HTTP 503)                    | SAP B1 ocupado o reiniciando                            | Reintentar en unos segundos                                        |
| Timeout (30s) conectando a SAP                | Red bloqueada / SAP no accesible desde Azure            | Verificar firewall del SAP, considerar VNet integration            |
| ENOTFOUND hwvdvc02sbo01.virtualdv.cloud       | DNS no resuelve desde Azure                             | Verificar URL · si es interno, requiere VNet integration con DNS   |
| ECONNREFUSED                                  | Puerto 50000 cerrado en el firewall del SAP             | Pedir al admin del SAP que abra el puerto a las IPs de Azure       |
| Cert SSL                                      | Cert autofirmado de SAP                                 | YA RESUELTO en el código (rejectUnauthorized: false)               |
