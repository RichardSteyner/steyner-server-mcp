import { Module } from '@nestjs/common';
import { BackendClient } from './backend-client.service.js';
import { TokenExchangeService } from './token-exchange.service.js';

@Module({
  providers: [BackendClient, TokenExchangeService],
  exports: [BackendClient],
})
export class BackendModule {}
