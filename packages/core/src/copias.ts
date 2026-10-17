// Posibles copias falsas de los proyectos más populares. Ninguna alerta se publica sin que una
// persona la revise: aquí solo se decide qué va a la cola de revisión y con qué pruebas.
// La explicación pública está en docs/metodologia.md: si cambias algo aquí, cámbialo también allí.
//
// Va a revisión el repo que cumple todo esto (01-PRODUCTO.md §7 y 03-PLAN-TECNICO.md §3.3):
// - nombre parecido al de uno de los 500 proyectos más populares del catálogo;
// - creado hace poco y con pocos cambios;
// - estrellas que suben de golpe, o descargas que el original no ofrece.

import { detectarInstaladores } from './instaladores.ts';
import { SISTEMAS_INSTALABLES, type SistemaInstalable } from './tipos.ts';

export const COPIAS = {
  /** Se vigilan las copias de los proyectos más populares del catálogo. */
  originales: 500,
  /** «Reciente»: creado hace como mucho estos días. */
  diasReciente: 90,
  /** «Pocos cambios»: su rama principal no pasa de estos commits. */
  maximoCommits: 30,
  /** «Estrellas de golpe»: al menos estas en 24 h… */
  golpe24h: 50,
  /** …o, desde que se creó, esta media al día, con un mínimo de estrellas. */
  golpeMediaDiaria: 20,
  golpeMinimo: 100,
  /** Para no llenar la cola de repos que nadie ve: al menos estas estrellas… */
  minimoEstrellas: 20,
  /** …o estas descargas de lo que el original no ofrece. */
  minimoDescargas: 100,
} as const;

const DIA_MS = 86_400_000;

/** Nombre sin mayúsculas ni separadores: «Claude-Code» y «claude_code» son lo mismo. */
export function normalizarNombre(nombre: string): string {
  return nombre.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Nombres que no identifican a ningún proyecto: miles de repos se llaman así, y los que se llaman
 * como un lenguaje o una plataforma suelen ser apuntes o ejemplos, no copias (medido el 17-oct-2026:
 * «justxor/Linux-» era una chuleta de comandos y «flybrainlabs/node», otro proyecto). No sirven para
 * buscar copias por el nombre.
 */
const GENERICOS = new Set(
  (
    'core docs app api cli web sdk lib src server client skills tools utils website site frontend ' +
    'backend android desktop mobile plugin plugins extension scripts config dotfiles examples demo ' +
    'template starter data models agent agents node linux python java rust react vue git docker ' +
    'kubernetes typescript javascript golang swift kotlin php ruby flutter deno'
  ).split(' '),
);

/**
 * Lo que suelen añadir las copias al nombre del original para atraer descargas: el sistema, «gratis»,
 * «crack», «instalador», «oficial», una versión… («REA-Desktop», «FreeClaudeCode», «ollama-win64»).
 */
const ANADIDOS = [
  'desktop',
  'app',
  'apps',
  'pro',
  'premium',
  'plus',
  'free',
  'gratis',
  'crack',
  'cracked',
  'full',
  'unlocked',
  'mod',
  'hack',
  'cheat',
  'windows',
  'win',
  'win32',
  'win64',
  'x64',
  'x86',
  'mac',
  'macos',
  'osx',
  'linux',
  'android',
  'apk',
  'ios',
  'iphone',
  'download',
  'downloader',
  'installer',
  'install',
  'setup',
  'portable',
  'official',
  'oficial',
  'latest',
  'new',
  'v2',
  'v3',
  '2',
  '3',
  'gui',
  'client',
  'cn',
  'zh',
  'launcher',
  'loader',
  'exe',
].sort((a, b) => b.length - a.length);

export type Parecido =
  | { tipo: 'igual' }
  | { tipo: 'con-anadido'; anadidos: string[] }
  | { tipo: 'casi-igual'; distancia: number };

/** Formas de quitar hasta dos añadidos, por delante o por detrás, a un nombre normalizado. */
function sinAnadidos(nombre: string): Map<string, string[]> {
  const resultado = new Map<string, string[]>();
  const quitar = (resto: string, quitados: string[]) => {
    if (quitados.length > 0 && !resultado.has(resto)) resultado.set(resto, quitados);
    if (quitados.length === 2) return;
    for (const a of ANADIDOS) {
      if (resto.length > a.length && resto.startsWith(a))
        quitar(resto.slice(a.length), [...quitados, a]);
      if (resto.length > a.length && resto.endsWith(a))
        quitar(resto.slice(0, -a.length), [...quitados, a]);
    }
  };
  quitar(nombre, []);
  return resultado;
}

/** Distancia de edición (con transposiciones) entre dos nombres cortos. */
export function distanciaDeEdicion(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const coste = a[i - 1] === b[j - 1] ? 0 : 1;
      const fila = d[i] as number[];
      const anterior = d[i - 1] as number[];
      let valor = Math.min(
        (anterior[j] as number) + 1,
        (fila[j - 1] as number) + 1,
        (anterior[j - 1] as number) + coste,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        valor = Math.min(valor, ((d[i - 2] as number[])[j - 2] as number) + 1);
      }
      fila[j] = valor;
    }
  }
  return (d[a.length] as number[])[b.length] as number;
}

