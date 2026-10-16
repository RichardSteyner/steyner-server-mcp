import { Controller, Get, Header } from '@nestjs/common';
import { loadAuthConfig } from './auth.config.js';

// Protected Resource Metadata (RFC 9728). El cliente lo descubre a partir del header
// WWW-Authenticate del 401 y de aquí obtiene el authorization server.
@Controller('.well-known')
export class OauthMetadataController {
  // Se sirve en la ruta raíz y en la ruta con el path del recurso (/mcp).
  @Get(['oauth-protected-resource', 'oauth-protected-resource/mcp'])
  @Header('Cache-Control', 'public, max-age=300')
  @Header('Access-Control-Allow-Origin', '*')
  metadata() {
    const cfg = loadAuthConfig();
    return {
      resource: cfg.resource,
      authorization_servers: [cfg.issuer],
      scopes_supported: ['mcp'],
      bearer_methods_supported: ['header'],
      resource_name: 'steyner-mcp',
    };
  }
}
