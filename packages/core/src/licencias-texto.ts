// Lee los archivos de licencia cuando GitHub no sabe cuál es (NOASSERTION) y decide su categoría.
//
// La regla es prudente: decir «open source» de algo que tiene límites engaña a quien lo use en su
// empresa, así que solo se dice cuando cada archivo es el texto oficial de una licencia libre y lo
// único que sobra son títulos y nombres. Si sobra cualquier otra frase, o hay mezcla de licencias
// libres y con límites, queda como «otra» para que la revise una persona.

import { LICENCIAS_LIBRES } from './licencias-spdx.ts';
import type { CategoriaLicencia } from './tipos.ts';

/** Texto oficial de una licencia libre, de la lista SPDX (identificador y texto). */
export interface PlantillaLicencia {
  id: string;
  texto: string;
}

export interface ArchivoLicencia {
  /** Ruta dentro del repo (LICENSE, LICENSE-MIT, LICENSES/MIT.txt…). */
  ruta: string;
  texto: string;
}

export interface ResultadoLicencia {
  categoria: Exclude<CategoriaLicencia, 'sin-licencia'>;
  /** Licencias reconocidas: identificadores SPDX o, si no los hay, el nombre de la licencia. */
  licencias: string[];
  /** Por qué, en una frase, para quien revise. */
  motivo: string;
}

/**
 * Familias de licencias libres: una frase que solo está en esa familia abre la comparación con sus
 * plantillas. Así una GPL no se confunde con la SSPL, que copia casi todo su texto.
 */
const FAMILIAS: ReadonlyArray<{ puerta: RegExp; plantillas: readonly string[] }> = [
  {
    puerta: /permission is hereby granted free of charge to any person obtaining a copy/,
    plantillas: ['MIT', 'MIT-0', 'X11'],
  },
  {
    puerta:
      /redistribution and use in source and binary forms with or without modification are permitted/,
    plantillas: ['BSD-2-Clause', 'BSD-3-Clause', 'BSD-4-Clause'],
  },
  {
    puerta: /permission to use copy modify and (or )?distribute this software for any purpose/,
    plantillas: ['ISC', '0BSD', 'curl'],
  },
  {
    puerta: /without fee and without a written agreement is hereby granted/,
    plantillas: ['PostgreSQL'],
  },
  { puerta: /apache license version 2 0/, plantillas: ['Apache-2.0'] },
  { puerta: /gnu general public license/, plantillas: ['GPL-2.0-only', 'GPL-3.0-only'] },
  {
    puerta: /gnu (lesser|library) general public license/,
    plantillas: ['LGPL-2.0-only', 'LGPL-2.1-only', 'LGPL-3.0-only'],
  },
  { puerta: /gnu affero general public license/, plantillas: ['AGPL-3.0-only'] },
  { puerta: /mozilla public license/, plantillas: ['MPL-2.0'] },
  { puerta: /eclipse public license/, plantillas: ['EPL-1.0', 'EPL-2.0'] },
  { puerta: /altered source versions must be plainly marked/, plantillas: ['Zlib'] },
  {
    puerta: /free and unencumbered software released into the public domain/,
    plantillas: ['Unlicense'],
  },
  { puerta: /cc0 1 0 universal|creative commons cc0/, plantillas: ['CC0-1.0'] },
  { puerta: /attribution 4 0 international/, plantillas: ['CC-BY-4.0'] },
  { puerta: /attribution sharealike 4 0 international/, plantillas: ['CC-BY-SA-4.0'] },
  { puerta: /boost software license/, plantillas: ['BSL-1.0'] },
  { puerta: /sil open font license/, plantillas: ['OFL-1.1'] },
  { puerta: /artistic license 2 0/, plantillas: ['Artistic-2.0'] },
  { puerta: /european union public license/, plantillas: ['EUPL-1.2'] },
  { puerta: /do what the fuck you want to public license/, plantillas: ['WTFPL'] },
  { puerta: /python software foundation license/, plantillas: ['Python-2.0'] },
  {
    puerta: /vim license|no restrictions on distributing unmodified copies of vim/,
    plantillas: ['Vim'],
  },
  { puerta: /microsoft public license/, plantillas: ['MS-PL'] },
  { puerta: /common development and distribution license/, plantillas: ['CDDL-1.0'] },
  { puerta: /unicode license v3|unicode inc license agreement/, plantillas: ['Unicode-3.0'] },
  { puerta: /university of illinois ncsa open source license/, plantillas: ['NCSA'] },
  { puerta: /blue oak model license/, plantillas: ['BlueOak-1.0.0'] },
  { puerta: /universal permissive license/, plantillas: ['UPL-1.0'] },
  { puerta: /mulan permissive software license/, plantillas: ['MulanPSL-2.0'] },
  { puerta: /educational community license/, plantillas: ['ECL-2.0'] },
  { puerta: /open software license/, plantillas: ['OSL-3.0'] },
  { puerta: /academic free license/, plantillas: ['AFL-3.0'] },
  { puerta: /freetype project license/, plantillas: ['FTL'] },
  { puerta: /independent jpeg group/, plantillas: ['IJG'] },
  { puerta: /openssl license/, plantillas: ['OpenSSL'] },
];

