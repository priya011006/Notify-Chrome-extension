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
  const calendarModal = document.getElementById("calendarModal");
  const closeCalendar = document.getElementById("closeCalendar");
  const summarizeCurrentBtn = null;
  const summarizeCurrentActionBtn = null;
  const sortBy = document.getElementById("sortBy");
  const viewToggle = document.getElementById("viewToggle");
  const pinnedOnly = document.getElementById("pinnedOnly");
  const quickStats = document.getElementById("quickStats");

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

      // Apply view preference to list container
      const viewPref = (await storageGet({ view: 'list' })).view || 'list';
      listEl.classList.toggle('grid', viewPref === 'grid');
      listEl.innerHTML = "";

      // Quick stats
      if (quickStats) {
        const total = (data.bookmarks || []).length;
        const pinned = (data.bookmarks || []).filter(b => b.pinned).length;
        const avg = Math.round(((data.bookmarks || []).reduce((a, b) => a + ((b.isYouTube && b.duration > 0) ? ((b.currentTime||0)/(b.duration)) : ((b.scrollY||0)/(b.docHeight||1))), 0) / Math.max(total,1)) * 100);
        quickStats.textContent = `Total: ${total} · Pinned: ${pinned} · Avg progress: ${isFinite(avg)?avg:0}%`;
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
            <button class="summaryBtn">Summarize</button>
            <button class="renameBtn">Rename</button>
            <button class="pinBtn" title="Pin">${b.pinned ? '⭐' : '☆'}</button>
            <button class="deleteBtn" style="background:#ef4444">Delete</button>
          </div>
          <div class="summaryText" style="margin-top:8px;font-size:13px;color:var(--text-color);display:none;"></div>
        `;

        const openBtn = div.querySelector(".openBtn");
        const summaryBtn = div.querySelector(".summaryBtn");
        const deleteBtn = div.querySelector(".deleteBtn");
        const renameBtn = div.querySelector(".renameBtn");
        const pinBtn = div.querySelector(".pinBtn");
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
        pinBtn.addEventListener("click", () => togglePin(b.id));
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
        const data = await response.json();
        const txt = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return txt.trim().length > 0 ? txt : null;
      } catch (e) {
        console.warn("Gemini failed", e);
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