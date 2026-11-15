import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalStorageService } from './local-storage.service';

describe('LocalStorageService', () => {
  let baseDir: string;
  let service: LocalStorageService;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opsmind-storage-test-'));
    const configService = { get: jest.fn().mockReturnValue(baseDir) };
    service = new LocalStorageService(configService as never);
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('grava e lê de volta os mesmos bytes, criando subdiretórios que ainda não existem', async () => {
    const data = Buffer.from('conteúdo do pdf');
    const key = 'organizations/org-1/documents/doc-1.pdf';

    const returnedKey = await service.save(key, data);
    const readBack = await service.read(key);

    expect(returnedKey).toBe(key);
    expect(readBack.equals(data)).toBe(true);
  });

  it('rejeita uma key que tenta escapar do diretório base (path traversal)', async () => {
    await expect(service.save('../../etc/passwd', Buffer.from('x'))).rejects.toThrow();
  });
});
