// ==UserScript==
// @name         Amazon SIOC Evaluator (QIFCR Dimension Check)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Evaluates SPTC shipments for Cage, SIOC, and Oversize conditions based on QIFCR live dimensions.
// @match        https://sptc.eu.aftx.amazonoperations.app/*
// @match        https://sptc.eu.aft.amazonoperations.app/*
// @updateURL    https://github.com/RBCeva/TM/raw/refs/heads/main/SIOC.user.js
// @downloadURL  https://github.com/RBCeva/TM/raw/refs/heads/main/SIOC.user.js
// @connect      qifcr.eu.aftx.amazonoperations.app
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    let timeout = null;
    const OVERSIZE_BOXES = ['LS2', 'N21', 'N28', 'N29', 'EX1', 'EX2', 'EX4'];

    // QIFCR Backend Config
    const warehouseId = window.location.pathname.split('/')[1] || 'XFR9';
    const qifcrBase = 'https://qifcr.eu.aftx.amazonoperations.app';
    const endpointsToTest = ['inventory', 'product', 'physical-inventory', 'container'];
    const qifcrCache = new Map(); // Cache queries to prevent redundant network requests

    function qifcrPost(path, query) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${qifcrBase}/${warehouseId}/results/${path}`,
                data: 's=' + encodeURIComponent(query),
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    'accept': 'text/html, */*'
                },
                timeout: 10000,
                onload: r => (r.status === 200 && r.responseText) ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status)),
                onerror: () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Timeout'))
            });
        });
    }

    async function fetchQifcrHtml(query) {
        if (qifcrCache.has(query)) return qifcrCache.get(query);
        for (const ep of endpointsToTest) {
            try {
                const html = await qifcrPost(ep, query);
                if (html && html.trim().length > 100) {
                    qifcrCache.set(query, html);
                    return html;
                }
            } catch (e) {}
        }
        return null;
    }

    // Extract maximum numeric dimension from <th>Dimensions</th> table column
    function extractMaxDimension(html) {
        if (!html) return 0;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        let maxDim = 0;

        doc.querySelectorAll('table').forEach(table => {
            let dimColIdx = -1;
            table.querySelectorAll('tr').forEach(tr => {
                tr.querySelectorAll('th, td').forEach((cell, idx) => {
                    if (cell.textContent.trim().toUpperCase() === 'DIMENSIONS') dimColIdx = idx;
                });
            });

            if (dimColIdx !== -1) {
                table.querySelectorAll('tr').forEach(tr => {
                    const tds = tr.querySelectorAll('td');
                    if (tds.length > dimColIdx) {
                        const val = tds[dimColIdx].textContent.trim();
                        // Parse all numeric measurements (e.g., "125.5 x 40 x 30" or "125.5 cm")
                        const numbers = val.match(/\b\d+(\.\d+)?\b/g);
                        if (numbers) {
                            numbers.forEach(num => {
                                const parsed = parseFloat(num);
                                if (parsed > maxDim) maxDim = parsed;
                            });
                        }
                    }
                });
            }
        });

        return maxDim;
    }

    function createIndicator(text, bg, fg) {
        const indicator = document.createElement('div');
        indicator.className = 'qifcr-sptc-indicator';
        indicator.style.padding = '30px 40px';
        indicator.style.margin = '15px 0';
        indicator.style.fontWeight = '900';
        indicator.style.borderRadius = '8px';
        indicator.style.fontSize = '36px';
        indicator.style.display = 'block';
        indicator.style.textAlign = 'center';
        indicator.style.border = '4px solid #000';
        indicator.style.boxShadow = '0px 6px 15px rgba(0,0,0,0.3)';
        indicator.style.backgroundColor = bg;
        indicator.style.color = fg;
        indicator.innerText = text;
        return indicator;
    }

    function updateIndicator(el, text, bg, fg) {
        let indicator = el.querySelector('.qifcr-sptc-indicator');
        if (!indicator) {
            indicator = createIndicator(text, bg, fg);
            el.prepend(indicator);
        } else {
            indicator.innerText = text;
            indicator.style.backgroundColor = bg;
            indicator.style.color = fg;
        }
    }

    async function evaluateShipment() {
        const elements = document.querySelectorAll('.shipment-complete-singles.induct:not([data-sioc-checked])');

        elements.forEach(async (el) => {
            el.setAttribute('data-sioc-checked', 'true');

            const text = el.innerText || '';
            const upperText = text.toUpperCase();

            // Ignore problematic shipments
            if (upperText.includes("CAN'T PRINT PSLIP") || upperText.includes("CANT PRINT PSLIP") || upperText.includes("PROBLEM")) {
                return;
            }

            const problemMenu = el.querySelector('select, [class*="problem"], [id*="problem"]');
            if (problemMenu && problemMenu.value && problemMenu.value !== "" && problemMenu.value !== "DEFAULT") {
                return;
            }

            // Check Oversize Boxes first
            let isOversizeBox = OVERSIZE_BOXES.some(box => upperText.includes(box));
            if (isOversizeBox) {
                updateIndicator(el, '⚠️ OVERSIZE ⚠️', '#d9534f', '#fff');
                return;
            }

            let isSioc = upperText.includes('SIOC');

            if (isSioc) {
                // Show loading state while querying QIFCR
                updateIndicator(el, 'CHECKING QIFCR DIMENSIONS...', '#f0ad4e', '#fff');

                // Extract query identifier (ASIN, LPN, or Item Code from node text)
                const queryMatch = text.match(/\b(LPN[A-Z0-9]+|B0[A-Z0-9]{8}|[A-Z0-9]{10})\b/i);
                const searchQuery = queryMatch ? queryMatch[0] : null;

                if (searchQuery) {
                    try {
                        const html = await fetchQifcrHtml(searchQuery);
                        const maxDimension = extractMaxDimension(html);

                        if (maxDimension > 120) {
                            updateIndicator(el, `⚠️ OVERSIZE (${maxDimension}) ⚠️`, '#d9534f', '#fff');
                        } else {
                            updateIndicator(el, 'SIOC - CONVEYOR', '#5cb85c', '#fff');
                        }
                    } catch (err) {
                        // Fallback if QIFCR call fails
                        updateIndicator(el, 'SIOC - CONVEYOR', '#5cb85c', '#fff');
                    }
                } else {
                    updateIndicator(el, 'SIOC - CONVEYOR', '#5cb85c', '#fff');
                }
            } else {
                updateIndicator(el, 'CONVEYOR', '#5cb85c', '#fff');
            }
        });
    }

    const observer = new MutationObserver(() => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(evaluateShipment, 150);
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        evaluateShipment();
    }
})();
