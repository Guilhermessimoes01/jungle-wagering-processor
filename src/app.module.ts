import {
  Module,
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Headers,
  Injectable,
  Res,
} from '@nestjs/common';
import { WageringService } from './wagering.service';
import { database } from './db';
import { openApiDocument } from './openapi';

@Injectable()
class HealthService {
  async ready() {
    await database();
    return { status: 'ok', database: 'connected' };
  }
}

@Controller()
class ApiController {
  constructor(
    private readonly service: WageringService,
    private readonly health: HealthService,
  ) {}

  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  ready() {
    return this.health.ready();
  }

  @Post('wallets')
  createWallet(@Body() body: any) {
    return this.service.createWallet(body);
  }

  @Get('wallets/:id')
  wallet(@Param('id') id: string) {
    return this.service.getWallet(id);
  }

  @Get('wallets/:id/ledger')
  ledger(@Param('id') id: string, @Query('limit') limit: string) {
    return this.service.ledger(id, Number(limit));
  }

  @Post('wallets/:id/reconciliation')
  reconcile(@Param('id') id: string) {
    return this.service.reconcile(id);
  }

  @Post('wagering/transactions')
  submit(@Body() body: any, @Headers('idempotency-key') key: string) {
    return this.service.submit(body, key);
  }

  @Get('wagering/transactions/:id')
  transaction(@Param('id') id: string) {
    return this.service.transaction(id);
  }

  @Get('providers/:providerId/wagering/transactions/:externalId')
  providerTransaction(
    @Param('providerId') providerId: string,
    @Param('externalId') externalId: string,
  ) {
    return this.service.providerTransaction(providerId, externalId);
  }
}

@Controller()
class DocumentationController {
  @Get('openapi.json')
  openapi() {
    return openApiDocument;
  }

  @Get('docs')
  docs(@Res() response: any) {
    response.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jungle Wagering Processor — API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #f7f8fa; }
    .topbar { display: none; }
    .swagger-ui .info { margin: 28px 0; }
    .swagger-ui .scheme-container { box-shadow: none; border: 1px solid #e5e7eb; border-radius: 8px; }
    .swagger-ui .opblock { border-radius: 8px; }
    .swagger-ui .wrapper { max-width: 1180px; }
    .docs-note { max-width: 1180px; margin: 18px auto 0; padding: 12px 20px; color: #475569; font: 14px/1.5 Arial, sans-serif; }
    .docs-note code { background: #e9edf3; padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="docs-note">Interactive local API reference. Use <code>Try it out</code> to execute requests. Start with <code>POST /wallets</code>, then copy the returned wallet ID into wagering examples. Money amounts must be strings with two decimal places.</div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true, displayRequestDuration: true, persistAuthorization: false, presets: [SwaggerUIBundle.presets.apis], layout: 'BaseLayout' });
  </script>
</body>
</html>`);
  }
}

@Module({
  controllers: [ApiController, DocumentationController],
  providers: [WageringService, HealthService],
})
export class AppModule {}
