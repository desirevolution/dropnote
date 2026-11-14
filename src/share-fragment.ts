// Consume the fragment before loading the editor or initiating requests.
export const SHARE_FRAGMENT_SCRIPT = `
  (() => {
    if (!location.hash.startsWith("#passphrase=")) return;
    let secret = new URLSearchParams(location.hash.slice(1)).get("passphrase");
    history.replaceState(history.state, "", location.pathname + location.search);
    window.takeOpeningPassphrase = () => {
      const value = secret;
      secret = null;
      delete window.takeOpeningPassphrase;
      return value;
    };
  })();`;


export const STRIP_SHARE_FRAGMENT_SCRIPT = `
  if (location.hash.startsWith("#passphrase=")) {
    history.replaceState(history.state, "", location.pathname + location.search);
  }`;