/** Plantillas que necesita el clasificador; el robot las guarda en jobs/licencias/. */
export const PLANTILLAS_NECESARIAS: readonly string[] = [
  ...new Set(FAMILIAS.flatMap((f) => f.plantillas)),
];

/** Licencias con límites, por su nombre. Basta con que aparezca para que no sea open source. */
const NOMBRES_CON_LIMITES: ReadonlyArray<readonly [RegExp, string]> = [
  [/business source license/, 'Business Source License'],
  [/server side public license/, 'Server Side Public License'],
  [/elastic license/, 'Elastic License'],
  [/sustainable use license/, 'Sustainable Use License'],
  [/polyform/, 'PolyForm'],
  [/functional source license/, 'Functional Source License'],
  [/commons clause/, 'Commons Clause'],
  [/source available license/, 'Source Available License'],
  [/confluent community license/, 'Confluent Community License'],
  [/fair core license|fair source license/, 'Fair Source'],
  [/o saasy license/, "O'Saasy License"],
  [/anti capitalist software license/, 'Anti-Capitalist Software License'],
  [/hippocratic license/, 'Hippocratic License'],
  [/prosperity public license/, 'Prosperity Public License'],
  [/shall be used for good not evil/, 'JSON License'],
  [
    /attribution noncommercial|noncommercial sharealike|cc by nc\b/,
    'Creative Commons NonCommercial',
  ],
  [
    /attribution noderivatives|noncommercial noderivatives|cc by nd\b/,
    'Creative Commons NoDerivatives',
  ],
  [/end user license agreement/, 'EULA'],
  [/community license agreement/, 'licencia comunitaria'],
  [/openrail|responsible ai license/, 'OpenRAIL'],
];

/**
 * Textos de licencias con límites que llevan dentro una libre: la BUSL («Change License») y la FSL
 * («Future License») nombran la licencia libre a la que pasarán en el futuro, y la Commons Clause
 * («License Condition») se añade encima de una libre para restringirla. En esos archivos, lo libre
 * de dentro no cuenta. Solo nombrarlas («los módulos de pago van con BSL») no basta.
 */
const LIMITES_QUE_CONTIENEN_LIBRES =
  /change license|future license|commons clause license condition/;

/** Nombra una licencia libre aunque no traiga su texto («licensed under the AGPL…»). */
const MENCION_LIBRE =
  /\b(mit license|the mit|apache license|apache 2 0|apache v2|gnu (affero |lesser |library )?general public license|gpl ?v?[123]|agpl ?v?3|lgpl ?v?[23]|gpl|agpl|lgpl|bsd license|bsd [234] clause|mozilla public license|mpl 2 0|isc license|eclipse public license|unlicense|cc0)\b/;

/** Palabras que pueden sobrar sin cambiar nada: títulos, nombres de licencias y unión. */
const PEGAMENTO = new Set(
  `a an the of and or to in under by with as is are be this that these its it for at on all any
  see also either dual dually option options choice choose your you may can
  license licenses licensed licensing version versions v terms text full copy file files spdx
  identifier identifiers expression software source code program project repository work content
  mit expat x11 apache asl gnu gpl lgpl agpl gplv2 gplv3 lgplv2 lgplv3 agplv3 general public lesser
  library affero mozilla mpl isc zlib libpng bsd new simplified revised zero clause unlicense cc0
  creative commons attribution sharealike international universal eclipse epl boost artistic
  python psf sil open font ofl unicode wtfpl european union eupl microsoft cddl common development
  distribution ncsa university illinois blue oak model permissive mulan psl educational community
  academic free freetype independent jpeg group openssl postgresql vim only later authors
  contributors consortium`.split(/\s+/),
);

/** Máximo de palabras de pegamento que puede sobrar en un archivo. */
const MAXIMO_SOBRANTE = 40;
/** Un archivo sin plantilla reconocida solo vale como «puntero» si es así de corto. */
const MAXIMO_PUNTERO = 60;
/** Parte de la plantilla (sin los apéndices) que debe estar en el archivo. */
const COBERTURA_MINIMA = 0.9;

