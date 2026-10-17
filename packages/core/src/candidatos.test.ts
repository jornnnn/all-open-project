import { describe, expect, it } from 'vitest';
import { type DatosCandidato, decidirCandidato } from './candidatos.ts';
import { sumarDias } from './tendencias.ts';

/** Días del historial de GitHub desde `desde`, con las estrellas de cada uno. */
const dias = (desde: string, valores: number[]) =>
  valores.map((estrellas, i) => ({ dia: sumarDias(desde, i), estrellas }));

/** Un candidato que cumple la regla: creado el 5, 7 días seguidos (del 10 al 16) con 10 o más. */
const bueno: DatosCandidato = {
  estrellas: 1200,
  forks: 80,
  esFork: false,
  archivado: false,
  espejo: false,
  lista: null,
  temas: ['edicion-de-fotos'],
  excluido: false,
  posibleCopia: false,
  dias: dias('2026-10-05', [400, 300, 150, 100, 60, 40, 30, 25, 20, 15, 10, 50, 7]),
  hoy: '2026-10-17',
  diaDeCreacion: '2026-10-05',
  diaDeDeteccion: '2026-10-06',
};

describe('decidirCandidato', () => {
  it('entra con 500+ estrellas, 7 días seguidos ganando 10 o más, forks y tema', () => {
    expect(decidirCandidato(bueno)).toEqual({
      decision: 'entra',
      temas: ['edicion-de-fotos'],
      motivo: '500+ estrellas y 7 días seguidos ganando 10 o más',
    });
  });

  it('el día de hoy no cuenta (está a medias), pero ayer sí', () => {
    // Ayer (16) ganó 9: no llega.
    const ayerFlojo = {
      ...bueno,
      dias: dias('2026-10-05', [400, 300, 150, 100, 60, 40, 30, 25, 20, 15, 10, 9, 500]),
    };
    expect(decidirCandidato(ayerFlojo)).toMatchObject({ decision: 'sigue' });
  });

  it('el día de su creación no cuenta como día completo', () => {
    const joven = {
      ...bueno,
      diaDeCreacion: '2026-10-10',
      dias: dias('2026-10-10', [900, 100, 80, 60, 40, 30, 20, 5]),
    };
    expect(decidirCandidato(joven)).toEqual({
      decision: 'sigue',
      motivo: 'aún no lleva 7 días seguidos ganando 10 o más',
    });
  });

  it('dice todo lo que le falta', () => {
    expect(
      decidirCandidato({ ...bueno, estrellas: 300, forks: 1, temas: [], posibleCopia: true }),
    ).toEqual({
      decision: 'sigue',
      motivo:
        'tiene menos de 500 estrellas; tiene muy pocos forks para sus estrellas; se llama como un proyecto famoso: espera a la revisión; sus topics no encajan en ningún tema',
    });
  });

  it('se deja si no es un programa o está excluido', () => {
    expect(decidirCandidato({ ...bueno, esFork: true })).toEqual({
      decision: 'descartar',
      motivo: 'es un fork',
    });
    expect(decidirCandidato({ ...bueno, lista: 'topic' })).toEqual({
      decision: 'descartar',
      motivo: 'es una lista o un curso',
    });
    expect(decidirCandidato({ ...bueno, lista: 'sin-codigo' }).motivo).toBe('no tiene código');
    expect(decidirCandidato({ ...bueno, excluido: true }).motivo).toBe('excluido a mano');
  });

  it('se deja si en 30 días no ha entrado', () => {
    const viejo = { ...bueno, estrellas: 300, diaDeDeteccion: '2026-09-15' };
    expect(decidirCandidato(viejo)).toEqual({
      decision: 'descartar',
      motivo: 'en 30 días no ha entrado (tiene menos de 500 estrellas)',
    });
  });

  it('si solo le falta el tema, avisa para añadirlo a mano', () => {
    const sinTema = { ...bueno, temas: [], diaDeDeteccion: '2026-09-15' };
    expect(decidirCandidato(sinTema).motivo).toBe(
      'cumple la regla, pero sus topics no encajan en ningún tema: hay que añadirlo a mano',
    );
  });

  it('se deja si lleva una semana vigilado y se ha parado', () => {
    const parado = {
      ...bueno,
      estrellas: 450,
      dias: dias('2026-10-05', [400, 30, 10, 5, 2, 1, 0, 1, 0, 0, 3, 2, 0]),
    };
    expect(decidirCandidato(parado)).toEqual({
      decision: 'descartar',
      motivo: 'se ha parado: casi no gana estrellas',
    });
    // Recién detectado, aún se espera.
    expect(decidirCandidato({ ...parado, diaDeDeteccion: '2026-10-15' }).decision).toBe('sigue');
  });
});
