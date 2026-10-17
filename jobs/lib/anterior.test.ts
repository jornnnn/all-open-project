import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Exportacion, VERSION_EXPORTACION } from '@aop/core';
import { describe, expect, it } from 'vitest';
import {
  DIAS_POR_TURNO,
  type LicenciaAnterior,
  leerAnterior,
  leTocaHoy,
  licenciaReutilizable,
} from './anterior.ts';
import { escribirExportacion } from './exportar.ts';

describe('leTocaHoy', () => {
  it('a cada proyecto le toca exactamente un día de cada siete', () => {
    const dias = Array.from({ length: DIAS_POR_TURNO }, (_, i) =>
      new Date(Date.UTC(2026, 9, 17 + i)).toISOString().slice(0, 10),
    );
    for (const id of [1, 2, 7, 12345, 1219400421]) {
      expect(dias.filter((dia) => leTocaHoy(id, dia))).toHaveLength(1);
    }
  });

  it('cada día le toca a una séptima parte, más o menos', () => {
    const ids = Array.from({ length: 7000 }, (_, i) => i * 13 + 5);
    expect(ids.filter((id) => leTocaHoy(id, '2026-10-18'))).toHaveLength(1000);
  });
});

describe('licenciaReutilizable', () => {
  const revisada: LicenciaAnterior = {
    licenciaGithub: 'NOASSERTION',
    categoria: 'con-limites',
    licencias: ['Business Source License'],
    motivo: 'Licencia con límites: Business Source License (LICENSE).',
  };
  // Un día en el que al proyecto 1 no le toca turno, y el día en que sí.
  const sinTurno = ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'].find(
    (dia) => !leTocaHoy(1, dia),
  ) as string;
  const conTurno = [
    '2026-10-17',
    '2026-10-18',
    '2026-10-19',
    '2026-10-20',
    '2026-10-21',
    '2026-10-22',
    '2026-10-23',
  ].find((dia) => leTocaHoy(1, dia)) as string;

  it('reutiliza la revisión de ayer si no le toca turno y GitHub dice lo mismo', () => {
    expect(licenciaReutilizable(revisada, 1, 'NOASSERTION', sinTurno)).toBe(revisada);
  });

  it('vuelve a revisar si le toca turno, si GitHub cambia o si es nuevo', () => {
    expect(licenciaReutilizable(revisada, 1, 'NOASSERTION', conTurno)).toBeNull();
    expect(licenciaReutilizable(revisada, 1, null, sinTurno)).toBeNull();
    expect(licenciaReutilizable(undefined, 1, 'NOASSERTION', sinTurno)).toBeNull();
  });

  it('no arrastra correcciones manuales ni revisiones que ayer no se pudieron hacer', () => {
    const manual = { ...revisada, motivo: 'Corrección manual (2026-10-17): usa la SUL' };
    const fallida = {
      ...revisada,
      categoria: 'otra' as const,
      motivo: 'Hoy no se ha podido revisar la licencia. Hay que revisarla a mano.',
    };
    expect(licenciaReutilizable(manual, 1, 'NOASSERTION', sinTurno)).toBeNull();
    expect(licenciaReutilizable(fallida, 1, 'NOASSERTION', sinTurno)).toBeNull();
  });
});

describe('leerAnterior', () => {
  it('lee los topics de la exportación anterior por id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aop-'));
    try {
      const ruta = join(dir, 'proyectos.json');
      const exportacion: Exportacion = {
        version: VERSION_EXPORTACION,
        generado: '2026-10-17T03:17:05Z',
        fecha: '2026-10-17',
        fuente: 'API GraphQL y REST de GitHub',
        licencia: 'CC BY 4.0',
        metodologia: 'https://github.com/jornnnn/all-open-project/blob/main/docs/metodologia.md',
        resumen: {},
        proyectos: [
          {
            id: 7,
            repo: 'ana/visor',
            descripcion: null,
            web: null,
            lenguaje: null,
            topics: ['photo-editor', 'image'],
            temas: ['edicion-de-fotos'],
            area: 'fotos',
            publico: 'usar',
            estrellas: 1,
            forks: 0,
            issues_abiertas: null,
            issues_cerradas: null,
            creado: '2020-01-01T00:00:00Z',
            ultimo_push: null,
            ultimo_cambio: '2026-10-01T00:00:00Z',
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
              salud: 100,
              uso: null,
              penalizaciones: [],
              grupo: 'fotos',
            },
            origen: ['busqueda'],
          },
        ],
      };
      await escribirExportacion(exportacion, ruta);
      const anterior = await leerAnterior(ruta);
      expect(anterior.fecha).toBe('2026-10-17');
      expect(anterior.topics.get(7)).toEqual(['photo-editor', 'image']);
      expect(anterior.licencias.get(7)).toEqual({
        licenciaGithub: 'MIT',
        categoria: 'open-source',
        licencias: ['MIT'],
        motivo: null,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sin exportación anterior (o rota), no hay nada que reutilizar: se pide todo', async () => {
    const anterior = await leerAnterior(join(tmpdir(), 'no-existe', 'proyectos.json'));
    expect(anterior).toEqual({ fecha: null, topics: new Map(), licencias: new Map() });
  });
});
