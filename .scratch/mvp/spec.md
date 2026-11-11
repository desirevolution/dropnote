# Spec: share-tool MVP

Status: historical MVP specification. See the README and ADRs for current behavior.

A self-hosted sharing tool: persistent, bidirectionally editable Pads combining a Markdown Note with flat encrypted Attachments, optional client-side end-to-end encryption, Live-Sync, and instance-configurable limits. Vocabulary per `GLOSSARY.md`; encryption and sync decisions per ADR-0001 and ADR-0002.

## Problem Statement

People who run their own server currently need two separate tools to share text and files with someone else: a notepad-style tool for text and a drop-style tool for uploads. Neither combines both in one shared surface, and neither offers real confidentiality — the server operator (or anyone with volume access) can read everything, and public instances expose plaintext uploads. The user wants one dumb-easy place where two parties can edit a text note, attach and remove files, and — when the content is sensitive — share it without the server ever being able to read it.

## Solution

A single self-hosted web app. Opening the site lands on a shared, always-present Default Pad: a plain text surface (no TTL, no PIN) with live Markdown preview where everyone can type and attach files. Additional Pads can be created from the UI — Plain or Encrypted, with or without a TTL — each reachable at its own URL built from a generated two-word Slug (overridable with a custom Slug, uniqueness-checked). Encrypted Pads are zero-knowledge: the browser encrypts the Note and all Attachments before upload, the Key lives only in the URL fragment, and the server relays ciphertext for Live-Sync without ever seeing plaintext. A per-Pad optional PIN gates editing and management. Everything (TTL default, size limits, instance PIN for creation, URL path) is configured per instance via environment variables; a single Docker container with one data volume is the whole deployment.

## User Stories

1. As a visitor, I want to land on the site and immediately see the shared Default Pad, so that I can start reading or typing with zero setup.
2. As a visitor, I want the Default Pad to persist across server restarts, so that the shared scratch surface survives reboots.
3. As an Editor, I want auto-saving on the Note, so that I never think about saving.
4. As a Reader, I want a rendered Markdown preview beside the editor, so that formatting is visible without knowing the syntax.
5. As an Editor, I want to attach files to any Pad, so that text and files travel together in one place.
6. As an Editor, I want to delete an Attachment from a Pad, so that outdated files disappear for everyone.
7. As a Reader, I want to download an Attachment, so that I can take files with me.
8. As a Reader, I want to see attachment upload progress, so that large files give me feedback instead of a frozen UI.
9. As a visitor, I want to create an additional Pad, so that separate topics stay separate.
10. As a creator, I want the Pad's Slug generated automatically as a two-word code, so that I get a short memorable address without inventing one.
11. As a creator, I want to override the generated Slug with my own, so that the address can be meaningful (e.g. a project name).
12. As a creator, I want a clear error when my custom Slug is already taken, so that I can pick another without guessing.
13. As a creator, I want to choose Plain or Encrypted when creating a Pad, so that only sensitive content pays the Key-management price.
14. As a creator, I want to choose the Pad's TTL (hours/days, default 7 days, or no expiry), so that its lifetime matches its purpose.
15. As a creator of an Encrypted Pad, I want a prominent warning and the full Share Link shown exactly once at creation, so that I understand the Key must be saved elsewhere or the Pad is unrecoverable.
16. As a creator, I want to set an optional per-Pad PIN, so that only people I told the PIN can edit and manage the Pad.
17. As a Reader (PIN-protected Pad), I want the Share Link alone to grant read-only access, so that I can consume content without holding write power.
18. As an Editor, I want to delete the Pad before its TTL ends, so that I can clean up early.
19. As an Editor, I want to extend a Pad's TTL, so that a still-active Pad does not expire.
20. As a Reader or Editor, I want Live-Sync, so that the other side's Note edits appear immediately.
21. As an Editor, I want concurrent Note edits merged automatically, so that nobody's keystrokes silently vanish.
22. As a Reader, I want Attachment additions and deletions to appear live in my view, so that the file list never goes stale.
23. As an Editor on an Encrypted Pad, I want my browser to encrypt the Note and every Attachment before upload, so that the server never sees plaintext and I need no extra steps.
24. As a Reader of an Encrypted Pad, I want the Key to live only in the URL fragment, so that the server logs and referrer headers never learn it.
25. As a Reader of an Encrypted Pad, I want downloads decrypted in the browser, so that the file I save is the real file, not ciphertext.
26. As a visitor, I want a local "my pads" list storing Share Links without Keys, so that I can find my Pads again and reopen them (supplying the Key for Encrypted Pads).
27. As a visitor, I want to remove a single entry or clear my local list, so that I control what my browser stores.
28. As an instance operator, I want all limits and behavior configurable via environment variables (instance PIN, TTL default, per-file and global size limits, URL path), so that I can adapt the instance without touching code.
29. As an operator, I want an optional instance PIN to gate creating additional Pads, so that strangers cannot fill my disk on a public instance.
30. As an operator, I want rate limiting always active, so that Slug guessing and upload spam get throttled.
31. As an operator, I want a cleanup job that deletes expired Pads including their blobs, so that storage reclaims itself without manual work.
32. As an operator, I want a global storage limit that rejects uploads when exceeded, so that the instance cannot fill the host disk.
33. As an operator, I want constant-time PIN comparison with lockout after repeated failures, so that PIN brute force fails.
34. As an operator, I want a single Docker image with one data volume, so that deployment is one command and backup is copying the folder.
35. As an operator, I want Encrypted Pads to exist on disk only as ciphertext with no server-side key material, so that a leaked volume reveals nothing.
36. As a visitor, I want dark/light mode and a mobile-friendly layout, so that the tool feels at home on any device.
37. As a visitor opening a Slug that does not exist, I want a clear not-found page, so that I know the Pad is gone rather than the site being broken.

