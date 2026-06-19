import os
import cv2
import numpy as np
import base64

# Lazy load PyTorch classes for training
MoireCNN = None
MoireDataset = None

def _init_training_classes():
    global MoireCNN, MoireDataset
    if MoireCNN is not None:
        return
    import torch
    import torch.nn as nn
    from torch.utils.data import Dataset
    from PIL import Image
    
    class PyTorchMoireCNN(nn.Module):
        def __init__(self):
            super(PyTorchMoireCNN, self).__init__()
            self.features = nn.Sequential(
                # Input: 3 x 64 x 64
                nn.Conv2d(3, 16, kernel_size=3, padding=1),
                nn.BatchNorm2d(16),
                nn.ReLU(),
                nn.MaxPool2d(kernel_size=2, stride=2), # Output: 16 x 32 x 32
                
                nn.Conv2d(16, 32, kernel_size=3, padding=1),
                nn.BatchNorm2d(32),
                nn.ReLU(),
                nn.MaxPool2d(kernel_size=2, stride=2), # Output: 32 x 16 x 16
                
                nn.Conv2d(32, 64, kernel_size=3, padding=1),
                nn.BatchNorm2d(64),
                nn.ReLU(),
                nn.MaxPool2d(kernel_size=2, stride=2), # Output: 64 x 8 x 8
            )
            self.classifier = nn.Sequential(
                nn.Linear(64 * 8 * 8, 128),
                nn.ReLU(),
                nn.Dropout(0.5),
                nn.Linear(128, 2) # Classes: 0 = Real, 1 = Screen (Spoof)
            )

        def forward(self, x):
            x = self.features(x)
            x = x.view(x.size(0), -1)
            x = self.classifier(x)
            return x

    class PyTorchMoireDataset(Dataset):
        def __init__(self, data_dir, transform=None):
            self.data_dir = data_dir
            self.transform = transform
            self.samples = []
            
            real_dir = os.path.join(data_dir, "real")
            screen_dir = os.path.join(data_dir, "screen")
            
            # Load real images (Label 0)
            if os.path.exists(real_dir):
                for f in os.listdir(real_dir):
                    if f.endswith('.png') or f.endswith('.jpg'):
                        self.samples.append((os.path.join(real_dir, f), 0))
                        
            # Load screen images (Label 1)
            if os.path.exists(screen_dir):
                for f in os.listdir(screen_dir):
                    if f.endswith('.png') or f.endswith('.jpg'):
                        self.samples.append((os.path.join(screen_dir, f), 1))
                        
        def __len__(self):
            return len(self.samples)
            
        def __getitem__(self, idx):
            path, label = self.samples[idx]
            image = Image.open(path).convert('RGB')
            
            if self.transform:
                image = self.transform(image)
                
            return image, label

    MoireCNN = PyTorchMoireCNN
    MoireDataset = PyTorchMoireDataset

def train_model(data_dir="dataset", model_path="moire_cnn.pth", epochs=15, batch_size=32, force_generate=True):
    print("Initializing Moire CNN Training...")
    _init_training_classes()
    
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader
    from torchvision import transforms
    
    # Check if dataset exists or force generate is requested
    if force_generate or not os.path.exists(os.path.join(data_dir, "real")) or len(os.listdir(os.path.join(data_dir, "real"))) == 0:
        print("Generating fresh high-capacity synthetic dataset of 4000 samples per class...")
        from generate_dataset import generate_dataset
        generate_dataset(data_dir, num_samples=4000, patch_size=64)
        
    # Image preprocessing and augmentation
    transform_train = transforms.Compose([
        transforms.RandomHorizontalFlip(),
        transforms.RandomVerticalFlip(),
        transforms.RandomRotation(15),
        transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])
    
    transform_val = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])
    
    # Load dataset
    full_dataset = MoireDataset(data_dir, transform=transform_train)
    if len(full_dataset) == 0:
        raise ValueError(f"No samples found in dataset directory: {data_dir}")
        
    # Split into Train and Validation sets (80/20)
    train_size = int(0.8 * len(full_dataset))
    val_size = len(full_dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(full_dataset, [train_size, val_size])
    
    # Update transform for validation set
    val_dataset.dataset.transform = transform_val
    
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")
    
    model = MoireCNN().to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001, weight_decay=1e-4)
    
    # Training Loop
    for epoch in range(epochs):
        model.train()
        running_loss = 0.0
        correct = 0
        total = 0
        
        for inputs, labels in train_loader:
            inputs, labels = inputs.to(device), labels.to(device)
            
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            
            running_loss += loss.item() * inputs.size(0)
            _, predicted = outputs.max(1)
            total += labels.size(0)
            correct += predicted.eq(labels).sum().item()
            
        epoch_loss = running_loss / len(train_dataset)
        epoch_acc = correct / total
        
        # Validation Phase
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        
        with torch.no_grad():
            for inputs, labels in val_loader:
                inputs, labels = inputs.to(device), labels.to(device)
                outputs = model(inputs)
                loss = criterion(outputs, labels)
                
                val_loss += loss.item() * inputs.size(0)
                _, predicted = outputs.max(1)
                val_total += labels.size(0)
                val_correct += predicted.eq(labels).sum().item()
                
        val_epoch_loss = val_loss / len(val_dataset)
        val_epoch_acc = val_correct / val_total
        
        print(f"Epoch {epoch+1}/{epochs} - Train Loss: {epoch_loss:.4f} Acc: {epoch_acc:.4f} | Val Loss: {val_epoch_loss:.4f} Acc: {val_epoch_acc:.4f}")
        
    # Save the trained model
    torch.save(model.state_dict(), model_path)
    print(f"Model trained successfully and saved to {os.path.abspath(model_path)}")
    return model