/** Apéndices de las plantillas que muchos archivos no copian: no cuentan para reconocerlas. */
const INICIO_DE_APENDICE =
  /how to apply these terms to your new programs|appendix how to apply the apache license|exhibit a source code form license notice/;

type Bolsa = Map<string, number>;

interface Plantilla {
  id: string;
  /** Palabras del texto sin apéndices: deben estar casi todas. */
  nucleo: Bolsa;
  /** Palabras del texto completo: se quitan del archivo al reconocerla. */
  completa: Bolsa;
  /** Texto plano completo, para no confundir sus frases con otras licencias. */
  plano: string;
}

export interface PlantillasPreparadas {
  porId: ReadonlyMap<string, Plantilla>;
}

/** Prepara las plantillas una vez. Falla si alguna no es libre según la lista SPDX. */
export function prepararPlantillas(plantillas: readonly PlantillaLicencia[]): PlantillasPreparadas {
  const porId = new Map<string, Plantilla>();
  for (const { id, texto } of plantillas) {
    if (!LICENCIAS_LIBRES.has(id.toLowerCase())) {
      throw new Error(`La plantilla ${id} no es una licencia libre según la lista SPDX`);
    }
    const palabras = palabrasDeLicencia(texto);
    const corte = posicionDeApendice(palabras);
    porId.set(id, {
      id,
      nucleo: bolsa(palabras.slice(0, corte)),
      completa: bolsa(palabras),
      plano: textoPlano(texto),
    });
  }
  return { porId };
}

/**
 * ¿Es un archivo de licencia? Por su nombre (sin la carpeta):
 * - LICENSE, LICENCE, UNLICENSE, COPYING y sus variantes: LICENSE-MIT, LICENSE.txt, COPYING.LIB,
 *   LICENSE_BSD_Simple.txt…;
 * - o el nombre de la licencia: gpl-3.0.txt, MIT-LICENSE, EULA.txt…
 * Quedan fuera NOTICE y COPYRIGHT, que acompañan a la licencia pero no la conceden, y los que solo
 * se llaman parecido: acuerdos de contribución, guías («license-install.md»), código o imágenes.
 */
export function esArchivoDeLicencia(nombre: string): boolean {
  const n = nombre.toLowerCase();
  const porNombre = /^((un)?licen[cs]es?|copying)([-_.][a-z0-9+]*)*$/.test(n);
  const porLicencia =
    /^((a|l)?gpl|mit|apache|bsd|mpl|epl|isc|eula|cc0|unlicense)([-_.]?(v?\d[\d.]*|licen[cs]e))*(\.(txt|md|markdown|rst|adoc|html?))?$/.test(
      n,
    );
  if (!porNombre && !porLicencia) return false;
  if (
    /\.(js|mjs|cjs|ts|py|rb|go|rs|json|ya?ml|toml|xml|sh|pdf|png|jpe?g|gif|svg|c|cc|cpp|h|hpp|java|kt|swift|cs|php|lock|ipynb|uu)$/.test(
      n,
    )
  ) {
    return false;
  }
  return !/agreement|faq|header|check|cache|changelog|third|thanks|other|summary|policy|install|info/.test(
    n,
  );
}

/** Carpetas de código de otros (dependencias, fuentes tipográficas…): sus licencias no son las del proyecto. */
export function esRutaDeTerceros(ruta: string): boolean {
  return /(^|\/)(node_modules|bower_components|vendors?|third[-_]?party|3rd[-_]?party|externals?|extern|deps|dependencies|contrib|fonts?|submodules?)(\/|$)/i.test(
    ruta,
  );
}

type Tipo = 'libre' | 'puntero' | 'limites' | 'mixto' | 'desconocido';

interface Analisis {
  ruta: string;
  tipo: Tipo;
  libres: string[];
  limites: string[];
  /** Nombra una licencia libre, traiga o no su texto. */
  nombraLibre: boolean;
  sobrantes: string[];
}

/**
 * Decide la categoría de un repo a partir de sus archivos de licencia:
 * - open-source: cada archivo es una licencia libre reconocida (o un puntero corto) y no hay nada más;
 * - con-limites: aparece una licencia con límites y ninguna libre;
 * - otra: lo demás (mezcla, texto añadido o desconocido), para revisarlo a mano.
 */
