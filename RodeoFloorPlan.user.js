// ==UserScript==
// @name         Rodeo Floor Plan Cage & FNSKU Visualizer
// @namespace    http://tampermonkey.net/
// @version      11.1
// @description  Visualizes Rodeo cages with dynamic dwell thresholds (Purple > 2h) and ESD highlights (Blue for future dates). Starts minimized.
// @author       RB
// @match        https://rodeo.eu.aftx.amazonoperations.app/*PickingPicked*
// @updateURL    https://github.com/RBCeva/TM/raw/refs/heads/main/SIOC.user.js
// @downloadURL  https://github.com/RBCeva/TM/raw/refs/heads/main/SIOC.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (!window.location.href.includes('PickingPicked')) {
        return;
    }

    const CONFIG = {
        WARN_THRESHOLD_MIN: 30,// Yellow
        CRIT_THRESHOLD_MIN: 60,// Red
        DWELL_PURPLE_THRESHOLD_MIN: 120, // Purple (> 2 hours)
        CONTAINER_ID: 'rodeo-floorplan-visualizer-root',
        POLL_INTERVAL_MS: 3000
    };

    let lastDataString = '';
    const expandedCages = new Set();

    const LAYOUT = [
        { hazmat: 'wsHAZMAT A19', nonsortA: 'wsNONSORT A20', nonsortB_L: 'wsNONSORT B19', nonsortB_R: 'wsNONSORT B20', nonsortC_L: 'wsNONSORT C19', nonsortC_R: 'wsNONSORT C20' },
        { hazmat: 'wsHAZMAT A17', nonsortA: 'wsNONSORT A18', nonsortB_L: 'wsNONSORT B17', nonsortB_R: 'wsNONSORT B18', nonsortC_L: 'wsNONSORT C17', nonsortC_R: 'wsNONSORT C18' },
        { hazmat: 'wsHAZMAT A15', nonsortA: 'wsNONSORT A16', nonsortB_L: 'wsNONSORT B15', nonsortB_R: 'wsNONSORT B16', nonsortC_L: 'wsNONSORT C15', nonsortC_R: 'wsNONSORT C16' },
        { hazmat: 'wsHAZMAT A13', nonsortA: 'wsNONSORT A14', nonsortB_L: 'wsNONSORT B13', nonsortB_R: 'wsNONSORT B14', nonsortC_L: 'wsNONSORT C13', nonsortC_R: 'wsNONSORT C14' },
        { hazmat: 'wsHAZMAT A11', nonsortA: 'wsNONSORT A12', nonsortB_L: 'wsNONSORT B11', nonsortB_R: 'wsNONSORT B12', nonsortC_L: 'wsNONSORT C11', nonsortC_R: 'wsNONSORT C12' },
        { hazmat: 'wsHAZMAT A09', nonsortA: 'wsNONSORT A10', nonsortB_L: 'wsNONSORT B09', nonsortB_R: 'wsNONSORT B10', nonsortC_L: 'wsNONSORT C09', nonsortC_R: 'wsNONSORT C10' },
        { hazmat: 'wsHAZMAT A07', nonsortA: 'wsNONSORT A08', nonsortB_L: 'wsNONSORT B07', nonsortB_R: 'wsNONSORT B08', nonsortC_L: 'wsNONSORT C07', nonsortC_R: 'wsNONSORT C08' },
        { hazmat: 'wsHAZMAT A05', nonsortA: 'wsNONSORT A06', nonsortB_L: 'wsNONSORT B05', nonsortB_R: 'wsNONSORT B06', nonsortC_L: 'wsNONSORT C05', nonsortC_R: 'wsNONSORT C06' },
        { hazmat: 'wsHAZMAT A03', nonsortA: 'wsNONSORT A04', nonsortB_L: 'wsNONSORT B03', nonsortB_R: 'wsNONSORT B04', nonsortC_L: 'wsNONSORT C03', nonsortC_R: 'wsNONSORT C04' },
        { hazmat: 'wsHAZMAT A01', nonsortA: 'wsNONSORT A02', nonsortB_L: 'wsNONSORT B01', nonsortB_R: 'wsNONSORT B02', nonsortC_L: 'wsNONSORT C01', nonsortC_R: 'wsNONSORT C02' }
    ];

    function normalizeStationName(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .replace(/^ws/, '')
            .replace(/[^a-z0-9]/gi, '')
            .replace(/([a-z])0+(\d+)/i, '$1$2');
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

    function isFutureDate(esdString) {
        if (!esdString || esdString === 'N/A') return false;
        const parsedDate = new Date(esdString);
        if (isNaN(parsedDate.getTime())) return false;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const target = new Date(parsedDate);
        target.setHours(0, 0, 0, 0);

        return target > today;
    }

    function extractReadyToPackZone(text) {
        if (!text) return null;
        const match = text.match(/([a-z0-9_-]*readytopack[a-z0-9_-]*)/i);
        return match ? match[1] : null;
    }

    function extractTableData() {
        const table = document.querySelector('table');
        if (!table) return [];

        const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(th => th.innerText.trim());

        const outerColIdx = headers.findIndex(h => /outer scannable/i.test(h));
        const cageColIdx = headers.findIndex(h => /(^container|^scannable id|^cage)/i.test(h));
        const fnskuColIdx = headers.findIndex(h => /fnsku|asin|sku|item/i.test(h));
        const dwellColIdx = headers.findIndex(h => /dwell|age|elapsed|time/i.test(h));
        const statusColIdx = headers.findIndex(h => /status|state|pool|zone/i.test(h));
        const esdColIdx = headers.findIndex(h => /esd|ship date|expected ship/i.test(h));

        const finalOuterIdx = outerColIdx !== -1 ? outerColIdx : 0;
        const finalCageIdx = cageColIdx !== -1 ? cageColIdx : finalOuterIdx;

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const items = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (!cells.length) return;

            const outerId = cells[finalOuterIdx] ? cells[finalOuterIdx].innerText.trim() : '';
            const cageId = cells[finalCageIdx] ? cells[finalCageIdx].innerText.trim() : outerId;
            const fnsku = fnskuColIdx !== -1 && cells[fnskuColIdx] ? cells[fnskuColIdx].innerText.trim() : 'N/A';
            const dwellRaw = dwellColIdx !== -1 && cells[dwellColIdx] ? cells[dwellColIdx].innerText.trim() : '0';
            const statusRaw = statusColIdx !== -1 && cells[statusColIdx] ? cells[statusColIdx].innerText.trim() : '';
            const esd = esdColIdx !== -1 && cells[esdColIdx] ? cells[esdColIdx].innerText.trim() : 'N/A';

            const detectedZone = extractReadyToPackZone(outerId) || extractReadyToPackZone(statusRaw);

            if (outerId) {
                items.push({
                    outerId,
                    cageId,
                    fnsku,
                    esd,
                    minutes: parseDwellTimeMinutes(dwellRaw),
                    isReadyToPack: !!detectedZone,
                    readyToPackZone: detectedZone
                });
            }
        });

        return items;
    }

    function injectDashboardUI() {
        if (document.getElementById(CONFIG.CONTAINER_ID)) return;

        const rootDiv = document.createElement('div');
        rootDiv.id = CONFIG.CONTAINER_ID;
        rootDiv.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            z-index: 99999;
            background: #ffffff;
            border: 2px solid #232f3e;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            font-family: Arial, sans-serif;
            width: 95vw;
            max-width: 1800px;
            max-height: 95vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        `;

        const headerBtn = document.createElement('button');
        headerBtn.style.cssText = `
            background: #232f3e;
            color: #ffffff;
            padding: 8px 14px;
            border: none;
            font-weight: bold;
            font-size: 13px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        headerBtn.innerHTML = `<span>🏭 Rodeo Floor Layout Map (PickingPicked)</span> <span id="tm-toggle-icon">▼</span>`;

        const contentDiv = document.createElement('div');
        contentDiv.id = 'rodeo-floor-content';
        contentDiv.style.cssText = `
            padding: 10px;
            overflow-y: auto;
            overflow-x: auto;
            background: #e2e8f0;
            display: none;
        `;

        headerBtn.addEventListener('click', () => {
            const isHidden = contentDiv.style.display === 'none';
            contentDiv.style.display = isHidden ? 'block' : 'none';
            document.getElementById('tm-toggle-icon').innerText = isHidden ? '▲' : '▼';
        });

        rootDiv.appendChild(headerBtn);
        rootDiv.appendChild(contentDiv);
        document.body.appendChild(rootDiv);

        contentDiv.addEventListener('click', (e) => {
            const target = e.target.closest('.cage-toggle-badge');
            if (!target) return;

            const cageUid = target.getAttribute('data-cage-uid');
            const detailsElement = document.getElementById(`details-${cageUid}`);

            if (expandedCages.has(cageUid)) {
                expandedCages.delete(cageUid);
                if (detailsElement) detailsElement.style.display = 'none';
            } else {
                expandedCages.add(cageUid);
                if (detailsElement) detailsElement.style.display = 'block';
            }
        });
    }

    function renderGroupedCageBadge(cageGroup, parentUid) {
        const cageUid = `${parentUid}_${cageGroup.cageId}`.replace(/[^a-z0-9_-]/gi, '');
        const maxMinutes = Math.max(...cageGroup.items.map(i => i.minutes));
        const itemCount = cageGroup.items.length;
        const isExpanded = expandedCages.has(cageUid);

        // Find earliest ESD for summary badge
        const uniqueEsds = Array.from(new Set(cageGroup.items.map(i => i.esd).filter(e => e && e !== 'N/A'))).sort();
        const displayEsd = uniqueEsds.length > 0 ? uniqueEsds[0] : 'N/A';
        const hasFutureEsd = cageGroup.items.some(i => isFutureDate(i.esd));

        let bg = '#ffffff';
        let border = '#cbd5e0';
        let color = '#2d3748';

        // High priority threshold logic
        if (maxMinutes >= CONFIG.DWELL_PURPLE_THRESHOLD_MIN) {
            bg = '#805ad5';   // Purple
            border = '#553c9a';
            color = '#ffffff'; // White text for contrast
        } else if (maxMinutes >= CONFIG.CRIT_THRESHOLD_MIN) {
            bg = '#feb2b2';   // Red
            border = '#e53e3e';
            color = '#9b2c2c';
        } else if (maxMinutes >= CONFIG.WARN_THRESHOLD_MIN) {
            bg = '#fefcbf';   // Yellow
            border = '#d69e2e';
            color = '#744210';
        }

        // ESD styling (Blue if in the future)
        const summaryEsdStyle = hasFutureEsd
            ? 'background: #ebf8ff; color: #2b6cb0; border: 1px solid #3182ce; padding: 1px 3px; border-radius: 3px; font-weight: bold;'
            : '';

        let fnskuHtml = cageGroup.items.map(item => {
            const itemFutureEsd = isFutureDate(item.esd);
            const esdStyle = itemFutureEsd
                ? 'color: #2b6cb0; font-weight: bold; background: #ebf8ff; padding: 0 2px; border-radius: 2px;'
                : 'color: #c53030; font-weight: bold;';

            return `
                <div style="font-size: 9px; border-bottom: 1px dashed ${border}; padding: 2px 0; text-align: left; color: #2d3748;">
                    🏷️ <strong>${item.fnsku}</strong> (${item.minutes.toFixed(0)}m) <br/>
                    📅 ESD: <span style="${esdStyle}">${item.esd}</span>
                </div>
            `;
        }).join('');

        return `
            <div style="margin-top: 3px;">
                <div class="cage-toggle-badge" data-cage-uid="${cageUid}" style="
                    background: ${bg};
                    color: ${color};
                    border: 1px solid ${border};
                    padding: 3px 5px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: bold;
                    text-align: center;
                    cursor: pointer;
                    user-select: none;
                ">
                    📦 ${cageGroup.cageId} ${itemCount > 1 ? `(${itemCount})` : ''} ⏱️ ${maxMinutes.toFixed(0)}m <br/>
                    📅 <span style="${summaryEsdStyle}">${displayEsd}</span>
                </div>
                <div id="details-${cageUid}" style="display: ${isExpanded ? 'block' : 'none'}; background: #fff; border: 1px solid ${border}; border-top: none; padding: 4px; border-radius: 0 0 4px 4px;">
                    ${fnskuHtml}
                </div>
            </div>
        `;
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

    function groupItemsByOuterScannable(items) {
        const outerMap = new Map();
        items.forEach(item => {
            const key = item.outerId || 'Unknown Location';
            if (!outerMap.has(key)) {
                outerMap.set(key, []);
            }
            outerMap.get(key).push(item);
        });
        return outerMap;
    }

    function renderFloorPlan() {
        injectDashboardUI();
        const contentDiv = document.getElementById('rodeo-floor-content');
        if (!contentDiv) return;

        const rawData = extractTableData();

        const currentDataString = JSON.stringify(rawData);
        if (currentDataString === lastDataString) return;
        lastDataString = currentDataString;

        const stationMap = new Map();
        const readyToPackZoneMap = new Map();
        const unmatchedList = [];

        const validStationLookup = new Map();
        LAYOUT.forEach(row => {
            Object.values(row).forEach(st => {
                validStationLookup.set(normalizeStationName(st), st);
            });
        });

        rawData.forEach(item => {
            if (item.isReadyToPack) {
                const zoneKey = item.readyToPackZone || 'ReadyToPack-General';
                if (!readyToPackZoneMap.has(zoneKey)) {
                    readyToPackZoneMap.set(zoneKey, []);
                }
                readyToPackZoneMap.get(zoneKey).push(item);
                return;
            }

            const normalizedOuter = normalizeStationName(item.outerId);

            if (validStationLookup.has(normalizedOuter)) {
                if (!stationMap.has(normalizedOuter)) {
                    stationMap.set(normalizedOuter, []);
                }
                stationMap.get(normalizedOuter).push(item);
            } else {
                unmatchedList.push(item);
            }
        });

        let html = `
            <div style="display: grid; grid-template-columns: minmax(110px, 1fr) 24px minmax(110px, 1fr) 36px minmax(110px, 1fr) 24px minmax(110px, 1fr) 36px minmax(110px, 1fr) 24px minmax(110px, 1fr); gap: 4px; background: #cbd5e0; padding: 6px; border-radius: 6px; font-size: 11px;">
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
                { key: row.nonsortC_R, type: 'st' }
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
                    const hasCages = cageGroups.length > 0;

                    html += `
                        <div style="background: ${hasCages ? '#ffffff' : '#f7fafc'}; border: 1px solid ${hasCages ? '#3182ce' : '#a0aec0'}; border-radius: 4px; padding: 4px; min-height: 48px;">
                            <div style="font-weight: bold; font-size: 10px; color: ${hasCages ? '#2b6cb0' : '#4a5568'}; border-bottom: 1px solid #edf2f7; text-align: center;">
                                ${col.key.replace('ws', '').trim()}
                            </div>
                            ${cageGroups.map(cg => renderGroupedCageBadge(cg, normKey)).join('')}
                        </div>
                    `;
                }
            });
        });

        html += `</div>`;

        html += `
            <div style="margin-top: 10px; background: #fffde7; border: 2px solid #f57f17; border-radius: 6px; padding: 8px;">
                <div style="font-weight: bold; color: #f57f17; font-size: 12px; margin-bottom: 6px;">
                    🟡 Ready To Pack Zones (${readyToPackZoneMap.size} Detected)
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
        `;

        if (readyToPackZoneMap.size === 0) {
            html += `<span style="font-size:11px; color:#795548;">No cages ready to pack</span>`;
        } else {
            const sortedZones = Array.from(readyToPackZoneMap.keys()).sort();

            sortedZones.forEach(zoneName => {
                const zoneItems = readyToPackZoneMap.get(zoneName);
                const groupedZoneCages = groupItemsByCage(zoneItems);
                const safeZoneKey = zoneName.replace(/[^a-z0-9_-]/gi, '_');

                html += `
                    <div style="background: #ffffff; border: 1px solid #ffe082; border-radius: 4px; padding: 6px;">
                        <div style="font-weight: bold; font-size: 10px; color: #e65100; margin-bottom: 4px; border-bottom: 1px solid #fff8e1;">
                            📍 Zone: <strong>${zoneName}</strong> (${groupedZoneCages.length} Cages, ${zoneItems.length} FNSKUs)
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                            ${groupedZoneCages.map(cg => renderGroupedCageBadge(cg, `rtp_${safeZoneKey}`)).join('')}
                        </div>
                    </div>
                `;
            });
        }

        html += `
                </div>
            </div>
        `;

        const outerScannableGroups = groupItemsByOuterScannable(unmatchedList);

        html += `
            <div style="margin-top: 8px; background: #ffffff; border: 1px dashed #718096; border-radius: 6px; padding: 8px;">
                <div style="font-weight: bold; color: #4a5568; font-size: 11px; margin-bottom: 6px;">
                    📍 Unassigned / Other Locations (${outerScannableGroups.size} Outer Scannable Locations)
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
        `;

        if (outerScannableGroups.size === 0) {
            html += `<span style="font-size:11px; color:#a0aec0;">None</span>`;
        } else {
            const sortedOuterIds = Array.from(outerScannableGroups.keys()).sort();

            sortedOuterIds.forEach(outerId => {
                const itemsAtOuter = outerScannableGroups.get(outerId);
                const cageGroups = groupItemsByCage(itemsAtOuter);
                const safeOuterKey = outerId.replace(/[^a-z0-9_-]/gi, '_');

                html += `
                    <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px;">
                        <div style="font-weight: bold; font-size: 10px; color: #2d3748; margin-bottom: 4px;">
                            📌 Outer Scannable: <strong>${outerId}</strong> (${cageGroups.length} Cages)
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                            ${cageGroups.map(cg => renderGroupedCageBadge(cg, `unassigned_${safeOuterKey}`)).join('')}
                        </div>
                    </div>
                `;
            });
        }

        html += `
                </div>
            </div>
        `;

        contentDiv.innerHTML = html;
    }

    setInterval(renderFloorPlan, CONFIG.POLL_INTERVAL_MS);
})();
