import { Controller, Post, Req, Res, Get, Delete, UseGuards  } from '@nestjs/common';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpService  } from './mcp.service.js';
import { ApiKeyGuard } from './api-key.guard.js';


@Controller('mcp')
export class McpController {

  constructor(private readonly mcp: McpService) {}

  @Post()
  @UseGuards(ApiKeyGuard)
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const server = this.mcp.createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

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