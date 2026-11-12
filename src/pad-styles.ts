export const PAD_CSS = `
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 1rem/1.5 system-ui, sans-serif; }
  a { color: var(--accent); }
  button, input, select, textarea { font: inherit; color: inherit; }
  button, .file-action {
    display: inline-flex; justify-content: center; align-items: center; gap: .4rem;
    min-height: 2.5rem; padding: .45rem .8rem; border: 1px solid var(--border);
    border-radius: .25rem; background: var(--surface); color: var(--fg);
    font-size: .875rem; font-weight: 600; cursor: pointer; text-decoration: none;
  }
  button:hover:not(:disabled), .file-action:hover { background: var(--panel); }
  button:disabled { opacity: .55; cursor: default; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
  .primary:hover:not(:disabled) { background: var(--accent-hover); }

  .topbar { background: var(--surface); border-bottom: 1px solid var(--border); }
  .topbar-inner, main { width: min(76rem, calc(100% - 4rem)); margin-inline: auto; }
  .topbar-inner { display: flex; align-items: center; justify-content: space-between; gap: .75rem; min-height: 3.5rem; }
  .brand { display: inline-flex; align-items: center; gap: .6rem; color: var(--fg); font-weight: 700; text-decoration: none; white-space: nowrap; }
  .brand-mark { display: inline-flex; color: var(--muted); }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  .account-name { max-inline-size: 10rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-inline: .35rem; font-size: .875rem; }
  .topbar button:not(.primary), .quiet { background: transparent; border-color: transparent; }
  .icon-button { width: 2.5rem; padding: .4rem; }
  svg { width: 1.05rem; height: 1.05rem; flex: none; }
  .theme-sun, [data-theme="dark"] .theme-moon { display: none; }
  [data-theme="dark"] .theme-sun { display: block; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme]) .theme-moon { display: none; }
    :root:not([data-theme]) .theme-sun { display: block; }
  }

  main { padding-block: 1.5rem 2rem; }
  .pad-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .75rem 1rem; margin-bottom: 1.35rem; }
  .pad-head.compact { margin-bottom: .85rem; }
  .pad-head.compact .pad-meta { margin-top: 0; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  h1, h2, p { margin: 0; }
  h1 { font-size: clamp(1.45rem, 3.5vw, 1.9rem); line-height: 1.2; letter-spacing: -.02em; overflow-wrap: anywhere; }
  h2 { font-size: 1.05rem; letter-spacing: -.015em; }
  .pad-meta { display: flex; flex-wrap: wrap; gap: .35rem .75rem; margin-top: .55rem; color: var(--muted); font-size: .84rem; }
  .pad-mode { display: inline-flex; align-items: center; gap: .4rem; }
  .pad-mode svg { width: .9rem; height: .9rem; }
  .pad-mode.encrypted { color: var(--accent); font-weight: 650; }
  #expires-at { border-inline-start: 1px solid var(--border); padding-inline-start: .75rem; }

  .workspace-toolbar, .workspace-tabs, .transfer-notice { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .6rem; }
  .workspace-toolbar { justify-content: space-between; margin-bottom: .75rem; }
  .workspace-actions { gap: .25rem; }
  .workspace-tabs [role="tab"][aria-selected="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .transfer-notice { justify-content: space-between; padding: .25rem .6rem; margin-bottom: .65rem; background: var(--panel); border-radius: .25rem; font-size: .875rem; }
  .card, .access-panel { min-width: 0; background: var(--surface); border: 1px solid var(--border); border-radius: .375rem; }
  .note-card { overflow: hidden; }
  #note .cm-editor { height: clamp(22rem, 64vh, 52rem); background: var(--surface); }
  #note .cm-scroller { font: .96rem/1.65 ui-monospace, "DejaVu Sans Mono", monospace; }
  #note .cm-content { padding: 1rem 1.1rem; caret-color: var(--fg); }
  #note .cm-line { padding: 0; }
  #note .cm-focused { outline: 2px solid var(--accent); outline-offset: -2px; }
  #note .cm-placeholder { color: var(--muted); }
  .remote-cursor { display: inline; position: relative; border-left: 2px solid var(--cursor); margin-inline: -1px; pointer-events: none; }
  .remote-cursor-name { position: absolute; z-index: 1; inset-block-end: 100%; inset-inline-start: -2px; max-inline-size: 10rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--surface); color: var(--fg); border: 1px solid var(--cursor); border-radius: 3px; padding: 0 .25rem; font: 600 .7rem/1.2 system-ui, sans-serif; }
  .remote-cursor::before { content: ""; position: absolute; top: -.1em; left: -2px; width: 5px; height: 4px; background: var(--cursor); border-radius: 1px; }
  .workspace-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .3rem 1rem; min-height: 2.65rem; align-items: center; padding: .45rem 0; color: var(--muted); font-size: .8rem; }
  #note-copy-status:empty { display: none; }
  #note-copy-status { color: var(--muted); font-size: .8rem; }
  #sync-status { display: inline-flex; align-items: center; gap: .45rem; }
  #sync-status::before { content: ""; width: .48rem; height: .48rem; border-radius: 50%; background: currentColor; }
  #sync-status[data-state="live"] { color: var(--positive); }
  #sync-status[data-state="error"] { color: var(--error); }

  .files-body { padding: clamp(.75rem, 2.5vw, 1.5rem); }
  .drop-zone {
    width: 100%; min-height: clamp(8rem, 20vh, 11rem); display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: .25rem; padding: 1rem; margin-bottom: 1.25rem;
    border: 1px dashed var(--border-strong); border-radius: .45rem; background: var(--panel);
  }
  .drop-zone svg { width: 1.4rem; height: 1.4rem; color: var(--accent); margin-bottom: .25rem; }
  .drop-zone-title { font-size: 1rem; }
  .drop-zone-hint, .files-empty { color: var(--muted); font-size: .875rem; font-weight: 400; }
  .drop-zone:hover:not(:disabled), .drop-zone.is-dragging { border-color: var(--accent); background: var(--accent-soft); }
  .drop-zone.is-dragging { outline: 2px solid var(--accent); outline-offset: -2px; }
  .files-empty { padding: .5rem 0; text-align: center; }
  #attachments, #attachment-uploads, #my-pads-list, .account-list { list-style: none; margin: 0; padding: 0; }
  #attachments { display: grid; gap: .65rem; }
  #attachments li {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
    gap: .75rem 1rem; min-height: 5.5rem; padding: .85rem 1rem; border: 1px solid var(--border); border-radius: .375rem;
  }
  #attachment-uploads li {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(2.5rem, 4rem) auto; align-items: center;
    gap: .3rem; padding: .6rem .1rem; border-bottom: 1px solid var(--border);
  }
  .file-info { min-width: 0; }
  .attachment-name { display: block; font-weight: 600; overflow-wrap: anywhere; }
  .attachment-size { display: block; color: var(--muted); font-size: .85rem; overflow-wrap: anywhere; }
  .file-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: .4rem; }
  #attachment-uploads:not(:empty) { margin-bottom: .65rem; }
  #attachment-uploads progress { width: 100%; accent-color: var(--accent); }
  .file-action { min-height: 2.75rem; padding-inline: .8rem; }
  .file-download { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
  .file-remove:hover:not(:disabled) { color: var(--error); }
  .attachment-error, .form-error, #sync-error { color: var(--error); font-size: .875rem; margin-top: .6rem; overflow-wrap: anywhere; }
  #sync-error { margin: 0 0 1rem; }
  #copy-status:not(:empty) { font-size: .84rem; color: var(--muted); }

  .access-panel { padding: 1rem; margin-bottom: 1rem; }
  .access-panel p { margin-top: .35rem; }
  .access-panel form { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-top: .75rem; }
  #key-input { width: min(100%, 25rem); }
  #pin-input { width: 9rem; }
  input:not([type="checkbox"]), select {
    min-width: 0; min-height: 2.5rem; background: var(--surface); border: 1px solid var(--border-strong); border-radius: .45rem; padding: .4rem .6rem;
  }

  dialog { width: min(30rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); border: 1px solid var(--border); border-radius: .375rem; padding: 1.15rem; background: var(--surface); color: var(--fg); }
  dialog::backdrop { background: rgb(20 15 19 / 56%); }
  .dialog-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .75rem; }
  dialog h2 { font-size: 1.25rem; }
  dialog p { font-size: .9rem; color: var(--muted); }
  dialog .form-error { color: var(--error); }
  .dialog-actions { display: flex; flex-wrap: wrap; gap: .5rem; justify-content: flex-end; margin-top: 1rem; }
  #new-pad-form { display: grid; gap: .8rem; }
  #new-pad-form label { display: grid; gap: .3rem; font-size: .875rem; font-weight: 600; }
  #new-pad-form .new-pad-encrypted { display: flex; align-items: flex-start; gap: .6rem; padding: .65rem; background: var(--panel); border-radius: .45rem; }
  .new-pad-encrypted input { accent-color: var(--accent); margin: .3rem 0 0; }
  .new-pad-encrypted small { display: block; font-weight: 400; color: var(--muted); }
  #one-time-link { width: min(40rem, calc(100vw - 2rem)); }
  #one-time-link-url { width: 100%; margin-top: .75rem; font-family: ui-monospace, monospace; }
  #my-pads-list, .account-list { max-height: 45vh; overflow-y: auto; }
  #my-pads-list li, .account-list li { display: flex; align-items: center; justify-content: space-between; gap: .5rem; border-bottom: 1px solid var(--border); padding: .4rem .25rem; }
  .account-list li > :first-child { min-width: 0; overflow-wrap: anywhere; }
  #my-pads-list a { overflow-wrap: anywhere; }

  .pad-menu { position: relative; }
  .pad-menu summary { display: grid; place-items: center; min-width: 2.5rem; min-height: 2.5rem; list-style: none; border: 1px solid var(--border); border-radius: .25rem; background: var(--surface); cursor: pointer; }
  .pad-menu summary::-webkit-details-marker { display: none; }
  .menu-items { position: absolute; z-index: 3; inset-inline-end: 0; top: calc(100% + .4rem); width: max-content; max-width: calc(100vw - 2rem); padding: .3rem; border: 1px solid var(--border); border-radius: .25rem; background: var(--surface); box-shadow: 0 .2rem .65rem rgb(0 0 0 / 12%); }
  .menu-items button, .menu-items a { display: flex; justify-content: flex-start; width: 100%; border: 0; padding: .45rem .7rem; font-size: .875rem; color: var(--fg); }
  .menu-items a { text-decoration: none; border-radius: .25rem; }
  .menu-items a:hover { background: var(--panel); }
  .menu-items .danger { color: var(--error); }
  .pad-notice { color: var(--muted); margin-bottom: .75rem; }
  #start-pad-marker { color: var(--accent); }
  .access-panel .passphrase-form { display: grid; justify-items: start; }
  .passphrase-form label:first-child { display: grid; gap: .25rem; width: min(100%, 25rem); }
  .checkbox-field { display: flex; align-items: center; gap: .35rem; }
  .pin-form { display: flex; flex-wrap: wrap; gap: .5rem; }
  .advanced-options { border: 1px solid var(--border); border-radius: .45rem; padding: .55rem .65rem; }
  .advanced-options summary { cursor: pointer; font-size: .875rem; }
  .advanced-options label { margin-top: .6rem; }
  #new-pad-form small { font-weight: 400; color: var(--muted); }
  #ttl-form label { display: grid; gap: .3rem; }
  #pad-qr { display: block; max-width: 100%; height: auto; margin: 0 auto .8rem; border-radius: .3rem; }
  #pad-qr-link { display: block; margin-bottom: .4rem; overflow-wrap: anywhere; font-size: .875rem; }
  #image-dialog { width: min(58rem, calc(100vw - 2rem)); }
  #image-title { overflow-wrap: anywhere; }
  #full-image { display: block; width: 100%; max-height: 67dvh; object-fit: contain; }
  #image-copy-status { align-self: center; margin-inline-end: auto; }
  #image-copy-status:empty { display: none; }
  .with-thumbnail { display: flex; align-items: center; gap: .85rem; }
  .file-description { min-width: 0; }
  .thumbnail-button { flex: none; padding: .2rem; width: 4.5rem; height: 3.75rem; overflow: hidden; background: var(--panel); }
  .thumbnail-button img { width: 100%; height: 100%; object-fit: contain; }
  .transfer-error { color: var(--error); font-size: .78rem; overflow-wrap: anywhere; }
  #attachment-uploads li.transfer-failed { grid-template-columns: minmax(0, 1fr) auto auto; }
  .my-pad-detail { display: block; color: var(--muted); font-size: .8rem; }
  #my-pads-list .my-pad-info { min-width: 0; }

  @media (max-width: 46rem) {
    .topbar-inner, main { width: calc(100% - 2rem); }
    main { padding-top: 1.25rem; }
    #note .cm-editor { height: clamp(13rem, 42vh, 27rem); }
  }
  @media (max-width: 34rem) {
    #attachments li { grid-template-columns: minmax(0, 1fr); }
  }
  @media (pointer: coarse) {
    .drop-zone-hint { display: none; }
  }
  @media (max-width: 26rem) {
    .topbar-inner { flex-wrap: wrap; padding-block: .6rem; }
    .topbar-inner .actions { margin-inline-start: auto; }
    .topbar .actions { gap: .15rem; }
    .account-name { max-inline-size: 5rem; }
    .topbar .actions button { padding-inline: .45rem; }
  }
`;
