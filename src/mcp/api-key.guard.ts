import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.MCP_API_KEY;
    if (!expected) throw new InternalServerErrorException('MCP_API_KEY no está configurada');

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header('authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}