import { describe, expect, it } from 'vitest';
import {
  type DatosEditoriales,
  esquemaAlternativas,
  esquemaEditorial,
  esquemaSemilla,
  esquemaTaxonomia,
  revisarDatos,
} from './datos.ts';

function subtema(id: string, topics: string[]) {
  return {
    id,
    slug_en: `${id}-en`,
    nombre: { es: id, en: id },
    publico: 'usar',
    topics,
  };
}

function datosValidos() {
  return {
    taxonomia: {
      version: 1,
      areas: [
        {
          id: 'fotos',
          slug_en: 'photos',
          nombre: { es: 'Fotos', en: 'Photos' },
          icono: 'image',
          tono: 35,
          portada: true,
          subtemas: [
            subtema('edicion-de-fotos', ['photo-editor']),
            subtema('gestion-de-fotos', ['photo-gallery']),
          ],
        },
      ],
    },
    alternativas: {
      version: 1,
      programas: [
        {
          id: 'photoshop',
          nombre: 'Adobe Photoshop',
          subtemas: ['edicion-de-fotos'],
          alternativas: ['GNOME/gimp', 'KDE/krita'],
        },
      ],
    },
    semilla: {
      version: 1,
      ajustes: {
        objetivo: 3000,
        minimo: 2500,
        maximo: 3500,
        estrellas_minimas: 100,
        meses_sin_actividad: 12,
        antiguedad_minima_dias: 90,
        cupo_por_subtema: 35,
        resultados_por_busqueda: 100,
      },
      altas: [{ repo: 'immich-app/immich', subtemas: ['gestion-de-fotos'], motivo: 'Referente' }],
    },
    editorial: { version: 1, correcciones: [] },
  };
}

function cargar(bruto: ReturnType<typeof datosValidos>): DatosEditoriales {
  return {
    taxonomia: esquemaTaxonomia.parse(bruto.taxonomia),
    alternativas: esquemaAlternativas.parse(bruto.alternativas),
    semilla: esquemaSemilla.parse(bruto.semilla),
    editorial: esquemaEditorial.parse(bruto.editorial),
  };
}

describe('esquemas de data/', () => {
  it('aceptan datos válidos y rellenan los valores por defecto', () => {
    const datos = cargar(datosValidos());
    expect(revisarDatos(datos)).toEqual([]);
    expect(datos.semilla.busquedas).toEqual([]);
    expect(datos.semilla.excluir).toEqual([]);
  });

  it('rechazan identificadores con mayúsculas o espacios', () => {
    const bruto = datosValidos();
    const area = bruto.taxonomia.areas[0];
    if (area) area.id = 'Fotos y diseño';
    expect(esquemaTaxonomia.safeParse(bruto.taxonomia).success).toBe(false);
  });

  it('rechazan campos desconocidos, para cazar erratas', () => {
    const bruto = { ...datosValidos().taxonomia, versión: 1 };
    expect(esquemaTaxonomia.safeParse(bruto).success).toBe(false);
  });

  it('rechazan repos sin el formato propietario/repo', () => {
    const bruto = datosValidos();
    const programa = bruto.alternativas.programas[0];
    if (programa) programa.alternativas = ['https://github.com/GNOME/gimp'];
    expect(esquemaAlternativas.safeParse(bruto.alternativas).success).toBe(false);
  });

  it('validan cada tipo de corrección editorial', () => {
    const comunes = { repo: 'o/r', motivo: 'Comprobado a mano', fecha: '2026-10-16' };
    const correcciones = [
      { tipo: 'estado', valor: 'terminado', ...comunes },
      { tipo: 'licencia', valor: 'con-limites', ...comunes },
      { tipo: 'temas', valor: ['edicion-de-fotos'], ...comunes },
      { tipo: 'publico', valor: 'programar', ...comunes },
      { tipo: 'oficial', valor: true, ...comunes },
      { tipo: 'excluir', ...comunes },
    ];
    expect(esquemaEditorial.safeParse({ version: 1, correcciones }).success).toBe(true);
    const mala = { tipo: 'estado', valor: 'vivo', ...comunes };
    expect(esquemaEditorial.safeParse({ version: 1, correcciones: [mala] }).success).toBe(false);
  });
});

describe('revisarDatos', () => {
  it('detecta un topic en dos subtemas', () => {
    const bruto = datosValidos();
    bruto.taxonomia.areas[0]?.subtemas[1]?.topics.push('photo-editor');
    expect(revisarDatos(cargar(bruto))).toEqual([
      'taxonomia.yaml: el topic «photo-editor» está en «edicion-de-fotos» y en «gestion-de-fotos»',
    ]);
  });

  it('detecta identificadores repetidos entre áreas y subtemas', () => {
    const bruto = datosValidos();
    const primero = bruto.taxonomia.areas[0]?.subtemas[0];
    if (primero) primero.id = 'fotos';
    expect(revisarDatos(cargar(bruto))).toContain(
      'taxonomia.yaml: el identificador «fotos» está repetido',
    );
  });

  it('detecta subtemas que no existen en alternativas, semilla y editorial', () => {
    const bruto = datosValidos();
    const programa = bruto.alternativas.programas[0];
    if (programa) programa.subtemas = ['retoque'];
    const alta = bruto.semilla.altas[0];
    if (alta) alta.subtemas = ['galerias'];
    const editorial = {
      version: 1,
      correcciones: [
        { tipo: 'temas', valor: ['dibujo'], repo: 'o/r', motivo: 'x', fecha: '2026-10-16' },
      ],
    };
    const datos = { ...cargar(bruto), editorial: esquemaEditorial.parse(editorial) };
    expect(revisarDatos(datos)).toEqual([
      'alternativas.yaml: «photoshop» usa el subtema «retoque», que no existe',
      'semilla.yaml: el alta «immich-app/immich» usa el subtema «galerias», que no existe',
      'editorial.yaml: la corrección de «o/r» usa el subtema «dibujo», que no existe',
    ]);
  });

  it('detecta alternativas repetidas aunque cambien las mayúsculas', () => {
    const bruto = datosValidos();
    bruto.alternativas.programas[0]?.alternativas.push('gnome/GIMP');
    expect(revisarDatos(cargar(bruto))).toEqual([
      'alternativas.yaml: «photoshop» repite la alternativa «gnome/GIMP»',
    ]);
  });

  it('detecta un repo a la vez en altas y en excluir, y ajustes incoherentes', () => {
    const bruto = datosValidos();
    const semilla = {
      ...bruto.semilla,
      ajustes: { ...bruto.semilla.ajustes, minimo: 4000 },
      excluir: [{ repo: 'Immich-App/Immich', motivo: 'Prueba' }],
    };
    const datos = { ...cargar(bruto), semilla: esquemaSemilla.parse(semilla) };
    expect(revisarDatos(datos)).toEqual([
      'semilla.yaml: hace falta minimo ≤ objetivo ≤ maximo',
      'semilla.yaml: «immich-app/immich» está a la vez en altas y en excluir',
    ]);
  });
});
