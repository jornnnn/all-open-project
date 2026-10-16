import { describe, expect, it } from 'vitest';
import { type DatosLista, detectarListaOCurso } from './listas.ts';

const programa: DatosLista = {
  nombre: 'immich',
  descripcion: 'High performance self-hosted photo and video management solution.',
  topics: ['photos', 'self-hosted'],
  lenguaje: 'TypeScript',
};

describe('detectarListaOCurso', () => {
  it('un programa normal no es una lista', () => {
    expect(detectarListaOCurso(programa)).toBeNull();
  });

  it('un repo sin código (solo Markdown) es una lista', () => {
    expect(detectarListaOCurso({ ...programa, lenguaje: null })).toBe('sin-codigo');
  });

  it.each([['icons'], ['fonts'], ['agent-skills']])(
    'los iconos, las fuentes y las skills no llevan código y no son listas («%s»)',
    (topic) => {
      expect(detectarListaOCurso({ ...programa, lenguaje: null, topics: [topic] })).toBeNull();
    },
  );

  it.each([['awesome-list'], ['tutorial'], ['interview-questions'], ['Cheatsheet']])(
    'el topic «%s» marca una lista o un curso',
    (topic) => {
      expect(detectarListaOCurso({ ...programa, topics: ['python', topic] })).toBe('topic');
    },
  );

  it('el topic «awesome» a secas no basta: hay programas que lo usan de adorno', () => {
    expect(detectarListaOCurso({ ...programa, topics: ['awesome', 'spreadsheet'] })).toBeNull();
  });

  it.each([
    ['awesome-selfhosted'],
    ['Awesome.Rust'],
    ['awesome_python'],
    ['ML-For-Beginners'],
    ['LLMs-from-scratch'],
    ['30-Days-Of-Python'],
    ['90DaysOfDevOps'],
    ['macOS-Security-and-Privacy-Guide'],
    ['go-tutorial'],
    ['Python-100-Days'],
    ['7days-golang'],
    ['developer-roadmap'],
    ['openai-cookbook'],
  ])('el nombre «%s» marca una lista o un curso', (nombre) => {
    expect(detectarListaOCurso({ ...programa, nombre })).toBe('nombre');
  });

  it.each([
    ['21 Lessons, Get Started Building with Generative AI'],
    ['Data Engineering Zoomcamp is a free 9-week course'],
    ['10 Weeks, 20 Lessons, Data Science for All!'],
    ['JavaScript Style Guide'],
    ['Core Interview Questions & Answers For Experienced Java Developers'],
  ])('la descripción «%s» marca un curso', (descripcion) => {
    expect(detectarListaOCurso({ ...programa, descripcion })).toBe('descripcion');
  });

  it.each([
    ['awesome'],
    ['awesomewm'],
    ['Font-Awesome'],
    ['line-awesome'],
    ['guidellm'],
    ['coursera-dl'],
    ['scratch-gui'],
    ['styleguide'],
    ['roadmapper'],
    ['days-until'],
  ])('el nombre «%s» no basta para ser una lista', (nombre) => {
    expect(detectarListaOCurso({ ...programa, nombre })).toBeNull();
  });

  it('la descripción «curated list» marca una lista', () => {
    expect(
      detectarListaOCurso({ ...programa, descripcion: 'A curated list of amazing tools' }),
    ).toBe('descripcion');
  });

  it('los topics de lectores de libros no cuentan como lista', () => {
    expect(detectarListaOCurso({ ...programa, topics: ['ebook', 'epub', 'books'] })).toBeNull();
  });
});
