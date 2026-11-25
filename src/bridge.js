// 1. Inject the QR Library directly into the actual page
const libScript = document.createElement('script');
libScript.src = chrome.runtime.getURL('html5-qrcode.min.js');
document.head.appendChild(libScript);

// 2. Once the library loads, inject our UI controller
libScript.onload = () => {
    const uiScript = document.createElement('script');
    uiScript.src = chrome.runtime.getURL('scanner-ui.js');
    document.head.appendChild(uiScript);
};

// 3. Listen for the background script telling us to open the camera
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "START_SCAN") {
        window.postMessage({ type: "EXT_START_SCAN", payload: message }, "*");
    }
});

// 4. Listen for the page script sending us the successful scan result
window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === "PAGE_SCAN_RESULT") {
        
        // alert("Step 2.5: Bypassing Extension APIs! Using Native WebKit to broadcast to iframes...");
        
        const payload = event.data.payload;
        
        // --- THE ULTIMATE ORION FIX ---
        // Bypass buggy Chrome APIs entirely. Use native HTML5 to broadcast to all iframes.
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            try {
                iframe.contentWindow.postMessage({
                    type: "ACU_NATIVE_QR_PAYLOAD",
                    data: payload
                }, "*");
            } catch(err) {
                // Ignore cross-origin frame block errors if there are external ads/trackers
            }
        });
        
        // Also post to self just in case the target input is actually in the top window
        window.postMessage({
            type: "ACU_NATIVE_QR_PAYLOAD",
            data: payload
        }, "*");
    }
});