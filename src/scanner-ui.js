let html5QrCode = null;
let currentRequestingFrameId = null;
let currentInputId = null;
let currentKeys = null;

// Material Design UI Structure: Select on Left, Graphical Close on Right
const modalHtml = `
    <div id="acu-qr-modal-overlay">
        <div id="acu-qr-header">
            <div class="header-section left">
                <select id="acu-cam-list" class="md-select" style="display:none;"></select>
            </div>
            <div class="header-section right">
                <button id="acu-qr-cancel-btn" class="md-icon-btn md-error" aria-label="Close Scanner">
                    <svg viewBox="0 0 24 24">
                        <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </button>
            </div>
        </div>
        <div id="acu-qr-reader-container">
            <div id="acu-qr-reader"></div>
        </div>
        <div id="acu-qr-status">Initializing Camera...</div>
        <div id="acu-zoom-controls">
            <button class="acu-zoom-btn" data-zoom="1">1x</button>
            <button class="acu-zoom-btn" data-zoom="2">2x</button>
            <button class="acu-zoom-btn active" data-zoom="3">3x</button>
        </div>
    </div>
`;
document.body.insertAdjacentHTML('beforeend', modalHtml);

const overlay = document.getElementById('acu-qr-modal-overlay');
const cancelBtn = document.getElementById('acu-qr-cancel-btn');
const camList = document.getElementById('acu-cam-list');
const statusText = document.getElementById('acu-qr-status');

// Listen for commands from the secure bridge
window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === "EXT_START_SCAN") {
        const message = event.data.payload;
        currentInputId = message.inputId;
        currentKeys = message.keys;
        currentRequestingFrameId = message.requestingFrameId;
        openScannerModal();
    }
});

function openScannerModal() {
    overlay.style.display = 'flex'; 
    statusText.innerText = "Requesting camera access...";
    camList.style.display = 'none';
    
    setTimeout(() => {
        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("acu-qr-reader");
        }

        Html5Qrcode.getCameras().then(devices => {
            if (devices && devices.length) {
                camList.innerHTML = "";
                let bestBackCameraId = devices[0].id; 
                
                devices.forEach((dev, index) => {
                    let opt = document.createElement("option");
                    opt.value = dev.id;
                    opt.text = dev.label || "Camera " + (index + 1);
                    camList.appendChild(opt);
                    
                    const labelLower = opt.text.toLowerCase();
                    if (labelLower.includes("back") || labelLower.includes("environment") || labelLower.includes("rear")) {
                        bestBackCameraId = dev.id;
                    }
                });
                
                camList.value = bestBackCameraId;
                camList.style.display = 'block';
                
                statusText.innerText = "Warming up lens...";
                
                // THE FIX: Wait 800ms to allow the mobile hardware to fully 
                // release the camera after checking the labels.
                setTimeout(() => {
                    startScannerWithId(bestBackCameraId);
                }, 800);

            } else {
                statusText.innerText = "No cameras found.";
            }
        }).catch(err => {
            statusText.innerText = "Camera Error: " + err;
            console.error("Camera List Error:", err);
        });
    }, 300); 
}

camList.addEventListener('change', () => {
    statusText.innerText = "Switching lens...";
    camList.disabled = true;  
    
    // State-Safe Switching: Ensure the old stream is completely dead before starting the new one
    if (html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
            // Small timeout to allow hardware to fully release the lens
            setTimeout(() => {
                startScannerWithId(camList.value);
            }, 200);
        }).catch(err => {
            console.error("Stop error:", err);
            startScannerWithId(camList.value);
        });
    } else {
        startScannerWithId(camList.value);
    }
});

