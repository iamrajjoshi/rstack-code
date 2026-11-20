// rstack-code: the fork's own identity on a machine, so it installs and runs beside T3 Code
// without opening its data or answering its links.

/** The product name in untranslated server and CLI messages. Translated strings keep their own. */
export const PRODUCT_NAME = "rstack code";

/** The default T3 home, under the user's home directory. `T3CODE_HOME` still overrides it. */
export const DEFAULT_T3_HOME_DIRECTORY_NAME = ".rstack";

/** T3 Code's own default home. Dev tooling treats it as live data too, never as a sandbox. */
export const UPSTREAM_T3_HOME_DIRECTORY_NAME = ".t3";

export const DESKTOP_APP_SCHEME = "rstackcode";
export const DESKTOP_APP_DEVELOPMENT_SCHEME = "rstackcode-dev";

/**
 * The Linux desktop entry and Wayland app id. Development appends `.Development`. The GNOME
 * snapshot extension allowlists `<id>.SnapShot` in apps/desktop/gnome-extension/captureService.js.
 */
export const LINUX_DESKTOP_APP_ID = "com.iamrajjoshi.RstackCode";

/** Matches the desktop app's URL scheme on any channel, such as `rstackcode:` or `rstackcode-dev:`. */
export const APP_LINK_PROTOCOL = /^rstackcode(?:-[a-z]+)?:$/;
