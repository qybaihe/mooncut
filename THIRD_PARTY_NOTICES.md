# Third-party notices and licensing gate

MoonCut cannot be represented as a generally reusable open-source project
until the maintainers choose a root license and complete the asset review
described below. This file makes that status explicit; it is **not** a license
grant and it does not replace upstream notices.

## Included components that require upstream terms

| Area | Upstream / evidence | Maintainer action before a public license |
| --- | --- | --- |
| Face detection and tracking | `face-tracker` uses Ultralytics and distributes `yolov8n-face.pt`; see `face-tracker/README.md` | Verify the exact model origin and commercial license. Ultralytics code/models may impose AGPL-3.0 obligations. |
| Music and sound effects | `remotion-studio/src/data/bgm-library.json` records CC0, demo-only, and non-commercial sources | Remove, replace, or isolate every track that cannot be redistributed under the chosen root license. Keep source URL, author, version, and license per asset. |
| Video, screenshots, and match material | `remotion-studio/public/**`, `remotion-studio/out/**`, and source notes | Confirm permission to redistribute each recording, web screenshot, event image, and sports highlight. Release only minimal samples with written provenance. |
| Vendored source | `twscrape/` and `remotion-studio/extensions/remotion-community/` contain upstream material | Preserve every upstream copyright and license notice; document the exact upstream revision and local modifications. |
| Runtime dependencies | npm and Python lockfiles | Generate an SBOM for every release and retain the dependency license report with the release artifacts. |

## Required release decision

Before adding a root `LICENSE`, a maintainer with authority over MoonCut's code
and assets must choose one of these paths:

1. Remove or separately distribute all incompatible assets, verify the face
   model provenance, then select an OSI-approved root license.
2. Keep the restricted assets private and publish only a clean source subset.
3. Keep the repository source-available/private until the review is complete.

Do not label a release "open source" until this checklist is signed off. New
third-party material must be recorded here or in a per-asset manifest before it
is committed.
