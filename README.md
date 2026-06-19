# Anti-Deepfake KYC Verification Guard (Liveness Detection)

This project implements a real-time **Liveness Detection** system to secure financial app onboarding (KYC) against deepfake bypasses, high-resolution photo presentation attacks, and pre-recorded video replays.

## System Architecture

The application is structured into two main components:
1. **Frontend (Glassmorphic Web Interface)**:
   - Captures camera frames from the user's webcam.
   - Coordinates an **Active Challenge-Response** sequence by flashing random colors on the user's screen.
   - Draws target overlays on the eyes/iris where reflection matching is processed.
   - Displays real-time metrics (Moiré score, EAR blink index, and head pose variance).
2. **Backend (Python Flask API)**:
   - **Facial Landmark & Reflection Analysis**: Tracks the face using MediaPipe FaceMesh. Computes average eye and skin colors, then applies **baseline subtraction** across the session's flash sequence to detect color-synchronized reflections.
   - **Blink & Motion Verification**: Checks the Eye Aspect Ratio (EAR) for blink patterns and verifies head pose variance to block completely static photo presentations.
   - **Moiré Pattern Detection (CNN)**: Analyzes face crops (forehead/cheeks) using a lightweight PyTorch Convolutional Neural Network (CNN) trained to identify high-frequency interference lines when a camera records a digital screen.

---

## Directory Structure

```
anti-deepfake-kyc/
├── backend/
│   ├── app.py                # Flask API server
│   ├── liveness_detector.py  # Face tracking and challenge-response logic
│   ├── generate_dataset.py   # Synthetic screen-spoor dataset generator
│   ├── moire_detector.py     # PyTorch CNN definition & training loop
│   ├── moire_cnn.pth         # Trained model weights (automatically generated)
│   └── requirements.txt      # Python dependencies
├── frontend/
│   ├── index.html            # UI Structure
│   ├── style.css             # Cyberpunk glassmorphism styles
│   └── app.js                # State management and camera controller
└── README.md                 # Project instructions
```

---

## Installation & Running the Server

### Prerequisites
- Python 3.10+
- Google Chrome or Microsoft Edge (with camera permissions allowed)

### Step 1: Install Dependencies
Navigate to the `backend/` folder and install dependencies:
```bash
pip install -r requirements.txt
```
*(This installs Flask, Flask-CORS, OpenCV-Python, MediaPipe, PyTorch CPU, Pillow, and Matplotlib).*

### Step 2: Start the Backend Server
Run the Flask server:
```bash
python backend/app.py
```
This runs the API on `http://localhost:5000`.

### Step 3: Run the Frontend
Since the frontend consists of static `index.html`, `style.css`, and `app.js` files, you can open `frontend/index.html` directly in your browser:
- Double-click `frontend/index.html` to open it in Chrome/Edge, OR
- Serve it using a lightweight server, for example:
  ```bash
  npx serve frontend
  ```

---

## Testing Guide

Once the browser interface is loaded and connected to the API (indicated by the green status dot at the top right):

### 1. Training the CNN Model
If the model weights `moire_cnn.pth` are already generated, the API will display **Ready (CNN Trained)**.
If they are not present, click the **Train Moire CNN** button on the UI. The server will generate 800 synthetic patches and train the PyTorch model locally in less than 30 seconds.

### 2. Live Verification Scenarios

Click **Start Liveness Check** to initiate the sequence:

- **Scenario A: Genuine User (PASS)**
  - Position your face inside the dashed overlay guide.
  - The screen will flash a randomized color sequence (e.g., Red, Blue, Yellow, Green).
  - Look straight at the camera.
  - The eye iris target dots will track your eyes.
  - **Result**: You should see **KYC VERIFICATION PASSED** with your reflection matching score, green indicators, and normal motion variance.

- **Scenario B: Printed Photo Attack (BLOCK)**
  - Hold a high-resolution printed photo of a face in front of the camera, or hold a face completely still on a stand.
  - The verification will run, but:
    - The face motion variance will register as extremely low/zero.
    - No blink pattern will be detected.
    - **Result**: Blocked with **Static Spoof Detected (No facial micro-movements)**.

- **Scenario C: Digital Screen Replay Attack (BLOCK)**
  - Use your smartphone to display a photo or play a video of your face, and hold it up to the computer camera.
  - The webcam will capture the smartphone screen.
  - **Result**: Blocked with **Digital Screen Spoof Detected (Moiré interference lines identified)**. The CNN will flag the high-frequency pixel grid of your phone screen.

- **Scenario D: Out-of-sync Video Playback (BLOCK)**
  - If an attacker plays back a video of a victim but does not sync the screen flashing, or attempts to spoof the camera feed:
  - **Result**: Blocked with **Reflection Spoof Detected** (as the color reflections won't match the random sequence flashed on the screen).
