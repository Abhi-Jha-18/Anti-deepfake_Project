import os
import cv2
import numpy as np
import base64
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

class LivenessDetector:
    def __init__(self):
        # Initialize MediaPipe Tasks Face Landmarker
        model_path = os.path.join(os.path.dirname(__file__), 'face_landmarker.task')
        base_options = python.BaseOptions(model_asset_path=model_path)
        options = vision.FaceLandmarkerOptions(
            base_options=base_options,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=False,
            num_faces=1
        )
        self.detector = vision.FaceLandmarker.create_from_options(options)

        
        # Landmark indices for Eye Aspect Ratio (EAR)
        self.LEFT_EYE = [33, 160, 158, 133, 153, 144]
        self.RIGHT_EYE = [362, 385, 387, 263, 373, 380]
        
        # Landmark indices for Iris (reflection checks)
        self.LEFT_IRIS_CENTER = 468
        self.RIGHT_IRIS_CENTER = 473
        
        # Landmark indices for Skin patches
        self.FOREHEAD = 10
        self.LEFT_CHEEK = 117
        self.RIGHT_CHEEK = 346

    def decode_base64_image(self, base64_str):
        """Decodes base64 string to OpenCV BGR image."""
        if ',' in base64_str:
            base64_str = base64_str.split(',')[1]
        img_data = base64.b64decode(base64_str)
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img

    def calculate_ear(self, landmarks, eye_indices, img_w, img_h):
        """Calculates Eye Aspect Ratio (EAR) to detect blinking."""
        coords = []
        for idx in eye_indices:
            lm = landmarks[idx]
            coords.append((lm.x * img_w, lm.y * img_h))
            
        # Distances between vertical eye landmarks
        v1 = np.linalg.norm(np.array(coords[1]) - np.array(coords[5]))
        v2 = np.linalg.norm(np.array(coords[2]) - np.array(coords[4]))
        # Distance between horizontal eye landmarks
        h = np.linalg.norm(np.array(coords[0]) - np.array(coords[3]))
        
        ear = (v1 + v2) / (2.0 * h + 1e-6)
        return ear

    def extract_patch_mean_color(self, img, cx, cy, patch_size=8):
        """Extracts average RGB color in a small bounding box around a coordinate."""
        h, w, _ = img.shape
        x1 = max(0, int(cx - patch_size // 2))
        y1 = max(0, int(cy - patch_size // 2))
        x2 = min(w, int(cx + patch_size // 2))
        y2 = min(h, int(cy + patch_size // 2))
        
        if x2 <= x1 or y2 <= y1:
            return [0, 0, 0]
            
        patch = img[y1:y2, x1:x2]
        # Calculate mean color in BGR and convert to RGB
        mean_bgr = np.mean(patch, axis=(0, 1))
        return [float(mean_bgr[2]), float(mean_bgr[1]), float(mean_bgr[0])] # Return RGB

    def process_frame(self, frame_b64):
        """Processes a single video frame to extract liveness features."""
        try:
            img = self.decode_base64_image(frame_b64)
            if img is None:
                return {"success": False, "error": "Failed to decode image"}
        except Exception as e:
            return {"success": False, "error": f"Image decode error: {str(e)}"}
            
        h, w, c = img.shape
        rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_img)
        results = self.detector.detect(mp_image)
        
        if not results.face_landmarks:
            return {
                "success": False,
                "error": "No face detected. Please position your face in the camera frame."
            }
            
        face_landmarks = results.face_landmarks[0]
        
        # 1. EAR (Eye Aspect Ratio) calculation
        left_ear = self.calculate_ear(face_landmarks, self.LEFT_EYE, w, h)
        right_ear = self.calculate_ear(face_landmarks, self.RIGHT_EYE, w, h)
        avg_ear = (left_ear + right_ear) / 2.0
        
        # 2. Eye Iris Center coordinates
        l_iris_lm = face_landmarks[self.LEFT_IRIS_CENTER]
        r_iris_lm = face_landmarks[self.RIGHT_IRIS_CENTER]
        l_iris_x, l_iris_y = l_iris_lm.x * w, l_iris_lm.y * h
        r_iris_x, r_iris_y = r_iris_lm.x * w, r_iris_lm.y * h
        
        # Extract eye reflection colors (iris patches)
        left_eye_rgb = self.extract_patch_mean_color(img, l_iris_x, l_iris_y, patch_size=8)
        right_eye_rgb = self.extract_patch_mean_color(img, r_iris_x, r_iris_y, patch_size=8)
        avg_eye_rgb = [
            (left_eye_rgb[0] + right_eye_rgb[0]) / 2.0,
            (left_eye_rgb[1] + right_eye_rgb[1]) / 2.0,
            (left_eye_rgb[2] + right_eye_rgb[2]) / 2.0
        ]
        
        # 3. Extract skin reflection colors (forehead and cheeks)
        forehead_lm = face_landmarks[self.FOREHEAD]
        l_cheek_lm = face_landmarks[self.LEFT_CHEEK]
        r_cheek_lm = face_landmarks[self.RIGHT_CHEEK]
        
        forehead_rgb = self.extract_patch_mean_color(img, forehead_lm.x * w, forehead_lm.y * h, patch_size=16)
        l_cheek_rgb = self.extract_patch_mean_color(img, l_cheek_lm.x * w, l_cheek_lm.y * h, patch_size=16)
        r_cheek_rgb = self.extract_patch_mean_color(img, r_cheek_lm.x * w, r_cheek_lm.y * h, patch_size=16)
        
        avg_skin_rgb = [
            (forehead_rgb[0] + l_cheek_rgb[0] + r_cheek_rgb[0]) / 3.0,
            (forehead_rgb[1] + l_cheek_rgb[1] + r_cheek_rgb[1]) / 3.0,
            (forehead_rgb[2] + l_cheek_rgb[2] + r_cheek_rgb[2]) / 3.0
        ]
        
        # 4. Extract landmarks for head pose / motion tracking (nose, chin, left/right face edges)
        motion_landmarks = {
            "nose": [face_landmarks[1].x, face_landmarks[1].y, face_landmarks[1].z],
            "chin": [face_landmarks[152].x, face_landmarks[152].y, face_landmarks[152].z],
            "left_edge": [face_landmarks[234].x, face_landmarks[234].y, face_landmarks[234].z],
            "right_edge": [face_landmarks[454].x, face_landmarks[454].y, face_landmarks[454].z]
        }
        
        # 5. Extract patches for Moiré CNN analysis (forehead and cheeks)
        # We will crop these patches from the image to feed to the CNN
        patches_b64 = []
        for lm in [forehead_lm, l_cheek_lm, r_cheek_lm]:
            cx, cy = int(lm.x * w), int(lm.y * h)
            p_size = 64
            x1 = max(0, cx - p_size // 2)
            y1 = max(0, cy - p_size // 2)
            x2 = min(w, cx + p_size // 2)
            y2 = min(h, cy + p_size // 2)
            
            # Pad if patch is at the edge to keep it exactly 64x64
            patch = img[y1:y2, x1:x2]
            if patch.shape[0] < p_size or patch.shape[1] < p_size:
                patch = cv2.resize(patch, (p_size, p_size))
                
            _, buffer = cv2.imencode('.png', patch)
            p_b64 = base64.b64encode(buffer).decode('utf-8')
            patches_b64.append(p_b64)

        return {
            "success": True,
            "ear": avg_ear,
            "eye_rgb": avg_eye_rgb,
            "skin_rgb": avg_skin_rgb,
            "motion_landmarks": motion_landmarks,
            "patches": patches_b64,
            "left_iris": [float(l_iris_x), float(l_iris_y)],
            "right_iris": [float(r_iris_x), float(r_iris_y)]
        }


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

