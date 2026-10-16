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
| Other license | GitHub sees a license but cannot identify it. We review it by hand before saying anything |
| No license | There is no license: legally, the code cannot be reused |

## Installers

We look at the files of the latest release:

| System | Files |
|---|---|
| Windows | `.exe`, `.msi`, `.msix`, `.appx` |
| Mac | `.dmg`, `.pkg` |
| Linux | `.AppImage`, `.deb`, `.rpm`, `.flatpak`, Arch packages |
| Android | `.apk` (Alpine Linux `.apk` files count as Linux) |

Signatures, checksums and debug packages do not count.

## Topics

Each subtopic has its own GitHub topics, and each topic belongs to a single subtopic. A project can be in several subtopics; its main one is the one that shares the most topics with it.

We discard topics that mix unrelated things. For example, `matrix` is also used for maths matrices, and `office` is used by tools that activate Office without a license.

## Coming soon

The 0-100 score, the detection of possible fake copies (always reviewed by a person before publishing) and the explanatory texts will be documented here once they are live.
