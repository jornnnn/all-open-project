import { describe, expect, it } from 'vitest';
import { AUGE_MINIMO, evaluarAuge, ganadasEn24h, ritmoHabitual, sumarDias } from './tendencias.ts';

const actual = { momento: '2026-10-17T12:23:00Z', estrellas: 1500 };

describe('ganadasEn24h', () => {
  it('parte de la primera observación desde hace 24 h, no de una anterior', () => {
    const r = ganadasEn24h(
      actual,
      [
        { momento: '2026-10-16T10:23:00Z', estrellas: 900 }, // más de 24 h: no vale
        { momento: '2026-10-16T13:23:00Z', estrellas: 1000 },
        { momento: '2026-10-16T12:30:00Z', estrellas: 990 },
        { momento: '2026-10-17T11:23:00Z', estrellas: 1450 },
      ],
      '2026-01-01T00:00:00Z',
    );
    expect(r).toEqual({
      ganadas: 510,
      desde: { momento: '2026-10-16T12:30:00Z', estrellas: 990 },
      horas: 23.9,
    });
  });

  it('nunca exagera: con un hueco, cuenta solo desde la primera observación posterior', () => {
    const r = ganadasEn24h(
      actual,
      [{ momento: '2026-10-17T06:23:00Z', estrellas: 1200 }],
      '2026-01-01T00:00:00Z',
    );
    expect(r?.ganadas).toBe(300);
    expect(r?.horas).toBe(6);
  });

  it('un repo creado en las últimas 24 h parte de cero', () => {
    const r = ganadasEn24h(actual, [], '2026-10-17T02:00:00Z');
    expect(r).toEqual({
      ganadas: 1500,
      desde: { momento: '2026-10-17T02:00:00Z', estrellas: 0 },
      horas: 10.4,
    });
  });

  it('sin observaciones desde hace 24 h no se puede medir', () => {
    expect(
      ganadasEn24h(
        actual,
        [{ momento: '2026-10-15T12:00:00Z', estrellas: 10 }],
        '2026-01-01T00:00:00Z',
      ),
    ).toBeNull();
  });

  it('ignora la observación actual y las posteriores', () => {
    expect(
      ganadasEn24h(
        actual,
        [actual, { momento: '2026-10-17T13:00:00Z', estrellas: 2000 }],
        '2026-01-01T00:00:00Z',
      ),
    ).toBeNull();
  });

  it('si las estrellas bajan (alguien las quita), no da ganancias negativas', () => {
    const r = ganadasEn24h(
      actual,
      [{ momento: '2026-10-17T00:00:00Z', estrellas: 1600 }],
      '2026-01-01T00:00:00Z',
    );
    expect(r?.ganadas).toBe(0);
  });
});

describe('ritmoHabitual', () => {
  const semanas = (desde: string, valores: number[]) =>
    valores.map((estrellas, i) => ({ dia: sumarDias(desde, i), estrellas }));

  it('media de los 7 días completos anteriores a ayer (ni ayer ni hoy cuentan)', () => {
    // Del 7 al 17 de octubre; hoy es el 17: cuentan del 9 al 15.
    const dias = semanas('2026-10-07', [500, 500, 10, 20, 30, 40, 50, 60, 70, 9000, 300]);
    expect(ritmoHabitual(dias, '2026-10-17', '2026-01-01')).toEqual({ ritmo: 40, dias: 7 });
  });

  it('en un repo joven cuenta los días que tiene, sin el de su creación', () => {
    // Creado el 12: cuentan del 13 al 15.
    const dias = semanas('2026-10-12', [700, 10, 20, 30, 5000, 100]);
    expect(ritmoHabitual(dias, '2026-10-17', '2026-10-12')).toEqual({ ritmo: 20, dias: 3 });
  });

  it('un repo de ayer o de hoy tiene ritmo 0', () => {
    const dias = semanas('2026-10-16', [800, 300]);
    expect(ritmoHabitual(dias, '2026-10-17', '2026-10-16')).toEqual({ ritmo: 0, dias: 0 });
  });
});

describe('evaluarAuge', () => {
  it('entra con al menos 100 estrellas y más de 5 veces su ritmo', () => {
    expect(evaluarAuge(100, 0)).toEqual({ enAuge: true, umbral: 100, veces: null });
    expect(evaluarAuge(99, 0).enAuge).toBe(false);
    expect(evaluarAuge(501, 100)).toEqual({ enAuge: true, umbral: 500, veces: 5 });
    // Justo 5 veces no basta: tiene que ser más.
    expect(evaluarAuge(500, 100).enAuge).toBe(false);
  });

  it('los proyectos grandes necesitan mucho más que 100 estrellas', () => {
    expect(evaluarAuge(1200, 300)).toMatchObject({ enAuge: false, umbral: 1500 });
  });

  it('si ya estaba en auge, sigue mientras no baje del 80 % de su umbral', () => {
    expect(evaluarAuge(80, 0, true).enAuge).toBe(true);
    expect(evaluarAuge(79, 0, true).enAuge).toBe(false);
    expect(evaluarAuge(400, 100, true).enAuge).toBe(true);
    expect(evaluarAuge(399, 100, true).enAuge).toBe(false);
  });

  it('el mínimo es el de la metodología', () => {
    expect(AUGE_MINIMO).toBe(100);
  });
});
