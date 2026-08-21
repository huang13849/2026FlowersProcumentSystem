#!/bin/bash
# build_office2wsl.sh - Build script that runs on xspt05 (office2-wsl WSL2)
# Usage: env GITEA_URL=... REPO_DIR=... IMAGE=... bash build_office2wsl.sh
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# 从 env vars 读 (不用 $1, $2, $3)
GITEA_URL="${GITEA_URL:-}"
REPO_DIR="${REPO_DIR:-}"
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

cd .
docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"

echo "$IMAGE" | sed 's|.*:||' > /tmp/last_tag.txt
echo "BUILD_OK image=$IMAGE"
