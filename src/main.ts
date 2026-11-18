import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { database } from './db';

const app = await NestFactory.create(AppModule, { cors: { origin: false } });
app.setGlobalPrefix('');
app.enableShutdownHooks();
await database();
const port = Number(process.env.PORT ?? 3000);
await app.listen(port, '0.0.0.0');
console.log(`Jungle Wagering API listening on :${port}`);
