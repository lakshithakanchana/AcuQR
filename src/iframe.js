let LOOKUP_DELAY_MS = 100;
chrome.storage.local.get({ lookupDelay: 100 }).then((res) => { LOOKUP_DELAY_MS = res.lookupDelay; });

// ========================================================================
// 1. HARDWARE SCANNER INTERCEPTOR (ZEBRA TC26/TC27)
// ========================================================================
let scanBuffer = "";
let scannerTimeout = null;
const SCANNER_SPEED_THRESHOLD_MS = 75;

let scanQueue = [];
let isProcessingScan = false;

function playReadyFeedback() {
    // Audio Feedback
    if ('speechSynthesis' in window) {
        const msg = new SpeechSynthesisUtterance("Scan Next");
        msg.rate = 1.2; // Slightly faster for efficiency
        window.speechSynthesis.speak(msg);
    }
    
    // Visual Feedback (Green Flash)
    const flash = document.createElement('div');
    flash.style.position = 'fixed';
    flash.style.top = '0';
    flash.style.left = '0';
    flash.style.width = '100vw';
    flash.style.height = '100vh';
    flash.style.border = '15px solid #4CAF50';
    flash.style.boxSizing = 'border-box';
    flash.style.pointerEvents = 'none';
    flash.style.zIndex = '9999999';
    flash.style.transition = 'opacity 0.3s ease-out';
    
    document.body.appendChild(flash);
    
    setTimeout(() => {
        flash.style.opacity = '0';
        setTimeout(() => flash.remove(), 300);
    }, 150);
}

function enqueueScan(jsonString) {
    scanQueue.push(jsonString);
    processQueue();
}

function processQueue() {
    if (isProcessingScan || scanQueue.length === 0) return;
    
    isProcessingScan = true;
    let nextScan = scanQueue.shift();
    
    Promise.resolve(processCapturedJson(nextScan))
        .then(() => {
            isProcessingScan = false;
            if (scanQueue.length > 0) {
                processQueue();
            } else {
                playReadyFeedback();
            }
        })
        .catch(err => {
            console.error("[AcuQR] Processing error:", err);
            isProcessingScan = false;
            if (scanQueue.length > 0) processQueue();
        });
}

// ========================================================================
// 1. HARDWARE SCANNER INTERCEPTOR (ZEBRA TC26/TC27) - GLOBAL KEYDOWN
// ========================================================================
window.addEventListener('keydown', (e) => {
    // Ignore modifier keys
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;

    if (!scanBuffer && e.key === '{') {
        // Start of a JSON scan
        scanBuffer = '{';
        e.preventDefault();
        e.stopPropagation();
        startScannerTimeout();
    } else if (scanBuffer) {
        // We are actively buffering
        e.preventDefault();
        e.stopPropagation();

        if (e.key.length === 1) {
            scanBuffer += e.key;
            startScannerTimeout();
        } else if (e.key === 'Enter') {
            // End of scan
            let bufferToProcess = scanBuffer;
            scanBuffer = "";
            clearTimeout(scannerTimeout);
            enqueueScan(bufferToProcess);
        }
    } else if (!scanBuffer && e.key === 'Enter') {
        // Fallback: DataWedge typed the JSON directly into an active input field (IME bypass),
        // and is now sending the ENTER suffix.
        if (document.activeElement && document.activeElement.tagName === 'INPUT') {
            let val = document.activeElement.value.trim();
            if (val.startsWith('{') && val.endsWith('}')) {
                e.preventDefault();
                e.stopPropagation();
                // Clear the raw JSON from the field
                document.activeElement.value = "";
                enqueueScan(val);
            }
        }
    }
}, true); // capture phase

// Add PASTE listener for DataWedge "Paste" output mode
window.addEventListener('paste', (e) => {
    let pastedText = (e.clipboardData || window.clipboardData).getData('text');
    let trimmed = pastedText ? pastedText.trim() : "";
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        e.preventDefault();
        e.stopPropagation();
        enqueueScan(trimmed);
    }
}, true);

