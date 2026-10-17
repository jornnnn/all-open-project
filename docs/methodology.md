# Methodology

How we select, classify and verify projects. All calculations live in this repository's code (`packages/core`), with tests, and manual corrections are logged in [`data/editorial.yaml`](../data/editorial.yaml).

**Data source:** the official GitHub API. Figures are as of the date shown in each file. AI never writes figures or facts: it only writes prose from the data.

## Which projects are included

The initial list ([`data/semilla.yaml`](../data/semilla.yaml)) comes from three places:

1. **Alternatives.** The projects we suggest as alternatives to paid or closed software ([`data/alternativas.yaml`](../data/alternativas.yaml)).
2. **Manual additions**, each with a reason. They are mostly reference projects that lack the GitHub topics that would bring them to their subtopic.
3. **Topic searches.** For each subtopic in the [taxonomy](../data/taxonomia.yaml) we search GitHub for its topics, sorted by stars. The top 35 of every subtopic get in, so no subtopic is left empty, and then the most popular ones from any subtopic until the list reaches about 3,000 projects.

Right before publishing the list, every project is checked again on GitHub (whether it exists, is archived or is a fork, its latest change and its stars), because the searches may be a few hours old.

Search results exclude:
- forks and archived repositories;
- repositories with fewer than 150 stars;
- repositories with no changes in more than 12 months;
- repositories created less than 90 days ago: new projects are tracked by the radar and join once they settle;
- lists, courses and repositories without code, which will get their own "learning" section;
- projects excluded by hand, always with a reason (for example, tools that activate software without a license).

## Status

| Status | Rule |
|---|---|
| Active | Less than 3 months without changes |
| Slow | 3 to 12 months without changes |
| Abandoned | More than 12 months without changes, or archived on GitHub |
| Finished | Set by a person: the project is complete on purpose |

"Changes" means the latest commit on the default branch. Months are calendar months.

## License

| Label | When |
|---|---|
| Open source | OSI-approved or FSF free license, per the [official SPDX list](https://spdx.org/licenses/) |
| Source-available | The code is visible but commercial use, use as a service or derivative works are restricted: Business Source (BUSL), SSPL, Elastic, PolyForm, Functional Source (FSL), Sustainable Use, Creative Commons NC or ND, among others |
| Other license | We don't know for sure which one it is: a person reviews it before we say anything |
| No license | There is no license: legally, the code cannot be reused |

We start from what GitHub says. When GitHub doesn't know, we read the project's license files:

- **GitHub sees a license but can't tell which** (this happens, for example, with dual licenses or an added title). We compare each license file in the root folder with the official SPDX texts.
  - We say **open source** only if every file is the official text of a free license and the only extra text is titles, names and copyright notices. If any sentence is added ("except the `ee/` folder", "not the text", "not for military use"…), it stays as *other license*.
  - We say **source-available** if it names a license with restrictions (Business Source, SSPL, Elastic, Sustainable Use, PolyForm, Functional Source, Commons Clause, Creative Commons NC or ND, community licenses or EULAs…) and no free one.
  - If it mixes both ("AGPL or Elastic, at your choice"), it stays as *other license*: a person decides.
- **GitHub sees no license.** GitHub only looks at the root folder, so before saying *no license* we look for license files in the whole repository, ignoring folders with other people's code (`node_modules`, `vendor`, `third_party`, fonts…). If there is one in the root with another name (`gpl-3.0.txt`, `EULA.txt`), we read it; if there are only some in subfolders, it stays as *other license* to be reviewed.

Each project explains how its license was decided when GitHub's answer is not enough. Manual corrections are recorded in [`data/editorial.yaml`](../data/editorial.yaml).

## Installers

We look at the files of the latest release:

| System | Files |
|---|---|
| Windows | `.exe`, `.msi`, `.msix`, `.appx` |
| Mac | `.dmg`, `.pkg` |
| Linux | `.AppImage`, `.deb`, `.rpm`, `.flatpak`, Arch packages |
| Android | `.apk` (Alpine Linux `.apk` files count as Linux) |

Signatures, checksums and debug packages do not count.

**Downloads** are those of the files of that latest release on GitHub, not counting checksums, signatures or the files that installed apps check for updates (`latest.yml`, `latest.json`…).

## Score

It goes from 0 to 100 and **compares each project with the others in its main subtopic** (every project with that subtopic, even as a secondary one). That way the best password manager scores high even with fewer stars than an AI project. If the subtopic has fewer than 10 projects, the comparison uses its whole area.

| Part | Weight | How it is measured |
|---|---|---|
| Popularity | 30 | Percentile of stars (70%) and forks (30%) within the subtopic |
| Momentum | 20 | Percentile of stars gained per day over the last 30 days, from our daily snapshots |
| Health | 30 | Average of: activity (latest change: 100% up to 30 days, 0% at one year), releases (100% up to 90 days, 0% at two years) and issues (share of closed ones, if there are at least 10) |
| Real use | 20 | Percentile of daily downloads of the latest release on GitHub |

- The **percentile** is the share of projects in the subtopic that rank below (ties count as half).
- **If a part has no data, its weight is shared among the others.** This happens with momentum until we have 7 days of snapshots, and with real use for projects that don't publish files on GitHub (for example, libraries installed with npm or pip). Health works the same way: if there are no releases or issues, only what exists counts.
- **Points are taken off:** 30 if archived, 20 if there have been no changes for more than 12 months and 15 if there is no license. A *finished* project (a person decides) does not lose points for having no changes.
- **Coming soon:** stars that grow suspiciously will also take points off, once the radar detects them.

## Daily data and open data

Every night at 03:17 UTC a robot (GitHub Actions) asks the official GitHub API for the data of the whole catalog: stars, forks, issues, dates, license, website, language, the latest release with its files and whether the organization is verified. Topics, which rarely change and are the most expensive to request, are refreshed in turns: each project once a week (and new ones on their first day). It works out the status, license, installers and score, saves a snapshot of each project (the history) and publishes the result in [`data/export/proyectos.json`](../data/export/), under CC BY 4.0.

If GitHub fails to return more than 2% of the projects at once, the robot publishes nothing that day, in case the problem is on its side. The figures for each project are those at the moment they were read (`generado` field).

## Topics

Each subtopic has its own GitHub topics, and each topic belongs to a single subtopic. A project can be in several subtopics; its main one is the one that shares the most topics with it.

We discard topics that mix unrelated things. For example, `matrix` is also used for maths matrices, and `office` is used by tools that activate Office without a license.

## Coming soon

The detection of possible fake copies (always reviewed by a person before publishing), trends and the explanatory texts will be documented here once they are live.