## Implementation Decisions

- **Single process, no database.** One Node.js/TypeScript server (Express-based, matching the DumbWare reference stack) serving the static frontend, the HTTP API, and a WebSocket endpoint. All state lives under one data directory (volume-mounted); a small JSON index maps Slug → Pad (encrypted flag, PIN hash, expiry, blob list, storage usage) and is rewritten atomically on change.
- **Slug model.** The Slug is the only public identifier. Generation picks two words from a bundled word list; a custom Slug overrides it. Uniqueness is enforced at creation (retry/reject). Reserved path segments (API routes) are excluded. The URL path prefix is env-configurable (`PAD_PATH`, default `/p`). The Default Pad sits at the site root.
- **Two-word Slug trade-off (user decision).** Two words were chosen over three for memorability although plain Pads then rely on weaker obscurity (~10^6 combinations) — accepted deliberately, documented in the README's security notes, and mitigated by always-on rate limiting.
- **Encryption (ADR-0001).** Client-side WebCrypto: random 256-bit AES-GCM Key per Encrypted Pad, encoded base64url in the URL fragment. Note content and the Pad's manifest/CRDT state are encrypted as whole blobs; Attachments are encrypted chunk-wise (per-chunk nonce, keys derived from the master Key) so 1 GB files never sit in memory whole. The server stores only ciphertext plus minimal metadata (sizes, blob IDs, timestamps). Key loss is unrecoverable by design; the creation flow enforces the one-time warning.
- **Live-Sync (ADR-0002).** One Yjs document per Pad holds the Note text and the attachment list metadata. Clients connect over WebSocket; the server is a relay — for Encrypted Pads it forwards opaque ciphertext updates, for Plain Pads plaintext updates, merging nothing. Write access is enforced at the relay: submitting updates (Note edits, attachment add/remove) requires the Pad's PIN when one is set; without a PIN the Share Link implies editing. Read-only clients apply incoming updates only.
- **Attachments.** Separate HTTP endpoints for chunked upload and download; blobs live in the Pad's directory. Deleting an Attachment removes the metadata entry (CRDT) and the blob server-side (blob IDs are visible metadata; contents never are).
- **PIN security.** Per-Pad numeric PIN (4–10 digits), constant-time comparison, lockout (5 attempts / 15 minutes, IP-tracked) mirroring the reference apps' behavior; applies to relay writes and management endpoints (early delete, TTL extension).
- **TTL and cleanup.** Expiry is persisted per Pad; a periodic sweep deletes expired Pads with all blobs. TTL is chosen at creation (preset durations plus "never"), bounded by env config; the default is 7 days.
- **Limits and config.** Env: port, base URL, data dir, instance creation PIN (default off), default TTL, per-file limit (default 1 GB), global instance limit (default 10 GB, uploads rejected when exceeded), URL path, rate-limit settings. Everything configurable per instance; rate limiting always on.
- **Frontend.** Vanilla JavaScript + Yjs client, no framework: textarea editor with client-side Markdown rendering in a preview pane, flat attachment list with progress, local "my pads" list (Share Links only — Keys are deliberately never persisted), dark/light theme, responsive layout.
- **Deployment.** Multi-stage Docker build, non-root container user, one data volume; README documents the UID permission gotcha, proxy trust settings, and the Plain-Pad obscurity model.

## Testing Decisions

- **Good tests** exercise external behavior through the agreed seams only — no poking at internal modules, file layouts, or server state.
- **Seam 1 — server API as black box.** HTTP + WebSocket clients in Node drive the real server: Pad creation and Slug rules (generation, custom Slug, collision rejection, reserved words), PIN gating (read-only relay without PIN, writes with it, lockout behavior), TTL sweep deleting expired Pads, per-file and global limits, persistence across a server restart, and the Default Pad's presence and persistence. Two headless Yjs clients against the live server verify Live-Sync convergence and that an Encrypted Pad's traffic and storage contain no plaintext (ciphertext-only on the wire and on disk).
- **Seam 2 — client crypto module (the one new seam).** Pure headless tests over Node's WebCrypto: Key generation and fragment codec round-trip, whole-blob and chunked encrypt/decrypt round-trips, wrong-Key failure, chunk independence (single damaged chunk corrupts only its range).
- **Framework and prior art.** None exists (greenfield) — this spec establishes the pattern: Node's built-in test runner with TypeScript, no additional test framework, keeping the zero-dependency DNA.

## Out of Scope

Accounts or multi-user concepts · Apprise/other notifications · PWA/offline support · Rich-text WYSIWYG editing (ProseMirror) · Folder structures in Attachments (flat list only) · Server-side search or rendering (impossible under Zero-Knowledge) · Pad history/versioning beyond session undo · Importing `.txt` files like dumbpad · Exporting a Pad as a file · Per-Pad storage quotas (global limit only) · Multiple instances per process, clustering, or horizontal scaling · Key backup/recovery mechanisms.

## Further Notes

- Vocabulary is normative: `GLOSSARY.md` defines Pad, Note, Attachment, Slug, Share Link, Key, PIN, Reader, Editor, Encrypted/Plain Pad, Zero-Knowledge, TTL, Live-Sync, Default Pad. Use these terms in tickets, code, and UI copy.
- ADR-0001 (client-side E2E, zero-knowledge) and ADR-0002 (Yjs live-sync with encrypted relay) are binding; do not re-litigate them in tickets without reopening the ADRs.
- The one-time Key warning for Encrypted Pads is a hard UX requirement, not decoration — the local list deliberately stores no Keys.
- Storage note: the same Yjs sync path serves Plain and Encrypted Pads; encryption is a layer, not a fork.
