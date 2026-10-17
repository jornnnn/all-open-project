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
- los creados hace menos de 90 días: lo nuevo lo vigila el radar y entra cuando se consolida (ver «Proyectos nuevos»);
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

Cada ficha explica cómo se ha decidido su licencia cuando no basta con lo que dice GitHub. Esta revisión se repite una vez por semana para cada proyecto, o el mismo día si GitHub cambia lo que dice. Las correcciones manuales quedan en [`data/editorial.yaml`](../data/editorial.yaml).

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

Cada noche, a las 03:23 UTC, un robot (GitHub Actions) pide a la API oficial de GitHub los datos de todo el catálogo: estrellas, *forks*, *issues*, fechas, licencia, web, lenguaje, la última versión con sus archivos y si la organización está verificada. Los *topics*, que casi nunca cambian y son lo más costoso de pedir, se renuevan por turnos: cada proyecto, una vez por semana (y los nuevos, el primer día). Calcula el estado, la licencia, los instaladores y la puntuación, guarda una foto de cada proyecto (el historial) y publica el resultado en [`data/export/proyectos.json`](../data/export/), con licencia CC BY 4.0.

Si GitHub no da a la vez más del 2 % de los proyectos, el robot no publica nada ese día, por si el fallo es suyo. Las cifras de cada proyecto son las del momento en que se leyeron (campo `generado`).

## Temas

Cada subtema tiene sus *topics* de GitHub, y cada *topic* pertenece a un solo subtema. Un proyecto puede estar en varios subtemas. El tema principal es el que más *topics* comparte con él.

Descartamos los *topics* que mezclan cosas distintas. Por ejemplo, `matrix` también son las matrices de las matemáticas, y `office` lo usan herramientas para activar Office sin licencia.

## Radar: lo que se está haciendo viral

Cada hora, a los :23 (UTC), un robot (GitHub Actions) busca lo que se está haciendo viral:

1. **Pistas.** Lee la hora anterior de [GH Archive](https://www.gharchive.org), que guarda una muestra de la actividad pública de GitHub, y anota los repositorios con 2 o más estrellas en esa muestra. Es solo una pista: en octubre de 2026 GH Archive recogía en torno al 2 % de las estrellas, así que nunca la usamos para contar.
2. **Búsqueda.** Pregunta a la API de búsqueda de GitHub por los repositorios creados en los últimos 2, 7 y 30 días con más estrellas.
3. **Seguimiento.** Lee las estrellas de todo el catálogo y de los proyectos nuevos que vigila, y guarda una foto por hora durante 14 días.

### En auge

Un proyecto está **en auge** cuando en 24 horas gana al menos 100 estrellas y más de 5 veces su ritmo habitual.

- **Estrellas ganadas en 24 horas:** la diferencia entre las estrellas de ahora y las de la primera foto de las últimas 24 horas. Si falta alguna foto, contamos desde la siguiente: la cifra puede quedarse corta, pero nunca exagera. Un proyecto creado hace menos de 24 horas cuenta desde cero.
- **Ritmo habitual:** la media de estrellas al día de los 7 días completos anteriores a ayer, según el [historial oficial de estrellas de GitHub](https://docs.github.com/rest/activity/starring). Ni ayer ni hoy cuentan, para que un despegue no suba su propio listón. Si el proyecto es más joven, cuentan los días que tenga (sin el de su creación, que está a medias); si no tiene ninguno, su ritmo es 0.
- Para que no entre y salga cada hora, un proyecto sigue en auge mientras no baje del 80 % de lo que necesitó para entrar.
- No salen en las tendencias los proyectos con una alerta de posible copia ni los nuevos que se llaman como uno de los más populares, hasta que una persona los revisa.

Desde julio de 2026, GitHub no deja ver cuándo dio cada persona su estrella; por eso las cifras por hora salen de nuestras fotos horarias y las cifras por día, del historial oficial de GitHub. Las tendencias se publican en [`/api/v1/tendencias`](https://all-open-project.jornnnn.workers.dev/api/v1/tendencias) con todas sus cifras (desde qué foto se mide y con cuántas estrellas), para que cualquiera pueda comprobarlas.

## Proyectos nuevos: cómo entran en el catálogo

El radar vigila cada hora los proyectos nuevos que encuentra. Una vez al día decide qué pasa con cada uno, con el historial oficial de estrellas de GitHub:

- **Se propone** para el catálogo si cumple todo esto:
  - tiene al menos **500 estrellas**;
  - lleva **7 días completos seguidos ganando al menos 10 estrellas** cada día (sin contar el de su creación);
  - tiene al menos 1 *fork* por cada 100 estrellas: las estrellas compradas no suelen traer *forks*;
  - sus *topics* encajan en algún tema de la taxonomía;
  - no se llama como uno de los 500 proyectos más populares, salvo que una persona haya revisado que no es una copia.
- **Entra** cuando una persona lo confirma en la revisión, porque una regla no puede juzgar si un proyecto es útil o si usa servicios de otros sin permiso. Esa noche lo recoge el robot diario, con origen `radar`.
- **Se deja** si es un *fork*, está archivado, es una lista o un curso, no tiene código o está excluido a mano; si en 30 días no ha cumplido la regla; o si, tras una semana vigilado, en 3 días seguidos no suma 10 estrellas.

Los proyectos con más de 90 días entran además por la lista inicial, con sus propias reglas.

## Posibles copias falsas

Vigilamos los 500 proyectos más populares del catálogo. Un repositorio va a la cola de revisión si cumple **todo** esto:

1. **Se llama casi igual** que uno de ellos: el mismo nombre, el nombre con un añadido típico de las copias (`-desktop`, `-windows`, `free-`, `-crack`, `-installer`…) o con una letra cambiada. No cuentan los nombres genéricos (`core`, `docs`…) ni los de lenguajes y plataformas (`node`, `linux`, `python`…).
2. **Es reciente:** se creó hace 90 días o menos.
3. **Tiene pocos cambios:** 30 *commits* o menos en su rama principal.
4. Y además, **sus estrellas suben de golpe** (50 o más en 24 horas, o una media de 20 al día desde que se creó, con al menos 100) **u ofrece descargas que el original no ofrece** (un instalador para un sistema que el original no tiene, o archivos para descargar cuando el original no publica ninguno).

No van a la cola los *forks*, lo que no tiene código ni descargas (apuntes, listas) ni lo que casi nadie ve (menos de 20 estrellas y de 100 descargas).

**Ninguna alerta se publica sin que una persona la revise.** Cada alerta guarda sus pruebas, todas sacadas de GitHub: nombres, fechas, *commits*, estrellas y archivos. Una persona compara los dos repositorios y decide. Si no es una copia, ese repositorio no vuelve a saltar.

## Próximamente

Los textos explicativos se documentarán aquí cuando estén en marcha.