function startScannerTimeout() {
    clearTimeout(scannerTimeout);
    scannerTimeout = setTimeout(() => {
        if (scanBuffer.length > 0) {
            let bufferToProcess = scanBuffer;
            scanBuffer = "";
            enqueueScan(bufferToProcess);
        }
    }, SCANNER_SPEED_THRESHOLD_MS);
}

function processCapturedJson(jsonString) {
    return new Promise((resolve) => {
        let currentBuffer = jsonString.trim();

        if (currentBuffer.startsWith('{') && currentBuffer.endsWith('}')) {
            console.log("[AcuQR] Globally intercepted QR payload:", currentBuffer);

            // We need to figure out where to put this data.
            let activeInput = document.activeElement;
            let expectedKeys = "InventoryID,LotSerialNbr";

            // 1. Is an editor already open?
            if (activeInput && activeInput.tagName === 'INPUT' &&
                (activeInput.id.includes('InventoryID') || activeInput.id.includes('LotSerialNbr'))) {

                const qrBtn = activeInput.parentNode ? activeInput.parentNode.querySelector('.my-qr-btn') : null;
                if (qrBtn) {
                    expectedKeys = qrBtn.dataset.expectedKeys || expectedKeys;
                }
                processScannedData(currentBuffer, activeInput.id, expectedKeys, "CAMERA").then(resolve);
                return;
            }

            // 2. Editor not open! Try to find the target cell and force it open.
            // If we have a lastActiveCell from our grid observer, use it.
            // Otherwise, look for any un-instantiated LotSerialNbr or InventoryID cell that has an active class.
            let targetCell = (typeof lastActiveCell !== 'undefined' && lastActiveCell) ? lastActiveCell : null;

            if (!targetCell) {
                targetCell = document.querySelector('td.x-grid3-cell-selected, td.GridActiveCell, td.GridCell--active, td[class*="ActiveCell"], td[class*="SelectedCell"]');
            }

            if (targetCell) {
                // Force editor open on this cell
                const clickTarget = targetCell.firstElementChild || targetCell;
                clickTarget.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
                clickTarget.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));

                // Wait for input to appear
                let attempts = 0;
                let findInterval = setInterval(() => {
                    attempts++;
                    let inputs = Array.from(document.querySelectorAll('input[type="text"][id*="InventoryID"], input[type="text"][id*="LotSerialNbr"]'))
                        .filter(el => el.offsetWidth > 0 && window.getComputedStyle(el).display !== 'none');

                    if (inputs.length > 0) {
                        clearInterval(findInterval);
                        let targetInput = inputs[inputs.length - 1];
                        targetInput.focus();

                        const qrBtn = targetInput.parentNode ? targetInput.parentNode.querySelector('.my-qr-btn') : null;
                        if (qrBtn) expectedKeys = qrBtn.dataset.expectedKeys || expectedKeys;

                        processScannedData(currentBuffer, targetInput.id, expectedKeys, "CAMERA").then(resolve);
                    } else if (attempts > 15) {
                        clearInterval(findInterval);
                        alert("AcuQR: Could not automatically open the editor for this cell. Please tap it once manually.");
                        resolve();
                    }
                }, 100);
            } else {
                // Fallback: look for primary input on screen
                const invInput = document.querySelector('input[type="text"][id*="InventoryID"]');
                if (invInput) {
                    processScannedData(currentBuffer, invInput.id, expectedKeys, "CAMERA").then(resolve);
                } else {
                    alert("AcuQR: Scan captured, but no active grid cell or target field was found to paste into!");
                    resolve();
                }
            }
        } else {
            resolve();
        }
    });
}


// ========================================================================
// 2. CAMERA SCANNER LISTENER (HTML5-QRCODE FALLBACK)
// ========================================================================
window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "ACU_NATIVE_QR_PAYLOAD") {
        const data = event.data.data;
        if (document.getElementById(data.inputId)) {
            processScannedData(data.result, data.inputId, data.keys, "CAMERA").then(() => {
                playReadyFeedback();
            });
        }
    }
});


