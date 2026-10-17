// Lógica pura del robot diario: monta la ficha de cada proyecto con los datos de GitHub, las
// correcciones de data/editorial.yaml, la licencia revisada y la puntuación. Sin red ni archivos.

import {
  type CategoriaLicencia,
  type Correccion,
  calcularEstado,
  calcularPuntuaciones,
  clasificarLicencia,
  type DatosPuntuacion,
  DIAS_MINIMOS_IMPULSO,
  detectarInstaladores,
  type Editorial,
  esquemaProyectoCatalogo,
  type Instaladores,
  type ProyectoCatalogo,
  type Publico,
  SISTEMAS_INSTALABLES,
  sistemasConInstalador,
  type Taxonomia,
} from '@aop/core';
import type { ArchivoVersion, RepoDiario } from './github.ts';
import type { RevisionLicencia } from './licencias.ts';
import { clave, comparar, ultimoCambio } from './seleccion.ts';

/** Como mucho, estos nombres de instalador por sistema (hay versiones con decenas de paquetes). */
export const INSTALADORES_POR_SISTEMA = 10;
const DIA_MS = 86_400_000;

/**
 * Archivos de una versión que no cuentan como descargas: sumas de control, firmas y los manifiestos
 * que consultan los programas ya instalados para buscar actualizaciones (latest.yml, latest.json…).
 */
const NO_ES_DESCARGA =
  /\.(sha\d*|sha\d*sum|md5|sig|asc|pem|crt|sbom|spdx|minisig|blockmap|json|ya?ml|txt)$|\.intoto\.jsonl$|(^|[._-])(checksums?|sha\d*sums?)([._-]|$)/i;

export interface EntradaSemilla {
  repo: string;
  temas: readonly string[];
  origen: readonly string[];
}

/** Foto antigua de un proyecto, para calcular el impulso. */
export interface Referencia {
  fecha: string;
  estrellas: number;
}

export interface DatosCatalogo {
  semilla: readonly EntradaSemilla[];
  /** Datos de GitHub por nombre de la semilla: null si ya no existe; sin entrada si falló. */
  repos: ReadonlyMap<string, RepoDiario | null>;
  /** Licencias revisadas por nombre de la semilla (solo las «otra» y «sin licencia»). */
  licencias: ReadonlyMap<string, RevisionLicencia>;
  /** Foto de referencia por id de GitHub. */
  referencias: ReadonlyMap<number, Referencia>;
  taxonomia: Taxonomia;
  editorial: Editorial;
  ahora: Date;
}

export interface ResultadoCatalogo {
  proyectos: ProyectoCatalogo[];
  /** Repos de la semilla que ya no existen o GitHub tiene bloqueados (se dan de baja). */
  desaparecidos: string[];
  /** Excluidos a mano en data/editorial.yaml. */
  excluidos: string[];
  avisos: string[];
  errores: string[];
}

/** Licencias que el robot debe revisar leyendo los archivos: GitHub dice «otra» o «sin licencia». */
export function licenciasPorRevisar(
  semilla: readonly EntradaSemilla[],
  repos: ReadonlyMap<string, RepoDiario | null>,
  editorial: Editorial,
): { repo: string; categoria: 'otra' | 'sin-licencia' }[] {
  const corregidas = new Set(
    editorial.correcciones.filter((c) => c.tipo === 'licencia').map((c) => clave(c.repo)),
  );
  const pendientes: { repo: string; categoria: 'otra' | 'sin-licencia' }[] = [];
  for (const { repo: nombre } of semilla) {
    const repo = repos.get(nombre);
    if (!repo || corregidas.has(clave(nombre)) || corregidas.has(clave(repo.repo))) continue;
    const categoria = clasificarLicencia(repo.licencia);
    if (categoria === 'otra' || categoria === 'sin-licencia') {
      pendientes.push({ repo: nombre, categoria });
    }
  }
  return pendientes;
}

