# 06: Instance hardening — creation PIN and rate limiting

**What to build:** The instance operator can require a PIN (environment variable, default off) for *creating* Pads, so a public instance cannot be filled by strangers; reading and editing existing Pads never requires it. Rate limiting is always on and throttles Slug guessing, creation attempts and upload bursts.

**Blocked by:** 03 (Attachments), 04 (Additional Pads — Slugs, creation UI, TTL).

**Status:** done

- [ ] With the instance PIN set, creating a Pad requires it; unset (default) allows open creation (test)
- [ ] Reading and editing existing Pads never requires the instance PIN
- [ ] Repeated Slug guesses and creation attempts get rate-limited (test)
- [ ] Upload bursts get rate-limited (test)
- [ ] All gates and limits remain env-configurable
