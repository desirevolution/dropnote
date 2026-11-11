# 03: Attachments for Pads

**What to build:** Anyone on a Pad can attach files and remove them again: upload shows progress, the other side's file list updates live, downloads deliver the original bytes, and deletion removes the file for everyone. Per-file and global instance limits reject oversized uploads with clear errors.

**Blocked by:** 02 (Live-Sync on the Default Pad).

**Status:** done

- [ ] Uploading a file shows progress and adds it to the Pad's flat attachment list
- [ ] Attachment additions and deletions appear live in the other side's view
- [ ] Downloading an Attachment delivers the original file bytes
- [ ] Deleting an Attachment removes it for everyone and frees storage
- [ ] Uploads above the per-file limit are rejected with a clear error (test)
- [ ] Uploads that would exceed the global instance limit are rejected with a clear error (test)
- [ ] Upload, download, delete and limit behavior is covered by black-box tests
