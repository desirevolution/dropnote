# Batch 2 — release validation (checkpoint 09)

**Status: release candidate / acceptance blocked. Do not publish as a validated release until the integration, browser and Docker gates pass.**

Basis: checkpoint 08b UI Polish. No new application features, database migrations, or npm dependencies in this checkpoint.

## Findings and fixes

1. Guest file downloads previously used asynchronous `sendFile` after the access check. The pathname could be reused by deletion/recreation before the file was opened. `openBlobRead` now pins the file descriptor synchronously after authorization, checks that it is a regular file, and streams the authorized bytes. HEAD and content length are preserved; requests with Range now receive the full file (the existing client always downloads complete files). Revocation is checked for each request; an already authorized stream is not retroactively revoked.
2. All authenticated attachment downloads now have `Cache-Control: private, no-store`, including plain Spaces. The server still checks permissions, expected Space ID and proof on every request.
3. Guest CSP did not hash the inline theme restore script and prohibited loading the locally bundled font. The guest router now permits the exact three existing inline scripts by SHA-256, permits self-hosted fonts, and exposes only the single public font path. No inline script wildcard or extra private endpoint is enabled.
4. Deployment tests previously continued after calling `t.skip()` if Docker was missing. They now return immediately. The CI gate explicitly requires `docker info` to succeed, so the real release build cannot pass by skipping Docker tests.

## Review against decisions

Source review is not an end-to-end pass. “Local” means the relevant dependency-free unit/fixture tests ran; “Pending” means the runtime scenario still needs a working install. Existing test files are retained.

| Decisions | Code reviewed / test seam | Remaining gate |
|---|---|---|
| R01/R05/R14/R21 | `reference-files.js`, `reference-cache.js`, `attachments.js`, bounded replay, authorized descriptor | HTTP ACL/proof, actual Yjs replay, encrypted transfer, cancellation |
| R02/R03/R07/R11 | `internal-references.ts`, `space-identity.ts`, store migration, reference actions; local parser/ID tests | HTTP permission changes, dynamic labels, UI repair and aliases |
| R04/R06 | explicit view and history state, native browser history; local navigation tests | actual browser history/positions, PWA and BFCache |
| R08/R12/R18/R22 | picker, creation dialog, insertion anchor, reference query/trigger; local trigger/range tests | actual Yjs anchors and concurrent updates; create/cancel, mobile |
| R09 | smart-note decorations, shared CSS; local parser and page markup tests | real CodeMirror decorations, focus, touch, keyboard |
| R10/R20 | guest sanitization, snapshot sealing and proof checks; local transforms and crypto test | HTTP guest boundary, legacy/revoked snapshots, guest E2E |
| R13 | editor help examples, insertion and locale tests | actual help dialog, collaborative insertion, readonly/guest |
| R15/R16/R17 | search protection, deletion counts and readable export; local unit tests | UI search, delete confirmation, export and undo |
| R19 | no Space duplication feature in baseline | explicitly deferred, no new duplication feature |
| R23 | error/status/retry/unlock paths, invalidation and cancellation | runtime errors, retry and repair |
| R24 | new real-browser script and mandatory CI workflow, existing Node integration tests | entire CI gate must pass |
| UI-R1/R2/R5/R6 | CodeMirror styles, shared surface, typography, gutters, widget styles; markup and parser tests | real gutter alignment including wrapped lines and headings, guest theme and font |
| UI-R3/R4 | responsive controls, metrics, single sync indicator; local unit and HTML/CSS toolbar fixture | real sync status and CodeMirror, mobile keyboard |

Known existing constraints: cross-document navigation discards in-memory keys/cache; foreign replay has size/frame limits; existing encrypted guest snapshots must be revoked/recreated to remove previously published private syntax. No security claim is made for sensitive information in arbitrary text or labels. No global scanning or persistent decrypted metadata added. Existing guest plain shares remain live-on-open; encrypted shares remain fixed snapshots subject to blob availability.

## Validation performed in this environment

- 91 dependency-free tests passed, including three new unit tests (descriptor identity, non-file rejection, guest CSP hashes). Command below.
- JavaScript syntax checks of all frontend modules and 108 relative frontend imports passed.
- Targeted strict TypeScript check of new independent security modules and tests passed using locally available Node type definitions (TypeScript 5.8.3, not the project's pinned compiler).
- Existing 08b Chromium HTML/CSS/toolbar fixture rerun: desktop and mobile widths 240–1280 px, guest widths 240–1280 px, no overflow/duplicate controls; this does not contain real CodeMirror/Yjs.
- Docker smoke tests correctly skipped (3), Docker is not installed.
- Full npm install/build/test/typecheck and new real browser harness attempted, blocked: registry DNS `EAI_AGAIN`, offline cache missing Yjs; esbuild and project type dependencies missing; server cannot import Express. Local Node 22.16.0 is below the project's >=24 requirement (Docker uses Node 26). An isolated HTTPS browser fixture navigation was also blocked by the local Chromium policy. The guest CSP unit test passes but live browser font and theme verification remains open.
- A broader initial test attempt included four server-dependent theme tests and an encrypted-attachment suite; these could not start under the missing dependencies/Node 22 setup. They are not included in the 91 successful tests.

Reproduce the local subset:

```sh
node --experimental-strip-types --test test/{blob-read,crypto,editor-help,editor-ui,guest-reference-boundaries,internal-references,note-links,note-search,reference-insertion,reference-navigation,reference-replay,reference-search-export,share-secret,smart-guest-page,smart-note,space-identity,workspace-view}.test.ts
```

## Required release gate

Run `.github/workflows/validate.yml` on a PR or via workflow_dispatch. The existing publish workflow now depends on this reusable validation workflow. It runs `npm ci`, the project typecheck, `docker info`, `npm test` (build + Node unit/integration + real Docker deployment), then the new Playwright production-bundle browser checks using a temporary data directory. No npm lockfile change; Python Playwright is separately pinned in `test/e2e/requirements.txt`.

The new browser suite exercises actual checklist sync/undo/redo, line geometry with Markdown/wrapping and both themes, relative help insertion with a second client, typed reference picker and no implicit foreign lookup, alias and replace protection, foreign file download, read-only help, explicit navigation and back, plain guest redemption and sanitization/local download/font/theme, and responsive toolbar/status fallback. It is authored and syntax-checked, **not yet executed successfully**. Guest HTTPS origin is bridged to the real local router with Playwright for test purposes; this does not test a production TLS proxy. HTTP integration tests for encrypted guest/proof and ACL remain mandatory.

Before publishing: run the complete workflow, resolve any failed assertions, manually spot-check mobile touch/keyboard and long documents, including scrolling and mixed-height lines; verify an upgrade using a copy of the real data directory and retain a backup. No version bump or release tag is included. A successful CI run is necessary but does not replace these manual spot checks or guarantee absence of all security issues.
