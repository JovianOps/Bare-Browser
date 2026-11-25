export const HOME_URL = "nadir://newtab";
export const HISTORY_LIMIT = 500;
export const defaultSettings = { defaultSearchEngine: "duckduckgo", customSearchUrl: "", startupBehavior: "newtab", theme: "dark", downloadPath: "", httpsFirst: true, trackerBlocking: false };

export function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
export function normalizeUrl(url) { return (url || "").trim(); }
export function dayKey(ts) { return new Date(ts || Date.now()).toISOString().slice(0,10); }
export function dayLabel(key) {
  const today = new Date(); const y = new Date(today); y.setDate(today.getDate()-1);
  const tk = today.toISOString().slice(0,10), yk = y.toISOString().slice(0,10);
  if (key === tk) return "Today"; if (key === yk) return "Yesterday"; return key;
}
export function displayTitle(tab) {
  if (!tab) return "New Tab";
  if (tab.title && tab.title !== tab.url) return tab.title;
  try { return new URL(tab.url).host || tab.url || "New Tab"; } catch { return tab.url || "New Tab"; }
}
export function searchUrl(query, settings) {
  const q = encodeURIComponent(query);
  const s = settings || defaultSettings;
  const tpl = { google: "https://www.google.com/search?q=%s", brave: "https://search.brave.com/search?q=%s", startpage: "https://www.startpage.com/sp/search?query=%s", kagi: "https://kagi.com/search?q=%s" }[s.defaultSearchEngine]
    || (s.defaultSearchEngine === "custom" && s.customSearchUrl ? s.customSearchUrl : "https://duckduckgo.com/?q=%s");
  return tpl.replace("%s", q);
}
export function parseInput(input, settings) {
  const v = (input || "").trim();
  if (!v) return HOME_URL;
  try { const u = new URL(v); if (["http:", "https:", "nadir:"].includes(u.protocol)) return u.toString(); } catch {}
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(v) && !v.includes(" ")) return "https://" + v;
  return searchUrl(v, settings);
}
