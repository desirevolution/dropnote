const LIGHT_PROPERTIES =
  "--bg: #f7f8fa; --surface: #ffffff; --fg: #20262e; --muted: #545f6c; --border: #d9dee5; --border-strong: #8b98a8; --panel: #eef1f5; --accent: #305a83; --accent-hover: #244769; --on-accent: #fff; --accent-soft: #e7eff8; --error: #a12636; --positive: #226449;";
const DARK_PROPERTIES =
  "--bg: #181c21; --surface: #20252b; --fg: #e8edf2; --muted: #b3bfcc; --border: #39434e; --border-strong: #788899; --panel: #2a323b; --accent: #9ec2e4; --accent-hover: #bedbf5; --on-accent: #152536; --accent-soft: #283d52; --error: #ff9ca7; --positive: #94d5b2;";

export const THEME_CSS = `
  :root { color-scheme: light; ${LIGHT_PROPERTIES} }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme]) { color-scheme: dark; ${DARK_PROPERTIES} }
  }
  :root[data-theme="dark"] { color-scheme: dark; ${DARK_PROPERTIES} }
  :root[data-theme="light"] { color-scheme: light; ${LIGHT_PROPERTIES} }
`;

/** Applies a saved theme choice before first paint, so there is no flash. */
export const THEME_RESTORE_SCRIPT = `
  try {
    var theme = localStorage.getItem("theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (e) { /* storage unavailable — follow prefers-color-scheme */ }`;