// ========================================================================
// 3. UI OVERLAYS & BUTTON INJECTION
// ========================================================================
function showProcessingOverlay() {
    if (document.getElementById('acuqr-processing-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'acuqr-processing-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.color = '#ffffff';
    overlay.style.fontSize = '18px';
    overlay.style.fontWeight = 'bold';
    overlay.style.fontFamily = 'sans-serif';
    overlay.style.cursor = 'wait';
    overlay.innerText = 'Processing Scan...';

    document.body.appendChild(overlay);
}

function hideProcessingOverlay() {
    const overlay = document.getElementById('acuqr-processing-overlay');
    if (overlay) overlay.remove();
}

function injectButtonSet(inputElement, qrButtonText, jsonKeys) {
    inputElement.classList.add('qr-injected');
    if (inputElement.parentNode) inputElement.parentNode.style.position = "relative";

    // Force inputmode none by default to prevent virtual keyboard from popping up automatically
    inputElement.setAttribute('inputmode', 'none');

    // 1. Create the Keyboard Button
    const kbBtn = document.createElement('button');
    kbBtn.innerText = "⌨️";
    kbBtn.type = "button";
    kbBtn.title = "Show Keyboard";
    kbBtn.classList.add('my-kb-btn');

    kbBtn.style.position = "absolute";
    kbBtn.style.right = "50px"; // Positioned to the left of the QR button
    kbBtn.style.top = "50%";
    kbBtn.style.transform = "translateY(-50%)";
    kbBtn.style.zIndex = "999";
    kbBtn.style.cursor = "pointer";
    kbBtn.style.padding = "2px 5px";
    kbBtn.style.fontSize = "11px";
    kbBtn.style.fontWeight = "bold";
    kbBtn.style.backgroundColor = "#f0f0f0";
    kbBtn.style.border = "1px solid #ccc";
    kbBtn.style.borderRadius = "3px";
    kbBtn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";

    // 2. Create the QR Button
    const qrBtn = document.createElement('button');
    qrBtn.innerText = qrButtonText;
    qrBtn.type = "button";
    qrBtn.classList.add('my-qr-btn');
    qrBtn.dataset.expectedKeys = jsonKeys;

    qrBtn.style.position = "absolute";
    qrBtn.style.right = "5px";
    qrBtn.style.top = "50%";
    qrBtn.style.transform = "translateY(-50%)";
    qrBtn.style.zIndex = "999";
    qrBtn.style.cursor = "pointer";
    qrBtn.style.padding = "2px 5px";
    qrBtn.style.fontSize = "11px";
    qrBtn.style.fontWeight = "bold";
    qrBtn.style.backgroundColor = "#fff";
    qrBtn.style.border = "1px solid #ccc";
    qrBtn.style.borderRadius = "3px";
    qrBtn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)";

    inputElement.parentNode.insertBefore(qrBtn, inputElement.nextSibling);
    inputElement.parentNode.insertBefore(kbBtn, qrBtn);
}

function injectUIExtensions() {
    document.querySelectorAll('input[type="text"][id*="InventoryID"]:not(.qr-injected)').forEach(i => injectButtonSet(i, "📷 ID", "InventoryID,IC"));
    document.querySelectorAll('input[type="text"][id*="LotSerialNbr"]:not(.qr-injected)').forEach(i => injectButtonSet(i, "📷 Lot", "LotSerialNbr"));
}

function handleScanButtonClick(e) {
    if (e.target && e.target.classList.contains('my-qr-btn')) {
        e.preventDefault(); e.stopPropagation();

        const parent = e.target.parentNode;
        const activeInputNode = parent ? parent.querySelector('input.qr-injected') : null;

        if (activeInputNode && activeInputNode.tagName === 'INPUT') {
            chrome.runtime.sendMessage({
                action: "REQUEST_SCAN",
                inputId: activeInputNode.id,
                keys: e.target.dataset.expectedKeys
            });
        }
    } else if (e.target && e.target.classList.contains('my-kb-btn')) {
        e.preventDefault(); e.stopPropagation();

        const parent = e.target.parentNode;
        const activeInputNode = parent ? parent.querySelector('input.qr-injected') : null;

        if (activeInputNode && activeInputNode.tagName === 'INPUT') {
            // Remove inputmode='none' to allow the touch keyboard to appear
            activeInputNode.removeAttribute('inputmode');
            activeInputNode.focus();

            // Re-apply inputmode='none' once the field loses focus
            activeInputNode.addEventListener('blur', function blurHandler() {
                activeInputNode.setAttribute('inputmode', 'none');
                activeInputNode.removeEventListener('blur', blurHandler);
            }, { once: true });
        }
    }
}

window.addEventListener('mousedown', handleScanButtonClick, true);
window.addEventListener('touchstart', handleScanButtonClick, { capture: true, passive: false });


// ========================================================================
// 4. DATA PROCESSING & ACUMATICA FIELD INJECTION
// ========================================================================
function processScannedData(scannedText, inputId, expectedJsonKeys, source = "CAMERA") {
    return new Promise((resolve) => {
        const targetElement = document.getElementById(inputId);
        if (!targetElement) {
            alert("ERROR: Target element vanished!");
            resolve();
            return;
        }

        showProcessingOverlay();

        try {
            const parsedData = JSON.parse(scannedText.trim());
            const keysToCheck = expectedJsonKeys.split(',');

            const normalizedData = {};
            for (let k in parsedData) {
                if (parsedData.hasOwnProperty(k)) {
                    normalizedData[k.toLowerCase()] = parsedData[k];
                }
            }

            let currentUrl = window.location.href;
            let topUrl = "";
            try { topUrl = window.top.location.href; } catch (e) { }

            const isTransferScreen = currentUrl.includes("ScreenId=IN304000") || topUrl.includes("ScreenId=IN304000");
            const isInventoryIdScan = expectedJsonKeys.includes("InventoryID");

            if (isTransferScreen && isInventoryIdScan) {
                let invId = normalizedData["inventoryid"] || normalizedData["ic"];
                let lotSerial = normalizedData["lotserialnbr"];

                if (!invId) {
                    hideProcessingOverlay();
                    alert("No InventoryID or IC found in this QR code!\nScanned data:\n" + scannedText);
                    resolve();
                    return;
                }

                let skipFirstEnter = (source === "HARDWARE");
                fillFieldAndPressEnter(targetElement, invId, false, skipFirstEnter).then(() => {
                    if (lotSerial) {
                        const lotSerialInputId = inputId.replace("InventoryID", "LotSerialNbr");
                        let attempts = 0;
                        
                        let checkInterval = setInterval(() => {
                            attempts++;
                            let nextField = document.getElementById(lotSerialInputId);
                            
                            // Check if Acumatica is currently processing a server request
                            const pxProcessing = document.querySelector('.px-processing');
                            const isProcessing = pxProcessing && window.getComputedStyle(pxProcessing).display !== 'none';
                            
                            if (nextField && nextField.tagName === 'INPUT' && !isProcessing && !nextField.readOnly && !nextField.disabled) {
                                clearInterval(checkInterval);
                                fillFieldAndPressEnter(nextField, lotSerial, false, false).then(() => {
                                    hideProcessingOverlay();
                                    resolve();
                                });
                            } else if (!isProcessing && attempts > 5) {
                                // Server is idle, but the Lot/Serial input hasn't appeared. Force it open!
                                if (attempts % 5 === 0) {
                                    forceOpenCell('lotserialnbr');
                                }
                                
                                if (attempts > 40) { // 2 seconds max
                                    clearInterval(checkInterval);
                                    nextField = document.getElementById(lotSerialInputId);
                                    if (nextField && nextField.tagName === 'INPUT') {
                                        fillFieldAndPressEnter(nextField, lotSerial, false, false).then(() => {
                                            hideProcessingOverlay();
                                            resolve();
                                        });
                                    } else {
                                        console.warn("[AcuQR] FAILED to find the calculated Lot/Serial field.");
                                        hideProcessingOverlay();
                                        resolve();
                                    }
                                }
                            }
                        }, 50);
                    } else {
                        hideProcessingOverlay();
                        resolve();
                    }
                });

            } else {
                let foundValue = null;
                for (let i = 0; i < keysToCheck.length; i++) {
                    let key = keysToCheck[i].trim();
                    let lowerCaseKey = key.toLowerCase();

                    if (normalizedData[lowerCaseKey] !== undefined && normalizedData[lowerCaseKey] !== "") {
                        foundValue = normalizedData[lowerCaseKey];
                        break;
                    }
                }

                if (foundValue !== null) {
                    let skipEnter = (source === "HARDWARE");
                    fillFieldAndPressEnter(targetElement, foundValue, false, skipEnter).then(() => {
                        hideProcessingOverlay();
                        resolve();
                    });
                } else {
                    hideProcessingOverlay();
                    alert(`No ${keysToCheck.join(' or ')} found in this QR code!\nScanned data:\n${scannedText}`);
                    resolve();
                }
            }
        } catch (error) {
            hideProcessingOverlay();
            console.error("[AcuQR] JSON Parse Error:", error);
            alert("Invalid QR Format. Please scan a valid JSON QR code.\nScanned data:\n" + scannedText);
            resolve();
        }
    });
}

function fillFieldAndPressEnter(inputEl, text, shouldBlur = true, skipEnter = false) {
    return new Promise((resolve) => {
        inputEl.blur();
        const originalInputMode = inputEl.getAttribute('inputmode');
        const originalReadOnly = inputEl.readOnly;

        inputEl.setAttribute('inputmode', 'none');
        inputEl.focus();
        inputEl.select();
        const execSuccess = document.execCommand('insertText', false, text);

        if (!execSuccess) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            nativeInputValueSetter.call(inputEl, text);

            inputEl.dispatchEvent(new Event('keydown', { bubbles: true, composed: true }));
            inputEl.dispatchEvent(new Event('keypress', { bubbles: true, composed: true }));
            inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            inputEl.dispatchEvent(new Event('keyup', { bubbles: true, composed: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }

        if (skipEnter) {
            if (shouldBlur) inputEl.blur();
            resolve();
            return;
        }

        inputEl.readOnly = true;

        setTimeout(() => {
            inputEl.readOnly = originalReadOnly;
            if (originalInputMode !== null) {
                inputEl.setAttribute('inputmode', originalInputMode);
            } else {
                inputEl.removeAttribute('inputmode');
            }

            inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13, composed: true }));
            inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13, composed: true }));

            if (shouldBlur) inputEl.blur();
            resolve();
        }, LOOKUP_DELAY_MS);
    });
}

