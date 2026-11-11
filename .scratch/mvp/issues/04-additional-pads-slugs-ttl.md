# 04: Additional Pads — Slugs, creation UI, TTL

**What to build:** A button in the UI creates an additional Pad: the Slug is generated as a two-word code or overridden with a custom word (uniqueness-checked, reserved names rejected), the TTL is chosen at creation (default 7 days, or "never"), and the Pad opens at its own URL under the configurable path prefix. Expired Pads are deleted by a cleanup sweep including their attachments. A local "my pads" list keeps Share Links (without Keys) for finding Pads again; unknown Slugs show a not-found page.

**Blocked by:** 02 (Live-Sync on the Default Pad).

**Status:** done

- [ ] Creating a Pad generates a two-word Slug and opens its Share Link
- [ ] A free custom Slug is accepted; a taken one is rejected with a clear error
- [ ] Reserved route names cannot be used as Slug
- [ ] Pad URLs live under the env-configurable path prefix
- [ ] TTL is chosen at creation with the 7-day default and a "never" option
- [ ] The cleanup sweep deletes expired Pads including their attachments (test)
- [ ] A nonexistent Slug shows a not-found page
- [ ] The local "my pads" list stores Share Links without Keys, with per-entry removal and clear-all
- [ ] Additional Pads sync and persist like the Default Pad (test reusing the Live-Sync path)
