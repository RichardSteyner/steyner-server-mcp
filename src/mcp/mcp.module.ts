import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller.js';
import { BackendModule } from '../backend/backend.module.js';
import { McpService } from './mcp.service.js';
import { OauthMetadataController } from '../auth/oauth-metadata.controller.js';
import { OAuthGuard } from '../auth/oauth.guard.js';

@Module({
    imports: [BackendModule],
    controllers: [McpController, OauthMetadataController],
    providers: [McpService, OAuthGuard],
})
export class McpModule {}