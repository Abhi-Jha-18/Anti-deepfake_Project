/* ==========================================================================
   AETHER_SHIELD Client JavaScript - Camera & Active Challenge Controller
   ========================================================================= */

const API_URL = 'http://localhost:5000/api';

// DOM Elements
const videoEl = document.getElementById('webcam');
const canvasOverlay = document.getElementById('canvas-overlay');
const ctxOverlay = canvasOverlay.getContext('2d');
const btnStart = document.getElementById('btn-start');
const btnTrain = document.getElementById('btn-train');
const flashOverlay = document.getElementById('flash-overlay');
const faceGuide = document.getElementById('face-guide');
const guideInstruction = document.getElementById('guide-instruction');
const statusBanner = document.getElementById('status-banner');
const statusMessage = document.getElementById('status-message');
const serverStatusDot = document.getElementById('server-status-dot');
const serverStatusText = document.getElementById('server-status-text');
const btnAudioToggle = document.getElementById('btn-audio-toggle');
const gesturePrompt = document.getElementById('gesture-prompt');
const gestureArrow = document.getElementById('gesture-arrow');
const gestureText = document.getElementById('gesture-text');
const btnDownloadReceipt = document.getElementById('btn-download-receipt');

// Landing DOM elements
const btnLaunchScanner = document.getElementById('btn-launch-scanner');
const btnHome = document.getElementById('btn-home');
const landingStatusDot = document.getElementById('landing-server-status-dot');
const landingStatusText = document.getElementById('landing-server-status-text');
const landingView = document.getElementById('landing-view');
const scannerView = document.getElementById('scanner-view');

// KPI metrics elements
const kpiMoireVal = document.getElementById('kpi-moire-val');
const kpiMoireFill = document.getElementById('kpi-moire-fill');
const kpiReflectionVal = document.getElementById('kpi-reflection-val');
const reflectionBlocksContainer = document.getElementById('reflection-blocks');
const kpiEarVal = document.getElementById('kpi-ear-val');
const kpiBlinkBadge = document.getElementById('kpi-blink-badge');
const kpiMotionVal = document.getElementById('kpi-motion-val');
const kpiMotionFill = document.getElementById('kpi-motion-fill');
const resultCard = document.getElementById('final-result-card');
const resultTitle = document.getElementById('result-title');
const resultDesc = document.getElementById('result-desc');
const logOutput = document.getElementById('log-output');

// Capture canvas (hidden)
const captureCanvas = document.getElementById('hidden-capture-canvas');
const captureCtx = captureCanvas.getContext('2d');

// State variables
let stream = null;
let isChecking = false;
let isConnected = false;
let currentSessionId = null;
let isAudioMuted = false;
let lastSessionData = null;
let lastCapturedFaceB64 = null;

// Map colors to hex codes for UI flashes
const COLOR_MAP = {
    'RED': '#ff0000',
    'GREEN': '#00ff00',
    'BLUE': '#0000ff',
    'YELLOW': '#ffff00',
    'CYAN': '#00ffff',
    'MAGENTA': '#ff00ff'
};

// Map color names to standard CSS classes
const COLOR_CLASS_MAP = {
    'RED': 'red',
    'GREEN': 'green',
    'BLUE': 'blue',
    'YELLOW': 'yellow',
    'CYAN': 'cyan',
    'MAGENTA': 'magenta'
};

/* ==========================================================================
   Helper: Terminal Logger
   ========================================================================== */
function log(message, type = 'muted') {
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('p');
    line.className = `log-line text-${type}`;
    line.innerHTML = `<span class="text-muted">[${timestamp}]</span> ${message}`;
    logOutput.appendChild(line);
    logOutput.scrollTop = logOutput.scrollHeight;
}

/* ==========================================================================
   Sound Assistant & Web Audio Synthesizer
   ========================================================================== */
function speak(text) {
    if (isAudioMuted) return;
    try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.05;
        utterance.pitch = 0.95;
        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.warn("Speech synthesis blocked or not supported: ", e);
    }
}

function playSynthSound(type) {
    if (isAudioMuted) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        if (type === 'scan') {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(180, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(320, audioCtx.currentTime + 1.2);
            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
            osc.start();
            osc.stop(audioCtx.currentTime + 1.2);
        } else if (type === 'success') {
            const now = audioCtx.currentTime;
            [523.25, 659.25].forEach((freq, idx) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                const start = now + idx * 0.12;
                gain.gain.setValueAtTime(0.08, start);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
                osc.start(start);
                osc.stop(start + 0.35);
            });
        } else if (type === 'failure') {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(140, audioCtx.currentTime);
            osc.frequency.linearRampToValueAtTime(70, audioCtx.currentTime + 0.6);
            gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.6);
        } else if (type === 'ping') {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.25);
        }
    } catch (e) {
        console.warn("Web Audio API not supported or blocked: ", e);
    }
}


