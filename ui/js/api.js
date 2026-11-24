const tauri = window.__TAURI__ || null;
export const invoke = tauri?.core?.invoke ? (cmd, args) => tauri.core.invoke(cmd, args) : null;
export const listen = tauri?.event?.listen ? (event, handler) => tauri.event.listen(event, handler) : null;
export const hasTauri = !!invoke;
