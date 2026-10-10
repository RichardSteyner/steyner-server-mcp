import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

try { process.loadEnvFile(); } catch { /* en Railway las variables vienen del entorno */ }

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
  console.log(`MCP server en http://localhost:${process.env.PORT ?? 3000}/mcp`);
}

bootstrap();