#!/usr/bin/env bash
set -euo pipefail

STAGE_ID="${1:-}"
if ! [[ "${STAGE_ID}" =~ ^[0-9a-f]{32}$ ]]; then
  echo "::error:: invalid_subscription_stage_id" >&2
  exit 1
fi

rm -f \
  "/opt/vps-subscription/.v-swift-${STAGE_ID}-server.tmp" \
  "/opt/vps-subscription/.v-swift-${STAGE_ID}-config.tmp" \
  "/opt/vps-subscription/.v-swift-${STAGE_ID}-env.tmp" \
  "/opt/vps-subscription/.v-swift-${STAGE_ID}-service.tmp"
