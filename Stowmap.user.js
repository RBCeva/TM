// ==UserScript==
// @name         Silent Stowmap Downloader
// @namespace    http://tampermonkey.net/
// @version      3.6
// @description  Triggers download in an inactive background tab and closes it automatically
// @match        https://menu.eu.aftx.amazonoperations.app/*
// @match        https://stowmap.eu.aftx.amazonoperations.app/stowmap/loadFCAreaMap.htm*
// @updateURL    https://raw.githubusercontent.com/RBCeva/TamperMonkey/refs/heads/main/StowMap.user.js
// @downloadURL  https://raw.githubusercontent.com/RBCeva/TamperMonkey/refs/heads/main/StowMap.user.js
// @grant        GM_openInTab
// ==/UserScript==

(function() {
    'use strict';

    const currentHost = window.location.hostname;
    const SAFETY_DELAY = 1000; // 1 second safety buffer between steps

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // --- DOMAIN 1: MENU PAGE LOGIC ---
    if (currentHost.includes('menu.eu.aftx.amazonoperations.app')) {
        const btn = document.createElement('button');
        btn.innerText = 'Download Floor 1 Bins Report';
        btn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;padding:10px;background:#ff9900;border:none;border-radius:4px;font-weight:bold;cursor:pointer;';

        btn.addEventListener('click', () => {
            const targetUrl = 'https://stowmap.eu.aftx.amazonoperations.app/stowmap/loadFCAreaMap.htm?warehouseId=XFR9&autoDownloadFloor=1';

            // active: false opens it strictly in the background without stealing window focus
            if (typeof GM_openInTab !== 'undefined') {
                GM_openInTab(targetUrl, { active: false, insert: true });
            } else {
                window.open(targetUrl, '_blank');
            }
        });

        document.body.appendChild(btn);
    }

    // --- DOMAIN 2: STOWMAP PAGE LOGIC ---
    if (currentHost.includes('stowmap.eu.aftx.amazonoperations.app')) {
        const urlParams = new URLSearchParams(window.location.search);
        const floor = urlParams.get('autoDownloadFloor');

        if (floor) {
            const waitForElement = (selector, timeout = 10000) => {
                return new Promise((resolve, reject) => {
                    const startTime = Date.now();
                    const interval = setInterval(() => {
                        const element = document.querySelector(selector) ||
                                        Array.from(document.querySelectorAll('*')).find(el => el.textContent.trim() === selector);
                        if (element) {
                            clearInterval(interval);
                            resolve(element);
                        } else if (Date.now() - startTime > timeout) {
                            clearInterval(interval);
                            reject(new Error(`Timeout waiting for ${selector}`));
                        }
                    }, 300);
                });
            };

            const runAutomation = async () => {
                try {
                    // Generous delay to ensure all background scripts/frameworks load fully
                    await delay(SAFETY_DELAY);

                    // Step 1: Click "Bins Report"
                    const binsReportBtn = await waitForElement('Bins Report');
                    binsReportBtn.click();
                    await delay(SAFETY_DELAY);

                    // Step 2: Populate Floor Input
                    const input = await waitForElement('#floorId');
                    input.focus();
                    input.value = floor;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    await delay(SAFETY_DELAY);

                    // Step 3: Trigger Download
                    const downloadBtn = await waitForElement('#download');
                    downloadBtn.click();

                    // Step 4: Grace period for browser to catch the download stream, then self-destruct tab
                    await delay(1000);
                    window.close();

                } catch (err) {
                    console.error('Silent Stowmap Automation Failed:', err);
                }
            };

            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                runAutomation();
            } else {
                window.addEventListener('DOMContentLoaded', runAutomation);
            }
        }
    }
})();
