import { sumarDias } from '@aop/core';
import { describe, expect, it } from 'vitest';
import { cargarDatos } from './datos.ts';
import type { RepoRadar } from './github.ts';
import {
  anotarCopiaMirada,
  anotarEncontrados,
  anotarRitmo,
  type Candidato,
  decidir,
  elegirOriginales,
  evaluarAuges,
  type HoraGuardada,
  type Medida,
  medir,
  memoriaVacia,
  montarTendencias,
  necesitaRitmo,
  observacionDeHoy,
  observacionesDeLaMemoria,
  originalesParecidos,
  type ProyectoRadar,
  proyeccion24h,
  RADAR,
  recortarVigilados,
  tocaMirarCopia,
  turnoDeCopias,
} from './radar.ts';

const { taxonomia } = await cargarDatos();
const ahora = new Date('2026-10-17T12:23:00Z');

function repo(id: number, cambios: Partial<RepoRadar> = {}): RepoRadar {
  return {
    id,
    repo: `nuevo/repo-${id}`,
    descripcion: 'Un editor de fotos nuevo',
    web: null,
    estrellas: 300,
    forks: 20,
    esFork: false,
    archivado: false,
    espejo: false,
    creado: '2026-10-10T08:00:00Z',
    ultimoPush: '2026-10-17T08:00:00Z',
    ultimoCommit: null,
    lenguaje: 'Rust',
    licencia: 'MIT',
    topics: ['photo-editor'],
    ...cambios,
  };
}

describe('anotarEncontrados', () => {
  it('apunta los nuevos y solo las fuentes nuevas de los que ya se vigilan', () => {
    const conocido: Candidato = {
      id: 2,
      repo: 'nuevo/repo-2',
      fuentes: { 'busqueda-7d': '2026-10-16T10:23:00Z' },
      estado: 'vigilando',
      estrellas: 200,
      creado: '2026-10-10T08:00:00Z',
      detectado: '2026-10-16T10:23:00Z',
      actualizado: '2026-10-16T10:23:00Z',
      datos: null,
    };
    const cambios = anotarEncontrados(
      [
        { repo: repo(1), fuente: 'busqueda-2d' },
        { repo: repo(1), fuente: 'busqueda-7d' },
        { repo: repo(2), fuente: 'busqueda-7d' }, // ya la tenía: no cambia nada
        { repo: repo(2), fuente: 'gharchive' },
      ],
      new Set(),
      new Map([[2, conocido]]),
      new Set(),
      ahora,
    );
    expect(cambios.map((c) => [c.id, Object.keys(c.fuentes).sort()])).toEqual([
      [1, ['busqueda-2d', 'busqueda-7d']],
      [2, ['busqueda-7d', 'gharchive']],
    ]);
    expect(cambios[1]?.detectado).toBe('2026-10-16T10:23:00Z');
  });

  it('no vigila lo que está en el catálogo, excluido, descartado, ni forks, listas o sin código', () => {
    const descartado = { id: 5, estado: 'descartado' } as Candidato;
    const cambios = anotarEncontrados(
      [
        { repo: repo(1), fuente: 'b' },
        { repo: repo(2, { repo: 'malo/excluido' }), fuente: 'b' },
        { repo: repo(3, { esFork: true }), fuente: 'b' },
        { repo: repo(4, { topics: ['awesome-list'] }), fuente: 'b' },
        { repo: repo(5), fuente: 'b' },
        { repo: repo(6, { lenguaje: null }), fuente: 'b' },
      ],
      new Set([1]),
      new Map([[5, descartado]]),
      new Set(['malo/excluido']),
      ahora,
    );
    expect(cambios).toEqual([]);
  });
});

const hora = (momento: string, estrellas: Record<string, number>): HoraGuardada => ({
  hora: momento.slice(0, 13),
  momento,
  estrellas,
});

