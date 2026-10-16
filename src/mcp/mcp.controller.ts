import { Controller, Delete, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthedRequest } from '../auth/auth-context.js';
import { OAuthGuard } from '../auth/oauth.guard.js';
import { McpService } from './mcp.service.js';

@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post()
  @UseGuards(OAuthGuard)
  async handle(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    // req.auth lo rellena OAuthGuard (undefined si se entró con la clave estática de transición)
    const server = this.mcp.createServer(req.auth);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  @Get()
  @Delete()
  methodNotAllowed(@Res() res: Response): void {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  }
}
