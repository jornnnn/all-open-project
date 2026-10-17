import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { clasificarTextosDeLicencia, PLANTILLAS_NECESARIAS } from '@aop/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ClienteGithub } from './github.ts';
import { cargarPlantillas, revisarLicencias } from './licencias.ts';

const plantilla = (id: string) =>
  readFile(resolve(import.meta.dirname, `../licencias/${id}.txt`), 'utf8');

let plantillas: Awaited<ReturnType<typeof cargarPlantillas>>;
let mit: string;
let apache: string;
let gpl3: string;
beforeAll(async () => {
  plantillas = await cargarPlantillas();
  mit = (await plantilla('MIT')).replace('<year> <copyright holders>', '2026 Ana');
  apache = await plantilla('Apache-2.0');
  gpl3 = await plantilla('GPL-3.0-only');
});

describe('plantillas de jobs/licencias', () => {
  it('están todas y cada una se reconoce como licencia libre', async () => {
    for (const id of PLANTILLAS_NECESARIAS) {
      const r = clasificarTextosDeLicencia(
        [{ ruta: 'LICENSE', texto: await plantilla(id) }],
        plantillas,
        'a/b',
      );
      expect(r.categoria, `${id}: ${r.motivo}`).toBe('open-source');
    }
  });
});

/** Un repo de mentira: carpetas, archivos y su árbol completo (para «sin licencia»). */
interface RepoFalso {
  carpetas?: Record<string, { nombre: string; tipo: 'blob' | 'tree' }[]>;
  archivos?: Record<string, string | { truncado: true }>;
  arbol?: { rutas: string[]; truncado?: boolean } | null;
}

function githubFalso(repos: Record<string, RepoFalso>): ClienteGithub {
  return {
    restantes: () => 5000,
    frenos: () => ({ veces: 0, presupuestoPorMinutoMs: null }),
    async rest<T>(ruta: string) {
      const nombre = ruta.match(/^\/repos\/([^/]+\/[^/]+)\//)?.[1] ?? '';
      const arbol = repos[nombre]?.arbol;
      if (!arbol) return null;
      return {
        truncated: arbol.truncado === true,
        tree: arbol.rutas.map((path) => ({ path, type: 'blob' })),
      } as T;
    },
    async graphql<T>(query: string, variables: Record<string, unknown> = {}) {
      const datos: Record<string, unknown> = {};
      for (const clave of Object.keys(variables).filter((k) => k.startsWith('e'))) {
        const i = clave.slice(1);
        const repo = repos[`${variables[`o${i}`]}/${variables[`n${i}`]}`];
        const ruta = String(variables[clave]).replace(/^HEAD:/, '');
        let objeto: unknown = null;
        if (query.includes('entries')) {
          const entradas = repo?.carpetas?.[ruta];
          objeto = entradas
            ? { entries: entradas.map((e) => ({ name: e.nombre, type: e.tipo })) }
            : null;
        } else {
          const archivo = repo?.archivos?.[ruta];
          objeto =
            archivo === undefined
              ? null
              : typeof archivo === 'string'
                ? { text: archivo, isBinary: false, isTruncated: false }
                : { text: 'MIT License…', isBinary: false, isTruncated: true };
        }
        datos[`r${i}`] = repo ? { object: objeto } : null;
      }
      return datos as T;
    },
  };
}

const blob = (nombre: string) => ({ nombre, tipo: 'blob' as const });

describe('revisarLicencias', () => {
  it('«otra»: lee los archivos de licencia de la raíz y de LICENSES/', async () => {
    const github = githubFalso({
      'a/dual': {
        carpetas: { '': [blob('README.md'), blob('LICENSE-MIT'), blob('LICENSE-APACHE')] },
        archivos: { 'LICENSE-MIT': mit, 'LICENSE-APACHE': apache },
      },
      'a/reuse': {
        carpetas: {
          '': [blob('README.md'), { nombre: 'LICENSES', tipo: 'tree' }],
          LICENSES: [blob('MIT.txt')],
        },
        archivos: { 'LICENSES/MIT.txt': mit },
      },
      'a/busl': {
        carpetas: { '': [blob('LICENSE')] },
        archivos: {
          LICENSE:
            'Business Source License 1.1\nLicensor: Ana SL\nChange Date: 2030-01-01\nChange License: Apache License, Version 2.0',
        },
      },
      'a/nada': { carpetas: { '': [blob('README.md')] } },
      'a/enorme': {
        carpetas: { '': [blob('LICENSE')] },
        archivos: { LICENSE: { truncado: true } },
      },
    });
    const r = await revisarLicencias(
      github,
      ['a/dual', 'a/reuse', 'a/busl', 'a/nada', 'a/enorme'].map((repo) => ({
        repo,
        categoria: 'otra' as const,
      })),
      plantillas,
    );
    expect(r.get('a/dual')).toMatchObject({
      categoria: 'open-source',
      licencias: ['MIT', 'Apache-2.0'],
    });
    expect(r.get('a/reuse')).toMatchObject({ categoria: 'open-source', licencias: ['MIT'] });
    expect(r.get('a/busl')).toMatchObject({
      categoria: 'con-limites',
      licencias: ['Business Source License'],
    });
    expect(r.get('a/nada')?.categoria).toBe('otra');
    expect(r.get('a/enorme')?.motivo).toMatch(/No se pudo leer entero LICENSE/);
  });

  it('«sin licencia»: busca en todo el repo antes de confirmarlo', async () => {
    const github = githubFalso({
      'b/vacio': { arbol: { rutas: ['README.md', 'src/main.rs'] } },
      'b/terceros': {
        arbol: { rutas: ['README.md', 'node_modules/x/LICENSE', 'assets/fonts/fira/OFL.txt'] },
      },
      'b/subcarpeta': { arbol: { rutas: ['README.md', 'desktop/share/help/license.html'] } },
      'b/raiz': {
        arbol: { rutas: ['README.md', 'gpl-3.0.txt'] },
        archivos: { 'gpl-3.0.txt': gpl3 },
      },
      'b/enorme': { arbol: { rutas: ['README.md'], truncado: true } },
      'b/inaccesible': { arbol: null },
    });
    const r = await revisarLicencias(
      github,
      ['b/vacio', 'b/terceros', 'b/subcarpeta', 'b/raiz', 'b/enorme', 'b/inaccesible'].map(
        (repo) => ({
          repo,
          categoria: 'sin-licencia' as const,
        }),
      ),
      plantillas,
    );
    expect(r.get('b/vacio')).toEqual({
      categoria: 'sin-licencia',
      licencias: [],
      motivo: 'No hay ningún archivo de licencia en el repositorio (comprobados sus 2 archivos).',
    });
    expect(r.get('b/terceros')?.categoria).toBe('sin-licencia');
    expect(r.get('b/subcarpeta')).toMatchObject({ categoria: 'otra' });
    expect(r.get('b/subcarpeta')?.motivo).toContain('desktop/share/help/license.html');
    expect(r.get('b/raiz')).toMatchObject({
      categoria: 'open-source',
      licencias: ['GPL-3.0-only'],
    });
    expect(r.get('b/enorme')?.categoria).toBe('otra');
    expect(r.get('b/inaccesible')?.categoria).toBe('otra');
  });
});
