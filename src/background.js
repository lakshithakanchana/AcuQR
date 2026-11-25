chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 1. Iframe clicked "Scan". Send message to the TOP frame to open the camera.
    if (message.action === "REQUEST_SCAN") {
        chrome.tabs.sendMessage(sender.tab.id, {
            action: "START_SCAN",
            inputId: message.inputId,
            keys: message.keys,
            requestingFrameId: sender.frameId 
        }, { frameId: 0 }).catch(err => console.log("Top frame error:", err));
    } 
    // 2. Top frame finished scanning. Use Chrome Storage to safely broadcast to all iframes!
    else if (message.action === "SCAN_RESULT") {
        // --- iOS/ORION FIX: Bypassing buggy messaging by using Storage Events ---
        chrome.storage.local.set({
            ACU_QR_LATEST_SCAN: {
                result: message.result,
                inputId: message.inputId,
                keys: message.keys,
                timestamp: Date.now() // Ensures a trigger even if scanning the same QR twice
            }
        });
    }
});