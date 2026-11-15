import { promises as fs } from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@opsmind/config/env/schema';
import type { StorageService } from './storage.interface';

/**
 * Provider de dev/CI (STORAGE_PROVIDER=local, o padrão) — grava em disco,
 * fora de qualquer pasta versionada. `LOCAL_STORAGE_DIR` é relativo ao cwd
 * do processo (apps/api, tanto em dev quanto nos testes), então acaba em
 * apps/api/.data/uploads por padrão.
 */
@Injectable()
export class LocalStorageService implements StorageService {
  private readonly baseDir: string;

  constructor(configService: ConfigService<Env, true>) {
    this.baseDir = path.resolve(process.cwd(), configService.get('LOCAL_STORAGE_DIR', { infer: true }));
  }

  async save(key: string, data: Buffer): Promise<string> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    return key;
  }

  read(key: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(key));
  }

  private resolvePath(key: string): string {
    // `key` é sempre gerado internamente por DocumentsService, nunca vem
    // direto do usuário — mesmo assim, trava path traversal como defesa em
    // profundidade (normalize + prefixo) em vez de confiar cegamente nisso.
    const resolved = path.normalize(path.join(this.baseDir, key));
    if (!resolved.startsWith(this.baseDir + path.sep) && resolved !== this.baseDir) {
      throw new Error(`Storage key inválida (path traversal?): ${key}`);
    }
    return resolved;
  }
}
