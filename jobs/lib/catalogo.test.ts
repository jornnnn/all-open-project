import type { Editorial, Taxonomia } from '@aop/core';
import { describe, expect, it } from 'vitest';
import { construirCatalogo, type DatosCatalogo, licenciasPorRevisar } from './catalogo.ts';
import type { RepoDiario } from './github.ts';
import type { RevisionLicencia } from './licencias.ts';

const ahora = new Date('2026-10-17T03:20:00Z');

const taxonomia: Taxonomia = {
  version: 1,
  areas: [
    {
      id: 'fotos',
      slug_en: 'photos',
      nombre: { es: 'Fotos', en: 'Photos' },
      icono: 'image',
      tono: 200,
      portada: true,
      subtemas: [
        {
          id: 'edicion-de-fotos',
          slug_en: 'photo-editing',
          nombre: { es: 'Edición de fotos', en: 'Photo editing' },
          publico: 'usar',
          topics: ['photo-editor'],
        },
      ],
    },
    {
      id: 'programar',
      slug_en: 'code',
      nombre: { es: 'Programar', en: 'Code' },
      icono: 'code',
      tono: 260,
      portada: true,
      subtemas: [
        {
          id: 'terminal',
          slug_en: 'terminal',
          nombre: { es: 'Terminal', en: 'Terminal' },
          publico: 'programar',
          topics: ['cli'],
        },
      ],
    },
  ],
};

let siguienteId = 1;
function repo(nombre: string, cambios: Partial<RepoDiario> = {}): RepoDiario {
  return {
    id: siguienteId++,
    repo: nombre,
    descripcion: 'Un programa',
    web: null,
    estrellas: 1000,
    forks: 100,
    esFork: false,
    archivado: false,
    espejo: false,
    creado: '2020-01-01T00:00:00Z',
    ultimoPush: '2026-10-16T10:00:00Z',
    ultimoCommit: '2026-10-16T09:00:00Z',
    lenguaje: 'Rust',
    licencia: 'MIT',
    topics: ['photo-editor'],
    deshabilitado: false,
    issuesAbiertas: 10,
    issuesCerradas: 90,
    organizacionVerificada: null,
    version: {
      nombre: 'v2.0.0',
      fecha: '2026-10-07T03:20:00Z',
      totalArchivos: 4,
      archivos: [
        { nombre: 'visor-setup.exe', descargas: 900 },
        { nombre: 'visor.dmg', descargas: 100 },
        { nombre: 'SHA256SUMS.txt', descargas: 5000 },
        { nombre: 'latest.yml', descargas: 80000 },
      ],
    },
    ...cambios,
  };
}

const sinCorrecciones: Editorial = { version: 1, correcciones: [] };

function datos(
  repos: Record<string, RepoDiario | null>,
  cambios: Partial<DatosCatalogo> = {},
): DatosCatalogo {
  return {
    semilla: Object.keys(repos).map((r) => ({
      repo: r,
      temas: ['edicion-de-fotos'],
      origen: ['busqueda'],
    })),
    repos: new Map(Object.entries(repos)),
    licencias: new Map(),
    referencias: new Map(),
    taxonomia,
    editorial: sinCorrecciones,
    ahora,
    ...cambios,
  };
}

