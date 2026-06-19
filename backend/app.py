import os
import uuid
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import threading

# Import our custom components
from liveness_detector import LivenessDetector
from moire_detector import MoirePredictor, train_model

app = Flask(__name__)
# Enable CORS so our frontend can communicate with the API
CORS(app)

# Initialize detectors
liveness_detector = LivenessDetector()
# Predictor will load weights if they exist, otherwise runs in fallback mode
moire_predictor = MoirePredictor()

# Global dict to store sessions in memory
sessions = {}

@app.route('/api/init_session', methods=['POST'])
def init_session():
    """Initializes a new liveness checking session with a random color sequence."""
    session_id = str(uuid.uuid4())
    
    # Pool of challenge colors
    colors = ['RED', 'GREEN', 'BLUE', 'YELLOW', 'CYAN', 'MAGENTA']
    # Select 4 random colors (non-repeating sequentially to make it dynamic)
    sequence = []
    last_color = None
    for _ in range(4):
        available = [c for c in colors if c != last_color]
        chosen = np.random.choice(available)
        sequence.append(chosen)
        last_color = chosen
        
    gesture = str(np.random.choice(['TURN_LEFT', 'TURN_RIGHT']))
    
    sessions[session_id] = {
        "sequence": sequence,
        "expected_gesture": gesture,
        "frames": [],
        "completed": False
    }
    
    return jsonify({
        "success": True,
        "session_id": session_id,
        "sequence": sequence,
        "gesture": gesture
    })

@app.route('/api/verify_frame', methods=['POST'])
def verify_frame():
    """Receives a frame, analyzes landmarks, crops patches for CNN, and logs color values."""
    data = request.json
    if not data:
        return jsonify({"success": False, "error": "Missing payload"}), 400
        
    session_id = data.get("session_id")
    frame_b64 = data.get("frame")
    expected_color = data.get("expected_color")
    
    if not session_id or not frame_b64 or not expected_color:
        return jsonify({"success": False, "error": "Missing required fields"}), 400
        
    if session_id not in sessions:
        return jsonify({"success": False, "error": "Invalid session ID"}), 400
        
    # Process frame with face mesh
    res = liveness_detector.process_frame(frame_b64)
    if not res["success"]:
        return jsonify({"success": False, "error": res["error"]})
        
    # Run Moire CNN prediction on cropped patches (forehead, cheek)
    patches = res.get("patches", [])
    moire_prob = 0.0
    if patches:
        # Get maximum spoof probability across the cropped facial patches
        moire_prob = moire_predictor.predict_patches(patches)
        
    # Store frame results in session history for sequence-wide validation
    sessions[session_id]["frames"].append({
        "expected_color": expected_color,
        "eye_rgb": res["eye_rgb"],
        "skin_rgb": res["skin_rgb"],
        "ear": res["ear"],
        "landmarks": res["motion_landmarks"],
        "moire_prob": moire_prob
    })
    
    return jsonify({
        "success": True,
        "ear": res["ear"],
        "moire_prob": moire_prob,
        "left_iris": res.get("left_iris"),
        "right_iris": res.get("right_iris"),
        "message": f"Frame processed for color: {expected_color}"
    })