function startScannerWithId(camId) {
    statusText.innerText = "Starting hardware stream...";
    
    // 1. Check which zoom button is currently active (defaults to 3)
    const activeZoomBtn = document.querySelector('.acu-zoom-btn.active');
    const initialZoom = activeZoomBtn ? parseFloat(activeZoomBtn.dataset.zoom) : 3.0;
    
    html5QrCode.start(
        camId, 
        { 
            fps: 10, 
            // --- iOS/ORION FIX 1: Responsive Square Box ---
            // Calculates a perfect square taking up 65% of the screen width
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                const size = Math.floor(minEdge * 0.65); 
                return { width: size, height: size };
            },
            // --- iOS/ORION FIX 2: Removed "aspectRatio: 1.0" ---
            
            videoConstraints: {
                deviceId: { exact: camId },
                // --- iOS/ORION FIX 3: Removed hardcoded 1920/1080 ideals ---
                // iOS WebKit handles native mobile resolutions better without them.
                advanced: [
                    { focusMode: "continuous" },
                    { zoom: initialZoom } 
                ] 
            }
        },
        onScanSuccess,
        () => {} 
    ).then(() => {
        statusText.innerText = "Scanning Active. Point at QR.";
        camList.disabled = false;
        
        const videoElement = document.querySelector('#acu-qr-reader video');
        if (videoElement && videoElement.srcObject) {
            const track = videoElement.srcObject.getVideoTracks()[0];
            const capabilities = track.getCapabilities();
            
            if (capabilities.zoom) {
                document.getElementById('acu-zoom-controls').style.display = 'flex';
                
                setTimeout(() => {
                    const currentActiveBtn = document.querySelector('.acu-zoom-btn.active');
                    if (currentActiveBtn) {
                        currentActiveBtn.click(); 
                    }
                }, 500);
            } else {
                console.log("[AcuQR] Hardware zoom not supported on this device/browser. Hiding controls.");
            }
        }
        
    }).catch(err => {
        statusText.innerText = "Stream Error: " + err;
        camList.disabled = false;
    });
}

function onScanSuccess(decodedText) {
    // --- DEBUG ALERT 1 ---
    // alert("Step 1: Camera successfully read the QR! Data length: " + decodedText.length);
    
    statusText.innerText = "Success! Closing...";
    closeScannerModal(() => {
        window.postMessage({
            type: "PAGE_SCAN_RESULT",
            payload: {
                action: "SCAN_RESULT",
                result: decodedText,
                inputId: currentInputId,
                keys: currentKeys,
                requestingFrameId: currentRequestingFrameId
            }
        }, "*");
    });
}

function closeScannerModal(callback) {
    statusText.innerText = "Closing camera...";
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear(); // Clear the UI canvas
            overlay.style.display = 'none';
            if (callback) callback();
        }).catch(() => {
            overlay.style.display = 'none';
            if (callback) callback();
        });
    } else {
        overlay.style.display = 'none';
        if (callback) callback();
    }
}

cancelBtn.addEventListener('click', () => closeScannerModal());

// --- NATIVE HARDWARE ZOOM CONTROLS ---

const zoomButtons = document.querySelectorAll('.acu-zoom-btn');

zoomButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
        // 1. UI Update: Move the blue 'active' highlight to the clicked button
        zoomButtons.forEach(b => b.classList.remove('active'));
        const clickedBtn = e.target;
        clickedBtn.classList.add('active');

        // 2. Get the exact zoom value the user requested (1, 2, or 3)
        const zoomValue = parseFloat(clickedBtn.dataset.zoom);

        // 3. Dig into the DOM to find the active video track
        const videoElement = document.querySelector('#acu-qr-reader video');
        
        if (videoElement && videoElement.srcObject) {
            const track = videoElement.srcObject.getVideoTracks()[0];
            
            // 4. Safety Check: Verify the Kiwi/Chrome browser sees the hardware zoom capability
            const capabilities = track.getCapabilities();
            
            if (capabilities.zoom) {
                try {
                    // 5. THE MAGIC: Command the physical lens to shift instantly!
                    await track.applyConstraints({
                        advanced: [{ zoom: zoomValue }]
                    });
                    console.log(`Native lens shifted to ${zoomValue}x`);
                } catch (err) {
                    console.error("Hardware rejected the zoom command:", err);
                }
            } else {
                console.warn("Hardware zoom not supported on this specific lens/browser state.");
            }
        }
    });
});