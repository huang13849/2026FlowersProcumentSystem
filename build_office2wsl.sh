#!/bin/bash
# build_office2wsl.sh - Build script that runs on xspt05 (office2-wsl WSL2)
# Usage: bash build_office2wsl.sh <GITEA_URL> <REPO_DIR> <IMAGE_FULL>
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

GITEA_URL="$1"
REPO_DIR="$2"
IMAGE="$3"

cd "$REPO_DIR"
if [ ! -d .git ]; then
  git clone "$GITEA_URL" .
fi
git fetch origin
git reset --hard origin/main
git clean -fd

# build context = repo root (cd .)
cd .
docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"

# write tag to a known file so caller can read it
echo "$IMAGE" | sed 's|.*:||' > /tmp/last_tag.txt
echo "BUILD_OK image=$IMAGE"
