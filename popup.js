// popup.js - robust summarization using chrome.scripting.executeScript
document.addEventListener("DOMContentLoaded", init);


function init() {
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
        // If content script isn't available, background will fallback to minimal save
        addBtn.disabled = false;
        addBtn.textContent = "+ Add Current Page";
        renderBookmarks();
      });
    });
  });

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

      const progress = Math.min(Math.floor((b.scrollY || 0) / 20000 * 100), 100);

      div.innerHTML = `
        <h3>${escapeHtml(b.title || "Untitled Page")}</h3>
        <small>${new Date(b.createdAt).toLocaleString()}</small>
        <div class="progress"><div class="progress-bar" style="width:${progress}%"></div></div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="openBtn">Open</button>
          <button class="summaryBtn">Summarize</button>
          <button class="deleteBtn" style="background:#ef4444">Delete</button>
        </div>
        <div class="summaryText" style="margin-top:8px;font-size:13px;color:#334155;display:none;"></div>
      `;

      const openBtn = div.querySelector(".openBtn");
      const summaryBtn = div.querySelector(".summaryBtn");
      const deleteBtn = div.querySelector(".deleteBtn");
      const summaryText = div.querySelector(".summaryText");

      openBtn.addEventListener("click", async () => {
        // Open tab and inject marker
        const tab = await chrome.tabs.create({ url: b.url });
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

    // execute extraction inside the target tab
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Extraction runs in page context
          function largestTextSnippet(limit = 5000) {
            try {
              // prefer article/main/role=main
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
                // evaluate paragraphs and divs to find the biggest block
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
      if (!content || content.length < 50) throw new Error("Page content too short or blocked (some sites prevent script access).");

      // produce an extractive summary
      return makeSummary(content, 3);

    } finally {
      // close the temporary tab if we created it
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
      // fallback timeout => resolve anyway (we'll try extraction even if not fully complete)
      setTimeout(() => {
        if (!done) { done = true; chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }
      }, timeoutMs);
    });
  }

  // --- Simple extractive summarizer using sentence scoring ---
  function makeSummary(text, maxSentences = 3) {
    // split into sentences
    const rawSentences = text.match(/[^.!?]+[.!?]*/g) || [text];
    const sentences = rawSentences.map(s => s.trim()).filter(Boolean);
    if (sentences.length <= maxSentences) return sentences.join(" ");

    // build word frequencies ignoring common stopwords
    const stopwords = new Set([
      "the","and","is","in","to","of","a","for","that","on","with","as","are","it","this","was","by","an","be",
      "or","from","at","we","our","you","your","i","they","their","but","have","has","not","can","will","which"
    ]);
    const freq = Object.create(null);

    for (const s of sentences) {
      const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
      for (const w of words) if (!stopwords.has(w)) freq[w] = (freq[w] || 0) + 1;
    }

    // score sentences
    const scored = sentences.map((s, idx) => {
      const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
      let score = 0;
      for (const w of words) if (freq[w]) score += freq[w];
      // normalize slightly by length
      score = score / Math.sqrt(words.length || 1);
      return { idx, s, score };
    });

    // pick top N sentences
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, maxSentences).sort((a, b) => a.idx - b.idx);
    return top.map(x => x.s).join(" ");
  }

  function escapeHtml(str) {
    return str ? str.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])) : "";
  }
}
