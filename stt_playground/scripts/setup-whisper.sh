#!/bin/bash
# Setup script for whisper.cpp
# This script clones, compiles whisper.cpp and downloads the model

set -e

WHISPER_DIR="whisper"
REPO_URL="https://github.com/ggerganov/whisper.cpp.git"

echo "Setting up whisper.cpp..."

# Check if cmake is installed
if ! command -v cmake &> /dev/null; then
    echo "Error: cmake is not installed"
    echo "Please install cmake first:"
    echo "  - Using Homebrew: brew install cmake"
    echo "  - Or download from: https://cmake.org/download/"
    exit 1
fi

# Create whisper directory structure
mkdir -p "$WHISPER_DIR/binaries"
mkdir -p "$WHISPER_DIR/models"

cd "$WHISPER_DIR"

# Clone whisper.cpp if not exists
if [ ! -d "whisper.cpp" ]; then
    echo "Cloning whisper.cpp repository..."
    git clone "$REPO_URL"
else
    echo "whisper.cpp repository already exists, skipping clone"
fi

cd whisper.cpp

# Compile for macOS
echo "Compiling whisper.cpp..."
cmake -B build
cmake --build build --config Release

# Copy binary to our binaries folder
echo "Copying binary to binaries folder..."
cp build/bin/whisper-cli ../binaries/whisper-cpp
chmod +x ../binaries/whisper-cpp

# Download model if not exists
if [ ! -f "../models/ggml-small.bin" ]; then
    echo "Downloading small model..."
    bash ./models/download-ggml-model.sh small
    cp models/ggml-small.bin ../models/
    echo "Model downloaded successfully"
else
    echo "Model already exists, skipping download"
fi

cd ../..

echo ""
echo "Whisper.cpp setup complete!"
echo "Binary location: ./whisper/binaries/whisper-cpp"
echo "Model location: ./whisper/models/ggml-small.bin"
