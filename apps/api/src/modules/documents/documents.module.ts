import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { EMBEDDING_GATEWAY } from './gateway/embedding-gateway.interface';
import { OpenAiEmbeddingGateway } from './gateway/openai-embedding.gateway';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    TenantGuard,
    RolesGuard,
    { provide: EMBEDDING_GATEWAY, useClass: OpenAiEmbeddingGateway },
  ],
  // EMBEDDING_GATEWAY exportado também: AiModule (search_documents tool)
  // precisa gerar o embedding da pergunta do usuário pra buscar por
  // similaridade — mesmo provider usado na indexação, nunca um duplicado.
  exports: [DocumentsService, EMBEDDING_GATEWAY],
})
export class DocumentsModule {}
