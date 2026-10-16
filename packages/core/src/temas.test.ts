import { describe, expect, it } from 'vitest';
import { esquemaTaxonomia } from './datos.ts';
import { asignarTemas } from './temas.ts';

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
          nombre: { es: 'Edición de fotos', en: 'Photo editing' },
          publico: 'usar',
          topics: ['photo-editor', 'image-editor', 'raw-processing'],
        },
        {
          id: 'gestion-de-fotos',
          slug_en: 'photo-management',
          nombre: { es: 'Gestión de fotos', en: 'Photo management' },
          publico: 'usar',
          topics: ['photo-gallery', 'google-photos'],
        },
      ],
    },
    {
      id: 'ia',
      slug_en: 'ai',
      nombre: { es: 'IA', en: 'AI' },
      icono: 'sparkles',
      tono: 305,
      subtemas: [
        {
          id: 'imagenes-con-ia',
          slug_en: 'ai-images',
          nombre: { es: 'Imágenes con IA', en: 'AI images' },
          publico: 'usar',
          topics: ['stable-diffusion', 'image-upscaling'],
        },
      ],
    },
  ],
});

describe('asignarTemas', () => {
  it('asigna el subtema y el área de un topic conocido', () => {
    expect(asignarTemas(['photo-editor', 'rust'], taxonomia)).toEqual([
      { area: 'fotos', subtema: 'edicion-de-fotos', coincidencias: ['photo-editor'] },
    ]);
  });

  it('ordena por número de coincidencias: el primero es el tema principal', () => {
    const temas = asignarTemas(
      ['image-upscaling', 'photo-editor', 'stable-diffusion', 'google-photos'],
      taxonomia,
    );
    expect(temas.map((t) => t.subtema)).toEqual([
      'imagenes-con-ia',
      'edicion-de-fotos',
      'gestion-de-fotos',
    ]);
    expect(temas[0]?.coincidencias).toEqual(['image-upscaling', 'stable-diffusion']);
  });

  it('si empatan, manda el orden de la taxonomía', () => {
    const temas = asignarTemas(['stable-diffusion', 'photo-gallery', 'photo-editor'], taxonomia);
    expect(temas.map((t) => t.subtema)).toEqual([
      'edicion-de-fotos',
      'gestion-de-fotos',
      'imagenes-con-ia',
    ]);
  });

  it('normaliza mayúsculas y espacios y no cuenta dos veces el mismo topic', () => {
    expect(asignarTemas([' Photo-Editor ', 'photo-editor'], taxonomia)).toEqual([
      { area: 'fotos', subtema: 'edicion-de-fotos', coincidencias: ['photo-editor'] },
    ]);
  });

  it('sin topics conocidos no hay temas', () => {
    expect(asignarTemas(['javascript', 'hacktoberfest'], taxonomia)).toEqual([]);
    expect(asignarTemas([], taxonomia)).toEqual([]);
  });
});
