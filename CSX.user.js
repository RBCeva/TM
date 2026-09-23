// ==UserScript==
// @name         WMS - CSX Stealth Gatekeeper & FCR Connector (V21.0)
// @namespace    http://tampermonkey.net/
// @version      21.0.0
// @description  Targeted HTML parsing for Amazon AUI a-keyvalue tables.
// @match        https://taskui-web.eu.aftx.amazonoperations.app/*
// @match        https://data.pendo.aft.amazon.dev/data/rec/*
// @connect      qifcr.eu.aftx.amazonoperations.app
// @updateURL    https://github.com/RBCeva/TM/raw/refs/heads/main/CSX.user.js
// @downloadURL  https://github.com/RBCeva/TM/raw/refs/heads/main/CSX.user.js
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = Object.freeze({
        CSX_PREFIX: /^csX/i,
        WS_PREFIX: /^ws/i,
        TSCAGE_PREFIX: /^tsCAGE/i,
        STORAGE_KEY_CSX: 'wms_scanned_csx_permanent_v15',
        STORAGE_KEY_CAGES: 'wms_cage_states_v1',
        SCAN_TIMEOUT: 60,
        LOCATION_TEXT: 'location qr code',
        CONTAINER_TEXT: 'all container barcodes',
        DEST_CONTAINER_TEXT: 'scan destination container to move items',
        DECANT_TEXT: 'decant',
        CLEAR_PASSWORD: 'DDD',
        QIFCR_BASE: 'https://qifcr.eu.aftx.amazonoperations.app',
        ENDPOINTS: ['product', 'inventory', 'physical-inventory', 'container'],
        MAX_DIMENSION: 120,
        MAX_WEIGHT: 23
    });

    class FCRConnector {
        constructor(warehouseId = 'XFR9') {
            this.warehouseId = warehouseId;
            this.qifcrCache = new Map();
        }

        qifcrPost(path, query) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${CONFIG.QIFCR_BASE}/${this.warehouseId}/results/${path}`,
                    data: 's=' + encodeURIComponent(query),
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                        'accept': 'text/html, */*'
                    },
                    timeout: 10000,
                    onload: r => (r.status === 200 && r.responseText) ? resolve(r.responseText) : reject(new Error(`HTTP ${r.status}`)),
                    onerror: () => reject(new Error('Network error connecting to QIFCR')),
                    ontimeout: () => reject(new Error('QIFCR Request Timeout'))
                });
            });
        }

        async fetchRawData(query) {
            if (this.qifcrCache.has(query)) return this.qifcrCache.get(query);

            for (const ep of CONFIG.ENDPOINTS) {
                try {
                    const html = await this.qifcrPost(ep, query);
                    if (html && html.includes('a-keyvalue')) {
                        this.qifcrCache.set(query, html);
                        return html;
                    }
                } catch (e) {
                    // Continue to next endpoint
                }
            }
            throw new Error('NOT_FOUND');
        }

        extractMaxDimension(html) {
            if (!html) return 0;
            const doc = new DOMParser().parseFromString(html, 'text/html');
            let maxDim = 0;

            // Target <th> containing 'Dimensions' or 'Dimension'
            const headers = doc.querySelectorAll('table.a-keyvalue th, table th');
            headers.forEach(th => {
                if (th.textContent.trim().toLowerCase().includes('dimension')) {
                    const td = th.nextElementSibling;
                    if (td) {
                        const rawText = td.textContent.trim();
                        // Extract X x Y x Z pattern (e.g., 15.00 x 98.00 x 35.00 CM)
                        const matches = rawText.match(/(\d+(?:[\.,]\d+)?)\s*[xX*×]\s*(\d+(?:[\.,]\d+)?)\s*[xX*×]\s*(\d+(?:[\.,]\d+)?)/);
                        if (matches) {
                            const d1 = parseFloat(matches[1].replace(',', '.'));
                            const d2 = parseFloat(matches[2].replace(',', '.'));
                            const d3 = parseFloat(matches[3].replace(',', '.'));
                            maxDim = Math.max(d1, d2, d3);
                        }
                    }
                }
            });

            // Global fallback pattern match
            if (maxDim === 0) {
                const bodyText = doc.body ? doc.body.textContent : html;
                const patternMatch = bodyText.match(/(\d+(?:[\.,]\d+)?)\s*[xX*×]\s*(\d+(?:[\.,]\d+)?)\s*[xX*×]\s*(\d+(?:[\.,]\d+)?)/);
                if (patternMatch) {
                    const d1 = parseFloat(patternMatch[1].replace(',', '.'));
                    const d2 = parseFloat(patternMatch[2].replace(',', '.'));
                    const d3 = parseFloat(patternMatch[3].replace(',', '.'));
                    maxDim = Math.max(d1, d2, d3);
                }
            }

            return maxDim;
        }

        extractMaxWeight(html) {
            if (!html) return 0;
            const doc = new DOMParser().parseFromString(html, 'text/html');
            let maxWeight = 0;

            // Target <th> containing 'Weight'
            const headers = doc.querySelectorAll('table.a-keyvalue th, table th');
            headers.forEach(th => {
                if (th.textContent.trim().toLowerCase().includes('weight')) {
                    const td = th.nextElementSibling;
                    if (td) {
                        const rawText = td.textContent.trim();
                        const match = rawText.match(/(\d+(?:[\.,]\d+)?)/);
                        if (match) {
                            maxWeight = parseFloat(match[1].replace(',', '.'));
                        }
                    }
                }
            });

            // Global fallback pattern match
            if (maxWeight === 0) {
                const textContent = doc.body ? doc.body.textContent : html;
                const weightRegex = /(\d+(?:[\.,]\d+)?)\s*(?:kg|kilograms|lbs|pounds)/gi;
                const match = weightRegex.exec(textContent);
                if (match) {
                    maxWeight = parseFloat(match[1].replace(',', '.'));
                }
            }

            return maxWeight;
        }

        async validateFnSKU(fnsku) {
            const html = await this.fetchRawData(fnsku);
            const maxDim = this.extractMaxDimension(html);
            const maxWeight = this.extractMaxWeight(html);

            const isOversize = (maxDim > CONFIG.MAX_DIMENSION) || (maxWeight >= CONFIG.MAX_WEIGHT);

            console.log(`[Gatekeeper FCR] Item: ${fnsku} | Max Dim: ${maxDim} cm | Weight: ${maxWeight} kg | Outcome: ${isOversize ? 'OVERSIZE' : 'STANDARD'}`);

            return {
                isOversize,
                maxDim,
                maxWeight
            };
        }
    }

    class StealthGatekeeper {
        constructor() {
            this.scannedCSX = this.loadMemory(CONFIG.STORAGE_KEY_CSX);
            this.cageStates = this.loadCageMemory();
            this.activeCage = null;
            this.currentScreenFnSKU = null;
            this.currentFnSKUMetrics = null;
            this.fcr = new FCRConnector(this.extractWarehouseId());

            this.buffer = '';
            this.lastKeyTime = 0;
            this.lastDecantClickTime = 0;

            this.mountUI();
            this.bindInterceptor();
            this.initDecantAutoActivator();
            this.initDOMFnSKUObserver();
        }

        extractWarehouseId() {
            const parts = window.location.pathname.split('/');
            return (parts[1] && parts[1].length === 4) ? parts[1].toUpperCase() : 'XFR9';
        }

        loadMemory(key) {
            try {
                const data = localStorage.getItem(key);
                return data ? new Set(JSON.parse(data)) : new Set();
            } catch {
                return new Set();
            }
        }

        loadCageMemory() {
            try {
                const data = localStorage.getItem(CONFIG.STORAGE_KEY_CAGES);
                return data ? new Map(JSON.parse(data)) : new Map();
            } catch {
                return new Map();
            }
        }

        saveMemory() {
            try {
                localStorage.setItem(CONFIG.STORAGE_KEY_CSX, JSON.stringify([...this.scannedCSX]));
                localStorage.setItem(CONFIG.STORAGE_KEY_CAGES, JSON.stringify([...this.cageStates]));
            } catch (e) {
                console.error('[Gatekeeper] Failed to save persistence', e);
            }
        }

        clearCSXMemory() {
            const input = prompt('Enter password to clear CSX history:');
            if (input === CONFIG.CLEAR_PASSWORD) {
                this.scannedCSX.clear();
                localStorage.removeItem(CONFIG.STORAGE_KEY_CSX);
                this.updateCount();
                this.showBanner('SUCCESS: CSX Cache Cleared!');
            } else if (input !== null) {
                alert('Incorrect Password.');
            }
        }

        clearCageMemory() {
            const input = prompt('Enter password to clear Cage states:');
            if (input === CONFIG.CLEAR_PASSWORD) {
                this.cageStates.clear();
                this.activeCage = null;
                localStorage.removeItem(CONFIG.STORAGE_KEY_CAGES);
                this.updateCount();
                this.showBanner('SUCCESS: Cage States Cleared!');
            } else if (input !== null) {
                alert('Incorrect Password.');
            }
        }

        mountUI() {
            const host = document.createElement('div');
            host.id = 'csx-status-root';
            (document.body || document.documentElement).appendChild(host);
            this.shadowRoot = host.attachShadow({ mode: 'closed' });

            this.shadowRoot.innerHTML = `
                <style>
                    .status-pill {
                        position: fixed;
                        bottom: 16px;
                        right: 16px;
                        z-index: 2147483647;
                        background: rgba(17, 24, 39, 0.95);
                        color: #ffffff;
                        padding: 8px 14px;
                        border-radius: 20px;
                        font-family: system-ui, -apple-system, sans-serif;
                        font-size: 13px;
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
                        border: 1px solid rgba(255, 255, 255, 0.15);
                        backdrop-filter: blur(6px);
                        user-select: none;
                    }
                    .dot {
                        width: 9px;
                        height: 9px;
                        background-color: #22c55e;
                        border-radius: 50%;
                        box-shadow: 0 0 10px #22c55e;
                        animation: pulse 2s infinite;
                    }
                    .btn-action {
                        cursor: pointer;
                        padding: 3px 10px;
                        border-radius: 10px;
                        transition: transform 0.1s ease, filter 0.2s ease;
                    }
                    .btn-action:hover {
                        filter: brightness(1.2);
                    }
                    .btn-action:active {
                        transform: scale(0.92);
                    }
                    .counter {
                        background: #374151;
                        color: #60a5fa;
                        font-family: monospace;
                        font-weight: bold;
                        font-size: 13px;
                    }
                    .cage-tag {
                        background: #4b5563;
                        color: #f3f4f6;
                        font-size: 11px;
                    }
                    @keyframes pulse {
                        0% { opacity: 1; transform: scale(1); }
                        50% { opacity: 0.4; transform: scale(0.9); }
                        100% { opacity: 1; transform: scale(1); }
                    }
                </style>
                <div class="status-pill">
                    <div class="dot"></div>
                    <span>GATEKEEPER</span>
                    <span class="btn-action counter" id="btn-clear-csx">${this.scannedCSX.size} CSX</span>
                    <span class="btn-action cage-tag" id="btn-clear-cage">Cage: None</span>
                </div>
            `;

            this.countEl = this.shadowRoot.getElementById('btn-clear-csx');
            this.cageEl = this.shadowRoot.getElementById('btn-clear-cage');

            this.countEl.addEventListener('click', () => this.clearCSXMemory());
            this.cageEl.addEventListener('click', () => this.clearCageMemory());
        }

        updateCount() {
            if (this.countEl) this.countEl.textContent = `${this.scannedCSX.size} CSX`;
            if (this.cageEl) {
                if (!this.activeCage) {
                    this.cageEl.textContent = 'Cage: None';
                    this.cageEl.style.background = '#4b5563';
                } else {
                    const state = this.cageStates.get(this.activeCage) || 'EMPTY';
                    this.cageEl.textContent = `Cage: ${state}`;
                    this.cageEl.style.background = state === 'OVERSIZE' ? '#dc2626' : '#16a34a';
                }
            }
        }

        bindInterceptor() {
            window.addEventListener('keydown', (e) => this.handleKeyDown(e), true);
        }

        initDecantAutoActivator() {
            setInterval(() => this.checkAndClickDecant(), 500);
            const observer = new MutationObserver(() => this.checkAndClickDecant());
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        }

        initDOMFnSKUObserver() {
            const checkDOMForFnSKU = async () => {
                const detected = this.extractFnSKUElementFromDOM();

                if (detected) {
                    if (detected.fnsku !== this.currentScreenFnSKU || !document.getElementById('inline-item-badge')) {
                        this.currentScreenFnSKU = detected.fnsku;
                        this.currentFnSKUMetrics = null;
                        this.renderInlineBadge(detected.targetEl, 'CHECKING QIFCR...', 'checking');

                        try {
                            const metrics = await this.fcr.validateFnSKU(detected.fnsku);
                            this.currentFnSKUMetrics = metrics;

                            if (metrics.isOversize) {
                                const detail = `OVERSIZE (${metrics.maxDim}cm / ${metrics.maxWeight}kg)`;
                                this.renderInlineBadge(detected.targetEl, detail, 'oversize');
                            } else {
                                this.renderInlineBadge(detected.targetEl, 'STANDARD ITEM', 'standard');
                            }
                        } catch (e) {
                            this.renderInlineBadge(detected.targetEl, 'NOT FOUND IN FCR', 'not_found');
                        }
                    }
                } else if (this.currentScreenFnSKU) {
                    this.currentScreenFnSKU = null;
                    this.currentFnSKUMetrics = null;
                    this.removeInlineBadge();
                }
            };

            setInterval(checkDOMForFnSKU, 200);

            const domObserver = new MutationObserver(() => checkDOMForFnSKU());
            domObserver.observe(document.body, { childList: true, subtree: true });
        }

        extractFnSKUElementFromDOM() {
            const elements = document.querySelectorAll('span, p, div, b, strong');
            const pattern = /(?:FnSKU|ASIN):\s*([A-Z0-9]+)/i;

            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                if (el.id === 'inline-item-badge') continue;

                if (el.children.length === 0 || (el.children.length === 1 && el.children[0].id === 'inline-item-badge')) {
                    const match = el.textContent.match(pattern);
                    if (match && match[1]) {
                        return {
                            fnsku: match[1].trim().toUpperCase(),
                            targetEl: el
                        };
                    }
                }
            }
            return null;
        }

        renderInlineBadge(targetEl, text, type) {
            this.removeInlineBadge();

            const badge = document.createElement('span');
            badge.id = 'inline-item-badge';

            let bgColor = '#4b5563';
            let textColor = '#ffffff';

            if (type === 'oversize') {
                bgColor = '#dc2626';
            } else if (type === 'standard') {
                bgColor = '#16a34a';
            } else if (type === 'not_found') {
                bgColor = '#b91c1c';
            }

            badge.style.cssText = `
                display: inline-block;
                margin-left: 10px;
                padding: 4px 12px;
                background-color: ${bgColor};
                color: ${textColor};
                font-weight: 800;
                font-size: 13px;
                border-radius: 6px;
                letter-spacing: 0.5px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                vertical-align: middle;
                user-select: none;
            `;
            badge.textContent = `[ ${text} ]`;

            if (targetEl) {
                targetEl.appendChild(badge);
            }
        }

        removeInlineBadge() {
            const existing = document.getElementById('inline-item-badge');
            if (existing) existing.remove();
        }

        checkAndClickDecant() {
            const now = Date.now();
            if (now - this.lastDecantClickTime < 1000) return;

            const elements = document.querySelectorAll('button, a, div[role="button"], span');
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                if (el.textContent.trim().toLowerCase() === CONFIG.DECANT_TEXT) {
                    const clickableTarget = el.closest('button, a, div[role="button"]') || el;
                    if (clickableTarget.offsetWidth > 0 && clickableTarget.offsetHeight > 0) {
                        this.lastDecantClickTime = now;
                        clickableTarget.click();
                        break;
                    }
                }
            }
        }

        getDOMContext() {
            const text = document.body ? document.body.innerText.toLowerCase() : '';
            return {
                isLocation: text.includes(CONFIG.LOCATION_TEXT),
                isContainer: text.includes(CONFIG.CONTAINER_TEXT),
                isDestContainer: text.includes(CONFIG.DEST_CONTAINER_TEXT)
            };
        }

        purgeInputTarget(target) {
            if (target && ('value' in target)) {
                target.value = '';
                target.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }

        async handleKeyDown(e) {
            const currentTime = performance.now();
            const timeDiff = currentTime - this.lastKeyTime;
            this.lastKeyTime = currentTime;

            if (timeDiff > CONFIG.SCAN_TIMEOUT) {
                this.buffer = '';
            }

            if (e.key === 'Enter') {
                if (this.buffer.length > 0) {
                    const barcode = this.buffer.trim();
                    this.buffer = '';

                    const context = this.getDOMContext();

                    if (context.isLocation && !CONFIG.WS_PREFIX.test(barcode)) {
                        this.blockEvent(e, `🛑 REJECTED: Location step requires "ws" barcode (Got: ${barcode})`);
                        return;
                    }

                    if (context.isDestContainer) {
                        if (!CONFIG.TSCAGE_PREFIX.test(barcode)) {
                            this.blockEvent(e, `🛑 REJECTED: Destination step requires "tsCAGE" barcode (Got: ${barcode})`);
                            return;
                        }

                        const existingCageState = this.cageStates.get(barcode);
                        const metrics = this.currentFnSKUMetrics;

                        if (metrics) {
                            if (metrics.isOversize) {
                                if (existingCageState === 'NORMAL') {
                                    this.blockEvent(e, `🛑 CAGE REJECTED: Item is OVERSIZE (${metrics.maxDim}cm / ${metrics.maxWeight}kg) but ${barcode} contains NORMAL items!`);
                                    return;
                                }

                                this.cageStates.set(barcode, 'OVERSIZE');
                                this.activeCage = barcode;
                                this.saveMemory();
                                this.updateCount();
                            } else {
                                if (existingCageState === 'OVERSIZE') {
                                    this.blockEvent(e, `🛑 CAGE REJECTED: Standard item cannot go into OVERSIZE cage ${barcode}!`);
                                    return;
                                }

                                if (!existingCageState) {
                                    this.cageStates.set(barcode, 'NORMAL');
                                }
                                this.activeCage = barcode;
                                this.saveMemory();
                                this.updateCount();
                            }
                        }
                    }

                    if (CONFIG.CSX_PREFIX.test(barcode)) {
                        if (this.scannedCSX.has(barcode)) {
                            this.blockEvent(e, `🛑 DUPLICATE CSX BLOCKED: ${barcode}`);
                            return;
                        } else {
                            this.scannedCSX.add(barcode);
                            this.saveMemory();
                            this.updateCount();
                        }
                    }
                }
            } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const keyLower = e.key.toLowerCase();

                if ((keyLower === 'p' || keyLower === 'm') && (timeDiff < 35 || this.buffer.length > 0)) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                }

                this.buffer += e.key;
            }
        }

        blockEvent(e, message) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.purgeInputTarget(e.target);
            this.triggerWarning(message);
        }

        triggerWarning(message) {
            console.warn(`[Gatekeeper] ${message}`);
            this.playBuzzerSound();
            this.showBanner(message);
        }

        showBanner(message) {
            let banner = document.getElementById('csx-stealth-banner');
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'csx-stealth-banner';
                banner.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    background-color: #991b1b;
                    color: #ffffff;
                    text-align: center;
                    padding: 22px 16px;
                    font-size: 24px;
                    font-weight: 900;
                    font-family: system-ui, -apple-system, sans-serif;
                    letter-spacing: 0.5px;
                    z-index: 2147483647;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.6);
                    border-bottom: 4px solid #ef4444;
                    transition: transform 0.2s ease-in-out;
                    transform: translateY(-100%);
                `;
                document.body.appendChild(banner);
            }

            banner.textContent = message;
            requestAnimationFrame(() => {
                banner.style.transform = 'translateY(0)';
            });

            if (this.bannerTimer) clearTimeout(this.bannerTimer);
            this.bannerTimer = setTimeout(() => {
                if (banner) {
                    banner.style.transform = 'translateY(-100%)';
                }
            }, 3500);
        }

        playBuzzerSound() {
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                const ctx = new AudioCtx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(180, ctx.currentTime);
                gain.gain.setValueAtTime(0.5, ctx.currentTime);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start();
                osc.stop(ctx.currentTime + 0.4);
                setTimeout(() => ctx.close(), 450);
            } catch (e) {}
        }
    }

    new StealthGatekeeper();
})();
