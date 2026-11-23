const API_BASE = "https://dropvid-backend.onrender.com";

const DL_ICON = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <path d="M12 3v13M5 16l7 7 7-7"/><path d="M3 21h18"/>
  </svg>`;

const grid = document.getElementById("urlGrid");
for (let i = 0; i < 10; i++) {
  const field = document.createElement("div");
  field.className = "url-field";
  field.innerHTML = `
    <span class="url-num">${i + 1}</span>
    <input class="url-input" id="url${i}" type="url" placeholder="https://..." />
  `;
  grid.appendChild(field);
}

// Video titles/URLs come from other websites, so never put them into the
// page as raw HTML.
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function getUrls() {
  return Array.from({ length: 10 }, (_, i) =>
    document.getElementById(`url${i}`).value.trim()
  ).filter(Boolean);
}

function showError(msg) {
  const el = document.getElementById("errorBanner");
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

function formatDuration(sec) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function fetchVideos() {
  const urls = getUrls();
  if (!urls.length) { showError("Paste at least one URL to continue."); return; }

  const btn = document.getElementById("fetchBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Fetching info...`;
  showError("");
  document.getElementById("results").innerHTML = "";

  try {
    const res = await fetch(`${API_BASE}/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to fetch video info");
    renderResults(data.results);
    document.getElementById("clearBtn").style.display = "block";
  } catch (e) {
    showError(e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg> Fetch Videos`;
  }
}

function renderResults(results) {
  const container = document.getElementById("results");
  const successful = results.filter(r => r.success).length;
  container.innerHTML = `<p class="results-heading">Results — ${successful} found</p>`;

  results.forEach((r, i) => {
    if (!r.success) {
      const card = document.createElement("div");
      card.className = "failed-card";
      card.innerHTML = `
        <span style="color:#f87171;font-size:20px">✕</span>
        <div>
          <p class="failed-url">${esc(r.url)}</p>
          <p class="failed-reason">${esc(r.error || "Could not fetch this video")}</p>
        </div>`;
      container.appendChild(card);
      return;
    }

    const qualities = r.qualities && r.qualities.length
      ? r.qualities
      : [{ value: "worst", label: "Data Saver", size_mb: null }, { value: "audio", label: "Audio (MP3)", size_mb: null }];

    const dataSaver = qualities.find(q => q.value === "worst");
    const videoQualities = qualities.filter(q => q.value !== "audio" && q.value !== "worst");
    const defaultQuality = dataSaver
      ? "worst"
      : (videoQualities.length ? videoQualities[videoQualities.length - 1].value : qualities[0].value);

    const qualityOptions = qualities
      .map(q => {
        const sizeText = q.size_mb ? ` (~${q.size_mb} MB)` : "";
        const selected = q.value === defaultQuality ? "selected" : "";
        return `<option value="${esc(q.value)}" ${selected}>${esc(q.label)}${sizeText}</option>`;
      })
      .join("");

    const card = document.createElement("div");
    card.className = "video-card";
    card.innerHTML = `
      <div class="card-index">#${i + 1}</div>
      ${r.thumbnail ? `
        <div class="thumbnail-wrap">
          <img class="thumbnail" src="${esc(r.thumbnail)}" alt="${esc(r.title)}" />
          ${r.duration ? `<span class="duration">${formatDuration(r.duration)}</span>` : ""}
        </div>` : ""}
      <div class="card-info">
        <p class="platform-badge">${esc(r.platform || "")}</p>
        <h3 class="video-title">${esc(r.title)}</h3>
        <div class="quality-row">
          <select class="quality-select" id="qualitySelect${i}">
            ${qualityOptions}
          </select>
          <button class="dl-btn" id="dlBtn${i}">${DL_ICON} Download</button>
        </div>
        <p class="error-msg" id="dlError${i}"></p>
      </div>`;
    container.appendChild(card);

    document.getElementById(`dlBtn${i}`).addEventListener("click", () => downloadVideo(r.url, i));
  });
}

// Hands the actual file transfer to the browser's own download manager
// (progress bar, pause/resume, no waiting for the whole video to load
// into the page first). A hidden frame is used so that if anything goes
// wrong the visitor is never navigated away from the page.
function startNativeDownload(href) {
  const frame = document.createElement("iframe");
  frame.style.display = "none";
  frame.src = href;
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 5 * 60 * 1000);
}

async function downloadVideo(url, index) {
  const btn = document.getElementById(`dlBtn${index}`);
  const errEl = document.getElementById(`dlError${index}`);
  const qualitySelect = document.getElementById(`qualitySelect${index}`);
  const quality = qualitySelect ? qualitySelect.value : "worst";

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Preparing...`;
  errEl.style.color = "";
  errEl.textContent = "";

  try {
    const res = await fetch(`${API_BASE}/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, quality }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Download failed");

    startNativeDownload(`${API_BASE}/file/${data.token}`);

    // Keep the button locked for a few seconds so a second click can't
    // start a duplicate download, and tell the visitor where to look.
    btn.innerHTML = `${DL_ICON} Started`;
    errEl.style.color = "var(--muted)";
    errEl.textContent = "Your download has started — check your browser's downloads.";
    await new Promise(resolve => setTimeout(resolve, 5000));
  } catch (e) {
    errEl.style.color = "";
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${DL_ICON} Download`;
  }
}

function clearAll() {
  for (let i = 0; i < 10; i++) document.getElementById(`url${i}`).value = "";
  document.getElementById("results").innerHTML = "";
  document.getElementById("clearBtn").style.display = "none";
  showError("");
}
