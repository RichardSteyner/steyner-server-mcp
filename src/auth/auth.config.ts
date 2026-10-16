export interface AuthConfig {
  issuer: string;
  resource: string;
  resourceMetadataUrl: string;
  jwksJson?: string;
  jwksUri?: string;
  allowApiKey: boolean;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

// Se lee en tiempo de ejecución (no al importar el módulo), porque main.ts carga el .env
// después de evaluar los imports.
export function loadAuthConfig(): AuthConfig {
  const resource = required('MCP_RESOURCE_URL');
  const url = new URL(resource);

  // RFC 9728: el metadata se publica insertando /.well-known/oauth-protected-resource antes de la ruta del recurso.
  const path = url.pathname === '/' ? '' : url.pathname;

  return {
    issuer: required('OAUTH_ISSUER').replace(/\/+$/, ''),
    resource,
    resourceMetadataUrl: `${url.origin}/.well-known/oauth-protected-resource${path}`,
    jwksJson: process.env.OAUTH_JWKS_JSON?.trim() || undefined,
    jwksUri: process.env.OAUTH_JWKS_URI?.trim() || undefined,
    allowApiKey: process.env.MCP_ALLOW_API_KEY === 'true',
  };
}
