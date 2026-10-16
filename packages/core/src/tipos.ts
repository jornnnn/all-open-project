// Tipos básicos del dominio, compartidos por el robot, el Worker y la web.
// Los valores son códigos estables: la web los traduce a cada idioma.

/** Estado de mantenimiento de un proyecto. */
export const ESTADOS = ['vivo', 'lento', 'abandonado', 'terminado'] as const;
export type Estado = (typeof ESTADOS)[number];

/**
 * Cómo se puede usar el código según su licencia:
 * - `open-source`: licencia aprobada por la OSI o libre según la FSF.
 * - `con-limites`: se ve el código, pero limita el uso comercial, como servicio o los derivados.
 * - `otra`: hay licencia, pero no está identificada; hay que revisarla a mano.
 * - `sin-licencia`: no hay licencia, así que legalmente no se puede reutilizar.
 */
export const CATEGORIAS_LICENCIA = ['open-source', 'con-limites', 'otra', 'sin-licencia'] as const;
export type CategoriaLicencia = (typeof CATEGORIAS_LICENCIA)[number];

/** Sistemas del filtro «Funciona en mi…». */
export const SISTEMAS = [
  'windows',
  'mac',
  'linux',
  'android',
  'iphone',
  'navegador',
  'servidor',
] as const;
export type Sistema = (typeof SISTEMAS)[number];

/** Sistemas para los que se detecta un instalador por la extensión del archivo. */
export const SISTEMAS_INSTALABLES = ['windows', 'mac', 'linux', 'android'] as const;
export type SistemaInstalable = (typeof SISTEMAS_INSTALABLES)[number];

/** Facilidad de instalación: instalador o tienda, Docker o terminal, o solo para programadores. */
export const INSTALACIONES = ['facil', 'con-pasos', 'programadores'] as const;
export type Instalacion = (typeof INSTALACIONES)[number];

/** Público principal: listo para usar o para programadores. */
export const PUBLICOS = ['usar', 'programar'] as const;
export type Publico = (typeof PUBLICOS)[number];
