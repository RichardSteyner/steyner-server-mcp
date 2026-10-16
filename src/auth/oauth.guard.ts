import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { loadAuthConfig, type AuthConfig } from './auth.config.js';

const REQUIRED_SCOPE = 'mcp';

@Injectable()
export class OAuthGuard implements CanActivate {
  private readonly cfg: AuthConfig = loadAuthConfig();
  private readonly keys: JWTVerifyGetKey = this.buildKeys();

  // Claves públicas: por defecto desde una variable de entorno (sin depender de la red).
  // Esto evita que el MCP tenga que consultar al backend, que puede estar dormido.
  private buildKeys(): JWTVerifyGetKey {
    if (this.cfg.jwksJson) {
      return createLocalJWKSet(JSON.parse(this.cfg.jwksJson));
    }
    if (this.cfg.jwksUri) {
      return createRemoteJWKSet(new URL(this.cfg.jwksUri));
    }
    throw new Error('Define OAUTH_JWKS_JSON (recomendado) u OAUTH_JWKS_URI');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const match = /^Bearer\s+(\S+)$/i.exec(req.header('authorization') ?? '');
    if (!match) return this.deny(res, 401);
    const token = match[1];

    // Clave estática opcional, solo para la transición. Desactivada por defecto.
    if (this.cfg.allowApiKey && this.matchesApiKey(token)) return true;

    let payload: JWTPayload;
    try {
      const result = await jwtVerify(token, this.keys, {
        issuer: this.cfg.issuer,
        audience: this.cfg.resource, // rechaza tokens emitidos para otro recurso
        algorithms: ['ES256'],
        clockTolerance: 5,
      });
      payload = result.payload;
    } catch {
      return this.deny(res, 401, 'invalid_token');
    }

    const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
    if (!scopes.includes(REQUIRED_SCOPE)) return this.deny(res, 403, 'insufficient_scope');

    // Identidad de quien autorizó (no se reenvía este token al backend: eso sería token passthrough).
    (req as Request & { auth?: unknown }).auth = {
      sub: payload.sub,
      clientId: payload.client_id,
      scopes,
    };
    return true;
  }

  private matchesApiKey(token: string): boolean {
    const expected = process.env.MCP_API_KEY;
    if (!expected) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private deny(res: Response, status: 401 | 403, error?: string): never {
    const parts = [`resource_metadata="${this.cfg.resourceMetadataUrl}"`, `scope="${REQUIRED_SCOPE}"`];
    if (error) parts.unshift(`error="${error}"`);
    res.setHeader('WWW-Authenticate', `Bearer ${parts.join(', ')}`);
    throw status === 401 ? new UnauthorizedException() : new ForbiddenException();
  }
}
