import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config.js';

/**
 * Armazenamento de arquivos em disco local (fora da raiz pública). Nome aleatório; o nome original
 * fica só no banco. Interface pequena para trocar por armazenamento de objetos (S3) depois.
 */
@Injectable()
export class StorageService {
  private readonly dir: string;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.dir = isAbsolute(config.STORAGE_DIR) ? config.STORAGE_DIR : resolve(process.cwd(), config.STORAGE_DIR);
  }

  async put(buf: Buffer): Promise<{ key: string; sha256: string }> {
    const key = randomUUID();
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(this.path(key), buf, { mode: 0o600, flag: 'wx' });
    return { key, sha256: createHash('sha256').update(buf).digest('hex') };
  }

  stream(key: string) {
    return createReadStream(this.path(key));
  }

  async read(key: string): Promise<Buffer> {
    const { readFile } = await import('node:fs/promises');
    return readFile(this.path(key));
  }

  private path(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error('chave de armazenamento inválida');
    return join(this.dir, key);
  }
}
