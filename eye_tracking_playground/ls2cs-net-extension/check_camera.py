import cv2

cap = cv2.VideoCapture(0)
ret, frame = cap.read()
if ret:
    print(f"Camera resolution: {frame.shape[1]}x{frame.shape[0]}")
    print(f"Total pixels: {frame.shape[0] * frame.shape[1]:,}")
cap.release()

# Calculate expected timing
width, height = frame.shape[1], frame.shape[0]
test_pixels = 480 * 640
actual_pixels = width * height
ratio = actual_pixels / test_pixels

print(f"\nResolution is {ratio:.1f}x larger than test")
print(f"Expected CPU time: {55.3 * ratio:.1f}ms")
print(f"Expected MPS time: {31.5 * ratio:.1f}ms")
