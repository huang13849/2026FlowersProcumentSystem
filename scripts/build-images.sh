#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
#  build-images.sh — build & push every supply-chain image to k3s registry
#
#  Called by Jenkins pipeline (scp-pipeline.sh Stage 3).
#  Runs from the repo root on the master node.
#
#  Add a new service? Just append one line to BUILD_SPEC.
#  Format: "image_name:context_dir[:dockerfile]"
#  If dockerfile is omitted, it defaults to "<context_dir>/Dockerfile".
# ─────────────────────────────────────────────────────────────────────────
set -uo pipefail

REGISTRY="${REGISTRY:-100.76.15.64:5001}"

BUILD_SPEC=(
  # ── shared infra / gateway ──
  "nginx-gateway:nginx-gateway"
  "api-gateway:api-gateway"

  # ── domain services ──
  "ai-service:ai-service"
  "product-api-service:product-service:product-service/Dockerfile.api"
  "product-web-service:product-service:product-service/Dockerfile.web"
  "shop-service:shop-service"
  "supplier-service:supplier-service"
  "publish-service:publish-service"
  "scene-service:scene-service"
  "order-service:order-service"
  "contract-service:contract-service"
  "price-service:price-service"
  "console-nav-service:console-nav-service"
  "purchase-list-service:purchase-list-service"
  "payment-sync-worker:payment-sync-worker"
  "order-writer-consumer:order-writer-consumer"
  "wecom-notifier:wecom-notifier"
  "seller-binding-service:seller-binding-service"

  # domain microservices (user management refactor)
  "identity-service:identity-service"
  "profile-service:profile-service"
  "crm-service:crm-service"
)

FAIL=0
BUILT=()
SKIPPED=()

for spec in "${BUILD_SPEC[@]}"; do
  IFS=':' read -r img ctx df <<<"$spec"
  [ -z "$df" ] && df="$ctx/Dockerfile"

  if [ ! -d "$ctx" ] || [ ! -f "$df" ]; then
    echo "SKIP: $img (missing ctx=$ctx or df=$df)"
    SKIPPED+=("$img")
    continue
  fi

  echo "── building $img (ctx=$ctx df=$df) ──"
  if ! docker build --no-cache -f "$df" -t "$REGISTRY/supply-chain/$img:latest" "$ctx/" 2>&1 | tail -3; then
    echo "  BUILD FAIL: $img"
    FAIL=1
    continue
  fi
  if ! docker push "$REGISTRY/supply-chain/$img:latest" 2>&1 | tail -2; then
    echo "  PUSH FAIL: $img"
    FAIL=1
    continue
  fi
  BUILT+=("$img")
done

echo
echo "─── build summary ──────────────────────────────"
echo "  built:   ${#BUILT[@]} (${BUILT[*]:-none})"
echo "  skipped: ${#SKIPPED[@]} (${SKIPPED[*]:-none})"
echo "  fail:    $FAIL"

exit $FAIL