describe('medir y evaluarAuges', () => {
  const horas = [
    // 3 minutos antes del límite de 24 h: no cuenta.
    hora('2026-10-16T12:20:00Z', { '1': 1000, '2': 50_000 }),
    hora('2026-10-17T06:25:00Z', { '1': 1100, '2': 50_300 }),
  ];
  const vigilados = [
    {
      id: 1,
      repo: 'a/uno',
      estrellas: 1700,
      creado: '2026-01-01T00:00:00Z',
      enCatalogo: true,
      descripcion: null,
    },
    {
      id: 2,
      repo: 'b/dos',
      estrellas: 50_500,
      creado: '2026-01-01T00:00:00Z',
      enCatalogo: true,
      descripcion: null,
    },
    {
      id: 3,
      repo: 'c/tres',
      estrellas: 150,
      creado: '2026-10-17T03:00:00Z',
      enCatalogo: false,
      descripcion: null,
    },
    {
      id: 4,
      repo: 'd/cuatro',
      estrellas: 999,
      creado: '2026-01-01T00:00:00Z',
      enCatalogo: false,
      descripcion: null,
    },
  ];

  it('mide desde la primera observación de las últimas 24 h (o desde que nació)', () => {
    const medidas = medir(vigilados, horas, new Map(), ahora);
    // Con el historial oficial de hoy (el día de GitHub empezó a las 07:00 UTC y tenía 700), el 4 se
    // puede medir aunque aún no tenga fotos propias.
    const conHistorial = medir(
      vigilados,
      horas,
      new Map([[4, [{ momento: '2026-10-17T07:00:00.000Z', estrellas: 700 }]]]),
      ahora,
    );
    expect(conHistorial.find((m) => m.id === 4)?.ganadas).toBe(299);
    expect(medidas.map((m) => [m.id, m.ganadas, m.horas])).toEqual([
      [1, 600, 6],
      [2, 200, 6],
      [3, 150, 9.4],
      [4, null, null],
    ]);
  });

  it('entra en auge con su ritmo del día; sale al bajar del 80 %; lo excluido no sale', () => {
    const memoria = memoriaVacia();
    const hoy = '2026-10-17';
    memoria.ritmos = { '1': [hoy, 20, 7], '2': [hoy, 300, 7], '3': [hoy, 0, 0] };
    const medidas = medir(vigilados, horas, new Map(), ahora);
    // Los que han ganado 50 o más, y el que aún no se puede medir (el 4).
    expect(medidas.filter((m) => necesitaRitmo(m, memoriaVacia(), hoy)).map((m) => m.id)).toEqual([
      1, 2, 3, 4,
    ]);

    const primero = evaluarAuges(medidas, memoria, hoy, ahora, new Set([3]));
    expect(primero.enAuge.map((a) => [a.repo, a.ganadas, a.veces])).toEqual([['a/uno', 600, 30]]);
    expect(primero.cambios).toMatchObject([
      { repo_id: 1, hasta: null, datos: { ganadas_24h: 600 } },
    ]);

    // Una hora después ha ganado menos: sigue mientras no baje del 80 % del umbral (100 → 80).
    const despues = new Date('2026-10-17T13:23:00Z');
    const flojo: Medida[] = [{ ...(medidas[0] as Medida), ganadas: 85 }];
    expect(evaluarAuges(flojo, memoria, hoy, despues, new Set()).enAuge).toHaveLength(1);
    const sale = evaluarAuges(
      [{ ...(medidas[0] as Medida), ganadas: 79 }],
      memoria,
      hoy,
      despues,
      new Set(),
    );
    expect(sale.enAuge).toEqual([]);
    expect(sale.cambios).toMatchObject([
      { repo_id: 1, hasta: despues.toISOString(), datos: { maximo_24h: 600 } },
    ]);
    expect(memoria.auge).toEqual({});
  });

  it('sin el ritmo de hoy no decide; si estaba en auge sigue hasta poder medirlo', () => {
    const memoria = memoriaVacia();
    memoria.auge = { '1': { desde: '2026-10-17T10:23:00Z', repo: 'a/uno', maximo: 500 } };
    memoria.ritmos = { '1': ['2026-10-16', 20, 7] };
    const medidas = medir(vigilados, horas, new Map(), ahora);
    const r = evaluarAuges(medidas, memoria, '2026-10-17', ahora, new Set());
    expect(r.cambios).toEqual([]);
    expect(memoria.auge['1']).toBeDefined();
    // Si deja de vigilarse, sale.
    expect(evaluarAuges([], memoria, '2026-10-17', ahora, new Set()).cambios).toHaveLength(1);
  });
});