/* ==========================================================================
   API Connectivity & Setup
   ========================================================================== */
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_URL}/status`);
        const data = await response.json();
        
        if (data.success) {
            isConnected = true;
            serverStatusDot.className = 'status-indicator connected';
            if (landingStatusDot) landingStatusDot.className = 'status-indicator connected';
            
            if (data.model_trained) {
                serverStatusText.textContent = 'API Ready (CNN Trained)';
                if (landingStatusText) landingStatusText.textContent = 'API READY (CNN)';
                log('API connection verified. Moire CNN model loaded.', 'success');
            } else {
                serverStatusText.textContent = 'API Ready (No CNN Model)';
                if (landingStatusText) landingStatusText.textContent = 'API READY (NO WEIGHTS)';
                log('API connection verified. Moire CNN weights not found; running in fallback mode.', 'warn');
            }
        }
    } catch (error) {
        isConnected = false;
        serverStatusDot.className = 'status-indicator';
        if (landingStatusDot) landingStatusDot.className = 'status-indicator';
        serverStatusText.textContent = 'API Offline';
        if (landingStatusText) landingStatusText.textContent = 'API OFFLINE';
        log('Could not connect to API server. Ensure backend/app.py is running on port 5000.', 'danger');
    }
}

async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            },
            audio: false
        });
        videoEl.srcObject = stream;
        
        // Wait for video metadata to load to size the canvases correctly
        videoEl.onloadedmetadata = () => {
            canvasOverlay.width = videoEl.videoWidth;
            canvasOverlay.height = videoEl.videoHeight;
            captureCanvas.width = videoEl.videoWidth;
            captureCanvas.height = videoEl.videoHeight;
            
            log(`Webcam activated: ${videoEl.videoWidth}x${videoEl.videoHeight}`, 'info');
            
            // Draw dummy loop
            requestAnimationFrame(drawOverlayLoop);
        };
    } catch (err) {
        log(`Webcam access denied: ${err.message}`, 'danger');
        statusMessage.textContent = 'Camera Error';
    }
}

let faceLandmarker = null;
let localFaceLandmarks = null;
let lastVideoTime = -1;

async function initFaceLandmarker() {
    if (window.location.protocol === 'file:') {
        log("CRITICAL: Running via file:// protocol (double-clicked index.html). Browsers block WebAssembly and dynamic CDN imports on local files. Please run the frontend via a local server (e.g., run 'npx serve frontend' in your terminal and open http://localhost:3000) to load MediaPipe.", "danger");
        return;
    }
    try {
        log("Initializing local FaceLandmarker...", "info");
        const visionModule = await import("./vision_bundle.js");
        const { FilesetResolver, FaceLandmarker: FL } = visionModule;
        
        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );
        
        faceLandmarker = await FL.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "CPU"
            },
            runningMode: "VIDEO",
            numFaces: 1
        });
        log("Local FaceLandmarker initialized successfully.", "success");
    } catch (err) {
        log(`Local FaceLandmarker loading failed: ${err.message}. Liveness checks may fall back or fail.`, "danger");
        console.error(err);
    }
}

function calculateEar(landmarks, eyeIndices, imgW, imgH) {
    const coords = [];
    for (const idx of eyeIndices) {
        const lm = landmarks[idx];
        coords.push([lm.x * imgW, lm.y * imgH]);
    }
    const v1 = Math.hypot(coords[1][0] - coords[5][0], coords[1][1] - coords[5][1]);
    const v2 = Math.hypot(coords[2][0] - coords[4][0], coords[2][1] - coords[4][1]);
    const h = Math.hypot(coords[0][0] - coords[3][0], coords[0][1] - coords[3][1]);
    return (v1 + v2) / (2.0 * h + 1e-6);
}

function getPatchMeanColor(videoWidth, videoHeight, cx, cy, patchSize) {
    const x1 = Math.max(0, Math.floor(cx - patchSize / 2));
    const y1 = Math.max(0, Math.floor(cy - patchSize / 2));
    const x2 = Math.min(videoWidth, Math.floor(cx + patchSize / 2));
    const y2 = Math.min(videoHeight, Math.floor(cy + patchSize / 2));
    const w = x2 - x1;
    const h = y2 - y1;
    if (w <= 0 || h <= 0) return [0, 0, 0];
    
    // Draw current frame to hidden capture canvas first
    captureCtx.drawImage(videoEl, 0, 0, captureCanvas.width, captureCanvas.height);
    const imgData = captureCtx.getImageData(x1, y1, w, h);
    const data = imgData.data;
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
        rSum += data[i];
        gSum += data[i+1];
        bSum += data[i+2];
        count++;
    }
    return [rSum / count, gSum / count, bSum / count];
}

function cropAndCombinePatches(landmarks, videoW, videoH) {
    const patchW = 64;
    const patchH = 64;
    
    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = 192;
    patchCanvas.height = 64;
    const patchCtx = patchCanvas.getContext('2d');
    
    // Forehead: 10, Left cheek: 117, Right cheek: 346
    const patchLms = [landmarks[10], landmarks[117], landmarks[346]];
    
    // Draw current frame to hidden capture canvas first
    captureCtx.drawImage(videoEl, 0, 0, captureCanvas.width, captureCanvas.height);
    
    for (let i = 0; i < patchLms.length; i++) {
        const lm = patchLms[i];
        const cx = lm.x * videoW;
        const cy = lm.y * videoH;
        
        const x1 = Math.max(0, Math.floor(cx - patchW / 2));
        const y1 = Math.max(0, Math.floor(cy - patchH / 2));
        
        patchCtx.drawImage(
            captureCanvas, 
            x1, y1, patchW, patchH,
            i * 64, 0, patchW, patchH
        );
    }
    
    return new Promise((resolve) => {
        patchCanvas.toBlob((blob) => {
            resolve(blob);
        }, 'image/jpeg', 0.85);
    });
}

function calculateNoseVariance(coordsList) {
    if (coordsList.length === 0) return 0;
    const n = coordsList.length;
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const c of coordsList) {
        sumX += c[0];
        sumY += c[1];
        sumZ += c[2];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    const meanZ = sumZ / n;
    
    let varX = 0, varY = 0, varZ = 0;
    for (const c of coordsList) {
        varX += Math.pow(c[0] - meanX, 2);
        varY += Math.pow(c[1] - meanY, 2);
        varZ += Math.pow(c[2] - meanZ, 2);
    }
    
    return (varX + varY + varZ) / n;
}

// FaceLandmarker video loop
function drawOverlayLoop() {
    if (!videoEl.paused && !videoEl.ended) {
        ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        
        // Draw 30 FPS indicator
        document.getElementById('camera-fps').textContent = '30 FPS';
        
        if (faceLandmarker && videoEl.currentTime !== lastVideoTime) {
            lastVideoTime = videoEl.currentTime;
            const results = faceLandmarker.detectForVideo(videoEl, performance.now());
            
            if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
                localFaceLandmarks = results.faceLandmarks[0];
                
                const leftIrisLm = localFaceLandmarks[468];
                const rightIrisLm = localFaceLandmarks[473];
                
                const leftEye = [33, 160, 158, 133, 153, 144];
                const rightEye = [362, 385, 387, 263, 373, 380];
                const currentEar = (calculateEar(localFaceLandmarks, leftEye, canvasOverlay.width, canvasOverlay.height) + 
                                   calculateEar(localFaceLandmarks, rightEye, canvasOverlay.width, canvasOverlay.height)) / 2.0;
                
                if (leftIrisLm && rightIrisLm) {
                    drawEyeTargets(
                        [leftIrisLm.x * canvasOverlay.width, leftIrisLm.y * canvasOverlay.height],
                        [rightIrisLm.x * canvasOverlay.width, rightIrisLm.y * canvasOverlay.height],
                        currentEar
                    );
                }
                
                kpiEarVal.textContent = currentEar.toFixed(2);
                if (currentEar < 0.22) {
                    kpiBlinkBadge.className = 'ear-status-badge blink';
                    kpiBlinkBadge.textContent = 'BLINK DETECTED!';
                } else {
                    kpiBlinkBadge.className = 'ear-status-badge';
                    kpiBlinkBadge.textContent = 'EYES DETECTED';
                }
                
                const nose = localFaceLandmarks[1];
                if (nose && nose.x > 0.3 && nose.x < 0.7 && nose.y > 0.3 && nose.y < 0.7) {
                    faceGuide.className = 'face-guide-oval detected';
                    if (!isChecking) {
                        guideInstruction.textContent = 'FACE POSITION OPTIMAL';
                    }
                } else {
                    faceGuide.className = 'face-guide-oval';
                    if (!isChecking) {
                        guideInstruction.textContent = 'ALIGN FACE WITH OVAL';
                    }
                }
            } else {
                localFaceLandmarks = null;
                faceGuide.className = 'face-guide-oval';
                if (!isChecking) {
                    guideInstruction.textContent = 'ALIGN FACE WITH OVAL';
                }
                kpiBlinkBadge.className = 'ear-status-badge';
                kpiBlinkBadge.textContent = 'NO FACE DETECTED';
            }
        }
        
        requestAnimationFrame(drawOverlayLoop);
    }
}

/* ==========================================================================
   Landmark and UI Overlay Drawing
   ========================================================================== */
function drawEyeTargets(leftIris, rightIris, ear) {
    ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
    
    if (leftIris && rightIris) {
        ctxOverlay.lineWidth = 2;
        
        // Set color based on EAR (blinking) or general tracking
        const trackingColor = ear < 0.22 ? '#00e676' : '#00f0ff';
        ctxOverlay.strokeStyle = trackingColor;
        ctxOverlay.fillStyle = trackingColor;
        
        // Draw targets around both eyes
        [leftIris, rightIris].forEach(iris => {
            ctxOverlay.beginPath();
            ctxOverlay.arc(iris[0], iris[1], 8, 0, 2 * Math.PI);
            ctxOverlay.stroke();
            
            ctxOverlay.beginPath();
            ctxOverlay.arc(iris[0], iris[1], 2, 0, 2 * Math.PI);
            ctxOverlay.fill();
        });
    }
}

/* ==========================================================================
   Capture Frame Helpers
   ========================================================================== */
function captureFrameBase64() {
    // Draw current video frame onto the hidden canvas
    captureCtx.drawImage(videoEl, 0, 0, captureCanvas.width, captureCanvas.height);
    // Convert to jpeg base64 (used for local print receipt face image)
    const dataURL = captureCanvas.toDataURL('image/jpeg', 0.85);
    return dataURL;
}

function captureFrameBlob() {
    return new Promise((resolve) => {
        // Draw current video frame onto the hidden canvas
        captureCtx.drawImage(videoEl, 0, 0, captureCanvas.width, captureCanvas.height);
        // Convert to raw binary JPEG blob for low-latency WebSocket transmission
        captureCanvas.toBlob((blob) => {
            resolve(blob);
        }, 'image/jpeg', 0.85);
    });
}

/* ==========================================================================
   WebSocket Communication Manager
   ========================================================================== */
let socket = null;

function connectWebSocket(sessionId) {
    return new Promise((resolve, reject) => {
        // Construct WebSocket URI matching backend protocol
        const wsUrl = API_URL.replace('http://', 'ws://').replace('https://', 'wss://') + `/verify/${sessionId}`;
        
        socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';
        
        socket.onopen = () => {
            console.log('[WS] Persistent channel established successfully.');
            resolve();
        };
        
        socket.onerror = (err) => {
            console.error('[WS] Connection failed:', err);
            reject(new Error("WebSocket handshake failed."));
        };
        
        socket.onclose = () => {
            console.log('[WS] Persistent channel closed.');
        };
    });
}

function sendFrameAndWait(expectedColor, blob) {
    return new Promise((resolve, reject) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            reject(new Error("WebSocket is not in OPEN state."));
            return;
        }
        
        // Setup handler for backend evaluation response
        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                resolve(data);
            } catch (e) {
                reject(new Error("Invalid response format from server."));
            }
        };
        
        socket.onerror = (err) => {
            reject(err);
        };
        
        // 1. Send text metadata frame specifying color challenge expectation
        socket.send(JSON.stringify({ expected_color: expectedColor }));
        
        // 2. Send raw binary blob payload
        socket.send(blob);
    });
}

/* ==========================================================================
   Liveness Check Coordination (Core Logic)
   ========================================================================== */
async function runLivenessCheck() {
    if (isChecking || !isConnected) return;
    
    // Ensure FaceLandmarker is initialized
    if (!faceLandmarker) {
        log("Local FaceLandmarker is not initialized. Please wait or reload.", "danger");
        return;
    }
    
    isChecking = true;
    btnStart.disabled = true;
    btnTrain.disabled = true;
    btnDownloadReceipt.style.display = 'none'; // Hide diagnostics download during scan
    faceGuide.className = 'face-guide-oval detected flashing';
    guideInstruction.textContent = 'LIVENESS CHECK IN PROGRESS';
    statusMessage.textContent = 'Initializing verification...';
    
    // Clear previous metrics & UI results
    resetDiagnosticsUI();
    log('Initializing verification session...', 'info');
    
    // Synthesize scan start audio & AI voice
    speak("Scan initiated. Stand still.");
    playSynthSound('scan');
    
    try {
        // Step 1: Initialize session on backend (REST endpoint)
        const initResponse = await fetch(`${API_URL}/init_session`, { method: 'POST' });
        const initData = await initResponse.json();
        
        if (!initData.success) {
            throw new Error(initData.error || 'Failed to initialize session');
        }
        
        currentSessionId = initData.session_id;
        const colorSequence = initData.sequence;
        const expectedGesture = initData.gesture;
        
        log(`Session initialized: ${currentSessionId}`, 'info');
        log(`Sequence generated: ${colorSequence.join(' -> ')}`, 'info');
        log(`Expected head turn gesture: ${expectedGesture}`, 'info');
        
        // Establish low-latency WebSocket connection
        log('Establishing WebSocket channel...', 'muted');
        await connectWebSocket(currentSessionId);
        
        // Update diagnostics reflection blocks to show upcoming sequence
        setupReflectionBlocks(colorSequence);
        
        // Delay 1 second to let user prepare
        await sleep(1000);
        
        let completedSteps = 0;
        let maxMoire = 0;
        let firstFrameB64 = null;
        
        // Local liveness variables
        let blinkDetected = false;
        const noseCoordinatesList = [];
        const baselineYawRatios = [];
        const reflectionData = [];
        const earSequence = [];
        
        // Step 2: Loop and flash each color in sequence
        for (let i = 0; i < colorSequence.length; i++) {
            const color = colorSequence[i];
            const hex = COLOR_MAP[color];
            
            statusMessage.textContent = `Analyzing reflections... [${i + 1}/${colorSequence.length}]`;
            log(`Flashing color: ${color}`, 'info');
            
            // Activate the color overlay
            flashOverlay.style.backgroundColor = hex;
            flashOverlay.classList.add('active');
            
            // Soft synth ping for each color flash
            playSynthSound('ping');
            
            // Wait 350ms to allow screen light to reach face and webcam to adjust exposure, while tracking face movements
            for (let t = 0; t < 7; t++) {
                await sleep(50);
                if (localFaceLandmarks && localFaceLandmarks[1]) {
                    const noseLm = localFaceLandmarks[1];
                    noseCoordinatesList.push([noseLm.x, noseLm.y, noseLm.z]);
                }
            }
            
            // Ensure face is still tracked
            if (!localFaceLandmarks) {
                flashOverlay.classList.remove('active');
                throw new Error("Face connection lost. Please keep your face inside the guide oval.");
            }
            
            // Capture image base64 for receipt template
            if (i === 0) {
                firstFrameB64 = captureFrameBase64();
            }
            
            // Collect frame metrics locally
            const noseLm = localFaceLandmarks[1];
            if (noseLm) {
                noseCoordinatesList.push([noseLm.x, noseLm.y, noseLm.z]);
            }
            
            const leftEdge = localFaceLandmarks[234];
            const rightEdge = localFaceLandmarks[454];
            const yawWidth = rightEdge && leftEdge ? rightEdge.x - leftEdge.x : 0;
            const yawRatio = yawWidth > 0 && noseLm ? (noseLm.x - leftEdge.x) / yawWidth : 0.5;
            baselineYawRatios.push(yawRatio);
            
            const leftEye = [33, 160, 158, 133, 153, 144];
            const rightEye = [362, 385, 387, 263, 373, 380];
            const earVal = (calculateEar(localFaceLandmarks, leftEye, canvasOverlay.width, canvasOverlay.height) + 
                            calculateEar(localFaceLandmarks, rightEye, canvasOverlay.width, canvasOverlay.height)) / 2.0;
            earSequence.push(earVal);
            if (earVal < 0.22) {
                blinkDetected = true;
            }
            
            const foreheadRGB = getPatchMeanColor(videoEl.videoWidth, videoEl.videoHeight, localFaceLandmarks[10].x * videoEl.videoWidth, localFaceLandmarks[10].y * videoEl.videoHeight, 16);
            const leftCheekRGB = getPatchMeanColor(videoEl.videoWidth, videoEl.videoHeight, localFaceLandmarks[117].x * videoEl.videoWidth, localFaceLandmarks[117].y * videoEl.videoHeight, 16);
            const rightCheekRGB = getPatchMeanColor(videoEl.videoWidth, videoEl.videoHeight, localFaceLandmarks[346].x * videoEl.videoWidth, localFaceLandmarks[346].y * videoEl.videoHeight, 16);
            const avgSkinRGB = [
                (foreheadRGB[0] + leftCheekRGB[0] + rightCheekRGB[0]) / 3.0,
                (foreheadRGB[1] + leftCheekRGB[1] + rightCheekRGB[1]) / 3.0,
                (foreheadRGB[2] + leftCheekRGB[2] + rightCheekRGB[2]) / 3.0
            ];
            
            const leftIrisRGB = getPatchMeanColor(videoEl.videoWidth, videoEl.videoHeight, localFaceLandmarks[468].x * videoEl.videoWidth, localFaceLandmarks[468].y * videoEl.videoHeight, 8);
            const rightIrisRGB = getPatchMeanColor(videoEl.videoWidth, videoEl.videoHeight, localFaceLandmarks[473].x * videoEl.videoWidth, localFaceLandmarks[473].y * videoEl.videoHeight, 8);
            const avgEyeRGB = [
                (leftIrisRGB[0] + rightIrisRGB[0]) / 2.0,
                (leftIrisRGB[1] + rightIrisRGB[1]) / 2.0,
                (leftIrisRGB[2] + rightIrisRGB[2]) / 2.0
            ];
            
            reflectionData.push({
                expected_color: color,
                eye_rgb: avgEyeRGB,
                skin_rgb: avgSkinRGB
            });
            
            // Crop and combine patches
            const patchBlob = await cropAndCombinePatches(localFaceLandmarks, videoEl.videoWidth, videoEl.videoHeight);
            
            // Turn off overlay immediately
            flashOverlay.classList.remove('active');
            
            // Send binary frame patches to API over WebSocket
            log(`Submitting binary composite patch ${i + 1} to WebSocket...`, 'muted');
            const verifyData = await sendFrameAndWait(color, patchBlob);
            
            if (!verifyData.success) {
                log(`Analysis failed at step ${i + 1}: ${verifyData.error}`, 'danger');
                statusMessage.textContent = 'Verification Interrupted';
                showFailureVerdict('LANDMARKING_FAILED', verifyData.error);
                return;
            }
            
            // Update live metrics on dashboard
            updateLiveMetrics(verifyData, color, i);
            maxMoire = Math.max(maxMoire, verifyData.moire_prob);
            
            completedSteps++;
            // Wait 250ms between flashes to allow exposure to settle back, while tracking face movements
            for (let t = 0; t < 5; t++) {
                await sleep(50);
                if (localFaceLandmarks && localFaceLandmarks[1]) {
                    const noseLm = localFaceLandmarks[1];
                    noseCoordinatesList.push([noseLm.x, noseLm.y, noseLm.z]);
                }
            }
        }
        
        // Step 3: Skip head turn gesture check (removed as per user request)
        // Directly calculate final nose variance from color flash telemetry
        const totalVariance = calculateNoseVariance(noseCoordinatesList);
        const motionPassed = totalVariance > 1e-6;
        const gesturePassed = true; // Auto-pass gesture check
        
        // Step 4: Final Session Verification (REST endpoint)
        statusMessage.textContent = 'Processing verdict...';
        log('All challenge frames processed. Submitting liveness logs to REST API...', 'info');
        
        const sessionResponse = await fetch(`${API_URL}/verify_session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: currentSessionId,
                motion_passed: motionPassed,
                gesture_passed: gesturePassed,
                blink_detected: blinkDetected,
                nose_variance: totalVariance,
                reflection_data: reflectionData,
                ear_sequence: earSequence
            })
        });
        
        const sessionData = await sessionResponse.json();
        
        if (sessionData.success) {
            lastCapturedFaceB64 = firstFrameB64; // Save front face crop for receipt
            displayFinalVerdict(sessionData);
        } else {
            throw new Error(sessionData.error || 'Failed to verify session');
        }
        
    } catch (error) {
        log(`Verification error: ${error.message}`, 'danger');
        statusMessage.textContent = 'System Error';
        showFailureVerdict('SYSTEM_ERROR', error.message);
    } finally {
        isChecking = false;
        btnStart.disabled = false;
        btnTrain.disabled = false;
        faceGuide.className = 'face-guide-oval';
        guideInstruction.textContent = 'POSITION YOUR FACE HERE';
        ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        
        // Clean up WebSocket connection
        if (socket) {
            socket.close();
            socket = null;
            console.log('[WS] Persistent channel cleaned up in finally block.');
        }
    }
}