/**
 * ¿Se llama el sospechoso casi como el original? Compara solo el nombre del repo (sin el dueño):
 * - igual: «otro/ollama» frente a «ollama/ollama»;
 * - con un añadido típico de las copias: «rea-desktop», «FreeClaudeCode», «ollama-win64»;
 * - casi igual (una letra cambiada, de más o de menos): «olllama», «comfyiu». Solo en nombres de 6
 *   letras o más que empiezan igual, para no confundir palabras cortas.
 * Los nombres de menos de 3 letras y los genéricos («core», «docs»…) no cuentan.
 */
export function parecidoDeNombre(sospechoso: string, original: string): Parecido | null {
  const s = normalizarNombre(sospechoso);
  const o = normalizarNombre(original);
  if (o.length < 3 || GENERICOS.has(o) || s.length === 0) return null;
  if (s === o) return { tipo: 'igual' };
  const anadidos = sinAnadidos(s).get(o);
  if (anadidos) return { tipo: 'con-anadido', anadidos };
  if (o.length >= 6 && s[0] === o[0] && Math.abs(s.length - o.length) <= 2) {
    const distancia = distanciaDeEdicion(s, o);
    if (distancia === 1 || (distancia === 2 && o.length >= 10 && s[1] === o[1])) {
      return { tipo: 'casi-igual', distancia };
    }
  }
  return null;
}

/** Un archivo que se puede descargar: de la última versión o suelto en la raíz del repo. */
export interface ArchivoDescarga {
  nombre: string;
  /** Descargas según GitHub; null si es un archivo suelto del repo (GitHub no las cuenta). */
  descargas: number | null;
}

/** Programas y comprimidos: lo que una copia falsa suele dar para «instalar». */
const EJECUTABLE_O_COMPRIMIDO =
  /\.(zip|7z|rar|tar\.gz|tgz|tar\.xz|tar\.bz2|jar|exe|msi|msix|scr|bat|cmd|vbs|lnk|ps1|iso|dmg|pkg|apk|xapk|ipa|appimage|deb|rpm)$/i;
/** Sumas de control, firmas y manifiestos: no son descargas. */
const NO_ES_DESCARGA =
  /\.(sha\d*|sha\d*sum|md5|sig|asc|pem|crt|sbom|spdx|minisig|blockmap|json|ya?ml|txt|md)$|(^|[._-])(checksums?|sha\d*sums?)([._-]|$)/i;

/** ¿Es un archivo que se descarga para ejecutarlo o descomprimirlo? */
export function esDescargaEjecutable(nombre: string): boolean {
  return EJECUTABLE_O_COMPRIMIDO.test(nombre) && !NO_ES_DESCARGA.test(nombre);
}

export interface Sospechoso {
  id: number;
  /** propietario/repo */
  repo: string;
  descripcion: string | null;
  /** Lenguaje principal según GitHub; null si no tiene código (apuntes, listas…). */
  lenguaje: string | null;
  creado: string;
  estrellas: number;
  /** Commits de la rama principal; 0 si el repo no tiene rama. */
  commits: number;
  esFork: boolean;
  /** Estrellas ganadas en 24 h según el radar; null si aún no se ha medido. */
  ganadas24h: number | null;
  /** Horas que abarca esa medida (menos de 24 si el radar lo vigila desde hace poco). */
  horasMedidas: number | null;
  /** Archivos de su última versión y archivos sueltos de la raíz que se pueden descargar. */
  descargas: readonly ArchivoDescarga[];
}