@app.route('/api/verify_session', methods=['POST'])
def verify_session():
    """Evaluates the entire sequence to decide the final liveness verdict."""
    data = request.json
    if not data or "session_id" not in data:
        return jsonify({"success": False, "error": "Missing session ID"}), 400
        
    session_id = data.get("session_id")
    if session_id not in sessions:
        return jsonify({"success": False, "error": "Invalid session ID"}), 400
        
    session = sessions[session_id]
    frames = session["frames"]
    sequence = session["sequence"]
    
    expected_frames_count = len(sequence) + 1
    if len(frames) < expected_frames_count:
        return jsonify({
            "success": False,
            "error": f"Incomplete verification. Only {len(frames)} out of {expected_frames_count} steps completed."
        })
        
    # 1. Challenge-Response Reflection Check (evaluated only on flash frames)
    flash_frames = [f for f in frames if f["expected_color"] != "GESTURE"]
    reflection_result = liveness_detector.verify_reflection_sequence(flash_frames)
    reflection_passed = reflection_result["success"]
    reflection_score = reflection_result["score"]
    
    # 2. Active Gesture Challenge Check
    expected_gesture = session.get("expected_gesture")
    gesture_passed = liveness_detector.verify_gesture(frames, expected_gesture)
    
    # 3. Passive Moiré Check (CNN outputs)
    moire_probs = [f["moire_prob"] for f in frames]
    max_moire_prob = max(moire_probs) if moire_probs else 0.0
    moire_passed = max_moire_prob < 0.5  # Spoof if probability of screen is high
    
    # 4. Static Photo Motion Check
    noses = np.array([f["landmarks"]["nose"] for f in frames]) # Shape: N x 3 (x, y, z)
    nose_variance = np.var(noses, axis=0) # Variance in x, y, z
    total_variance = float(np.sum(nose_variance))
    
    # With a head turn gesture, a real face MUST register significant movement.
    # We raise the movement threshold slightly to 1e-6.
    motion_passed = total_variance > 1e-6
    
    # 5. Blink / Eye Aspect Ratio (EAR) check
    ears = [f["ear"] for f in frames]
    min_ear = min(ears)
    blink_detected = min_ear < 0.22
    
    # Combine verdict
    verdict = "VERIFIED_HUMAN"
    reason = "All checks passed. Liveness verified."
    
    if not motion_passed:
        verdict = "SPOOF_DETECTED"
        reason = "Static Spoof Detected (No facial micro-movements)."
    elif not gesture_passed:
        verdict = "SPOOF_DETECTED"
        reason = f"Gesture Spoof Detected (Incorrect or missing head movement. Expected: {expected_gesture})."
    elif not reflection_passed:
        verdict = "SPOOF_DETECTED"
        reason = f"Reflection Spoof Detected (Color reflections did not match flash challenge sequence. Match Rate: {reflection_score*100:.1f}%)."
    elif not moire_passed:
        verdict = "SPOOF_DETECTED"
        reason = f"Digital Screen Spoof Detected (Moiré interference lines identified. Moiré Score: {max_moire_prob:.2f})."
        
    session["completed"] = True
    session["verdict"] = verdict
    session["reason"] = reason
    
    return jsonify({
        "success": True,
        "verdict": verdict,
        "reason": reason,
        "details": {
            "reflection_score": float(reflection_score),
            "reflection_passed": bool(reflection_passed),
            "max_moire_prob": float(max_moire_prob),
            "moire_passed": bool(moire_passed),
            "nose_variance": float(total_variance),
            "motion_passed": bool(motion_passed),
            "blink_detected": bool(blink_detected),
            "gesture_passed": bool(gesture_passed),
            "expected_gesture": expected_gesture,
            "ear_sequence": [float(e) for e in ears]
        }
    })

@app.route('/api/train_model', methods=['POST'])
def train_api():
    """Triggers the moire CNN training process asynchronously."""
    def run_training():
        try:
            train_model()
            # Reload weights after training completes
            global moire_predictor
            moire_predictor.load_model()
            print("Background model training completed and weights reloaded.")
        except Exception as e:
            print(f"Error training model in background: {str(e)}")
            
    thread = threading.Thread(target=run_training)
    thread.start()
    
    return jsonify({
        "success": True,
        "message": "Model training started in background. Check server logs for progress."
    })

@app.route('/api/status', methods=['GET'])
def get_status():
    """Checks if the CNN model is trained and ready."""
    model_trained = os.path.exists("moire_cnn.pth")
    return jsonify({
        "success": True,
        "model_trained": model_trained,
        "message": "Model trained and loaded." if model_trained else "Model not trained yet. Spoof detection will run in baseline fallback mode."
    })

if __name__ == '__main__':
    # Run the server on host 0.0.0.0 and port 5000
    app.run(host='0.0.0.0', port=5000, debug=False)
