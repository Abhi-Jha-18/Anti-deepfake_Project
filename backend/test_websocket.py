import urllib.request
import json
import base64
import numpy as np
import cv2
import sys

API_URL = "http://127.0.0.1:5000/api"
WS_URL = "ws://127.0.0.1:5000/api/verify"

def make_post_request(url, data):
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode('utf-8'))

def test_websocket_flow():
    print("=== Anti-Deepfake KYC WebSocket Integration Test ===")
    
    # 1. Test Status Endpoint
    try:
        with urllib.request.urlopen(f"{API_URL}/status") as res:
            status = json.loads(res.read().decode('utf-8'))
            print("[1/4] /status check: SUCCESS")
            print(f"      Model Trained: {status['model_trained']}")
            print(f"      Message: {status['message']}")
    except Exception as e:
        print(f"[1/4] /status check: FAILED - {e}")
        return False

    # 2. Test Session Initialization (REST)
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
            return False
    except Exception as e:
        print(f"[2/4] /init_session check: FAILED - {e}")
        return False

    # 3. Test WebSocket binary frame verification
    try:
        # We use the websockets library to test the connection
        import websockets
        import asyncio
        
        async def run_ws_test():
            # Create a dummy image
            dummy_img = np.zeros((480, 640, 3), dtype=np.uint8)
            _, buffer = cv2.imencode('.jpg', dummy_img)
            dummy_bytes = buffer.tobytes()
            
            ws_connect_url = f"{WS_URL}/{session_id}"
            print(f"      Connecting to WebSocket: {ws_connect_url}")
            
            async with websockets.connect(ws_connect_url) as websocket:
                # Send text metadata
                await websocket.send(json.dumps({"expected_color": sequence[0]}))
                # Send binary image payload
                await websocket.send(dummy_bytes)
                
                # Wait for response
                response_str = await websocket.recv()
                response = json.loads(response_str)
                return response

        # Run async function in a sync environment
        loop = asyncio.get_event_loop()
        verify_data = loop.run_until_complete(run_ws_test())
        
        if not verify_data.get("success") and "No face detected" in verify_data.get("error", ""):
            print("[3/4] /ws/verify connection: SUCCESS")
            print("      WebSocket successfully accepted text metadata and raw binary image, returning: 'No face detected'")
        else:
            print(f"[3/4] /ws/verify connection: UNEXPECTED RESPONSE - {verify_data}")
            return False
            
    except ImportError:
        print("[3/4] /ws/verify connection: SKIPPED (websockets library not installed in this python env)")
    except Exception as e:
        print(f"[3/4] /ws/verify connection: FAILED - {e}")
        return False

    # 4. Test REST session verification (REST)
    try:
        verdict_payload = { "session_id": session_id }
        verdict_data = make_post_request(f"{API_URL}/verify_session", verdict_payload)
        
        if not verdict_data.get("success") and "Incomplete verification" in verdict_data.get("error", ""):
            print("[4/4] /verify_session check: SUCCESS")
            print("      API successfully blocked incomplete session validation.")
        else:
            print(f"[4/4] /verify_session check: UNEXPECTED RESPONSE - {verdict_data}")
            return False
    except Exception as e:
        print(f"[4/4] /verify_session check: FAILED - {e}")
        return False

    print("==========================================")
    print("FastAPI + WebSockets Integration test completed successfully!")
    return True

if __name__ == "__main__":
    success = test_websocket_flow()
    sys.exit(0 if success else 1)
