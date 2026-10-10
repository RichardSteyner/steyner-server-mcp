import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BackendError } from '../../backend/backend-client.service.js';

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

// Convierte cualquier excepción en un mensaje útil para el modelo.
// No se filtran detalles internos de errores desconocidos.
export function fail(error: unknown): CallToolResult {
  if (error instanceof BackendError) {
    switch (error.status) {
      case 400:
        return errorResult(`El backend rechazó los datos: ${error.message}`);
      case 401:
        return errorResult('El MCP no pudo autenticarse en el backend. Avisa al administrador.');
      case 500:
        return errorResult(
          `Error interno del backend (puede deberse a un id inválido o a un título duplicado): ${error.message}`,
        );
      default:
        return errorResult(`Error ${error.status} del backend: ${error.message}`);
    }
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return errorResult('El backend no respondió a tiempo. Inténtalo de nuevo.');
  }
  console.error(error);
  return errorResult('Error inesperado al llamar al backend.');
}