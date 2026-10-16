import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BackendError } from './backend-error.js';

const GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const TIMEOUT_MS = 15_000;
const SAFETY_MARGIN_S = 30; // se descarta el token un poco antes de que caduque

interface Cached {
  token: string;
  expiresAt: number;
}

@Injectable()
export class TokenExchangeService {
  private readonly logger = new Logger(TokenExchangeService.name);
  private readonly cache = new Map<string, Cached>();
  private readonly inflight = new Map<string, Promise<string>>();

  // El intercambio solo está activo si hay secreto configurado. Si no, el MCP sigue usando la
  // cuenta de servicio (comportamiento anterior).
  isEnabled(): boolean {
    return Boolean(process.env.OAUTH_EXCHANGE_CLIENT_SECRET?.trim());
  }

  async getToken(subjectToken: string): Promise<string> {
    const key = this.keyOf(subjectToken);

    const hit = this.cache.get(key);
    if (hit && Date.now() < hit.expiresAt) return hit.token;

    // Si ya hay un intercambio en curso para este token, se espera al mismo (evita ráfagas).
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = this.exchange(subjectToken)
      .then(({ token, expiresIn }) => {
        this.prune();
        this.cache.set(key, {
          token,
          expiresAt: Date.now() + Math.max(0, expiresIn - SAFETY_MARGIN_S) * 1000,
        });
        return token;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  invalidate(subjectToken: string): void {
    this.cache.delete(this.keyOf(subjectToken));
  }

  // La caché se indexa por hash: el token del usuario no se usa como clave en claro.
  private keyOf(subjectToken: string): string {
    return createHash('sha256').update(subjectToken).digest('hex');
  }

  private prune(): void {
    if (this.cache.size < 500) return;
    const now = Date.now();
    for (const [k, v] of this.cache) if (v.expiresAt <= now) this.cache.delete(k);
  }

  private config() {
    const need = (name: string): string => {
      const v = process.env[name]?.trim();
      if (!v) throw new Error(`Falta la variable de entorno ${name}`);
      return v;
    };
    const issuer = need('OAUTH_ISSUER').replace(/\/+$/, '');
    const issuerUrl = new URL(issuer);
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(issuerUrl.hostname.toLowerCase());
    if (issuerUrl.protocol !== 'https:' && !(issuerUrl.protocol === 'http:' && isLoopback)) {
      throw new Error('OAUTH_ISSUER debe usar HTTPS; HTTP solo se permite para localhost');
    }
    return {
      tokenUrl: `${issuer}/oauth/token`,
      clientId: process.env.OAUTH_EXCHANGE_CLIENT_ID?.trim() || 'mcp-resource-server',
      clientSecret: need('OAUTH_EXCHANGE_CLIENT_SECRET'),
      audience: process.env.OAUTH_BACKEND_AUDIENCE?.trim() || `${issuer}/api`,
    };
  }

  private async exchange(subjectToken: string): Promise<{ token: string; expiresIn: number }> {
    const cfg = this.config();
    const basic = Buffer.from(
      `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`,
    ).toString('base64');

    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
        'User-Agent': 'steyner-mcp/1.0',
      },
      body: new URLSearchParams({
        grant_type: GRANT,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: ACCESS_TOKEN_TYPE,
        audience: cfg.audience,
        scope: 'logs',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error_description: text.slice(0, 200) };
    }

    if (!res.ok || !data?.access_token) {
      this.logger.error(
        `intercambio falló: ${res.status} server=${res.headers.get('server')} ` +
          `error=${data?.error} desc=${data?.error_description}`,
      );
      throw this.toBackendError(res.status, data);
    }

    return { token: data.access_token as string, expiresIn: Number(data.expires_in) || 300 };
  }

  // Mensajes pensados para que el modelo (y tú) entiendan qué pasó.
  private toBackendError(status: number, data: any): BackendError {
    if (status === 401) {
      return new BackendError(
        502,
        'El backend rechazó las credenciales del MCP para el intercambio de tokens (revisa OAUTH_EXCHANGE_CLIENT_ID y OAUTH_EXCHANGE_CLIENT_SECRET).',
      );
    }
    if (data?.error === 'invalid_grant') {
      return new BackendError(403, 'Tu sesión ya no es válida o la cuenta ya no está autorizada. Vuelve a conectar el MCP.');
    }
    return new BackendError(status, data?.error_description ?? data?.error ?? 'Intercambio de token fallido');
  }
}
