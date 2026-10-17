// Datos del día anterior (data/export/proyectos.json, que el robot publica cada noche) para lo que
// no hace falta pedir a GitHub todos los días, porque casi nunca cambia y pedirlo es caro:
// - los topics: el 40 % del tiempo de la consulta diaria;
// - la revisión de las licencias que GitHub no reconoce, que lee archivos de cada repo.
// Cada proyecto los renueva una vez por semana, por turnos, y los nuevos el primer día.

import { readFile } from 'node:fs/promises';
import type { CategoriaLicencia } from '@aop/core';
import { esquemaExportacion } from '@aop/core';
import { RUTA_EXPORTACION } from './exportar.ts';

/** Cada proyecto renueva sus topics y la revisión de su licencia una vez cada estos días. */
export const DIAS_POR_TURNO = 7;

export interface LicenciaAnterior {
  /** Lo que decía GitHub: si cambia, se vuelve a revisar ese mismo día. */
  licenciaGithub: string | null;
  categoria: CategoriaLicencia;
  licencias: string[];
  motivo: string | null;
}

export interface DatosAnteriores {
  /** Día de la exportación anterior; null si no la hay o no se puede leer. */
  fecha: string | null;
  /** Topics por id de GitHub. */
  topics: Map<number, string[]>;
  /** Licencia por id de GitHub. */
  licencias: Map<number, LicenciaAnterior>;
}

/** Lee la exportación anterior. Si no existe o no cumple el formato, se pedirá todo a GitHub. */
export async function leerAnterior(ruta: string = RUTA_EXPORTACION): Promise<DatosAnteriores> {
  try {
    const datos = esquemaExportacion.parse(JSON.parse(await readFile(ruta, 'utf8')));
    return {
      fecha: datos.fecha,
      topics: new Map(datos.proyectos.map((p) => [p.id, p.topics])),
      licencias: new Map(
        datos.proyectos.map((p) => [
          p.id,
          {
            licenciaGithub: p.licencia_github,
            categoria: p.licencia,
            licencias: p.licencias,
            motivo: p.licencia_motivo,
          },
        ]),
      ),
    };
  } catch {
    return { fecha: null, topics: new Map(), licencias: new Map() };
  }
}

/** ¿Le toca renovar sus datos semanales este día? A cada proyecto, uno de cada siete, según su id. */
export function leTocaHoy(id: number, fecha: string): boolean {
  const dia = Math.floor(Date.parse(`${fecha}T00:00:00Z`) / 86_400_000);
  return (id + dia) % DIAS_POR_TURNO === 0;
}

/**
 * Revisión de licencia de ayer que se puede reutilizar hoy: la de un proyecto al que no le toca
 * turno, si GitHub sigue diciendo lo mismo y ayer sí se pudo revisar. Si no, null (se revisa).
 */
export function licenciaReutilizable(
  anterior: LicenciaAnterior | undefined,
  id: number,
  licenciaGithub: string | null,
  fecha: string,
): LicenciaAnterior | null {
  if (!anterior || leTocaHoy(id, fecha)) return null;
  if (anterior.licenciaGithub !== licenciaGithub || anterior.motivo === null) return null;
  // Las correcciones manuales se aplican cada día desde editorial.yaml; no se arrastran.
  if (
    anterior.motivo.startsWith('Corrección manual') ||
    /no se ha podido revisar/i.test(anterior.motivo)
  ) {
    return null;
  }
  return anterior;
}
