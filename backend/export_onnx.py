import torch
import moire_detector

def export():
    model_path = "moire_cnn.pth"
    onnx_path = "moire_cnn.onnx"
    
    # 1. Initialize and load model weights
    moire_detector._init_training_classes()
    model = moire_detector.MoireCNN()
    if torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")
        
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.to(device)
    model.eval()
    
    # 2. Define dummy input with dynamic batch size
    # Input shape is (batch_size, 3, 64, 64)
    dummy_input = torch.randn(1, 3, 64, 64, device=device)
    
    # 3. Export to ONNX
    print(f"Exporting PyTorch model to {onnx_path}...")
    torch.onnx.export(
        model, 
        dummy_input, 
        onnx_path, 
        export_params=True, 
        opset_version=11, 
        do_constant_folding=True, 
        input_names=['input'], 
        output_names=['output'],
        dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
    )
    print("Export complete!")

if __name__ == "__main__":
    export()
