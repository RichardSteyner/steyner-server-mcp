// mcp.factory.ts
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function createMcpServer() {
  const server = new McpServer({ name: 'mi-mcp', version: '1.0.0' });

  server.registerTool(
    'sumar',
    { description: 'Suma dos números', inputSchema: 
        { 
            a: z.number().describe('Primer número'), 
            b: z.number().describe('Segundo número') 
        } 
    },
    async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
  );

  server.registerResource(
    'saludo',
    'demo://saludo',
    { title: 'Saludo', mimeType: 'text/plain' },
    async (uri) => ({ contents: [{ uri: uri.href, text: 'Hola desde MCP' }] }),
  );

  server.registerPrompt(
    'resumir',
    { description: 'Resume un texto', argsSchema: { texto: z.string() } },
    ({ texto }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: `Resume: ${texto}` } }],
    }),
  );

  return server;
}