// ===== ADD THIS BLOCK FIRST (very top of file) =====
const originalMap = Array.prototype.map;
Array.prototype.map = function(...args) {
  try {
    return originalMap.apply(this, args);
  } catch (e) {
    console.error('Map operation failed on:', this);
    console.error('Full error:', e);
    throw e;
  }
};
// ===== END DEBUG BLOCK =====

// Then all your existing code follows below...
// Like your createPopup() function, renderPopup(), etc.

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
    sortOrder: "DESC",
    fieldFilterName: null,
    fieldFilterValue: null,   
    fieldFilterValues: new Set() 
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

function renderLogList() {
    const logList = document.getElementById("log-list");
    if (!logList) return;
    logList.innerHTML = "";

    if (STATE.filteredLogs.length === 0) {
      logList.innerHTML = `<div style="padding:20px;color:#94a3b8;text-align:center">No logs matching filters</div>`;
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
      logItem.style.cssText = `padding:12px 15px;border-bottom:1px solid #334155;cursor:pointer;background:${STATE.selectedLog?.id === log.id ? "#1e293b" : "transparent"};border-left:4px solid ${getColorForLevel(log.level)};transition:background 0.2s`;
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

    renderFieldValues();
  }

  function renderDetailPanel(log) {
    const detailPanel = document.getElementById("detail-panel");
    if (!detailPanel) return;

    let html = `<h3 style="color:#0ea5e9;margin-top:0">📋 Details</h3>`;
    html += `<div style="background:#0f172a;padding:10px;border-radius:4px;margin-bottom:15px">`;
    html += `<div style="margin-bottom:8px"><strong style="color:#94a3b8">⏱ Time:</strong><div style="color:#cbd5e1;font-size:12px">${log.timestamp}</div></div>`;
    html += `<div><strong style="color:#94a3b8">📌 Level:</strong><span style="padding:2px 8px;background:${getColorForLevel(log.level)};color:#000;border-radius:3px;font-size:11px;font-weight:bold;margin-left:5px">${log.level}</span></div>`;
    html += `</div>`;

    html += `<div style="background:#0f172a;padding:10px;border-radius:4px;margin-bottom:15px">`;
    html += `<strong style="color:#94a3b8">💬 Message:</strong>`;
    html += `<div style="color:#cbd5e1;font-size:12px;word-break:break-all;background:#1e293b;padding:8px;border-radius:3px;margin-top:5px;max-height:100px;overflow-y:auto">${escapeHtml(log.message)}</div>`;
    html += `</div>`;

    if (Object.keys(log.fields).length > 0) {
      html += `<div style="background:#0f172a;padding:10px;border-radius:4px;margin-bottom:15px"><strong style="color:#0ea5e9">🔑 Fields:</strong>${Object.entries(log.fields).map(([k, v]) => `<div style="color:#cbd5e1;font-size:11px;margin-top:5px"><strong>${k}:</strong> ${escapeHtml(v)}</div>`).join("")}</div>`;
    }

    html += `<div style="background:#0f172a;padding:10px;border-radius:4px"><strong style="color:#94a3b8">📝 Raw:</strong><div style="color:#cbd5e1;font-size:11px;word-break:break-all;background:#1e293b;padding:8px;border-radius:3px;margin-top:5px;max-height:150px;overflow-y:auto">${escapeHtml(log.rawJson.substring(0, 500))}</div></div>`;

    detailPanel.innerHTML = html;
  }

  function renderFieldValues() {
    const container = document.getElementById("field-values-container");
    if (!container) return;

    if (!STATE.fieldFilterName || STATE.fieldFilterValues.length === 0) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    let html = `<div style="color:#0ea5e9;font-weight:bold;margin-bottom:8px">🔹 Values for "<strong>${STATE.fieldFilterName}</strong>" (${STATE.fieldFilterValues.length}):</div>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px">`;
    
    STATE.fieldFilterValues.forEach(value => {
      const isSelected = STATE.fieldFilterValue === value;
      const bgColor = isSelected ? "#0ea5e9" : "#334155";
      const textColor = isSelected ? "#000" : "#cbd5e1";
      const borderColor = isSelected ? "#0ea5e9" : "#475569";
      
      html += `<span 
        onclick="window._selectFieldValue('${value.replace(/'/g, "\\'")}'); window._updateFieldFilter();"
        style="background:${bgColor};color:${textColor};padding:4px 8px;border-radius:3px;font-size:10px;cursor:pointer;border:1px solid ${borderColor};transition:all 0.2s;font-weight:${isSelected ? 'bold' : 'normal'}" 
        title="${value}"
      >${value.substring(0, 20)}${value.length > 20 ? '...' : ''}</span>`;
    });
    
    html += `</div>`;
    container.innerHTML = html;
  }

  window._selectFieldValue = (value) => {
    STATE.fieldFilterValue = value;
  };

  window._updateFieldFilter = () => {
    applyFilters();
    renderLogList();
    renderFieldValues();
  };

  window._grafanaLoadMore = () => { fetchLogsFromLoki(true); };
  
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
    
    try {
      // Try to parse the entire JSON
      const parsed = JSON.parse(rawJson);
      
      // Extract all top-level keys
      Object.keys(parsed).forEach(key => {
        const value = parsed[key];
        
        // Only extract string values or simple types
        if (typeof value === 'string') {
          fields[key] = value;
        } else if (typeof value === 'number') {
          fields[key] = String(value);
        } else if (typeof value === 'boolean') {
          fields[key] = String(value);
        }
        // Skip nested objects and arrays
      });
    } catch (e) {
      // If JSON parse fails, fall back to regex extraction
      const patterns = {
        conversationId: /"conversationId"\s*:\s*"([^"]+)"/,
        appId: /"appId"\s*:\s*"([^"]+)"/,
        accountSubdomain: /"accountSubdomain"\s*:\s*"([^"]+)"/,
        userId: /"userId"\s*:\s*"([^"]+)"/,
        accountId: /"accountId"\s*:\s*"([^"]+)"/,
        requestId: /"requestId"\s*:\s*"([^"]+)"/,
        correlationId: /"correlationId"\s*:\s*"([^"]+)"/,
        externalId: /"externalId"\s*:\s*"([^"]+)"/,
        integrationId: /"integrationId"\s*:\s*"([^"]+)"/,
        appUserId: /"appUserId"\s*:\s*"([^"]+)"/,
        host: /"host"\s*:\s*"([^"]+)"/
      };
      
      Object.entries(patterns).forEach(([key, regex]) => {
        const match = rawJson.match(regex);
        if (match) fields[key] = match[1];
      });
    }
    
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

    let query;

    if (!isLoadMore) {
      const queryInput = document.getElementById("loki-query-input");
      const startDateInput = document.getElementById("loki-start-date");
      const endDateInput = document.getElementById("loki-end-date");
      
      console.log("✅ Elements found:", { queryInput: !!queryInput, startDateInput: !!startDateInput, endDateInput: !!endDateInput });
      
      if (!queryInput || !startDateInput || !endDateInput) {
        alert("Error: Input elements not found");
        return;
      }
      
      query = queryInput.value.trim();
      if (!query) {
        alert("Enter LogQL query");
        return;
      }
      
      const startDate = new Date(startDateInput.value);
      const endDate = new Date(endDateInput.value);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        alert("Invalid date range");
        return;
      }
      if (startDate >= endDate) {
        alert("Start date must be before end date");
        return;
      }
      
      STATE.currentQuery = query;
      STATE.lastLogTimestamp = null;
      STATE.hasMoreLogs = true;
      STATE.allLogs = [];
      STATE.filteredLogs = [];
      showLoading(`Fetching logs`);
    } else {
      query = STATE.currentQuery;
      showLoading("Loading 200 more");
    }

    let fromMs, toMs;

    if (!isLoadMore) {
      const startDateInput = document.getElementById("loki-start-date");
      const endDateInput = document.getElementById("loki-end-date");
      const startDate = new Date(startDateInput.value);
      const endDate = new Date(endDateInput.value);
      
      fromMs = Math.floor(startDate.getTime());
      toMs = Math.floor(endDate.getTime());
    } else {
      if (!STATE.lastLogTimestamp) {
        hideLoading();
        return;
      }
      const lastLogMs = new Date(STATE.lastLogTimestamp).getTime();
      toMs = lastLogMs;
      fromMs = toMs - 5 * 60 * 1000; // 5 min window
    }

    // Extract datasource UID from current URL or use default
    const url = window.location.href;
    const urlParams = new URLSearchParams(new URL(url).search);
    const panesParam = urlParams.get('panes');
    let datasourceUid = 'P17010DBED3E8EB09'; // Default fallback
    
    if (panesParam) {
      try {
        const decoded = JSON.parse(decodeURIComponent(panesParam));
        const firstPane = Object.values(decoded)[0];
        if (firstPane?.queries?.[0]?.datasource?.uid) {
          datasourceUid = firstPane.queries[0].datasource.uid;
          console.log("📍 Extracted datasource UID:", datasourceUid);
        }
      } catch (e) {}
    }

    // Modern Grafana API endpoint
    const apiUrl = `/api/ds/query?ds_type=loki`;
    
    const requestBody = {
      queries: [{
        refId: "A",
        expr: query,
        queryType: "range",
        datasource: {
          type: "loki",
          uid: datasourceUid
        },
        editorMode: "code",
        direction: "backward",
        maxLines: 200,
        step: "",
        legendFormat: "",
        datasourceId: 3,
        intervalMs: 1000,
        maxDataPoints: 986
      }],
      from: String(fromMs),
      to: String(toMs)
    };

    console.log("📡 Loki API Call:", {
      endpoint: apiUrl,
      fromMs,
      toMs,
      datasourceUid,
      query
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-datasource-uid': datasourceUid,
          'x-grafana-org-id': '1',
          'x-plugin-id': 'loki',
          'x-cache-skip': 'true'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        hideLoading();
        console.error("Response status:", response.status);
        alert(`Error ${response.status}: ${response.statusText}`);
        return;
      }

      const data = await response.json();
      console.log("📦 Loki response:", data);

      const logsFromApi = [];

      if (data.results?.A?.frames) {
        data.results.A.frames.forEach(frame => {
          if (frame.data?.values) {
            // Extract time and content columns
            const timeValues = frame.data.values[0] || [];
            const contentValues = frame.data.values[1] || [];
            
            timeValues.forEach((timestamp, idx) => {
              const message = contentValues[idx] || '';
              const level = detectLevel(message);
              const fields = parseJsonFields(message);
              
              logsFromApi.push({
                id: `${timestamp}__${message}`,
                timestamp: new Date(parseInt(timestamp)).toISOString(),
                level,
                message,
                rawJson: message,
                fields
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
      renderLogList();
      updateFilterButtons();
    } catch (err) {
      clearTimeout(timeout);
      hideLoading();
      console.error("Fetch error:", err);
      alert("Fetch failed: " + err.message);
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
    applyFieldFilter();  
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
    popup.style.cssText = `position:fixed;top:50px;right:20px;width:1300px;max-height:90vh;background:#1e1e1e;border:2px solid #0ea5e9;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.5);z-index:99999;font-family:Monaco,monospace;color:#e0e0e0;display:flex;flex-direction:column;overflow:hidden`;

    // HEADER
    const header = document.createElement("div");
    header.style.cssText = `background:#0f172a;padding:15px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center`;
    header.innerHTML = `<div><h2 style="margin:0;font-size:18px;color:#0ea5e9">📊 Logs</h2><p style="margin:5px 0 0 0;font-size:12px;color:#94a3b8">Total: ${STATE.allLogs.length} | Shown: ${STATE.filteredLogs.length}</p></div><button id="close-popup" style="padding:6px 12px;background:#ef4444;border:none;border-radius:4px;color:#fff;cursor:pointer;font-weight:bold">Close</button>`;
    popup.appendChild(header);

    // QUERY SECTION (above main content) - NEW
    const querySection = document.createElement("div");
    querySection.style.cssText = `background:#0f172a;padding:12px 15px;border-bottom:1px solid #334155;display:flex;gap:10px;align-items:flex-end`;

    const queryLabel = document.createElement('label');
    queryLabel.textContent = '🔗 LogQL Query';
    queryLabel.style.cssText = 'font-size:11px;font-weight:700;color:#0ea5e9;text-transform:uppercase;margin-bottom:4px;letter-spacing:0.5px;display:block;width:100%';

    const queryInput = document.createElement("input");
    queryInput.id = "loki-query-input";
    queryInput.placeholder = '{job="grafana"}';
    queryInput.value = parseUrlForQuery() || '{service_name="sunco"}';
    queryInput.style.cssText = 'padding:8px 10px;background:#0f172a;border:1px solid #475569;color:#cbd5e1;border-radius:3px;font-family:Monaco,monospace;font-size:10px;flex:1;transition:all 0.2s;cursor:text';
    queryInput.addEventListener("focus", function() {
      this.style.borderColor = "#0ea5e9";
      this.style.boxShadow = "0 0 0 2px rgba(14, 165, 233, 0.2)";
    });
    queryInput.addEventListener("blur", function() {
      this.style.borderColor = "#475569";
      this.style.boxShadow = "none";
    });

    const queryInputWrapper = document.createElement("div");
    queryInputWrapper.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex:1;min-width:300px';
    queryInputWrapper.appendChild(queryLabel);
    queryInputWrapper.appendChild(queryInput);

    querySection.appendChild(queryInputWrapper);

    // Switchboard Actions Button
    const switchboardBtn = document.createElement("button");
    switchboardBtn.textContent = "⚡ Switchboard";
    switchboardBtn.style.cssText = `padding:8px 12px;background:#06b6d4;border:none;color:#fff;border-radius:3px;cursor:pointer;font-weight:bold;font-size:10px;height:fit-content;transition:all 0.2s`;
    switchboardBtn.onmouseover = () => { switchboardBtn.style.background = "#0891b2"; };
    switchboardBtn.onmouseout = () => { switchboardBtn.style.background = "#06b6d4"; };
    switchboardBtn.onclick = () => {
      const currentQuery = queryInput.value.trim();
      if (!currentQuery.includes('|~ "Switchboard"')) {
        queryInput.value = currentQuery + ' |~ "Switchboard"';
      }
    };
    querySection.appendChild(switchboardBtn);

    popup.appendChild(querySection);

    // MAIN CONTENT (left=controls, middle=logs, right=details)
    const mainContent = document.createElement("div");
    mainContent.style.cssText = `display:flex;flex:1;overflow:hidden;gap:0;background:#334155;position:relative`;

    // LEFT PANEL: Controls Sidebar
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = `width:280px;background:#0f172a;padding:12px;border-right:1px solid #334155;overflow-y:auto;display:flex;flex-direction:column;gap:10px;max-height:100%`;

    // Filter Buttons Section
    const filterLabel = document.createElement("div");
    filterLabel.textContent = "📌 Filters";
    filterLabel.style.cssText = 'font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px';
    leftPanel.appendChild(filterLabel);

    const filterBtnsRow = document.createElement("div");
    filterBtnsRow.style.cssText = `display:flex;gap:4px;flex-wrap:wrap`;
    
    ["INFO", "WARN", "ERROR"].forEach(level => {
      const btn = document.createElement("button");
      btn.id = `filter-${level}`;
      btn.textContent = `${level} (${STATE.allLogs.filter(l => l.level === level).length})`;
      btn.style.cssText = `padding:4px 8px;border:2px solid ${STATE.filters[level] ? getColorForLevel(level) : "#475569"};background:${STATE.filters[level] ? getColorForLevel(level) + "20" : "#1e293b"};color:${getColorForLevel(level)};border-radius:3px;cursor:pointer;font-weight:bold;font-size:9px;flex:1;min-width:50px;transition:all 0.2s`;
      btn.onclick = () => toggleFilter(level);
      filterBtnsRow.appendChild(btn);
    });
    leftPanel.appendChild(filterBtnsRow);

    // Date Range Section
    const dateLabel = document.createElement('label');
    dateLabel.textContent = '📅 Date Range';
    dateLabel.style.cssText = 'font-size:11px;font-weight:700;color:#0ea5e9;text-transform:uppercase;margin-top:10px;margin-bottom:6px;letter-spacing:0.5px';
    leftPanel.appendChild(dateLabel);

    // Helper function to format dates with seconds and milliseconds
    const formatDateForInput = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      const ms = String(date.getMilliseconds()).padStart(3, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}`;
    };

    // Predefined label
    const predefLabel = document.createElement('label');
    predefLabel.textContent = 'Predefined Ranges:';
    predefLabel.style.cssText = 'font-size:10px;font-weight:700;color:#cbd5e1;margin-bottom:4px;display:block';
    leftPanel.appendChild(predefLabel);

    // Preset Dropdown (proper dropdown, not multi-select)
    const presetSelect = document.createElement("select");
    presetSelect.id = "date-preset-select";
    presetSelect.style.cssText = 'padding:8px 10px;background:#0f172a;border:1px solid #475569;color:#cbd5e1;border-radius:3px;font-family:Monaco,monospace;font-size:10px;width:100%;margin-bottom:10px;cursor:pointer;transition:all 0.2s';
    
    const presets = [
      { label: 'Select a range...', minutes: null },
      { label: 'Last 5 minutes', minutes: 5 },
      { label: 'Last 15 minutes', minutes: 15 },
      { label: 'Last 30 minutes', minutes: 30 },
      { label: 'Last 1 hour', minutes: 60 },
      { label: 'Last 4 hours', minutes: 240 },
      { label: 'Last 1 day', minutes: 1440 }
    ];
    
    presets.forEach(preset => {
      const option = document.createElement("option");
      option.value = preset.minutes;
      option.textContent = preset.label;
      presetSelect.appendChild(option);
    });
    
    leftPanel.appendChild(presetSelect);

    // Start Date with Milliseconds
    const startDateLabel = document.createElement('label');
    startDateLabel.textContent = 'Start Date & Time:';
    startDateLabel.style.cssText = 'font-size:10px;font-weight:700;color:#cbd5e1;margin-bottom:4px;display:block';
    leftPanel.appendChild(startDateLabel);

    const startDateInput = document.createElement("input");
    startDateInput.id = "loki-start-date";
    startDateInput.type = "datetime-local";
    startDateInput.step = "0.001";
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    startDateInput.value = formatDateForInput(fiveMinutesAgo);
    startDateInput.style.cssText = 'padding:8px 10px;background:#0f172a;border:1px solid #475569;color:#cbd5e1;border-radius:3px;font-family:Monaco,monospace;font-size:10px;width:100%;margin-bottom:10px;cursor:pointer;transition:all 0.2s';
    startDateInput.addEventListener("focus", function() {
      this.style.borderColor = "#0ea5e9";
      this.style.boxShadow = "0 0 0 2px rgba(14, 165, 233, 0.2)";
    });
    startDateInput.addEventListener("blur", function() {
      this.style.borderColor = "#475569";
      this.style.boxShadow = "none";
    });
    leftPanel.appendChild(startDateInput);

    // End Date with Milliseconds
    const endDateLabel = document.createElement('label');
    endDateLabel.textContent = 'End Date & Time:';
    endDateLabel.style.cssText = 'font-size:10px;font-weight:700;color:#cbd5e1;margin-bottom:4px;display:block';
    leftPanel.appendChild(endDateLabel);

    const endDateInput = document.createElement("input");
    endDateInput.id = "loki-end-date";
    endDateInput.type = "datetime-local";
    endDateInput.step = "0.001";
    endDateInput.value = formatDateForInput(now);
    endDateInput.style.cssText = 'padding:8px 10px;background:#0f172a;border:1px solid #475569;color:#cbd5e1;border-radius:3px;font-family:Monaco,monospace;font-size:10px;width:100%;margin-bottom:10px;cursor:pointer;transition:all 0.2s';
    endDateInput.addEventListener("focus", function() {
      this.style.borderColor = "#0ea5e9";
      this.style.boxShadow = "0 0 0 2px rgba(14, 165, 233, 0.2)";
    });
    endDateInput.addEventListener("blur", function() {
      this.style.borderColor = "#475569";
      this.style.boxShadow = "none";
    });
    leftPanel.appendChild(endDateInput);

    // Update dates when preset changes
    presetSelect.addEventListener("change", (e) => {
      const minutes = parseInt(e.target.value);
      if (minutes === null || isNaN(minutes)) return;
      
      const nowDate = new Date();
      const startDate = new Date(nowDate.getTime() - minutes * 60 * 1000);
      startDateInput.value = formatDateForInput(startDate);
      endDateInput.value = formatDateForInput(nowDate);
    });

    // Fetch Button
    const queryBtn = document.createElement("button");
    queryBtn.textContent = "🔍 Fetch Logs";
    queryBtn.style.cssText = `padding:8px 10px;background:#8b5cf6;border:none;color:#fff;border-radius:3px;cursor:pointer;font-weight:bold;font-size:10px;width:100%;margin-top:6px;transition:all 0.2s`;
    queryBtn.onmouseover = () => { queryBtn.style.background = "#7c3aed"; };
    queryBtn.onmouseout = () => { queryBtn.style.background = "#8b5cf6"; };
    queryBtn.onclick = () => fetchLogsFromLoki(false);
    leftPanel.appendChild(queryBtn);

    // Field Filter Section
    const fieldLabel = document.createElement('label');
    fieldLabel.textContent = '🔎 Filter by Field';
    fieldLabel.style.cssText = 'font-size:11px;font-weight:700;color:#0ea5e9;text-transform:uppercase;margin-top:10px;margin-bottom:4px;letter-spacing:0.5px';
    leftPanel.appendChild(fieldLabel);

    const fieldInput = document.createElement('input');
    fieldInput.id = 'field-filter-input';
    fieldInput.placeholder = 'conversationId';
    fieldInput.value = STATE.fieldFilterName || '';
    fieldInput.style.cssText = 'padding:8px 10px;background:#0f172a;border:1px solid #475569;color:#cbd5e1;border-radius:3px;font-family:Monaco,monospace;font-size:10px;width:100%;margin-bottom:8px;transition:all 0.2s;cursor:text';
    
    fieldInput.addEventListener("focus", function() {
      this.style.borderColor = "#0ea5e9";
      this.style.boxShadow = "0 0 0 2px rgba(14, 165, 233, 0.2)";
    });
    fieldInput.addEventListener("blur", function() {
      this.style.borderColor = "#475569";
      this.style.boxShadow = "none";
    });
    
    fieldInput.addEventListener('input', (e) => {
      const fieldName = e.target.value.trim() || null;
      STATE.fieldFilterName = fieldName;
      STATE.fieldFilterValue = null;
      applyFilters();
      renderLogList();
      renderFieldValues();
    });
    
    leftPanel.appendChild(fieldInput);

    // Field Values Container (in left sidebar, between input and reset)
    const fieldValuesContainer = document.createElement("div");
    fieldValuesContainer.id = "field-values-container";
    fieldValuesContainer.style.cssText = `background:#0f172a;padding:8px 10px;border-radius:3px;max-height:150px;overflow-y:auto;display:none;font-size:9px;border:1px solid #334155;margin-bottom:8px;margin-top:0`;
    leftPanel.appendChild(fieldValuesContainer);

    // Reset Button
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "🔄 Reset";
    resetBtn.style.cssText = `padding:8px 10px;background:#f59e0b;border:none;color:#fff;border-radius:3px;cursor:pointer;font-weight:bold;font-size:10px;width:100%;margin-top:0;transition:all 0.2s`;
    resetBtn.onmouseover = () => { resetBtn.style.background = "#d97706"; };
    resetBtn.onmouseout = () => { resetBtn.style.background = "#f59e0b"; };
    resetBtn.onclick = () => {
      STATE.fieldFilterName = null;
      STATE.fieldFilterValue = null;
      fieldInput.value = '';
      applyFilters();
      renderLogList();
      renderFieldValues();
    };
    leftPanel.appendChild(resetBtn);

    mainContent.appendChild(leftPanel);

    // MIDDLE: Log List
    const logList = document.createElement("div");
    logList.id = "log-list";
    logList.style.cssText = `flex:1;overflow-y:auto;background:#0f172a;border-right:1px solid #334155;max-height:100%;min-width:500px`;
    logList.addEventListener("scroll", () => {
      if (logList.scrollTop + logList.clientHeight >= logList.scrollHeight - 100) {
        if (STATE.hasMoreLogs && !STATE.isLoading && STATE.currentQuery) {
          fetchLogsFromLoki(true);
        }
      }
    });
    mainContent.appendChild(logList);

    // RIGHT PANEL: Details
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = `width:350px;background:#1e293b;padding:12px;border-left:1px solid #334155;overflow-y:auto;display:flex;flex-direction:column;gap:10px;max-height:100%`;

    // Detail Panel
    const detailPanel = document.createElement("div");
    detailPanel.id = "detail-panel";
    detailPanel.style.cssText = `flex:1;overflow-y:auto;background:#0f172a;padding:10px;border-radius:3px;border:1px solid #334155`;
    detailPanel.innerHTML = `<p style="color:#64748b;font-size:10px">Select a log to view details</p>`;
    rightPanel.appendChild(detailPanel);

    mainContent.appendChild(rightPanel);
    popup.appendChild(mainContent);
    document.body.appendChild(popup);

    // Event listeners
    document.getElementById("close-popup").onclick = () => popup.remove();
    
    queryInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") fetchLogsFromLoki(false);
    });
    
    startDateInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") fetchLogsFromLoki(false);
    });
    
    endDateInput.addEventListener("keypress", (e) => {
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

    renderFieldValues(); 
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
      // Update COUNT
      const count = STATE.allLogs.filter(l => l.level === level).length;
      btn.textContent = `${level} (${count})`;
      
      // Update styling
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

  function extractUniqueFieldValues(fieldName) {
    const values = new Set();
    STATE.allLogs.forEach(log => {
      if (log.fields[fieldName]) {
        values.add(log.fields[fieldName]);
      }
    });
    return Array.from(values).sort();
  }

function applyFieldFilter() {
    if (!STATE.fieldFilterName) {
      STATE.filteredLogs = STATE.allLogs.filter(log => STATE.filters[log.level]);
    } else if (STATE.fieldFilterValue) {
      // Filter by both field name AND specific value
      STATE.filteredLogs = STATE.allLogs.filter(log => 
        STATE.filters[log.level] && 
        log.fields[STATE.fieldFilterName] === STATE.fieldFilterValue
      );
    } else {
      // Filter by field name only (any value)
      STATE.filteredLogs = STATE.allLogs.filter(log => 
        STATE.filters[log.level] && log.fields[STATE.fieldFilterName]
      );
    }
    STATE.fieldFilterValues = extractUniqueFieldValues(STATE.fieldFilterName);
  }

function renderFieldValues() {
    const container = document.getElementById("field-values-container");
    if (!container) return;

    if (!STATE.fieldFilterName || STATE.fieldFilterValues.length === 0) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    let html = `<div style="color:#0ea5e9;font-weight:bold;margin-bottom:10px">🔹 Values for "<strong>${STATE.fieldFilterName}</strong>" (${STATE.fieldFilterValues.length}):</div>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px">`;
    
    STATE.fieldFilterValues.forEach(value => {
      const isSelected = STATE.fieldFilterValue === value;
      const bgColor = isSelected ? "#0ea5e9" : "#334155";
      const textColor = isSelected ? "#000" : "#cbd5e1";
      const borderColor = isSelected ? "#0ea5e9" : "#475569";
      
      html += `<span 
        onclick="window._selectFieldValue('${value.replace(/'/g, "\\'")}'); window._updateFieldFilter();"
        style="background:${bgColor};color:${textColor};padding:6px 12px;border-radius:4px;font-size:11px;cursor:pointer;border:1px solid ${borderColor};transition:all 0.2s;font-weight:${isSelected ? 'bold' : 'normal'}" 
        title="${value}"
      >${value.substring(0, 25)}${value.length > 25 ? '...' : ''}</span>`;
    });
    
    html += `</div>`;
    container.innerHTML = html;
  }

  window._selectFieldValue = (value) => {
    STATE.fieldFilterValue = value;
  };

  window._updateFieldFilter = () => {
    applyFilters();
    renderLogList();
    renderFieldValues();
  };

injectStyles();
  extractLogsFromDOM();
  applyFilters();
  renderPopup();
  window._grafanaState = STATE;
  console.log("✅ Loaded! Use window._grafanaState to debug");
})();
