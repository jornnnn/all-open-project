import { describe, expect, it } from 'vitest';
import { entradasDelRadar } from './entradas.ts';

describe('entradasDelRadar', () => {
  const semilla = [{ repo: 'Ana/Editor', temas: ['edicion-de-fotos'], origen: ['busqueda'] }];

  it('añade los aceptados con origen «radar», sin repetir lo que ya está en la semilla', () => {
    expect(
      entradasDelRadar(semilla, [
        { id: 2, repo: 'zeta/visor', temas: ['edicion-de-fotos'] },
        { id: 1, repo: 'ana/editor', temas: ['edicion-de-fotos'] },
        { id: 3, repo: 'beta/notas', temas: ['notas', 'oficina'] },
      ]),
    ).toEqual([
      { repo: 'beta/notas', temas: ['notas', 'oficina'], origen: ['radar'] },
      { repo: 'zeta/visor', temas: ['edicion-de-fotos'], origen: ['radar'] },
    ]);
  });

  it('sin tema no entra (no podría tener ficha)', () => {
    expect(
      entradasDelRadar(semilla, [
        { id: 4, repo: 'x/sin-tema', temas: [] },
        { id: 5, repo: 'x/nulo', temas: null },
      ]),
    ).toEqual([]);
  });
});
