import { Injectable, Logger } from '@nestjs/common';

export class BackendError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

// El token dura 4h; se renueva antes por margen
const TOKEN_TTL_MS = 3.5 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class BackendClient {
  private readonly logger = new Logger(BackendClient.name);
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private loginInFlight: Promise<string> | null = null;

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);

    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getToken();

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-token': token, 'User-Agent': 'steyner-mcp/1.0' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // Token vencido o revocado: se descarta y se reintenta una vez
      if (res.status === 401 && attempt === 0) {
        this.logger.warn('401 del backend, renovando token');
        this.token = null;
        continue;
      }

      const data = await this.parseBody(res);
      if (!res.ok) {
        this.logFailure('request', res, url, data);
        throw new BackendError(res.status, this.extractMessage(data, res.statusText));
      }
      return data as T;
    }

    throw new BackendError(401, 'No se pudo autenticar contra el backend');
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    return this.login();
  }

  // Evita logins simultáneos si llegan varias peticiones a la vez
  private login(): Promise<string> {
    if (this.loginInFlight) return this.loginInFlight;

    this.loginInFlight = (async () => {
      try {
        const loginUrl = this.buildUrl(env('BACKEND_LOGIN_PATH', '/api/auth/login'));
        const res = await fetch(
          loginUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'steyner-mcp/1.0' },
            body: JSON.stringify({
              correo: env('BACKEND_USER_EMAIL'),
              password: env('BACKEND_USER_PASSWORD'),
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        );
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

  private logFailure(where: 'login' | 'request', res: Response, url: string, data: unknown) {
    const h = (name: string) => res.headers.get(name);
    this.logger.error(
      `${where} falló: ${res.status} ${res.statusText} path=${new URL(url).pathname} ` +
        `retry-after=${h('retry-after')} server=${h('server')} cf-ray=${h('cf-ray')} ` +
        `ratelimit-remaining=${h('ratelimit-remaining') ?? h('x-ratelimit-remaining')} ` +
        `body=${JSON.stringify(data)?.slice(0, 200)}`,
    );
  }
}