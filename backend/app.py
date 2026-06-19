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
    allow_origin_regex=".*",
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
@app.websocket("/api/verify/{session_id}")
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
                
            # 2. Receive raw binary image bytes (which is the 192x64 patch composite)
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
                
            # Decode the 192x64 composite image
            img = liveness_detector.decode_binary_image(img_bytes)
            if img is None:
                await websocket.send_json({"success": False, "error": "Failed to decode composite image."})
                continue
                
            # Slice composite image into forehead, left cheek, right cheek
            h, w, c = img.shape
            moire_prob = 0.0
            if w == 192 and h == 64:
                patches = [
                    img[0:64, 0:64],
                    img[0:64, 64:128],
                    img[0:64, 128:192]
                ]
                moire_prob = float(moire_predictor.predict_numpy_patches(patches))
            else:
                print(f"[WS] Warning: Image dimensions mismatch ({w}x{h}). Expected 192x64.")
                
            # Store Moire prediction in session
            if "moire_probs" not in session:
                session["moire_probs"] = []
            session["moire_probs"].append(moire_prob)
            session_store.save_session(session_id, session)
            
            # Send live Moire metric back to client
            await websocket.send_json({
                "success": True,
                "moire_prob": moire_prob,
                "message": f"Composite patch processed for color: {expected_color}"
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
        
    # Get local liveness metrics from client payload
    motion_passed = bool(data.get("motion_passed", False))
    gesture_passed = bool(data.get("gesture_passed", False))
    blink_detected = bool(data.get("blink_detected", False))
    nose_variance = float(data.get("nose_variance", 0.0))
    reflection_data = data.get("reflection_data", [])
    ear_sequence = data.get("ear_sequence", [])
    
    # 1. Challenge-Response Reflection Check (evaluated on flash frames)
    reflection_result = liveness_detector.verify_reflection_sequence(reflection_data)
    reflection_passed = reflection_result["success"]
    reflection_score = reflection_result["score"]
    
    # 2. Passive Moiré Check (Max score of WebSocket CNN predictions)
    moire_probs = session.get("moire_probs", [])
    max_moire_prob = max(moire_probs) if moire_probs else 0.0
    moire_passed = max_moire_prob < 0.5
    
    expected_gesture = session.get("expected_gesture")
    
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
            "nose_variance": float(nose_variance),
            "motion_passed": bool(motion_passed),
            "blink_detected": bool(blink_detected),
            "gesture_passed": bool(gesture_passed),
            "expected_gesture": expected_gesture,
            "ear_sequence": [float(e) for e in ear_sequence]
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
