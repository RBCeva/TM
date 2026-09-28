// ==UserScript==
// @name         Rodeo Floor Plan Cage & FNSKU Visualizer (Problem Solving)
// @namespace    http://tampermonkey.net/
// @version      28.0
// @description  Compact visualization with horizontal bubble wrapping for Other sections based on window width.
// @author       RB
// @match        https://rodeo.eu.aftx.amazonoperations.app/*/ItemList*
// @downloadURL  https://github.com/RBCeva/TM/raw/refs/heads/main/RodeoProblemSolve.user.js
// @updateURL    https://github.com/RBCeva/TM/raw/refs/heads/main/RodeoProblemSolve.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        THRESHOLDS: {
            GREEN_MIN: 5,   // 5+ min -> Green bubble
            BLUE_MIN: 10,   // 10+ min -> Blue bubble
            RED_MIN: 15     // 15+ min -> Red bubble
        },
        CONTAINER_ID: 'rodeo-floorplan-visualizer-root',
        POLL_INTERVAL_MS: 3000,
        AUTO_REFRESH_MS: 60000 // 1 minute auto-refresh
    };

    if (!window.location.href.includes('WorkPool=ProblemSolving')) {
        return;
    }

    let lastDataString = '';
    let isMinimized = false;
    let refreshSecondsLeft = CONFIG.AUTO_REFRESH_MS / 1000;

    const LAYOUT = [
        { hazmat: 'wsHAZMAT A19', nonsortA: 'wsNONSORT A20', nonsortB_L: 'wsNONSORT B19', nonsortB_R: 'wsNONSORT B20', nonsortC_L: 'wsNONSORT C19', nonsortC_R: 'wsNONSORT C20', nonsortD_L: 'wsNONSORT D19', nonsortD_R: 'wsNONSORT D20' },
        { hazmat: 'wsHAZMAT A17', nonsortA: 'wsNONSORT A18', nonsortB_L: 'wsNONSORT B17', nonsortB_R: 'wsNONSORT B18', nonsortC_L: 'wsNONSORT C17', nonsortC_R: 'wsNONSORT C18', nonsortD_L: 'wsNONSORT D17', nonsortD_R: 'wsNONSORT D18' },
        { hazmat: 'wsHAZMAT A15', nonsortA: 'wsNONSORT A16', nonsortB_L: 'wsNONSORT B15', nonsortB_R: 'wsNONSORT B16', nonsortC_L: 'wsNONSORT C15', nonsortC_R: 'wsNONSORT C16', nonsortD_L: 'wsNONSORT D15', nonsortD_R: 'wsNONSORT D16' },
        { hazmat: 'wsHAZMAT A13', nonsortA: 'wsNONSORT A14', nonsortB_L: 'wsNONSORT B13', nonsortB_R: 'wsNONSORT B14', nonsortC_L: 'wsNONSORT C13', nonsortC_R: 'wsNONSORT C14', nonsortD_L: 'wsNONSORT D13', nonsortD_R: 'wsNONSORT D14' },
        { hazmat: 'wsHAZMAT A11', nonsortA: 'wsNONSORT A12', nonsortB_L: 'wsNONSORT B11', nonsortB_R: 'wsNONSORT B12', nonsortC_L: 'wsNONSORT C11', nonsortC_R: 'wsNONSORT C12', nonsortD_L: 'wsNONSORT D11', nonsortD_R: 'wsNONSORT D12' },
        { hazmat: 'wsHAZMAT A09', nonsortA: 'wsNONSORT A10', nonsortB_L: 'wsNONSORT B09', nonsortB_R: 'wsNONSORT B10', nonsortC_L: 'wsNONSORT C09', nonsortC_R: 'wsNONSORT C10', nonsortD_L: 'wsNONSORT D09', nonsortD_R: 'wsNONSORT D10' },
        { hazmat: 'wsHAZMAT A07', nonsortA: 'wsNONSORT A08', nonsortB_L: 'wsNONSORT B07', nonsortB_R: 'wsNONSORT B08', nonsortC_L: 'wsNONSORT C07', nonsortC_R: 'wsNONSORT C08', nonsortD_L: 'wsNONSORT D07', nonsortD_R: 'wsNONSORT D08' },
        { hazmat: 'wsHAZMAT A05', nonsortA: 'wsNONSORT A06', nonsortB_L: 'wsNONSORT B05', nonsortB_R: 'wsNONSORT B06', nonsortC_L: 'wsNONSORT C05', nonsortC_R: 'wsNONSORT C06', nonsortD_L: 'wsNONSORT D05', nonsortD_R: 'wsNONSORT D06' },
        { hazmat: 'wsHAZMAT A03', nonsortA: 'wsNONSORT A04', nonsortB_L: 'wsNONSORT B03', nonsortB_R: 'wsNONSORT B04', nonsortC_L: 'wsNONSORT C03', nonsortC_R: 'wsNONSORT C04', nonsortD_L: 'wsNONSORT D03', nonsortD_R: 'wsNONSORT D04' },
        { hazmat: 'wsHAZMAT A01', nonsortA: 'wsNONSORT A02', nonsortB_L: 'wsNONSORT B01', nonsortB_R: 'wsNONSORT B02', nonsortC_L: 'wsNONSORT C01', nonsortC_R: 'wsNONSORT C02', nonsortD_L: 'wsNONSORT D01', nonsortD_R: 'wsNONSORT D02' }
    ];

    function normalizeStationName(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .replace(/^tspspack|^ws/i, '')
            .replace(/nonsort|hazmat/gi, '')
            .replace(/[^a-z0-9]/gi, '')
            .replace(/([a-z])0+(\d+)/i, '$1$2');
    }

    function formatDisplayName(key) {
        if (!key) return '';
        return key
            .replace(/^ws/i, '')
            .replace(/NONSORT/i, '')
            .replace(/HAZMAT/i, '')
            .replace(/_/g, '')
            .trim();
    }

    function parseDwellTimeMinutes(text) {
        if (!text) return 0;
        text = text.trim().toLowerCase();
        let totalMinutes = 0;
        const hoursMatch = text.match(/(\d+)\s*h/);
        const minsMatch = text.match(/(\d+)\s*m/);

        if (hoursMatch || minsMatch) {
            if (hoursMatch) totalMinutes += parseInt(hoursMatch[1], 10) * 60;
            if (minsMatch) totalMinutes += parseInt(minsMatch[1], 10);
            return totalMinutes;
        }

        const parts = text.split(':').map(p => parseInt(p, 10));
        if (parts.length === 3 && !parts.some(isNaN)) return parts[0] * 60 + parts[1] + parts[2] / 60;
        if (parts.length === 2 && !parts.some(isNaN)) return parts[0] + parts[1] / 60;

        const rawNum = parseFloat(text);
        return isNaN(rawNum) ? 0 : rawNum;
    }

    function formatShortEsd(esdString) {
        if (!esdString || esdString === 'N/A') return 'N/A';
        const clean = esdString.trim();
        return clean.length > 5 ? clean.slice(-5) : clean;
    }

    function extract5CharPrefixKey(scannableId) {
        if (!scannableId) return 'UNKNOWN';
        const clean = scannableId.trim().toUpperCase();
        return clean.slice(0, 5);
    }

    function extractCellData(cell) {
        if (!cell) return { text: '', url: '' };
        const link = cell.querySelector('a');
        return {
            text: cell.innerText.trim(),
            url: link ? link.getAttribute('href') || link.href : ''
        };
    }

    function getItemStyles(minutes) {
        if (minutes >= CONFIG.THRESHOLDS.RED_MIN) {
            return {
                bg: '#ffe6e6',
                border: '#e53e3e',
                textColor: '#742a2a'
            };
        } else if (minutes >= CONFIG.THRESHOLDS.BLUE_MIN) {
            return {
                bg: '#ebf8ff',
                border: '#3182ce',
                textColor: '#2c5282'
            };
        } else if (minutes >= CONFIG.THRESHOLDS.GREEN_MIN) {
            return {
                bg: '#f0fff4',
                border: '#38a169',
                textColor: '#22543d'
            };
        } else {
            return {
                bg: '#f7fafc',
                border: '#cbd5e0',
                textColor: '#4a5568'
            };
        }
    }

    function highlightTableRows() {
        const table = document.querySelector('table');
        if (!table) return;

        const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(th => th.innerText.trim());
        const dwellColIdx = headers.findIndex(h => /dwell|age|elapsed|time/i.test(h));
        if (dwellColIdx === -1) return;

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (!cells.length || !cells[dwellColIdx]) return;

            const dwellText = cells[dwellColIdx].innerText.trim();
            const minutes = parseDwellTimeMinutes(dwellText);
            const styles = getItemStyles(minutes);

            if (minutes >= CONFIG.THRESHOLDS.GREEN_MIN) {
                row.style.backgroundColor = styles.bg;
                row.style.color = styles.textColor;
            } else {
                row.style.backgroundColor = '';
                row.style.color = '';
            }
        });
    }

    function extractTableData() {
        const table = document.querySelector('table');
        if (!table) return [];

        const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(th => th.innerText.trim());

        const outerColIdx = headers.findIndex(h => /outer scannable/i.test(h));
        const cageColIdx = headers.findIndex(h => /(^scannable id|^container|^cage)/i.test(h));
        const fnskuColIdx = headers.findIndex(h => /fnsku|asin|sku|item/i.test(h));
        const dwellColIdx = headers.findIndex(h => /dwell|age|elapsed|time/i.test(h));
        const esdColIdx = headers.findIndex(h => /esd|ship date|expected ship/i.test(h));
        const condColIdx = headers.findIndex(h => /condition|reason|flag|grade/i.test(h));

        const finalOuterIdx = outerColIdx !== -1 ? outerColIdx : 0;
        const finalCageIdx = cageColIdx !== -1 ? cageColIdx : finalOuterIdx;

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const items = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (!cells.length) return;

            const outerData = extractCellData(cells[finalOuterIdx]);
            const cageData = extractCellData(cells[finalCageIdx]);

            const outerId = outerData.text;
            const scannableId = cageData.text || outerId;
            const scannableUrl = cageData.url || outerData.url;

            if (/^tscage/i.test(scannableId) || /^tscage/i.test(outerId)) {
                return;
            }

            let stationTarget = outerId;
            let spId = '';

            if (/^tsps/i.test(scannableId)) {
                stationTarget = scannableId;
            } else if (/^sp/i.test(scannableId)) {
                stationTarget = outerId;
                spId = scannableId;
            }

            const fnskuData = extractCellData(cells[fnskuColIdx]);
            const fnsku = fnskuData.text || 'N/A';
            const fnskuUrl = fnskuData.url;

            const dwellRaw = dwellColIdx !== -1 && cells[dwellColIdx] ? cells[dwellColIdx].innerText.trim() : '0';
            const esdRaw = esdColIdx !== -1 && cells[esdColIdx] ? cells[esdColIdx].innerText.trim() : 'N/A';
            const condition = condColIdx !== -1 && cells[condColIdx] ? cells[condColIdx].innerText.trim() : 'N/A';

            if (outerId || scannableId) {
                items.push({
                    outerId,
                    scannableId,
                    scannableUrl,
                    stationTarget,
                    spId,
                    cageId: stationTarget,
                    fnsku,
                    fnskuUrl,
                    esdShort: formatShortEsd(esdRaw),
                    condition,
                    minutes: parseDwellTimeMinutes(dwellRaw)
                });
            }
        });

        return items;
    }

    function updateHeaderLabel(headerBtnText) {
        const toggleText = isMinimized ? '🗖 Expand Map' : '🗕 Minimize';
        headerBtnText.innerHTML = `
            <span>🏭 Rodeo Floor Layout Map (Problem Solving) <small style="font-weight: normal; opacity: 0.8; margin-left: 12px;">🔄 Auto-refreshing in ${refreshSecondsLeft}s</small></span>
            <span style="margin-left: 8px;">${toggleText}</span>
        `;
    }

    function applyMinMaxStyles(rootDiv, contentDiv, headerBtnText) {
        if (isMinimized) {
            rootDiv.style.top = 'auto';
            rootDiv.style.bottom = '0';
            rootDiv.style.left = '0';
            rootDiv.style.right = '0';
            rootDiv.style.width = '100vw';
            rootDiv.style.height = 'auto';
            rootDiv.style.borderRadius = '0';
            rootDiv.style.boxShadow = '0 -4px 10px rgba(0, 0, 0, 0.3)';
            contentDiv.style.display = 'none';
        } else {
            rootDiv.style.top = '0';
            rootDiv.style.bottom = '0';
            rootDiv.style.left = '0';
            rootDiv.style.right = '0';
            rootDiv.style.width = '100vw';
            rootDiv.style.height = '100vh';
            rootDiv.style.borderRadius = '0';
            rootDiv.style.boxShadow = 'none';
            contentDiv.style.display = 'block';
        }
        updateHeaderLabel(headerBtnText);
    }

    function injectDashboardUI() {
        if (document.getElementById(CONFIG.CONTAINER_ID)) return;

        const rootDiv = document.createElement('div');
        rootDiv.id = CONFIG.CONTAINER_ID;
        rootDiv.style.cssText = `
            position: fixed;
            z-index: 99999;
            background: #ffffff;
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transition: all 0.2s ease-in-out;
        `;

        const headerBtn = document.createElement('button');
        headerBtn.id = 'rodeo-header-toggle-btn';
        headerBtn.style.cssText = `
            width: 100%;
            background: #232f3e;
            color: #ffffff;
            padding: 8px 16px;
            border: none;
            font-weight: bold;
            font-size: 13px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-top: 2px solid #ff9900;
            border-bottom: 2px solid #ff9900;
            box-sizing: border-box;
        `;

        const contentDiv = document.createElement('div');
        contentDiv.id = 'rodeo-floor-content';
        contentDiv.style.cssText = `
            padding: 8px;
            overflow-y: auto;
            overflow-x: auto;
            background: #e2e8f0;
            flex: 1;
        `;

        applyMinMaxStyles(rootDiv, contentDiv, headerBtn);

        headerBtn.addEventListener('click', () => {
            isMinimized = !isMinimized;
            applyMinMaxStyles(rootDiv, contentDiv, headerBtn);
        });

        rootDiv.appendChild(headerBtn);
        rootDiv.appendChild(contentDiv);
        document.body.appendChild(rootDiv);
    }

    function renderGroupedCageBadge(cageGroup, includeScannablePrefix = false) {
        return cageGroup.items.map(item => {
            const styles = getItemStyles(item.minutes);

            const fnskuFormatted = item.fnskuUrl
                ? `<a href="${item.fnskuUrl}" target="_blank" style="color: #0066c0; text-decoration: underline; font-weight: bold;">${item.fnsku}</a>`
                : `<strong>${item.fnsku}</strong>`;

            let scannablePrefix = '';
            if (includeScannablePrefix && item.scannableId) {
                const scannableFormatted = item.scannableUrl
                    ? `<a href="${item.scannableUrl}" target="_blank" style="color: #2b6cb0; text-decoration: underline; font-weight: bold;">${item.scannableId}</a>`
                    : `<strong>${item.scannableId}</strong>`;
                scannablePrefix = `📍 ${scannableFormatted} | `;
            }

            let spDisplay = '';
            if (item.spId) {
                const spFormatted = item.scannableUrl
                    ? `<a href="${item.scannableUrl}" target="_blank" style="color: #0066c0; text-decoration: underline; font-weight: bold;">${item.spId}</a>`
                    : `<strong>${item.spId}</strong>`;
                spDisplay = ` 📦 ${spFormatted}`;
            }

            const flexStyles = includeScannablePrefix
                ? 'flex: 0 0 auto; min-width: 210px; max-width: 280px; box-sizing: border-box;'
                : 'width: 100%; box-sizing: border-box;';

            return `
                <div style="background: ${styles.bg}; border: 1px solid ${styles.border}; border-radius: 4px; padding: 4px 6px; font-size: 10px; color: ${styles.textColor}; text-align: left; ${flexStyles}">
                    <!-- Line 1: [Scannable ID (optional)] FNSKU -->
                    <div style="font-size: 11px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${scannablePrefix}🏷️ ${fnskuFormatted}${spDisplay}
                    </div>
                    <!-- Line 2: Time and Condition -->
                    <div style="font-size: 9.5px; opacity: 0.9; white-space: nowrap; margin-top: 2px;">
                        ⏱️ <strong>${item.minutes.toFixed(0)}m</strong> | 📅 <strong>${item.esdShort}</strong> | ⚠️ <span>${item.condition}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    function groupItemsByCage(items) {
        const cageMap = new Map();
        items.forEach(item => {
            if (!cageMap.has(item.cageId)) {
                cageMap.set(item.cageId, { cageId: item.cageId, items: [] });
            }
            cageMap.get(item.cageId).items.push(item);
        });
        return Array.from(cageMap.values());
    }

    function renderFloorPlan() {
        highlightTableRows();
        injectDashboardUI();
        const contentDiv = document.getElementById('rodeo-floor-content');
        if (!contentDiv) return;

        const rawData = extractTableData();

        const currentDataString = JSON.stringify(rawData);
        if (currentDataString === lastDataString) return;
        lastDataString = currentDataString;

        const stationMap = new Map();
        const otherGroupMap = new Map();

        const validStationLookup = new Map();
        LAYOUT.forEach(row => {
            Object.values(row).forEach(st => {
                validStationLookup.set(normalizeStationName(st), st);
            });
        });

        rawData.forEach(item => {
            const normalizedTarget = normalizeStationName(item.stationTarget);

            if (validStationLookup.has(normalizedTarget)) {
                const canonicalKey = validStationLookup.get(normalizedTarget);
                const normalizedCanonical = normalizeStationName(canonicalKey);
                if (!stationMap.has(normalizedCanonical)) {
                    stationMap.set(normalizedCanonical, []);
                }
                stationMap.get(normalizedCanonical).push(item);
            } else {
                const prefixKey = extract5CharPrefixKey(item.scannableId || item.stationTarget || item.outerId);
                if (!otherGroupMap.has(prefixKey)) {
                    otherGroupMap.set(prefixKey, []);
                }
                otherGroupMap.get(prefixKey).push(item);
            }
        });

        let html = `
            <div style="display: grid; grid-template-columns: minmax(110px, 1fr) 16px minmax(110px, 1fr) 20px minmax(110px, 1fr) 16px minmax(110px, 1fr) 20px minmax(110px, 1fr) 16px minmax(110px, 1fr) 20px minmax(110px, 1fr) 16px minmax(110px, 1fr); gap: 4px; background: #cbd5e0; padding: 6px; border-radius: 6px; font-size: 11px;">
        `;

        LAYOUT.forEach(row => {
            const cols = [
                { key: row.hazmat, type: 'st' },
                { type: 'conveyor' },
                { key: row.nonsortA, type: 'st' },
                { type: 'road' },
                { key: row.nonsortB_L, type: 'st' },
                { type: 'conveyor' },
                { key: row.nonsortB_R, type: 'st' },
                { type: 'road' },
                { key: row.nonsortC_L, type: 'st' },
                { type: 'conveyor' },
                { key: row.nonsortC_R, type: 'st' },
                { type: 'road' },
                { key: row.nonsortD_L, type: 'st' },
                { type: 'conveyor' },
                { key: row.nonsortD_R, type: 'st' }
            ];

            cols.forEach(col => {
                if (col.type === 'conveyor') {
                    html += `<div style="background: #000000; border-radius: 2px;"></div>`;
                } else if (col.type === 'road') {
                    html += `<div style="background: #00a2ed; border-radius: 2px;"></div>`;
                } else {
                    const normKey = normalizeStationName(col.key);
                    const rawItemsAtStation = stationMap.get(normKey) || [];
                    const cageGroups = groupItemsByCage(rawItemsAtStation);

                    html += `
                        <div style="background: #ffffff; border: 1px solid #a0aec0; border-radius: 4px; padding: 3px; min-height: 32px; display: flex; flex-direction: column; gap: 3px;">
                            <div style="font-weight: bold; font-size: 10px; color: #2d3748; border-bottom: 1px solid #e2e8f0; text-align: center; padding-bottom: 1px;">
                                ${formatDisplayName(col.key)}
                            </div>
                            ${cageGroups.map(cg => renderGroupedCageBadge(cg, false)).join('')}
                        </div>
                    `;
                }
            });
        });

        html += `</div>`;

        const sortedPrefixKeys = Array.from(otherGroupMap.keys()).sort();

        if (sortedPrefixKeys.length > 0) {
            html += `
                <div style="margin-top: 8px; background: #ffffff; border: 1px dashed #4a5568; border-radius: 6px; padding: 6px;">
                    <div style="font-weight: bold; color: #2d3748; font-size: 11px; margin-bottom: 6px;">
                        📍 Other / Buffer Locations (Grouped by Prefix - First 5 Chars)
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 6px;">
            `;

            sortedPrefixKeys.forEach(prefixKey => {
                const itemsInGroup = otherGroupMap.get(prefixKey);
                const cageGroups = groupItemsByCage(itemsInGroup);

                html += `
                    <div style="background: #ffffff; border: 1px solid #cbd5e0; border-radius: 4px; padding: 6px;">
                        <div style="font-weight: bold; font-size: 10px; color: #2d3748; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; margin-bottom: 6px;">
                            🏷️ Prefix Group: <strong>${prefixKey}</strong> (${itemsInGroup.length} items)
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start;">
                            ${cageGroups.map(cg => renderGroupedCageBadge(cg, true)).join('')}
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        contentDiv.innerHTML = html;
    }

    setInterval(() => {
        refreshSecondsLeft -= 1;

        const headerBtn = document.getElementById('rodeo-header-toggle-btn');
        if (headerBtn) {
            updateHeaderLabel(headerBtn);
        }

        if (refreshSecondsLeft <= 0) {
            window.location.reload();
        }
    }, 1000);

    setInterval(renderFloorPlan, CONFIG.POLL_INTERVAL_MS);
})();
