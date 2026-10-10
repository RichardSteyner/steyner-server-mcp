# steyner-mcp

Servidor [MCP (Model Context Protocol)](https://modelcontextprotocol.io) construido con **NestJS 12 + TypeScript (ESM)** que conecta clientes de IA (Claude, ChatGPT, MCP Inspector, etc.) con un backend de logs técnicos. Expone **tools**, **resources** y **prompts** por HTTP (Streamable HTTP, modo stateless).

> **Estado:** en desarrollo. La autenticación actual es una API key estática (temporal). El objetivo es migrar a OAuth 2.1 con un authorization server (Keycloak) e identidad por usuario.

---

## Qué hace

El MCP actúa como puente entre el modelo y el backend de logs (`https://steyner-log-app.onrender.com/`). Para autenticarse en el backend usa una **cuenta de servicio** dedicada: hace login con correo y contraseña, guarda el JWT en memoria (dura 4 h), lo renueva antes de que caduque y reintenta una vez si recibe un 401.

### Tools

| Tool | Descripción |
|---|---|
| `listar_logs` | Lista los logs vigentes con paginación (`limite`, `desde`, `sort`, `order`). Devuelve `total` y `logs`. |
| `crear_log` | Crea un log. Campos obligatorios: `titulo`, `tipo`, `detalleTipo`, `descripcion`, `solucion`. Opcional: `codigoClave`. El título es único y el backend lo guarda en MAYÚSCULAS. |
| `actualizar_log` | Actualiza campos de un log por `id` (24 caracteres hexadecimales). Envía solo los campos que cambian. |

### Resources

| URI | Descripción |
|---|---|
| `logs://vigentes` | Primera página (10) de los logs vigentes, como contexto de solo lectura. |

### Prompts

| Nombre | Descripción |
|---|---|
| `registrar-log` | Convierte el relato de un problema en un log estructurado y lo registra con `crear_log`. |

### Limitaciones conocidas del backend

- No existe un endpoint para obtener un log por id, así que no hay tool `obtener_log`.
- `vigencia` y `usuario` se ignoran al crear y actualizar: desde el MCP no se puede desactivar un log.
- Al actualizar un id inexistente el backend responde `200` con `null`; el MCP lo traduce a un error claro.
- Algunos errores llegan como `500` genérico (id inválido, título duplicado al actualizar).

---

## Arquitectura

```
Cliente MCP (Claude / ChatGPT / Inspector)
        │  POST /mcp  (Authorization: Bearer <MCP_API_KEY>)
        ▼
  steyner-mcp (NestJS)
        │  ApiKeyGuard → McpService → tools
        │  BackendClient (login, caché de token, re-login en 401)
        │  header x-token
        ▼
  Backend de logs (Express + MongoDB)
```

### Estructura del proyecto

```
steyner-mcp/
├── package.json
├── tsconfig.json
├── nest-cli.json
├── .env.example
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── backend/
    │   ├── backend.module.ts
    │   └── backend-client.service.ts   # login, caché del token, errores
    └── mcp/
        ├── mcp.module.ts
        ├── mcp.controller.ts           # POST /mcp (GET/DELETE → 405)
        ├── mcp.service.ts              # crea el McpServer y registra todo
        ├── api-key.guard.ts            # protección temporal con API key
        └── tools/
            ├── results.ts              # ok(), errorResult(), fail()
            └── logs.tools.ts           # listar, crear, actualizar
```

---

## Requisitos

- **Node.js 20.19+ o 22.12+** (requisito de NestJS 12; se recomienda una versión LTS)
- **pnpm**
- Un usuario dedicado para el MCP en el backend (no reutilices una cuenta personal)

---

## Configuración

Copia `.env.example` a `.env` y completa los valores:

```env
# URL base del backend y ruta de login
BACKEND_URL=https://steyner-log-app.onrender.com/
BACKEND_LOGIN_PATH=/api/auth/login

# Credenciales del usuario dedicado del MCP en el backend
BACKEND_USER_EMAIL=mcp@tudominio.com
BACKEND_USER_PASSWORD=cambia-esto

# Clave que deben enviar los clientes al MCP (Authorization: Bearer ...)
MCP_API_KEY=cambia-esto

# Opcional
PORT=3000
```

Genera una `MCP_API_KEY` segura con:

```bash
node -p "crypto.randomBytes(32).toString('hex')"
```

> **Nunca subas `.env` al repositorio.** Debe estar en `.gitignore` junto con `node_modules` y `dist`.

---

## Ejecutar en local

```bash
# 1. Instalar dependencias
pnpm install

# 2. Desarrollo (recarga automática)
pnpm start:dev

# Alternativa: compilar y ejecutar como en producción
pnpm build
pnpm start:prod
```

El servidor queda en `http://localhost:3000/mcp`.

> Abrir `/mcp` en el navegador responde `405 Method not allowed`. Es lo esperado: el endpoint solo atiende `POST`.

### Scripts

| Script | Acción |
|---|---|
| `pnpm build` | Compila con `nest build` a `dist/` |
| `pnpm start` | Arranca con el CLI de Nest |
| `pnpm start:dev` | Arranca en modo watch |
| `pnpm start:prod` | Ejecuta `node dist/main.js` |

---

## Probar

### MCP Inspector

El paquete del Inspector expone dos ejecutables (`mcp-inspector` y `mcpdo`), por lo que hay que indicar cuál usar:

```bash
# Con pnpm
pnpm --package=@modelcontextprotocol/inspector dlx mcp-inspector

# Con npm
npx -p @modelcontextprotocol/inspector mcp-inspector
```

Configuración en la interfaz:

- **Transport Type:** Streamable HTTP
- **URL:** `http://localhost:3000/mcp`
- **Header:** `Authorization: Bearer <tu MCP_API_KEY>`

Orden de pruebas sugerido:

1. `listar_logs` con `limite: 3`.
2. `crear_log` con un título claramente de prueba (es el backend real, se crea un dato real).
3. `actualizar_log` con el `_id` creado, y luego con un id inexistente.
4. Resource `logs://vigentes` y prompt `registrar-log`.

### curl (PowerShell)

Crea un archivo `body.json`:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

```powershell
# Sin clave: debe responder 401
curl.exe -i -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d "@body.json"

# Con clave: debe listar las tools
curl.exe -X POST http://localhost:3000/mcp -H "Authorization: Bearer TU_CLAVE" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d "@body.json"
```

> Usa `curl.exe` y no `curl`: en PowerShell `curl` es un alias de otro comando. El header `Accept` debe incluir `application/json` y `text/event-stream`.

---

## Despliegue en Render

1. Sube el repositorio a GitHub (sin `.env`).
2. En Render crea un **Web Service** conectado al repositorio.
3. Configura:

| Campo | Valor |
|---|---|
| Runtime | Node |
| Build Command | `pnpm install --frozen-lockfile --prod=false && pnpm build` |
| Start Command | `pnpm start:prod` |

4. En **Environment** añade las variables: `BACKEND_URL`, `BACKEND_LOGIN_PATH`, `BACKEND_USER_EMAIL`, `BACKEND_USER_PASSWORD` y `MCP_API_KEY`. No hace falta definir `PORT`: Render lo inyecta y `main.ts` ya lo lee.
5. Fija la versión de Node, con la variable `NODE_VERSION` o con un campo `engines` en `package.json`:

```json
"engines": { "node": ">=20.19.0" }
```

> Verifica en la documentación de Render los detalles que cambian con el tiempo: cómo fija la versión de Node, cómo detecta pnpm (puede requerir el campo `packageManager` en `package.json`) y el comportamiento de los planes gratuitos (el servicio puede suspenderse tras un periodo de inactividad, lo que provoca arranques lentos).

Con la URL pública de Render, el endpoint del MCP será `https://<tu-servicio>.onrender.com/mcp`.

> **Seguridad:** mientras la protección sea una API key estática, no compartas la URL ni la clave. Quien las tenga puede leer y escribir logs con las credenciales de la cuenta de servicio del MCP.

---

## Historial de lo implementado

### Fase 1: servidor MCP base

1. Planteamiento de la arquitectura: el MCP será un *resource server* de OAuth 2.1; los tokens los emitirá un authorization server aparte.
2. Instalación de dependencias: NestJS 12, SDK de MCP, `zod` y `jose`.
3. Configuración de TypeScript en modo ESM con decoradores experimentales.
4. Servidor MCP con transporte Streamable HTTP en modo stateless (un `McpServer` y un transport por petición).
5. Verificación con MCP Inspector.

### Fase 1.5: conexión al backend

1. `BackendClient`: login con cuenta de servicio, caché del JWT en memoria, renovación preventiva, re-login en 401 y timeouts.
2. Tools de logs con esquemas Zod y descripciones orientadas al modelo.
3. Mapeo de errores del backend a resultados `isError: true` con mensajes claros.
4. `ApiKeyGuard` temporal para no dejar el endpoint abierto.

---

## Lecciones aprendidas

| Problema | Causa | Solución |
|---|---|---|
| Error de decoradores en el editor | El archivo no pertenecía a ningún tsconfig (`TS18003`: no había archivos en `src/`) | Poner todo el código dentro de `src/` |
| `TS1479` al importar `@nestjs/common` | NestJS 12 publica todos sus paquetes como ESM y el proyecto compilaba a CommonJS | `"type": "module"` y `module`/`moduleResolution: "nodenext"` |
| `TS2307` en imports relativos | En ESM los imports relativos exigen extensión | Escribir `./archivo.js` aunque el archivo sea `.ts` |
| `pnpm start:dev` no existía | Faltaban los scripts en `package.json` | Añadir `build`, `start`, `start:dev` y `start:prod` |
| El CLI de Nest no funcionaba | TypeScript 7.0 no expone la API programática que necesita el CLI | Usar `typescript@^6` hasta que la 7.1 la reincorpore |
| `could not determine executable to run` | El Inspector tiene dos binarios | Indicar `mcp-inspector` explícitamente |
| `fetch failed` con `ssl/tls alert handshake failure` | Fallo de TLS entre el MCP y el backend (no es del código) | Probar el dominio en navegador, curl y Node; revisar la versión de Node y la configuración del dominio |

### Buenas prácticas

- El compilador manda, no el editor: ante un error raro, `pnpm exec tsc --noEmit`.
- No ejecutar la app con `tsx`: no emite los metadatos de decoradores que Nest necesita para la inyección de dependencias. Usar `nest start`.
- En PowerShell usar `curl.exe`.
- Verificar la compatibilidad de versiones (Nest, TypeScript, SDK de MCP) antes de actualizar: cambian con rapidez.
- No usar `NODE_TLS_REJECT_UNAUTHORIZED=0` para "arreglar" errores de TLS.
- Evitar rutas de proyecto con tildes o espacios si aparecen errores inexplicables.

---

## Solución de problemas

| Síntoma | Qué revisar |
|---|---|
| `401` del MCP | La cabecera `Authorization: Bearer <MCP_API_KEY>` y que la variable esté definida en el servidor |
| `El MCP no pudo autenticarse en el backend` | `BACKEND_USER_EMAIL`, `BACKEND_USER_PASSWORD` y que el usuario esté activo (`estado: true`) |
| `fetch failed` / error TLS | Que `BACKEND_URL` abra desde el navegador, la versión de Node (usar LTS) y el certificado del dominio |
| `El backend no respondió a tiempo` | Estado del backend; el timeout es de 15 s |
| `Falta la variable de entorno ...` | El `.env` en local, o las variables del servicio en Render |

---

## Hoja de ruta

- [ ] Desplegar en Render y probar con un cliente real.
- [ ] Implementar OAuth 2.1 según la especificación de autorización de MCP:
  - Endpoint `/.well-known/oauth-protected-resource` (RFC 9728).
  - Guard con `jose` que valida firma, `iss`, `exp` y `aud`, y responde `401` con `WWW-Authenticate`.
  - Authorization server (candidato: Keycloak). Antes de decidir, verificar su soporte de Client ID Metadata Documents (preferido por la especificación actual), registro dinámico de clientes (DCR, marcado como obsoleto pero aún usado) y control del claim `aud`.
- [ ] Pasar de cuenta de servicio a identidad por usuario.
- [ ] Mejorar los errores del backend (400 y 404 reales en lugar de 500 genéricos).

---

## Referencias

- [Especificación de autorización de MCP](https://modelcontextprotocol.io/specification/latest/basic/authorization)
- [SDK de MCP para TypeScript](https://github.com/modelcontextprotocol/typescript-sdk)
- [NestJS](https://nestjs.com)