import { HOME_URL, HISTORY_LIMIT, defaultSettings, uid, normalizeUrl, dayKey, dayLabel, displayTitle, searchUrl, parseInput } from "./js/utils.js";
import { invoke, listen } from "./js/api.js";

  "use strict";

  const $ = (id) => document.getElementById(id);
  const tabsEl = $("tabs"), newTabBtn = $("new-tab-btn"), backBtn = $("back-btn"), forwardBtn = $("forward-btn");
  const reloadBtn = $("reload-btn"), homeBtn = $("home-btn"), addressForm = $("address-form"), addressInput = $("address-input");
  const bookmarkBtn = $("bookmark-btn"), bookmarksToggleBtn = $("bookmarks-toggle-btn"), sidebar = $("sidebar");
  const appEl = $("app"), sidebarCloseBtn = $("sidebar-close-btn"), sidebarTabs = Array.from(document.querySelectorAll(".sidebar-tab"));
  const bookmarksPanel = $("bookmarks-panel"), historyPanel = $("history-panel"), bookmarksList = $("bookmarks-list");
  const historyList = $("history-list"), clearBrowsingDataBtn = $("clear-browsing-data-btn");
  const importBookmarksBtn = $("import-bookmarks-btn"), exportBookmarksBtn = $("export-bookmarks-btn");
  const contentArea = $("content-area"), emptyState = $("empty-state"), progressBar = $("progress-bar");
  const securityBadge = $("security-badge"), contextMenu = $("tab-context-menu"), omnibox = $("omnibox");
  const bookmarksBar = $("bookmarks-bar"), historySearch = $("history-search");
  const downloadsList = $("downloads-list"), settingsSaveBtn = $("settings-save-btn");
  const findBar = $("find-bar"), findInput = $("find-input"), findCount = $("find-count"), findPrev = $("find-prev"), findNext = $("find-next"), findClose = $("find-close");
  const settingSearchEngine = $("setting-search-engine"), settingCustomSearch = $("setting-custom-search"), settingStartup = $("setting-startup"), settingTheme = $("setting-theme"), settingDownloadPath = $("setting-download-path"), settingHttpsFirst = $("setting-https-first"), settingTrackerBlocking = $("setting-tracker-blocking");
  const permPrompt = $("permission-prompt"), permTitle = $("permission-title"), permBody = $("permission-body"), permAllow = $("permission-allow"), permDeny = $("permission-deny");

  function getActiveTab() { return state.tabs.find((t) => t.label === state.activeTab) || null; }
  function setEmptyStateVisible(v) { emptyState.classList.toggle("hidden", !v); }

  const state = {
    tabs: [], activeTab: null,
    bookmarks: [], history: [], settings: { ...defaultSettings },
    sitePermissions: [],
    sidebarOpen: false, sidebarPanel: "bookmarks-panel",
    contextTab: null, bookmarksBarVisible: false,
    omniboxItems: [], omniboxIndex: -1,
    zoomByHost: {},
    findOpen: false,
  };


  async function storageLoad() {
    if (!invoke) return;
    try {
      const data = await invoke("storage_get_data");
      state.bookmarks = Array.isArray(data?.bookmarks) ? data.bookmarks : [];
      state.history = Array.isArray(data?.history) ? data.history : [];
      state.settings = { ...defaultSettings, ...(data?.settings || {}) };
      state.sitePermissions = Array.isArray(data?.sitePermissions) ? data.sitePermissions : (Array.isArray(data?.site_permissions) ? data.site_permissions : []);
      state.session = data?.session || { tabs: [], activeIndex: 0 };
    } catch (e) { console.error("storageLoad", e); state.session = { tabs: [], activeIndex: 0 }; }
  }
  async function saveBookmarks() { if (invoke) try { await invoke("storage_save_bookmarks", { bookmarks: state.bookmarks }); } catch(e){console.error(e);} }
  async function saveHistory() { if (invoke) try { await invoke("storage_save_history", { history: state.history }); } catch(e){console.error(e);} }
  async function saveSettings() { if (invoke) try { await invoke("storage_save_settings", { settings: state.settings }); } catch(e){console.error(e);} }
  async function saveSession() {
    if (!invoke) return;
    const session = { tabs: state.tabs.map(t => ({ url: t.url, title: t.title, pinned: !!t.pinned })), activeIndex: Math.max(0, state.tabs.findIndex(t => t.label === state.activeTab)) };
    try { await invoke("storage_save_session", { session }); } catch(e){console.error(e);}
  }

  function applyTheme() {
    const t = state.settings.theme;
    if (t === "light") document.documentElement.setAttribute("data-theme", "light");
    else if (t === "dark") document.documentElement.removeAttribute("data-theme");
    else { // system
      const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
      if (prefersLight) document.documentElement.setAttribute("data-theme", "light"); else document.documentElement.removeAttribute("data-theme");
    }
  }


  function updateSecurityBadge(url) {
    if (!url) { securityBadge.textContent = ""; securityBadge.className = "security-badge"; return; }
    try {
      const u = new URL(url);
      if (u.protocol === "https:") { securityBadge.textContent = "●"; securityBadge.className = "security-badge secure"; securityBadge.title = "Secure (HTTPS)"; }
      else if (u.protocol === "http:") { securityBadge.textContent = "●"; securityBadge.className = "security-badge insecure"; securityBadge.title = "Not secure (HTTP)"; }
      else { securityBadge.textContent = ""; securityBadge.className = "security-badge"; }
    } catch { securityBadge.textContent = ""; securityBadge.className = "security-badge"; }
  }

  function updateNavButtons() { const tab = getActiveTab(); backBtn.disabled = !tab?.canGoBack; forwardBtn.disabled = !tab?.canGoForward; }
  function updateProgress() {
    const tab = getActiveTab();
    if (tab?.loading) { progressBar.classList.add("visible"); progressBar.style.width = `${Math.max(5, Math.min(100, (tab.progress || 0.1) * 100))}%`; }
    else { progressBar.style.width = "100%"; progressBar.classList.remove("visible"); setTimeout(() => { if (!getActiveTab()?.loading) progressBar.style.width = "0%"; }, 200); }
  }
  function updateBookmarkButton() {
    const tab = getActiveTab(); const url = normalizeUrl(tab?.url);
    const isBookmarked = url && state.bookmarks.some((b) => b.url === url);
    bookmarkBtn.classList.toggle("active", !!isBookmarked);
    bookmarkBtn.textContent = isBookmarked ? "★" : "☆";
    bookmarkBtn.title = isBookmarked ? "Remove bookmark (Ctrl+D)" : "Bookmark this page (Ctrl+D)";
  }
  function updateAddressBar() {
    const tab = getActiveTab();
    if (document.activeElement !== addressInput) addressInput.value = tab?.url || "";
    updateBookmarkButton(); updateSecurityBadge(tab?.url || ""); updateNavButtons(); updateProgress();
  }

  function renderTabs() {
    tabsEl.innerHTML = "";
    for (const tab of state.tabs) {
      const btn = document.createElement("button");
      btn.className = "tab" + (tab.label === state.activeTab ? " active" : "") + (tab.pinned ? " pinned" : "");
      btn.type = "button"; btn.dataset.label = tab.label; btn.title = tab.title || tab.url || ""; btn.draggable = true;
      const favicon = document.createElement("img"); favicon.className = "tab-favicon" + (tab.loading ? " hidden" : "");
      favicon.alt = ""; favicon.referrerPolicy = "no-referrer";
      if (tab.favicon) favicon.src = tab.favicon; else favicon.classList.add("hidden");
      favicon.onerror = () => favicon.classList.add("hidden");
      const loadingDot = document.createElement("span"); loadingDot.className = "tab-loading-dot" + (tab.loading ? "" : " hidden");
      const title = document.createElement("span"); title.className = "tab-title"; title.textContent = displayTitle(tab);
      const close = document.createElement("button"); close.className = "tab-close"; close.type = "button"; close.title = "Close tab"; close.textContent = "×";
      close.addEventListener("click", (e) => { e.stopPropagation(); closeTab(tab.label); });
      btn.append(favicon, loadingDot, title, close);
      btn.addEventListener("click", () => switchTab(tab.label));
      btn.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.label); } });
      btn.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, tab.label); });
      btn.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/plain", tab.label); btn.classList.add("dragging"); });
      btn.addEventListener("dragend", () => { btn.classList.remove("dragging"); clearDropTargets(); });
      btn.addEventListener("dragover", (e) => { e.preventDefault(); clearDropTargets(); const r = btn.getBoundingClientRect(); btn.classList.add(e.clientX < r.left + r.width/2 ? "drop-before":"drop-after"); });
      btn.addEventListener("dragleave", () => btn.classList.remove("drop-before","drop-after"));
      btn.addEventListener("drop", async (e) => {
        e.preventDefault(); const from = e.dataTransfer?.getData("text/plain"); clearDropTargets(); if (!from || from === tab.label) return;
        const r = btn.getBoundingClientRect(); const before = e.clientX < r.left + r.width/2;
        let toIndex = state.tabs.findIndex(t => t.label === tab.label); if (!before) toIndex += 1;
        const fromIndex = state.tabs.findIndex(t => t.label === from); if (fromIndex < 0) return; if (fromIndex < toIndex) toIndex -= 1;
        try { await invoke?.("browser_reorder_tab", { label: from, toIndex }); } catch(err){console.error(err);}
      });
      tabsEl.appendChild(btn);
    }
    setEmptyStateVisible(state.tabs.length === 0);
  }
  function clearDropTargets() { tabsEl.querySelectorAll(".drop-before,.drop-after").forEach(el => el.classList.remove("drop-before","drop-after")); }

  function renderBookmarksBar() {
    bookmarksBar.innerHTML = "";
    const items = state.bookmarks.filter(b => !b.folder);
    if (!state.bookmarksBarVisible || items.length === 0) { bookmarksBar.classList.add("hidden"); return; }
    bookmarksBar.classList.remove("hidden");
    for (const b of items.slice(0, 20)) {
      const btn = document.createElement("button"); btn.className = "bookmarks-bar-item"; btn.type = "button";
      btn.textContent = b.title || b.url; btn.title = b.url; btn.addEventListener("click", () => openFromSidebar(b.url));
      bookmarksBar.appendChild(btn);
    }
  }

  function renderBookmarks() {
    bookmarksList.innerHTML = "";
    if (state.bookmarks.length === 0) { bookmarksList.innerHTML = '<li class="empty-list">No bookmarks yet.</li>'; renderBookmarksBar(); return; }
    const groups = {};
    for (const bm of state.bookmarks) { const f = bm.folder || ""; (groups[f] ||= []).push(bm); }
    const folders = Object.keys(groups).sort((a,b)=> (a===""?-1:0) - (b===""?-1:0) || a.localeCompare(b));
    for (const folder of folders) {
      if (folder) { const h = document.createElement("li"); h.className = "history-group"; h.textContent = folder; bookmarksList.appendChild(h); }
      for (const bm of groups[folder]) {
        const li = document.createElement("li"); li.className = "item";
        const main = document.createElement("button"); main.type="button"; main.className="item-main";
        main.innerHTML = `<div class="item-title"></div><div class="item-url"></div>`;
        main.querySelector(".item-title").textContent = bm.title || bm.url;
        main.querySelector(".item-url").textContent = bm.url;
        main.addEventListener("click", () => openFromSidebar(bm.url));
        const remove = document.createElement("button"); remove.type="button"; remove.className="item-remove"; remove.textContent="×";
        remove.addEventListener("click", async () => { state.bookmarks = state.bookmarks.filter(x => x.id !== bm.id); await saveBookmarks(); renderBookmarks(); updateBookmarkButton(); });
        li.append(main, remove); bookmarksList.appendChild(li);
      }
    }
    renderBookmarksBar();
  }

  function renderHistory() {
    historyList.innerHTML = "";
    const q = (historySearch?.value || "").toLowerCase().trim();
    const items = state.history.filter(h => !q || (h.title||"").toLowerCase().includes(q) || (h.url||"").toLowerCase().includes(q));
    if (items.length === 0) { historyList.innerHTML = '<li class="empty-list">No history yet.</li>'; return; }
    let lastDay = "";
    for (const entry of items) {
      const k = dayKey(entry.visitedAt || Date.now());
      if (k !== lastDay) { lastDay = k; const g = document.createElement("li"); g.className="history-group"; g.textContent = dayLabel(k); historyList.appendChild(g); }
      const li = document.createElement("li"); li.className = "item";
      const main = document.createElement("button"); main.type="button"; main.className="item-main";
      main.innerHTML = `<div class="item-title"></div><div class="item-url"></div><div class="item-meta"></div>`;
      main.querySelector(".item-title").textContent = entry.title || entry.url;
      main.querySelector(".item-url").textContent = entry.url;
      main.querySelector(".item-meta").textContent = new Date(entry.visitedAt || Date.now()).toLocaleString();
      main.addEventListener("click", () => openFromSidebar(entry.url));
      const remove = document.createElement("button"); remove.type="button"; remove.className="item-remove"; remove.textContent="×";
      remove.addEventListener("click", async () => { state.history = state.history.filter(x => x.id !== entry.id); await saveHistory(); renderHistory(); });
      li.append(main, remove); historyList.appendChild(li);
    }
  }

  function renderSidebar() {
    sidebar.classList.toggle("hidden", !state.sidebarOpen);
    appEl.classList.toggle("sidebar-open", state.sidebarOpen);
    bookmarksToggleBtn.classList.toggle("active", state.sidebarOpen);
    sidebarTabs.forEach(btn => btn.classList.toggle("active", btn.dataset.panel === state.sidebarPanel));
    ["bookmarks-panel","history-panel","downloads-panel","settings-panel"].forEach(id => { const el=$(id); if(el) el.classList.toggle("hidden", state.sidebarPanel !== id); });
    renderBookmarks(); renderHistory();
    if (state.sidebarPanel === "settings-panel") renderSettings();
    if (state.sidebarPanel === "downloads-panel") renderDownloads();
  }

  function getContentBounds() {
    const r = contentArea.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.max(1, Math.floor(r.width)), height: Math.max(1, Math.floor(r.height)) };
  }
  async function updateActiveTabBounds() {
    if (!invoke || !state.activeTab) return; const b = getContentBounds();
    try { await invoke("browser_set_tab_bounds", { label: state.activeTab, x: b.x, y: b.y, width: b.width, height: b.height }); } catch(e){console.error(e);}
  }

  async function createTab(url, opts = {}) {
    if (!invoke) return; const b = getContentBounds();
    try {
      const tab = await invoke("browser_create_tab", { url: url || HOME_URL, x: b.x, y: b.y, width: b.width, height: b.height, background: !!opts.background });
      upsertTab(tab); if (!opts.background) state.activeTab = tab.label;
      renderTabs(); updateAddressBar(); if (!opts.background) await updateActiveTabBounds();
      await saveSession();
    } catch (e) { console.error("createTab", e); }
  }
  function upsertTab(tabInfo) { if (!tabInfo?.label) return; const i = state.tabs.findIndex(t => t.label === tabInfo.label); if (i>=0) state.tabs[i] = {...state.tabs[i], ...tabInfo}; else state.tabs.push({...tabInfo}); }

  async function closeTab(label) {
    if (!invoke) return;
    try {
      const nextActive = await invoke("browser_close_tab", { label });
      state.tabs = state.tabs.filter(t => t.label !== label); state.activeTab = nextActive || null;
      if (state.tabs.length === 0) { setEmptyStateVisible(true); await createTab(HOME_URL); return; }
      renderTabs(); updateAddressBar(); await updateActiveTabBounds(); await saveSession();
    } catch (e) { console.error("closeTab", e); }
  }
  async function switchTab(label) {
    if (!invoke || !label || label === state.activeTab) return;
    try { await invoke("browser_switch_tab", { label }); state.activeTab = label; renderTabs(); updateAddressBar(); await updateActiveTabBounds(); await saveSession(); }
    catch(e){console.error(e);}
  }
  async function navigateActiveTab(url) {
    const tab = getActiveTab(); if (!tab || !invoke) return;
    const final = parseInput(url);
    try { const finalUrl = await invoke("browser_navigate_tab", { label: tab.label, url: final }); tab.url = finalUrl; renderTabs(); updateAddressBar(); }
    catch(e){console.error(e);}
  }
  async function openFromSidebar(url) { const tab = getActiveTab(); if (tab) await navigateActiveTab(url); else await createTab(url); }

  function addHistoryEntry(url, title) {
    const normalized = normalizeUrl(url); if (!normalized || normalized === "about:blank") return;
    const t = title || (()=>{ try { return new URL(normalized).host; } catch { return normalized; }})();
    const existing = state.history.find(h => h.url === normalized);
    if (existing) { existing.visitedAt = Date.now(); existing.visitCount = (existing.visitCount||1)+1; if (title) existing.title = title; state.history = [existing, ...state.history.filter(h => h.id !== existing.id)]; }
    else { state.history.unshift({ id: uid(), url: normalized, title: t, visitedAt: Date.now(), visitCount: 1 }); }
    if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
    saveHistory(); if (state.sidebarOpen && state.sidebarPanel === "history-panel") renderHistory();
  }

  async function toggleBookmarkForActiveTab() {
    const tab = getActiveTab(); const url = normalizeUrl(tab?.url); if (!url) return;
    const existing = state.bookmarks.find(b => b.url === url);
    if (existing) state.bookmarks = state.bookmarks.filter(b => b.url !== url);
    else state.bookmarks.unshift({ id: uid(), url, title: displayTitle(tab), folder: "", createdAt: Date.now() });
    await saveBookmarks(); updateBookmarkButton(); renderBookmarks();
  }

  function setSidebar(open, panel) { state.sidebarOpen = open; if (panel) state.sidebarPanel = panel; renderSidebar(); requestAnimationFrame(() => updateActiveTabBounds()); setTimeout(updateActiveTabBounds, 60); }

  // Omnibox
  function hideOmnibox() { omnibox.classList.add("hidden"); state.omniboxItems = []; state.omniboxIndex = -1; }
  function showOmnibox(items) {
    state.omniboxItems = items; state.omniboxIndex = -1;
    omnibox.innerHTML = "";
    if (!items.length) { hideOmnibox(); return; }
    for (let i=0;i<items.length;i++) {
      const item = items[i]; const btn = document.createElement("button"); btn.type="button"; btn.className="omnibox-item"; btn.dataset.index = String(i);
      btn.innerHTML = `<span class="omnibox-kind"></span><span class="omnibox-text"></span><span class="omnibox-url"></span>`;
      btn.querySelector(".omnibox-kind").textContent = item.kind;
      btn.querySelector(".omnibox-text").textContent = item.title || item.url || item.text;
      btn.querySelector(".omnibox-url").textContent = item.url || "";
      btn.addEventListener("mousedown", (e) => { e.preventDefault(); chooseOmnibox(i); });
      omnibox.appendChild(btn);
    }
    omnibox.classList.remove("hidden");
  }
  function chooseOmnibox(i) { const item = state.omniboxItems[i]; if (!item) return; hideOmnibox(); navigateActiveTab(item.url || item.text); addressInput.blur(); }
  function updateOmnibox() {
    const q = addressInput.value.trim().toLowerCase();
    if (!q) { hideOmnibox(); return; }
    const items = [];
    const seen = new Set();
    for (const t of state.tabs) { if ((t.title||"").toLowerCase().includes(q) || (t.url||"").toLowerCase().includes(q)) { if (!seen.has(t.url)) { seen.add(t.url); items.push({ kind:"tab", title:t.title||t.url, url:t.url }); } } }
    for (const b of state.bookmarks) { if ((b.title||"").toLowerCase().includes(q) || (b.url||"").toLowerCase().includes(q)) { if (!seen.has(b.url)) { seen.add(b.url); items.push({ kind:"bookmark", title:b.title, url:b.url }); } } }
    for (const h of state.history) { if ((h.title||"").toLowerCase().includes(q) || (h.url||"").toLowerCase().includes(q)) { if (!seen.has(h.url)) { seen.add(h.url); items.push({ kind:"history", title:h.title, url:h.url, score:(h.visitCount||1) }); } } }
    items.sort((a,b)=> (b.score||0)-(a.score||0));
    items.push({ kind:"search", title:`Search: ${addressInput.value.trim()}`, url: searchUrl(addressInput.value.trim()), text: addressInput.value.trim() });
    showOmnibox(items.slice(0,8));
  }

  function hideContextMenu() { contextMenu.classList.add("hidden"); state.contextTab = null; }
  function showContextMenu(x,y,label) { state.contextTab = label; const tab = state.tabs.find(t=>t.label===label); const pinBtn = contextMenu.querySelector('[data-action="pin"]'); if (pinBtn) pinBtn.textContent = tab?.pinned ? "Unpin":"Pin"; contextMenu.classList.remove("hidden"); contextMenu.style.left = `${Math.min(x, window.innerWidth-200)}px`; contextMenu.style.top = `${Math.min(y, window.innerHeight-260)}px`; }
  async function handleContextAction(action) {
    const label = state.contextTab; hideContextMenu(); const tab = state.tabs.find(t=>t.label===label);
    if (action === "reopen") { await reopenClosed(); return; } if (!label || !tab) return; const b = getContentBounds();
    try {
      if (action==="reload") await invoke?.("browser_tab_reload",{label});
      else if (action==="duplicate") await invoke?.("browser_duplicate_tab",{label,x:b.x,y:b.y,width:b.width,height:b.height});
      else if (action==="pin") await invoke?.("browser_pin_tab",{label,pinned:!tab.pinned});
      else if (action==="close") await closeTab(label);
      else if (action==="close-others") await invoke?.("browser_close_others",{label});
      else if (action==="close-right") await invoke?.("browser_close_right",{label});
    } catch(e){console.error(e);}
  }
  async function reopenClosed() { if(!invoke) return; const b=getContentBounds(); try{ await invoke("browser_reopen_closed",{x:b.x,y:b.y,width:b.width,height:b.height}); }catch(e){console.error(e);} }

  async function clearBrowsingData() {
    if (!invoke) return;
    const ok = window.confirm("Clear history and session data? Bookmarks will be kept.");
    if (!ok) return;
    try { const data = await invoke("storage_clear_browsing_data", { history: true, bookmarks: false, sessions: true }); state.history = data.history||[]; state.session = data.session||{tabs:[],activeIndex:0}; renderHistory(); }
    catch(e){console.error(e);}
  }

  async function exportBookmarks() {
    if (!invoke) return;
    try { const html = await invoke("storage_export_bookmarks_html"); const blob = new Blob([html], {type:"text/html"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="bare-bookmarks.html"; a.click(); URL.revokeObjectURL(a.href); }
    catch(e){console.error(e);}
  }
  async function importBookmarks() {
    if (!invoke) return;
    const input = document.createElement("input"); input.type="file"; input.accept=".html,.htm";
    input.onchange = async () => { const f = input.files?.[0]; if(!f) return; const text = await f.text(); try { state.bookmarks = await invoke("storage_import_bookmarks_html", { html: text }); renderBookmarks(); updateBookmarkButton(); } catch(e){console.error(e);} };
    input.click();
  }

  function hostFor(url){ try { return new URL(url).host; } catch { return ""; } }
  function currentZoom(){ const t=getActiveTab(); const h=hostFor(t?.url); return state.zoomByHost[h] || 1.0; }
  async function applyZoom(z){ const t=getActiveTab(); if(!t||!invoke) return; const h=hostFor(t.url); state.zoomByHost[h]=z; try{ await invoke("browser_set_zoom",{label:t.label, zoom:z}); }catch(e){console.error(e);} }
  function openFind(){ state.findOpen=true; findBar.classList.remove("hidden"); findInput.focus(); findInput.select(); }
  function closeFind(){
    state.findOpen=false; findBar.classList.add("hidden"); findCount.textContent="";
    const t=getActiveTab();
    if(t && invoke) invoke("browser_eval_js",{label:t.label, js:"window.getSelection().removeAllRanges();"}).catch(()=>{});
  }
  async function findEval(forward=true){
    const t=getActiveTab(); if(!t || !invoke) return;
    const q=findInput.value||"";
    if(!q){ findCount.textContent=""; return; }
    const back = !forward;
    const js = `(function(){try{var found=window.find(${JSON.stringify(q)},false,${back?'true':'false'},true,false,true,false); return found;}catch(e){return false;}})()`;
    try { await invoke("browser_eval_js", { label: t.label, js }); findCount.textContent = ""; }
    catch(e){ console.error(e); }
  }

  function renderSettings(){
    settingSearchEngine.value = state.settings.defaultSearchEngine || "duckduckgo";
    settingCustomSearch.value = state.settings.customSearchUrl || "";
    settingStartup.value = state.settings.startupBehavior || "newtab";
    settingTheme.value = state.settings.theme || "dark";
    settingDownloadPath.value = state.settings.downloadPath || "";
    settingHttpsFirst.checked = !!state.settings.httpsFirst;
    settingTrackerBlocking.checked = !!state.settings.trackerBlocking;
  }
  async function saveSettingsFromUI(){
    state.settings = {
      ...state.settings,
      defaultSearchEngine: settingSearchEngine.value,
      customSearchUrl: settingCustomSearch.value.trim(),
      startupBehavior: settingStartup.value,
      theme: settingTheme.value,
      downloadPath: settingDownloadPath.value.trim(),
      httpsFirst: settingHttpsFirst.checked,
      trackerBlocking: settingTrackerBlocking.checked,
    };
    await saveSettings(); applyTheme();
  }
  async function renderDownloads(){
    if(!invoke) return;
    try {
      const items = await invoke("browser_download_list");
      downloadsList.innerHTML = "";
      if(!items || items.length===0){ downloadsList.innerHTML='<li class="empty-list">No downloads yet.</li>'; return; }
      for(const d of items){
        const li=document.createElement("li"); li.className="item";
        const main=document.createElement("div"); main.className="item-main";
        main.innerHTML=`<div class="item-title"></div><div class="item-url"></div><div class="item-meta"></div>`;
        main.querySelector('.item-title').textContent=d.fileName||d.url;
        main.querySelector('.item-url').textContent=d.url||"";
        main.querySelector('.item-meta').textContent=`${d.state} ${d.receivedBytes||0}/${d.totalBytes||"?"}`;
        li.appendChild(main); downloadsList.appendChild(li);
      }
    } catch(e){ downloadsList.innerHTML='<li class="empty-list">Downloads unavailable.</li>'; }
  }

  function bindEvents() {
    newTabBtn.addEventListener("click", () => createTab(HOME_URL));
    backBtn.addEventListener("click", () => { const t=getActiveTab(); if(t) invoke?.("browser_tab_back",{label:t.label}).catch(console.error); });
    forwardBtn.addEventListener("click", () => { const t=getActiveTab(); if(t) invoke?.("browser_tab_forward",{label:t.label}).catch(console.error); });
    reloadBtn.addEventListener("click", () => { const t=getActiveTab(); if(t) invoke?.("browser_tab_reload",{label:t.label}).catch(console.error); });
    homeBtn.addEventListener("click", () => navigateActiveTab(HOME_URL));
    addressForm.addEventListener("submit", (e) => { e.preventDefault(); hideOmnibox(); const v=addressInput.value.trim(); if(v) navigateActiveTab(v); });
    addressInput.addEventListener("focus", () => { addressInput.select(); updateOmnibox(); });
    addressInput.addEventListener("input", updateOmnibox);
    addressInput.addEventListener("blur", () => setTimeout(hideOmnibox, 150));
    addressInput.addEventListener("keydown", (e) => {
      if (omnibox.classList.contains("hidden")) return;
      if (e.key === "ArrowDown") { e.preventDefault(); state.omniboxIndex = Math.min(state.omniboxItems.length-1, state.omniboxIndex+1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); state.omniboxIndex = Math.max(-1, state.omniboxIndex-1); }
      else if (e.key === "Enter" && state.omniboxIndex >= 0) { e.preventDefault(); chooseOmnibox(state.omniboxIndex); return; }
      else if (e.key === "Escape") { hideOmnibox(); return; } else return;
      omnibox.querySelectorAll(".omnibox-item").forEach((el,i)=> el.classList.toggle("active", i===state.omniboxIndex));
    });
    bookmarkBtn.addEventListener("click", toggleBookmarkForActiveTab);
    bookmarksToggleBtn.addEventListener("click", () => setSidebar(!state.sidebarOpen, state.sidebarPanel));
    sidebarCloseBtn.addEventListener("click", () => setSidebar(false));
    sidebarTabs.forEach(btn => btn.addEventListener("click", () => setSidebar(true, btn.dataset.panel)));
    clearBrowsingDataBtn?.addEventListener("click", clearBrowsingData);
    importBookmarksBtn?.addEventListener("click", importBookmarks);
    exportBookmarksBtn?.addEventListener("click", exportBookmarks);
    historySearch?.addEventListener("input", renderHistory);
    settingsSaveBtn?.addEventListener("click", saveSettingsFromUI);
    findInput?.addEventListener("input", () => findEval(true));
    findInput?.addEventListener("keydown", (e) => { if(e.key==="Enter"){ e.preventDefault(); findEval(!e.shiftKey); } if(e.key==="Escape"){ closeFind(); } });
    findNext?.addEventListener("click", () => findEval(true));
    findPrev?.addEventListener("click", () => findEval(false));
    findClose?.addEventListener("click", closeFind);

    window.addEventListener("resize", () => updateActiveTabBounds());
    if (window.ResizeObserver) new ResizeObserver(() => updateActiveTabBounds()).observe(contentArea);
    document.addEventListener("click", (e) => { if (!contextMenu.contains(e.target)) hideContextMenu(); });
    window.addEventListener("blur", hideContextMenu);
    contextMenu.querySelectorAll("[data-action]").forEach(btn => btn.addEventListener("click", () => handleContextAction(btn.dataset.action)));

    window.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && e.shiftKey && k === "t") { e.preventDefault(); reopenClosed(); return; }
      if (mod && e.shiftKey && k === "b") { e.preventDefault(); state.bookmarksBarVisible = !state.bookmarksBarVisible; renderBookmarksBar(); requestAnimationFrame(updateActiveTabBounds); return; }
      if (mod && e.shiftKey && k === "i") { e.preventDefault(); const t=getActiveTab(); if(t) invoke?.("browser_open_devtools",{label:t.label}).catch(console.error); return; }
      if (mod && e.key === "Tab") { e.preventDefault(); const tabs=state.tabs; if(!tabs.length) return; const idx=tabs.findIndex(t=>t.label===state.activeTab); const next=e.shiftKey ? (idx-1+tabs.length)%tabs.length : (idx+1)%tabs.length; switchTab(tabs[next].label); return; }
      if (mod && /^[1-8]$/.test(e.key)) { e.preventDefault(); const idx=parseInt(e.key,10)-1; if(state.tabs[idx]) switchTab(state.tabs[idx].label); return; }
      if (mod && e.key === "9") { e.preventDefault(); if(state.tabs.length) switchTab(state.tabs[state.tabs.length-1].label); return; }
      if (mod) {
        if (k==="t") { e.preventDefault(); createTab(HOME_URL); }
        else if (k==="w") { e.preventDefault(); if(state.activeTab) closeTab(state.activeTab); }
        else if (k==="l") { e.preventDefault(); addressInput.focus(); addressInput.select(); }
        else if (k==="r") { e.preventDefault(); const t=getActiveTab(); if(t) invoke?.("browser_tab_reload",{label:t.label}).catch(console.error); }
        else if (k==="d") { e.preventDefault(); toggleBookmarkForActiveTab(); }
        else if (k==="f") { e.preventDefault(); openFind(); }
        else if (k==="j") { e.preventDefault(); setSidebar(true, "downloads-panel"); renderDownloads(); }
        else if (k===",") { e.preventDefault(); setSidebar(true, "settings-panel"); renderSettings(); }
        else if (k==="p") { e.preventDefault(); const t=getActiveTab(); if(t) invoke?.("browser_print_page",{label:t.label}).catch(console.error); }
        else if (k==="b" && !e.shiftKey) { e.preventDefault(); setSidebar(!state.sidebarOpen, "bookmarks-panel"); }
        else if (k==="h") { e.preventDefault(); setSidebar(!state.sidebarOpen, "history-panel"); }
        else if (k==="=" || k==="+" ) { e.preventDefault(); applyZoom(Math.min(2.0, +(currentZoom()+0.1).toFixed(2))); }
        else if (k==="-" ) { e.preventDefault(); applyZoom(Math.max(0.5, +(currentZoom()-0.1).toFixed(2))); }
        else if (k==="0") { e.preventDefault(); applyZoom(1.0); }
      }
      if (e.key === "F12") { e.preventDefault(); const t=getActiveTab(); if(t) invoke?.("browser_open_devtools",{label:t.label}).catch(console.error); }
      if (e.altKey && e.key==="ArrowLeft") { e.preventDefault(); const t=getActiveTab(); if(t) invoke?.("browser_tab_back",{label:t.label}).catch(console.error); }
      if (e.altKey && e.key==="ArrowRight") { e.preventDefault(); const t=getActiveTab(); if(t) invoke?.("browser_tab_forward",{label:t.label}).catch(console.error); }
      if (e.key==="Escape") { if(state.findOpen) closeFind(); hideContextMenu(); hideOmnibox(); }
    });
  }

  function showPermissionPrompt(origin, permission) {
    if (!permPrompt) return Promise.resolve(false);
    permTitle.textContent = "Permission request";
    permBody.textContent = `${origin} wants to use: ${permission}. Allow this site?`;
    permPrompt.classList.remove("hidden");
    return new Promise((resolve) => {
      const cleanup = (val) => { permPrompt.classList.add("hidden"); permAllow.onclick = null; permDeny.onclick = null; resolve(val); };
      permAllow.onclick = () => cleanup(true);
      permDeny.onclick = () => cleanup(false);
    });
  }

  async function bindTauriEvents() {
    if (!listen) return;
    await listen("tabs-updated", (event) => {
      const p = event.payload || {}; if (Array.isArray(p.tabs)) state.tabs = p.tabs; if (p.activeTab !== undefined) state.activeTab = p.activeTab;
      renderTabs(); updateAddressBar(); saveSession();
    });
    await listen("tab-navigated", (event) => {
      const { label, url, title } = event.payload || {}; if (!label || !url) return;
      const tab = state.tabs.find(t=>t.label===label); if (tab) { tab.url=url; if(title) tab.title=title; }
      if (label===state.activeTab) { if(document.activeElement!==addressInput) addressInput.value=url; updateBookmarkButton(); updateSecurityBadge(url); }
      renderTabs(); addHistoryEntry(url, title);
    });
    await listen("tab-loading", (event) => {
      const { label, loading, progress } = event.payload || {}; const tab = state.tabs.find(t=>t.label===label);
      if (tab) { tab.loading = loading !== false; if (progress != null) tab.progress = progress; } renderTabs(); updateProgress();
    });
    await listen("tab-loaded", (event) => {
      const { label, url } = event.payload || {}; const tab = state.tabs.find(t=>t.label===label);
      if (tab) { tab.loading=false; tab.progress=1; if(url) tab.url=url; } renderTabs(); updateProgress();
      if (url) addHistoryEntry(url, tab?.title);
    });
    await listen("tab-open-request", (event) => { const { url, background } = event.payload || {}; if (url) createTab(url, { background: !!background }); });
    await listen("download-updated", () => { if (state.sidebarPanel === "downloads-panel" && state.sidebarOpen) renderDownloads(); });
    await listen("download-finished", () => { if (state.sidebarPanel === "downloads-panel" && state.sidebarOpen) renderDownloads(); });
    await listen("permission-request", async (event) => {
      const { origin, permission } = event.payload || {};
      if (!origin || !permission) return;
      const existing = (state.sitePermissions || []).find(p => p.origin === origin && p.permission === permission);
      let allow = existing ? !!existing.allow : await showPermissionPrompt(origin, permission);
      if (!existing) {
        state.sitePermissions = [...(state.sitePermissions || []), { origin, permission, allow }];
        try { await invoke("storage_save_site_permissions", { sitePermissions: state.sitePermissions }); } catch(e) { console.error(e); }
      }
      try { await invoke("browser_permission_decision", { origin, permission, allow }); } catch(e) { /* optional */ }
    });
  }

  async function restoreSessionOrHome() {
    if (state.settings.startupBehavior === "restore" && Array.isArray(state.session?.tabs) && state.session.tabs.length > 0) {
      let lastLabel = null;
      for (let i = 0; i < state.session.tabs.length; i++) {
        const t = state.session.tabs[i];
        const isActive = i === (state.session.activeIndex || 0);
        await createTab(t.url || HOME_URL, { background: !isActive });
        lastLabel = state.activeTab;
        const created = state.tabs[state.tabs.length - 1];
        if (t.pinned && created && invoke) {
          try { await invoke("browser_pin_tab", { label: created.label, pinned: true }); } catch {}
        }
      }
      // Ensure intended active tab is visible
      const activeIdx = state.session.activeIndex || 0;
      const target = state.tabs[activeIdx];
      if (target) await switchTab(target.label);
      return;
    }
    await createTab(HOME_URL);
  }

  async function init() {
    bindEvents();
    applyTheme();
    await storageLoad();
    applyTheme();
    renderSidebar(); renderBookmarks(); renderHistory(); renderTabs(); updateAddressBar();
    if (!invoke) { console.warn("No Tauri invoke; limited mode."); setEmptyStateVisible(true); return; }
    await bindTauriEvents();
    await restoreSessionOrHome();
    setTimeout(updateActiveTabBounds, 100); setTimeout(updateActiveTabBounds, 400);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
