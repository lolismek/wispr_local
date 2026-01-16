import argparse
import pathlib
import numpy as np
import cv2
import time

import torch
import torch.nn as nn
from torch.autograd import Variable
from torchvision import transforms
import torch.backends.cudnn as cudnn
import torchvision

from PIL import Image
from PIL import Image, ImageOps

from face_detection import RetinaFace

from l2cs import select_device, draw_gaze, getArch, Pipeline, render

CWD = pathlib.Path.cwd()

class MPSRetinaFace(RetinaFace):
    """RetinaFace wrapper with MPS support"""

    def __init__(self, device=None, **kwargs):
        if device is None or device.type == 'cpu':
            super().__init__(gpu_id=-1, **kwargs)
        elif device.type == 'cuda':
            super().__init__(gpu_id=device.index or 0, **kwargs)
        elif device.type == 'mps':
            # Initialize on CPU first
            super().__init__(gpu_id=-1, **kwargs)
            # Move model to MPS
            self.device = device
            self.model.to(device)
        else:
            super().__init__(gpu_id=-1, **kwargs)

class MPSPipeline(Pipeline):
    """Pipeline wrapper that handles MPS device for Apple Silicon"""

    def __init__(self, weights, arch, device, detection_resolution=None, **kwargs):
        # Store the target device and detection resolution
        self.target_device = device
        self.detection_resolution = detection_resolution  # (width, height) tuple or None

        # Initialize Pipeline (this will create gaze model and detector)
        if device.type == 'mps':
            # Initialize with CPU, then move components to MPS
            super().__init__(weights, arch, torch.device('cpu'), **kwargs)
            # Move the gaze model to MPS
            self.model.to(device)
            self.device = device
            self.idx_tensor = self.idx_tensor.to(device)
            # Replace CPU detector with MPS detector
            self.detector = MPSRetinaFace(device=device)
            print("✓ Gaze model on MPS")
            print("✓ Face detector on MPS")
            if detection_resolution:
                print(f"✓ Face detection resolution: {detection_resolution[0]}x{detection_resolution[1]}")
        else:
            super().__init__(weights, arch, device, **kwargs)
            if detection_resolution:
                print(f"✓ Face detection resolution: {detection_resolution[0]}x{detection_resolution[1]}")

    def step(self, frame):
        """Override step to add profiling and optional downscaling"""
        import time

        t_start = time.time()

        # Store original frame dimensions
        orig_height, orig_width = frame.shape[:2]

        # Optionally resize frame for face detection
        if self.detection_resolution:
            det_width, det_height = self.detection_resolution
            if det_width > 0 and det_height > 0:
                detection_frame = cv2.resize(frame, (det_width, det_height))
                scale_x = orig_width / det_width
                scale_y = orig_height / det_height
            else:
                detection_frame = frame
                scale_x = scale_y = 1.0
        else:
            detection_frame = frame
            scale_x = scale_y = 1.0

        # Face detection
        t1 = time.time()
        faces = self.detector(detection_frame)
        t2 = time.time()

        face_imgs = []
        bboxes = []
        landmarks = []
        scores = []

        if faces is not None:
            for box, landmark, score in faces:
                if score < self.confidence_threshold:
                    continue

                # Scale bounding box back to original resolution
                x_min = max(0, int(box[0] * scale_x))
                y_min = max(0, int(box[1] * scale_y))
                x_max = int(box[2] * scale_x)
                y_max = int(box[3] * scale_y)

                # Crop from ORIGINAL resolution frame for better quality
                img = frame[y_min:y_max, x_min:x_max]
                img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                img = cv2.resize(img, (224, 224))
                face_imgs.append(img)

                # Store scaled bounding box and landmarks
                scaled_box = [box[0] * scale_x, box[1] * scale_y, box[2] * scale_x, box[3] * scale_y]
                scaled_landmark = landmark * np.array([scale_x, scale_y])

                bboxes.append(scaled_box)
                landmarks.append(scaled_landmark)
                scores.append(score)

            if len(face_imgs) > 0:
                # Gaze prediction
                t3 = time.time()
                pitch, yaw = self.predict_gaze(np.stack(face_imgs))
                t4 = time.time()

                print(f"  Face detection: {(t2-t1)*1000:.1f}ms | Gaze prediction: {(t4-t3)*1000:.1f}ms | Total: {(t4-t_start)*1000:.1f}ms")
            else:
                pitch = np.empty((0,1))
                yaw = np.empty((0,1))
        else:
            pitch = np.empty((0,1))
            yaw = np.empty((0,1))

        from l2cs.results import GazeResultContainer
        results = GazeResultContainer(
            pitch=pitch,
            yaw=yaw,
            bboxes=np.stack(bboxes) if len(bboxes) > 0 else np.empty((0,4)),
            landmarks=np.stack(landmarks) if len(landmarks) > 0 else np.empty((0,5,2)),
            scores=np.stack(scores) if len(scores) > 0 else np.empty((0,))
        )

        return results