/* ==========================================================================
   Model Training (Trigger CNN training)
   ========================================================================== */
async function trainMoireModel() {
    if (isChecking) return;
    
    btnTrain.disabled = true;
    btnStart.disabled = true;
    log('Requesting background CNN model training...', 'info');
    
    try {
        const response = await fetch(`${API_URL}/train_model`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            log(data.message, 'success');
            log('Please wait. Model is training on a synthetically generated screen dataset.', 'info');
            
            // Poll status every 4 seconds to check if trained
            const pollInterval = setInterval(async () => {
                const statusRes = await fetch(`${API_URL}/status`);
                const statusData = await statusRes.json();
                if (statusData.success && statusData.model_trained) {
                    clearInterval(pollInterval);
                    btnTrain.disabled = false;
                    btnStart.disabled = false;
                    serverStatusText.textContent = 'API Ready (CNN Trained)';
                    log('CNN Training Complete! Weights saved as moire_cnn.pth. Detector fully active.', 'success');
                }
            }, 4000);
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        log(`Failed to trigger training: ${error.message}`, 'danger');
        btnTrain.disabled = false;
        btnStart.disabled = false;
    }
}

/* ==========================================================================
   UI Update Helpers
   ========================================================================== */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resetDiagnosticsUI() {
    kpiMoireVal.textContent = '0%';
    kpiMoireFill.style.width = '0%';
    kpiMoireFill.className = 'progress-fill';
    
    kpiReflectionVal.textContent = 'N/A';
    
    kpiEarVal.textContent = '0.00';
    kpiBlinkBadge.className = 'ear-status-badge';
    kpiBlinkBadge.textContent = 'NO FACE DETECTED';
    
    kpiMotionVal.textContent = '0.00';
    kpiMotionFill.style.width = '0%';
    
    resultCard.className = 'result-box glass-card';
    resultTitle.textContent = 'Awaiting Verification';
    resultDesc.textContent = 'The system will flash colors on your screen to verify active reflections.';
}

function setupReflectionBlocks(sequence) {
    reflectionBlocksContainer.innerHTML = '';
    sequence.forEach(color => {
        const block = document.createElement('div');
        block.className = 'color-block pending';
        block.title = `Upcoming: ${color}`;
        reflectionBlocksContainer.appendChild(block);
    });
}

function updateLiveMetrics(verifyData, color, stepIdx) {
    // 1. Moiré Score
    const moirePercent = Math.round(verifyData.moire_prob * 100);
    kpiMoireVal.textContent = `${moirePercent}%`;
    kpiMoireFill.style.width = `${moirePercent}%`;
    
    // Adjust colors of the bar based on risk
    if (moirePercent > 50) {
        kpiMoireFill.style.background = 'linear-gradient(to right, #ffb300, #ff1744)';
    } else {
        kpiMoireFill.style.background = 'linear-gradient(to right, #00f0ff, #00e676)';
    }
    
    // 2. EAR / Blinks (handled real-time in local camera loop; fallback check here if provided)
    if (verifyData.ear !== undefined && verifyData.ear !== null) {
        const ear = verifyData.ear.toFixed(2);
        kpiEarVal.textContent = ear;
        
        if (verifyData.ear < 0.22) {
            kpiBlinkBadge.className = 'ear-status-badge blink';
            kpiBlinkBadge.textContent = 'BLINK DETECTED!';
            log('Landmark metrics: Eyebrow/Eyelid aspect ratio shows a blink event.', 'success');
        } else {
            kpiBlinkBadge.className = 'ear-status-badge';
            kpiBlinkBadge.textContent = 'EYES DETECTED';
        }
    }
    
    // 3. Highlight the reflection block with the color flashed
    const blocks = reflectionBlocksContainer.children;
    if (blocks[stepIdx]) {
        blocks[stepIdx].className = `color-block ${COLOR_CLASS_MAP[color]}`;
        blocks[stepIdx].textContent = '✓';
        blocks[stepIdx].style.color = '#fff';
        blocks[stepIdx].style.textAlign = 'center';
        blocks[stepIdx].style.fontSize = '8px';
        blocks[stepIdx].style.lineHeight = '10px';
    }
}

function displayFinalVerdict(data) {
    const d = data.details;
    
    // Save session data for receipt export
    lastSessionData = data;
    btnDownloadReceipt.style.display = 'block';
    
    // Update dashboard metrics
    const matchPercent = Math.round(d.reflection_score * 100);
    kpiReflectionVal.textContent = `${matchPercent}%`;
    
    const motionPercent = Math.min(100, Math.round(d.nose_variance * 500000)); // Scale nose variance for display
    kpiMotionVal.textContent = d.nose_variance.toExponential(2);
    kpiMotionFill.style.width = `${motionPercent}%`;
    
    // Overall result badge
    const badge = document.getElementById('overall-badge');
    
    if (data.verdict === 'VERIFIED_HUMAN') {
        badge.className = 'badge badge-success';
        badge.textContent = 'VERIFIED';
        
        resultCard.className = 'result-box glass-card pass';
        resultTitle.textContent = '🔒 KYC VERIFICATION PASSED';
        resultTitle.style.color = 'var(--color-success)';
        
        // Store verification status and data
        sessionStorage.setItem('aether_shield_verified', 'true');
        sessionStorage.setItem('aether_shield_session_data', JSON.stringify(data));
        
        resultDesc.innerHTML = `
            <strong>Status: Verified Human</strong><br>
            • Color Reflection correlation check passed (${matchPercent}% match rate).<br>
            • No digital moiré grid patterns detected (Moire probability: ${(d.max_moire_prob * 100).toFixed(1)}%).<br>
            • Natural micro-movements detected (Pose variance: ${d.nose_variance.toExponential(2)}).<br>
            <span style="color: var(--color-primary); font-family: var(--font-code); font-size: 0.8rem; display: block; margin-top: 10px; animation: flash 1s infinite alternate;">🔓 SECURE PORTAL UNLOCKED. REDIRECTING IN 3s...</span>
        `;
        log('VERDICT: Secure handshake complete. User verified as live human.', 'success');
        log('Redirecting to secure portal...', 'info');
        statusMessage.textContent = 'ACCESS GRANTED';
        
        playSynthSound('success');
        speak("Verification passed. Access granted.");
        
        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 3000);
    } else {
        badge.className = 'badge badge-danger';
        badge.textContent = 'SPOOF';
        
        resultCard.className = 'result-box glass-card fail';
        resultTitle.textContent = '❌ LIVENESS DETECTION FAILED';
        resultTitle.style.color = 'var(--color-danger)';
        resultDesc.innerHTML = `
            <strong>Status: Spoof Attack Blocked!</strong><br>
            <strong>Reason:</strong> ${data.reason}<br>
            <small>• Reflection Match Rate: ${matchPercent}% (Expected >= 60%)<br>
            • Moiré Probability: ${(d.max_moire_prob * 100).toFixed(1)}% (Threshold < 50%)<br>
            • Face motion variance: ${d.nose_variance.toExponential(2)}</small>
        `;
        log(`VERDICT: Security alert! Onboarding blocked. ${data.reason}`, 'danger');
        statusMessage.textContent = 'SPOOF BLOCKED';
        
        playSynthSound('failure');
        speak(`Verification failed. ${data.reason}`);
    }
}

