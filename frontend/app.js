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
            
            if (data.model_trained) {
                serverStatusText.textContent = 'API Ready (CNN Trained)';
                log('API connection verified. Moire CNN model loaded.', 'success');
            } else {
                serverStatusText.textContent = 'API Ready (No CNN Model)';
                log('API connection verified. Moire CNN weights not found; running in fallback mode.', 'warn');
            }
        }
    } catch (error) {
        isConnected = false;
        serverStatusDot.className = 'status-indicator';
        serverStatusText.textContent = 'API Offline';
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

// Simple loop to draw face placement guide overlay
function drawOverlayLoop() {
    if (!videoEl.paused && !videoEl.ended) {
        ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        
        // Compute FPS if needed
        document.getElementById('camera-fps').textContent = '30 FPS';
        
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
   Capture Frame Helper
   ========================================================================== */
function captureFrameBase64() {
    // Draw current video frame onto the hidden canvas
    captureCtx.drawImage(videoEl, 0, 0, captureCanvas.width, captureCanvas.height);
    // Convert to jpeg base64
    const dataURL = captureCanvas.toDataURL('image/jpeg', 0.85);
    return dataURL;
}

/* ==========================================================================
   Liveness Check Coordination (Core Logic)
   ========================================================================== */
async function runLivenessCheck() {
    if (isChecking || !isConnected) return;
    
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
        // Step 1: Initialize session on backend
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
        
        // Update diagnostics reflection blocks to show upcoming sequence
        setupReflectionBlocks(colorSequence);
        
        // Delay 1 second to let user prepare
        await sleep(1000);
        
        let completedSteps = 0;
        let maxMoire = 0;
        let firstFrameB64 = null;
        
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
            
            // Wait 350ms to allow screen light to reach face and webcam to adjust exposure
            await sleep(350);
            
            // Capture image
            const frameB64 = captureFrameBase64();
            if (i === 0) {
                // Save the first front-facing frame for the diagnostics receipt photo
                firstFrameB64 = frameB64;
            }
            
            // Turn off overlay immediately
            flashOverlay.classList.remove('active');
            
            // Send frame to API
            log(`Submitting frame ${i + 1} to API...`, 'muted');
            const verifyResponse = await fetch(`${API_URL}/verify_frame`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    frame: frameB64,
                    expected_color: color
                })
            });
            
            const verifyData = await verifyResponse.json();
            
            if (!verifyData.success) {
                log(`Analysis failed at step ${i + 1}: ${verifyData.error}`, 'danger');
                statusMessage.textContent = 'Verification Interrupted';
                showFailureVerdict('LANDMARKING_FAILED', verifyData.error);
                return;
            }
            
            // Draw detected eye centers
            if (verifyData.left_iris && verifyData.right_iris) {
                drawEyeTargets(verifyData.left_iris, verifyData.right_iris, verifyData.ear);
            }
            
            // Update live metrics on dashboard
            updateLiveMetrics(verifyData, color, i);
            maxMoire = Math.max(maxMoire, verifyData.moire_prob);
            
            completedSteps++;
            // Wait 250ms between flashes to allow exposure to settle back
            await sleep(250);
        }
        
        // Step 3: Trigger head turn gesture challenge
        if (completedSteps === colorSequence.length) {
            const gestureTextStr = expectedGesture === 'TURN_LEFT' ? 'Turn Head Left' : 'Turn Head Right';
            const arrow = expectedGesture === 'TURN_LEFT' ? '←' : '→';
            const cssClass = expectedGesture === 'TURN_LEFT' ? 'left' : 'right';
            
            statusMessage.textContent = `Gesture Challenge: ${gestureTextStr}`;
            log(`Initiating gesture challenge: ${expectedGesture}`, 'info');
            
            // Show gesture prompt overlay UI
            gesturePrompt.className = `gesture-prompt-overlay active ${cssClass}`;
            gestureArrow.textContent = arrow;
            gestureText.textContent = gestureTextStr;
            
            // Vocal instruction and sweep sound
            speak(`Please turn your head to the ${expectedGesture === 'TURN_LEFT' ? 'left' : 'right'}`);
            playSynthSound('scan');
            
            // Wait 1.8 seconds for user head movement
            await sleep(1800);
            
            // Capture gesture frame
            const gestureFrame = captureFrameBase64();
            
            // Hide gesture overlay UI
            gesturePrompt.classList.remove('active');
            
            // Submit gesture frame to API
            log(`Submitting gesture frame to API...`, 'muted');
            const gestureResponse = await fetch(`${API_URL}/verify_frame`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    frame: gestureFrame,
                    expected_color: 'GESTURE'
                })
            });
            
            const gestureData = await gestureResponse.json();
            if (!gestureData.success) {
                log(`Gesture analysis failed: ${gestureData.error}`, 'danger');
                statusMessage.textContent = 'Verification Interrupted';
                showFailureVerdict('LANDMARKING_FAILED', gestureData.error);
                return;
            }
            
            // Step 4: Final Session Verification
            statusMessage.textContent = 'Processing verdict...';
            log('All challenge frames received. Requesting final liveness verdict...', 'info');
            
            const sessionResponse = await fetch(`${API_URL}/verify_session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: currentSessionId })
            });
            
            const sessionData = await sessionResponse.json();
            
            if (sessionData.success) {
                lastCapturedFaceB64 = firstFrameB64; // Save front face crop for receipt
                displayFinalVerdict(sessionData);
            } else {
                throw new Error(sessionData.error || 'Failed to verify session');
            }
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
    
    // 2. EAR / Blinks
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
        resultDesc.innerHTML = `
            <strong>Status: Verified Human</strong><br>
            • Color Reflection correlation check passed (${matchPercent}% match rate).<br>
            • No digital moiré grid patterns detected (Moire probability: ${(d.max_moire_prob * 100).toFixed(1)}%).<br>
            • Natural micro-movements detected (Pose variance: ${d.nose_variance.toExponential(2)}).
        `;
        log('VERDICT: Secure handshake complete. User verified as live human.', 'success');
        statusMessage.textContent = 'VERIFIED';
        
        playSynthSound('success');
        speak("Verification passed. Handshake secure.");
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

// Auto-run checks on startup
async function init() {
    await checkServerStatus();
    await startCamera();
}

window.addEventListener('DOMContentLoaded', init);
