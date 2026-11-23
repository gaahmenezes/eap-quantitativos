import { afterAll, describe, expect, it } from 'vitest';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { ACCESS_KEY, type AccessRule } from '../src/common/auth/decorators.js';
import { bootApp } from './helpers.js';

const { app } = await bootApp();
afterAll(() => app.close());

/** Falha se algum endpoint não declarar política de acesso (segurança fail-closed verificada). */
describe('política de acesso declarada em todas as rotas', () => {
  it('todo handler HTTP possui regra de acesso e rotas com :projectId usam regra de projeto', () => {
    const modules = app.get(ModulesContainer);
    const scanner = new MetadataScanner();
    const controllers = [...modules.values()].flatMap((m) => [...m.controllers.values()]);
    const reflector = app.get(Reflector);
    const missing: string[] = [];
    const wrongScope: string[] = [];
    let count = 0;
    for (const wrapper of controllers) {
      const instance = wrapper.instance as object | undefined;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as object;
      const basePath = String((wrapper.metatype ? Reflect.getMetadata('path', wrapper.metatype) : '') ?? '');
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name] as (...args: unknown[]) => unknown;
        const routePath = Reflect.getMetadata('path', handler) as string | undefined;
        if (routePath === undefined) continue;
        count++;
        const rule = reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [handler, wrapper.metatype as never]);
        const id = `${wrapper.name}.${name}`;
        if (!rule) missing.push(id);
        const full = `${basePath}/${routePath}`;
        if (full.includes(':projectId') && rule?.kind !== 'project') wrongScope.push(id);
      }
    }
    expect(count).toBeGreaterThan(15);
    expect(missing).toEqual([]);
    expect(wrongScope).toEqual([]);
  });
});
