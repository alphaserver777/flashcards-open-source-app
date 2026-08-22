#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "${repository_root}/apps/web"

export VITE_APP_BASE_URL="https://professorit.ru/cards"
export VITE_API_BASE_URL="https://professorit.ru/cards/v1"
export VITE_AUTH_BASE_URL="https://professorit.ru/cards/v1/auth"
export VITE_MOBILE_APP_PROMOTION_ENABLED="false"

npm run build -- --mode proxmox-lab
