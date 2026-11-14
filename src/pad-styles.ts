export const PAD_CSS = `
  @font-face { font-family: "IBM Plex Mono"; src: url("/fonts/IBMPlexMono-Regular.woff2") format("woff2"); font-style: normal; font-weight: 400; font-display: swap; }
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
  .topbar-inner, main { width: calc(100% - 4rem); margin-inline: auto; }
  .topbar-inner { display: flex; align-items: center; justify-content: space-between; gap: .75rem; min-height: 3.5rem; }
  .brand { display: inline-flex; align-items: center; gap: .6rem; color: var(--fg); font-weight: 700; text-decoration: none; white-space: nowrap; }
  .brand-group { display: flex; align-items: baseline; flex-wrap: wrap; gap: .25rem .6rem; min-width: 0; }
  .release-version { font-size: .75rem; color: var(--muted); overflow-wrap: anywhere; }
  .home-link { display: inline-flex; align-items: center; gap: .4rem; padding: .45rem .65rem; color: var(--fg); text-decoration: none; font-size: .875rem; font-weight: 600; border-radius: .25rem; min-height: 2.5rem; }
  .home-link:hover, .home-link[aria-current="page"] { background: var(--panel); }
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
  .note-card { overflow: hidden; isolation: isolate; }
  #note .cm-editor { height: min(clamp(22rem, 64vh, 52rem), var(--note-visible-height, 100vh)); background: var(--surface); }
  #note[data-font-size="small"] { --note-font-size: .84rem; }
  #note[data-font-size="large"] { --note-font-size: 1.15rem; }
  #note .cm-scroller { font: var(--note-font-size, .96rem)/1.65 "IBM Plex Mono", ui-monospace, "DejaVu Sans Mono", monospace; }
  #note .cm-content { align-self: stretch; padding: 1rem 1.1rem; caret-color: var(--fg); }
  #note .cm-line { padding: 0; }
  .note-card:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
  #note .cm-editor.cm-focused, #note .cm-content:focus-visible { outline: none; }
  #note .cm-placeholder { color: var(--muted); }
  .remote-cursor { display: inline; position: relative; border-left: 2px solid var(--cursor); margin-inline: -1px; pointer-events: none; }
  .remote-cursor-name { position: absolute; z-index: 1; inset-block-end: 100%; inset-inline-start: -2px; max-inline-size: 10rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--surface); color: var(--fg); border: 1px solid var(--cursor); border-radius: 3px; padding: 0 .25rem; font: 600 .7rem/1.2 system-ui, sans-serif; }
  .remote-cursor::before { content: ""; position: absolute; top: -.1em; left: -2px; width: 5px; height: 4px; background: var(--cursor); border-radius: 1px; }
  .workspace-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .3rem 1rem; min-height: 2.65rem; align-items: center; padding: .45rem 0; color: var(--muted); font-size: .8rem; }
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
  #new-pad-dialog, #pad-qr-dialog, #space-access-dialog { width: min(34rem, calc(100vw - 2rem)); }
  #space-access-requests { margin-block-end: 1rem; }
  #space-access-requests h3 { margin: 0 0 .5rem; font-size: 1rem; }
  #space-access-request-list li { display: grid; gap: .45rem; padding: .6rem 0; }
  .request-actions { display: flex; flex-wrap: wrap; gap: .4rem; }
  #space-access-form { display: grid; gap: .7rem; }
  #space-access-form label { display: grid; gap: .25rem; }
  #space-access-form button { justify-self: start; }
  #space-access-status { margin-block: .65rem; }
  #space-access-status:empty { margin: 0; }
  .access-toast { position: fixed; z-index: 10; inset-inline-end: 1rem; inset-block-start: 1rem; display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; max-inline-size: calc(100vw - 2rem); padding: .65rem; background: var(--surface); border: 1px solid var(--accent); border-radius: .35rem; box-shadow: 0 .25rem 1rem #0003; }
  .request-count { min-inline-size: 1.4em; padding-inline: .25em; border-radius: 1em; background: var(--accent); color: var(--on-accent); text-align: center; }
  #my-pads-list, .account-list { max-height: 45vh; overflow-y: auto; }
  #my-pads-list li, .account-list li { display: flex; align-items: center; justify-content: space-between; gap: .5rem; border-bottom: 1px solid var(--border); padding: .4rem .25rem; }
  .shared-spaces { margin-block-start: 1rem; border-top: 1px solid var(--border); }
  .shared-spaces h3 { font-size: 1rem; margin-block: .75rem .25rem; }
  #owned-spaces-list li, #shared-spaces-list li { flex-wrap: wrap; }
  #owned-spaces-list li .my-pad-detail, #shared-spaces-list li .my-pad-detail { flex-basis: 100%; order: 1; }
  #owned-spaces-list li .my-pad-detail:empty { display: none; }
  .account-list li > :first-child { min-width: 0; overflow-wrap: anywhere; }
  #my-pads-list a { overflow-wrap: anywhere; }

  .pad-menu { position: relative; }
  .pad-menu summary { display: grid; place-items: center; min-width: 2.5rem; min-height: 2.5rem; list-style: none; border: 1px solid var(--border); border-radius: .25rem; background: var(--surface); cursor: pointer; }
  .pad-menu summary::-webkit-details-marker { display: none; }
  .menu-items { position: absolute; z-index: 3; inset-inline-end: 0; top: calc(100% + .4rem); width: max-content; max-width: calc(100vw - 2rem); padding: .3rem; border: 1px solid var(--border); border-radius: .25rem; background: var(--surface); box-shadow: 0 .2rem .65rem rgb(0 0 0 / 12%); }
  .menu-items button, .menu-items a { display: flex; justify-content: flex-start; width: 100%; border: 0; padding: .45rem .7rem; font-size: .875rem; color: var(--fg); }
  .menu-items a { text-decoration: none; border-radius: .25rem; }
  .menu-items a:hover { background: var(--panel); }
  .menu-items .danger, #owned-spaces-list .danger { color: var(--error); }
  .pad-notice { color: var(--muted); margin-bottom: .75rem; }
  .start-marker { display: inline-flex; align-items: center; gap: .3rem; width: fit-content; padding: .15rem .4rem; color: var(--accent); background: var(--accent-soft); border-radius: .25rem; font-size: .8rem; font-weight: 600; }
  .start-marker svg { width: .85rem; height: .85rem; }
  .menu-items hr { border: 0; border-top: 1px solid var(--border); margin: .25rem 0; }
  #note-view summary { display: flex; gap: .4rem; padding: .45rem .65rem; }
  #note-view .menu-items label { padding: .4rem .55rem; cursor: pointer; }
  #note-view .editor-font-option { display: grid; gap: .25rem; }
  #note-view input { accent-color: var(--accent); }
  #note-tools #undo-note, #note-tools #redo-note { padding-inline: .6rem; }
  #note-clipboard-status { min-height: 1.5em; margin: .25rem .75rem 0; color: var(--muted); font-size: .875rem; }
  #password-groups { display: block; color: var(--muted); margin-top: .5rem; font: .875rem ui-monospace, monospace; }
  #note .cm-gutters { background: var(--panel); color: var(--muted); border-color: var(--border); }
  #note .cm-lineNumbers .cm-gutterElement { padding-inline: .55rem; }
  #note .cm-gutters .cm-gutter { padding-block: 1rem; }
  .passphrase-actions { margin-top: .4rem; }
  #new-pad-expiry-summary { margin-inline-start: .5rem; color: var(--muted); }
  #share-secret-options { margin-bottom: .8rem; }
  #share-secret-warning { color: var(--muted); }
  #qr-status:empty { display: none; }
  .access-panel .passphrase-form { display: grid; justify-items: start; }
  .passphrase-form label:first-child { display: grid; gap: .25rem; width: min(100%, 25rem); }
  .checkbox-field { display: flex; align-items: center; gap: .35rem; }
  .pin-form { display: flex; flex-wrap: wrap; gap: .5rem; }
  .advanced-options { border: 1px solid var(--border); border-radius: .45rem; padding: .55rem .65rem; }
  .advanced-options summary { cursor: pointer; font-size: .875rem; }
  #new-pad-url-preview { overflow-wrap: anywhere; }
  .advanced-options label { margin-top: .6rem; }
  #new-pad-form small { font-weight: 400; color: var(--muted); }
  #ttl-form label { display: grid; gap: .3rem; }
  #pad-qr { display: block; width: min(280px, 100%); height: auto; margin: 0 auto .8rem; border-radius: .3rem; }
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
  .shared-space-entry { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .4rem; padding: .65rem .25rem; border-bottom: 1px solid var(--border); }
  .my-pad-detail { display: block; color: var(--muted); font-size: .8rem; }
  #my-pads-list .my-pad-info { min-width: 0; }

  @media (max-width: 46rem) {
    .topbar-inner, main { width: calc(100% - 2rem); }
    main { padding-top: 1.25rem; }
    #note .cm-editor { height: min(clamp(13rem, 42vh, 27rem), var(--note-visible-height, 100vh)); }
  }
  @media (max-width: 34rem) {
    .workspace-actions, #note-tools { width: 100%; }
    #note-tools { position: relative; column-gap: .25rem; }
    #note-view { position: static; }
    #note-view .menu-items { max-width: 100%; }
    #attachments li { grid-template-columns: minmax(0, 1fr); }
  }
  @media (pointer: fine) {
    body { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; }
    main, .workspace { display: flex; flex: 1 0 auto; flex-direction: column; }
    .note-card, #note { display: flex; flex: 1 1 auto; flex-direction: column; }
    #note .cm-editor { flex: 1 1 auto; height: auto; min-height: 13rem; contain: size; }
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
