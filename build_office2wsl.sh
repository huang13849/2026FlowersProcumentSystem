#!/bin/bash
# build_office2wsl.sh - Build script that runs on xspt05 (office2-wsl WSL2)
# Usage: env GITEA_URL=... REPO_DIR=... BUILD_PATH=... IMAGE=... bash build_office2wsl.sh
# BUILD_PATH is the subdirectory inside the repo that contains Dockerfile
#   e.g. "" (empty = repo root) or "shop-service"
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

GITEA_URL="${GITEA_URL:-}"
REPO_DIR="${REPO_DIR:-}"
BUILD_PATH="${BUILD_PATH:-}"  # 子目录 (相对 REPO_DIR); 空=仓库根目录
IMAGE="${IMAGE:-}"

if [ -z "$GITEA_URL" ] || [ -z "$REPO_DIR" ] || [ -z "$IMAGE" ]; then
  echo "ERROR: need GITEA_URL, REPO_DIR, IMAGE env vars" >&2
  exit 10
fi

cd "$REPO_DIR"
if [ ! -d .git ]; then
  git clone "$GITEA_URL" .
fi
git fetch origin
git reset --hard origin/main
git clean -fd

if [ -n "$BUILD_PATH" ]; then
  cd "$BUILD_PATH"
fi

# 验证 Dockerfile 存在
if [ ! -f Dockerfile ]; then
  echo "ERROR: Dockerfile not found in $(pwd)" >&2
  ls -la
  exit 11
fi

docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"

echo "$IMAGE" | sed 's|.*:||' > /tmp/last_tag.txt
echo "BUILD_OK image=$IMAGE"
