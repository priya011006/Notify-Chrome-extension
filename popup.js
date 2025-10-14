// popup.js - robust summarization using chrome.scripting.executeScript

document.addEventListener("DOMContentLoaded", init);

// Listen for bookmark updates from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'bookmarkUpdated') {
    // Update the UI if the popup is open
    updateBookmarkProgressInUI(message.bookmarkId, message.progress);
  }
  return true;
});

// Helper function to update progress bar in UI without full re-render
function updateBookmarkProgressInUI(bookmarkId, progress) {
  const bookmarkItem = document.querySelector(`[data-bookmark-id="${bookmarkId}"]`);
  if (bookmarkItem) {
    const progressBar = bookmarkItem.querySelector('.progress-bar');
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
      progressBar.classList.add('updating');
      setTimeout(() => progressBar.classList.remove('updating'), 1000);
    }
  }
}

async function init() {
  // ---- storage helpers (promise wrappers) ----
  const storageGet = (keys) => new Promise(resolve => chrome.storage.local.get(keys, resolve));
  const storageSet = (obj) => new Promise(resolve => chrome.storage.local.set(obj, resolve));

  // ---- Theme handling (top-right toggle) ----
  const themeToggle = document.getElementById("themeToggle");
  const themeIcon = themeToggle?.querySelector(".icon");

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("dark", isDark);
    if (themeIcon) themeIcon.textContent = isDark ? "🌙" : "🌞";
    if (themeToggle) themeToggle.setAttribute("aria-pressed", isDark ? "true" : "false");
  }

  try {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const stored = await storageGet({ theme: prefersDark ? "dark" : "light" });
    const initialTheme = stored.theme || (prefersDark ? "dark" : "light");
    applyTheme(initialTheme);
  } catch (err) {
    console.warn("Theme init error:", err);
    applyTheme("light");
  }

  themeToggle?.addEventListener("click", async () => {
    try {
      const isDarkNow = document.body.classList.toggle("dark");
      const theme = isDarkNow ? "dark" : "light";
      applyTheme(theme);
      await storageSet({ theme });

      // rotation animation
      if (themeToggle.animate) {
        themeToggle.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
          duration: 540,
          easing: "ease-in-out"
        });
      } else {
        themeToggle.style.transform = "rotate(360deg)";
        setTimeout(() => (themeToggle.style.transform = ""), 540);
      }
    } catch (e) {
      console.error("Theme toggle failed:", e);
    }
  });

  // ---- Existing popup logic ----
  const listEl = document.getElementById("bookmarkList");
  const restoreBtn = document.getElementById("restoreAll");
  const clearBtn = document.getElementById("clearAll");
  const addBtn = document.getElementById("addCurrent");
  const openCalendarBtn = document.getElementById("openCalendar");
  const openDashboardBtn = document.getElementById("openDashboard");
  const openAssistantBtn = document.getElementById("openAssistant");
  const calendarModal = document.getElementById("calendarModal");
  const closeCalendar = document.getElementById("closeCalendar");
  const summarizeCurrentBtn = null;
  const summarizeCurrentActionBtn = null;
  const sortBy = document.getElementById("sortBy");
  const viewToggle = document.getElementById("viewToggle");
  const pinnedOnly = document.getElementById("pinnedOnly");
  const quickStats = document.getElementById("quickStats");
  // Assistant UI refs
  // Removed inline assistant; now modal-triggered via header icon (setup later)
  const modeSelect = null;
  const summaryStyleWrap = null;
  const rewriteToneWrap = null;
  const translateLangWrap = null;
  const templateSelectWrap = null;
  const summaryStyleSel = null;
  const rewriteToneSel = null;
  const translateLangInput = null;
  const templateSelect = null;
  const assistantInput = null;
  const assistantRun = null;
  const assistantUseCurrent = null;
  const assistantOutput = null;
  const ASSISTANT_CACHE_KEY = 'assistantCacheV1';

  restoreBtn?.addEventListener("click", () => chrome.runtime.sendMessage({ action: "restoreAll" }));
  clearBtn?.addEventListener("click", () => {
    if (confirm("Clear all saved progress?")) {
      chrome.runtime.sendMessage({ action: "clearBookmarks" }, renderBookmarks);
    }
  });

  addBtn?.addEventListener("click", async () => {
    addBtn.disabled = true;
    addBtn.textContent = "Adding...";
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) {
        addBtn.disabled = false;
        addBtn.textContent = "+ Add Current Page";
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action: "captureProgress" }, (resp) => {
        addBtn.disabled = false;
        addBtn.textContent = "+ Add Current Page";
        renderBookmarks();
      });
    });
  });

  // Calendar modal open/close
  openCalendarBtn?.addEventListener("click", () => {
    calendarModal?.classList.add("open");
    calendarModal?.setAttribute("aria-hidden", "false");
  });
  closeCalendar?.addEventListener("click", () => {
    calendarModal?.classList.remove("open");
    calendarModal?.setAttribute("aria-hidden", "true");
  });

  // Assistant modal open/close
  const assistantModal = document.getElementById('assistantModal');
  const closeAssistant = document.getElementById('closeAssistant');
  const assistantBookmarkSel = document.getElementById('assistantBookmark');
  const assistantLoadBookmark = document.getElementById('assistantLoadBookmark');
  const assistantIntent = document.getElementById('assistantIntent');
  openAssistantBtn?.addEventListener("click", () => {
    if (assistantModal) {
      assistantModal.classList.add('open');
      assistantModal.setAttribute('aria-hidden','false');
      const ta = assistantModal.querySelector('#assistantInput');
      setTimeout(() => ta?.focus(), 100);
    }
  });
  closeAssistant?.addEventListener('click', () => {
    if (assistantModal) {
      assistantModal.classList.remove('open');
      assistantModal.setAttribute('aria-hidden','true');
    }
  });
  assistantModal?.addEventListener('click', (e) => {
    if (e.target === assistantModal) {
      assistantModal.classList.remove('open');
      assistantModal.setAttribute('aria-hidden','true');
    }
  });

  // Populate bookmark chooser on open
  openAssistantBtn?.addEventListener('click', () => {
    chrome.storage.local.get({ bookmarks: [] }, (data) => {
      if (!assistantBookmarkSel) return;
      assistantBookmarkSel.innerHTML = '';
      (data.bookmarks||[]).forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.title || b.url;
        assistantBookmarkSel.appendChild(opt);
      });
    });
  });

  assistantLoadBookmark?.addEventListener('click', () => {
    const id = assistantBookmarkSel?.value;
    if (!id) return;
    chrome.storage.local.get({ bookmarks: [] }, async (data) => {
      const b = (data.bookmarks||[]).find(x => String(x.id) === String(id));
      if (!b) return;
      try {
        const content = await extractBookmarkText(b);
        if (assistantInput) assistantInput.value = content || '';
      } catch {
        if (assistantInput) assistantInput.value = '';
      }
    });
  });

  // Dashboard modal open/close
  const dashboardModal = document.getElementById('dashboardModal');
  const closeDashboard = document.getElementById('closeDashboard');
  openDashboardBtn?.addEventListener('click', () => {
    if (dashboardModal) {
      dashboardModal.classList.add('open');
      dashboardModal.setAttribute('aria-hidden','false');
      initDashboard();
    }
  });
  closeDashboard?.addEventListener('click', () => {
    if (dashboardModal) {
      dashboardModal.classList.remove('open');
      dashboardModal.setAttribute('aria-hidden','true');
    }
  });
  dashboardModal?.addEventListener('click', (e) => {
    if (e.target === dashboardModal) {
      dashboardModal.classList.remove('open');
      dashboardModal.setAttribute('aria-hidden','true');
    }
  });
  calendarModal?.addEventListener("click", (e) => {
    if (e.target === calendarModal) {
      calendarModal.classList.remove("open");
      calendarModal.setAttribute("aria-hidden", "true");
    }
  });

  // Summarize current removed

  // Helper function to check if a bookmark with the same URL already exists
  function bookmarkExists(url) {
    return new Promise(resolve => {
      chrome.storage.local.get({ bookmarks: [] }, (data) => {
        const bookmarks = data.bookmarks || [];
        const exists = bookmarks.findIndex(b => b.url.split('#')[0] === url.split('#')[0]);
        resolve(exists);
      });
    });
  }

  renderBookmarks();

  // Renders saved items
  function renderBookmarks() {
    chrome.storage.local.get({ bookmarks: [] }, async (data) => {
      let bookmarks = data.bookmarks || [];

      // Pinned filter
      const pinnedPref = (await storageGet({ pinnedOnly: false })).pinnedOnly || false;
      if (pinnedOnly) pinnedOnly.checked = !!pinnedPref;
      if (pinnedPref) bookmarks = bookmarks.filter(b => b.pinned);

      // Sorting
      const pref = (await storageGet({ sortBy: 'date_desc' })).sortBy || 'date_desc';
      if (sortBy) sortBy.value = pref;
      bookmarks = sortBookmarks(bookmarks, pref);
      if (bookmarks.length === 0) {
        listEl.innerHTML = `<p>No saved pages yet. Click “+ Add Current Page” to start!</p>`;
        return;
      }

      // Apply view preference to list container and progress filters
      const viewPref = (await storageGet({ view: 'list' })).view || 'list';
      listEl.classList.toggle('grid', viewPref === 'grid');
      listEl.innerHTML = "";

      const filterPref = (await storageGet({ progressFilter: 'all' })).progressFilter || 'all';
      if (filterPref !== 'all') {
        const pct = (x) => x && x.isYouTube && x.duration > 0 ? (x.currentTime || 0) / x.duration : (x.scrollY || 0) / (x.docHeight || 1);
        if (filterPref === 'high') bookmarks = bookmarks.filter(b => pct(b) >= 0.7);
        if (filterPref === 'mid') bookmarks = bookmarks.filter(b => pct(b) >= 0.3 && pct(b) < 0.7);
        if (filterPref === 'low') bookmarks = bookmarks.filter(b => pct(b) < 0.3);
      }

      // Quick stats (without average progress)
      if (quickStats) {
        const total = (data.bookmarks || []).length;
        const pinned = (data.bookmarks || []).filter(b => b.pinned).length;
        quickStats.textContent = `Total: ${total} · Pinned: ${pinned}`;
      }
      for (const b of bookmarks) {
        const div = document.createElement("div");
        div.className = viewPref === 'grid' ? "item item-grid" : "item";
        div.setAttribute("data-bookmark-id", b.id);

        // Calculate progress
        // For videos: prefer time-based percent if available
        let progress = 0;
        if (b.isYouTube && typeof b.currentTime === "number" && typeof b.duration === "number" && b.duration > 0) {
          progress = Math.min(Math.floor((b.currentTime / b.duration) * 100), 100);
        } else {
          // Article scroll-based progress
          progress = b.scrollY ? Math.min(Math.floor(b.scrollY / (b.docHeight || 20000) * 100), 100) : 0;
        }


        const isCurrent = (await chrome.tabs.query({ active: true, currentWindow: true }))
  .some(t => t.url && t.url.startsWith(b.url.split("#")[0]));

const favicon = `https://www.google.com/s2/favicons?domain=${new URL(b.url).hostname}&sz=32`;
div.innerHTML = `
  <h3>${escapeHtml(b.title || "Untitled Page")}</h3>
  <small>${new Date(b.createdAt).toLocaleString()}</small>
  <div class="progress">
    <div class="progress-bar ${isCurrent ? "updating" : ""}" style="width:${progress}%"></div>
  </div>

          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            <button class="openBtn">Open</button>
            <button class="assistantOpenBtn">Assistant</button>
            <button class="renameBtn">Rename</button>
            <button class="pinBtn" title="Pin">${b.pinned ? '⭐' : '☆'}</button>
            <button class="deleteBtn" style="background:#ef4444">Delete</button>
          </div>
          <div class="summaryText" style="display:none"></div>
        `;

        const openBtn = div.querySelector(".openBtn");
        const summaryBtn = null;
        const deleteBtn = div.querySelector(".deleteBtn");
        const renameBtn = div.querySelector(".renameBtn");
        const pinBtn = div.querySelector(".pinBtn");
        const assistantOpenBtn = div.querySelector('.assistantOpenBtn');
        const itemAssistantBtn = null;
        const itemPanel = null;
        renameBtn.addEventListener("click", () => {
          const newTitle = prompt("Rename bookmark:", b.title || "");
          if (newTitle === null) return;
          const title = newTitle.trim();
          chrome.storage.local.get({ bookmarks: [] }, (d) => {
            const all = d.bookmarks || [];
            const idx = all.findIndex(x => x.id === b.id);
            if (idx >= 0) {
              all[idx].title = title || all[idx].title;
              chrome.storage.local.set({ bookmarks: all }, () => renderBookmarks());
            }
          });
        });
        const summaryText = div.querySelector(".summaryText");

        openBtn.addEventListener("click", async () => {
          const tab = await chromeTabsCreatePromise({ url: b.url });
          chrome.storage.local.set({ currentReading: { url: b.url, scrollY: b.scrollY } });
        });

        // Per-item Assistant: open modal and preload bookmark content
        assistantOpenBtn?.addEventListener('click', async () => {
          const m = document.getElementById('assistantModal');
          if (!m) return;
          m.classList.add('open');
          m.setAttribute('aria-hidden','false');
          const ta = m.querySelector('#assistantInput');
          try {
            const content = await extractBookmarkText(b);
            if (ta) ta.value = content || '';
          } catch {
            if (ta) ta.value = '';
          }
          setTimeout(() => ta?.focus(), 100);
        });

        deleteBtn.addEventListener("click", () => deleteBookmark(b.id));
        pinBtn.addEventListener("click", () => togglePin(b.id));
        listEl.appendChild(div);
      }
    });
  }

  // === Assistant UI logic ===
  function updateModeOptions() {
    const mode = modeSelect?.value || 'summarize';
    if (!summaryStyleWrap || !rewriteToneWrap || !translateLangWrap || !templateSelectWrap) return;
    summaryStyleWrap.style.display = mode === 'summarize' ? '' : 'none';
    rewriteToneWrap.style.display = mode === 'rewrite' ? '' : 'none';
    translateLangWrap.style.display = mode === 'translate' ? '' : 'none';
    templateSelectWrap.style.display = mode === 'template' ? '' : 'none';
  }
  modeSelect?.addEventListener('change', updateModeOptions);
  updateModeOptions();

  assistantUseCurrent?.addEventListener('click', async () => {
    assistantUseCurrent.disabled = true;
    assistantUseCurrent.textContent = 'Extracting...';
    try {
      const tab = await chromeTabsQueryPromise({ active: true, currentWindow: true }).then(ts => ts[0]);
      if (!tab) throw new Error('No active tab');
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        assistantInput.value = '';
        renderAssistantOutput('Cannot extract from internal browser pages. Paste text manually.');
        return;
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          function largestTextSnippet(limit = 6000) {
            try {
              const selectors = ['article','main','[role="main"]','section'];
              let best = null, len = 0;
              for (const s of selectors) {
                const el = document.querySelector(s);
                if (el) {
                  const t = (el.innerText||'').replace(/\s+/g,' ').trim();
                  if (t.length > len) { best = t; len = t.length; }
                }
              }
              if (!best) {
                const candidates = Array.from(document.querySelectorAll('p, div'));
                for (const c of candidates) {
                  const t = (c.innerText||'').replace(/\s+/g,' ').trim();
                  if (t.length > len) { best = t; len = t.length; }
                }
              }
              let text = best || document.body?.innerText || document.documentElement?.innerText || '';
              text = text.replace(/\s+/g,' ').trim();
              return text.slice(0, limit);
            } catch { return ''; }
          }
          return largestTextSnippet(6000);
        }
      });
      const content = results?.[0]?.result || '';
      if (!content || content.length < 40) {
        renderAssistantOutput('This page appears to have very little extractable text. Try selecting and pasting text instead.');
      }
      assistantInput.value = content;
          } catch (e) {
      assistantInput.value = '';
      renderAssistantOutput('Extraction failed due to site restrictions or dynamic content. Paste text manually.');
    } finally {
      assistantUseCurrent.disabled = false;
      assistantUseCurrent.textContent = 'Use Current Page';
    }
  });

  assistantRun?.addEventListener('click', async () => {
    const mode = modeSelect?.value || 'summarize';
    const text = (assistantInput?.value || '').trim();
    if (!text) {
      assistantOutput.textContent = 'Please paste text or use Current Page.';
      return;
    }
    // Try show cached instantly
    tryShowCachedResult(mode, text);
    assistantRun.disabled = true;
    assistantRun.textContent = 'Running...';
    try {
      const t0 = performance.now();
      let out = '';
      if (mode === 'summarize') {
        const style = summaryStyleSel?.value || 'bullet';
        const intent = assistantIntent?.value || 'default';
        let base = await summarizeByStyleWithFallback(text, style);
        if (intent === 'study') {
          base = 'Study Notes\n\n' + base;
        } else if (intent === 'share') {
          base = 'Post Draft\n\n' + base;
        } else if (intent === 'todo') {
          // schedule a task for tomorrow
          const tomorrow = new Date(Date.now() + 24*60*60*1000);
          const dateStr = tomorrow.toISOString().slice(0,10);
          const task = { id: 'task-' + Date.now(), title: 'Finish reading: ' + (assistantBookmarkSel?.selectedOptions?.[0]?.textContent || 'Saved page'), date: dateStr, createdAt: Date.now(), completed: false };
          chrome.storage.local.get({ scheduledTasks: [] }, (d) => {
            const arr = d.scheduledTasks || [];
            arr.push(task);
            chrome.storage.local.set({ scheduledTasks: arr });
          });
          base = base + `\n\n— Task scheduled for ${dateStr}`;
        }
        out = base;
      } else if (mode === 'rewrite') {
        const tone = rewriteToneSel?.value || 'formal';
        out = await rewriteWithTone(text, tone);
      } else if (mode === 'translate') {
        const lang = (translateLangInput?.value || '').trim() || 'Spanish';
        out = await translateText(text, lang);
      } else if (mode === 'template') {
        const tpl = templateSelect?.value || 'linkedin';
        out = await runTemplate(tpl, text);
      }
      const t1 = performance.now();
      const latency = ((t1 - t0) / 1000).toFixed(2);
      await saveCache(mode, text, out, Number(latency));
      const avgLatency = await updateAndGetAvgLatency(Number(latency));
      renderAssistantOutput(out + `\n\n— Generated in ${latency}s (avg ${avgLatency.toFixed(2)}s)`);
    } catch (e) {
      renderAssistantOutput('Operation failed. Showing best-effort fallback.');
    } finally {
      assistantRun.disabled = false;
      assistantRun.textContent = 'Run';
    }
  });

  function renderAssistantOutput(content) {
    if (!assistantOutput) return;
    assistantOutput.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.margin = '0';
    pre.textContent = content;
    assistantOutput.appendChild(pre);
  }

  async function summarizeByStyle(text, style) {
    const clean = (text||'').replace(/\s+/g,' ').trim();
    if (style === 'bullet') {
      const summary = makeSummaryAdvanced(clean, 6);
      return '- ' + summary.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0,6).join('\n- ');
    }
    if (style === 'short') {
      return makeSummary(clean, 2);
    }
    if (style === 'long') {
      return makeSummaryAdvanced(clean, 8);
    }
    if (style === 'takeaways') {
      const summary = makeSummaryAdvanced(clean, 5);
      const points = summary.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0,5);
      return 'Key takeaways:\n- ' + points.join('\n- ');
    }
    return makeSummaryAdvanced(clean, 5);
  }

  async function summarizeByStyleWithFallback(text, style) {
    // Fallback order: simple extractive -> advanced -> echo guidance
    const clean = (text||'').replace(/\s+/g,' ').trim();
    if (clean.length < 40) {
      return 'Not enough text to summarize. Please provide more content.';
    }
    try {
      return await summarizeByStyle(clean, style);
    } catch {
      try {
        return makeSummary(clean, 3);
      } catch {
        return 'Unable to summarize due to content or page restrictions.';
      }
    }
  }

  async function rewriteWithTone(text, tone) {
    const prefix = {
      formal: 'Rewrite the following text in a professional, formal tone with improved clarity:',
      casual: 'Rewrite the following text in a friendly, casual tone while keeping meaning:',
      concise: 'Rewrite the following text to be concise and clear, removing redundancy:',
      creative: 'Rewrite the following text with a creative, engaging tone while preserving meaning:'
    }[tone] || 'Rewrite the following text clearly:';
    // Local heuristic rewrite: keep simple to avoid external API
    const base = (text||'').trim();
    if (!base) return '';
    return `${prefix}\n\n${base}`;
  }

  async function translateText(text, targetLang) {
    // Stub for translation; in future, hook external API.
    return `Translate to ${targetLang}:\n\n${text}`;
  }

  async function runTemplate(template, text) {
    const clean = (text||'').trim();
    if (template === 'linkedin') {
      return [
        'LinkedIn Post:',
        '',
        'Hook: [Compelling one-liner]',
        `Insight: ${makeSummary(clean, 2)}`,
        'Value: 2-3 bullet takeaways',
        'CTA: What do you think? #hashtag'
      ].join('\n');
    }
    if (template === 'studynotes') {
      return [
        'Study Notes',
        '',
        'Summary:',
        makeSummaryAdvanced(clean, 6),
        '',
        'Key Terms:',
        '- Term 1: definition',
        '- Term 2: definition',
        '',
        'Questions:',
        '- Q1',
        '- Q2'
      ].join('\n');
    }
    return makeSummaryAdvanced(clean, 5);
  }

  // === Caching helpers ===
  function stableKey(input) {
    // Use first 200 chars + mode + options as key basis
    return input.slice(0, 200);
  }

  async function saveCache(mode, text, output, latencySeconds) {
    const key = `${mode}::${stableKey(text)}`;
    const record = { key, mode, inputHead: stableKey(text), output, latencySeconds, ts: Date.now() };
    return new Promise((resolve) => {
      chrome.storage.local.get({ [ASSISTANT_CACHE_KEY]: [] }, (data) => {
        const arr = data[ASSISTANT_CACHE_KEY] || [];
        const filtered = arr.filter(x => x.key !== key).slice(-49); // keep last 49
        filtered.push(record);
        chrome.storage.local.set({ [ASSISTANT_CACHE_KEY]: filtered }, resolve);
      });
    });
  }

  function tryShowCachedResult(mode, text) {
    const key = `${mode}::${stableKey(text)}`;
    chrome.storage.local.get({ [ASSISTANT_CACHE_KEY]: [] }, (data) => {
      const arr = data[ASSISTANT_CACHE_KEY] || [];
      const hit = arr.find(x => x.key === key);
      if (hit && assistantOutput) {
        renderAssistantOutput(hit.output + (hit.latencySeconds ? `\n\n— Cached • ${hit.latencySeconds}s` : ''));
      }
    });
  }

  // Latency metrics (rolling average of last 20)
  const LAT_METRICS_KEY = 'assistantLatencyMs';
  async function updateAndGetAvgLatency(latencySeconds) {
    const latencyMs = Math.round(latencySeconds * 1000);
    return new Promise((resolve) => {
      chrome.storage.local.get({ [LAT_METRICS_KEY]: [] }, (data) => {
        const arr = (data[LAT_METRICS_KEY] || []).slice(-19);
        arr.push(latencyMs);
        chrome.storage.local.set({ [LAT_METRICS_KEY]: arr }, () => {
          const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : latencyMs;
          resolve(avg / 1000);
        });
      });
    });
  }

  // new helper
  function deleteBookmark(id) {
    chrome.storage.local.get({ bookmarks: [] }, (data) => {
      const updated = (data.bookmarks || []).filter(b => b.id !== id);
      chrome.storage.local.set({ bookmarks: updated }, () => renderBookmarks());
    });
  }

  function togglePin(id) {
    chrome.storage.local.get({ bookmarks: [] }, (data) => {
      const all = data.bookmarks || [];
      const idx = all.findIndex(b => b.id === id);
      if (idx >= 0) {
        all[idx].pinned = !all[idx].pinned;
        chrome.storage.local.set({ bookmarks: all }, () => renderBookmarks());
      }
    });
  }

  function sortBookmarks(list, mode) {
    const copy = [...list];
    // Pinned first always
    copy.sort((a, b) => (b.pinned === true) - (a.pinned === true));
    if (mode === 'title_asc') {
      copy.sort((a, b) => (b.pinned === true) - (a.pinned === true) || (a.title || '').localeCompare(b.title || ''));
    } else if (mode === 'progress_desc') {
      const pct = (x) => x && x.isYouTube && x.duration > 0 ? (x.currentTime || 0) / x.duration : (x.scrollY || 0) / (x.docHeight || 1);
      copy.sort((a, b) => (b.pinned === true) - (a.pinned === true) || (pct(b) - pct(a)));
    } else {
      // date_desc
      copy.sort((a, b) => (b.pinned === true) - (a.pinned === true) || (b.createdAt || 0) - (a.createdAt || 0));
    }
    return copy;
  }

  // === Dashboard metrics and filters ===
  function initDashboard() {
    const totalEl = document.getElementById('overviewTotal');
    const pinnedEl = document.getElementById('overviewPinned');
    const streakEl = document.getElementById('overviewStreak');
    const latencyEl = document.getElementById('overviewLatency');
    const filterAll = document.getElementById('filterAll');
    const filterHigh = document.getElementById('filterHigh');
    const filterMid = document.getElementById('filterMid');
    const filterLow = document.getElementById('filterLow');

    chrome.storage.local.get(['bookmarks','streak', 'assistantLatencyMs'], (data) => {
      const bms = data.bookmarks || [];
      if (totalEl) totalEl.textContent = String(bms.length);
      if (pinnedEl) pinnedEl.textContent = String(bms.filter(b=>b.pinned).length);
      if (streakEl) streakEl.textContent = String(data.streak || 0);
      const arr = data.assistantLatencyMs || [];
      if (latencyEl) latencyEl.textContent = arr.length ? `${(arr.reduce((a,b)=>a+b,0)/arr.length/1000).toFixed(2)}s` : '—';
    });

    const applyFilter = async (mode) => {
      await storageSet({ progressFilter: mode });
      renderBookmarks();
    };
    filterAll?.addEventListener('click', () => applyFilter('all'));
    filterHigh?.addEventListener('click', () => applyFilter('high'));
    filterMid?.addEventListener('click', () => applyFilter('mid'));
    filterLow?.addEventListener('click', () => applyFilter('low'));
  }

  // Toolbar listeners
  sortBy?.addEventListener('change', async () => {
    await storageSet({ sortBy: sortBy.value });
    renderBookmarks();
  });
  viewToggle?.addEventListener('click', async () => {
    const pref = (await storageGet({ view: 'list' })).view || 'list';
    const next = pref === 'list' ? 'grid' : 'list';
    await storageSet({ view: next });
    renderBookmarks();
  });
  pinnedOnly?.addEventListener('change', async () => {
    await storageSet({ pinnedOnly: pinnedOnly.checked });
    renderBookmarks();
  });

  // Summarize a bookmark: open tab if needed, wait for load, execute extraction, close tab if created
  async function summarizeBookmark(bookmark) {
    if (!bookmark || !bookmark.url) throw new Error("Invalid bookmark");

    // try to find an existing tab with the same URL (any window)
    const existingTabs = await chromeTabsQueryPromise({ url: bookmark.url });
    let tab;
    let created = false;
    if (existingTabs && existingTabs.length > 0) {
      tab = existingTabs[0];
    } else {
      tab = await chromeTabsCreatePromise({ url: bookmark.url, active: false });
      created = true;
    }

    // wait for the tab to finish loading (or timeout)
    await waitForTabComplete(tab.id, 10000);

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          function largestTextSnippet(limit = 5000) {
            try {
              const selectors = ['article', 'main', '[role="main"]', 'section'];
              let best = null, bestLen = 0;
              for (const s of selectors) {
                const el = document.querySelector(s);
                if (el) {
                  const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
                  if (t.length > bestLen) { best = t; bestLen = t.length; }
                }
              }
              if (!best) {
                const candidates = Array.from(document.querySelectorAll('p, div'));
                for (const c of candidates) {
                  const t = (c.innerText || '').replace(/\s+/g, ' ').trim();
                  if (t.length > bestLen) { best = t; bestLen = t.length; }
                }
              }
              let text = best || document.body?.innerText || document.documentElement?.innerText || '';
              text = text.replace(/\s+/g, ' ').trim();
              return text.slice(0, limit);
            } catch (e) {
              return '';
            }
          }
          return largestTextSnippet(5000);
        }
      });

      const content = (results && results[0] && results[0].result) ? results[0].result : '';
      if (!content || content.length < 50) throw new Error("Page content too short or blocked.");

      return makeSummary(content, 3);
    } finally {
      if (created) {
        try { await chromeTabsRemovePromise(tab.id); } catch (e) { /* ignore */ }
      }
    }
  }

  // --- Utility helpers that wrap chrome.* with Promises for convenience ---
  function chromeTabsQueryPromise(query) {
    return new Promise((resolve) => chrome.tabs.query(query, resolve));
  }
  function chromeTabsCreatePromise(createProperties) {
    return new Promise((resolve) => chrome.tabs.create(createProperties, resolve));
  }
  function chromeTabsRemovePromise(tabId) {
    return new Promise((resolve) => chrome.tabs.remove(tabId, resolve));
  }

  function waitForTabComplete(tabId, timeoutMs = 10000) {
    return new Promise((resolve) => {
      let done = false;
      const onUpdated = (id, info) => {
        if (id === tabId && info.status === "complete") {
          if (!done) { done = true; chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(() => {
        if (!done) { done = true; chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }
      }, timeoutMs);
    });
  }

  // --- Simple extractive summarizer using sentence scoring ---
  function makeSummary(text, maxSentences = 3) {
    const rawSentences = text.match(/[^.!?]+[.!?]*/g) || [text];
    const sentences = rawSentences.map(s => s.trim()).filter(Boolean);
    if (sentences.length <= maxSentences) return sentences.join(" ");

    const stopwords = new Set([
      "the","and","is","in","to","of","a","for","that","on","with","as","are","it","this","was","by","an","be",
      "or","from","at","we","our","you","your","i","they","their","but","have","has","not","can","will","which"
    ]);
    const freq = Object.create(null);

    for (const s of sentences) {
      const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
      for (const w of words) if (!stopwords.has(w)) freq[w] = (freq[w] || 0) + 1;
    }

    const scored = sentences.map((s, idx) => {
      const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
      let score = 0;
      for (const w of words) if (freq[w]) score += freq[w];
      score = score / Math.sqrt(words.length || 1);
      return { idx, s, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, maxSentences).sort((a, b) => a.idx - b.idx);
    return top.map(x => x.s).join(" ");
  }

  function escapeHtml(str) {
    return str ? str.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])) : "";
  }

  // new
   // === 🧠 Smart Daily Greeting ===
  const greetingEl = document.createElement("div");
  greetingEl.className = "dailyGreeting";
  const hours = new Date().getHours();
  const greet =
    hours < 12 ? "Good morning ☀️" :
    hours < 18 ? "Good afternoon 🌤️" :
    "Good evening 🌙";
  chrome.storage.local.get({ streak: 0 }, ({ streak }) => {
    greetingEl.textContent = `${greet} — Keep it up! ${streak > 0 ? `🔥 ${streak}-day streak!` : ""}`;
  });
  document.querySelector(".container").prepend(greetingEl);

  // === 🔍 Search Bookmarks ===
  const searchBox = document.getElementById("searchBookmarks");
  if (searchBox) {
    searchBox.addEventListener("input", () => {
      const term = searchBox.value.toLowerCase();
      const items = document.querySelectorAll(".item");
      items.forEach((it) => {
        it.style.display = it.textContent.toLowerCase().includes(term)
          ? "block"
          : "none";
      });
    });
  }

  // === 📅 Calendar Section ===
  initCalendar();

  // Calendar functionality
  function initCalendar() {
    const calendarGrid = document.getElementById("calendarGrid");
    const currentMonthEl = document.getElementById("currentMonth");
    const prevMonthBtn = document.getElementById("prevMonth");
    const nextMonthBtn = document.getElementById("nextMonth");
    const taskTitleInput = document.getElementById("taskTitle");
    const taskDateInput = document.getElementById("taskDate");
    const scheduleTaskBtn = document.getElementById("scheduleTask");

    let currentDate = new Date();
    let currentMonth = currentDate.getMonth();
    let currentYear = currentDate.getFullYear();

    // Initialize calendar
    renderCalendar();

    // Event listeners
    prevMonthBtn?.addEventListener("click", () => {
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      renderCalendar();
    });

    nextMonthBtn?.addEventListener("click", () => {
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
      renderCalendar();
    });

    scheduleTaskBtn?.addEventListener("click", () => {
      const title = taskTitleInput.value.trim();
      const date = taskDateInput.value;
      
      if (!title || !date) {
        alert("Please fill in both title and date");
        return;
      }

      const task = {
        id: 'task-' + Date.now(),
        title: title,
        date: date,
        createdAt: Date.now(),
        completed: false
      };

      // Save and request background to create an alarm
      chrome.storage.local.get({ scheduledTasks: [] }, (data) => {
        const tasks = data.scheduledTasks || [];
        tasks.push(task);
        chrome.storage.local.set({ scheduledTasks: tasks }, () => {
          chrome.runtime.sendMessage({ action: 'scheduleTask', task }, () => {
            taskTitleInput.value = '';
            taskDateInput.value = '';
            renderCalendar();
            alert('Task scheduled successfully!');
          });
        });
      });
    });

    function renderCalendar() {
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];

      currentMonthEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;

      // Get first day of month and number of days
      const firstDay = new Date(currentYear, currentMonth, 1).getDay();
      const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

      // Create calendar grid
      calendarGrid.innerHTML = '';

      // Add day headers
      const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      dayHeaders.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'calendar-day-header';
        dayHeader.textContent = day;
        calendarGrid.appendChild(dayHeader);
      });

      // Add empty cells for days before the first day of the month
      for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        calendarGrid.appendChild(emptyCell);
      }

      // Add days of the month
      for (let day = 1; day <= daysInMonth; day++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';
        dayCell.textContent = day;
        
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        dayCell.dataset.date = dateStr;

        // Check if this day has scheduled tasks
        chrome.storage.local.get({ scheduledTasks: [] }, (data) => {
          const tasks = data.scheduledTasks || [];
          const dayTasks = tasks.filter(task => task.date === dateStr);
          
          if (dayTasks.length > 0) {
            dayCell.classList.add('has-tasks');
            dayCell.title = `${dayTasks.length} task(s) scheduled`;
          }

          // Add click handler for day
          dayCell.addEventListener('click', () => {
            showDayTasks(dateStr, dayTasks);
          });
        });

        calendarGrid.appendChild(dayCell);
      }
    }

    function showDayTasks(date, tasks) {
      if (tasks.length === 0) {
        alert(`No tasks scheduled for ${date}`);
        return;
      }

      let message = `Tasks for ${date}:\n\n`;
      tasks.forEach((task, index) => {
        const status = task.completed ? '✅' : '⏳';
        message += `${index + 1}. ${status} ${task.title}\n`;
      });

      const action = confirm(message + '\n\nClick OK to mark tasks as completed, Cancel to close');
      if (action) {
        // Mark all tasks as completed
        chrome.storage.local.get({ scheduledTasks: [] }, (data) => {
          const allTasks = data.scheduledTasks || [];
          allTasks.forEach(task => {
            if (task.date === date) {
              task.completed = true;
            }
          });
          chrome.storage.local.set({ scheduledTasks: allTasks }, () => {
            renderCalendar();
            alert('Tasks marked as completed!');
          });
        });
      }
    }
  }

  // === 🧠 Gemini API Summarization (fallback to local) ===
  async function summarizeBookmark(bookmark) {
    const text = await extractBookmarkText(bookmark);
    let summary = await summarizeWithStrongFallback(text);
    return summary;
  }

  // Extract text content from bookmark
  async function extractBookmarkText(bookmark) {
    if (!bookmark || !bookmark.url) throw new Error("Invalid bookmark");

    // try to find an existing tab with the same URL (any window)
    const existingTabs = await chromeTabsQueryPromise({ url: bookmark.url });
    let tab;
    let created = false;
    if (existingTabs && existingTabs.length > 0) {
      tab = existingTabs[0];
    } else {
      tab = await chromeTabsCreatePromise({ url: bookmark.url, active: false });
      created = true;
    }

    // wait for the tab to finish loading (or timeout)
    await waitForTabComplete(tab.id, 10000);

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          function largestTextSnippet(limit = 5000) {
            try {
              const selectors = ['article', 'main', '[role="main"]', 'section'];
              let best = null, bestLen = 0;
              for (const s of selectors) {
                const el = document.querySelector(s);
                if (el) {
                  const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
                  if (t.length > bestLen) { best = t; bestLen = t.length; }
                }
              }
              if (!best) {
                const candidates = Array.from(document.querySelectorAll('p, div'));
                for (const c of candidates) {
                  const t = (c.innerText || '').replace(/\s+/g, ' ').trim();
                  if (t.length > bestLen) { best = t; bestLen = t.length; }
                }
              }
              let text = best || document.body?.innerText || document.documentElement?.innerText || '';
              text = text.replace(/\s+/g, ' ').trim();
              return text.slice(0, limit);
            } catch (e) {
              return '';
            }
          }
          return largestTextSnippet(5000);
        }
      });

      const content = (results && results[0] && results[0].result) ? results[0].result : '';
      if (!content || content.length < 50) throw new Error("Page content too short or blocked.");
      return content;
    } finally {
      if (created) {
        try { await chromeTabsRemovePromise(tab.id); } catch (e) { /* ignore */ }
      }
    }
  }

  // Strong summarization with layered fallbacks (Gemini -> heuristic extractive)
  async function summarizeWithStrongFallback(content) {
    const clean = (content || "").replace(/\s+/g, " ").trim();
    if (clean.length === 0) return "No content to summarize.";
    const tryGemini = async () => {
      const GEMINI_API_KEY = "AIzaSyB9uUNxH_wxk1rHnriJoefhGZ_TdokMS4A";
      if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("AIzaSyB9uUNxH_wxk1rHnriJoefhGZ_TdokMS4A")) return null;
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                { parts: [ { text: `Summarize concisely in 4-6 sentences. Provide key points and any steps or takeaways if present.\n\n${clean}` } ] }
              ]
            })
          }
        );
        if (!response.ok) {
          // Handle common rate limiting or server errors
          if (response.status === 429) throw new Error('RATE_LIMIT');
          throw new Error('HTTP_' + response.status);
        }
        const data = await response.json();
        const txt = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return txt.trim().length > 0 ? txt : null;
      } catch (e) {
        console.warn("Gemini failed", e);
        // Backoff once then return null
        await new Promise(r => setTimeout(r, 600));
        return null;
      }
    };
    const fromGemini = await tryGemini();
    if (fromGemini) return fromGemini;
    return makeSummaryAdvanced(clean, 5);
  }

  // Advanced heuristic extractive summarizer
  function makeSummaryAdvanced(text, maxSentences = 5) {
    const rawSentences = text.match(/[^.!?]+[.!?]*/g) || [text];
    const sentences = rawSentences.map(s => s.trim()).filter(Boolean);
    if (sentences.length <= maxSentences) return sentences.join(" ");
    const stop = new Set(["the","and","is","in","to","of","a","for","that","on","with","as","are","it","this","was","by","an","be","or","from","at","we","our","you","your","i","they","their","but","have","has","not","can","will","which","if","then","so","than","also"]);
    const freq = Object.create(null);
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    for (const w of words) if (!stop.has(w)) freq[w] = (freq[w] || 0) + 1;
    const scored = sentences.map((s, idx) => {
      const w = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
      let score = 0;
      for (const t of w) if (freq[t]) score += freq[t];
      // Slightly reward earlier sentences and longer informative ones
      score = score / Math.sqrt(w.length || 1) + (1 / (1 + idx));
      return { idx, s, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, maxSentences).sort((a, b) => a.idx - b.idx);
    return top.map(x => x.s).join(" ");
  }

}