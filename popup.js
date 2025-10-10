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
      const bookmarks = data.bookmarks || [];
      if (bookmarks.length === 0) {
        listEl.innerHTML = `<p>No saved pages yet. Click “+ Add Current Page” to start!</p>`;
        return;
      }

      listEl.innerHTML = "";
      for (const b of bookmarks) {
        const div = document.createElement("div");
        div.className = "item";
        div.setAttribute("data-bookmark-id", b.id);

        // Calculate progress based on scroll position relative to document height
        // Default to 0 if scrollY is not available
        const progress = b.scrollY ? Math.min(Math.floor(b.scrollY / (b.docHeight || 20000) * 100), 100) : 0;


        const isCurrent = (await chrome.tabs.query({ active: true, currentWindow: true }))
  .some(t => t.url && t.url.startsWith(b.url.split("#")[0]));

div.innerHTML = `
  <h3>${escapeHtml(b.title || "Untitled Page")}</h3>
  <small>${new Date(b.createdAt).toLocaleString()}</small>
  <div class="progress">
    <div class="progress-bar ${isCurrent ? "updating" : ""}" style="width:${progress}%"></div>
  </div>

          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            <button class="openBtn">Open</button>
            <button class="summaryBtn">Summarize</button>
            <button class="deleteBtn" style="background:#ef4444">Delete</button>
          </div>
          <div class="summaryText" style="margin-top:8px;font-size:13px;color:var(--text-color);display:none;"></div>
        `;

        const openBtn = div.querySelector(".openBtn");
        const summaryBtn = div.querySelector(".summaryBtn");
        const deleteBtn = div.querySelector(".deleteBtn");
        const summaryText = div.querySelector(".summaryText");

        openBtn.addEventListener("click", async () => {
          const tab = await chromeTabsCreatePromise({ url: b.url });
          chrome.storage.local.set({ currentReading: { url: b.url, scrollY: b.scrollY } });
        });

        summaryBtn.addEventListener("click", async () => {
          summaryBtn.textContent = "Summarizing...";
          summaryBtn.disabled = true;
          try {
            const summary = await summarizeBookmark(b);
            summaryText.style.display = "block";
            summaryText.textContent = summary;
          } catch (e) {
            summaryText.style.display = "block";
            summaryText.textContent = "Could not summarize this page.";
            console.warn("Summary failed:", e);
          }
          summaryBtn.textContent = "Summarize";
          summaryBtn.disabled = false;
        });

        deleteBtn.addEventListener("click", () => deleteBookmark(b.id));
        listEl.appendChild(div);
      }
    });
  }

  // new helper
  function deleteBookmark(id) {
    chrome.storage.local.get({ bookmarks: [] }, (data) => {
      const updated = (data.bookmarks || []).filter(b => b.id !== id);
      chrome.storage.local.set({ bookmarks: updated }, () => renderBookmarks());
    });
  }

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
}