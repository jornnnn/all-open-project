import { SISTEMAS_INSTALABLES, type SistemaInstalable } from './tipos.ts';

/** Extensiones de archivo que se instalan o se ejecutan directamente en cada sistema. */
const EXTENSIONES: ReadonlyArray<readonly [extension: string, sistema: SistemaInstalable]> = [
  ['.exe', 'windows'],
  ['.msi', 'windows'],
  ['.msix', 'windows'],
  ['.msixbundle', 'windows'],
  ['.appx', 'windows'],
  ['.appxbundle', 'windows'],
  ['.dmg', 'mac'],
  ['.pkg', 'mac'],
  ['.appimage', 'linux'],
  ['.deb', 'linux'],
  ['.rpm', 'linux'],
  ['.flatpak', 'linux'],
  ['.pkg.tar.zst', 'linux'],
  ['.pkg.tar.xz', 'linux'],
  ['.apk', 'android'],
];

/** Paquetes de depuración o símbolos: no son para instalar. */
const NO_INSTALABLE = /debuginfo|debugsource|dbgsym|[._-](debug|dbg|symbols?)[._-]/;

/** Los `.apk` de Alpine Linux llevan el sistema en el nombre (`tool_1.0_linux_amd64.apk`). */
const APK_DE_LINUX = /linux|alpine|musl/;

/** Archivos instalables encontrados para cada sistema. */
export type Instaladores = Record<SistemaInstalable, string[]>;

/**
 * Agrupa por sistema los archivos de una versión (release) que se pueden instalar.
 * Acepta nombres, rutas o URLs; la comparación de extensiones no distingue mayúsculas.
 */
export function detectarInstaladores(archivos: readonly string[]): Instaladores {
  const resultado: Instaladores = { windows: [], mac: [], linux: [], android: [] };
  for (const archivo of archivos) {
    const nombre = archivo.split(/[/\\]/).pop()?.split('?')[0] ?? '';
    const minusculas = nombre.toLowerCase();
    if (minusculas === '' || NO_INSTALABLE.test(minusculas)) continue;

    const coincidencia = EXTENSIONES.find(([extension]) => minusculas.endsWith(extension));
    if (!coincidencia) continue;

    const [extension, sistema] = coincidencia;
    const destino = extension === '.apk' && APK_DE_LINUX.test(minusculas) ? 'linux' : sistema;
    resultado[destino].push(nombre);
  }
  return resultado;
}

/** Sistemas con al menos un instalador, en orden fijo. */
export function sistemasConInstalador(instaladores: Instaladores): SistemaInstalable[] {
  return SISTEMAS_INSTALABLES.filter((sistema) => instaladores[sistema].length > 0);
}
