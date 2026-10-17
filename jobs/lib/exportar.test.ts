import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Exportacion, type ProyectoCatalogo, VERSION_EXPORTACION } from '@aop/core';
import { describe, expect, it } from 'vitest';
import { escribirExportacion, textoDeExportacion } from './exportar.ts';

const proyecto: ProyectoCatalogo = {
  id: 1,
  repo: 'ana/visor',
  descripcion: 'Visor de fotos',
  web: null,
  lenguaje: 'Rust',
  topics: ['photo-editor'],
  temas: ['edicion-de-fotos'],
  area: 'fotos',
  publico: 'usar',
  estrellas: 1000,
  forks: 10,
  issues_abiertas: 1,
  issues_cerradas: 20,
  creado: '2020-01-01T00:00:00Z',
  ultimo_push: '2026-10-16T10:00:00Z',
  ultimo_cambio: '2026-10-16T09:00:00Z',
  archivado: false,
  estado: 'vivo',
  licencia_github: 'MIT',
  licencia: 'open-source',
  licencias: ['MIT'],
  licencia_motivo: null,
  organizacion_verificada: null,
  oficial: null,
  version: null,
  instaladores: { windows: [], mac: [], linux: [], android: [] },
  sistemas: [],
  estrellas_por_dia: null,
  puntuacion: 50,
  puntuacion_detalle: {
    popularidad: 50,
    impulso: null,
    salud: 90,
    uso: null,
    penalizaciones: [],
    grupo: 'fotos',
  },
  origen: ['busqueda'],
};

const exportacion: Exportacion = {
  version: VERSION_EXPORTACION,
  generado: '2026-10-17T03:17:05.123Z',
  fecha: '2026-10-17',
  fuente: 'API GraphQL y REST de GitHub',
  licencia: 'CC BY 4.0',
  metodologia: 'https://github.com/jornnnn/all-open-project/blob/main/docs/metodologia.md',
  resumen: { proyectos: 2 },
  proyectos: [proyecto, { ...proyecto, id: 2, repo: 'ana/zeta' }],
};

describe('textoDeExportacion', () => {
  it('es JSON válido con un proyecto por línea, para que git enseñe bien los cambios de cada día', () => {
    const texto = textoDeExportacion(exportacion);
    expect(JSON.parse(texto)).toEqual(exportacion);
    const lineas = texto.split('\n');
    expect(lineas.filter((l) => l.startsWith('    {"id":'))).toHaveLength(2);
    expect(texto.endsWith('\n')).toBe(true);
  });
});

describe('escribirExportacion', () => {
  it('valida antes de escribir: no publica fichas que no cumplen el formato', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aop-'));
    try {
      const ruta = join(dir, 'export', 'proyectos.json');
      await escribirExportacion(exportacion, ruta);
      expect(JSON.parse(await readFile(ruta, 'utf8'))).toEqual(exportacion);
      const mala = {
        ...exportacion,
        proyectos: [{ ...proyecto, estado: 'raro' }],
      } as unknown as Exportacion;
      await expect(escribirExportacion(mala, join(dir, 'mala.json'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
