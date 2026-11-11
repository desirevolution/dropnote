# 08: E2E attachments

**What to build:** Attachments on Encrypted Pads are encrypted chunk-wise in the browser before any byte is uploaded, so even large files never sit whole in memory; downloads are decrypted in the browser back to the original bytes, with upload progress as usual. The server sees only ciphertext.

**Blocked by:** 03 (Attachments), 07 (Encrypted Pads — crypto core and E2E sync).

**Status:** done

- [ ] Uploading an Attachment to an Encrypted Pad encrypts it chunk-wise in the browser before upload
- [ ] Downloading decrypts to the original bytes in the browser
- [ ] A 1 GB-class file uploads without being held wholly in memory
- [ ] The server stores only ciphertext for encrypted attachments (test)
- [ ] A wrong Key fails downloads with a clear error, not corrupt output (test)
- [ ] A single damaged chunk corrupts only its own range, not the file (test)