def parse_args():
    """Parse input arguments."""
    parser = argparse.ArgumentParser(
        description='Gaze evalution using model pretrained with L2CS-Net on Gaze360.')
    parser.add_argument(
        '--device',dest='device', help='Device to run model: cpu or gpu:0',
        default="cpu", type=str)
    parser.add_argument(
        '--snapshot',dest='snapshot', help='Path of model snapshot.', 
        default='output/snapshots/L2CS-gaze360-_loader-180-4/_epoch_55.pkl', type=str)
    parser.add_argument(
        '--cam',dest='cam_id', help='Camera device id to use [0]',  
        default=0, type=int)
    parser.add_argument(
        '--arch',dest='arch',help='Network architecture, can be: ResNet18, ResNet34, ResNet50, ResNet101, ResNet152',
        default='ResNet50', type=str)
    parser.add_argument(
        '--fd-width',dest='fd_width', help='Width to resize frame for face detection (0 = no resize)',
        default=640, type=int)
    parser.add_argument(
        '--fd-height',dest='fd_height', help='Height to resize frame for face detection (0 = no resize)',
        default=480, type=int)

    args = parser.parse_args()
    return args

if __name__ == '__main__':
    args = parse_args()

    cudnn.enabled = True
    arch=args.arch
    cam = args.cam_id
    # snapshot_path = args.snapshot

    # Select device with MPS support for Apple Silicon
    # Check for explicit CPU request or auto-detect best device
    if args.device.lower() == 'cpu':
        # User explicitly wants CPU only if they pass --device cpu
        # Otherwise, auto-detect best available device
        if torch.cuda.is_available():
            device = torch.device('cuda:0')
            print("Using CUDA GPU for acceleration")
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            device = torch.device('mps')
            print("Using MPS (Apple Silicon GPU) for acceleration")
        else:
            device = torch.device('cpu')
            print("Using CPU (no GPU available)")
    elif args.device.lower().startswith('gpu'):
        # Legacy gpu:0 format
        if torch.cuda.is_available():
            device = torch.device('cuda:0')
            print("Using CUDA GPU for acceleration")
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            device = torch.device('mps')
            print("Using MPS (Apple Silicon GPU) for acceleration")
        else:
            device = torch.device('cpu')
            print("GPU requested but not available, using CPU")
    else:
        device = torch.device('cpu')
        print("Using CPU")

    # Setup detection resolution
    detection_resolution = None
    if args.fd_width > 0 and args.fd_height > 0:
        detection_resolution = (args.fd_width, args.fd_height)

    gaze_pipeline = MPSPipeline(
        weights=CWD / 'models' / 'L2CSNet_gaze360.pkl',
        arch='ResNet50',
        device=device,
        detection_resolution=detection_resolution
    )
     
    cap = cv2.VideoCapture(cam)

    # Check if the webcam is opened correctly
    if not cap.isOpened():
        raise IOError("Cannot open webcam")

    with torch.no_grad():
        while True:

            # Get frame
            success, frame = cap.read()    
            start_fps = time.time()  

            if not success:
                print("Failed to obtain frame")
                time.sleep(0.1)
                continue

            # Process frame
            try:
                results = gaze_pipeline.step(frame)
                # Visualize output
                frame = render(frame, results)
            except ValueError:
                # No faces detected in this frame, just show the frame as-is
                pass
           
            myFPS = 1.0 / (time.time() - start_fps)
            cv2.putText(frame, 'FPS: {:.1f}'.format(myFPS), (10, 20),cv2.FONT_HERSHEY_COMPLEX_SMALL, 1, (0, 255, 0), 1, cv2.LINE_AA)

            cv2.imshow("Demo",frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
            success,frame = cap.read()  
    
