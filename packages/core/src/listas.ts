// Las listas, los cursos y los libros irán más adelante al tipo «para aprender».
// Mientras tanto se apartan del catálogo de programas.

export interface DatosLista {
  /** Nombre del repositorio, sin el propietario. */
  nombre: string;
  descripcion: string | null;
  topics: readonly string[];
  /** Lenguaje principal según GitHub; es null si el repo no tiene código. */
  lenguaje: string | null;
}

export type MotivoLista = 'sin-codigo' | 'topic' | 'nombre' | 'descripcion';

// «awesome» a secas no cuenta: algunos programas lo usan de adorno (Grist, RuView…).
const TOPICS_DE_LISTA = new Set([
  'awesome-list',
  'awesome-lists',
  'list',
  'lists',
  'resources',
  'learning-resources',
  'free-resources',
  'tutorial',
  'tutorials',
  'course',
  'courses',
  'interview',
  'interview-questions',
  'interview-preparation',
  'coding-interview',
  'coding-interviews',
  'cheatsheet',
  'cheatsheets',
  'cheat-sheet',
  'roadmaps',
  'learning-path',
  'curriculum',
  'leetcode',
  'leetcode-solutions',
]);

/** Proyectos que no llevan código y aun así lo son: iconos, fuentes y skills para agentes. */
const TOPICS_SIN_CODIGO_VALIDOS = new Set([
  'icons',
  'icon-pack',
  'icon-set',
  'svg-icons',
  'icon-font',
  'fonts',
  'font',
  'typeface',
  'agent-skills',
  'claude-skills',
]);

// «awesome» solo como prefijo: «Font-Awesome», «line-awesome» o el gestor de ventanas «awesome» son
// programas. Los cursos y las guías se reconocen por su nombre: «ML-For-Beginners»,
// «LLMs-from-scratch», «30-Days-Of-Python», «Python-100-Days», «developer-roadmap»,
// «openai-cookbook», «YubiKey-Guide»…
const NOMBRE_DE_LISTA =
  /^awesome[-_.]|(?:^|[-_.])(?:for-beginners|from-scratch|tutorials?|courses?|bootcamp|zoomcamp|handbook|guide|roadmaps?|cookbooks?|101|\d+[-_]?days?)(?:$|[-_.])|\d+[-_]?days?[-_]?of/i;
const DESCRIPCION_DE_LISTA =
  /\b(?:curated list|awesome list|list of awesome|style guide|best practices list|interview questions)\b|\b\d+\s+lessons\b|\b\d+[- ]weeks?\b/i;

/** Devuelve por qué un repositorio parece una lista o un curso, o null si parece un programa. */
export function detectarListaOCurso(datos: DatosLista): MotivoLista | null {
  const topics = datos.topics.map((topic) => topic.toLowerCase());
  if (datos.lenguaje === null && !topics.some((t) => TOPICS_SIN_CODIGO_VALIDOS.has(t))) {
    return 'sin-codigo';
  }
  if (topics.some((topic) => TOPICS_DE_LISTA.has(topic))) return 'topic';
  if (NOMBRE_DE_LISTA.test(datos.nombre)) return 'nombre';
  if (datos.descripcion !== null && DESCRIPCION_DE_LISTA.test(datos.descripcion)) {
    return 'descripcion';
  }
  return null;
}