# Model Inference via ONNX Runtime
class MoirePredictor:
    def __init__(self, model_path="moire_cnn.pth"):
        self.model_path = model_path
        self.session = None
        self.load_model()
        
    def load_model(self):
        onnx_model_path = self.model_path.replace(".pth", ".onnx")
        if os.path.exists(onnx_model_path):
            import onnxruntime
            self.session = onnxruntime.InferenceSession(onnx_model_path)
            print(f"Moire CNN loaded weights from {onnx_model_path} via ONNX Runtime.")
        else:
            print(f"ONNX model not found at {onnx_model_path}. Predictor initialized in fallback mode.")
            self.session = None

    def predict_numpy_patches(self, patches_np):
        """
        Predicts whether face patches contain moire screen lines using batched ONNX Runtime inference.
        patches_np: List of numpy BGR images (64x64)
        Returns: Max screen spoof probability (0.0 to 1.0)
        """
        if self.session is None:
            self.load_model()
            if self.session is None:
                return 0.0
                
        spoof_probs = []
        preprocessed_patches = []
        
        for img in patches_np:
            try:
                if img is None:
                    continue
                # 1. Resize to 64x64
                img_resized = cv2.resize(img, (64, 64))
                # 2. Convert BGR to RGB
                img_rgb = cv2.cvtColor(img_resized, cv2.COLOR_BGR2RGB)
                # 3. Convert to float32 and scale to [0, 1]
                img_float = img_rgb.astype(np.float32) / 255.0
                # 4. Transpose from (H, W, C) to (C, H, W)
                img_transposed = img_float.transpose(2, 0, 1)
                # 5. Normalize: (x - mean) / std
                mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
                std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)
                img_normalized = (img_transposed - mean) / std
                
                preprocessed_patches.append(img_normalized)
            except Exception as e:
                print(f"Error preprocessing patch: {str(e)}")
                continue
                
        if len(preprocessed_patches) == 0:
            return 0.0
            
        try:
            # Batch inference: stack along axis 0
            batch_input = np.stack(preprocessed_patches, axis=0) # Shape: (N, 3, 64, 64)
            
            # Run ONNX inference session
            input_name = self.session.get_inputs()[0].name
            ort_inputs = {input_name: batch_input}
            ort_outputs = self.session.run(None, ort_inputs)
            
            # Postprocess outputs (Apply Softmax in NumPy)
            logits = ort_outputs[0] # Shape: (N, 2)
            exp_logits = np.exp(logits - np.max(logits, axis=1, keepdims=True))
            probs = exp_logits / np.sum(exp_logits, axis=1, keepdims=True)
            
            # Class 1 is screen spoof
            spoof_probs = probs[:, 1]
            return float(np.max(spoof_probs))
        except Exception as e:
            print(f"Error during ONNX batch inference: {str(e)}")
            return 0.0

    def predict_patches(self, patches_b64):
        """
        Predicts whether face patches contain moire screen lines.
        patches_b64: List of base64-encoded cropped image patches (64x64)
        Returns: Max screen spoof probability (0.0 to 1.0)
        """
        patches_np = []
        for p_b64 in patches_b64:
            try:
                img_data = base64.b64decode(p_b64)
                nparr = np.frombuffer(img_data, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if img is not None:
                    patches_np.append(img)
            except Exception as e:
                print(f"Error decoding base64 patch: {str(e)}")
                
        return self.predict_numpy_patches(patches_np)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", action="store_true", help="Train the model")
    args = parser.parse_args()
    
    if args.train:
        train_model()
