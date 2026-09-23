// ==UserScript==
// @name         AAA Count
// @namespace    http://tampermonkey.net/
// @version      11.5
// @description  Full-screen terminal (full width layout) with unblocked copy/paste, manual text editing, user tracking, automated Smartsheet log submission via secure worker, special character restriction, and centered tip below input.
// @match        https://atlas.na.aftx.amazonoperations.app/*
// @connect      qifcr.eu.aftx.amazonoperations.app
// @connect      aaacount.bambura-r.workers.dev
// @updateURL    https://github.com/RBCeva/TM/raw/refs/heads/main/AAACount.user.js
// @downloadURL  https://github.com/RBCeva/TM/raw/refs/heads/main/AAACount.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const WAREHOUSE_ID = 'XFR9';
    const QIFCR_BASE = 'https://qifcr.eu.aftx.amazonoperations.app';
    const DUPLICATE_COOLDOWN_MS = 60000;
    const CLEAR_LOG_PASSWORD = 'Andriiiii';
    const VIEW_LOG_PASSWORD = 'Andriiiii';
    const INVENTORY_VIEW_PASSWORD = 'Andriiiii';

    // Smartsheet Proxy Configuration
    const PROXY_URL = 'https://aaacount.bambura-r.workers.dev';
    const SCAN_SHEET_ID = '38633198538628';
    const SUMMARY_SHEET_ID = '894335907483524';

    // Reset user state on page open / refresh
    let currentUser = '';
    let currentLocation = null;
    let mode = 'LOCATION'; // 'LOCATION' or 'ITEM'
    let currentScannedItems = [];
    let currentQifcrValues = new Set();
    let currentFnskuCounts = {};
    let currentBarcodeToFnskuMap = {};
    let savedData = GM_getValue('cycle_count_data', {});

    let isInventoryUnlocked = false;
    let cachedInventoryTableData = null;

    // Inject CSS (Full width layout, larger font)
    const style = document.createElement('style');
    style.innerHTML = `
        html, body {
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
            height: 100vh !important;
            width: 100vw !important;
            background-color: #121212 !important;
            color: #ffffff !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
            font-size: 17px !important;
        }
        #mw-page-base, #mw-head-base, #content, #mw-navigation, #footer, #siteNotice {
            display: none !important;
        }
        #qifcr-app-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: #1e1e24;
            z-index: 999999;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 15px;
            box-sizing: border-box;
        }
        .app-wrapper {
            width: 100vw;
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: #1e1e24;
            padding: 15px;
            box-sizing: border-box;
        }
        .app-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #333;
            padding-bottom: 10px;
            margin-bottom: 10px;
        }
        .header-left { display: flex; align-items: center; gap: 12px; flex: 1; }
        .header-center { display: flex; justify-content: center; align-items: center; flex: 1; }
        .header-right { display: flex; align-items: center; justify-content: flex-end; gap: 12px; flex: 1; }
        .app-title { font-size: 22px; font-weight: 800; letter-spacing: 1px; color: #00d4ff; }
        .user-tag { background: #2a2a36; color: #00f5d4; padding: 6px 12px; border-radius: 4px; font-size: 16px; font-weight: bold; border: 1px solid #00f5d4; }
        .btn-action {
            background: #00d4ff; color: #0f0f14; border: none; padding: 8px 14px; font-size: 15px; font-weight: 800;
            border-radius: 6px; cursor: pointer; letter-spacing: 0.5px; transition: background 0.2s, transform 0.1s;
        }
        .btn-action:hover { background: #00f5d4; }
        .btn-action:active { transform: scale(0.96); }
        .btn-secondary { background: #2a2a36; color: #00f5d4; border: 1px solid #00f5d4; }
        .btn-secondary:hover { background: #00f5d4; color: #0f0f14; }
        .btn-finish-center {
            background: #ffb703; color: #0f0f14; border: none; padding: 10px 24px; font-size: 17px; font-weight: 900;
            border-radius: 8px; cursor: pointer; letter-spacing: 1px; box-shadow: 0 0 15px rgba(255, 183, 3, 0.4);
            transition: background 0.2s, transform 0.1s, box-shadow 0.2s;
        }
        .btn-finish-center:hover { background: #ffd166; box-shadow: 0 0 22px rgba(255, 209, 102, 0.7); }
        .btn-finish-center:active { transform: scale(0.95); }
        .btn-danger { background: #2a2a36; color: #ff4d4d; border: 1px solid #ff4d4d; }
        .btn-danger:hover { background: #ff4d4d; color: #ffffff; }
        .status-badge { background: #2a2a36; padding: 6px 12px; border-radius: 6px; font-size: 16px; font-weight: 600; }

        .active-location-display {
            background: #141419; border: 2px dashed #00d4ff; border-radius: 6px; padding: 8px; margin-bottom: 10px;
            text-align: center; font-size: 26px; font-weight: 900; letter-spacing: 2px; color: #00f5d4; cursor: pointer; user-select: none;
        }
        .active-location-display .sub-hint { font-size: 13px; font-weight: normal; color: #888; margin-top: 2px; display: block; }

        .tip-banner {
            background: rgba(255, 183, 3, 0.12); border: 1px solid #ffb703; border-radius: 6px; padding: 6px 12px;
            margin-bottom: 10px; display: flex; justify-content: center; align-items: center; gap: 12px; font-size: 16px; color: #ffd166;
        }
        .tip-banner strong { color: #ffb703; letter-spacing: 0.5px; }
        .tip-hierarchy { font-family: monospace; font-size: 17px; font-weight: bold; background: #141419; padding: 2px 8px; border-radius: 4px; border: 1px solid #333; color: #00d4ff; }

        .input-section { margin-bottom: 10px; }
        .input-label { display: block; font-size: 15px; margin-bottom: 4px; text-transform: uppercase; color: #aaa; font-weight: 700; }
        .scan-input {
            width: 100%; padding: 14px; font-size: 21px; background: #0f0f14; border: 2px solid #00d4ff;
            border-radius: 8px; color: #fff; outline: none; box-sizing: border-box;
        }
        .scan-input.item-mode { border-color: #ffb703; }
        .main-content { display: flex; gap: 14px; flex-grow: 1; overflow: hidden; }
        .display-panel { flex: 1; background: #141419; border-radius: 8px; border: 1px solid #333; padding: 14px; overflow: auto; }
        .location-banner { font-size: 19px; font-weight: bold; margin-bottom: 10px; color: #ffb703; display: flex; justify-content: space-between; align-items: center; }
        .asin-table { width: 100%; border-collapse: collapse; text-align: left; white-space: nowrap; }
        .asin-table th, .asin-table td { padding: 10px 14px; border-bottom: 1px solid #2a2a36; font-size: 16px; }
        .asin-table th { color: #888; font-size: 14px; text-transform: uppercase; background: #141419; position: sticky; top: 0; z-index: 10; }
        .asin-tag { font-family: monospace; font-size: 17px; color: #00f5d4; }
        .item-tag { font-family: monospace; font-size: 17px; color: #ffb703; }
        .error-msg { color: #ff4d4d; font-weight: bold; margin-top: 6px; font-size: 16px; }
        .count-badge { font-size: 15px; background: #2a2a36; color: #fff; padding: 4px 10px; border-radius: 12px; }
        .match-tag { font-size: 13px; font-weight: bold; padding: 3px 8px; border-radius: 4px; display: inline-block; }
        .match-tag.known { background: rgba(0, 245, 212, 0.15); color: #00f5d4; border: 1px solid #00f5d4; }
        .match-tag.unknown { background: rgba(255, 77, 77, 0.15); color: #ff4d4d; border: 1px solid #ff4d4d; }
        .summary-row { background: #22222e !important; font-weight: bold; }

        .modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.85); z-index: 1000000; justify-content: center; align-items: center; }
        .modal-content { background: #141419; border: 2px solid #333; border-radius: 8px; width: 85vw; height: 80vh; display: flex; flex-direction: column; padding: 20px; box-sizing: border-box; }
        .modal-content-small { background: #141419; border: 2px solid #00d4ff; border-radius: 8px; width: 440px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .modal-title { font-size: 19px; font-weight: bold; color: #00d4ff; }
        .log-display { flex-grow: 1; background: #0f0f14; border: 1px solid #2a2a36; border-radius: 6px; overflow: auto; }
        .modal-actions { display: flex; gap: 10px; margin-top: 14px; justify-content: flex-end; }
        .locked-notice { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 70%; color: #666; gap: 10px; text-align: center; font-size: 16px; }
        .locked-notice .lock-icon { font-size: 38px; color: #ffb703; }
    `;
    document.head.appendChild(style);

    // Build DOM Layout
    const appContainer = document.createElement('div');
    appContainer.id = 'qifcr-app-container';
    appContainer.innerHTML = `
        <div class="app-wrapper">
            <div class="app-header">
                <div class="header-left">
                    <div class="app-title">CYCLE COUNT</div>
                    <div class="user-tag" id="user-display">USER: NONE</div>
                    <button class="btn-action btn-secondary" id="btn-switch-user">LOGIN</button>
                </div>
                <div class="header-center">
                    <button class="btn-finish-center" id="btn-finish-loc">FINISH LOCATION</button>
                </div>
                <div class="header-right">
                    <button class="btn-action btn-secondary" id="btn-view-log">VIEW LOG</button>
                    <div class="status-badge" id="app-status">SCAN LOCATION</div>
                </div>
            </div>

            <div class="active-location-display" id="active-loc-banner">
                <span id="active-loc-text">NO LOCATION ACTIVE</span>
                <span class="sub-hint" id="active-loc-hint">Click location banner to unlock System Inventory View</span>
            </div>

            <div class="input-section">
                <label class="input-label" id="input-label" for="scan-input">Scan Location Barcode (Must start with P-1)</label>
                <input type="text" id="scan-input" class="scan-input" placeholder="Scan bin/location barcode starting with P-1..." autofocus autocomplete="off">
                <div id="error-display" class="error-msg"></div>
            </div>

            <div class="tip-banner">
                <div><strong>💡 TIP:</strong> Barcode Hierarchy</div>
                <div class="tip-hierarchy">LPN - XOO - BOO - EAN</div>
            </div>

            <div class="main-content">
                <div class="display-panel" id="qifcr-panel">
                    <div class="location-banner">QIFCR System Inventory</div>
                    <div id="qifcr-content">
                        <div class="locked-notice">
                            <div class="lock-icon">🔒</div>
                            <div>SYSTEM INVENTORY HIDDEN</div>
                            <div style="font-size: 14px; color: #555;">Click the location banner above and enter password to reveal.</div>
                        </div>
                    </div>
                </div>
                <div class="display-panel" id="scanned-panel">
                    <div class="location-banner">
                        Physical Scans
                        <span class="count-badge" id="scanned-count">0 items</span>
                    </div>
                    <table class="asin-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>User</th>
                                <th>Barcode / LPN</th>
                                <th>Matched FNSKU</th>
                                <th>Status</th>
                                <th>Timestamp</th>
                            </tr>
                        </thead>
                        <tbody id="scanned-body">
                            <tr><td colspan="6" style="color: #666;">No physical items scanned yet.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="modal-overlay" id="login-modal">
            <div class="modal-content-small">
                <div class="modal-title" style="color: #00d4ff;">OPERATOR LOGIN</div>
                <input type="text" id="login-input" class="scan-input" placeholder="User ID (Letters only)" autocomplete="off">
                <div id="login-error" class="error-msg" style="font-size: 15px;"></div>
                <button class="btn-action" id="btn-submit-login" style="width: 100%;">CONFIRM LOGIN</button>
            </div>
        </div>

        <div class="modal-overlay" id="confirm-modal">
            <div class="modal-content-small" style="border-color: #ffb703;">
                <div class="modal-title" style="color: #ffb703;">LOCATION IN PROGRESS</div>
                <div id="confirm-msg" style="font-size: 16px; color: #fff; line-height: 1.4;"></div>
                <div style="display: flex; gap: 10px; margin-top: 6px;">
                    <button class="btn-action btn-finish-center" id="btn-confirm-yes" style="flex: 1; font-size: 15px; padding: 10px;">AUTO-FINISH & SWITCH</button>
                    <button class="btn-action btn-secondary" id="btn-confirm-no" style="flex: 1;">CANCEL SCAN</button>
                </div>
            </div>
        </div>

        <div class="modal-overlay" id="log-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-title">SESSION LOG TABLE</div>
                </div>
                <div class="log-display" id="log-display-area"></div>
                <div class="modal-actions">
                    <button class="btn-action btn-danger" id="btn-clear-log">CLEAR LOG</button>
                    <button class="btn-action btn-secondary" id="btn-download-csv">DOWNLOAD CSVS</button>
                    <button class="btn-action btn-secondary" id="btn-copy-log">COPY JSON</button>
                    <button class="btn-action" id="btn-close-log">CLOSE</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(appContainer);

    // DOM Elements
    const inputEl = document.getElementById('scan-input');
    const inputLabelEl = document.getElementById('input-label');
    const statusEl = document.getElementById('app-status');
    const errorEl = document.getElementById('error-display');
    const userDisplayEl = document.getElementById('user-display');
    const qifcrContent = document.getElementById('qifcr-content');
    const scannedBody = document.getElementById('scanned-body');
    const scannedCountEl = document.getElementById('scanned-count');

    const activeLocBanner = document.getElementById('active-loc-banner');
    const activeLocText = document.getElementById('active-loc-text');
    const activeLocHint = document.getElementById('active-loc-hint');

    const btnFinishLoc = document.getElementById('btn-finish-loc');
    const btnViewLog = document.getElementById('btn-view-log');
    const btnCopyLog = document.getElementById('btn-copy-log');
    const btnDownloadCsv = document.getElementById('btn-download-csv');
    const btnClearLog = document.getElementById('btn-clear-log');
    const btnCloseLog = document.getElementById('btn-close-log');
    const btnSwitchUser = document.getElementById('btn-switch-user');

    const loginModal = document.getElementById('login-modal');
    const loginInput = document.getElementById('login-input');
    const loginError = document.getElementById('login-error');
    const btnSubmitLogin = document.getElementById('btn-submit-login');

    const confirmModal = document.getElementById('confirm-modal');
    const confirmMsg = document.getElementById('confirm-msg');
    const btnConfirmYes = document.getElementById('btn-confirm-yes');
    const btnConfirmNo = document.getElementById('btn-confirm-no');

    const logModal = document.getElementById('log-modal');
    const logDisplayArea = document.getElementById('log-display-area');

    let pendingNextLocation = null;

    // Send payload to Smartsheet via Cloudflare Proxy
    function postToSmartsheet(sheetId, rowDataArray) {
        GM_xmlhttpRequest({
            method: 'POST',
            url: PROXY_URL,
            headers: {
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({
                sheetId: sheetId,
                rowData: rowDataArray
            }),
            onload: (response) => {
                if (response.status !== 200 && response.status !== 201) {
                    console.error(`Smartsheet Proxy Error [${sheetId}]:`, response.responseText);
                }
            },
            onerror: (err) => console.error(`Smartsheet Network Error [${sheetId}]:`, err)
        });
    }

    function pushLocationLogsToSmartsheet(location, entry) {
        if (!entry) return;

        const user = entry.user || 'UNKNOWN';
        const items = entry.scannedItems || [];
        const summary = entry.summary || null;
        const locationTimestamp = entry.timestamp ? new Date(entry.timestamp).toISOString() : '';

        if (items.length > 0) {
            const scanRows = items.map(item => ({
                toBottom: true,
                cells: [
                    { columnId: 3166583700361092, value: location },
                    { columnId: 7670183327731588, value: item.user || user },
                    { columnId: 2040683793518468, value: locationTimestamp },
                    { columnId: 6544283420888964, value: item.barcode },
                    { columnId: 4292483607203716, value: item.matchedFnsku || 'N/A' },
                    { columnId: 8796083234574212, value: item.isRecognized ? 'TRUE' : 'FALSE' },
                    { columnId: 611688044597124,  value: item.time || '' }
                ]
            }));
            postToSmartsheet(SCAN_SHEET_ID, scanRows);
        }

        if (summary && summary.fnskuCounts) {
            const summaryRows = Object.keys(summary.fnskuCounts).map(fnskuKey => {
                const bData = summary.fnskuCounts[fnskuKey];
                return {
                    toBottom: true,
                    cells: [
                        { columnId: 681542919425924,  value: location },
                        { columnId: 5185142546796420, value: user },
                        { columnId: 2933342733111172, value: locationTimestamp },
                        { columnId: 7436942360481668, value: fnskuKey },
                        { columnId: 1807442826268548, value: bData.fetchedQty },
                        { columnId: 6311042453639044, value: bData.scannedQty },
                        { columnId: 8108469707902852, value: bData.variance },
                        { columnId: 3604870080532356, value: bData.mismatch ? 'TRUE' : 'FALSE' },
                        { columnId: 5856669894217604, value: summary.isMismatch ? 'TRUE' : 'FALSE' },
                        { columnId: 1353070266847108, value: summary.finishedAt || '' }
                    ]
                };
            });
            postToSmartsheet(SUMMARY_SHEET_ID, summaryRows);
        }
    }

    [inputEl, loginInput].forEach(el => {
        el.addEventListener('paste', (e) => e.stopPropagation());
        el.addEventListener('copy', (e) => e.stopPropagation());
        el.addEventListener('cut', (e) => e.stopPropagation());
    });

    document.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.closest('button') || e.target.closest('.modal-content')) return;
        if (loginModal.style.display === 'flex') loginInput.focus();
        else if (logModal.style.display !== 'flex' && confirmModal.style.display !== 'flex') inputEl.focus();
    });

    function checkUserLogin() {
        if (!currentUser) {
            loginModal.style.display = 'flex';
            loginInput.value = '';
            loginInput.focus();
        } else {
            loginModal.style.display = 'none';
            userDisplayEl.innerText = `USER: ${currentUser}`;
            inputEl.focus();
        }
    }

    loginInput.addEventListener('input', () => {
        loginInput.value = loginInput.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
    });

    function executeLogin() {
        const val = loginInput.value.trim();
        if (!val) { loginError.innerText = 'Login ID cannot be empty.'; return; }
        currentUser = val;
        loginError.innerText = '';
        loginInput.value = '';
        checkUserLogin();
    }

    btnSubmitLogin.addEventListener('click', executeLogin);
    loginInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') executeLogin(); });
    btnSwitchUser.addEventListener('click', () => { currentUser = ''; checkUserLogin(); });

    activeLocBanner.addEventListener('click', () => {
        if (isInventoryUnlocked) {
            isInventoryUnlocked = false;
            activeLocHint.innerText = "Click location banner to unlock System Inventory View";
            renderQifcrTable(cachedInventoryTableData);
            return;
        }
        const pwd = prompt('Enter password to view System Inventory details:');
        if (pwd === INVENTORY_VIEW_PASSWORD) {
            isInventoryUnlocked = true;
            activeLocHint.innerText = "Click location banner to hide System Inventory View";
            renderQifcrTable(cachedInventoryTableData);
        } else if (pwd !== null) {
            alert('Incorrect password. View access denied.');
        }
    });

    function fetchQifcrInventory(searchQuery) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${QIFCR_BASE}/${WAREHOUSE_ID}/results/inventory`,
                data: 's=' + encodeURIComponent(searchQuery),
                headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'text/html, */*' },
                timeout: 10000,
                onload: r => (r.status === 200 && r.responseText) ? resolve(r.responseText) : reject(new Error(`HTTP ${r.status}`)),
                onerror: () => reject(new Error('Network Error')),
                ontimeout: () => reject(new Error('Request Timeout'))
            });
        });
    }

    async function resolveEanToFnsku(eanCode) {
        try {
            const html = await fetchQifcrInventory(eanCode);
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('tr');

            const primaryHeaderRow = doc.querySelector('thead tr') || doc.querySelector('tr');
            const headers = [];
            if (primaryHeaderRow) {
                primaryHeaderRow.querySelectorAll('th').forEach(th => headers.push(th.textContent.trim().toLowerCase()));
            }

            const fnskuIdx = headers.findIndex(h => h.includes('fnsku'));
            const asinIdx = headers.findIndex(h => h === 'asin');
            const locIdx = headers.findIndex(h => h.includes('location') || h.includes('bin'));

            let resolvedFnsku = null;

            rows.forEach(tr => {
                if (tr.querySelector('th') && !tr.querySelector('td')) return;
                const cells = tr.querySelectorAll('td');
                if (cells.length > 0) {
                    const rowFnsku = fnskuIdx !== -1 ? cells[fnskuIdx]?.textContent.trim().toUpperCase() : '';
                    const rowAsin = asinIdx !== -1 ? cells[asinIdx]?.textContent.trim().toUpperCase() : '';
                    const rowLoc = locIdx !== -1 ? cells[locIdx]?.textContent.trim().toUpperCase() : '';

                    const fnskuCandidate = rowFnsku || rowAsin;

                    if (rowLoc === currentLocation && fnskuCandidate) {
                        resolvedFnsku = fnskuCandidate;
                    } else if (!resolvedFnsku && fnskuCandidate && currentFnskuCounts[fnskuCandidate] !== undefined) {
                        resolvedFnsku = fnskuCandidate;
                    }
                }
            });

            return resolvedFnsku;
        } catch (err) {
            console.error(`Error resolving EAN ${eanCode}:`, err);
            return null;
        }
    }

    function parseFullInventoryTable(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const primaryHeaderRow = doc.querySelector('thead tr') || doc.querySelector('tr');
        const allHeaders = [];

        if (primaryHeaderRow) {
            primaryHeaderRow.querySelectorAll('th').forEach(th => allHeaders.push(th.textContent.trim().toLowerCase()));
        }

        const targetMap = [
            { name: 'FNSKU', index: allHeaders.findIndex(h => h.includes('fnsku')) },
            { name: 'ASIN', index: allHeaders.findIndex(h => h === 'asin') },
            { name: 'FCSKU', index: allHeaders.findIndex(h => h.includes('fcsku')) },
            { name: 'LPN', index: allHeaders.findIndex(h => h === 'lpn') },
            { name: 'QUANTITY', index: allHeaders.findIndex(h => h.includes('quantity') || h.includes('qty')) }
        ];

        const validTargets = targetMap.filter(t => t.index !== -1);
        const displayHeaders = validTargets.map(t => t.name);
        const asinColIdx = validTargets.findIndex(t => t.name === 'ASIN');
        const qtyColIdx = validTargets.findIndex(t => t.name === 'QUANTITY');

        const rows = [];
        const extractedValues = new Set();
        const fnskuCounts = {};
        const barcodeToFnskuMap = {};
        let totalQuantity = 0;

        doc.querySelectorAll('tr').forEach(tr => {
            if (tr.querySelector('th') && !tr.querySelector('td')) return;
            const cells = tr.querySelectorAll('td');
            if (cells.length > 0) {
                let primaryFnsku = '';
                let rowQty = 0;
                const rowBarcodes = [];

                const rowData = validTargets.map((target, idx) => {
                    const cell = cells[target.index];
                    const val = cell ? cell.textContent.trim().replace(/\s+/g, ' ') : '';
                    if (val && target.name !== 'QUANTITY') {
                        const cleanVal = val.toUpperCase();
                        extractedValues.add(cleanVal);
                        rowBarcodes.push(cleanVal);
                        if (target.name === 'FNSKU') primaryFnsku = cleanVal;
                    }
                    if (idx === qtyColIdx) {
                        const parsedQty = parseInt(val, 10);
                        if (!isNaN(parsedQty)) { rowQty = parsedQty; totalQuantity += parsedQty; }
                    }
                    return val;
                });

                if (!primaryFnsku && asinColIdx !== -1) primaryFnsku = rowData[asinColIdx]?.toUpperCase() || '';
                if (primaryFnsku) {
                    fnskuCounts[primaryFnsku] = (fnskuCounts[primaryFnsku] || 0) + rowQty;
                    rowBarcodes.forEach(code => { barcodeToFnskuMap[code] = primaryFnsku; });
                }
                if (rowData.some(val => val !== '')) rows.push(rowData);
            }
        });

        return {
            headers: displayHeaders.length > 0 ? displayHeaders : ['FNSKU', 'ASIN', 'FCSKU', 'LPN', 'QUANTITY'],
            rows, extractedValues, fnskuCounts, barcodeToFnskuMap, totalQuantity
        };
    }

    function renderQifcrTable(tableData) {
        cachedInventoryTableData = tableData;
        if (!isInventoryUnlocked) {
            qifcrContent.innerHTML = `<div class="locked-notice"><div class="lock-icon">🔒</div><div style="font-weight: bold; color: #ffb703;">SYSTEM INVENTORY HIDDEN</div></div>`;
            return;
        }
        if (!tableData || tableData.rows.length === 0) {
            qifcrContent.innerHTML = `<div style="color: #888; padding: 10px;">No inventory items found in system for this location.</div>`;
            return;
        }
        qifcrContent.innerHTML = `<table class="asin-table"><thead><tr>${tableData.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${tableData.rows.map(row => `<tr>${row.map(cell => `<td class="asin-tag">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }

    function renderScannedItems() {
        scannedCountEl.innerText = `${currentScannedItems.length} items`;
        if (currentScannedItems.length === 0) {
            scannedBody.innerHTML = `<tr><td colspan="6" style="color: #666;">No physical items scanned yet.</td></tr>`;
            return;
        }
        scannedBody.innerHTML = currentScannedItems.map((item, index) => {
            const statusTag = item.isRecognized ? `<span class="match-tag known">RECOGNIZED</span>` : `<span class="match-tag unknown">NOT IN QIFCR</span>`;
            return `<tr><td style="color: #666;">${index + 1}</td><td style="color: #00f5d4; font-size: 14px;">${item.user || 'UNKNOWN'}</td><td class="item-tag">${item.barcode}</td><td class="asin-tag">${item.matchedFnsku || 'N/A'}</td><td>${statusTag}</td><td style="color: #888; font-size: 14px;">${item.time}</td></tr>`;
        }).reverse().join('');
    }

    function renderLogTable() {
        const fullLogs = GM_getValue('cycle_count_data', {});
        const locations = Object.keys(fullLogs);
        if (locations.length === 0) { logDisplayArea.innerHTML = `<div style="color: #888; padding: 20px; text-align: center;">No stored logs available.</div>`; return; }

        let tableHtml = `<table class="asin-table"><thead><tr><th>Location</th><th>User</th><th>Scanned Barcode</th><th>Matched FNSKU</th><th>Status</th><th>Scan Time</th></tr></thead><tbody>`;
        locations.reverse().forEach(locKey => {
            const entry = fullLogs[locKey];
            const user = entry.user || 'UNKNOWN';
            const items = entry.scannedItems || [];
            const summary = entry.summary || null;
            const totalRows = items.length + (summary ? 1 : 0);
            const rowspanAttr = totalRows > 0 ? `rowspan="${totalRows}"` : '';

            if (items.length === 0 && !summary) {
                tableHtml += `<tr><td class="asin-tag">${locKey}</td><td style="color: #00f5d4; font-size: 14px;">${user}</td><td colspan="4" style="color: #666;">No items scanned</td></tr>`;
            } else {
                items.forEach((item, i) => {
                    const statusTag = item.isRecognized ? `<span class="match-tag known">RECOGNIZED</span>` : `<span class="match-tag unknown">NOT IN QIFCR</span>`;
                    tableHtml += `<tr>${i === 0 ? `<td class="asin-tag" ${rowspanAttr} style="vertical-align: top; border-right: 1px solid #2a2a36;">${locKey}</td>` : ''}<td style="color: #00f5d4; font-size: 14px;">${item.user || user}</td><td class="item-tag">${item.barcode}</td><td class="asin-tag">${item.matchedFnsku || 'N/A'}</td><td>${statusTag}</td><td style="color: #888; font-size: 14px;">${item.time}</td></tr>`;
                });
                if (summary) {
                    const isFirst = items.length === 0;
                    const isMismatch = summary.isMismatch;
                    tableHtml += `<tr class="summary-row">${isFirst ? `<td class="asin-tag" ${rowspanAttr} style="vertical-align: top; border-right: 1px solid #2a2a36;">${locKey}</td>` : ''}${isFirst ? `<td style="color: #00f5d4; font-size: 14px; vertical-align: top; border-right: 1px solid #2a2a36;">${user}</td>` : ''}<td colspan="3" style="color: #ffb703; font-weight: bold;">FNSKU SUMMARY: Fetched: ${summary.totalFetchedQty} | Scanned: ${summary.totalScannedQty} (Mismatch: ${isMismatch ? 'YES' : 'NO'})</td><td style="color: ${isMismatch ? '#ff4d4d' : '#00f5d4'}; font-weight: bold;">Unique FNSKUs: ${Object.keys(summary.fnskuCounts || {}).length} (${summary.finishedAt || ''})</td></tr>`;
                }
            }
        });
        tableHtml += `</tbody></table>`;
        logDisplayArea.innerHTML = tableHtml;
    }

    function switchMode(newMode) {
        mode = newMode;
        errorEl.innerText = '';
        inputEl.value = '';
        if (mode === 'LOCATION') {
            currentLocation = null; currentScannedItems = []; currentQifcrValues.clear(); currentFnskuCounts = {}; currentBarcodeToFnskuMap = {};
            activeLocText.innerText = 'NO LOCATION ACTIVE'; activeLocText.style.color = '#888';
            inputLabelEl.innerText = 'Scan Location Barcode (Must start with P-1)';
            inputEl.placeholder = 'Scan bin/location barcode starting with P-1...';
            inputEl.classList.remove('item-mode');
            statusEl.innerText = 'SCAN LOCATION'; statusEl.style.color = '#ffffff';
            cachedInventoryTableData = null;
            renderQifcrTable(null); renderScannedItems();
        } else if (mode === 'ITEM') {
            activeLocText.innerText = `LOCATION: ${currentLocation}`; activeLocText.style.color = '#00d4ff';
            inputLabelEl.innerText = `Scan Items in Location: ${currentLocation}`;
            inputEl.placeholder = 'Scan item barcode / FNSKU / ASIN / LPN...';
            inputEl.classList.add('item-mode');
            statusEl.innerText = `READY FOR ITEMS (${currentLocation})`; statusEl.style.color = '#ffb703';
        }
        inputEl.focus();
    }

    function calculateAndSaveSummary(location) {
        savedData = GM_getValue('cycle_count_data', {});
        const locEntry = savedData[location];
        if (!locEntry) return;

        const physicalCountsByFnsku = {};
        let totalScannedQty = 0;
        (locEntry.scannedItems || []).forEach(item => {
            const resolvedFnsku = item.matchedFnsku || item.barcode;
            physicalCountsByFnsku[resolvedFnsku] = (physicalCountsByFnsku[resolvedFnsku] || 0) + 1;
            totalScannedQty++;
        });

        const fnskuCounts = {};
        const allTrackedFnskus = new Set([...Object.keys(currentFnskuCounts), ...Object.keys(physicalCountsByFnsku)]);
        let totalFetchedQty = 0;
        let isMismatch = false;

        allTrackedFnskus.forEach(fnsku => {
            const fetched = currentFnskuCounts[fnsku] || 0;
            const scanned = physicalCountsByFnsku[fnsku] || 0;
            const variance = scanned - fetched;
            const mismatch = fetched !== scanned;
            totalFetchedQty += fetched;
            if (mismatch) isMismatch = true;
            fnskuCounts[fnsku] = { fetchedQty: fetched, scannedQty: scanned, variance: variance, mismatch: mismatch };
        });

        locEntry.summary = {
            totalFetchedQty, totalScannedQty, isMismatch, fnskuCounts, finishedAt: new Date().toLocaleTimeString()
        };

        GM_setValue('cycle_count_data', savedData);
        pushLocationLogsToSmartsheet(location, locEntry);
    }

    function finishCurrentLocation() {
        if (!currentLocation) { switchMode('LOCATION'); return; }
        calculateAndSaveSummary(currentLocation);
        switchMode('LOCATION');
    }

    btnFinishLoc.addEventListener('click', finishCurrentLocation);

    btnConfirmYes.addEventListener('click', () => {
        confirmModal.style.display = 'none';
        finishCurrentLocation();
        if (pendingNextLocation) {
            const locToProcess = pendingNextLocation;
            pendingNextLocation = null;
            processNewLocation(locToProcess);
        }
    });

    btnConfirmNo.addEventListener('click', () => {
        confirmModal.style.display = 'none';
        pendingNextLocation = null;
        inputEl.focus();
    });

    async function processNewLocation(locValue) {
        savedData = GM_getValue('cycle_count_data', {});
        if (savedData[locValue] && savedData[locValue].timestamp) {
            const lastScanTime = new Date(savedData[locValue].timestamp).getTime();
            const timeDiff = new Date().getTime() - lastScanTime;
            if (timeDiff < DUPLICATE_COOLDOWN_MS) {
                const remainingSecs = Math.ceil((DUPLICATE_COOLDOWN_MS - timeDiff) / 1000);
                errorEl.innerText = `BLOCKED: Location "${locValue}" scanned recently. Blocked for ${remainingSecs}s.`;
                return;
            }
        }

        currentLocation = locValue;
        currentScannedItems = [];
        currentQifcrValues.clear();
        currentFnskuCounts = {};
        currentBarcodeToFnskuMap = {};
        renderScannedItems();

        activeLocText.innerText = `LOCATION: ${currentLocation}`;
        activeLocText.style.color = '#ffb703';
        statusEl.innerText = 'FETCHING QIFCR...';
        statusEl.style.color = '#ffb703';

        try {
            const html = await fetchQifcrInventory(currentLocation);
            const inventoryTable = parseFullInventoryTable(html);

            currentQifcrValues = inventoryTable.extractedValues;
            currentFnskuCounts = inventoryTable.fnskuCounts;
            currentBarcodeToFnskuMap = inventoryTable.barcodeToFnskuMap;

            savedData = GM_getValue('cycle_count_data', {});
            savedData[currentLocation] = {
                user: currentUser,
                timestamp: new Date().toISOString(),
                qifcrInventory: { headers: inventoryTable.headers, rows: inventoryTable.rows },
                scannedItems: currentScannedItems,
                summary: null
            };
            GM_setValue('cycle_count_data', savedData);

            renderQifcrTable(inventoryTable);
            switchMode('ITEM');
        } catch (err) {
            statusEl.innerText = 'ERROR';
            statusEl.style.color = '#ff4d4d';
            errorEl.innerText = `Failed to fetch location ${currentLocation}: ${err.message}`;
            cachedInventoryTableData = null;
            qifcrContent.innerHTML = `<div style="color: #ff4d4d; padding: 10px;">Error loading data for ${currentLocation}</div>`;
        }
    }

    btnViewLog.addEventListener('click', () => {
        const pwd = prompt('Enter password to view logs:');
        if (pwd === VIEW_LOG_PASSWORD) { renderLogTable(); logModal.style.display = 'flex'; }
        else if (pwd !== null) alert('Incorrect password. Access denied.');
    });

    btnCloseLog.addEventListener('click', () => { logModal.style.display = 'none'; inputEl.focus(); });

    btnCopyLog.addEventListener('click', () => {
        navigator.clipboard.writeText(JSON.stringify(GM_getValue('cycle_count_data', {}), null, 2)).then(() => {
            btnCopyLog.innerText = 'COPIED!';
            setTimeout(() => { btnCopyLog.innerText = 'COPY JSON'; }, 2000);
        });
    });

    btnClearLog.addEventListener('click', () => {
        const pwd = prompt('Enter password to clear session logs:');
        if (pwd === CLEAR_LOG_PASSWORD) {
            GM_setValue('cycle_count_data', {});
            savedData = {};
            renderLogTable();
            alert('Logs cleared successfully.');
        } else if (pwd !== null) {
            alert('Incorrect password. Action cancelled.');
        }
    });

    function triggerDownload(csvRows, filename) {
        const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", encodeURI(csvContent));
        downloadAnchor.setAttribute("download", filename);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    }

    btnDownloadCsv.addEventListener('click', () => {
        const fullLogs = GM_getValue('cycle_count_data', {});
        const locations = Object.keys(fullLogs);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let scanRows = [['Location', 'User', 'Location Timestamp', 'Scanned Barcode', 'Matched FNSKU', 'Is Recognized', 'Scan Time']];
        let summaryRows = [['Location', 'User', 'Location Timestamp', 'FNSKU', 'Fetched FNSKU Qty', 'Scanned FNSKU Qty', 'FNSKU Variance', 'Is FNSKU Mismatch', 'Location Overall Mismatch', 'Finished At']];

        locations.forEach(locKey => {
            const entry = fullLogs[locKey];
            const user = entry.user || 'N/A';
            const locTime = entry.timestamp ? new Date(entry.timestamp).toISOString() : '';
            (entry.scannedItems || []).forEach(item => {
                scanRows.push([locKey, item.user || user, locTime, item.barcode, item.matchedFnsku || 'N/A', item.isRecognized ? 'TRUE' : 'FALSE', item.time || '']);
            });
            if (entry.summary && entry.summary.fnskuCounts) {
                Object.keys(entry.summary.fnskuCounts).forEach(fnskuKey => {
                    const bData = entry.summary.fnskuCounts[fnskuKey];
                    summaryRows.push([locKey, user, locTime, fnskuKey, bData.fetchedQty, bData.scannedQty, bData.variance, bData.mismatch ? 'TRUE' : 'FALSE', entry.summary.isMismatch ? 'TRUE' : 'FALSE', entry.summary.finishedAt || '']);
                });
            }
        });

        triggerDownload(scanRows, `cycle_count_scans_${timestamp}.csv`);
        setTimeout(() => { triggerDownload(summaryRows, `cycle_count_summary_${timestamp}.csv`); }, 300);
    });

    inputEl.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        const value = inputEl.value.trim().toUpperCase();
        inputEl.value = '';
        errorEl.innerText = '';
        if (!value) return;

        if (!currentUser) { checkUserLogin(); return; }

        if (value.startsWith('P-1')) {
            if (mode === 'ITEM' && currentLocation) {
                if (value === currentLocation) {
                    errorEl.innerText = `ERROR: Location "${value}" is ALREADY active.`;
                    return;
                }
                pendingNextLocation = value;
                confirmMsg.innerText = `Location "${currentLocation}" is active. Do you want to auto-finish and switch to "${value}"?`;
                confirmModal.style.display = 'flex';
                return;
            }
            processNewLocation(value);
        } else {
            if (mode === 'LOCATION') {
                errorEl.innerText = `BLOCKED: Scan a P-1... location barcode first.`;
                return;
            }

            if (/[^A-Z0-9]/.test(value)) {
                errorEl.innerText = `BLOCKED: Item scan contains special characters. Only standard alphanumeric characters are allowed.`;
                return;
            }

            const timeString = new Date().toLocaleTimeString();
            let isRecognized = currentQifcrValues.has(value);
            let matchedFnsku = currentBarcodeToFnskuMap[value] || null;

            if (!matchedFnsku) {
                statusEl.innerText = 'RESOLVING EAN...';
                statusEl.style.color = '#ffb703';

                matchedFnsku = await resolveEanToFnsku(value);

                if (matchedFnsku) {
                    isRecognized = true;
                    currentQifcrValues.add(value);
                    currentBarcodeToFnskuMap[value] = matchedFnsku;
                }
                statusEl.innerText = `READY FOR ITEMS (${currentLocation})`;
            }

            currentScannedItems.push({
                user: currentUser,
                barcode: value,
                matchedFnsku: matchedFnsku,
                isRecognized: isRecognized,
                time: timeString
            });

            savedData = GM_getValue('cycle_count_data', {});
            if (savedData[currentLocation]) {
                savedData[currentLocation].scannedItems = currentScannedItems;
                GM_setValue('cycle_count_data', savedData);
            }
            renderScannedItems();
        }
    });

    checkUserLogin();
})();
