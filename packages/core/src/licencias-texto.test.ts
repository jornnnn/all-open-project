import { describe, expect, it } from 'vitest';
import { LICENCIAS_LIBRES } from './licencias-spdx.ts';
import {
  clasificarTextosDeLicencia,
  esArchivoDeLicencia,
  esRutaDeTerceros,
  PLANTILLAS_NECESARIAS,
  palabrasDeLicencia,
  prepararPlantillas,
} from './licencias-texto.ts';

// Textos oficiales de SPDX (los cortos); el robot usa todos los de jobs/licencias/.
const MIT = `MIT License

Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;
const MIT_0 = MIT.replace('MIT License', 'MIT No Attribution')
  .replace(', subject to the following conditions:', '.')
  .replace(
    /The above copyright notice and this permission notice shall be included in all copies or\nsubstantial portions of the Software.\n/,
    '',
  );
const ISC = `ISC License

Copyright (c) <year> <copyright holders>

Permission to use, copy, modify, and/or distribute this software for any purpose with or without
fee is hereby granted, provided that the above copyright notice and this permission notice appear
in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS
SOFTWARE.
`;
const BSD_2 = `Copyright (c) <year> <owner>

Redistribution and use in source and binary forms, with or without modification, are permitted
provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions
and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of
conditions and the following disclaimer in the documentation and/or other materials provided with
the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`;
const BSD_3 = BSD_2.replace(
  'the distribution.\n',
  `the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to
endorse or promote products derived from this software without specific prior written permission.
`,
);

const plantillas = prepararPlantillas([
  { id: 'MIT', texto: MIT },
  { id: 'MIT-0', texto: MIT_0 },
  { id: 'ISC', texto: ISC },
  { id: 'BSD-2-Clause', texto: BSD_2 },
  { id: 'BSD-3-Clause', texto: BSD_3 },
]);

const clasificar = (archivos: Record<string, string>, repo = 'ana/visor') =>
  clasificarTextosDeLicencia(
    Object.entries(archivos).map(([ruta, texto]) => ({ ruta, texto })),
    plantillas,
    repo,
  );

/** La MIT tal como suele estar en los repos: otro título y el aviso de copyright relleno. */
const mitDeRepo = MIT.replace('MIT License', 'The MIT License (MIT)').replace(
  'Copyright (c) <year> <copyright holders>',
  'Copyright (c) 2021-2026 Ana Pérez <ana@example.com>',
);

describe('clasificarTextosDeLicencia: open source', () => {
  it('reconoce una licencia oficial aunque cambien el título y el aviso de copyright', () => {
    expect(clasificar({ LICENSE: mitDeRepo })).toEqual({
      categoria: 'open-source',
      licencias: ['MIT'],
      motivo: 'Licencias libres reconocidas en LICENSE: MIT.',
    });
  });

  it('quita avisos de copyright de muchas formas, webs, correos y entidades HTML', () => {
    const texto = `Visor
2009-2026 (c) Ana Pérez <ana@example.com>
Original work Copyright 2019 Luis
  2020 Marta García <marta@example.com>
See https://example.com and www.example.com
${MIT.replace(/"/g, '&quot;').replace('Copyright (c) <year> <copyright holders>', '')}`;
    expect(clasificar({ 'LICENSE.md': texto }).categoria).toBe('open-source');
  });

  it('acepta varias licencias en varios archivos y un archivo que solo apunta a ellas', () => {
    const r = clasificar({
      LICENSE:
        'This project is dual licensed under either the MIT or the ISC license, at your option.',
      'LICENSE-MIT': mitDeRepo,
      'LICENSE-ISC': ISC,
    });
    expect(r.categoria).toBe('open-source');
    expect(r.licencias).toEqual(['MIT', 'ISC']);
  });

  it('elige la plantilla que explica más texto: BSD de 3 cláusulas y no la de 2, MIT y no MIT-0', () => {
    expect(clasificar({ LICENSE: BSD_3 }).licencias).toEqual(['BSD-3-Clause']);
    expect(clasificar({ LICENSE: BSD_2 }).licencias).toEqual(['BSD-2-Clause']);
    expect(clasificar({ LICENSE: mitDeRepo }).licencias).toEqual(['MIT']);
    expect(clasificar({ LICENSE: MIT_0 }).licencias).toEqual(['MIT-0']);
  });

  it('reconoce varias licencias seguidas dentro del mismo archivo', () => {
    const r = clasificar({ LICENSE: `${mitDeRepo}\n\n---\n\n${BSD_3}` });
    expect(r.categoria).toBe('open-source');
    expect(r.licencias.sort()).toEqual(['BSD-3-Clause', 'MIT']);
  });
});

