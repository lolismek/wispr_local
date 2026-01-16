import torch
import time
import numpy as np
from l2cs import getArch
import pathlib

CWD = pathlib.Path.cwd()

# Create model
model = getArch('ResNet50', 90)
model.load_state_dict(torch.load(CWD / 'models' / 'L2CSNet_gaze360.pkl', map_location='cpu'))

# Test on CPU
model.to('cpu')
model.eval()

dummy_input = torch.randn(1, 3, 224, 224).to('cpu')

with torch.no_grad():
    # Warmup
    for _ in range(3):
        _ = model(dummy_input)

    # Time CPU
    t1 = time.time()
    for _ in range(10):
        _ = model(dummy_input)
    t2 = time.time()
    cpu_time = (t2 - t1) / 10 * 1000
    print(f"CPU inference time: {cpu_time:.1f}ms")

# Test on MPS
if torch.backends.mps.is_available():
    model.to('mps')
    dummy_input_mps = torch.randn(1, 3, 224, 224).to('mps')

    with torch.no_grad():
        # Warmup
        for _ in range(3):
            _ = model(dummy_input_mps)

        # Time MPS
        t1 = time.time()
        for _ in range(10):
            _ = model(dummy_input_mps)
        t2 = time.time()
        mps_time = (t2 - t1) / 10 * 1000
        print(f"MPS inference time: {mps_time:.1f}ms")
        print(f"Speedup: {cpu_time/mps_time:.1f}x")
else:
    print("MPS not available")
