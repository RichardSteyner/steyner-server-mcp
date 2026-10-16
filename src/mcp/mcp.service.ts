import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth-context.js';
import { BackendClient } from '../backend/backend-client.service.js';
import { registerLogTools } from './tools/logs.tools.js';

@Injectable()
export class McpService {
  // Import normal (no "import type"): Nest necesita la clase en runtime para inyectarla
  constructor(private readonly backend: BackendClient) {}

  // Se crea un servidor por petición, así que cada uno queda ligado a quien autorizó ESA petición.
  createServer(auth?: AuthContext): McpServer {
    const server = new McpServer({ name: 'steyner-logs', version: '1.0.0' });

    // Con intercambio de tokens configurado, las llamadas al backend se hacen como ese usuario.
    const api = this.backend.forRequest(auth);

    registerLogTools(server, api);

    server.registerResource(
      'logs-vigentes',
      'logs://vigentes',
      {
        title: 'Logs vigentes',
        description: 'Primera página (10) de los logs vigentes, como contexto de solo lectura.',
        mimeType: 'application/json',
      },
      async (uri) => {
        const data = await api.request('GET', '/api/logs', { query: { limite: 10 } });
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
      },
    );

    server.registerPrompt(
      'registrar-log',
      {
        title: 'Registrar un log',
        description: 'Convierte el relato de un problema en un log estructurado y lo registra.',
        argsSchema: { relato: z.string().describe('Cuenta qué pasó y, si la tienes, cómo lo resolviste.') },
      },
      ({ relato }) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Quiero registrar este caso como un log:\n\n${relato}\n\n` +
                'Extrae titulo, tipo, detalleTipo, descripcion, solucion y, si aplica, codigoClave. ' +
                'Si falta algún dato obligatorio (sobre todo la solución), pregúntamelo en lugar de inventarlo. ' +
                'Cuando tengas todo, usa la tool crear_log y muéstrame el resultado.',
            },
          },
        ],
      }),
    );

    return server;
  }
}