describe('clasificarTextosDeLicencia: lo que queda para revisar', () => {
  it('una licencia libre con una frase añadida no es open source', () => {
    const r = clasificar({
      LICENSE: `${mitDeRepo}\nThe Software may not be used for military purposes.`,
    });
    expect(r.categoria).toBe('otra');
    expect(r.licencias).toEqual(['MIT']);
    expect(r.motivo).toContain('texto añadido');
    expect(r.motivo).toContain('military');
  });

  it('«open core»: la licencia libre no cubre la carpeta de pago', () => {
    const r = clasificar({
      LICENSE: `Portions of this software are licensed as follows:
* All content that resides under the "ee/" directory of this repository is licensed under the
  license defined in "ee/LICENSE".
* Content outside of the above mentioned directories is available under the "MIT" license.

${mitDeRepo}`,
    });
    expect(r.categoria).toBe('otra');
  });

  it('un texto propio que no es ninguna licencia conocida', () => {
    const r = clasificar({
      'LICENSE.md':
        '© Ana SL. All rights reserved. Use is subject to our Commercial Terms of Service.',
    });
    expect(r).toEqual({
      categoria: 'otra',
      licencias: [],
      motivo: 'No reconocemos el texto de LICENSE.md. Hay que revisarla a mano.',
    });
  });

  it('sin archivos no se puede decir nada', () => {
    expect(clasificar({}).categoria).toBe('otra');
  });

  it('a elegir entre una libre y una con límites: lo decide una persona', () => {
    const r = clasificar({
      LICENSE:
        'This software is available under the GNU Affero General Public License v3 or the Elastic License 2.0, at your option.',
    });
    expect(r.categoria).toBe('otra');
    expect(r.motivo).toContain('Mezcla');
  });

  it('mezcla entre archivos: uno con límites y otro libre', () => {
    const r = clasificar({
      LICENSE: 'Elastic License 2.0 (ELv2). You may not provide the software as a hosted service.',
      'packages/sdk/LICENSE': mitDeRepo,
    });
    expect(r.categoria).toBe('otra');
  });

  it('nombrar la BSL para una parte no convierte en «con límites» un proyecto GPL', () => {
    const r = clasificar({
      LICENSE: `Each package has its own license. You can consider Visor to be GPLv3 licensed overall.
Paid features live in packages/pro and are licensed under the Business Source License (BSL).`,
    });
    expect(r.categoria).toBe('otra');
  });
});

describe('clasificarTextosDeLicencia: con límites', () => {
  it('BUSL: nombra la licencia libre futura, pero hoy tiene límites', () => {
    const r = clasificar({
      LICENSE: `License text copyright (c) 2020 MariaDB Corporation Ab, All Rights Reserved.
"Business Source License" is a trademark of MariaDB Corporation Ab.

Parameters
Licensor: Ana SL
Licensed Work: Visor 2.0
Additional Use Grant: None
Change Date: 2030-01-01
Change License: Apache License, Version 2.0`,
    });
    expect(r).toEqual({
      categoria: 'con-limites',
      licencias: ['Business Source License'],
      motivo: 'Licencia con límites: Business Source License (LICENSE).',
    });
  });

  it('Commons Clause encima de una MIT', () => {
    const r = clasificar({
      'LICENSE.md': `"Commons Clause" License Condition v1.0

The Software is provided to you by the Licensor under the License, as defined below, subject to
the following condition. Without limiting other conditions in the License, the grant of rights
under the License will not include, and the License does not grant to you, the right to Sell the
Software.

Software: Visor
License: MIT

${mitDeRepo}`,
    });
    expect(r.categoria).toBe('con-limites');
    expect(r.licencias).toEqual(['Commons Clause']);
  });

  it.each([
    ['Server Side Public License, VERSION 1, OCTOBER 16, 2018', 'Server Side Public License'],
    ['Sustainable Use License Version 1.0', 'Sustainable Use License'],
    ['PolyForm Noncommercial License 1.0.0', 'PolyForm'],
    ['Functional Source License, Version 1.1, MIT Future License', 'Functional Source License'],
    [
      'Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)',
      'Creative Commons NonCommercial',
    ],
    ['TENCENT HUNYUAN COMMUNITY LICENSE AGREEMENT', 'licencia comunitaria'],
    ['END USER LICENSE AGREEMENT for Visor Community Edition', 'EULA'],
  ])('%s', (texto, nombre) => {
    const r = clasificar({ LICENSE: texto });
    expect(r.categoria).toBe('con-limites');
    expect(r.licencias).toContain(nombre);
  });

  it('una frase de una licencia con límites dentro de una libre no cuenta, pero añadida sí', () => {
    // La MPL-2.0 de verdad habla de «end user license agreements» en su cláusula 5.2.
    const mpl = `Mozilla Public License Version 2.0
5.2. In the event of termination, all end user license agreements (excluding distributors and
resellers) which have been validly granted by You or Your distributors under this License prior to
termination shall survive termination.`;
    const conMpl = prepararPlantillas([{ id: 'MPL-2.0', texto: mpl }]);
    const clasificarMpl = (texto: string) =>
      clasificarTextosDeLicencia([{ ruta: 'LICENSE', texto }], conMpl, 'ana/visor');
    expect(clasificarMpl(mpl).categoria).toBe('open-source');
    const conEula = clasificarMpl(
      `${mpl}\nThe binaries are covered by our End User License Agreement.`,
    );
    expect(conEula.categoria).toBe('otra');
    expect(conEula.licencias).toContain('EULA');
  });

  it('la palabra «noncommercially» de la propia GPL no es una licencia con límites', () => {
    const r = clasificar({
      COPYING:
        'This alternative is allowed only occasionally and noncommercially, and only if you received the object code.',
    });
    expect(r.categoria).toBe('otra');
    expect(r.licencias).toEqual([]);
  });
});