export function construirCatalogo(datos: DatosCatalogo): ResultadoCatalogo {
  const { taxonomia, ahora } = datos;
  const avisos: string[] = [];
  const errores: string[] = [];
  const desaparecidos: string[] = [];
  const excluidos: string[] = [];

  const subtemas = new Map<string, { area: string; publico: Publico }>();
  for (const area of taxonomia.areas) {
    for (const s of area.subtemas) subtemas.set(s.id, { area: area.id, publico: s.publico });
  }
  const correcciones = new Map<string, Correccion[]>();
  for (const c of datos.editorial.correcciones) {
    const k = clave(c.repo);
    correcciones.set(k, [...(correcciones.get(k) ?? []), c]);
  }

  type Borrador = Omit<ProyectoCatalogo, 'puntuacion' | 'puntuacion_detalle'> & {
    datosPuntuacion: DatosPuntuacion;
  };
  const borradores: Borrador[] = [];
  const vistos = new Map<number, string>();

  for (const entrada of datos.semilla) {
    if (!datos.repos.has(entrada.repo)) continue; // GitHub falló hoy: se queda con los datos de ayer.
    const repo = datos.repos.get(entrada.repo) ?? null;
    if (repo === null) {
      desaparecidos.push(entrada.repo);
      avisos.push(`${entrada.repo} ya no existe en GitHub o no se puede ver: se da de baja`);
      continue;
    }
    const suyas = [
      ...(correcciones.get(clave(entrada.repo)) ?? []),
      ...(clave(repo.repo) === clave(entrada.repo)
        ? []
        : (correcciones.get(clave(repo.repo)) ?? [])),
    ];
    const correccion = <T extends Correccion['tipo']>(tipo: T) =>
      suyas.find((c): c is Extract<Correccion, { tipo: T }> => c.tipo === tipo);

    if (correccion('excluir')) {
      excluidos.push(repo.repo);
      continue;
    }
    if (repo.deshabilitado) {
      desaparecidos.push(entrada.repo);
      avisos.push(`${repo.repo} está deshabilitado en GitHub: se da de baja`);
      continue;
    }
    const anterior = vistos.get(repo.id);
    if (anterior !== undefined) {
      avisos.push(
        `${entrada.repo} y ${anterior} son el mismo repo (${repo.repo}): se cuenta una vez`,
      );
      continue;
    }
    vistos.set(repo.id, entrada.repo);
    if (clave(repo.repo) !== clave(entrada.repo)) {
      avisos.push(`${entrada.repo} ahora se llama ${repo.repo}: actualiza la semilla`);
    }

    const temas = (correccion('temas')?.valor ?? entrada.temas).filter((t) => subtemas.has(t));
    const principal = temas[0] === undefined ? undefined : subtemas.get(temas[0]);
    if (principal === undefined) {
      errores.push(`${repo.repo}: ninguno de sus temas existe en la taxonomía`);
      continue;
    }

    const cambio = ultimoCambio(repo);
    const estado = calcularEstado(
      {
        archivado: repo.archivado,
        ultimoCambio: cambio,
        terminado: correccion('estado')?.valor === 'terminado',
      },
      ahora,
    );
    const licencia = decidirLicencia(
      repo,
      datos.licencias.get(entrada.repo),
      correccion('licencia'),
    );
    const version = leerVersion(repo);
    const instaladores = recortar(
      detectarInstaladores((repo.version?.archivos ?? []).map((a) => a.nombre)),
    );
    const estrellasPorDia = impulso(repo, datos.referencias.get(repo.id), ahora);
    const oficial = correccion('oficial')?.valor;

    borradores.push({
      id: repo.id,
      repo: repo.repo,
      descripcion: repo.descripcion,
      web: repo.web,
      lenguaje: repo.lenguaje,
      topics: repo.topics,
      temas,
      area: principal.area,
      publico: correccion('publico')?.valor ?? principal.publico,
      estrellas: repo.estrellas,
      forks: repo.forks,
      issues_abiertas: repo.issuesAbiertas,
      issues_cerradas: repo.issuesCerradas,
      creado: repo.creado,
      ultimo_push: repo.ultimoPush,
      ultimo_cambio: cambio,
      archivado: repo.archivado,
      estado,
      licencia_github: repo.licencia,
      licencia: licencia.categoria,
      licencias: licencia.licencias,
      licencia_motivo: licencia.motivo,
      organizacion_verificada: repo.organizacionVerificada,
      oficial: oficial ?? null,
      version,
      instaladores,
      sistemas: sistemasConInstalador(instaladores),
      estrellas_por_dia: estrellasPorDia,
      origen: [...entrada.origen],
      datosPuntuacion: {
        clave: String(repo.id),
        temas,
        area: principal.area,
        estado,
        archivado: repo.archivado,
        sinLicencia: licencia.categoria === 'sin-licencia',
        estrellas: repo.estrellas,
        forks: repo.forks,
        estrellasPorDia,
        diasSinCambios: Math.max(0, (ahora.getTime() - Date.parse(cambio)) / DIA_MS),
        diasDesdeVersion:
          version === null
            ? null
            : Math.max(0, (ahora.getTime() - Date.parse(version.fecha)) / DIA_MS),
        issuesAbiertas: repo.issuesAbiertas,
        issuesCerradas: repo.issuesCerradas,
        descargasPorDia:
          version === null || !tieneDescargas(repo.version?.archivos ?? [])
            ? null
            : version.descargas /
              Math.max(1, (ahora.getTime() - Date.parse(version.fecha)) / DIA_MS),
      },
    });
  }

  const puntuaciones = calcularPuntuaciones(borradores.map((b) => b.datosPuntuacion));
  const proyectos: ProyectoCatalogo[] = [];
  for (const { datosPuntuacion, ...resto } of borradores) {
    const p = puntuaciones.get(datosPuntuacion.clave);
    if (!p) throw new Error(`Falta la puntuación de ${resto.repo}`);
    const proyecto: ProyectoCatalogo = {
      ...resto,
      puntuacion: p.total,
      puntuacion_detalle: {
        popularidad: p.popularidad,
        impulso: p.impulso,
        salud: p.salud,
        uso: p.uso,
        penalizaciones: p.penalizaciones,
        grupo: p.grupo,
      },
    };
    const validado = esquemaProyectoCatalogo.safeParse(proyecto);
    if (!validado.success) {
      errores.push(
        `${resto.repo}: la ficha no cumple el formato (${validado.error.issues[0]?.message})`,
      );
      continue;
    }
    proyectos.push(proyecto);
  }
  proyectos.sort((a, b) => comparar(clave(a.repo), clave(b.repo)));
  return { proyectos, desaparecidos, excluidos, avisos, errores };
}