export function clasificarTextosDeLicencia(
  archivos: readonly ArchivoLicencia[],
  plantillas: PlantillasPreparadas,
  repo: string,
): ResultadoLicencia {
  if (archivos.length === 0) {
    return { categoria: 'otra', licencias: [], motivo: 'No hay archivos de licencia que leer.' };
  }
  const propias = new Set(repo.toLowerCase().split(/[^a-z0-9]+/));
  const analisis = archivos.map((a) => analizarArchivo(a, plantillas, propias));
  const tipos = new Set(analisis.map((a) => a.tipo));
  const libres = unicos(analisis.flatMap((a) => (a.tipo === 'limites' ? [] : a.libres)));
  const limites = unicos(analisis.flatMap((a) => a.limites));
  const lista = (tipo: Tipo) =>
    analisis
      .filter((a) => a.tipo === tipo)
      .map((a) => a.ruta)
      .join(', ');

  if (tipos.has('mixto')) {
    return {
      categoria: 'otra',
      licencias: unicos([...libres, ...limites]),
      motivo: `Mezcla licencias libres y con límites (${[...limites, ...libres].join(', ')}) en ${lista('mixto')}. Hay que revisarla a mano.`,
    };
  }
  if (tipos.has('limites')) {
    const conLibres = analisis.filter((a) => a.tipo !== 'limites' && a.nombraLibre);
    if (conLibres.length > 0) {
      return {
        categoria: 'otra',
        licencias: unicos([...libres, ...limites]),
        motivo: `Hay archivos con licencias libres (${conLibres.map((a) => a.ruta).join(', ')}) y con límites (${lista('limites')}). Hay que revisarla a mano.`,
      };
    }
    return {
      categoria: 'con-limites',
      licencias: limites,
      motivo: `Licencia con límites: ${limites.join(', ')} (${lista('limites')}).`,
    };
  }
  if (tipos.has('libre') && [...tipos].every((t) => t === 'libre' || t === 'puntero')) {
    return {
      categoria: 'open-source',
      licencias: libres,
      motivo: `Licencias libres reconocidas en ${lista('libre')}: ${libres.join(', ')}.`,
    };
  }
  const dudoso = analisis.find((a) => a.tipo === 'desconocido') ?? analisis[0];
  const detalle =
    dudoso && dudoso.libres.length > 0
      ? `${dudoso.ruta} tiene ${dudoso.libres.join(', ')} con texto añadido («${dudoso.sobrantes.slice(0, 8).join(' ')}…»)`
      : `No reconocemos el texto de ${dudoso?.ruta ?? 'la licencia'}`;
  return { categoria: 'otra', licencias: libres, motivo: `${detalle}. Hay que revisarla a mano.` };
}

function analizarArchivo(
  archivo: ArchivoLicencia,
  plantillas: PlantillasPreparadas,
  propias: ReadonlySet<string>,
): Analisis {
  const plano = textoPlano(archivo.texto);
  const palabras = palabrasDeLicencia(archivo.texto);
  const resto = bolsa(palabras);

  // Plantillas de las familias cuya frase aparece; se quita la que mejor encaja y se repite, porque
  // un archivo puede traer varias licencias (o varias copias de la misma).
  const candidatas = FAMILIAS.filter((f) => f.puerta.test(plano)).flatMap((f) =>
    f.plantillas.flatMap((id) => plantillas.porId.get(id) ?? []),
  );
  // Entre las que encajan, gana la que explica más palabras: una BSD de 3 cláusulas contiene entera
  // la de 2, y la MIT contiene la MIT-0.
  const reconocidas: Plantilla[] = [];
  for (let vuelta = 0; vuelta < 50; vuelta++) {
    let mejor: { plantilla: Plantilla; explicadas: number } | null = null;
    for (const plantilla of candidatas) {
      const { parte, presentes } = cobertura(resto, plantilla.nucleo);
      if (parte >= COBERTURA_MINIMA && (mejor === null || presentes > mejor.explicadas)) {
        mejor = { plantilla, explicadas: presentes };
      }
    }
    if (mejor === null) break;
    reconocidas.push(mejor.plantilla);
    restar(resto, mejor.plantilla.completa);
  }
  const libres = reconocidas.map((p) => p.id);

  const sobrantes = [...resto].flatMap(([palabra, veces]) =>
    PEGAMENTO.has(palabra) || propias.has(palabra) || /^\d+$/.test(palabra)
      ? []
      : Array<string>(veces).fill(palabra),
  );
  const pegamento = [...resto.values()].reduce((a, b) => a + b, 0) - sobrantes.length;
  // Una licencia con límites cuenta si se nombra más veces de las que ya se nombra dentro de las
  // licencias libres reconocidas: la MPL-2.0, por ejemplo, habla de «end user license agreements».
  const limites = NOMBRES_CON_LIMITES.filter(
    ([re]) => veces(re, plano) > reconocidas.reduce((total, p) => total + veces(re, p.plano), 0),
  ).map(([, nombre]) => nombre);
  const unicasLibres = unicos(libres);

  const nombraLibre = unicasLibres.length > 0 || MENCION_LIBRE.test(plano);
  let tipo: Tipo;
  if (limites.length > 0) {
    tipo = LIMITES_QUE_CONTIENEN_LIBRES.test(plano) || !nombraLibre ? 'limites' : 'mixto';
  } else if (unicasLibres.length > 0) {
    tipo = sobrantes.length === 0 && pegamento <= MAXIMO_SOBRANTE ? 'libre' : 'desconocido';
  } else {
    tipo = sobrantes.length === 0 && palabras.length <= MAXIMO_PUNTERO ? 'puntero' : 'desconocido';
  }
  return { ruta: archivo.ruta, tipo, libres: unicasLibres, limites, nombraLibre, sobrantes };
}