describe('ritmo y estrellas al empezar el día', () => {
  const medida = (ganadas: number | null, horas: number | null): Medida => ({
    id: 7,
    repo: 'a/b',
    estrellas: 500,
    creado: '2026-10-01T00:00:00Z',
    enCatalogo: false,
    descripcion: null,
    ganadas,
    desde: null,
    horas,
  });

  it('pide el historial si a su ritmo de ahora ganaría 50 en 24 h, aunque lleve pocas horas', () => {
    // Caso real: 26 estrellas en 1 h (anujasid/blender-ai-mcp-addon, 17-oct-2026).
    expect(necesitaRitmo(medida(26, 1), memoriaVacia(), '2026-10-17')).toBe(true);
    expect(necesitaRitmo(medida(26, 24), memoriaVacia(), '2026-10-17')).toBe(false);
    expect(proyeccion24h(medida(10, 0.4))).toBe(240);
  });

  it('guarda las estrellas al empezar el día y las usa las horas siguientes', () => {
    const memoria = memoriaVacia();
    anotarRitmo(memoria, 7, [], '2026-10-17', '2026-10-01', 311);
    anotarRitmo(memoria, 8, [], '2026-10-17', '2026-10-01');
    memoria.ritmos['9'] = ['2026-10-16', 3, 7, 50];
    expect(observacionesDeLaMemoria(memoria, '2026-10-17', '2026-10-17T07:00:00.000Z')).toEqual(
      new Map([[7, { momento: '2026-10-17T07:00:00.000Z', estrellas: 311 }]]),
    );
  });
});

describe('observacionDeHoy', () => {
  it('las estrellas al empezar el día de GitHub: las de ahora menos las ganadas hoy', () => {
    const dias = [
      { dia: '2026-10-16', estrellas: 500 },
      { dia: '2026-10-17', estrellas: 299 },
    ];
    expect(observacionDeHoy(dias, '2026-10-17', '2026-10-17T07:00:00.000Z', 999)).toEqual({
      momento: '2026-10-17T07:00:00.000Z',
      estrellas: 700,
    });
    // Sin el día de hoy en el historial, o con cifras que no cuadran, no se inventa nada.
    expect(observacionDeHoy(dias, '2026-10-18', '2026-10-18T07:00:00.000Z', 999)).toBeNull();
    expect(observacionDeHoy(dias, '2026-10-17', '2026-10-17T07:00:00.000Z', 100)).toBeNull();
  });
});

describe('recortarVigilados', () => {
  it('con más del máximo, deja los de menos estrellas detectados antes de ayer', () => {
    const base: Candidato = {
      id: 0,
      repo: 'a/b',
      fuentes: {},
      estado: 'vigilando',
      estrellas: 0,
      creado: '2026-10-01T00:00:00Z',
      detectado: '2026-10-10T00:00:00Z',
      actualizado: '2026-10-10T00:00:00Z',
      datos: null,
    };
    const muchos = Array.from({ length: RADAR.maximoVigilados + 2 }, (_, i) => ({
      ...base,
      id: i + 1,
      estrellas: 1000 + i,
    }));
    // El 1 tiene menos estrellas, pero se detectó hace nada: se respeta.
    muchos[0] = { ...base, id: 1, estrellas: 5, detectado: ahora.toISOString() };
    const fuera = recortarVigilados(muchos, new Map([[3, 1]]), ahora);
    expect(fuera.map((c) => [c.id, c.estado])).toEqual([
      [3, 'descartado'],
      [2, 'descartado'],
    ]);
    expect(recortarVigilados(muchos.slice(0, 10), new Map(), ahora)).toEqual([]);
  });
});

describe('copias ya miradas', () => {
  it('no se vuelven a mirar en una semana, salvo que ganen 50 estrellas', () => {
    const memoria = memoriaVacia();
    expect(tocaMirarCopia(memoria, 1, 30, ahora)).toBe(true);
    anotarCopiaMirada(memoria, 1, 30, ahora);
    expect(tocaMirarCopia(memoria, 1, 79, ahora)).toBe(false);
    expect(tocaMirarCopia(memoria, 1, 80, ahora)).toBe(true);
    expect(tocaMirarCopia(memoria, 1, 30, new Date('2026-10-24T12:00:00Z'))).toBe(true);
    // Lo de hace más de una semana se olvida al apuntar otra.
    anotarCopiaMirada(memoria, 2, 5, new Date('2026-10-25T12:00:00Z'));
    expect(Object.keys(memoria.copiasMiradas ?? {})).toEqual(['2']);
  });
});

