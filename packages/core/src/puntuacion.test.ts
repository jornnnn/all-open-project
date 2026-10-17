import { describe, expect, it } from 'vitest';
import {
  calcularPuntuaciones,
  calcularSalud,
  type DatosPuntuacion,
  MINIMO_POR_GRUPO,
  percentil,
} from './puntuacion.ts';

/** Proyecto sano y normal; cada test cambia solo lo que le interesa. */
function proyecto(clave: string, cambios: Partial<DatosPuntuacion> = {}): DatosPuntuacion {
  return {
    clave,
    temas: ['edicion-de-fotos'],
    area: 'fotos',
    estado: 'vivo',
    archivado: false,
    sinLicencia: false,
    estrellas: 1000,
    forks: 100,
    estrellasPorDia: null,
    diasSinCambios: 5,
    diasDesdeVersion: 20,
    issuesAbiertas: 10,
    issuesCerradas: 90,
    descargasPorDia: null,
    ...cambios,
  };
}

/** Un tema con `n` proyectos cuyas estrellas y forks crecen con el índice. */
function tema(n: number, cambios: (i: number) => Partial<DatosPuntuacion> = () => ({})) {
  return Array.from({ length: n }, (_, i) =>
    proyecto(`o/r${i}`, { estrellas: 100 * (i + 1), forks: 10 * (i + 1), ...cambios(i) }),
  );
}

describe('percentil', () => {
  it('cuenta la parte que queda por debajo y los empates como medio', () => {
    const lista = [1, 2, 3, 4];
    expect(percentil(lista, 1)).toBe(0.125);
    expect(percentil(lista, 4)).toBe(0.875);
    expect(percentil(lista, 2.5)).toBe(0.5);
    expect(percentil([5, 5, 5, 5], 5)).toBe(0.5);
    expect(percentil([7], 7)).toBe(0.5);
    expect(percentil([], 3)).toBe(0.5);
  });
});

describe('calcularSalud', () => {
  const base = {
    estado: 'vivo' as const,
    diasSinCambios: 0,
    diasDesdeVersion: null,
    issuesAbiertas: null,
    issuesCerradas: null,
  };

  it('la actividad vale 1 hasta 30 días y baja en línea recta hasta 0 al año', () => {
    expect(calcularSalud({ ...base, diasSinCambios: 30 })).toBe(1);
    expect(calcularSalud({ ...base, diasSinCambios: 197.5 })).toBeCloseTo(0.5);
    expect(calcularSalud({ ...base, diasSinCambios: 365 })).toBe(0);
    expect(calcularSalud({ ...base, diasSinCambios: 900 })).toBe(0);
  });

  it('hace la media con las versiones y las issues solo si hay datos', () => {
    expect(calcularSalud({ ...base, diasDesdeVersion: 730 })).toBe(0.5);
    // Con menos de 10 issues entre abiertas y cerradas no cuentan.
    expect(calcularSalud({ ...base, issuesAbiertas: 5, issuesCerradas: 0 })).toBe(1);
    expect(calcularSalud({ ...base, issuesAbiertas: 30, issuesCerradas: 10 })).toBe(0.625);
  });

  it('un proyecto terminado no pierde salud por no tener cambios', () => {
    const viejo = { ...base, diasSinCambios: 2000, diasDesdeVersion: 2000 };
    expect(calcularSalud({ ...viejo, estado: 'terminado' })).toBe(1);
    expect(calcularSalud(viejo)).toBe(0);
  });
});

