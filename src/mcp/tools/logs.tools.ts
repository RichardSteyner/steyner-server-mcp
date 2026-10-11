import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BackendClient } from '../../backend/backend-client.service.js';
import { errorResult, fail, ok } from './results.js';

const LOGS_PATH = '/api/logs';
const UPDATE_METHOD = 'PUT' as const; 

export function registerLogTools(server: McpServer, backend: BackendClient) {
  server.registerTool(
    'listar_logs',
    {
      title: 'Listar logs',
      description:
        'Lista los logs vigentes con paginación. Cada log incluye su `_id`, que se usa en actualizar_log. ' +
        'No hay búsqueda por texto: para encontrar uno, recorre las páginas con `desde`. ' +
        'Devuelve `total` (cantidad de logs vigentes) y `logs`.',
      inputSchema: {
        limite: z.number().int().min(1).max(50).optional().describe('Cantidad por página (1-50). Por defecto 10.'),
        desde: z.number().int().min(0).optional().describe('Cuántos logs saltar (para paginar). Por defecto 0.'),
        sort: z.enum(['titulo', 'tipo', 'detalleTipo', '_id']).optional()
          .describe('Campo de orden. Por defecto "titulo". Usa "_id" con order "desc" para obtener los más recientes primero.'),
        order: z.enum(['asc', 'desc']).optional().describe('Sentido del orden. Por defecto "desc".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limite, desde, sort, order }) => {
      try {
        const data = await backend.request<{ total: number; logs: unknown[] }>('GET', LOGS_PATH, {
          query: { limite, desde, sort, order },
        });
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'crear_log',
    {
      title: 'Crear log',
      description:
        'Crea un log nuevo. El título debe ser único: el backend lo guarda en MAYÚSCULAS y falla si ya existe uno igual. ' +
        'Todos los campos son obligatorios salvo codigoClave. No inventes la solución: si no la conoces, pídela.',
      inputSchema: {
        titulo: z.string().min(1).describe('Título corto y único del log.'),
        tipo: z.string().min(1).describe('Categoría general del log.'),
        detalleTipo: z.string().min(1).describe('Subcategoría o detalle del tipo.'),
        descripcion: z.string().min(1).describe('Descripción del problema o evento.'),
        solucion: z.string().min(1).describe('Solución aplicada o recomendada.'),
        codigoClave: z.string().optional().describe('Fragmento de código o comando clave, si aplica.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const log = await backend.request('POST', LOGS_PATH, { body: args });
        return ok(log);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'actualizar_log',
    {
      title: 'Actualizar log',
      description:
        'Actualiza campos de un log existente. Envía solo los campos que cambian. ' +
        'Si cambias el título, también se guarda en MAYÚSCULAS y no puede coincidir con otro log. ' +
        'No se puede cambiar la vigencia ni el usuario desde aquí.',
      inputSchema: {
        id: z.string().regex(/^[a-f\d]{24}$/i, 'Debe ser un id de 24 caracteres hexadecimales').describe('El `_id` del log.'),
        titulo: z.string().min(1).optional(),
        tipo: z.string().min(1).optional(),
        detalleTipo: z.string().min(1).optional(),
        descripcion: z.string().min(1).optional(),
        solucion: z.string().min(1).optional(),
        codigoClave: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, ...campos }) => {
      const body = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
      if (Object.keys(body).length === 0) {
        return errorResult('Indica al menos un campo para actualizar.');
      }
      try {
        const log = await backend.request<unknown>(UPDATE_METHOD, `${LOGS_PATH}/${id}`, { body });
        // Tu backend responde 200 con null cuando el id no existe
        if (log === null) return errorResult(`No existe ningún log con el id ${id}.`);
        return ok(log);
      } catch (e) {
        return fail(e);
      }
    },
  );
}