const ENTIDADES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
  copy: '©',
  mdash: '-',
  ndash: '-',
};

/** Minúsculas, entidades HTML decodificadas y «licence» escrito como «license». */
function normalizar(texto: string): string {
  return texto
    .replace(/&(#\d+|[a-z]+);/gi, (entidad, nombre: string) =>
      nombre.startsWith('#')
        ? String.fromCodePoint(Number(nombre.slice(1)))
        : (ENTIDADES[nombre.toLowerCase()] ?? entidad),
    )
    .toLowerCase()
    .replace(/licenc(e|ed|es|ing)\b/g, 'licens$1');
}

/** Texto en una línea, solo con letras y números, para buscar frases. */
function textoPlano(texto: string): string {
  return normalizar(texto)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Líneas de aviso de copyright: cambian en cada proyecto y no forman parte de la licencia.
 * «Copyright (c) 2020 Ana», «(c) 2020 Ana», «2009-2026 (c) Ana», «Original work Copyright 2019 Ana»
 * y las líneas que siguen a un aviso con otro año y otro nombre («  2012 Luis <luis@…>»). No quita
 * «(c) You must retain…», que es la cláusula 4c de Apache.
 */
const AVISO_DE_COPYRIGHT =
  /^[\s>*#_|`-]*(copyright\b|©|\(c\)\s*(?!you\b)[a-z0-9])|\bcopyright\s*(\(c\)|©|\d{4})|(\(c\)|©)\s*\d{4}|\d{4}\s*(\(c\)|©)|^\s*\d{4}(\s*[-–,]\s*\d{4})*\s+[a-z]|all rights reserved/;

/** Palabras del texto sin los avisos de copyright, las direcciones web ni los correos. */
export function palabrasDeLicencia(texto: string): string[] {
  return normalizar(texto)
    .split(/\r?\n/)
    .filter((linea) => !AVISO_DE_COPYRIGHT.test(linea))
    .join(' ')
    .replace(/(https?:\/\/|www\.)\S+|\S+@\S+/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function posicionDeApendice(palabras: readonly string[]): number {
  const coincidencia = INICIO_DE_APENDICE.exec(palabras.join(' '));
  if (!coincidencia) return palabras.length;
  return coincidencia.input.slice(0, coincidencia.index).split(' ').length - 1;
}

function bolsa(palabras: readonly string[]): Bolsa {
  const resultado: Bolsa = new Map();
  for (const p of palabras) resultado.set(p, (resultado.get(p) ?? 0) + 1);
  return resultado;
}

/** Cuántas palabras de la plantilla están en el archivo (contando repeticiones) y qué parte son. */
function cobertura(archivo: Bolsa, plantilla: Bolsa): { parte: number; presentes: number } {
  let total = 0;
  let presentes = 0;
  for (const [palabra, veces] of plantilla) {
    total += veces;
    presentes += Math.min(veces, archivo.get(palabra) ?? 0);
  }
  return { parte: total === 0 ? 0 : presentes / total, presentes };
}

function restar(archivo: Bolsa, plantilla: Bolsa): void {
  for (const [palabra, veces] of plantilla) {
    const quedan = (archivo.get(palabra) ?? 0) - veces;
    if (quedan > 0) archivo.set(palabra, quedan);
    else archivo.delete(palabra);
  }
}

const unicos = (lista: readonly string[]) => [...new Set(lista)];

/** Cuántas veces aparece una expresión en un texto. */
function veces(expresion: RegExp, texto: string): number {
  return texto.match(new RegExp(expresion.source, 'g'))?.length ?? 0;
}