export interface Original {
  id: number;
  repo: string;
  descripcion: string | null;
  estrellas: number;
  /** Sistemas para los que el original tiene instalador en su última versión. */
  sistemas: readonly SistemaInstalable[];
  /** El original publica archivos para descargar en su última versión. */
  tieneDescargas: boolean;
}

/** Pruebas de una posible copia: todo son datos de GitHub, para que una persona decida. */
export interface EvidenciaCopia {
  original: {
    id: number;
    repo: string;
    descripcion: string | null;
    estrellas: number;
    sistemas: SistemaInstalable[];
    tiene_descargas: boolean;
  };
  sospechoso: {
    id: number;
    repo: string;
    descripcion: string | null;
    creado: string;
    dias: number;
    estrellas: number;
    ganadas_24h: number | null;
    horas_medidas: number | null;
    commits: number;
    descargas: ArchivoDescarga[];
  };
  nombre: Parecido;
  senales: {
    reciente: boolean;
    pocos_cambios: boolean;
    estrellas_de_golpe: boolean;
    /** Archivos del sospechoso para sistemas (o de tipos) que el original no ofrece. */
    descargas_que_el_original_no_ofrece: ArchivoDescarga[];
  };
  comprobado: string;
}

/** Archivos del sospechoso que el original no ofrece: instaladores para otro sistema o comprimidos. */
export function descargasQueNoOfrece(
  descargas: readonly ArchivoDescarga[],
  original: Pick<Original, 'sistemas' | 'tieneDescargas'>,
): ArchivoDescarga[] {
  const ofrecidos = new Set(original.sistemas);
  return descargas.filter((archivo) => {
    if (!esDescargaEjecutable(archivo.nombre)) return false;
    const instaladores = detectarInstaladores([archivo.nombre]);
    const sistema = SISTEMAS_INSTALABLES.find((s) => instaladores[s].length > 0);
    return sistema ? !ofrecidos.has(sistema) : !original.tieneDescargas;
  });
}

/**
 * ¿Va a revisión? Hace falta todo: nombre parecido, reciente, pocos cambios y, además, estrellas
 * de golpe o descargas que el original no ofrece. Tampoco van los forks, lo que no tiene código ni
 * descargas (apuntes, listas) ni lo que casi nadie ve (menos de 20 estrellas y de 100 descargas).
 * Devuelve las pruebas aunque no vaya; null si ni siquiera se llama parecido o es el mismo dueño.
 */
export function evaluarCopia(
  sospechoso: Sospechoso,
  original: Original,
  ahora: Date,
): { alerta: boolean; evidencia: EvidenciaCopia } | null {
  const dueno = (repo: string) => repo.split('/')[0]?.toLowerCase();
  if (sospechoso.id === original.id || dueno(sospechoso.repo) === dueno(original.repo)) return null;
  const nombre = parecidoDeNombre(
    sospechoso.repo.split('/')[1] ?? '',
    original.repo.split('/')[1] ?? '',
  );
  if (!nombre) return null;

  const dias = Math.max(0, (ahora.getTime() - Date.parse(sospechoso.creado)) / DIA_MS);
  const reciente = dias <= COPIAS.diasReciente;
  const pocosCambios = sospechoso.commits <= COPIAS.maximoCommits;
  const deGolpe =
    (sospechoso.ganadas24h ?? 0) >= COPIAS.golpe24h ||
    (sospechoso.estrellas >= COPIAS.golpeMinimo &&
      sospechoso.estrellas / Math.max(1, dias) >= COPIAS.golpeMediaDiaria);
  const nuevas = descargasQueNoOfrece(sospechoso.descargas, original);
  const ejecutables = sospechoso.descargas.filter((a) => esDescargaEjecutable(a.nombre));
  const descargasNuevas = nuevas.reduce((total, a) => total + (a.descargas ?? 0), 0);

  const evidencia: EvidenciaCopia = {
    original: {
      id: original.id,
      repo: original.repo,
      descripcion: original.descripcion,
      estrellas: original.estrellas,
      sistemas: [...original.sistemas],
      tiene_descargas: original.tieneDescargas,
    },
    sospechoso: {
      id: sospechoso.id,
      repo: sospechoso.repo,
      descripcion: sospechoso.descripcion,
      creado: sospechoso.creado,
      dias: Math.round(dias * 10) / 10,
      estrellas: sospechoso.estrellas,
      ganadas_24h: sospechoso.ganadas24h,
      horas_medidas: sospechoso.horasMedidas,
      commits: sospechoso.commits,
      descargas: ejecutables.slice(0, 10),
    },
    nombre,
    senales: {
      reciente,
      pocos_cambios: pocosCambios,
      estrellas_de_golpe: deGolpe,
      descargas_que_el_original_no_ofrece: nuevas.slice(0, 10),
    },
    comprobado: ahora.toISOString(),
  };
  // Sin código y sin nada que descargar no es un programa que se haga pasar por otro (son apuntes).
  const esPrograma = sospechoso.lenguaje !== null || ejecutables.length > 0;
  const visible =
    sospechoso.estrellas >= COPIAS.minimoEstrellas || descargasNuevas >= COPIAS.minimoDescargas;
  const alerta =
    !sospechoso.esFork &&
    esPrograma &&
    visible &&
    reciente &&
    pocosCambios &&
    (deGolpe || nuevas.length > 0);
  return { alerta, evidencia };
}

