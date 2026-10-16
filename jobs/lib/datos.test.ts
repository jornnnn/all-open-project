// Valida los datos editoriales reales de data/: si alguien rompe un YAML, este test falla.

import { describe, expect, it } from 'vitest';
import { cargarDatos } from './datos.ts';

const datos = await cargarDatos();
const subtemas = datos.taxonomia.areas.flatMap((area) => area.subtemas);

describe('data/', () => {
  it('los cuatro archivos cumplen su esquema y encajan entre sí', () => {
    // cargarDatos ya falla si algo no cuadra; aquí se comprueba que ha devuelto todo.
    expect(Object.keys(datos).sort()).toEqual([
      'alternativas',
      'editorial',
      'semilla',
      'taxonomia',
    ]);
  });

  it('la taxonomía tiene unas 12 áreas y unos 60-70 subtemas', () => {
    expect(datos.taxonomia.areas.length).toBeGreaterThanOrEqual(10);
    expect(datos.taxonomia.areas.length).toBeLessThanOrEqual(15);
    expect(subtemas.length).toBeGreaterThanOrEqual(50);
    expect(subtemas.length).toBeLessThanOrEqual(80);
  });

  it('las áreas de la portada son las tareas de la maqueta', () => {
    const portada = datos.taxonomia.areas.filter((a) => a.portada).map((a) => a.id);
    expect(portada.sort()).toEqual(
      ['fotos', 'ia', 'juegos', 'musica', 'oficina', 'programar', 'seguridad', 'video'].sort(),
    );
  });

  it('hay unos 100 programas de pago, cada uno con alternativas', () => {
    expect(datos.alternativas.programas.length).toBeGreaterThanOrEqual(100);
    for (const programa of datos.alternativas.programas) {
      expect(programa.alternativas.length).toBeGreaterThan(0);
    }
  });

  it('editorial.yaml empieza vacío', () => {
    expect(datos.editorial.correcciones).toEqual([]);
  });
});
