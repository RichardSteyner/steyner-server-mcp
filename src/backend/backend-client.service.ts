import { Injectable, Logger } from '@nestjs/common';
import type { AuthContext } from '../auth/auth-context.js';
import { BackendError } from './backend-error.js';
import { TokenExchangeService } from './token-exchange.service.js';

// Se vuelve a exportar para que los imports existentes (results.ts) sigan funcionando.
export { BackendError } from './backend-error.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

// Lo que necesitan las tools. Tanto el cliente de cuenta de servicio como el de usuario lo cumplen.
export interface BackendApi {
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

const TOKEN_TTL_MS = 3.5 * 60 * 60 * 1000; // el token de la cuenta de servicio dura 4 h
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = 'steyner-mcp/1.0';

@Injectable()
export class BackendClient implements BackendApi {
  private readonly logger = new Logger(BackendClient.name);

  // Estado de la cuenta de servicio (solo se usa cuando no hay identidad de usuario)
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private loginInFlight: Promise<string> | null = null;

  constructor(private readonly exchange: TokenExchangeService) {}

  /**
   * Devuelve el cliente con el que deben ejecutarse las acciones de ESTA petición:
   * - Con usuario OAuth y el intercambio configurado: actúa como ese usuario.
   * - En cualquier otro caso: usa la cuenta de servicio (comportamiento anterior).
   * Si el intercambio está configurado y falla, NO se cae a la cuenta de servicio:
   * se devuelve el error, para no atribuir acciones a una identidad equivocada.
   */
  forRequest(auth?: AuthContext): BackendApi {
    if (auth?.token && this.exchange.isEnabled()) {
      const subjectToken = auth.token;
      return {
        request: <T>(method: HttpMethod, path: string, options: RequestOptions = {}) =>
          this.requestAsUser<T>(subjectToken, method, path, options),
      };
    }
    return this;
  }

  // ---------- identidad del usuario (intercambio de tokens) ----------

  private async requestAsUser<T>(
    subjectToken: string,
    method: HttpMethod,
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.exchange.getToken(subjectToken);
      try {
        return await this.send<T>(token, method, path, options);
      } catch (error) {
        // Token intercambiado rechazado: se descarta de la caché y se reintenta una vez.
        if (error instanceof BackendError && error.status === 401 && attempt === 0) {
          this.logger.warn('401 del backend con token intercambiado, renovando');
          this.exchange.invalidate(subjectToken);
          continue;
        }
        throw error;
      }
    }
    throw new BackendError(401, 'No se pudo autenticar contra el backend');
  }

  // ---------- cuenta de servicio ----------

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getServiceToken();
      try {
        return await this.send<T>(token, method, path, options);
      } catch (error) {
        if (error instanceof BackendError && error.status === 401 && attempt === 0) {
          this.logger.warn('401 del backend, renovando token de la cuenta de servicio');
          this.token = null;
          continue;
        }
        throw error;
      }
    }
    throw new BackendError(401, 'No se pudo autenticar contra el backend');
  }

  private async getServiceToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    return this.login();
  }

  // Evita logins simultáneos si llegan varias peticiones a la vez
  private login(): Promise<string> {
    if (this.loginInFlight) return this.loginInFlight;

    this.loginInFlight = (async () => {
      try {
        const loginUrl = this.buildUrl(env('BACKEND_LOGIN_PATH', '/api/auth/login'));
        const res = await fetch(loginUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
          body: JSON.stringify({
            correo: env('BACKEND_USER_EMAIL'),
            password: env('BACKEND_USER_PASSWORD'),
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const data = await this.parseBody(res);
        if (!res.ok || !data?.token) {
          this.logFailure('login', res, loginUrl, data);
          throw new BackendError(res.status, this.extractMessage(data, 'Login fallido'));
        }
        this.token = data.token as string;
        this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
        this.logger.log('Login en el backend correcto');
        return this.token;
      } finally {
        this.loginInFlight = null;
      }
    })();

    return this.loginInFlight;
  }

  // ---------- comunes ----------

  // Una sola llamada HTTP al backend con el token indicado (x-token).
  private async send<T>(token: string, method: HttpMethod, path: string, options: RequestOptions): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-token': token, 'User-Agent': USER_AGENT },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const data = await this.parseBody(res);
    if (!res.ok) {
      this.logFailure('request', res, url, data);
      throw new BackendError(res.status, this.extractMessage(data, res.statusText));
    }
    return data as T;
  }

  private logFailure(where: 'login' | 'request', res: Response, url: string, data: unknown) {
    const h = (name: string) => res.headers.get(name);
    this.logger.error(
      `${where} falló: ${res.status} ${res.statusText} path=${new URL(url).pathname} ` +
        `retry-after=${h('retry-after')} server=${h('server')} cf-ray=${h('cf-ray')} ` +
        `ratelimit-remaining=${h('ratelimit-remaining') ?? h('x-ratelimit-remaining')} ` +
        `body=${JSON.stringify(data)?.slice(0, 200)}`,
    );
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const base = env('BACKEND_URL').replace(/\/$/, '');
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  private async parseBody(res: Response): Promise<any> {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return { msg: text };
    }
  }

  // Tu backend responde a veces con "msg" y a veces con "msj"
  private extractMessage(data: any, fallback: string): string {
    return data?.msg ?? data?.msj ?? fallback;
  }
}