const numero = (n: number) => n.toLocaleString('es-ES');

/** «las últimas 24 horas», «las últimas 3 horas»… según lo que abarque la medida del radar. */
export function horasDeLaMedida(horas: number | null): string {
  if (horas === null || horas >= 23.5) return 'las últimas 24 horas';
  const redondeo = Math.max(1, Math.round(horas));
  return redondeo === 1 ? 'la última hora' : `las últimas ${redondeo} horas`;
}

/** Por qué ha saltado, en frases cortas para quien revisa. */
export function motivosDeCopia(e: EvidenciaCopia): string[] {
  const s = e.sospechoso;
  const nombreS = s.repo.split('/')[1] ?? s.repo;
  const nombreO = e.original.repo.split('/')[1] ?? e.original.repo;
  const motivos: string[] = [];
  if (e.nombre.tipo === 'igual') motivos.push(`Se llama igual que ${e.original.repo}.`);
  if (e.nombre.tipo === 'con-anadido') {
    motivos.push(
      `Se llama como ${e.original.repo} con un añadido típico de las copias: «${nombreS}» = «${nombreO}» + «${e.nombre.anadidos.join('» + «')}».`,
    );
  }
  if (e.nombre.tipo === 'casi-igual') {
    motivos.push(`Se llama casi igual que ${e.original.repo}: «${nombreS}» frente a «${nombreO}».`);
  }
  if (e.senales.reciente) {
    const dias = Math.floor(s.dias);
    motivos.push(`Es nuevo: se creó hace ${dias === 1 ? '1 día' : `${numero(dias)} días`}.`);
  }
  if (e.senales.pocos_cambios) {
    motivos.push(`Tiene muy pocos cambios: ${numero(s.commits)} commits en su rama principal.`);
  }
  if (e.senales.estrellas_de_golpe) {
    motivos.push(
      s.ganadas_24h !== null && s.ganadas_24h >= COPIAS.golpe24h
        ? `Sus estrellas suben de golpe: ${numero(s.ganadas_24h)} en ${horasDeLaMedida(s.horas_medidas)}.`
        : `Sus estrellas suben de golpe: ${numero(s.estrellas)} en ${numero(Math.max(1, Math.round(s.dias)))} días.`,
    );
  }
  const nuevas = e.senales.descargas_que_el_original_no_ofrece;
  if (nuevas.length > 0) {
    const lista = nuevas
      .slice(0, 3)
      .map((a) =>
        a.descargas === null ? a.nombre : `${a.nombre} (${numero(a.descargas)} descargas)`,
      )
      .join(', ');
    motivos.push(
      e.original.tiene_descargas
        ? `Ofrece descargas para un sistema que el original no tiene: ${lista}.`
        : `Ofrece descargas, y el original no ofrece ninguna: ${lista}.`,
    );
  }
  return motivos;
}