function simulateMouseClick(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

function forceOpenCell(keyword) {
    let cells = Array.from(document.querySelectorAll('td')).filter(td => {
        let cls = (td.className || "").toLowerCase();
        if (cls.includes(keyword)) return true;
        for (let attr of td.attributes) {
            if ((attr.value || "").toLowerCase().includes(keyword)) return true;
        }
        if (td.firstElementChild) {
            let childCls = (td.firstElementChild.className || "").toLowerCase();
            if (childCls.includes(keyword)) return true;
            for (let attr of td.firstElementChild.attributes) {
                if ((attr.value || "").toLowerCase().includes(keyword)) return true;
            }
        }
        return false;
    });

    let activeRow = document.querySelector('tr.x-grid3-row-selected, tr.GridRow--active, tr[class*="ActiveRow"], tr[class*="SelectedRow"]');
    let targetCell = null;
    if (activeRow) {
        targetCell = cells.find(td => activeRow.contains(td));
    }
    if (!targetCell && cells.length > 0) {
        // Fallback to the most recently visible one in the DOM (usually the bottom row)
        targetCell = cells[cells.length - 1]; 
    }

    if (targetCell) {
        const clickTarget = targetCell.firstElementChild || targetCell;
        simulateMouseClick(clickTarget);
        clickTarget.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
        clickTarget.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
        clickTarget.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'F2', keyCode: 113 }));
        return true;
    }
    return false;
}

