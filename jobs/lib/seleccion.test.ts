import { esquemaTaxonomia } from '@aop/core';
import { describe, expect, it } from 'vitest';
import type { RepoGithub } from './github.ts';
import { construirProyecto, elegirProyectos } from './seleccion.ts';

const ahora = new Date('2026-10-16T00:00:00Z');

function repo(nombre: string, extra: Partial<RepoGithub> = {}): RepoGithub {
  return {
    repo: nombre,
    descripcion: null,
    web: null,
    estrellas: 1000,
    forks: 10,
    esFork: false,
    archivado: false,
    espejo: false,
    creado: '2020-01-01T00:00:00Z',
    ultimoPush: '2026-10-01T00:00:00Z',
    ultimoCommit: '2026-10-01T00:00:00Z',
    lenguaje: 'Rust',
    licencia: 'MIT',
    topics: [],
    ...extra,
  };
}

const taxonomia = esquemaTaxonomia.parse({
  version: 1,
  areas: [
    {
      id: 'fotos',
      slug_en: 'photos',
      nombre: { es: 'Fotos', en: 'Photos' },
      icono: 'image',
      tono: 35,
      subtemas: [
        {
          id: 'edicion-de-fotos',
          slug_en: 'photo-editing',
          nombre: { es: 'Edición', en: 'Editing' },
          publico: 'usar',
          topics: ['photo-editor'],
        },
        {
          id: 'gestion-de-fotos',
          slug_en: 'photo-management',
          nombre: { es: 'Gestión', en: 'Management' },
          publico: 'usar',
          topics: ['photo-gallery'],
        },
      ],
    },
  ],
});

describe('elegirProyectos', () => {
  // Cada lista viene ordenada por estrellas, como en la semilla.
  const listas = new Map([
    ['a', ['a1', 'a2', 'a3', 'a4']],
    ['b', ['b1', 'b2']],
    ['c', ['a1', 'c1', 'c2', 'c3']],
  ]);
  const estrellas = new Map([
    ['a1', 900],
    ['a2', 800],
    ['a3', 700],
    ['a4', 100],
    ['b1', 50],
    ['b2', 40],
    ['c1', 600],
    ['c2', 650],
    ['c3', 20],
  ]);

  it('aplica el mismo cupo a todos los subtemas y no cuenta dos veces un repo', () => {
    // Cupo 2: a1 a2 · b1 b2 · a1 c1 → 5 repos distintos; el objetivo ya se cumple.
    const { elegidos, porPopularidad } = elegirProyectos(listas, new Set(), estrellas, {
      cupo: 2,
      objetivo: 5,
    });
    expect(elegidos).toEqual(new Set(['a1', 'a2', 'b1', 'b2', 'c1']));
    expect(porPopularidad.size).toBe(0);
  });

  it('rellena hasta el objetivo con los más populares de cualquier subtema', () => {
    // Tras el cupo 1 (a1, b1) faltan 3: van a2 (800), a3 (700) y c2 (650), no b2 (40).
    const { elegidos, porPopularidad } = elegirProyectos(listas, new Set(), estrellas, {
      cupo: 1,
      objetivo: 5,
    });
    expect(porPopularidad).toEqual(new Set(['a2', 'a3', 'c2']));
    expect(elegidos).toEqual(new Set(['a1', 'b1', 'a2', 'a3', 'c2']));
  });

  it('suma siempre los fijos, aunque se pase del objetivo', () => {
    const { elegidos } = elegirProyectos(listas, new Set(['fijo']), estrellas, {
      cupo: 2,
      objetivo: 1,
    });
    expect(elegidos.has('fijo')).toBe(true);
    expect(elegidos.size).toBe(6);
  });

  it('si no hay bastantes candidatos, los coge todos', () => {
    const { elegidos } = elegirProyectos(listas, new Set(), estrellas, {
      cupo: 1,
      objetivo: 1000,
    });
    expect(elegidos.size).toBe(9);
  });
});

describe('construirProyecto', () => {
  it('asigna temas por topics y calcula estado y licencia', () => {
    const p = construirProyecto(
      repo('o/editor', { topics: ['photo-editor'], licencia: 'GPL-3.0' }),
      [{ tipo: 'busqueda', subtema: 'edicion-de-fotos' }],
      taxonomia,
      ahora,
    );
    expect(p).toMatchObject({
      repo: 'o/editor',
      temas: ['edicion-de-fotos'],
      origen: ['busqueda'],
      categoria_licencia: 'open-source',
      estado: 'vivo',
      ultimo_cambio: '2026-10-01',
    });
  });

  it('un alta manual pone sus subtemas delante de los de los topics', () => {
    const p = construirProyecto(
      repo('o/r', { topics: ['photo-editor'] }),
      [{ tipo: 'alta', subtemas: ['gestion-de-fotos'] }],
      taxonomia,
      ahora,
    );
    expect(p.temas).toEqual(['gestion-de-fotos', 'edicion-de-fotos']);
  });

  it('una alternativa sin topics conocidos toma los subtemas de su programa', () => {
    const p = construirProyecto(
      repo('GNOME/gimp', { topics: [] }),
      [{ tipo: 'alternativa', programa: 'photoshop', subtemas: ['edicion-de-fotos'] }],
      taxonomia,
      ahora,
    );
    expect(p.temas).toEqual(['edicion-de-fotos']);
    expect(p.origen).toEqual(['alternativa:photoshop']);
  });

  it('sin commit en la rama principal usa la fecha del último push', () => {
    const p = construirProyecto(
      repo('o/r', { ultimoCommit: null, ultimoPush: '2025-01-01T00:00:00Z' }),
      [{ tipo: 'alta', subtemas: ['edicion-de-fotos'] }],
      taxonomia,
      ahora,
    );
    expect(p.ultimo_cambio).toBe('2025-01-01');
    expect(p.estado).toBe('abandonado');
  });
});
