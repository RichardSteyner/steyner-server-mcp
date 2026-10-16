import type { Request } from 'express';

// Quién autorizó el MCP en esta petición (lo rellena OAuthGuard tras validar el token).
//
// Es estructuralmente compatible con el tipo AuthInfo del SDK de MCP: el SDK también lee req.auth
// (y lo expone a los handlers como authInfo), así que token y clientId deben ser siempre string.
export interface AuthContext {
  // Access token del usuario (aud = este MCP). Solo se usa para pedirle al authorization server
  // un token DISTINTO para el backend (intercambio de tokens). Nunca se reenvía tal cual.
  token: string;
  clientId: string; // aplicación cliente (Claude, ChatGPT...)
  scopes: string[];
  expiresAt?: number; // segundos desde epoch
  extra?: Record<string, unknown>; // aquí va el id del usuario: extra.sub
}

export type AuthedRequest = Request & { auth?: AuthContext };