injectUIExtensions();
const observer = new MutationObserver(injectUIExtensions);
observer.observe(document.body, { childList: true, subtree: true });


// ========================================================================
// 6. PROFESSIONAL-GRADE AUTO-EDIT ENFORCER
// ========================================================================
// Ensures that whenever an InventoryID or LotSerialNbr cell becomes the "active" cell in the grid,
// it is automatically forced into edit mode (blinking cursor), regardless of how it was selected.

function setupAutoEditEnforcer() {
    let lastActiveCell = null;
    let enforceTimeout = null;

    const checkCell = (td) => {
        if (!td || !td.classList) return;
        const isActive = td.classList.contains('x-grid3-cell-selected') ||
            td.classList.contains('GridActiveCell') ||
            td.classList.contains('GridCell--active') ||
            (typeof td.className === 'string' && (td.className.includes('ActiveCell') || td.className.includes('SelectedCell')));

        if (isActive && td !== lastActiveCell) {
            lastActiveCell = td;

            // Debounce slightly to allow Acumatica to finish its own selection logic
            clearTimeout(enforceTimeout);
            enforceTimeout = setTimeout(() => {
                checkAndForceEditMode(td);
            }, 150);
        }
    };

    const gridObserver = new MutationObserver((mutations) => {
        for (let m of mutations) {
            if (m.type === 'attributes' && m.attributeName === 'class' && m.target.tagName === 'TD') {
                checkCell(m.target);
            } else if (m.type === 'childList') {
                m.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // ELEMENT_NODE
                        if (node.tagName === 'TD') {
                            checkCell(node);
                        } else if (node.querySelectorAll) {
                            // Find any TDs within the newly added element that might be active
                            const activeTds = node.querySelectorAll('td.x-grid3-cell-selected, td.GridActiveCell, td.GridCell--active, td[class*="ActiveCell"], td[class*="SelectedCell"]');
                            activeTds.forEach(checkCell);
                        }
                    }
                });
            }
        }
    });

    gridObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true
    });
}

