(() => {
  "use strict";

  const HOME_URL = "https://duckduckgo.com/";
  const BOOKMARKS_KEY = "bare-browser.bookmarks.v1";
  const HISTORY_KEY = "bare-browser.history.v1";
  const HISTORY_LIMIT = 200;

  const tauri = window.__TAURI__ || null;
  const invoke = tauri?.core?.invoke
    ? (cmd, args) => tauri.core.invoke(cmd, args)
    : null;
  const listen = tauri?.event?.listen
    ? (event, handler) => tauri.event.listen(event, handler)
    : null;

  const tabsEl = document.getElementById("tabs");
  const newTabBtn = document.getElementById("new-tab-btn");
  const backBtn = document.getElementById("back-btn");
  const forwardBtn = document.getElementById("forward-btn");
  const reloadBtn = document.getElementById("reload-btn");
  const homeBtn = document.getElementById("home-btn");
  const addressForm = document.getElementById("address-form");
  const addressInput = document.getElementById("address-input");
  const bookmarkBtn = document.getElementById("bookmark-btn");
  const bookmarksToggleBtn = document.getElementById("bookmarks-toggle-btn");
  const sidebar = document.getElementById("sidebar");
  const appEl = document.getElementById("app");
  const sidebarCloseBtn = document.getElementById("sidebar-close-btn");
  const sidebarTabs = Array.from(document.querySelectorAll(".sidebar-tab"));
  const bookmarksPanel = document.getElementById("bookmarks-panel");
  const historyPanel = document.getElementById("history-panel");
  const bookmarksList = document.getElementById("bookmarks-list");
  const historyList = document.getElementById("history-list");
  const clearBookmarksBtn = document.getElementById("clear-bookmarks-btn");
  const clearHistoryBtn = document.getElementById("clear-history-btn");
  const contentArea = document.getElementById("content-area");
  const emptyState = document.getElementById("empty-state");

  const state = {
    tabs: [],
    activeTab: null,
    bookmarks: loadJSON(BOOKMARKS_KEY, []),
    history: loadJSON(HISTORY_KEY, []),
    sidebarOpen: false,
    sidebarPanel: "bookmarks-panel",
  };

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage failures (private mode / quota).
    }
  }

  function uid() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function normalizeUrl(url) {
    return (url || "").trim();
  }

  function displayTitle(tab) {
    if (!tab) return "New Tab";
    try {
      const u = new URL(tab.url);
      return u.host || tab.url;
    } catch {
      return tab.url || "New Tab";
    }
  }

  function getActiveTab() {
    return state.tabs.find((t) => t.label === state.activeTab) || null;
  }

  function setEmptyStateVisible(visible) {
    emptyState.classList.toggle("hidden", !visible);
  }

  function updateBookmarkButton() {
    const tab = getActiveTab();
    const url = normalizeUrl(tab?.url);
    const isBookmarked = url && state.bookmarks.some((b) => b.url === url);
    bookmarkBtn.classList.toggle("active", !!isBookmarked);
    bookmarkBtn.textContent = isBookmarked ? "★" : "☆";
    bookmarkBtn.title = isBookmarked ? "Remove bookmark" : "Bookmark this page";
    bookmarkBtn.setAttribute(
      "aria-label",
      isBookmarked ? "Remove bookmark" : "Bookmark this page"
    );
  }

  function updateAddressBar() {
    const tab = getActiveTab();
    addressInput.value = tab?.url || "";
    updateBookmarkButton();
  }

  function renderTabs() {
    tabsEl.innerHTML = "";
    for (const tab of state.tabs) {
      const btn = document.createElement("button");
      btn.className = "tab" + (tab.label === state.activeTab ? " active" : "");
      btn.type = "button";
      btn.dataset.label = tab.label;
      btn.title = tab.url || "";

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = displayTitle(tab);

      const close = document.createElement("button");
      close.className = "tab-close";
      close.type = "button";
      close.title = "Close tab";
      close.setAttribute("aria-label", `Close ${displayTitle(tab)}`);
      close.textContent = "×";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(tab.label);
      });

      btn.appendChild(title);
      btn.appendChild(close);
      btn.addEventListener("click", () => switchTab(tab.label));
      tabsEl.appendChild(btn);
    }
    setEmptyStateVisible(state.tabs.length === 0);
  }

  function renderBookmarks() {
    bookmarksList.innerHTML = "";
    if (state.bookmarks.length === 0) {
      const li = document.createElement("li");
      li.className = "empty-list";
      li.textContent = "No bookmarks yet.";
      bookmarksList.appendChild(li);
      return;
    }

    for (const bm of state.bookmarks) {
      const li = document.createElement("li");
      li.className = "item";

      const main = document.createElement("button");
      main.type = "button";
      main.className = "item-main";
      main.innerHTML = `
        <div class="item-title"></div>
        <div class="item-url"></div>
      `;
      main.querySelector(".item-title").textContent = bm.title || bm.url;
      main.querySelector(".item-url").textContent = bm.url;
      main.addEventListener("click", () => openFromSidebar(bm.url));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "item-remove";
      remove.title = "Remove bookmark";
      remove.setAttribute("aria-label", "Remove bookmark");
      remove.textContent = "×";
      remove.addEventListener("click", () => removeBookmark(bm.id));

      li.appendChild(main);
      li.appendChild(remove);
      bookmarksList.appendChild(li);
    }
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return "";
    }
  }

  function renderHistory() {
    historyList.innerHTML = "";
    if (state.history.length === 0) {
      const li = document.createElement("li");
      li.className = "empty-list";
      li.textContent = "No history yet.";
      historyList.appendChild(li);
      return;
    }

    for (const entry of state.history) {
      const li = document.createElement("li");
      li.className = "item";

      const main = document.createElement("button");
      main.type = "button";
      main.className = "item-main";
      main.innerHTML = `
        <div class="item-title"></div>
        <div class="item-url"></div>
        <div class="item-meta"></div>
      `;
      main.querySelector(".item-title").textContent = entry.title || entry.url;
      main.querySelector(".item-url").textContent = entry.url;
      main.querySelector(".item-meta").textContent = formatTime(entry.visitedAt);
      main.addEventListener("click", () => openFromSidebar(entry.url));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "item-remove";
      remove.title = "Remove from history";
      remove.setAttribute("aria-label", "Remove from history");
      remove.textContent = "×";
      remove.addEventListener("click", () => removeHistoryEntry(entry.id));

      li.appendChild(main);
      li.appendChild(remove);
      historyList.appendChild(li);
    }
  }

  function renderSidebar() {
    sidebar.classList.toggle("hidden", !state.sidebarOpen);
    appEl.classList.toggle("sidebar-open", state.sidebarOpen);
    bookmarksToggleBtn.classList.toggle("active", state.sidebarOpen);
    sidebarTabs.forEach((btn) => {
      const active = btn.dataset.panel === state.sidebarPanel;
      btn.classList.toggle("active", active);
    });
    bookmarksPanel.classList.toggle("hidden", state.sidebarPanel !== "bookmarks-panel");
    historyPanel.classList.toggle("hidden", state.sidebarPanel !== "history-panel");
    renderBookmarks();
    renderHistory();
  }

  function getContentBounds() {
    const rect = contentArea.getBoundingClientRect();
    // getBoundingClientRect returns CSS pixels; Tauri LogicalSize/Position expects logical pixels.
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height)),
    };
  }

  async function updateActiveTabBounds() {
    if (!invoke || !state.activeTab) return;
    const bounds = getContentBounds();
    try {
      await invoke("browser_set_tab_bounds", {
        label: state.activeTab,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
    } catch (err) {
      console.error("Failed to update tab bounds:", err);
    }
  }

  async function createTab(url) {
    if (!invoke) {
      console.warn("Tauri invoke unavailable; cannot create native tab.");
      return;
    }
    const bounds = getContentBounds();
    try {
      const tab = await invoke("browser_create_tab", {
        url: url || HOME_URL,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
      // State will be refreshed by tabs-updated event, but update optimistically.
      upsertTab(tab);
      state.activeTab = tab.label;
      renderTabs();
      updateAddressBar();
      await updateActiveTabBounds();
    } catch (err) {
      console.error("Failed to create tab:", err);
    }
  }

  function upsertTab(tabInfo) {
    if (!tabInfo || !tabInfo.label) return;
    const idx = state.tabs.findIndex((t) => t.label === tabInfo.label);
    if (idx >= 0) {
      state.tabs[idx] = { ...state.tabs[idx], ...tabInfo };
    } else {
      state.tabs.push({ ...tabInfo });
    }
  }

  async function closeTab(label) {
    if (!invoke) return;
    try {
      const nextActive = await invoke("browser_close_tab", { label });
      state.tabs = state.tabs.filter((t) => t.label !== label);
      state.activeTab = nextActive || null;
      if (state.tabs.length === 0) {
        setEmptyStateVisible(true);
        await createTab(HOME_URL);
        return;
      }
      renderTabs();
      updateAddressBar();
      await updateActiveTabBounds();
    } catch (err) {
      console.error("Failed to close tab:", err);
    }
  }

  async function switchTab(label) {
    if (!invoke || !label || label === state.activeTab) return;
    try {
      await invoke("browser_switch_tab", { label });
      state.activeTab = label;
      renderTabs();
      updateAddressBar();
      await updateActiveTabBounds();
    } catch (err) {
      console.error("Failed to switch tab:", err);
    }
  }

  async function navigateActiveTab(url) {
    const tab = getActiveTab();
    if (!tab || !invoke) return;
    try {
      const finalUrl = await invoke("browser_navigate_tab", { label: tab.label, url });
      tab.url = finalUrl;
      renderTabs();
      updateAddressBar();
    } catch (err) {
      console.error("Navigation failed:", err);
    }
  }

  async function openFromSidebar(url) {
    const tab = getActiveTab();
    if (tab) {
      await navigateActiveTab(url);
    } else {
      await createTab(url);
    }
  }

  function addHistoryEntry(url) {
    const normalized = normalizeUrl(url);
    if (!normalized || normalized === "about:blank") return;
    const title = (() => {
      try { return new URL(normalized).host; } catch { return normalized; }
    })();
    // Avoid duplicate adjacent entries.
    if (state.history[0]?.url === normalized) return;
    state.history.unshift({ id: uid(), url: normalized, title, visitedAt: Date.now() });
    if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
    saveJSON(HISTORY_KEY, state.history);
    if (state.sidebarOpen && state.sidebarPanel === "history-panel") renderHistory();
  }

  function removeHistoryEntry(id) {
    state.history = state.history.filter((e) => e.id !== id);
    saveJSON(HISTORY_KEY, state.history);
    renderHistory();
  }

  function clearHistory() {
    state.history = [];
    saveJSON(HISTORY_KEY, state.history);
    renderHistory();
  }

  function toggleBookmarkForActiveTab() {
    const tab = getActiveTab();
    const url = normalizeUrl(tab?.url);
    if (!url) return;
    const existing = state.bookmarks.find((b) => b.url === url);
    if (existing) {
      state.bookmarks = state.bookmarks.filter((b) => b.url !== url);
    } else {
      state.bookmarks.unshift({
        id: uid(),
        url,
        title: displayTitle(tab),
        createdAt: Date.now(),
      });
    }
    saveJSON(BOOKMARKS_KEY, state.bookmarks);
    updateBookmarkButton();
    if (state.sidebarOpen && state.sidebarPanel === "bookmarks-panel") renderBookmarks();
  }

  function removeBookmark(id) {
    state.bookmarks = state.bookmarks.filter((b) => b.id !== id);
    saveJSON(BOOKMARKS_KEY, state.bookmarks);
    renderBookmarks();
    updateBookmarkButton();
  }

  function clearBookmarks() {
    state.bookmarks = [];
    saveJSON(BOOKMARKS_KEY, state.bookmarks);
    renderBookmarks();
    updateBookmarkButton();
  }

  function setSidebar(open, panel) {
    state.sidebarOpen = open;
    if (panel) state.sidebarPanel = panel;
    renderSidebar();
    // Allow layout to settle before measuring bounds.
    requestAnimationFrame(() => {
      updateActiveTabBounds();
    });
  }

  function bindEvents() {
    newTabBtn.addEventListener("click", () => createTab(HOME_URL));

    backBtn.addEventListener("click", () => {
      const tab = getActiveTab();
      if (tab && invoke) invoke("browser_tab_back", { label: tab.label }).catch(console.error);
    });

    forwardBtn.addEventListener("click", () => {
      const tab = getActiveTab();
      if (tab && invoke) invoke("browser_tab_forward", { label: tab.label }).catch(console.error);
    });

    reloadBtn.addEventListener("click", () => {
      const tab = getActiveTab();
      if (tab && invoke) invoke("browser_tab_reload", { label: tab.label }).catch(console.error);
    });

    homeBtn.addEventListener("click", () => navigateActiveTab(HOME_URL));

    addressForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = addressInput.value.trim();
      if (value) navigateActiveTab(value);
    });

    addressInput.addEventListener("focus", () => addressInput.select());

    bookmarkBtn.addEventListener("click", toggleBookmarkForActiveTab);

    bookmarksToggleBtn.addEventListener("click", () => {
      setSidebar(!state.sidebarOpen, state.sidebarPanel);
    });

    sidebarCloseBtn.addEventListener("click", () => setSidebar(false));

    sidebarTabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        setSidebar(true, btn.dataset.panel);
      });
    });

    clearBookmarksBtn.addEventListener("click", clearBookmarks);
    clearHistoryBtn.addEventListener("click", clearHistory);

    window.addEventListener("resize", () => {
      updateActiveTabBounds();
    });

    // Keyboard shortcuts
    window.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "t") {
        e.preventDefault();
        createTab(HOME_URL);
      } else if (key === "w") {
        e.preventDefault();
        if (state.activeTab) closeTab(state.activeTab);
      } else if (key === "l") {
        e.preventDefault();
        addressInput.focus();
        addressInput.select();
      } else if (key === "r") {
        e.preventDefault();
        const tab = getActiveTab();
        if (tab && invoke) invoke("browser_tab_reload", { label: tab.label }).catch(console.error);
      } else if (key === "b") {
        e.preventDefault();
        setSidebar(!state.sidebarOpen, "bookmarks-panel");
      } else if (key === "h") {
        e.preventDefault();
        setSidebar(!state.sidebarOpen, "history-panel");
      }
    });
  }

  async function bindTauriEvents() {
    if (!listen) return;

    await listen("tabs-updated", (event) => {
      const payload = event.payload || {};
      if (Array.isArray(payload.tabs)) {
        state.tabs = payload.tabs;
      }
      if (payload.activeTab !== undefined) {
        state.activeTab = payload.activeTab;
      }
      renderTabs();
      updateAddressBar();
    });

    await listen("tab-navigated", (event) => {
      const { label, url } = event.payload || {};
      if (!label || !url) return;
      const tab = state.tabs.find((t) => t.label === label);
      if (tab) {
        tab.url = url;
      }
      if (label === state.activeTab) {
        addressInput.value = url;
        updateBookmarkButton();
      }
      renderTabs();
      addHistoryEntry(url);
    });

    await listen("tab-loading", (event) => {
      const { label } = event.payload || {};
      if (label === state.activeTab) {
        reloadBtn.title = "Reload";
      }
    });

    await listen("tab-loaded", (event) => {
      const { label, url } = event.payload || {};
      if (url) addHistoryEntry(url);
      if (label === state.activeTab) {
        updateBookmarkButton();
      }
    });
  }

  async function init() {
    bindEvents();
    renderSidebar();
    renderBookmarks();
    renderHistory();
    renderTabs();
    updateAddressBar();

    if (!invoke) {
      console.warn("Running outside Tauri; browser controls are limited.");
      setEmptyStateVisible(true);
      return;
    }

    await bindTauriEvents();

    // Start with one home tab.
    await createTab(HOME_URL);

    // Recompute bounds after initial layout.
    setTimeout(updateActiveTabBounds, 100);
    setTimeout(updateActiveTabBounds, 400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
