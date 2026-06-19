import os
import uuid
import numpy as np
import json
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import redis
import time
import threading

# Import custom components
from liveness_detector import LivenessDetector
from moire_detector import MoirePredictor, train_model

# --------------------------------------------------------------------------
# Session Store with Redis Cache & self-cleaning InMemory fallback
# --------------------------------------------------------------------------
class SessionStore:
    def __init__(self):
        self.use_redis = False
        try:
            # Attempt connection to local Redis server with a short timeout to prevent hangs
            self.redis_client = redis.Redis(
                host='localhost', 
                port=6379, 
                db=0, 
                decode_responses=True,
                socket_connect_timeout=1.0,
                socket_timeout=1.0
            )
            self.redis_client.ping()
            self.use_redis = True
            print("[SESSION] Connected to Redis successfully. Session caching active.")
        except Exception as e:
            print(f"[SESSION] Redis connection failed: {e}. Falling back to InMemorySessionStore.")
            self.in_memory_store = {}
            self.lock = threading.Lock()
            # Start background thread to clean up expired sessions
            self.cleanup_thread = threading.Thread(target=self._cleanup_expired_sessions, daemon=True)
            self.cleanup_thread.start()
            
    def _cleanup_expired_sessions(self):
        while True:
            time.sleep(60) # Scan every minute
            now = time.time()
            with self.lock:
                to_delete = []
                for session_id, item in self.in_memory_store.items():
                    if item["expires_at"] < now:
                        to_delete.append(session_id)
                for session_id in to_delete:
                    del self.in_memory_store[session_id]
                    print(f"[SESSION] InMemorySessionStore: Cleaned up expired session {session_id}")

    def create_session(self, session_id: str, data: dict, ttl_seconds: int = 300):
        if self.use_redis:
            self.redis_client.setex(f"session:{session_id}", ttl_seconds, json.dumps(data))
        else:
            with self.lock:
                self.in_memory_store[session_id] = {
                    "data": data,
                    "expires_at": time.time() + ttl_seconds
                }

    def get_session(self, session_id: str) -> dict:
        if self.use_redis:
            val = self.redis_client.get(f"session:{session_id}")
            if val:
                # Refresh TTL on access (sliding window)
                self.redis_client.expire(f"session:{session_id}", 300)
                return json.loads(val)
            return None
        else:
            with self.lock:
                item = self.in_memory_store.get(session_id)
                if item:
                    if item["expires_at"] < time.time():
                        del self.in_memory_store[session_id]
                        return None
                    # Refresh TTL on access (sliding window)
                    item["expires_at"] = time.time() + 300
                    return item["data"]
                return None

    def save_session(self, session_id: str, data: dict, ttl_seconds: int = 300):
        self.create_session(session_id, data, ttl_seconds)

    def delete_session(self, session_id: str):
        if self.use_redis:
            self.redis_client.delete(f"session:{session_id}")
        else:
            with self.lock:
                if session_id in self.in_memory_store:
                    del self.in_memory_store[session_id]

# Initialize FastAPI App
app = FastAPI(title="AETHER_SHIELD API", version="2.0")

# Enable CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize singletons
liveness_detector = LivenessDetector()
moire_predictor = MoirePredictor()
session_store = SessionStore()

@app.post("/api/init_session")
async def init_session():
    """Initializes a new liveness checking session with a random color sequence."""
    session_id = str(uuid.uuid4())
    
    # Pool of challenge colors
    colors = ['RED', 'GREEN', 'BLUE', 'YELLOW', 'CYAN', 'MAGENTA']
    # Select 4 random colors (non-repeating sequentially to make it dynamic)
    sequence = []
    last_color = None
    for _ in range(4):
        available = [c for c in colors if c != last_color]
        chosen = str(np.random.choice(available))
        sequence.append(chosen)
        last_color = chosen
        
    gesture = str(np.random.choice(['TURN_LEFT', 'TURN_RIGHT']))
    
    session_data = {
        "sequence": sequence,
        "expected_gesture": gesture,
        "frames": [],
        "completed": False
    }
    
    session_store.create_session(session_id, session_data)
    
    return {
        "success": True,
        "session_id": session_id,
        "sequence": sequence,
        "gesture": gesture
    }

