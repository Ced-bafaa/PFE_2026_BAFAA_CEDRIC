import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: true });
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('KIAMA Backend API')
    .setDescription(
      'Endpoints du backend KIAMA (sans authentification pour le moment).',
    )
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  Logger.log(
    `Tri de pertinence : RELEVANCE_MODE=${process.env.RELEVANCE_MODE ?? '(non defini -> mots-cles)'} | DECISION_ENGINE_URL=${process.env.DECISION_ENGINE_URL ?? '(defaut)'}`,
    'Bootstrap',
  );

  await app.listen(process.env.PORT ?? 3004);
}
void bootstrap();