function decidirLicencia(
  repo: RepoDiario,
  revision: RevisionLicencia | undefined,
  correccion: Extract<Correccion, { tipo: 'licencia' }> | undefined,
): { categoria: CategoriaLicencia; licencias: string[]; motivo: string | null } {
  if (correccion) {
    return {
      categoria: correccion.valor,
      licencias: repo.licencia && repo.licencia !== 'NOASSERTION' ? [repo.licencia] : [],
      motivo: `Corrección manual (${correccion.fecha}): ${correccion.motivo}`,
    };
  }
  const segunGithub = clasificarLicencia(repo.licencia);
  if (segunGithub === 'open-source' || segunGithub === 'con-limites') {
    return {
      categoria: segunGithub,
      licencias: repo.licencia ? [repo.licencia] : [],
      motivo: null,
    };
  }
  if (revision) return { ...revision };
  // Sin revisar, «sin licencia» no se publica: podría tenerla en otra carpeta.
  return {
    categoria: 'otra',
    licencias: [],
    motivo: 'Hoy no se ha podido revisar la licencia. Hay que revisarla a mano.',
  };
}

function leerVersion(repo: RepoDiario): ProyectoCatalogo['version'] {
  const version = repo.version;
  if (!version || version.fecha === null) return null;
  const descargas = version.archivos
    .filter((a) => !NO_ES_DESCARGA.test(a.nombre))
    .reduce((total, a) => total + a.descargas, 0);
  return { nombre: version.nombre, fecha: version.fecha, descargas };
}

/** Hay algo que descargar además de sumas de control y manifiestos. */
function tieneDescargas(archivos: readonly ArchivoVersion[]): boolean {
  return archivos.some((a) => !NO_ES_DESCARGA.test(a.nombre));
}

function recortar(instaladores: Instaladores): Instaladores {
  const resultado = { ...instaladores };
  for (const sistema of SISTEMAS_INSTALABLES) {
    resultado[sistema] = instaladores[sistema].slice(0, INSTALADORES_POR_SISTEMA);
  }
  return resultado;
}

/** Estrellas ganadas al día desde la foto de referencia, si tiene al menos 7 días. */
function impulso(repo: RepoDiario, referencia: Referencia | undefined, ahora: Date): number | null {
  if (!referencia) return null;
  const hoy = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  const dias = Math.round((hoy - Date.parse(`${referencia.fecha}T00:00:00Z`)) / DIA_MS);
  if (dias < DIAS_MINIMOS_IMPULSO) return null;
  return Math.round(((repo.estrellas - referencia.estrellas) / dias) * 100) / 100;
}
