#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "${repository_root}/apps/web"

export VITE_APP_BASE_URL="https://professorit.ru/cards"
export VITE_API_BASE_URL="https://professorit.ru/cards/v1"
export VITE_AUTH_BASE_URL="https://professorit.ru/cards/v1/auth"
export VITE_AUTOMATIC_FEEDBACK_PROMPT_ENABLED="false"
export VITE_MOBILE_APP_PROMOTION_ENABLED="false"

npm run build -- --mode proxmox-lab

index_file="${repository_root}/apps/web/dist/index.html"

if ! grep -qE '(src|href)="/cards/assets/' "${index_file}"; then
  echo "ERROR: Professor IT build does not reference /cards/assets/." >&2
  exit 1
fi

if grep -qE '(src|href)="/assets/' "${index_file}"; then
  echo "ERROR: Professor IT build contains root /assets/ references." >&2
  exit 1
fi

echo "Professor IT web build verified for /cards/."
