# Live editing with Yjs and an opaque relay

The editor uses CodeMirror bound to a shared Yjs document. The WebSocket relay sends persisted updates and forwards new updates without interpreting their contents. Encrypted Pads use the same protocol with encrypted updates. The relay acknowledges writes after appending to the update log, and a client can retry an unacknowledged Yjs update after reconnecting. The editor and file mutation actions stay read-only until replay has finished and the relay confirms write access.

Presence messages carry relative Yjs positions for live cursors. They are forwarded separately from document updates and exist only while a client is connected. Encrypted Pads seal these messages under a separate derived key. Cursor positions never enter the document log.
