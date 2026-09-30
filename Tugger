// ==UserScript==
// @name         Rodeo Tugger Pro (V25 - Smart Routing & Tile UI)
// @namespace    http://tampermonkey.net/
// @version      25.0
// @description  Tablet fullscreen UI. Physical path routing (G1->B1). Tap-to-toggle Zone Settings.
// @author       AI Assistant
// @match        https://rodeo.eu.aftx.amazonoperations.app/*
// @grant        GM_xmlhttpRequest
// @connect      rodeo.eu.aftx.amazonoperations.app
// ==/UserScript==

(function() {
    'use strict';

    const TARGET_POOLS = ['pickingpickedinprogress', 'pickingpickedatdestination'];
    const MAX_CONCURRENT_FETCHES = 3;

    // V25: Fizyczna trasa przejazdu Tuggera (zamiast alfabetycznej)
    const ROUTE_ORDER = ['G1', 'G2', 'H1', 'H2', 'D2', 'D1', 'C2', 'C1', 'B2', 'B1'];

    let fetchQueue = [];
    let isFetching = false;
    let completedFetches = 0;
    let totalFetches = 0;
    let activeFetches = 0;
    let globalCages = {};
    let dataCheckInterval = null;

    let tuggerCapacity = parseInt(localStorage.getItem('tugger_capacity')) || 4;
    let tuggerZonesRaw = localStorage.getItem('tugger_zones') || '';
    let tuggerZones = tuggerZonesRaw.toUpperCase().split(',').map(s => s.trim()).filter(Boolean);

    const getText = (el) => { return el ? (typeof el === 'string' ? el : (el.textContent || el.innerText || '')).trim() : ''; };
    const cleanText = (el) => getText(el).toLowerCase().replace(/[\s\-_]/g, '');

    function parseDwellMins(text) {
        if(!text || text === '-') return 0;
        let mins = 0;
        const dMatch = text.match(/(\d+)\s*d/i);
        const hMatch = text.match(/(\d+)\s*h/i);
        const mMatch = text.match(/(\d+)\s*m/i);
        if (dMatch) mins += parseInt(dMatch[1], 10) * 1440;
        if (hMatch) mins += parseInt(hMatch[1], 10) * 60;
        if (mMatch) mins += parseInt(mMatch[1], 10);
        return mins;
    }

    function getUrgencyStatus(cptDate) {
        if (isNaN(cptDate.getTime())) return 'tug-normal';
        let now = new Date();
        let diffMins = (cptDate - now) / 60000;

        if (diffMins <= 45) return 'tug-critical';
        if (diffMins <= 90) return 'tug-warning';
        return 'tug-normal';
    }

    function getTuggerFetchUrl(origUrl) {
        try {
            let u = new URL(origUrl, window.location.origin);
            let p = u.searchParams;
            if (!p.has('_enabledColumns')) p.set('_enabledColumns', 'on');
            let curCols = p.getAll('enabledColumns');

            if (!curCols.includes('OUTER_SCANNABLE_ID')) p.append('enabledColumns', 'OUTER_SCANNABLE_ID');
            if (!curCols.includes('DEMAND_ID')) p.append('enabledColumns', 'DEMAND_ID');

            u.search = p.toString();
            return u.toString();
        } catch(e) { return origUrl; }
    }

    function initUI() {
        if (document.getElementById('tugger-app')) return;

        const style = document.createElement('style');
        style.innerHTML = `
            #tugger-app * { box-sizing: border-box; }

            #tugger-launch-btn {
                position: fixed; bottom: 40px; right: 40px;
                background: #f0c14b; color: #111; border: 3px solid #a88734;
                padding: 20px 30px; border-radius: 50px; cursor: pointer;
                font-weight: 900; font-size: 18px; z-index: 9998;
                box-shadow: 0 8px 20px rgba(0,0,0,0.3); text-transform: uppercase;
                transition: transform 0.2s;
            }
            #tugger-launch-btn:hover { background: #e3b131; transform: scale(1.05); }

            #tugger-app {
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: #f2f4f8; z-index: 999999;
                display: none; flex-direction: column; font-family: 'Segoe UI', Arial, sans-serif;
            }
            #tugger-app.tug-open { display: flex; }

            #tugger-content-area::-webkit-scrollbar { width: 12px; }
            #tugger-content-area::-webkit-scrollbar-thumb { background: #bbb; border-radius: 6px; }

            .tug-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(450px, 1fr)); gap: 20px; width: 100%; }

            .tug-trip-card {
                background: #fff; border-radius: 12px; padding: 20px;
                box-shadow: 0 4px 10px rgba(0,0,0,0.08); position: relative; border-left: 10px solid #ccc;
                display: flex; flex-direction: column; width: 100%;
            }
            .tug-trip-card.tug-critical { border-left-color: #d9534f; background: #fff5f5; }
            .tug-trip-card.tug-warning { border-left-color: #f0ad4e; background: #fffaf0; }
            .tug-trip-card.tug-normal { border-left-color: #5cb85c; }

            .tug-trip-card.tug-top-priority {
                border: 4px solid #232f3e; border-left: 16px solid #232f3e;
                background: #fff; box-shadow: 0 10px 25px rgba(0,0,0,0.15);
                margin-bottom: 30px; display: flex; flex-direction: column;
            }

            .tug-top-badge {
                background: #f0c14b; color: #111; font-weight: 900; font-size: 18px;
                padding: 8px 20px; border-radius: 0 0 12px 12px; position: absolute;
                top: 0; left: 50%; transform: translateX(-50%); text-transform: uppercase;
                letter-spacing: 2px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); white-space: nowrap;
            }

            .tug-trip-rank {
                position: absolute; top: 15px; right: 15px; background: #232f3e; color: #fff;
                padding: 5px 15px; border-radius: 20px; font-weight: 900; font-size: 16px; letter-spacing: 1px; white-space: nowrap;
            }

            .tug-trip-cages { display: flex; flex-direction: column; gap: 0; }
            .tug-trip-row { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #ccc; padding: 12px 0; width: 100%; }
            .tug-trip-row:last-child { border-bottom: none; padding-bottom: 0; }

            .tug-step-circle { background: #232f3e; color: #fff; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-weight: bold; font-size: 14px; flex-shrink:0; }
            .tug-zone-text { font-size: 24px; font-weight: 900; color: #111; min-width: 50px; }
            .tug-cage-badge { font-size: 18px; font-family: monospace; color: #007185; font-weight: bold; background: #eaeded; padding: 4px 8px; border-radius: 6px; letter-spacing: 1px; }
            .tug-meta-box { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
            .tug-cpt-val { font-size: 16px; font-weight: bold; color: #111; }
            .tug-dwell-val { font-size: 13px; font-weight: bold; padding: 2px 6px; border-radius: 4px; background: #eaeded; color: #555; white-space: nowrap;}
            .tug-dwell-val.tug-dwell-high { background: #fce8e6; color: #c5221f; }

            .tug-first-trip-row { padding: 18px 0; border-bottom: 2px dashed #eee; }
            .tug-first-trip-row:last-child { border-bottom: none; }
            .tug-first-trip-row .tug-step-circle { width: 36px; height: 36px; font-size: 18px; }
            .tug-first-trip-row .tug-zone-text { font-size: 36px; color: #232f3e; }
            .tug-first-trip-row .tug-cage-badge { font-size: 24px; padding: 6px 12px; }
            .tug-first-trip-row .tug-cpt-val { font-size: 20px; }
            .tug-first-trip-row .tug-dwell-val { font-size: 15px; }

            .tug-btn-action {
                background: #f0c14b; border: 2px solid #a88734; padding: 12px 25px;
                border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 900;
                color: #111; text-transform: uppercase; transition: all 0.2s; box-shadow: 0 4px 8px rgba(0,0,0,0.2); white-space: nowrap;
            }
            .tug-btn-action:active { transform: scale(0.95); }
            .tug-btn-close { background: #fff; border-color: #ccc; }
            .tug-btn-close:hover { background: #ffebeb; border-color: #d9534f; color: #d9534f; }
            .tug-btn-settings { background: #eaeded; border-color: #d5dbdb; }
            .tug-btn-settings:hover { background: #d5dbdb; }

            .tug-zone-badge { background: #232f3e; color: #fff; padding: 10px 20px; border-radius: 10px; display: flex; align-items: center; gap: 12px; font-weight: 900; box-shadow: 0 4px 8px rgba(0,0,0,0.2); font-size: 20px; }
            .tug-zone-badge span:first-child { color: #f0c14b; font-size: 24px; }
            .tug-zone-badge span:last-child { background: #fff; color: #111; padding: 4px 12px; border-radius: 15px; font-size: 20px; }

            /* Settings Modal & Toggles */
            #tugger-settings-modal {
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7);
                display: none; justify-content: center; align-items: center; z-index: 9999999;
            }
            #tugger-settings-modal.tug-open { display: flex; }
            .tug-settings-box { background: #fff; padding: 30px; border-radius: 12px; width: 550px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            .tug-settings-box h2 { margin-top: 0; color: #232f3e; font-weight: 900; }
            .tug-settings-group { margin-bottom: 25px; }
            .tug-settings-group label { display: block; font-weight: bold; margin-bottom: 12px; color: #555; font-size:16px; }
            .tug-settings-group input { width: 100%; padding: 12px; border: 2px solid #ccc; border-radius: 6px; font-size: 18px; box-sizing: border-box; }

            /* V25 Toggles */
            .tug-toggles-container { display: flex; flex-wrap: wrap; gap: 10px; }
            .tug-zone-toggle {
                background: #eaeded; color: #555; border: 2px solid #ccc;
                padding: 12px 20px; border-radius: 8px; font-weight: 900; font-size: 20px;
                cursor: pointer; transition: all 0.2s; user-select: none; flex: 1 1 calc(20% - 10px);
                text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            }
            .tug-zone-toggle.tug-active {
                background: #232f3e; color: #f0c14b; border-color: #232f3e; box-shadow: 0 4px 8px rgba(0,0,0,0.2); transform: scale(1.05);
            }
            .tug-settings-hint { font-size: 13px; color: #888; margin-top: 6px; line-height: 1.4; }
            .tug-settings-actions { display: flex; justify-content: flex-end; gap: 15px; margin-top: 30px; }
        `;
        document.head.appendChild(style);

        let launchBtn = document.createElement('button');
        launchBtn.id = 'tugger-launch-btn';
        launchBtn.innerHTML = '🚜 LAUNCH TUGGER';
        document.body.appendChild(launchBtn);

        let app = document.createElement('div');
        app.id = 'tugger-app';
        app.innerHTML = `
            <div style="background: #232f3e; color: #fff; padding: 20px 30px; font-weight: 900; font-size: 26px; border-bottom:5px solid #f0c14b; display: flex; justify-content: space-between; align-items:center; flex-shrink: 0;">
                <span style="letter-spacing:2px;">🚜 TABLET TUGGER PLAN</span>
                <div style="display:flex; gap:15px;">
                    <button id="tugger-settings-btn" class="tug-btn-action tug-btn-settings">⚙️ SETTINGS</button>
                    <button id="tugger-refresh-btn" class="tug-btn-action">🔄 REFRESH</button>
                    <button id="tugger-close-btn" class="tug-btn-action tug-btn-close">❌ CLOSE</button>
                </div>
            </div>
            <div id="tugger-status-bar" style="background: #e8f3fd; color: #007185; padding: 15px; font-size: 16px; text-align: center; font-weight: bold; border-bottom: 2px solid #d5dbdb; flex-shrink: 0;">
                Awaiting System Data...
            </div>
            <div id="tugger-content-area" style="padding: 30px; overflow-y:auto; flex-grow:1; box-sizing: border-box;">
            </div>
        `;
        document.body.appendChild(app);

        // Generowanie kafelków w ustawieniach
        let zoneTogglesHtml = ROUTE_ORDER.map(z => `<div class="tug-zone-toggle" data-zone="${z}">${z}</div>`).join('');

        let settingsModal = document.createElement('div');
        settingsModal.id = 'tugger-settings-modal';
        settingsModal.innerHTML = `
            <div class="tug-settings-box">
                <h2>⚙️ Tugger Configuration</h2>
                <div class="tug-settings-group">
                    <label>Tugger Capacity (Cages per trip):</label>
                    <input type="number" id="inp-tug-cap" min="1" max="10" value="${tuggerCapacity}">
                </div>
                <div class="tug-settings-group">
                    <label>Assigned Zones (Tap to select):</label>
                    <div class="tug-toggles-container" id="tug-toggles-wrap">
                        ${zoneTogglesHtml}
                    </div>
                    <div class="tug-settings-hint">Select the zones you are responsible for. Unselected = Hidden. Leave ALL unselected to show the entire FC.</div>
                </div>
                <div class="tug-settings-actions">
                    <button id="btn-set-cancel" class="tug-btn-action tug-btn-close">Cancel</button>
                    <button id="btn-set-save" class="tug-btn-action">Save & Reload</button>
                </div>
            </div>
        `;
        document.body.appendChild(settingsModal);

        // Obsługa kliknięć kafelków
        document.querySelectorAll('.tug-zone-toggle').forEach(btn => {
            btn.addEventListener('click', function() {
                this.classList.toggle('tug-active');
            });
        });

        launchBtn.addEventListener('click', () => {
            app.classList.add('tug-open');
            launchBtn.style.display = 'none';
            if (Object.keys(globalCages).length === 0 && !isFetching) {
                startExtraction();
            } else {
                renderCages();
            }
        });

        document.getElementById('tugger-close-btn').addEventListener('click', () => {
            app.classList.remove('tug-open');
            launchBtn.style.display = 'block';
        });

        document.getElementById('tugger-refresh-btn').addEventListener('click', () => {
            if (!isFetching) startExtraction();
        });

        document.getElementById('tugger-settings-btn').addEventListener('click', () => {
            // Aktualizacja kafelków przy otwieraniu (na wypadek zamknięcia bez zapisu)
            document.querySelectorAll('.tug-zone-toggle').forEach(el => {
                if (tuggerZones.includes(el.getAttribute('data-zone'))) {
                    el.classList.add('tug-active');
                } else {
                    el.classList.remove('tug-active');
                }
            });
            document.getElementById('inp-tug-cap').value = tuggerCapacity;
            settingsModal.classList.add('tug-open');
        });

        document.getElementById('btn-set-cancel').addEventListener('click', () => {
            settingsModal.classList.remove('tug-open');
        });

        document.getElementById('btn-set-save').addEventListener('click', () => {
            let cap = parseInt(document.getElementById('inp-tug-cap').value);
            if(cap > 0) {
                tuggerCapacity = cap;
                localStorage.setItem('tugger_capacity', tuggerCapacity);
            }

            // Pobieranie zaznaczonych kafelków
            let selectedZones = [];
            document.querySelectorAll('.tug-zone-toggle.tug-active').forEach(el => {
                selectedZones.push(el.getAttribute('data-zone'));
            });

            tuggerZonesRaw = selectedZones.join(',');
            localStorage.setItem('tugger_zones', tuggerZonesRaw);
            tuggerZones = selectedZones;

            settingsModal.classList.remove('tug-open');
            renderCages();
        });
    }

    function renderCages() {
        let contentArea = document.getElementById('tugger-content-area');
        if(!contentArea) return;

        let filteredCages = Object.values(globalCages);
        if (tuggerZones.length > 0) {
            filteredCages = filteredCages.filter(cage => {
                return tuggerZones.some(assignedZone => cage.hall.startsWith(assignedZone));
            });
        }

        let sortedCages = filteredCages.sort((a, b) => {
            let timeA = isNaN(a.cpt.getTime()) ? Infinity : a.cpt.getTime();
            let timeB = isNaN(b.cpt.getTime()) ? Infinity : b.cpt.getTime();
            if (timeA !== timeB) return timeA - timeB;
            return b.maxDwell - a.maxDwell;
        });

        if(sortedCages.length === 0) {
            let zoneMsg = tuggerZones.length > 0 ? `in zones: <b>${tuggerZones.join(', ')}</b>` : `overall`;
            contentArea.innerHTML = `
                <div style="padding:80px 20px; text-align:center; display:flex; flex-direction:column; justify-content:center; height:100%;">
                    <div style="font-size: 80px; margin-bottom: 20px;">✅</div>
                    <div style="color:#137333; font-weight:900; font-size:40px;">ALL CLEAR</div>
                    <div style="font-size:24px; color:#555; margin-top:15px;">No valid hall-bound cages to pick right now ${zoneMsg}.</div>
                </div>
            `;
            return;
        }

        let zoneCounts = {};
        sortedCages.forEach(c => {
            zoneCounts[c.hall] = (zoneCounts[c.hall] || 0) + 1;
        });

        let html = `
            <div style="margin-bottom: 30px; border-bottom: 3px solid #ccc; padding-bottom: 20px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                    <div>
                        <div style="font-size: 18px; color: #777; font-weight: 900; text-transform: uppercase; margin-bottom: 15px; letter-spacing:1px;">Pending Cages By Zone</div>
                        <div style="display: flex; gap: 15px; flex-wrap: wrap;">
        `;

        // V25: Układanie podsumowania wg fizycznej trasy
        Object.keys(zoneCounts).sort((a, b) => {
            let rankA = ROUTE_ORDER.indexOf(a);
            let rankB = ROUTE_ORDER.indexOf(b);
            if(rankA === -1) rankA = 999;
            if(rankB === -1) rankB = 999;
            if(rankA !== rankB) return rankA - rankB;
            return a.localeCompare(b);
        }).forEach(z => {
            html += `<div class="tug-zone-badge"><span>${z}</span><span>${zoneCounts[z]}</span></div>`;
        });

        html += `
                        </div>
                    </div>
                    ${tuggerZones.length > 0 ? `<div style="font-size:14px; font-weight:bold; color:#007185; background:#e8f3fd; padding:8px 15px; border-radius:8px;">Filtered to: ${tuggerZones.join(', ')}</div>` : ''}
                </div>
            </div>
        `;

        let trips = [];
        for (let i = 0; i < sortedCages.length; i += tuggerCapacity) {
            trips.push(sortedCages.slice(i, i + tuggerCapacity));
        }

        trips.forEach((tripCages, tripIdx) => {
            let isTopPriority = tripIdx === 0;
            let tripUrgencyClass = getUrgencyStatus(tripCages[0].cpt);
            let cardClasses = `tug-trip-card ${tripUrgencyClass} ${isTopPriority ? 'tug-top-priority' : ''}`;

            // V25: Sortowanie klatek wg fizycznej trasy (G1 -> B1)
            let routeSortedCages = [...tripCages].sort((a, b) => {
                let rankA = ROUTE_ORDER.indexOf(a.hall);
                let rankB = ROUTE_ORDER.indexOf(b.hall);
                if (rankA === -1) rankA = 999;
                if (rankB === -1) rankB = 999;
                if (rankA !== rankB) return rankA - rankB;
                return a.hall.localeCompare(b.hall); // Fallback jeśli nie zdefiniowano
            });

            let topBadge = isTopPriority ? `<div class="tug-top-badge">🚀 NEXT TRIP (${tripCages.length} CAGES)</div>` : '';
            let rankBadge = !isTopPriority ? `<div class="tug-trip-rank">TRIP #${tripIdx + 1}</div>` : '';

            html += `
            <div class="${cardClasses}">
                ${topBadge}
                ${rankBadge}
                <div style="${isTopPriority ? 'padding-top: 30px;' : 'padding-top: 15px;'}">
                    <div style="font-size:14px; color:#777; font-weight:900; text-transform:uppercase; margin-bottom:10px; border-bottom: 2px solid #eee; padding-bottom:5px;">
                        ${isTopPriority ? 'Drive to these zones:' : 'Trip Route:'}
                    </div>
                    <div class="tug-trip-cages">
            `;

            routeSortedCages.forEach((cage, index) => {
                let timeDisplay = cage.cptRaw;
                if(!isNaN(cage.cpt.getTime())) timeDisplay = cage.cpt.toLocaleTimeString('en-GB', {hour: '2-digit', minute:'2-digit'});

                let dwellClass = cage.maxDwell >= 60 ? 'tug-dwell-high' : '';
                let fireIcon = cage.maxDwell >= 60 ? '🔥' : '';

                html += `
                    <div class="tug-trip-row ${isTopPriority ? 'tug-first-trip-row' : ''}">
                        <div style="display:flex; align-items:center; gap: 15px;">
                            <div class="tug-step-circle">${index + 1}</div>
                            <div>
                                <div class="tug-zone-text">${cage.hall}</div>
                            </div>
                        </div>
                        <div>
                            <div class="tug-cage-badge">${cage.id}</div>
                        </div>
                        <div class="tug-meta-box">
                            <span class="tug-cpt-val">${timeDisplay}</span>
                            <span class="tug-dwell-val ${dwellClass}">${fireIcon} Dwell: ${cage.maxDwell}m</span>
                        </div>
                    </div>
                `;
            });

            html += `</div></div></div>`;

            if (isTopPriority && trips.length > 1) {
                html += `<div style="font-size: 18px; color: #777; font-weight: 900; text-transform: uppercase; margin-bottom: 15px; letter-spacing:1px; margin-top:20px;">Upcoming Trips</div>`;
                html += `<div class="tug-grid">`;
            }
        });

        if (trips.length > 1) {
            html += `</div>`;
        }

        contentArea.innerHTML = html;
    }

    function startExtraction() {
        if (isFetching) return;

        let targetTable = null;
        document.querySelectorAll('table').forEach(t => {
            if (t.querySelector('.partition-name') || t.querySelector('.row-label')) {
                if(!targetTable) targetTable = t;
            }
        });

        let statusEl = document.getElementById('tugger-status-bar');

        if (!targetTable) {
            if(statusEl) statusEl.innerHTML = `⚠️ Main task table is missing on this screen.`;
            return;
        }

        fetchQueue = [];
        globalCages = {};

        targetTable.querySelectorAll('tbody tr, tr').forEach(row => {
            let th = row.querySelector('th');
            if(!th) return;
            let rowName = cleanText(th);

            if (TARGET_POOLS.includes(rowName)) {
                row.querySelectorAll('td a').forEach(link => {
                    let val = parseInt(getText(link).replace(/,/g, ''));
                    if (!isNaN(val) && val > 0 && link.href.includes('?')) {
                        fetchQueue.push(getTuggerFetchUrl(link.href));
                    }
                });
            }
        });

        totalFetches = fetchQueue.length;
        completedFetches = 0;

        if (totalFetches > 0) {
            isFetching = true;
            if(statusEl) statusEl.innerHTML = `Loading ${totalFetches} task batches...`;
            document.getElementById('tugger-content-area').innerHTML = `
                <div style="text-align:center; padding:60px 20px; display:flex; flex-direction:column; justify-content:center; height:100%;">
                    <div style="font-size:60px; margin-bottom:20px;">⏳</div>
                    <div style="font-weight:900; font-size:28px; color:#232f3e;">Building Action Plan...</div>
                    <div style="font-size:18px; color:#777; margin-top:10px;">Grouping tasks into trips. Please wait.</div>
                </div>`;
            processQueue();
        } else {
            if(statusEl) statusEl.innerHTML = `Auto-scan complete.`;
            renderCages();
        }
    }

    function processQueue() {
        if (fetchQueue.length === 0 && activeFetches === 0) {
            isFetching = false;
            let statusEl = document.getElementById('tugger-status-bar');
            if(statusEl) {
                let now = new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
                statusEl.innerHTML = `Last Sync: ${now} | Task Batches: ${totalFetches}`;
            }
            renderCages();
            return;
        }

        while (activeFetches < MAX_CONCURRENT_FETCHES && fetchQueue.length > 0) {
            let url = fetchQueue.shift();
            activeFetches++;

            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                timeout: 15000,
                withCredentials: true,
                onload: function(res) {
                    try {
                        let doc = new DOMParser().parseFromString(res.responseText, "text/html");

                        doc.querySelectorAll('table').forEach(t => {
                            let headerRow = t.querySelector('thead tr') || t.querySelector('tr.header-row') || t.rows[0];
                            if (!headerRow) return;

                            let ths = Array.from(headerRow.cells).map(c => cleanText(c));

                            let colCage = ths.findIndex(h => (h.includes('scannable') || h.includes('cage')) && !h.includes('outer'));
                            let colHall = ths.findIndex(h => h.includes('outer') || h.includes('location') || h.includes('destination'));
                            let colCpt = ths.findIndex(h => h.includes('expected') || h.includes('cpt') || h.includes('ship'));
                            let colDwell = ths.findIndex(h => h.includes('dwell'));

                            Array.from(t.querySelectorAll('tr')).forEach(row => {
                                if (row === headerRow) return;
                                let cells = Array.from(row.cells);

                                let rowText = cells.map(c => getText(c).toLowerCase()).join(' | ');

                                if (rowText.includes('vendor-return') ||
                                    rowText.includes('fracs') ||
                                    rowText.includes('-vr-') ||
                                    rowText.includes('ltlmulti') ||
                                    rowText.includes('ltlpallet') ||
                                    rowText.includes('reverse logistics')) {
                                    return;
                                }

                                let rawHall = "";
                                if (colHall !== -1 && cells[colHall]) rawHall = getText(cells[colHall]);

                                if (!rawHall || !rawHall.toLowerCase().includes('dz-') || !rawHall.toLowerCase().includes('picked')) {
                                    for (let i = 0; i < cells.length; i++) {
                                        let txt = getText(cells[i]);
                                        if (txt.toLowerCase().includes('dz-') && txt.toLowerCase().includes('picked')) {
                                            rawHall = txt; break;
                                        }
                                    }
                                }

                                if (!rawHall || !rawHall.toLowerCase().includes('dz-') || !rawHall.toLowerCase().includes('picked')) return;

                                let hallId = "Missing";
                                if (rawHall.includes('-')) {
                                    let parts = rawHall.split('-');
                                    hallId = parts[parts.length - 1].toUpperCase();
                                } else {
                                    hallId = rawHall.toUpperCase();
                                }

                                let cageId = "";
                                if (colCage !== -1 && cells[colCage]) cageId = getText(cells[colCage]);

                                if (!cageId || cageId === '-' || cageId === '') {
                                    for (let i = 0; i < cells.length; i++) {
                                        let txt = getText(cells[i]);
                                        if (txt.startsWith('tsCAGE') || txt.startsWith('tsxVRL') || txt.startsWith('ts')) {
                                            cageId = txt; break;
                                        }
                                    }
                                }
                                if(!cageId || cageId === '-' || cageId.toLowerCase().includes('null')) return;

                                let cptRaw = "";
                                if (colCpt !== -1 && cells[colCpt]) cptRaw = getText(cells[colCpt]);

                                if (!cptRaw || cptRaw === '-' || !cptRaw.match(/\d{1,2}:\d{2}/)) {
                                    for (let i = 0; i < cells.length; i++) {
                                        let txt = getText(cells[i]);
                                        if (txt.match(/\b\d{1,2}:\d{2}\b/) && !txt.toLowerCase().includes('dz-')) {
                                            cptRaw = txt; break;
                                        }
                                    }
                                }
                                if (!cptRaw) cptRaw = "Unknown";

                                let dwellRaw = "";
                                if (colDwell !== -1 && cells[colDwell]) dwellRaw = getText(cells[colDwell]);

                                if (!dwellRaw || dwellRaw === '-' || !dwellRaw.match(/\d+[mhd]/i)) {
                                    for (let i = 0; i < cells.length; i++) {
                                        let txt = getText(cells[i]).trim();
                                        if (/^(\d+d\s*)?(\d+h\s*)?(\d+m\s*)?$/i.test(txt) && txt.match(/\d/)) {
                                            dwellRaw = txt; break;
                                        }
                                    }
                                }
                                if (!dwellRaw) dwellRaw = "0m";

                                let dwellMins = parseDwellMins(dwellRaw);
                                let cptDate = new Date(cptRaw);

                                if (!globalCages[cageId]) {
                                    globalCages[cageId] = { id: cageId, hall: hallId, cpt: cptDate, cptRaw: cptRaw, maxDwell: dwellMins, count: 1 };
                                } else {
                                    globalCages[cageId].count++;
                                    if (cptDate < globalCages[cageId].cpt) {
                                        globalCages[cageId].cpt = cptDate;
                                        globalCages[cageId].cptRaw = cptRaw;
                                    }
                                    if (dwellMins > globalCages[cageId].maxDwell) {
                                        globalCages[cageId].maxDwell = dwellMins;
                                    }
                                }
                            });
                        });
                    } catch(e) {
                        console.error("Tugger parse error:", e);
                    } finally {
                        activeFetches--;
                        completedFetches++;
                        let statusEl = document.getElementById('tugger-status-bar');
                        if(statusEl) {
                            let percent = Math.round((completedFetches / totalFetches) * 100);
                            statusEl.innerHTML = `Loading data: ${percent}% complete...`;
                        }
                        setTimeout(processQueue, 150);
                    }
                },
                onerror: function(err) {
                    activeFetches--; completedFetches++; setTimeout(processQueue, 150);
                },
                ontimeout: function() {
                    activeFetches--; completedFetches++; setTimeout(processQueue, 150);
                }
            });
        }
    }

    initUI();

    dataCheckInterval = setInterval(() => {
        let tableReady = false;
        document.querySelectorAll('table').forEach(t => {
            if (t.querySelector('.partition-name') || t.querySelector('.row-label')) tableReady = true;
        });

        if (tableReady) {
            clearInterval(dataCheckInterval);

            setInterval(() => {
                let app = document.getElementById('tugger-app');
                if (app && app.classList.contains('tug-open') && !isFetching) {
                    startExtraction();
                }
            }, 60000);
        }
    }, 1000);

})();