function checkAndForceEditMode(td) {
    // Identify if this cell belongs to InventoryID or LotSerialNbr
    // We check the class list and data attributes of the TD and its immediate children.
    let isTargetColumn = false;
    const targetKeywords = ['inventoryid', 'lotserialnbr', 'inventory_id', 'lot_serial_nbr'];

    // Check TD attributes and classes
    const tdClassStr = (td.className || "").toLowerCase();
    if (targetKeywords.some(kw => tdClassStr.includes(kw))) {
        isTargetColumn = true;
    } else {
        for (let attr of td.attributes) {
            if (targetKeywords.some(kw => (attr.value || "").toLowerCase().includes(kw))) {
                isTargetColumn = true;
                break;
            }
        }
    }

    // Check immediate child (Acumatica often wraps content in an inner div with column info)
    if (!isTargetColumn && td.firstElementChild) {
        const child = td.firstElementChild;
        const childClassStr = (child.className || "").toLowerCase();
        if (targetKeywords.some(kw => childClassStr.includes(kw))) {
            isTargetColumn = true;
        } else {
            for (let attr of child.attributes) {
                if (targetKeywords.some(kw => (attr.value || "").toLowerCase().includes(kw))) {
                    isTargetColumn = true;
                    break;
                }
            }
        }
    }

    if (isTargetColumn) {
        console.log("[AcuQR] Auto-Edit Enforcer: Target cell selected. Forcing edit mode...");

        const tryOpenEditor = () => {
            const clickTarget = td.firstElementChild || td;
            simulateMouseClick(clickTarget);
            clickTarget.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
            clickTarget.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
        };

        // Try opening immediately
        tryOpenEditor();

        let attempts = 0;
        let focusInterval = setInterval(() => {
            attempts++;

            // Check if we are already focused on a relevant input
            if (document.activeElement && document.activeElement.tagName === 'INPUT' &&
                (document.activeElement.id.includes('InventoryID') || document.activeElement.id.includes('LotSerialNbr'))) {
                clearInterval(focusInterval);
                return; // Successfully focused!
            }

            let visibleInputs = Array.from(document.querySelectorAll('input[type="text"][id*="InventoryID"], input[type="text"][id*="LotSerialNbr"]'))
                .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none');

            if (visibleInputs.length > 0) {
                let targetInput = visibleInputs[visibleInputs.length - 1]; // Get the most recently rendered one
                if (document.activeElement !== targetInput) {
                    targetInput.focus();
                    targetInput.select();
                }
                clearInterval(focusInterval); // Found and focused, we are done
            } else {
                // Editor not found yet, try opening it again at specific intervals
                if (attempts === 2 || attempts === 4) {
                    tryOpenEditor();
                    const clickTarget = td.firstElementChild || td;
                    clickTarget.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'F2', keyCode: 113 }));
                }
            }

            if (attempts > 12) {
                clearInterval(focusInterval); // Give up after ~1.2s
            }
        }, 100);
    }
}

