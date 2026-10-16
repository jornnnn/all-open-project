# Metodología

Cómo elegimos, clasificamos y verificamos los proyectos. Todo el cálculo está en el código de este repositorio (`packages/core`), con tests, y las correcciones manuales quedan registradas en [`data/editorial.yaml`](../data/editorial.yaml).

**Fuente de los datos:** la API oficial de GitHub. Las cifras son las del día que figura en cada archivo. La IA no pone cifras ni hechos: solo redacta a partir de los datos.

## Qué proyectos entran

La lista inicial ([`data/semilla.yaml`](../data/semilla.yaml)) sale de tres sitios:

1. **Alternativas.** Los proyectos que proponemos como alternativa a programas de pago o cerrados ([`data/alternativas.yaml`](../data/alternativas.yaml)).
2. **Altas manuales**, con su motivo. Casi siempre son proyectos de referencia que en GitHub no tienen los *topics* que los llevarían a su tema.
3. **Búsquedas por tema.** Para cada subtema de la [taxonomía](../data/taxonomia.yaml) se buscan en GitHub sus *topics*, ordenados por estrellas. Entran los 35 primeros de cada subtema, para que ningún tema se quede vacío, y después los más populares de cualquier tema hasta llegar a unos 3.000 proyectos.

Justo antes de publicar la lista se vuelve a preguntar a GitHub por cada proyecto (si existe, si está archivado, si es un *fork*, su último cambio y sus estrellas), porque las búsquedas pueden ser de unas horas antes.

De las búsquedas quedan fuera:
- los *forks* y los repositorios archivados;
- los que tienen menos de 150 estrellas;
- los que llevan más de 12 meses sin cambios;
- los creados hace menos de 90 días: lo nuevo lo vigila el radar y entra cuando se consolida;
- las listas, los cursos y los repositorios sin código, que tendrán su propio apartado «para aprender»;
- los proyectos excluidos a mano, siempre con su motivo (por ejemplo, herramientas para activar programas sin licencia).

## Estado

| Estado | Regla |
|---|---|
| Vivo | Menos de 3 meses sin cambios |
| Lento | De 3 a 12 meses sin cambios |
| Abandonado | Más de 12 meses sin cambios, o archivado en GitHub |
| Terminado | Lo decide una persona: el proyecto está acabado a propósito |

«Cambios» quiere decir el último *commit* de la rama principal. Los meses son de calendario.

## Licencia

| Etiqueta | Cuándo |
|---|---|
| Open source | Licencia aprobada por la OSI o libre según la FSF, según la [lista oficial de SPDX](https://spdx.org/licenses/) |
| Código con límites | Se puede ver el código, pero limita el uso comercial, como servicio o las obras derivadas: Business Source (BUSL), SSPL, Elastic, PolyForm, Functional Source (FSL), Sustainable Use, Creative Commons NC o ND, entre otras |
| Otra licencia | GitHub ve una licencia, pero no sabe cuál es. La revisamos a mano antes de decir nada |
| Sin licencia | No hay licencia: legalmente no se puede reutilizar el código |

## Instaladores

Miramos los archivos de la última versión publicada:

| Sistema | Archivos |
|---|---|
| Windows | `.exe`, `.msi`, `.msix`, `.appx` |
| Mac | `.dmg`, `.pkg` |
| Linux | `.AppImage`, `.deb`, `.rpm`, `.flatpak`, paquetes de Arch |
| Android | `.apk` (los `.apk` de Alpine Linux cuentan como Linux) |

No cuentan las firmas, las sumas de control ni los paquetes de depuración.

## Temas

Cada subtema tiene sus *topics* de GitHub, y cada *topic* pertenece a un solo subtema. Un proyecto puede estar en varios subtemas. El tema principal es el que más *topics* comparte con él.

Descartamos los *topics* que mezclan cosas distintas. Por ejemplo, `matrix` también son las matrices de las matemáticas, y `office` lo usan herramientas para activar Office sin licencia.

## Próximamente

La puntuación de 0 a 100, la detección de posibles copias falsas (siempre con revisión humana antes de publicar) y los textos explicativos se documentarán aquí cuando estén en marcha.