describe('decidir', () => {
  const candidato: Candidato = {
    id: 9,
    repo: 'nuevo/editor',
    fuentes: { 'busqueda-30d': '2026-10-06T00:00:00Z' },
    estado: 'vigilando',
    estrellas: 700,
    creado: '2026-10-05T00:00:00Z',
    detectado: '2026-10-06T00:00:00Z',
    actualizado: '2026-10-16T00:00:00Z',
    datos: {
      descripcion: 'Editor de fotos',
      lenguaje: 'Rust',
      licencia: 'MIT',
      topics: ['photo-editor'],
      forks: 40,
      esFork: false,
      archivado: false,
      espejo: false,
    },
  };
  const dias = Array.from({ length: 13 }, (_, i) => ({
    dia: sumarDias('2026-10-05', i),
    estrellas: 50,
  }));
  const opciones = {
    taxonomia,
    hoy: '2026-10-17',
    diaDeCreacion: '2026-10-05',
    diaDeDeteccion: '2026-10-06',
    excluido: false,
    posibleCopia: false,
    estrellas: 900,
    ahora,
  };

  it('si cumple la regla se propone (no entra solo), con sus temas', () => {
    const r = decidir(candidato, dias, opciones);
    expect(r.decision.decision).toBe('entra');
    expect(r.candidato.estado).toBe('propuesto');
    expect(r.candidato.datos?.temas?.[0]).toBe('edicion-de-fotos');
    expect(r.candidato.datos?.decidido).toBe('2026-10-17');
    expect(r.candidato.estrellas).toBe(900);
  });

  it('una posible copia espera; una copia confirmada se deja', () => {
    expect(decidir(candidato, dias, { ...opciones, posibleCopia: true }).candidato.estado).toBe(
      'vigilando',
    );
    expect(decidir(candidato, dias, { ...opciones, excluido: true }).candidato.estado).toBe(
      'descartado',
    );
  });
});

describe('copias', () => {
  const proyecto = (id: number, repo: string, estrellas: number): ProyectoRadar => ({
    id,
    repo,
    estrellas,
    creado: '2020-01-01T00:00:00Z',
    descripcion: null,
    sistemas: [],
    tieneDescargas: false,
  });
  const catalogo = [
    proyecto(1, 'morluto/rea', 297_000),
    proyecto(2, 'ollama/ollama', 150_000),
    proyecto(3, 'pequeno/cosa', 10),
  ];

  it('elige los más populares y encuentra a cuál se parece cada nombre', () => {
    expect(elegirOriginales(catalogo).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(originalesParecidos('bbylw/rea-cn', catalogo).map((r) => r.original.repo)).toEqual([
      'morluto/rea',
    ]);
    // El mismo dueño no es una copia.
    expect(originalesParecidos('ollama/ollama-desktop', catalogo)).toEqual([]);
  });

  it('busca los nombres por turnos y da la vuelta a la lista', () => {
    const memoria = memoriaVacia();
    const originales = Array.from({ length: 30 }, (_, i) => proyecto(i, `o${i}/n${i}`, 100 - i));
    const primera = turnoDeCopias(originales, memoria).map((p) => p.id);
    const segunda = turnoDeCopias(originales, memoria).map((p) => p.id);
    expect(primera).toHaveLength(RADAR.originalesPorEjecucion);
    expect(segunda[0]).toBe(RADAR.originalesPorEjecucion);
    expect(segunda.at(-1)).toBe((2 * RADAR.originalesPorEjecucion - 1) % 30);
  });
});

describe('montarTendencias', () => {
  it('lo que está en auge lleva su serie y sus cifras para comprobarlas; lo excluido no sale', () => {
    const memoria = memoriaVacia();
    memoria.ritmos = { '1': ['2026-10-17', 20, 7] };
    const horas = [hora('2026-10-17T06:25:00Z', { '1': 1100, '2': 10 })];
    const medidas = medir(
      [
        {
          id: 1,
          repo: 'a/uno',
          estrellas: 1700,
          creado: '2026-01-01T00:00:00Z',
          enCatalogo: true,
          descripcion: 'Uno',
        },
        {
          id: 2,
          repo: 'b/dos',
          estrellas: 400,
          creado: '2026-01-01T00:00:00Z',
          enCatalogo: false,
          descripcion: null,
        },
      ],
      horas,
      new Map(),
      ahora,
    );
    const { enAuge } = evaluarAuges(medidas, memoria, '2026-10-17', ahora, new Set());
    const t = montarTendencias({ medidas, enAuge, memoria, horas, ahora, excluir: new Set([2]) });
    expect(t.en_auge).toHaveLength(1);
    expect(t.en_auge[0]).toMatchObject({
      repo: 'a/uno',
      ganadas_24h: 600,
      ritmo_habitual: 20,
      veces: 30,
      medido_desde: { momento: '2026-10-17T06:25:00Z', estrellas: 1100 },
      serie: [
        ['2026-10-17T06:25:00Z', 1100],
        [ahora.toISOString(), 1700],
      ],
    });
    expect(t.suben.map((s) => s.repo)).toEqual(['a/uno']);
    expect(t.licencia).toBe('CC BY 4.0');
  });
});
