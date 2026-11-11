# 09: Docker image and documentation

**What to build:** The tool deploys as one Docker image with one data volume: a one-line `docker run` serves a working instance, the container runs non-root, and data survives container replacement. The README documents every environment variable, the security model (Plain Pad obscurity including the two-word Slug trade-off, unrecoverable Key loss for Encrypted Pads), the data-dir ownership gotcha and reverse-proxy trust guidance. A deployment smoke test boots the image and passes the API smoke test against it.

**Blocked by:** 08 (E2E attachments).

**Status:** done

- [ ] A single `docker run` with a data volume serves a working instance
- [ ] The container runs as a non-root user; the documented data-dir ownership avoids the permission error
- [ ] Data in the volume survives container replacement (test)
- [ ] The README documents every environment variable with its default
- [ ] The README documents Plain Pad obscurity (including the two-word Slug trade-off), Key loss for Encrypted Pads, and proxy trust guidance
- [ ] A deployment smoke test boots the image and passes the API smoke test against it
