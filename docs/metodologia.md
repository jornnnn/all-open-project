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
| Otra licencia | No sabemos con seguridad cuál es: una persona la revisa antes de decir nada |
| Sin licencia | No hay licencia: legalmente no se puede reutilizar el código |

Partimos de lo que dice GitHub. Cuando GitHub no lo sabe, leemos los archivos de licencia del proyecto:

- **GitHub ve una licencia pero no sabe cuál** (le pasa, por ejemplo, con las licencias dobles o con un título añadido). Comparamos cada archivo de licencia de la raíz con los textos oficiales de SPDX.
  - Decimos **open source** solo si cada archivo es el texto oficial de una licencia libre y lo único que sobra son títulos, nombres y avisos de *copyright*. Si sobra una frase («salvo la carpeta `ee/`», «el texto no», «no para uso militar»…), queda como *otra licencia*.
  - Decimos **código con límites** si nombra una licencia con límites (Business Source, SSPL, Elastic, Sustainable Use, PolyForm, Functional Source, Commons Clause, Creative Commons NC o ND, licencias comunitarias o EULA…) y ninguna libre.
  - Si mezcla las dos («AGPL o Elastic, a tu elección»), queda como *otra licencia*: lo decide una persona.
- **GitHub no ve ninguna licencia.** GitHub solo mira la raíz, así que antes de decir *sin licencia* buscamos archivos de licencia en todo el repositorio, sin contar las carpetas de código de otros (`node_modules`, `vendor`, `third_party`, fuentes tipográficas…). Si hay uno en la raíz con otro nombre (`gpl-3.0.txt`, `EULA.txt`), lo leemos; si solo los hay en subcarpetas, queda como *otra licencia* para revisarla.

Cada ficha explica cómo se ha decidido su licencia cuando no basta con lo que dice GitHub. Las correcciones manuales quedan en [`data/editorial.yaml`](../data/editorial.yaml).

## Instaladores

Miramos los archivos de la última versión publicada:

| Sistema | Archivos |
|---|---|
| Windows | `.exe`, `.msi`, `.msix`, `.appx` |
| Mac | `.dmg`, `.pkg` |
| Linux | `.AppImage`, `.deb`, `.rpm`, `.flatpak`, paquetes de Arch |
| Android | `.apk` (los `.apk` de Alpine Linux cuentan como Linux) |

No cuentan las firmas, las sumas de control ni los paquetes de depuración.

Las **descargas** son las de los archivos de esa última versión en GitHub, sin contar las sumas de control, las firmas ni los archivos que consultan los programas ya instalados para buscar actualizaciones (`latest.yml`, `latest.json`…).

## Puntuación

Va de 0 a 100 y **compara cada proyecto con los de su tema principal** (todos los que tienen ese tema, aunque sea como secundario). Así, el mejor gestor de contraseñas puntúa alto aunque tenga menos estrellas que un proyecto de inteligencia artificial. Si el tema tiene menos de 10 proyectos, se compara con toda su área.

| Apartado | Peso | Cómo se mide |
|---|---|---|
| Popularidad | 30 | Percentil de estrellas (70 %) y de *forks* (30 %) dentro del tema |
| Impulso | 20 | Percentil de las estrellas ganadas al día en los últimos 30 días, según nuestras fotos diarias |
| Salud | 30 | Media de: actividad (último cambio: 100 % hasta 30 días, 0 % al año), versiones (100 % hasta 90 días, 0 % a los dos años) e *issues* (proporción de cerradas, si hay al menos 10) |
| Uso real | 20 | Percentil de las descargas al día de la última versión en GitHub |

- El **percentil** es la parte de los proyectos del tema que quedan por debajo (los empates cuentan la mitad).
- **Si un apartado no tiene datos, su peso se reparte entre los demás.** Pasa con el impulso hasta que tenemos 7 días de fotos y con el uso real en los proyectos que no publican archivos en GitHub (por ejemplo, las librerías que se instalan con npm o pip). En la salud, igual: si no hay versiones o *issues*, cuenta solo lo que hay.
- **Se restan puntos:** 30 si está archivado, 20 si lleva más de 12 meses sin cambios y 15 si no tiene licencia. Un proyecto *terminado* (lo decide una persona) no pierde puntos por no tener cambios.
- **Próximamente:** también restarán puntos las estrellas que suben de forma sospechosa, cuando el radar las detecte.

## Datos diarios y datos abiertos

Cada noche, a las 03:17 UTC, un robot (GitHub Actions) pide a la API oficial de GitHub los datos de todo el catálogo: estrellas, *forks*, *issues*, fechas, licencia, web, lenguaje, la última versión con sus archivos y si la organización está verificada. Los *topics*, que casi nunca cambian y son lo más costoso de pedir, se renuevan por turnos: cada proyecto, una vez por semana (y los nuevos, el primer día). Calcula el estado, la licencia, los instaladores y la puntuación, guarda una foto de cada proyecto (el historial) y publica el resultado en [`data/export/proyectos.json`](../data/export/), con licencia CC BY 4.0.

Si GitHub no da a la vez más del 2 % de los proyectos, el robot no publica nada ese día, por si el fallo es suyo. Las cifras de cada proyecto son las del momento en que se leyeron (campo `generado`).

## Temas

Cada subtema tiene sus *topics* de GitHub, y cada *topic* pertenece a un solo subtema. Un proyecto puede estar en varios subtemas. El tema principal es el que más *topics* comparte con él.

Descartamos los *topics* que mezclan cosas distintas. Por ejemplo, `matrix` también son las matrices de las matemáticas, y `office` lo usan herramientas para activar Office sin licencia.

## Próximamente

La detección de posibles copias falsas (siempre con revisión humana antes de publicar), las tendencias y los textos explicativos se documentarán aquí cuando estén en marcha.
