import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller.js';
import { BackendModule } from '../backend/backend.module.js';
import { McpService } from './mcp.service.js';

@Module({
    imports: [BackendModule],
    controllers: [McpController],
    providers: [McpService],
})
export class McpModule {}