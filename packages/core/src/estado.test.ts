import { describe, expect, it } from 'vitest';
import { calcularEstado, sumarMeses } from './estado.ts';

const ahora = new Date('2026-10-16T12:00:00Z');

describe('calcularEstado', () => {
  it.each([
    ['2026-10-10T00:00:00Z', 'vivo', 'cambios hace unos días'],
    ['2026-07-17T00:00:00Z', 'vivo', 'casi 3 meses'],
    ['2026-07-16T12:00:00Z', 'lento', 'justo 3 meses'],
    ['2026-01-01T00:00:00Z', 'lento', 'unos 9 meses'],
    ['2025-10-16T12:00:00Z', 'lento', 'justo 12 meses'],
    ['2025-10-16T11:59:59Z', 'abandonado', 'un segundo más de 12 meses'],
    ['2020-05-01T00:00:00Z', 'abandonado', 'años sin cambios'],
    ['2026-10-20T00:00:00Z', 'vivo', 'fecha futura por desfase de relojes'],
  ])('%s → %s (%s)', (ultimoCambio, esperado) => {
    expect(calcularEstado({ archivado: false, ultimoCambio }, ahora)).toBe(esperado);
  });

  it('un repo archivado está abandonado aunque tenga cambios recientes', () => {
    expect(calcularEstado({ archivado: true, ultimoCambio: '2026-10-15T00:00:00Z' }, ahora)).toBe(
      'abandonado',
    );
  });

  it('«terminado» lo decide una persona y manda incluso sobre archivado', () => {
    expect(
      calcularEstado(
        { archivado: true, ultimoCambio: '2019-01-01T00:00:00Z', terminado: true },
        ahora,
      ),
    ).toBe('terminado');
  });

  it('falla con una fecha no válida en vez de inventar un estado', () => {
    expect(() => calcularEstado({ archivado: false, ultimoCambio: 'ayer' }, ahora)).toThrow(
      /no válida/,
    );
  });
});

describe('sumarMeses', () => {
  it.each([
    ['2026-01-31T10:00:00Z', 1, '2026-02-28T10:00:00.000Z'],
    ['2024-01-31T10:00:00Z', 1, '2024-02-29T10:00:00.000Z'],
    ['2026-03-31T00:00:00Z', -1, '2026-02-28T00:00:00.000Z'],
    ['2026-10-16T12:00:00Z', -12, '2025-10-16T12:00:00.000Z'],
    ['2026-11-30T08:30:00Z', 3, '2027-02-28T08:30:00.000Z'],
    ['2026-01-15T00:00:00Z', -13, '2024-12-15T00:00:00.000Z'],
  ])('%s %+d meses → %s', (inicio, meses, esperado) => {
    expect(sumarMeses(new Date(inicio), meses).toISOString()).toBe(esperado);
  });
});
