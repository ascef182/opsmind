import { Global, Module } from '@nestjs/common';
import { STORAGE_SERVICE } from './storage.interface';
import { LocalStorageService } from './local-storage.service';

// STORAGE_PROVIDER=gcs (Fase 6) troca o useClass aqui quando existir — sem
// tocar em nenhum módulo consumidor (DocumentsModule injeta STORAGE_SERVICE,
// nunca LocalStorageService diretamente).
@Global()
@Module({
  providers: [{ provide: STORAGE_SERVICE, useClass: LocalStorageService }],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
