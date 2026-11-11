# 02: Live-Sync on the Default Pad

**What to build:** Two people open the Default Pad at the site root and see each other's Note edits immediately; concurrent edits merge so nobody's keystrokes vanish; content survives a restart. Editing is a textarea with live Markdown preview beside it. This establishes the Yjs-over-WebSocket relay path (ADR-0002) that every later ticket builds on.

**Blocked by:** 01 (walking skeleton).

**Status:** done

- [ ] Two simultaneous browser sessions see each other's Note edits live on the Default Pad
- [ ] Concurrent edits merge automatically without losing text from either side
- [ ] Note content survives a server restart (verified by test)
- [ ] Two headless Yjs clients against the live server converge to the same state (integration test)
- [ ] The Markdown preview renders beside the editor while typing
- [ ] Plain-Pad sync traffic contains no server-side merging logic (relay only)