describe('prepararPlantillas', () => {
  it('no acepta plantillas de licencias que no son libres', () => {
    expect(() =>
      prepararPlantillas([{ id: 'SSPL-1.0', texto: 'Server Side Public License' }]),
    ).toThrow(/no es una licencia libre/);
  });

  it('todas las plantillas que usa el clasificador son libres según SPDX', () => {
    for (const id of PLANTILLAS_NECESARIAS)
      expect(LICENCIAS_LIBRES.has(id.toLowerCase())).toBe(true);
  });
});

describe('palabrasDeLicencia', () => {
  it('no quita la cláusula «(c) You must retain…» de Apache, que no es un aviso de copyright', () => {
    expect(palabrasDeLicencia('(c) You must retain, in the Source form')).toEqual([
      'c',
      'you',
      'must',
      'retain',
      'in',
      'the',
      'source',
      'form',
    ]);
    expect(palabrasDeLicencia('(c) 2020 Ana\nCopyright Ana\nAll rights reserved.')).toEqual([]);
  });
});

describe('esArchivoDeLicencia', () => {
  it.each([
    'LICENSE',
    'LICENSE.md',
    'LICENCE.txt',
    'license.html',
    'COPYING',
    'COPYING.LIB',
    'COPYING-GPL2',
    'LICENSE-MIT',
    'LICENSE_APACHE',
    'LICENSE.enterprise',
    'UNLICENSE',
    'gpl-3.0.txt',
    'MIT-LICENSE',
    'EULA.txt',
    'LICENSE_BSD_Simple.txt',
    'License.TXT',
  ])('%s sí', (nombre) => {
    expect(esArchivoDeLicencia(nombre)).toBe(true);
  });

  it.each([
    'NOTICE',
    'COPYRIGHT',
    'README.md',
    'CONTRIBUTOR_LICENSE_AGREEMENT.md',
    'license-install.md',
    'license-info.uu',
    'license_header_checker.py',
    'license_cache.json',
    'LICENSE_FAQ.md',
    'License_plate_detection.ipynb',
    'license.go',
    'apache.conf',
    'mitmproxy.py',
  ])('%s no', (nombre) => {
    expect(esArchivoDeLicencia(nombre)).toBe(false);
  });
});

describe('esRutaDeTerceros', () => {
  it.each([
    ['node_modules/react/LICENSE', true],
    ['vendor/github.com/x/LICENSE', true],
    ['third_party/zlib/LICENSE', true],
    ['src/3rdparty/x/COPYING', true],
    ['app/qml/fonts/fira-code/LICENSE.txt', true],
    ['deps/acorn/LICENSE', true],
    ['LICENSE', false],
    ['packages/x/LICENSE', false],
    ['docs/copying.rst', false],
    ['desktop/TuxGuitar/share/help/license.html', false],
  ])('%s → %s', (ruta, esperado) => {
    expect(esRutaDeTerceros(ruta)).toBe(esperado);
  });
});
