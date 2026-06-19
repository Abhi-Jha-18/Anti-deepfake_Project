import os
import cv2
import numpy as np
from PIL import Image

def create_synthetic_skin_patch(size=64):
    """Generates a random skin-toned patch with smooth organic gradients, blur, JPEG compression, and minor noise."""
    # Base skin tone profile selection
    tone = np.random.choice(['pale', 'medium', 'dark', 'asian', 'olive'])
    if tone == 'pale':
        r = np.random.randint(230, 255)
        g = np.random.randint(190, 220)
        b = np.random.randint(170, 200)
    elif tone == 'medium':
        r = np.random.randint(200, 235)
        g = np.random.randint(150, 185)
        b = np.random.randint(120, 155)
    elif tone == 'dark':
        r = np.random.randint(90, 150)
        g = np.random.randint(60, 110)
        b = np.random.randint(45, 90)
    elif tone == 'asian':
        r = np.random.randint(220, 245)
        g = np.random.randint(180, 205)
        b = np.random.randint(130, 160)
    else: # olive
        r = np.random.randint(180, 215)
        g = np.random.randint(140, 175)
        b = np.random.randint(100, 135)
        
    # Create solid base
    patch = np.zeros((size, size, 3), dtype=np.uint8)
    patch[:, :, 0] = r
    patch[:, :, 1] = g
    patch[:, :, 2] = b
    
    # Add a soft organic gradient (simulating light/shadow on face)
    X, Y = np.meshgrid(np.arange(size), np.arange(size))
    center_x, center_y = np.random.randint(0, size), np.random.randint(0, size)
    radius = np.random.randint(size//2, size*2)
    dist = np.sqrt((X - center_x)**2 + (Y - center_y)**2)
    grad = np.clip(1.0 - (dist / radius), 0, 1)
    
    # Scale gradient effect
    grad_intensity = np.random.uniform(0.1, 0.4)
    for c in range(3):
        patch[:, :, c] = np.clip(patch[:, :, c] * (1 - grad_intensity + grad * grad_intensity), 0, 255)
        
    # Add Eyebrow/feature/shadow overlays
    if np.random.rand() > 0.4:
        feat_type = np.random.choice(['feature', 'shadow'])
        feat_x = np.random.randint(size//4, 3*size//4)
        feat_y = np.random.randint(size//4, 3*size//4)
        feat_r = np.random.randint(8, 24)
        feat_dist = np.sqrt((X - feat_x)**2 + (Y - feat_y)**2)
        feat_mask = np.clip(1.0 - (feat_dist / feat_r), 0, 1)
        
        if feat_type == 'shadow':
            darkness = np.random.uniform(0.3, 0.7)
            for c in range(3):
                patch[:, :, c] = np.clip(patch[:, :, c] * (1 - feat_mask * darkness), 0, 255)
        else:
            for c in range(3):
                mult = [1.1, 0.8, 0.8] if c == 0 else [0.9, 0.9, 0.9]
                patch[:, :, c] = np.clip(patch[:, :, c] * (1 - feat_mask + feat_mask * mult[c]), 0, 255)

    # Add noise
    noise = np.random.normal(0, np.random.uniform(1.0, 3.5), (size, size, 3))
    patch = np.clip(patch.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    
    # Add random focus blur (30% chance)
    if np.random.rand() < 0.3:
        k = np.random.choice([3, 5])
        patch = cv2.GaussianBlur(patch, (k, k), 0)
        
    # Add random JPEG compression artifacts (40% chance)
    if np.random.rand() < 0.4:
        qual = np.random.randint(35, 85)
        _, enc = cv2.imencode('.jpg', patch, [int(cv2.IMWRITE_JPEG_QUALITY), qual])
        patch = cv2.imdecode(enc, cv2.IMREAD_COLOR)
        
    return patch

def add_moire_pattern(patch, size=64):
    """Adds screen capture artifacts: moire grid lines, chromatic aberration, scanlines, and glare."""
    img = patch.copy().astype(np.float32) / 255.0
    
    # 1. Chromatic Aberration (Simulate LCD subpixel misalignment)
    # Shifting the red and blue channels independently by up to 2 pixels
    shift_x = np.random.randint(-2, 3)
    shift_y = np.random.randint(-2, 3)
    if shift_x == 0 and shift_y == 0:
        shift_x = 1
        
    m_r = np.roll(img[:, :, 0], shift_x, axis=1)
    m_r = np.roll(m_r, shift_y, axis=0)
    m_b = np.roll(img[:, :, 2], -shift_x, axis=1)
    m_b = np.roll(m_b, -shift_y, axis=0)
    img[:, :, 0] = m_r
    img[:, :, 2] = m_b

    # 2. Moiré Interference Pattern (2D Sine Waves)
    X, Y = np.meshgrid(np.arange(size), np.arange(size))
    
    # Random angle and frequency for moire lines
    angle1 = np.random.uniform(0, np.pi)
    freq1 = np.random.uniform(0.12, 0.55)  # High-frequency lines
    amplitude1 = np.random.uniform(0.04, 0.22)
    
    grid1 = np.sin(2 * np.pi * freq1 * (X * np.cos(angle1) + Y * np.sin(angle1)))
    
    # Optional second intersecting grid (cross-hatching)
    if np.random.rand() > 0.4:
        angle2 = angle1 + np.random.uniform(np.pi/6, np.pi/2)
        freq2 = np.random.uniform(0.12, 0.55)
        amplitude2 = np.random.uniform(0.03, 0.15)
        grid2 = np.sin(2 * np.pi * freq2 * (X * np.cos(angle2) + Y * np.sin(angle2)))
        moire_grid = (grid1 * amplitude1 + grid2 * amplitude2)
    else:
        moire_grid = grid1 * amplitude1
        
    # Apply moire grid
    for c in range(3):
        img[:, :, c] = np.clip(img[:, :, c] + moire_grid, 0.0, 1.0)
        
    # 3. Scan Lines (horizontal or vertical dark lines)
    scan_freq = np.random.uniform(0.25, 0.85)
    scan_amp = np.random.uniform(0.02, 0.09)
    axis_choice = np.random.choice([0, 1])
    coords = Y if axis_choice == 0 else X
    scan_lines = np.sin(2 * np.pi * scan_freq * coords) * scan_amp
    for c in range(3):
        img[:, :, c] = np.clip(img[:, :, c] + scan_lines, 0.0, 1.0)
        
    # 4. Glare / Bright spot (Simulates reflection on screen glass)
    if np.random.rand() > 0.35:
        glare_x = np.random.randint(0, size)
        glare_y = np.random.randint(0, size)
        glare_r = np.random.randint(size//4, size)
        glare_dist = np.sqrt((X - glare_x)**2 + (Y - glare_y)**2)
        glare_mask = np.clip(1.0 - (glare_dist / glare_r), 0, 1) ** 2
        glare_intensity = np.random.uniform(0.1, 0.4)
        for c in range(3):
            img[:, :, c] = np.clip(img[:, :, c] + glare_mask * glare_intensity, 0.0, 1.0)

    # Convert back to uint8
    screen_patch = (img * 255.0).astype(np.uint8)
    
    # Add random focus blur (30% chance)
    if np.random.rand() < 0.3:
        k = np.random.choice([3, 5])
        screen_patch = cv2.GaussianBlur(screen_patch, (k, k), 0)
        
    # Add random JPEG compression (40% chance)
    if np.random.rand() < 0.4:
        qual = np.random.randint(35, 85)
        _, enc = cv2.imencode('.jpg', screen_patch, [int(cv2.IMWRITE_JPEG_QUALITY), qual])
        screen_patch = cv2.imdecode(enc, cv2.IMREAD_COLOR)
        
    return screen_patch

def generate_dataset(dataset_dir="dataset", num_samples=300, patch_size=64):
    """Generates and saves the synthetic dataset, cleaning up old samples first."""
    real_dir = os.path.join(dataset_dir, "real")
    screen_dir = os.path.join(dataset_dir, "screen")
    
    # Clean up old samples if they exist
    for directory in [real_dir, screen_dir]:
        if os.path.exists(directory):
            for filename in os.listdir(directory):
                file_path = os.path.join(directory, filename)
                try:
                    if os.path.isfile(file_path):
                        os.remove(file_path)
                except Exception as e:
                    print(f"Error deleting file {file_path}: {e}")
                    
    os.makedirs(real_dir, exist_ok=True)
    os.makedirs(screen_dir, exist_ok=True)
    
    print(f"Generating {num_samples} samples per class of size {patch_size}x{patch_size}...")
    
    for i in range(num_samples):
        # Generate real patch
        real_patch = create_synthetic_skin_patch(patch_size)
        real_path = os.path.join(real_dir, f"real_{i:04d}.png")
        cv2.imwrite(real_path, cv2.cvtColor(real_patch, cv2.COLOR_RGB2BGR))
        
        # Generate screen patch (using same base skin tone to avoid model learning skin color)
        screen_patch = add_moire_pattern(real_patch, patch_size)
        screen_path = os.path.join(screen_dir, f"screen_{i:04d}.png")
        cv2.imwrite(screen_path, cv2.cvtColor(screen_patch, cv2.COLOR_RGB2BGR))
        
    print(f"Dataset generated at {os.path.abspath(dataset_dir)}")

if __name__ == "__main__":
    generate_dataset()
