#!/usr/bin/env bash
set -euo pipefail

VERSION="2.11.0"
TARGET="$(cd "$(dirname "$0")/.." && pwd)/ntfy"

if [ -f "$TARGET" ]; then
  echo "ntfy already exists at $TARGET"
  exit 0
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  arm64)   ARCH="arm64" ;;
  armv7l)  ARCH="armv7" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

case "$OS" in
  linux|darwin) ;;
  *)
    echo "Unsupported OS: $OS (ntfy server only runs on linux and macOS)"
    exit 1
    ;;
esac

FILENAME="ntfy_${VERSION}_${OS}_${ARCH}.tar.gz"
URL="https://github.com/binwiederhier/ntfy/releases/download/v${VERSION}/${FILENAME}"

echo "Downloading ntfy ${VERSION} for ${OS}/${ARCH}..."
curl -sL -o /tmp/ntfy.tar.gz "$URL"
tar -xzf /tmp/ntfy.tar.gz -C /tmp/
cp "/tmp/ntfy_${VERSION}_${OS}_${ARCH}/ntfy" "$TARGET"
chmod +x "$TARGET"
rm -rf /tmp/ntfy.tar.gz "/tmp/ntfy_${VERSION}_${OS}_${ARCH}"

echo "Installed ntfy to $TARGET"
"$TARGET" --help 2>&1 | head -1
