import { describe, expect, it } from 'vitest';
import { detectarInstaladores, sistemasConInstalador } from './instaladores.ts';

describe('detectarInstaladores', () => {
  it('agrupa los archivos de una versión por sistema', () => {
    const resultado = detectarInstaladores([
      'App-Setup-1.2.0.exe',
      'App-1.2.0.msi',
      'App-1.2.0-arm64.dmg',
      'App-1.2.0.pkg',
      'App-1.2.0-x86_64.AppImage',
      'app_1.2.0_amd64.deb',
      'app-1.2.0.x86_64.rpm',
      'app-1.2.0.flatpak',
      'app-1.2.0-1-x86_64.pkg.tar.zst',
      'app-release.apk',
      'App.msixbundle',
      'source.tar.gz',
      'SHA256SUMS.txt',
    ]);
    expect(resultado).toEqual({
      windows: ['App-Setup-1.2.0.exe', 'App-1.2.0.msi', 'App.msixbundle'],
      mac: ['App-1.2.0-arm64.dmg', 'App-1.2.0.pkg'],
      linux: [
        'App-1.2.0-x86_64.AppImage',
        'app_1.2.0_amd64.deb',
        'app-1.2.0.x86_64.rpm',
        'app-1.2.0.flatpak',
        'app-1.2.0-1-x86_64.pkg.tar.zst',
      ],
      android: ['app-release.apk'],
    });
  });

  it('no confunde firmas, sumas de control ni archivos de actualización', () => {
    const resultado = detectarInstaladores([
      'App-Setup.exe.sig',
      'App-Setup.exe.blockmap',
      'App.dmg.sha256',
      'App.AppImage.zsync',
      'app.deb.asc',
    ]);
    expect(sistemasConInstalador(resultado)).toEqual([]);
  });

  it('ignora paquetes de depuración y símbolos', () => {
    const resultado = detectarInstaladores([
      'app-debuginfo-1.0.x86_64.rpm',
      'app-dbgsym_1.0_amd64.deb',
      'app-debug.apk',
      'app-symbols-1.0.msi',
      'x64dbg_setup.exe',
    ]);
    expect(resultado.linux).toEqual([]);
    expect(resultado.android).toEqual([]);
    expect(resultado.windows).toEqual(['x64dbg_setup.exe']);
  });

  it('los .apk de Alpine Linux van a Linux, no a Android', () => {
    const resultado = detectarInstaladores(['tool_1.0_linux_amd64.apk', 'tool-alpine.apk']);
    expect(resultado.linux).toEqual(['tool_1.0_linux_amd64.apk', 'tool-alpine.apk']);
    expect(resultado.android).toEqual([]);
  });

  it('acepta rutas y URLs y devuelve solo el nombre', () => {
    const resultado = detectarInstaladores([
      'https://github.com/o/r/releases/download/v1/App.exe?raw=1',
      'dist\\App.dmg',
    ]);
    expect(resultado.windows).toEqual(['App.exe']);
    expect(resultado.mac).toEqual(['App.dmg']);
  });

  it('sin archivos no hay sistemas', () => {
    expect(sistemasConInstalador(detectarInstaladores([]))).toEqual([]);
  });
});

describe('sistemasConInstalador', () => {
  it('devuelve los sistemas en orden fijo', () => {
    const resultado = detectarInstaladores(['a.apk', 'b.deb', 'c.exe']);
    expect(sistemasConInstalador(resultado)).toEqual(['windows', 'linux', 'android']);
  });
});
