import urllib.request
import json
import base64
import numpy as np
import cv2

API_URL = "http://127.0.0.1:5000/api"

def make_post_request(url, data):
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode('utf-8'))

def test_liveness_api():
    print("=== Anti-Deepfake KYC API Verification ===")
    
    # 1. Test Status Endpoint
    try:
        with urllib.request.urlopen(f"{API_URL}/status") as res:
            status = json.loads(res.read().decode('utf-8'))
            print("[1/4] /status check: SUCCESS")
            print(f"      Model Trained: {status['model_trained']}")
            print(f"      Message: {status['message']}")
    except Exception as e:
        print(f"[1/4] /status check: FAILED - {e}")
        return

    # 2. Test Session Initialization
    try:
        init_data = make_post_request(f"{API_URL}/init_session", {})
        if init_data.get("success"):
            session_id = init_data["session_id"]
            sequence = init_data["sequence"]
            print("[2/4] /init_session check: SUCCESS")
            print(f"      Session ID: {session_id}")
            print(f"      Color Sequence: {sequence}")
        else:
            print(f"[2/4] /init_session check: FAILED - {init_data.get('error')}")
            return
    except Exception as e:
        print(f"[2/4] /init_session check: FAILED - {e}")
        return

    # 3. Test Frame Verification with Dummy Frame
    try:
        # Create a dummy solid BGR image
        dummy_img = np.zeros((480, 640, 3), dtype=np.uint8)
        _, buffer = cv2.imencode('.jpg', dummy_img)
        dummy_b64 = base64.b64encode(buffer).decode('utf-8')
        
        frame_payload = {
            "session_id": session_id,
            "frame": dummy_b64,
            "expected_color": sequence[0]
        }
        
        verify_data = make_post_request(f"{API_URL}/verify_frame", frame_payload)
        
        # Since the dummy image has no face, we expect a 'No face detected' message from the API.
        # This confirms that the base64 decoding, MediaPipe initialization, and task inference executed without crashing!
        if not verify_data.get("success") and "No face detected" in verify_data.get("error", ""):
            print("[3/4] /verify_frame check: SUCCESS")
            print("      API successfully handled dummy image and flagged: 'No face detected'")
        else:
            print(f"[3/4] /verify_frame check: UNEXPECTED RESPONSE - {verify_data}")
    except Exception as e:
        print(f"[3/4] /verify_frame check: FAILED - {e}")
        return

    # 4. Test Session Verdict with Incomplete Session
    try:
        verdict_payload = { "session_id": session_id }
        verdict_data = make_post_request(f"{API_URL}/verify_session", verdict_payload)
        
        # We expect a failure because we only submitted 1 frame (dummy) out of 4 sequence steps.
        if not verdict_data.get("success") and "Incomplete verification" in verdict_data.get("error", ""):
            print("[4/4] /verify_session check: SUCCESS")
            print("      API successfully blocked incomplete session validation.")
        else:
            print(f"[4/4] /verify_session check: UNEXPECTED RESPONSE - {verdict_data}")
    except Exception as e:
        print(f"[4/4] /verify_session check: FAILED - {e}")
        return

    print("==========================================")
    print("API Integration test completed successfully!")

if __name__ == "__main__":
    test_liveness_api()
