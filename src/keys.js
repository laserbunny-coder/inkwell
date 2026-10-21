// Shortcut labels are written with Mac symbols; on Windows, Linux and Android
// they read as Ctrl, Alt and Shift instead.
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const keyLabel = (t) => (isMac || !t ? t : t.replaceAll('⌘', 'Ctrl+').replaceAll('⌥', 'Alt+').replaceAll('⇧', 'Shift+'));