// Initialize the enforcer
setupAutoEditEnforcer();



// ========================================================================
// 5. MOBILE AUTO-POPUP PREVENTION (For Zebra Scanners)
// ========================================================================
// Acumatica auto-opens the selector popup on mobile screens when tapping a cell.
// This interferes with hardware barcode scanners which just need focus.

// LAYER 1: Suppress touch events on grid cells.
// Forces Acumatica to see only mouse events (desktop behavior), which typically prevents touch-optimized auto-popups.
['touchstart', 'touchend', 'pointerdown', 'pointerup'].forEach(evt => {
    window.addEventListener(evt, (e) => {
        // Allow pure mouse interactions to pass through naturally
        if (e.type.startsWith('pointer') && e.pointerType === 'mouse') return;

        let node = e.target;
        let isGridArea = false;
        let isMagnifier = false;

        while (node && node !== document.body) {
            // Do not block if user explicitly clicked the magnifying glass
            if (node.classList && (node.classList.contains('icon-search') || (typeof node.className === 'string' && node.className.includes('search')))) {
                isMagnifier = true;
                break;
            }
            if (node.tagName === 'TD' || node.tagName === 'INPUT') {
                isGridArea = true;
            }
            node = node.parentNode;
        }

        if (isGridArea && !isMagnifier) {
            e.stopPropagation();
        }
    }, true); // Capture phase
});

// LAYER 2: Main-world script injection to override Acumatica's mobile/auto-open flags.
try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('acumatica-override.js');
    script.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
} catch (e) {
    console.error("[AcuQR] Failed to inject main-world overrides.", e);
}

// LAYER 3: Auto-close the popup if it still opens due to screen-size logic.
// If a smart panel appears right after the input is focused, we close it.
let lastFocusedAcuInput = null;
let blockAutoPopupWindow = false;
let popupCloseTimeout = null;

window.addEventListener('focus', (e) => {
    let target = e.target;
    if (target && target.tagName === 'INPUT' && (target.id.includes('LotSerialNbr') || target.id.includes('InventoryID'))) {
        lastFocusedAcuInput = target;
        blockAutoPopupWindow = true;
        clearTimeout(popupCloseTimeout);
        popupCloseTimeout = setTimeout(() => { blockAutoPopupWindow = false; }, 1200);
    }
}, true);

const modalObserver = new MutationObserver((mutations) => {
    if (!blockAutoPopupWindow) return;

    // Sometimes Acumatica toggles display:none instead of adding to DOM
    let shouldCheck = false;
    for (let mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) shouldCheck = true;
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') shouldCheck = true;
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') shouldCheck = true;
    }

    if (shouldCheck) {
        // Look for common Acumatica modal containers that are currently visible
        const panels = document.querySelectorAll('.smartPanel, .px-smart-panel, .x-window');
        for (let panel of panels) {
            // Check if it's visible
            const style = window.getComputedStyle(panel);
            if (style.display !== 'none' && style.visibility !== 'hidden' && panel.offsetWidth > 0) {
                // Try to find the close button
                let closeBtn = panel.querySelector('.px-close, .sprite-icon-close, .x-tool-close');
                if (closeBtn) {
                    closeBtn.click(); // Close it
                    console.log("[AcuQR] Auto-closed mobile lookup popup to allow scanner input.");

                    blockAutoPopupWindow = false; // Stop checking

                    // Restore focus to the input field so hardware scanner can type
                    if (lastFocusedAcuInput) {
                        setTimeout(() => {
                            lastFocusedAcuInput.focus();
                            lastFocusedAcuInput.select();
                        }, 100);
                    }
                    break;
                }
            }
        }
    }
});

modalObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class']
});