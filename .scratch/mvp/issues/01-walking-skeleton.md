# 01: Walking Skeleton — server, config, storage, test harness

**What to build:** Opening the site root shows the Default Pad page (empty Note). The server is a single Node/TypeScript process reading all configuration from environment variables, keeping state in one data directory with a JSON index. The `node:test` harness exists and runs the first black-box API smoke test, and a restart does not lose stored data.

**Blocked by:** None (can start immediately).

**Status:** done

- [ ] Opening the site root serves the Default Pad page with an empty Note and no errors
- [ ] All server behavior-relevant settings come from environment variables with documented defaults
- [ ] The data directory and JSON index persist across a server restart (verified by test)
- [ ] The `node:test` harness runs an API smoke test against the server as a black box
- [ ] Malformed requests receive clear JSON errors instead of stack traces
