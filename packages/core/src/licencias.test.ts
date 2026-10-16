import { describe, expect, it } from 'vitest';
import { clasificarLicencia } from './licencias.ts';
import { LICENCIAS_LIBRES } from './licencias-spdx.ts';

describe('clasificarLicencia', () => {
  it.each([
    // Identificadores que devuelve GitHub, incluidos los antiguos sin -only/-or-later.
    ['MIT', 'open-source'],
    ['Apache-2.0', 'open-source'],
    ['GPL-3.0', 'open-source'],
    ['GPL-2.0', 'open-source'],
    ['AGPL-3.0', 'open-source'],
    ['LGPL-2.1', 'open-source'],
    ['MPL-2.0', 'open-source'],
    ['BSD-3-Clause', 'open-source'],
    ['Unlicense', 'open-source'],
    ['curl', 'open-source'],
    // Libres según la FSF aunque la OSI no las haya aprobado.
    ['CC0-1.0', 'open-source'],
    ['WTFPL', 'open-source'],
    // Boost (BSL-1.0) es open source; no confundir con la Business Source License.
    ['BSL-1.0', 'open-source'],
    ['BUSL-1.1', 'con-limites'],
    ['SSPL-1.0', 'con-limites'],
    ['Elastic-2.0', 'con-limites'],
    ['PolyForm-Noncommercial-1.0.0', 'con-limites'],
    ['FSL-1.1-MIT', 'con-limites'],
    ['SUL-1.0', 'con-limites'],
    ['CC-BY-NC-4.0', 'con-limites'],
    ['CC-BY-NC-SA-4.0', 'con-limites'],
    ['CC-BY-ND-4.0', 'con-limites'],
    ['JSON', 'con-limites'],
    // GitHub ve una licencia, pero no sabe cuál: hay que revisarla a mano.
    ['NOASSERTION', 'otra'],
    ['LicenseRef-propia', 'otra'],
    ['Beerware', 'otra'],
  ] as const)('%s → %s', (spdx, esperado) => {
    expect(clasificarLicencia(spdx)).toBe(esperado);
  });

  it('no distingue mayúsculas ni espacios', () => {
    expect(clasificarLicencia(' mit ')).toBe('open-source');
    expect(clasificarLicencia('busl-1.1')).toBe('con-limites');
  });

  it.each([null, undefined, '', '   '])('sin identificador (%s) → sin licencia', (spdx) => {
    expect(clasificarLicencia(spdx)).toBe('sin-licencia');
  });

  it('ninguna licencia libre de SPDX cae en la lista de límites', () => {
    const conLimites = [...LICENCIAS_LIBRES].filter(
      (id) => clasificarLicencia(id) !== 'open-source',
    );
    expect(conLimites).toEqual([]);
  });
});
