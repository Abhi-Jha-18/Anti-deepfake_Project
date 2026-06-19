import os
import cv2
import numpy as np
import base64
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image

# 1. CNN Model Definition
class MoireCNN(nn.Module):
    def __init__(self):
        super(MoireCNN, self).__init__()
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

# 2. PyTorch Dataset Loader
class MoireDataset(Dataset):
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

def train_model(data_dir="dataset", model_path="moire_cnn.pth", epochs=15, batch_size=32, force_generate=True):
    print("Initializing Moire CNN Training...")
    
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

# 4. Model Inference
class MoirePredictor:
    def __init__(self, model_path="moire_cnn.pth"):
        self.model_path = model_path
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = None
        self.transform = transforms.Compose([
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        self.load_model()
        
    def load_model(self):
        if os.path.exists(self.model_path):
            self.model = MoireCNN().to(self.device)
            # Load weights mapping to CPU or GPU automatically
            self.model.load_state_dict(torch.load(self.model_path, map_location=self.device))
            self.model.eval()
            print(f"Moire CNN loaded weights from {self.model_path}")
        else:
            print(f"Model weights not found at {self.model_path}. Predictor initialized in fallback mode.")
            self.model = None

    def predict_patches(self, patches_b64):
        """
        Predicts whether face patches contain moire screen lines.
        patches_b64: List of base64-encoded cropped image patches (64x64)
        Returns: Average screen spoof probability (0.0 to 1.0)
        """
        # Fallback if model is not loaded yet
        if self.model is None:
            # Check if model has been trained in the background
            self.load_model()
            if self.model is None:
                # Return default zero probability if not trained
                return 0.0
                
        spoof_probs = []
        
        for p_b64 in patches_b64:
            try:
                # Decode patch image
                img_data = base64.b64decode(p_b64)
                nparr = np.frombuffer(img_data, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if img is None:
                    continue
                    
                # Preprocess patch
                img = cv2.resize(img, (64, 64))
                img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                pil_img = Image.fromarray(img_rgb)
                tensor_img = self.transform(pil_img).unsqueeze(0).to(self.device)
                
                # Model inference
                with torch.no_grad():
                    outputs = self.model(tensor_img)
                    probs = torch.softmax(outputs, dim=1)
                    # Class 1 is screen spoof
                    spoof_prob = float(probs[0][1].item())
                    spoof_probs.append(spoof_prob)
            except Exception as e:
                print(f"Error predicting patch: {str(e)}")
                continue
                
        if len(spoof_probs) == 0:
            return 0.0
            
        # Return the maximum probability of spoof across all cropped patches (forehead, left cheek, right cheek)
        # Using max is safer for security than average, as moire might be stronger on forehead than cheeks
        return float(np.max(spoof_probs))

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", action="store_true", help="Train the model")
    args = parser.parse_args()
    
    if args.train:
        train_model()