# --------------------------------------------------------------------------
# Asynchronous WebSocket for real-time binary frame transmission
# --------------------------------------------------------------------------
@app.websocket("/ws/verify/{session_id}")
async def websocket_verify(websocket: WebSocket, session_id: str):
    await websocket.accept()
    print(f"[WS] Connection accepted for session: {session_id}")
    
    try:
        while True:
            # 1. Receive JSON metadata containing expected_color
            try:
                metadata_str = await websocket.receive_text()
                metadata = json.loads(metadata_str)
                expected_color = metadata.get("expected_color")
            except Exception as e:
                await websocket.send_json({"success": False, "error": f"Invalid metadata format: {str(e)}"})
                continue
                
            # 2. Receive raw binary image bytes
            try:
                img_bytes = await websocket.receive_bytes()
            except Exception as e:
                await websocket.send_json({"success": False, "error": f"Failed to receive binary payload: {str(e)}"})
                continue
                
            # Retrieve active session
            session = session_store.get_session(session_id)
            if not session:
                await websocket.send_json({"success": False, "error": "Invalid or expired session ID."})
                break
                
            # Process frame binary directly
            res = liveness_detector.process_frame(img_bytes, is_binary=True)
            if not res["success"]:
                await websocket.send_json({"success": False, "error": res["error"]})
                continue
                
            # Run Moire CNN prediction on cropped patches (forehead, cheek)
            patches = res.get("patches", [])
            moire_prob = 0.0
            if patches:
                moire_prob = float(moire_predictor.predict_patches(patches))
                
            # Store frame metrics in session history
            frame_entry = {
                "expected_color": expected_color,
                "eye_rgb": res["eye_rgb"],
                "skin_rgb": res["skin_rgb"],
                "ear": float(res["ear"]),
                "landmarks": res["motion_landmarks"],
                "moire_prob": moire_prob
            }
            session["frames"].append(frame_entry)
            session_store.save_session(session_id, session)
            
            # Send live metrics back to client
            await websocket.send_json({
                "success": True,
                "ear": float(res["ear"]),
                "moire_prob": moire_prob,
                "left_iris": res.get("left_iris"),
                "right_iris": res.get("right_iris"),
                "message": f"Frame processed for color: {expected_color}"
            })
            
    except WebSocketDisconnect:
        print(f"[WS] Connection closed for session: {session_id}")
    except Exception as e:
        print(f"[WS] Error in session {session_id}: {str(e)}")

@app.post("/api/verify_session")
async def verify_session(request: Request):
    """Evaluates the entire sequence to decide the final liveness verdict."""
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "Missing payload"}, status_code=400)
        
    session_id = data.get("session_id")
    if not session_id:
        return JSONResponse({"success": False, "error": "Missing session ID"}, status_code=400)
        
    session = session_store.get_session(session_id)
    if not session:
        return JSONResponse({"success": False, "error": "Invalid or expired session ID"}, status_code=400)
        
    frames = session["frames"]
    sequence = session["sequence"]
    
    # 4 flash color frames + 1 gesture challenge frame = 5 frames expected
    expected_frames_count = len(sequence) + 1
    if len(frames) < expected_frames_count:
        return {
            "success": False,
            "error": f"Incomplete verification. Only {len(frames)} out of {expected_frames_count} steps completed."
        }
        
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
    noses = np.array([f["landmarks"]["nose"] for f in frames])
    nose_variance = np.var(noses, axis=0)
    total_variance = float(np.sum(nose_variance))
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
    
    # Save the updated session in Redis/InMemory cache
    session_store.save_session(session_id, session)
    
    return {
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
    }

def run_training():
    try:
        train_model()
        global moire_predictor
        # Reload weights after training completes
        moire_predictor = MoirePredictor()
        print("[TRAINING] Background model training completed and weights reloaded.")
    except Exception as e:
        print(f"[TRAINING] Error training model in background: {str(e)}")

@app.post("/api/train_model")
async def train_api(background_tasks: BackgroundTasks):
    """Triggers the moire CNN training process asynchronously."""
    background_tasks.add_task(run_training)
    return {
        "success": True,
        "message": "Model training started in background. Check server logs for progress."
    }

@app.get("/api/status")
async def get_status():
    """Checks if the CNN model is trained and ready."""
    model_trained = os.path.exists("moire_cnn.pth")
    return {
        "success": True,
        "model_trained": model_trained,
        "message": "Model trained and loaded." if model_trained else "Model not trained yet. Spoof detection will run in baseline fallback mode."
    }

if __name__ == '__main__':
    # Run uvicorn server directly with app instance to prevent double module loading
    uvicorn.run(app, host='0.0.0.0', port=5000)