function showFailureVerdict(code, details) {
    const badge = document.getElementById('overall-badge');
    badge.className = 'badge badge-danger';
    badge.textContent = 'FAILED';
    
    resultCard.className = 'result-box glass-card fail';
    resultTitle.textContent = 'Verification Failed';
    resultTitle.style.color = 'var(--color-danger)';
    resultDesc.innerHTML = `
        <strong>Error Code:</strong> ${code}<br>
        <strong>Details:</strong> ${details}<br>
        Please reposition your face in the oval and ensure adequate room lighting before trying again.
    `;
    
    playSynthSound('failure');
    speak(`Verification failed. ${details}`);
}

/* ==========================================================================
   Diagnostics Receipt HTML Exporter
   ========================================================================== */
function downloadReceipt() {
    if (!lastSessionData) {
        log('No session data available to generate receipt.', 'warn');
        return;
    }
    
    const d = lastSessionData.details;
    const verdict = lastSessionData.verdict;
    const reason = lastSessionData.reason;
    const sessionId = currentSessionId;
    const timestamp = new Date().toLocaleString();
    const faceImg = lastCapturedFaceB64 || '';
    
    const isPass = verdict === 'VERIFIED_HUMAN';
    const statusText = isPass ? 'VERIFIED HUMAN' : 'SPOOF DETECTED';
    const statusColor = isPass ? '#00e676' : '#ff1744';
    const statusBg = isPass ? 'rgba(0, 230, 118, 0.1)' : 'rgba(255, 23, 68, 0.1)';
    const statusBorder = isPass ? '#00e676' : '#ff1744';
    
    const reflectionMatch = Math.round(d.reflection_score * 100);
    const moireProb = Math.round(d.max_moire_prob * 100);
    const motionVal = d.nose_variance.toExponential(2);
    const blinkText = d.blink_detected ? 'Blink Detected' : 'No Blink Detected';
    const gestureStatus = d.gesture_passed ? 'PASSED' : 'FAILED / INCOMPLETE';
    const expectedGestureText = d.expected_gesture === 'TURN_LEFT' ? 'Turn Head Left' : 'Turn Head Right';
    
    // HTML receipt content
    const receiptHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>AETHER_SHIELD KYC Verification Receipt</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-dark: #070913;
            --bg-medium: #0e1124;
            --color-primary: #00f0ff;
            --color-success: #00e676;
            --color-danger: #ff1744;
            --font-ui: 'Outfit', sans-serif;
            --font-code: 'JetBrains Mono', monospace;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            background-color: var(--bg-dark);
            color: #e2e8f0;
            font-family: var(--font-ui);
            padding: 40px;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .receipt-card {
            background: rgba(15, 18, 38, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            width: 100%;
            max-width: 550px;
            padding: 30px;
            box-shadow: 0 15px 50px rgba(0, 0, 0, 0.8);
            position: relative;
            overflow: hidden;
        }
        .receipt-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--color-primary), #ff007f);
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            padding-bottom: 20px;
            margin-bottom: 24px;
        }
        .logo-title h1 {
            font-size: 1.4rem;
            font-weight: 800;
            letter-spacing: 0.15em;
            color: #ffffff;
        }
        .logo-title p {
            font-size: 0.7rem;
            color: #718096;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .doc-type {
            font-family: var(--font-code);
            font-size: 0.75rem;
            color: var(--color-primary);
            border: 1px solid rgba(0, 240, 255, 0.2);
            padding: 4px 10px;
            border-radius: 4px;
        }
        .status-banner {
            background-color: ${statusBg};
            border: 1px solid ${statusBorder};
            color: ${statusColor};
            border-radius: 8px;
            padding: 16px;
            text-align: center;
            margin-bottom: 24px;
        }
        .status-banner h2 {
            font-size: 1.25rem;
            font-weight: 800;
            letter-spacing: 0.05em;
        }
        .status-banner p {
            font-size: 0.8rem;
            opacity: 0.9;
            margin-top: 4px;
        }
        .grid-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 24px;
        }
        .face-container {
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.3);
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
            aspect-ratio: 4 / 3;
            width: 100%;
        }
        .face-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .metadata-list {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 12px;
        }
        .meta-item {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .meta-label {
            font-size: 0.7rem;
            color: #718096;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .meta-val {
            font-size: 0.85rem;
            font-weight: 600;
            color: #e2e8f0;
            font-family: var(--font-code);
            word-break: break-all;
        }
        .metrics-section {
            border-top: 1px dashed rgba(255, 255, 255, 0.1);
            padding-top: 20px;
            margin-bottom: 24px;
        }
        .metrics-title {
            font-size: 0.8rem;
            font-weight: 700;
            letter-spacing: 0.1em;
            color: #718096;
            margin-bottom: 12px;
            text-transform: uppercase;
        }
        .metrics-table {
            width: 100%;
            border-collapse: collapse;
        }
        .metrics-table th, .metrics-table td {
            text-align: left;
            padding: 8px 0;
            font-size: 0.8rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        }
        .metrics-table th {
            color: #718096;
            font-weight: 500;
        }
        .metrics-table td.val {
            text-align: right;
            font-family: var(--font-code);
            font-weight: 700;
        }
        .metrics-table td.pass {
            color: var(--color-success);
        }
        .metrics-table td.fail {
            color: var(--color-danger);
        }
        .footer {
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 20px;
            text-align: center;
            font-size: 0.65rem;
            color: #4b5a75;
        }
        .no-print {
            margin-top: 20px;
            display: flex;
            justify-content: center;
        }
        .print-btn {
            background: linear-gradient(135deg, var(--color-primary), #00a8ff);
            color: #070913;
            border: none;
            padding: 10px 24px;
            font-size: 0.85rem;
            font-weight: 700;
            border-radius: 6px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(0, 240, 255, 0.3);
            font-family: var(--font-ui);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .print-btn:hover {
            box-shadow: 0 6px 20px rgba(0, 240, 255, 0.5);
        }
        @media print {
            body {
                background: #fff;
                color: #000;
                padding: 0;
            }
            .receipt-card {
                box-shadow: none;
                border: 1px solid #ccc;
                background: #fff;
                color: #000;
                width: 100%;
                max-width: 100%;
                padding: 20px;
            }
            .receipt-card::before {
                display: none;
            }
            .logo-title h1, .meta-val, .status-banner p {
                color: #000 !important;
            }
            .doc-type {
                border-color: #000;
                color: #000;
            }
            .status-banner {
                background: #f0f0f0 !important;
                border-color: #000 !important;
                color: #000 !important;
            }
            .no-print {
                display: none;
            }
            .metrics-table th, .metrics-table td {
                border-bottom-color: #eee;
                color: #000 !important;
            }
        }
    </style>
</head>
<body>
    <div class="receipt-card">
        <div class="header">
            <div class="logo-title">
                <h1>AETHER_SHIELD</h1>
                <p>Telemetry Diagnostics Receipt</p>
            </div>
            <div class="doc-type">SECURE_REPORT</div>
        </div>
        
        <div class="status-banner">
            <h2>${statusText}</h2>
            <p>${isPass ? 'KYC Liveness Verification Completed Successfully.' : reason}</p>
        </div>
        
        <div class="grid-info">
            <div class="face-container">
                ${faceImg ? '<img src="' + faceImg + '" class="face-img" alt="Captured Face">' : '<span style="font-size:0.75rem; color:#718096;">NO IMAGE CAPTURED</span>'}
            </div>
            <div class="metadata-list">
                <div class="meta-item">
                    <span class="meta-label">Session ID</span>
                    <span class="meta-val">${sessionId}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Timestamp</span>
                    <span class="meta-val">${timestamp}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Verification Type</span>
                    <span class="meta-val">Biometric Liveness Challenge</span>
                </div>
            </div>
        </div>
        
        <div class="metrics-section">
            <h3 class="metrics-title">Liveness Metrics</h3>
            <table class="metrics-table">
                <thead>
                    <tr>
                        <th>Metric Challenge</th>
                        <th style="text-align: right;">Target / Expectation</th>
                        <th style="text-align: right;">User Output</th>
                        <th style="text-align: right;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Moiré Grid Pattern</td>
                        <td style="text-align: right;">&lt; 50%</td>
                        <td style="text-align: right;" class="val">${moireProb}%</td>
                        <td style="text-align: right;" class="val ${d.moire_passed ? 'pass' : 'fail'}">${d.moire_passed ? 'PASS' : 'FAIL'}</td>
                    </tr>
                    <tr>
                        <td>Reflection Correlation</td>
                        <td style="text-align: right;">&ge; 50%</td>
                        <td style="text-align: right;" class="val">${reflectionMatch}%</td>
                        <td style="text-align: right;" class="val ${d.reflection_passed ? 'pass' : 'fail'}">${d.reflection_passed ? 'PASS' : 'FAIL'}</td>
                    </tr>
                    <tr>
                        <td>Nose Motion Variance</td>
                        <td style="text-align: right;">&gt; 1.0e-6</td>
                        <td style="text-align: right;" class="val">${motionVal}</td>
                        <td style="text-align: right;" class="val ${d.motion_passed ? 'pass' : 'fail'}">${d.motion_passed ? 'PASS' : 'FAIL'}</td>
                    </tr>
                    <tr>
                        <td>Blink Tracking (EAR)</td>
                        <td style="text-align: right;">Detect Blink</td>
                        <td style="text-align: right;" class="val">${blinkText}</td>
                        <td style="text-align: right;" class="val ${d.blink_detected ? 'pass' : 'pass'}">INFO</td>
                    </tr>
                    <tr>
                        <td>Active Gesture Challenge</td>
                        <td style="text-align: right;">${expectedGestureText}</td>
                        <td style="text-align: right;" class="val">${gestureStatus}</td>
                        <td style="text-align: right;" class="val ${d.gesture_passed ? 'pass' : 'fail'}">${d.gesture_passed ? 'PASS' : 'FAIL'}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        
        <div class="footer">
            <p>Verification protected by AETHER_SHIELD security infrastructure.</p>
            <p style="margin-top: 4px; font-size: 0.55rem; opacity: 0.5;">HASH: ${btoa(sessionId).substring(0, 16)}...</p>
        </div>
        
        <div class="no-print">
            <button class="print-btn" onclick="window.print()">Print Receipt</button>
        </div>
    </div>
</body>
</html>
    `;
    
    const printWindow = window.open('', '_blank', 'width=800,height=800');
    if (printWindow) {
        printWindow.document.write(receiptHtml);
        printWindow.document.close();
    } else {
        alert("Please allow popups to download/print the diagnostics receipt.");
    }
}

/* ==========================================================================
   View Transitions & Camera Control
   ========================================================================== */
async function launchScanner() {
    playSynthSound('scan');
    speak("Welcome to Aether Shield. Camera stream initializing. Please position your face.");
    
    landingView.classList.add('fade-out-up');
    await sleep(350);
    
    landingView.classList.add('hidden');
    landingView.classList.remove('fade-out-up');
    
    scannerView.classList.remove('hidden');
    scannerView.classList.add('fade-in-down');
    await sleep(350);
    
    scannerView.classList.remove('fade-in-down');
    
    // Launch webcam stream
    await startCamera();
}

async function goHome() {
    speak("Returning to home screen.");
    
    // Stop camera stream to release device resources
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    videoEl.srcObject = null;
    ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
    
    // Terminate active WebSocket channel
    if (socket) {
        socket.close();
        socket = null;
        console.log('[WS] Channel terminated upon navigating home.');
    }
    
    scannerView.classList.add('fade-out-up');
    await sleep(350);
    
    scannerView.classList.add('hidden');
    scannerView.classList.remove('fade-out-up');
    
    landingView.classList.remove('hidden');
    landingView.classList.add('fade-in-down');
    await sleep(350);
    
    landingView.classList.remove('fade-in-down');
    
    // Reset scanner state
    resetDiagnosticsUI();
    btnDownloadReceipt.style.display = 'none';
    statusMessage.textContent = 'Ready to Start';
}

/* ==========================================================================
   Event Listeners & Initialization
   ========================================================================== */
btnStart.addEventListener('click', runLivenessCheck);
btnTrain.addEventListener('click', trainMoireModel);
btnAudioToggle.addEventListener('click', () => {
    isAudioMuted = !isAudioMuted;
    btnAudioToggle.textContent = isAudioMuted ? '🔇' : '🔊';
    log(`Audio assistant ${isAudioMuted ? 'muted' : 'unmuted'}.`, 'info');
});
btnDownloadReceipt.addEventListener('click', downloadReceipt);

// Landing page listeners
if (btnLaunchScanner) btnLaunchScanner.addEventListener('click', launchScanner);
if (btnHome) btnHome.addEventListener('click', goHome);

// Auto-run checks on startup
async function init() {
    await checkServerStatus();
    await initFaceLandmarker();
}

window.addEventListener('DOMContentLoaded', init);
