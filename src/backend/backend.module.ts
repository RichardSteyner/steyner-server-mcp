import { Module } from '@nestjs/common';
import { BackendClient } from './backend-client.service.js';

@Module({
  providers: [BackendClient],
  exports: [BackendClient],
})
export class BackendModule {}