describe('calcularPuntuaciones', () => {
  it('ordena dentro del tema: más estrellas y forks, más puntuación, siempre entre 0 y 100', () => {
    const proyectos = tema(20);
    const p = calcularPuntuaciones(proyectos);
    const totales = proyectos.map((x) => p.get(x.clave)?.total ?? -1);
    expect(totales).toEqual([...totales].sort((a, b) => a - b));
    for (const t of totales) {
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(100);
    }
    expect(p.get('o/r19')?.grupo).toBe('edicion-de-fotos');
  });

  it('compara dentro de cada tema: el mejor de un tema pequeño puntúa como el de uno grande', () => {
    const grandes = tema(40, () => ({ temas: ['agentes-de-ia'], area: 'ia' }));
    const pequenos = tema(MINIMO_POR_GRUPO, (i) => ({
      temas: ['mapas'],
      area: 'internet',
      estrellas: 10 + i,
      forks: 1 + i,
    }));
    const p = calcularPuntuaciones([...grandes, ...pequenos]);
    // Los dos primeros de su tema, con todo lo demás igual: la popularidad es casi la misma.
    const mejorGrande = p.get('o/r39');
    expect(mejorGrande?.popularidad).toBe(99);
    const mejorPequeno = calcularPuntuaciones(pequenos).get(`o/r${MINIMO_POR_GRUPO - 1}`);
    expect(mejorPequeno?.popularidad).toBe(95);
  });

  it('cada proyecto se compara con todos los que tienen su tema principal, en cualquier posición', () => {
    // «o/mapa» tiene «mapas» como tema principal; los demás, como secundario y con más estrellas.
    const proyectos = [
      proyecto('o/mapa', { temas: ['mapas'], estrellas: 1, forks: 0 }),
      ...tema(MINIMO_POR_GRUPO, () => ({ temas: ['domotica', 'mapas'] })),
    ];
    const mapa = calcularPuntuaciones(proyectos).get('o/mapa');
    expect(mapa?.grupo).toBe('mapas');
    expect(mapa?.popularidad).toBeLessThan(10);
  });

  it('si el tema tiene menos de 10 proyectos, compara con toda el área', () => {
    const proyectos = [
      proyecto('o/solo', { temas: ['seguridad-del-codigo'], area: 'seguridad' }),
      ...tema(12, () => ({ temas: ['contrasenas-y-cifrado'], area: 'seguridad' })),
    ];
    expect(calcularPuntuaciones(proyectos).get('o/solo')?.grupo).toBe('seguridad');
  });

  it('sin datos de impulso ni de uso, sus pesos se reparten entre popularidad y salud', () => {
    const p = calcularPuntuaciones(tema(20)).get('o/r19');
    expect(p?.impulso).toBeNull();
    expect(p?.uso).toBeNull();
    // (30 × popularidad + 30 × salud) / 60
    const esperado = Math.round((30 * (p?.popularidad ?? 0) + 30 * (p?.salud ?? 0)) / 60);
    expect(Math.abs((p?.total ?? 0) - esperado)).toBeLessThanOrEqual(1);
  });

  it('el impulso y el uso suben la puntuación de quien más crece y más se descarga', () => {
    const proyectos = tema(20, (i) => ({
      estrellas: 1000,
      forks: 100,
      estrellasPorDia: i,
      descargasPorDia: i * 10,
    }));
    const p = calcularPuntuaciones(proyectos);
    expect(p.get('o/r19')?.impulso).toBeGreaterThan(90);
    expect(p.get('o/r0')?.impulso).toBeLessThan(10);
    expect(p.get('o/r19')?.total).toBeGreaterThan(p.get('o/r0')?.total ?? 100);
  });

  it('resta puntos si está archivado, abandonado o sin licencia, sin bajar de 0', () => {
    const proyectos = tema(20);
    proyectos[19] = { ...proyectos[19], archivado: true, estado: 'abandonado' } as DatosPuntuacion;
    proyectos[18] = { ...proyectos[18], estado: 'abandonado' } as DatosPuntuacion;
    proyectos[17] = { ...proyectos[17], sinLicencia: true } as DatosPuntuacion;
    proyectos[0] = {
      ...proyectos[0],
      archivado: true,
      estado: 'abandonado',
      sinLicencia: true,
      diasSinCambios: 3000,
    } as DatosPuntuacion;
    const p = calcularPuntuaciones(proyectos);
    expect(p.get('o/r19')?.penalizaciones).toEqual(['archivado']);
    expect(p.get('o/r18')?.penalizaciones).toEqual(['sin-actividad']);
    expect(p.get('o/r17')?.penalizaciones).toEqual(['sin-licencia']);
    expect(p.get('o/r0')?.penalizaciones).toEqual(['archivado', 'sin-licencia']);
    expect(p.get('o/r0')?.total).toBe(0);

    const sinCastigo = calcularPuntuaciones(tema(20));
    expect(p.get('o/r19')?.total).toBe((sinCastigo.get('o/r19')?.total ?? 0) - 30);
    expect(p.get('o/r18')?.total).toBe((sinCastigo.get('o/r18')?.total ?? 0) - 20);
    expect(p.get('o/r17')?.total).toBe((sinCastigo.get('o/r17')?.total ?? 0) - 15);
  });

  it('un proyecto terminado no se penaliza por no tener actividad', () => {
    const proyectos = tema(20);
    proyectos[5] = {
      ...proyectos[5],
      estado: 'terminado',
      diasSinCambios: 2000,
    } as DatosPuntuacion;
    expect(calcularPuntuaciones(proyectos).get('o/r5')?.penalizaciones).toEqual([]);
  });

  it('da el mismo resultado sea cual sea el orden de entrada', () => {
    const proyectos = tema(30, (i) => ({ estrellasPorDia: (i * 7) % 11, descargasPorDia: i % 4 }));
    const a = calcularPuntuaciones(proyectos);
    const b = calcularPuntuaciones([...proyectos].reverse());
    for (const x of proyectos) expect(b.get(x.clave)).toEqual(a.get(x.clave));
  });
});
