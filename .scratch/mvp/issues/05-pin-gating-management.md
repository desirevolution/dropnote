# 05: PIN — edit gating and management

**What to build:** A Pad can be created with an optional 4–10 digit PIN. Without a PIN the Share Link implies editing; with a PIN, a Share Link alone grants read-only (the relay rejects submitted updates) and entering the PIN unlocks editing plus management: deleting the Pad early and extending its TTL. PIN checks are constant-time with a lockout after repeated failures.

**Blocked by:** 04 (Additional Pads — Slugs, creation UI, TTL).

**Status:** done

- [ ] Creating a Pad can set an optional 4–10 digit PIN
- [ ] With a PIN set, a Share Link alone grants read-only: relay rejects submitted updates (test)
- [ ] Entering the PIN unlocks editing, early deletion and TTL extension
- [ ] PIN comparison is constant-time; 5 failed attempts lock the client IP out for 15 minutes (test)
- [ ] Management endpoints (early delete, TTL extend) require the PIN (test)
