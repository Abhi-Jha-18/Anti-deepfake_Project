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
    faceGuide.className = 'face-guide-oval detected flashing';
    guideInstruction.textContent = 'LIVENESS CHECK IN PROGRESS';
    statusMessage.textContent = 'Initializing verification...';
    
    // Clear previous metrics & UI results
    resetDiagnosticsUI();
    log('Initializing verification session...', 'info');
    
    try {
        // Step 1: Initialize session on backend
        const initResponse = await fetch(`${API_URL}/init_session`, { method: 'POST' });
        const initData = await initResponse.json();
        
        if (!initData.success) {
            throw new Error(initData.error || 'Failed to initialize session');
        }
        
        currentSessionId = initData.session_id;
        const colorSequence = initData.sequence;
        log(`Session initialized: ${currentSessionId}`, 'info');
        log(`Sequence generated: ${colorSequence.join(' -> ')}`, 'info');
        
        // Update diagnostics reflection blocks to show upcoming sequence
        setupReflectionBlocks(colorSequence);
        
        // Delay 1 second to let user prepare
        await sleep(1000);
        
        let completedSteps = 0;
        let maxMoire = 0;
        
        // Step 2: Loop and flash each color in sequence
        for (let i = 0; i < colorSequence.length; i++) {
            const color = colorSequence[i];
            const hex = COLOR_MAP[color];
            
            statusMessage.textContent = `Analyzing reflections... [${i + 1}/${colorSequence.length}]`;
            log(`Flashing color: ${color}`, 'info');
            
            // Activate the color overlay
            flashOverlay.style.backgroundColor = hex;
            flashOverlay.classList.add('active');
            
            // Wait 350ms to allow screen light to reach face and webcam to adjust exposure
            await sleep(350);
            
            // Capture image
            const frameB64 = captureFrameBase64();
            
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
                // If landmarking fails, allow the user to retake or break
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
        
        // Step 3: Trigger session verification
        if (completedSteps === colorSequence.length) {
            statusMessage.textContent = 'Processing verdict...';
            log('All challenge frames received. Requesting final liveness verdict...', 'info');
            
            const sessionResponse = await fetch(`${API_URL}/verify_session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: currentSessionId })
            });
            
            const sessionData = await sessionResponse.json();
            
            if (sessionData.success) {
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
}

/* ==========================================================================
   Event Listeners & Initialization
   ========================================================================== */
btnStart.addEventListener('click', runLivenessCheck);
btnTrain.addEventListener('click', trainMoireModel);

// Auto-run checks on startup
async function init() {
    await checkServerStatus();
    await startCamera();
}

window.addEventListener('DOMContentLoaded', init);
