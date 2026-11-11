# 07: Encrypted Pads — crypto core and E2E sync

**What to build:** Creating a Pad can choose "Encrypted": the browser generates a Key, encrypts Note and Pad state client-side (ADR-0001), and only ciphertext reaches the server, which relays it unreadable (encrypted relay). Creation shows a prominent one-time warning and the full Share Link exactly once; the Key lives only in the URL fragment; reopening from the local list prompts for the Key. The crypto module is the project's second test seam.

**Blocked by:** 02 (Live-Sync on the Default Pad), 04 (Additional Pads — Slugs, creation UI, TTL).

**Status:** done

- [ ] Creating an Encrypted Pad shows the one-time warning and the full Share Link exactly once
- [ ] The Key exists only in the URL fragment; the server never receives it (test)
- [ ] Note edits sync live between two clients of an Encrypted Pad through ciphertext the server cannot read (test)
- [ ] On-disk storage of an Encrypted Pad contains no plaintext (test)
- [ ] Opening an Encrypted Pad from the local list prompts for the Key
- [ ] Crypto module tests: key generation and fragment codec round-trip, encrypt/decrypt round-trip, wrong-Key failure
- [ ] Plain Pads keep working unchanged (regression test)
