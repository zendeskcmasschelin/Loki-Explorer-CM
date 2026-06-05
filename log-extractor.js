(function() {
  const STATE = {
    allLogs: [],
    filteredLogs: [],
    filters: { INFO: true, WARN: true, ERROR: true },
    selectedLog: null,
    isLoading: false,
    currentQuery: null,
    lastLogTimestamp: null,
    hasMoreLogs: true,
    timeRangeMinutes: 5,
    sortOrder: "DESC"
  };

  const STYLES = `
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .grafana-loading-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.9); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 100000; border-radius: 8px; animation: fadeIn 0.3s ease-in-out; }
    .grafana-spinner { width: 60px; height: 60px; border: 4px solid #334155; border-top: 4px solid #0ea5e9; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 15px; }
    .grafana-loading-text { color: #cbd5e1; font-size: 14px; font-weight: bold; text-align: center; }
    .grafana-loading-subtext { color: #94a3b8; font-size: 12px; margin-top: 8px; text-align: center; }
    .load-more-button { padding: 10px 15px; background: #6366f1; border: 1px solid #4f46e5; color: #fff; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; margin: 15px; text-align: center; transition: all 0.2s; }
    .load-more-button:hover { background: #4f46e5; }
    .load-more-button:disabled { background: #475569; cursor: not-allowed; opacity: 0.6; }
    .query-input { padding: 6px 10px; background: #1e293b; border: 1px solid #475569; color: #cbd5e1; border-radius: 4px; font-family: 'Monaco', 'Courier New', monospace; font-size: 11px; flex: 1; min-width: 300px; }
    .query-input:focus { outline: none; border-color: #0ea5e9; box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.2); }
    .time-input { padding: 6px 10px; background: #1e293b; border: 1px solid #475569; color: #cbd5e1; border-radius: 4px; font-family: 'Monaco', 'Courier New', monospace; font-size: 11px; width: 80px; }
    .time-input:focus { outline: none; border-color: #0ea5e9; box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.2); }
  `;

  function injectStyles() {
    if (!document.getElementById("grafana-extractor-styles")) {
      const styleEl = document.createElement("style");
      styleEl.id = "grafana-extractor-styles";
      styleEl.textContent = STYLES;
      document.head.appendChild(styleEl);
    }
  }

  function parseUrlForTimeRange() {
    const url = window.location.href;
    const urlParams = new URLSearchParams(new URL(url).search);
    let minutes = 5;
    const panesParam = urlParams.get('panes');
    if (panesParam) {
      try {
        const decoded = JSON.parse(decodeURIComponent(panesParam));
        const firstPane = Object.values(decoded)[0];
        if (firstPane && firstPane.range) {
          const from = firstPane.range.from;
          if (from && from.includes('now-')) {
            const match = from.match(/now-(\d+)([hm])/);
            if (match) {
              const value = parseInt(match[1]);
              const unit = match[2];
              minutes = unit === 'h' ? value * 60 : value;
              console.log(`📍 Extracted time range: ${minutes} min`);
              return minutes;
            }
          }
        }
      } catch (e) {}
    }
    const fromParam = urlParams.get('from');
    const toParam = urlParams.get('to');
    if (fromParam && toParam) {
      try {
        let fromMs, toMs;
        if (fromParam.match(/^\d{13}$/)) {
          fromMs = parseInt(fromParam);
          toMs = parseInt(toParam);
        } else if (fromParam.match(/^\d{10}$/)) {
          fromMs = parseInt(fromParam) * 1000;
          toMs = parseInt(toParam) * 1000;
        } else if (fromParam.includes('now-')) {
          const match = fromParam.match(/now-(\d+)([hm])/);
          if (match) {
            const value = parseInt(match[1]);
            const unit = match[2];
            return unit === 'h' ? value * 60 : value;
          }
        }
        const diffMs = toMs - fromMs;
        minutes = Math.round(diffMs / (1000 * 60));
      } catch (e) {}
    }
    return minutes;
  }

  function parseUrlForQuery() {
    const url = window.location.href;
    try {
      if (url.includes('/explore')) {
        const urlParams = new URLSearchParams(new URL(url).search);
        const panesParam = urlParams.get('panes');
        if (panesParam) {
          const decoded = JSON.parse(decodeURIComponent(panesParam));
          const firstPane = Object.values(decoded)[0];
          if (firstPane && firstPane.queries && firstPane.queries[0] && firstPane.queries[0].expr) {
            console.log(`📍 Extracted query: ${firstPane.queries[0].expr}`);
            return firstPane.queries[0].expr;
          }
        }
        const leftParam = urlParams.get('left');
        if (leftParam) {
          const decoded = JSON.parse(leftParam);
          if (decoded[3] && decoded[3].expr) {
            return decoded[3].expr;
          }
        }
      }
    } catch (e) {
      console.log("Could not extract query");
    }
    return null;
  }

  function extractLogsFromDOM() {
    console.log("🔍 Scanning Grafana DOM...");
    const logContainers = document.querySelectorAll("div[data-testid='log-line']");
    const rawLogs = [];
    logContainers.forEach((container) => {
      const level = extractLevel(container);
      const timestamp = extractTimestamp(container);
      const message = extractMessage(container);
      const rawJson = extractRawJson(container);
      const fields = parseJsonFields(rawJson);
      if (message && message.trim() !== "" && message !== "msg") {
        rawLogs.push({
          id: `${timestamp}__${message}`,
          timestamp, level, message, rawJson, fields
        });
      }
    });
    const seen = new Set();
    STATE.allLogs = rawLogs.filter(log => {
      const key = `${log.timestamp}__${log.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    console.log(`✅ Extracted ${STATE.allLogs.length} logs`);
  }

  function extractLevel(container) {
    const levelSpan = container.querySelector("span[class*='level-']");
    if (levelSpan) {
      if (levelSpan.className.includes("level-error")) return "ERROR";
      if (levelSpan.className.includes("level-warn")) return "WARN";
      if (levelSpan.className.includes("level-info")) return "INFO";
    }
    return "UNKNOWN";
  }

  function extractTimestamp(container) {
    const timeSpan = container.querySelector("span[title='time']");
    return timeSpan ? timeSpan.textContent.trim() : "N/A";
  }

  function extractMessage(container) {
    const msgSpan = container.querySelector("span[title='msg']");
    return msgSpan ? msgSpan.textContent.trim() : "";
  }

  function extractRawJson(container) {
    const syntaxHighlight = container.querySelector(".log-syntax-highlight");
    return syntaxHighlight ? syntaxHighlight.textContent.trim() : "";
  }

  function parseJsonFields(rawJson) {
    const fields = {};
    if (!rawJson) return fields;
    const patterns = {
      conversationId: /"conversationId"\s*:\s*"([^"]+)"/,
      appId: /"appId"\s*:\s*"([^"]+)"/,
      accountSubdomain: /"accountSubdomain"\s*:\s*"([^"]+)"/,
      userId: /"userId"\s*:\s*"([^"]+)"/,
      accountId: /"accountId"\s*:\s*"([^"]+)"/,
      requestId: /"requestId"\s*:\s*"([^"]+)"/,
      correlationId: /"correlationId"\s*:\s*"([^"]+)"/
    };
    Object.entries(patterns).forEach(([key, regex]) => {
      const match = rawJson.match(regex);
      if (match) fields[key] = match[1];
    });
    return fields;
  }

  function showLoading(msg) {
    STATE.isLoading = true;
    const popup = document.getElementById("grafana-log-extractor-popup");
    if (!popup) return;
    document.querySelectorAll("#grafana-log-extractor-popup button, .query-input, .time-input").forEach(el => {
      el.disabled = true;
      el.style.opacity = "0.6";
    });
    let overlay = document.getElementById("grafana-loading-overlay");
    if (overlay) overlay.remove();
    overlay = document.createElement("div");
    overlay.id = "grafana-loading-overlay";
    overlay.className = "grafana-loading-overlay";
    overlay.innerHTML = `<div class="grafana-spinner"></div><div class="grafana-loading-text">${msg}</div><div class="grafana-loading-subtext">Please wait</div>`;
    const mainContent = popup.querySelector("div[style*='flex: 1']");
    if (mainContent) {
      mainContent.style.position = "relative";
      mainContent.appendChild(overlay);
    }
  }

  function hideLoading() {
    STATE.isLoading = false;
    const overlay = document.getElementById("grafana-loading-overlay");
    if (overlay) overlay.remove();
    document.querySelectorAll("#grafana-log-extractor-popup button, .query-input, .time-input").forEach(el => {
      el.disabled = false;
      el.style.opacity = "1";
    });
  }

  async function fetchLogsFromLoki(isLoadMore = false) {
    if (STATE.isLoading) {
      alert("Already fetching");
      return;
    }

    let query, minutes;

    if (!isLoadMore) {
      const queryInput = document.getElementById("loki-query-input");
      const timeInput = document.getElementById("loki-time-input");
      query = queryInput.value.trim();
      if (!query) {
        alert("Enter query");
        return;
      }
      minutes = parseInt(timeInput.value) || 5;
      if (minutes <= 0) {
        alert("Time > 0");
        return;
      }
      STATE.currentQuery = query;
      STATE.lastLogTimestamp = null;
      STATE.hasMoreLogs = true;
      STATE.timeRangeMinutes = minutes;
      STATE.allLogs = [];
      STATE.filteredLogs = [];
      showLoading(`Fetching 200 logs (${minutes}m)`);
    } else {
      query = STATE.currentQuery;
      minutes = STATE.timeRangeMinutes;
      showLoading("Loading 200 more");
    }

    const now = Date.now() * 1_000_000;
    let start, end;

    if (!isLoadMore) {
      end = now;
      start = now - minutes * 60 * 1_000_000_000;
    } else {
      if (!STATE.lastLogTimestamp) {
        hideLoading();
        return;
      }
      const lastLogMs = new Date(STATE.lastLogTimestamp).getTime();
      end = lastLogMs * 1_000_000;
      start = end - minutes * 60 * 1_000_000_000;
    }

    const url = window.location.href;
    const uidMatch = url.match(/uid\/([A-Z0-9]+)/);
    const uid = uidMatch ? uidMatch[1] : "PF6DD3EEA29B10A65";
    const apiUrl = `/api/datasources/proxy/uid/${uid}/loki/api/v1/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&limit=200&direction=backward`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(apiUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        hideLoading();
        alert(`Error ${response.status}`);
        return;
      }

      const data = await response.json();
      const logsFromApi = [];

      if (data.data && data.data.result) {
        data.data.result.forEach(stream => {
          if (stream.values) {
            stream.values.forEach(([timestamp, message]) => {
              const level = detectLevel(message);
              const fields = parseJsonFields(message);
              logsFromApi.push({
                id: `${timestamp}__${message}`,
                timestamp: new Date(Math.floor(timestamp / 1_000_000)).toISOString(),
                level, message, rawJson: message, fields
              });
            });
          }
        });
      }

      const seen = new Set(STATE.allLogs.map(log => log.id));
      const newLogs = logsFromApi.filter(log => !seen.has(log.id));
      STATE.allLogs = [...STATE.allLogs, ...newLogs];

      if (logsFromApi.length > 0) {
        STATE.lastLogTimestamp = logsFromApi[logsFromApi.length - 1].timestamp;
      }

      if (logsFromApi.length < 200) {
        STATE.hasMoreLogs = false;
      }

      hideLoading();
      applyFilters();
      renderPopup();
    } catch (err) {
      clearTimeout(timeout);
      hideLoading();
      alert("Fetch failed");
    }
  }

  function detectLevel(message) {
    const levelMatch = message.match(/"level"\s*:\s*"([^"]+)"/);
    if (levelMatch) {
      const val = levelMatch[1].toUpperCase();
      if (val.includes("ERROR")) return "ERROR";
      if (val.includes("WARN")) return "WARN";
      if (val.includes("INFO")) return "INFO";
    }
    if (message.includes('"ERROR"') || message.includes('"error_level"')) return "ERROR";
    if (message.includes('"WARN"') || message.includes('"warn"') || message.includes('"WARNING"')) return "WARN";
    return "INFO";
  }

  function applyFilters() {
    STATE.filteredLogs = STATE.allLogs.filter(log => STATE.filters[log.level]);
  }

  function toggleFilter(level) {
    STATE.filters[level] = !STATE.filters[level];
    applyFilters();
    updateFilterButtons();
    renderLogList();
  }

  function toggleSortOrder() {
    STATE.sortOrder = STATE.sortOrder === "DESC" ? "ASC" : "DESC";
    renderLogList();
  }

  function renderPopup() {
    const existing = document.getElementById("grafana-log-extractor-popup");
    if (existing) existing.remove();

    const popup = document.createElement("div");
    popup.id = "grafana-log-extractor-popup";
    popup.style.cssText = `position:fixed;top:50px;right:20px;width:900px;max-height:90vh;background:#1e1e1e;border:2px solid #0ea5e9;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.5);z-index:99999;font-family:Monaco,monospace;color:#e0e0e0;display:flex;flex-direction:column;overflow:hidden`;

    const header = document.createElement("div");
    header.style.cssText = `background:#0f172a;padding:15px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center`;
    header.innerHTML = `<div><h2 style="margin:0;font-size:18px;color:#0ea5e9">📊 Logs</h2><p style="margin:5px 0 0 0;font-size:12px;color:#94a3b8">Total: ${STATE.allLogs.length} | Shown: ${STATE.filteredLogs.length}</p></div><button id="close-popup" style="padding:6px 12px;background:#ef4444;border:none;border-radius:4px;color:#fff;cursor:pointer;font-weight:bold">Close</button>`;
    popup.appendChild(header);

    const controls = document.createElement("div");
    controls.style.cssText = `background:#0f172a;padding:12px 15px;border-bottom:1px solid #334155;display:flex;gap:10px;flex-wrap:wrap;align-items:center`;

    ["INFO", "WARN", "ERROR"].forEach(level => {
      const btn = document.createElement("button");
      btn.id = `filter-${level}`;
      btn.textContent = `${level} (${STATE.allLogs.filter(l => l.level === level).length})`;
      btn.style.cssText = `padding:6px 12px;border:2px solid ${STATE.filters[level] ? getColorForLevel(level) : "#475569"};background:${STATE.filters[level] ? getColorForLevel(level) + "20" : "#1e293b"};color:${getColorForLevel(level)};border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px`;
      btn.onclick = () => toggleFilter(level);
      controls.appendChild(btn);
    });

    const sortBtn = document.createElement("button");
    sortBtn.textContent = `⬇️ ${STATE.sortOrder === "DESC" ? "Newest" : "Oldest"}`;
    sortBtn.style.cssText = `padding:6px 12px;background:#10b981;border:none;color:#fff;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px`;
    sortBtn.onclick = toggleSortOrder;
    controls.appendChild(sortBtn);

// Query Input Group
    const queryGroup = document.createElement('div');
    queryGroup.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex:1;min-width:350px';
    
    const queryLabel = document.createElement('label');
    queryLabel.textContent = 'LogQL Query';
    queryLabel.style.cssText = 'font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px';
    
    const queryInput = document.createElement("input");
    queryInput.id = "loki-query-input";
    queryInput.className = "query-input";
    queryInput.placeholder = 'e.g. {job="grafana"} | json';
    queryInput.value = parseUrlForQuery() || '{service_name="sunco", zendesk_pod="pod26"} | json';
    
    const queryHint = document.createElement('div');
    queryHint.textContent = 'LogQL query expression for filtering logs';
    queryHint.style.cssText = 'font-size:10px;color:#64748b';
    
    queryGroup.appendChild(queryLabel);
    queryGroup.appendChild(queryInput);
    queryGroup.appendChild(queryHint);
    controls.appendChild(queryGroup);

    // Time Range Input Group
    const timeGroup = document.createElement('div');
    timeGroup.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:120px';
    
    const timeLabel = document.createElement('label');
    timeLabel.textContent = 'Time Range (Minutes)';
    timeLabel.style.cssText = 'font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px';
    
    const timeInput = document.createElement("input");
    timeInput.id = "loki-time-input";
    timeInput.className = "time-input";
    timeInput.type = "number";
    timeInput.placeholder = '5';
    timeInput.value = parseUrlForTimeRange();
    timeInput.min = "1";
    timeInput.max = "1440";
    
    const timeHint = document.createElement('div');
    timeHint.textContent = 'Minutes back from now (1-1440)';
    timeHint.style.cssText = 'font-size:10px;color:#64748b';
    
    timeGroup.appendChild(timeLabel);
    timeGroup.appendChild(timeInput);
    timeGroup.appendChild(timeHint);
    controls.appendChild(timeGroup);

    const queryBtn = document.createElement("button");
    queryBtn.textContent = "🔗 Query";
    queryBtn.style.cssText = `padding:6px 12px;background:#8b5cf6;border:none;color:#fff;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px`;
    queryBtn.onclick = () => fetchLogsFromLoki(false);
    controls.appendChild(queryBtn);

    popup.appendChild(controls);

    const mainContent = document.createElement("div");
    mainContent.style.cssText = `display:flex;flex:1;overflow:hidden;gap:1px;background:#334155;position:relative`;

    const logList = document.createElement("div");
    logList.id = "log-list";
    logList.style.cssText = `flex:1;overflow-y:auto;background:#0f172a;border-right:1px solid #334155;max-height:100%`;
    logList.addEventListener("scroll", () => {
      if (logList.scrollTop + logList.clientHeight >= logList.scrollHeight - 100) {
        if (STATE.hasMoreLogs && !STATE.isLoading && STATE.currentQuery) {
          fetchLogsFromLoki(true);
        }
      }
    });
    mainContent.appendChild(logList);

    const detailPanel = document.createElement("div");
    detailPanel.id = "detail-panel";
    detailPanel.style.cssText = `flex:1;overflow-y:auto;background:#1e293b;padding:15px;max-height:100%`;
    detailPanel.innerHTML = `<p style="color:#64748b;font-size:12px">Select log</p>`;
    mainContent.appendChild(detailPanel);

    popup.appendChild(mainContent);
    document.body.appendChild(popup);

    document.getElementById("close-popup").onclick = () => popup.remove();

    queryInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") fetchLogsFromLoki(false);
    });

    timeInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") fetchLogsFromLoki(false);
    });

    renderLogList();
  }

  function renderLogList() {
    const logList = document.getElementById("log-list");
    if (!logList) return;
    logList.innerHTML = "";

    if (STATE.filteredLogs.length === 0) {
      logList.innerHTML = `<div style="padding:20px;color:#94a3b8;text-align:center">No logs</div>`;
      return;
    }

    const logsToDisplay = [...STATE.filteredLogs];
    logsToDisplay.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return STATE.sortOrder === "DESC" ? timeB - timeA : timeA - timeB;
    });

    logsToDisplay.forEach((log) => {
      const logItem = document.createElement("div");
      logItem.style.cssText = `padding:12px 15px;border-bottom:1px solid #334155;cursor:pointer;background:${STATE.selectedLog?.id === log.id ? "#1e293b" : "transparent"};border-left:4px solid ${getColorForLevel(log.level)}`;
      logItem.onmouseover = () => { logItem.style.background = "#1e293b"; };
      logItem.onmouseout = () => { if (STATE.selectedLog?.id !== log.id) logItem.style.background = "transparent"; };

      const badge = document.createElement("span");
      badge.textContent = log.level;
      badge.style.cssText = `display:inline-block;padding:2px 8px;background:${getColorForLevel(log.level)};color:#000;border-radius:3px;font-size:11px;font-weight:bold;margin-right:10px`;

      const textSpan = document.createElement("span");
      textSpan.textContent = `${log.timestamp} - ${log.message.substring(0, 60)}...`;
      textSpan.style.cssText = "font-size:12px;color:#cbd5e1";

      logItem.appendChild(badge);
      logItem.appendChild(textSpan);

      logItem.onclick = () => {
        STATE.selectedLog = log;
        renderDetailPanel(log);
        renderLogList();
      };

      logList.appendChild(logItem);
    });

    if (STATE.hasMoreLogs && STATE.currentQuery) {
      const loadMoreDiv = document.createElement("div");
      loadMoreDiv.style.cssText = `padding:15px;text-align:center;background:#0f172a;border-top:1px solid #334155`;
      loadMoreDiv.innerHTML = `<p style="margin:0 0 10px 0;color:#94a3b8;font-size:12px">📜 Scroll to load more</p><button class="load-more-button" onclick="window._grafanaLoadMore()">Load 200 More</button>`;
      logList.appendChild(loadMoreDiv);
    }
  }

  window._grafanaLoadMore = () => { fetchLogsFromLoki(true); };

  function renderDetailPanel(log) {
    const detailPanel = document.getElementById("detail-panel");
    if (!detailPanel) return;

    let html = `<h3 style="color:#0ea5e9">Details</h3><div style="background:#0f172a;padding:10px;border-radius:4px;margin-bottom:15px"><div style="margin-bottom:8px"><strong style="color:#94a3b8">Time:</strong><div style="color:#cbd5e1;font-size:12px">${log.timestamp}</div></div><div><strong style="color:#94a3b8">Level:</strong><span style="padding:2px 8px;background:${getColorForLevel(log.level)};color:#000;border-radius:3px;font-size:11px;font-weight:bold">${log.level}</span></div></div><div style="background:#0f172a;padding:10px;border-radius:4px;margin-bottom:15px"><strong style="color:#94a3b8">Msg:</strong><div style="color:#cbd5e1;font-size:12px;word-break:break-all;background:#1e293b;padding:8px;border-radius:3px;margin-top:5px">${escapeHtml(log.message)}</div></div>`;

    if (Object.keys(log.fields).length > 0) {
      html += `<div style="background:#0f172a;padding:10px;border-radius:4px;margin-bottom:15px"><strong style="color:#0ea5e9">Fields:</strong>${Object.entries(log.fields).map(([k, v]) => `<div style="color:#cbd5e1;font-size:11px;margin-top:5px"><strong>${k}:</strong> ${escapeHtml(v)}</div>`).join("")}</div>`;
    }

    html += `<div style="background:#0f172a;padding:10px;border-radius:4px"><strong style="color:#94a3b8">Raw:</strong><div style="color:#cbd5e1;font-size:11px;word-break:break-all;background:#1e293b;padding:8px;border-radius:3px;margin-top:5px;max-height:150px;overflow-y:auto">${escapeHtml(log.rawJson.substring(0, 500))}</div></div>`;

    detailPanel.innerHTML = html;
  }

  function updateFilterButtons() {
    ["INFO", "WARN", "ERROR"].forEach(level => {
      const btn = document.getElementById(`filter-${level}`);
      if (btn) {
        btn.style.borderColor = STATE.filters[level] ? getColorForLevel(level) : "#475569";
        btn.style.background = STATE.filters[level] ? getColorForLevel(level) + "20" : "#1e293b";
      }
    });
  }

  function getColorForLevel(level) {
    return { ERROR: "#ef4444", WARN: "#f59e0b", INFO: "#3b82f6" }[level] || "#6b7280";
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  injectStyles();
  extractLogsFromDOM();
  applyFilters();
  renderPopup();
  window._grafanaState = STATE;
  console.log("✅ Loaded! Use window._grafanaState to debug");
})();