describe('construirCatalogo', () => {
  it('monta la ficha con estado, licencia, instaladores, descargas y puntuación', () => {
    const r = construirCatalogo(datos({ 'ana/visor': repo('ana/visor') }));
    expect(r.errores).toEqual([]);
    expect(r.proyectos).toHaveLength(1);
    const [p] = r.proyectos;
    expect(p).toMatchObject({
      repo: 'ana/visor',
      temas: ['edicion-de-fotos'],
      area: 'fotos',
      publico: 'usar',
      estado: 'vivo',
      ultimo_cambio: '2026-10-16T09:00:00Z',
      licencia: 'open-source',
      licencias: ['MIT'],
      licencia_motivo: null,
      oficial: null,
      // Sin sumas de control ni el manifiesto de actualizaciones (latest.yml).
      version: { nombre: 'v2.0.0', fecha: '2026-10-07T03:20:00Z', descargas: 1000 },
      instaladores: { windows: ['visor-setup.exe'], mac: ['visor.dmg'], linux: [], android: [] },
      sistemas: ['windows', 'mac'],
      estrellas_por_dia: null,
      origen: ['busqueda'],
    });
    expect(p?.puntuacion).toBeGreaterThanOrEqual(0);
    expect(p?.puntuacion).toBeLessThanOrEqual(100);
    expect(p?.puntuacion_detalle.grupo).toBe('fotos'); // el tema tiene menos de 10 proyectos
    expect(p?.puntuacion_detalle.uso).toBe(50); // único con descargas: percentil medio
  });

  it('da de baja los que ya no existen y deja como estaban los que GitHub no ha servido hoy', () => {
    const d = datos({ 'ana/visor': repo('ana/visor'), 'ana/borrado': null });
    const conFallido: DatosCatalogo = {
      ...d,
      semilla: [
        ...d.semilla,
        { repo: 'ana/fallido', temas: ['edicion-de-fotos'], origen: ['alta'] },
      ],
    };
    const r = construirCatalogo(conFallido);
    expect(r.proyectos.map((p) => p.repo)).toEqual(['ana/visor']);
    expect(r.desaparecidos).toEqual(['ana/borrado']);
    expect(r.avisos).toEqual([
      'ana/borrado ya no existe en GitHub o no se puede ver: se da de baja',
    ]);
  });

  it('aplica las correcciones de data/editorial.yaml', () => {
    const editorial: Editorial = {
      version: 1,
      correcciones: [
        { repo: 'ana/fuera', tipo: 'excluir', motivo: 'No es un programa', fecha: '2026-10-17' },
        {
          repo: 'ana/viejo',
          tipo: 'estado',
          valor: 'terminado',
          motivo: 'Acabado',
          fecha: '2026-10-17',
        },
        {
          repo: 'ANA/rara',
          tipo: 'licencia',
          valor: 'con-limites',
          motivo: 'Usa la SUL',
          fecha: '2026-10-17',
        },
        {
          repo: 'ana/rara',
          tipo: 'temas',
          valor: ['terminal'],
          motivo: 'Es de terminal',
          fecha: '2026-10-17',
        },
        {
          repo: 'ana/rara',
          tipo: 'publico',
          valor: 'usar',
          motivo: 'Para todos',
          fecha: '2026-10-17',
        },
        {
          repo: 'ana/rara',
          tipo: 'oficial',
          valor: true,
          motivo: 'Lo enlaza su web',
          fecha: '2026-10-17',
        },
      ],
    };
    const r = construirCatalogo(
      datos(
        {
          'ana/fuera': repo('ana/fuera'),
          'ana/viejo': repo('ana/viejo', { ultimoCommit: '2019-01-01T00:00:00Z' }),
          'ana/rara': repo('ana/rara', { licencia: 'NOASSERTION' }),
        },
        { editorial },
      ),
    );
    expect(r.excluidos).toEqual(['ana/fuera']);
    const viejo = r.proyectos.find((p) => p.repo === 'ana/viejo');
    expect(viejo?.estado).toBe('terminado');
    expect(viejo?.puntuacion_detalle.penalizaciones).toEqual([]);
    expect(r.proyectos.find((p) => p.repo === 'ana/rara')).toMatchObject({
      licencia: 'con-limites',
      licencias: [],
      licencia_motivo: 'Corrección manual (2026-10-17): Usa la SUL',
      temas: ['terminal'],
      area: 'programar',
      publico: 'usar',
      oficial: true,
    });
  });

  it('usa la licencia revisada y nunca publica «sin licencia» sin haberlo comprobado', () => {
    const revisada: RevisionLicencia = {
      categoria: 'sin-licencia',
      licencias: [],
      motivo: 'No hay ningún archivo de licencia en el repositorio (comprobados sus 12 archivos).',
    };
    const r = construirCatalogo(
      datos(
        {
          'ana/comprobado': repo('ana/comprobado', { licencia: null }),
          'ana/sin-revisar': repo('ana/sin-revisar', { licencia: null }),
          'ana/otra': repo('ana/otra', { licencia: 'NOASSERTION' }),
        },
        { licencias: new Map([['ana/comprobado', revisada]]) },
      ),
    );
    const por = (nombre: string) => r.proyectos.find((p) => p.repo === nombre);
    expect(por('ana/comprobado')).toMatchObject({
      licencia: 'sin-licencia',
      licencia_motivo: revisada.motivo,
    });
    expect(por('ana/comprobado')?.puntuacion_detalle.penalizaciones).toEqual(['sin-licencia']);
    expect(por('ana/sin-revisar')?.licencia).toBe('otra');
    expect(por('ana/otra')).toMatchObject({ licencia: 'otra', licencia_github: 'NOASSERTION' });
  });

  it('calcula el impulso con una foto de hace 7 días o más', () => {
    const a = repo('ana/a', { estrellas: 1200 });
    const b = repo('ana/b', { estrellas: 500 });
    const r = construirCatalogo(
      datos(
        { 'ana/a': a, 'ana/b': b },
        {
          referencias: new Map([
            [a.id, { fecha: '2026-10-07', estrellas: 1000 }],
            [b.id, { fecha: '2026-10-14', estrellas: 400 }],
          ]),
        },
      ),
    );
    expect(r.proyectos.find((p) => p.repo === 'ana/a')?.estrellas_por_dia).toBe(20);
    expect(r.proyectos.find((p) => p.repo === 'ana/b')?.estrellas_por_dia).toBeNull();
  });

  it('avisa de los repos renombrados, cuenta una vez los repetidos y ordena por nombre', () => {
    const renombrado = repo('ana/nuevo-nombre');
    const r = construirCatalogo(
      datos({
        'ana/zeta': repo('ana/zeta'),
        'ana/viejo-nombre': renombrado,
        'ana/otro-alias': renombrado,
      }),
    );
    expect(r.proyectos.map((p) => p.repo)).toEqual(['ana/nuevo-nombre', 'ana/zeta']);
    expect(r.avisos).toContain(
      'ana/viejo-nombre ahora se llama ana/nuevo-nombre: actualiza la semilla',
    );
    expect(r.avisos).toContain(
      'ana/otro-alias y ana/viejo-nombre son el mismo repo (ana/nuevo-nombre): se cuenta una vez',
    );
  });

  it('un proyecto cuyos temas ya no existen es un error, no se publica a medias', () => {
    const d = datos({ 'ana/visor': repo('ana/visor') });
    const r = construirCatalogo({
      ...d,
      semilla: [{ repo: 'ana/visor', temas: ['tema-borrado'], origen: [] }],
    });
    expect(r.errores).toEqual(['ana/visor: ninguno de sus temas existe en la taxonomía']);
    expect(r.proyectos).toEqual([]);
  });

  it('un repo archivado o abandonado queda así y pierde puntos', () => {
    const r = construirCatalogo(
      datos({
        'ana/archivado': repo('ana/archivado', { archivado: true }),
        'ana/parado': repo('ana/parado', { ultimoCommit: '2025-01-01T00:00:00Z', version: null }),
      }),
    );
    const por = (nombre: string) => r.proyectos.find((p) => p.repo === nombre);
    expect(por('ana/archivado')?.estado).toBe('abandonado');
    expect(por('ana/archivado')?.puntuacion_detalle.penalizaciones).toEqual(['archivado']);
    expect(por('ana/parado')?.estado).toBe('abandonado');
    expect(por('ana/parado')?.puntuacion_detalle.penalizaciones).toEqual(['sin-actividad']);
    expect(por('ana/parado')?.version).toBeNull();
  });
});

describe('licenciasPorRevisar', () => {
  it('pide revisar «otra» y «sin licencia», salvo las que ya ha corregido una persona', () => {
    const repos = new Map<string, RepoDiario | null>([
      ['ana/mit', repo('ana/mit')],
      ['ana/otra', repo('ana/otra', { licencia: 'NOASSERTION' })],
      ['ana/nada', repo('ana/nada', { licencia: null })],
      ['ana/corregida', repo('ana/corregida', { licencia: null })],
      ['ana/borrada', null],
    ]);
    const semilla = [...repos.keys()].map((r) => ({ repo: r, temas: ['terminal'], origen: [] }));
    const editorial: Editorial = {
      version: 1,
      correcciones: [
        {
          repo: 'ana/corregida',
          tipo: 'licencia',
          valor: 'open-source',
          motivo: 'MIT en README',
          fecha: '2026-10-17',
        },
      ],
    };
    expect(licenciasPorRevisar(semilla, repos, editorial)).toEqual([
      { repo: 'ana/otra', categoria: 'otra' },
      { repo: 'ana/nada', categoria: 'sin-licencia' },
    ]);
  });
});
