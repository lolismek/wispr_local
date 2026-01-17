#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building ax-text-finder Swift monitor..."
swift build -c release

# Copy binary to a known location
cp .build/release/ax-text-finder ../dist/ax-text-finder 2>/dev/null || mkdir -p ../dist && cp .build/release/ax-text-finder ../dist/

echo "Build complete: dist/ax-text-finder"
