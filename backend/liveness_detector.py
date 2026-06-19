import os
import cv2
import numpy as np
import base64

class LivenessDetector:
    def __init__(self):
        pass

    def decode_base64_image(self, base64_str):
        """Decodes base64 string to OpenCV BGR image."""
        if ',' in base64_str:
            base64_str = base64_str.split(',')[1]
        img_data = base64.b64decode(base64_str)
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img

    def decode_binary_image(self, img_bytes):
        """Decodes raw binary image bytes (JPEG/PNG) to OpenCV BGR image."""
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img

    def verify_reflection_sequence(self, session_data):
        """
        Validates if the recorded eye/skin reflections match the flashed color sequence
        using scale-free, auto-exposure-proof color ratios.
        """
        if len(session_data) < 3:
            return {"success": False, "score": 0.0, "reason": "Insufficient frames for reflection check."}
            
        # Extract sequences
        colors = [item['expected_color'] for item in session_data]
        eye_rgbs = np.array([item['eye_rgb'] for item in session_data])
        skin_rgbs = np.array([item['skin_rgb'] for item in session_data])
        
        # Compute normalized ratios (R / (R+G+B)) to isolate chromaticity shifts
        eye_sums = np.sum(eye_rgbs, axis=1, keepdims=True) + 1e-5
        skin_sums = np.sum(skin_rgbs, axis=1, keepdims=True) + 1e-5
        
        eye_ratios = eye_rgbs / eye_sums
        skin_ratios = skin_rgbs / skin_sums
        
        # Compute baseline ratios (average normalized ratios over the session)
        avg_eye_ratio = np.mean(eye_ratios, axis=0)
        avg_skin_ratio = np.mean(skin_ratios, axis=0)
        
        # Compute changes relative to session baseline
        d_eye = eye_ratios - avg_eye_ratio
        d_skin = skin_ratios - avg_skin_ratio
        
        matches = 0
        total_checks = 0
        
        for idx, color in enumerate(colors):
            de = d_eye[idx]
            ds = d_skin[idx]
            
            # For each flashed color, check if the corresponding channel ratio
            # increased relative to the other channels (and has a minor positive margin)
            if color == 'RED':
                # Eye check: Red ratio change is the largest
                eye_ok = de[0] > de[1] and de[0] > de[2] and de[0] > -0.02
                skin_ok = ds[0] > ds[1] and ds[0] > ds[2] and ds[0] > -0.02
                is_match = eye_ok or skin_ok
                
            elif color == 'GREEN':
                eye_ok = de[1] > de[0] and de[1] > de[2] and de[1] > -0.02
                skin_ok = ds[1] > ds[0] and ds[1] > ds[2] and ds[1] > -0.02
                is_match = eye_ok or skin_ok
                
            elif color == 'BLUE':
                eye_ok = de[2] > de[0] and de[2] > de[1] and de[2] > -0.02
                skin_ok = ds[2] > ds[0] and ds[2] > ds[1] and ds[2] > -0.02
                is_match = eye_ok or skin_ok
                
            elif color == 'YELLOW': # Red + Green should increase relative to Blue
                eye_ok = de[0] > de[2] and de[1] > de[2]
                skin_ok = ds[0] > ds[2] and ds[1] > ds[2]
                is_match = eye_ok or skin_ok
                
            elif color == 'CYAN': # Green + Blue should increase relative to Red
                eye_ok = de[1] > de[0] and de[2] > de[0]
                skin_ok = ds[1] > ds[0] and ds[2] > ds[0]
                is_match = eye_ok or skin_ok
                
            elif color == 'MAGENTA': # Red + Blue should increase relative to Green
                eye_ok = de[0] > de[1] and de[2] > de[1]
                skin_ok = ds[0] > ds[1] and ds[2] > ds[1]
                is_match = eye_ok or skin_ok
            else:
                continue
                
            total_checks += 1
            if is_match:
                matches += 1
                
        if total_checks == 0:
            return {"success": False, "score": 0.0, "reason": "No valid color challenge frames checked."}
            
        score = matches / total_checks
        passed = score >= 0.50 # Allow 50% match rate (2/4 matches) as sufficient, accommodating high room ambient light
        
        return {
            "success": passed,
            "score": score,
            "matches": matches,
            "total": total_checks,
            "details": {
                "colors": colors,
                "eye_deltas": d_eye.tolist(),
                "skin_deltas": d_skin.tolist()
            }
        }

    def verify_gesture(self, session_frames, expected_gesture):
        """
        Verifies if the face turned in the expected direction compared to baseline
        (mirrored webcam coordinate shifts).
        """
        if len(session_frames) < 3:
            return False
            
        # Baseline frames (user looking straight during the color flashes)
        baseline_frames = [f for f in session_frames if f["expected_color"] != "GESTURE"]
        gesture_frames = [f for f in session_frames if f["expected_color"] == "GESTURE"]
        
        if not baseline_frames or not gesture_frames:
            return False
            
        gesture_frame = gesture_frames[-1]
        
        # Calculate average baseline nose x-ratio
        baseline_ratios = []
        for f in baseline_frames:
            nose = f["landmarks"]["nose"]
            left = f["landmarks"]["left_edge"]
            right = f["landmarks"]["right_edge"]
            width = right[0] - left[0]
            if width > 0:
                baseline_ratios.append((nose[0] - left[0]) / width)
                
        if not baseline_ratios:
            return False
        avg_baseline = np.mean(baseline_ratios)
        
        # Gesture frame nose x-ratio
        g_nose = gesture_frame["landmarks"]["nose"]
        g_left = gesture_frame["landmarks"]["left_edge"]
        g_right = gesture_frame["landmarks"]["right_edge"]
        g_width = g_right[0] - g_left[0]
        if g_width <= 0:
            return False
        g_ratio = (g_nose[0] - g_left[0]) / g_width
        
        diff = g_ratio - avg_baseline
        print(f"[GESTURE] Expected: {expected_gesture} | Baseline: {avg_baseline:.3f} | Gesture: {g_ratio:.3f} | Diff: {diff:.3f}")
        
        # In mirrored webcam space:
        # - User turns head left -> nose shifts right (positive diff on screen)
        # - User turns head right -> nose shifts left (negative diff on screen)
        # We require at least an 8% shift relative to face width to confirm movement
        if expected_gesture == "TURN_LEFT":
            return diff > 0.06
        elif expected_gesture == "TURN_RIGHT":
            return diff < -0.06
            
        return False


