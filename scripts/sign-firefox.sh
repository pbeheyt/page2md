#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env file with AMO_JWT_ISSUER and AMO_JWT_SECRET" >&2
  exit 1
fi

EXT_DIR="${PAGE2MD_EXT_DIR:-$HOME/.local/share/browser-extensions/page2md}"

while IFS='=' read -r raw_key raw_value || [[ -n "$raw_key" ]]; do
  key="${raw_key#"${raw_key%%[![:space:]]*}"}"
  key="${key%"${key##*[![:space:]]}"}"
  if [[ -z "$key" || "$key" == \#* ]]; then
    continue
  fi
  value="${raw_value:-}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:-1}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:-1}"
  fi
  case "$key" in
    AMO_JWT_ISSUER) AMO_JWT_ISSUER="$value" ;;
    AMO_JWT_SECRET) AMO_JWT_SECRET="$value" ;;
  esac
done < .env

: "${AMO_JWT_ISSUER:?AMO_JWT_ISSUER must be set in .env}"
: "${AMO_JWT_SECRET:?AMO_JWT_SECRET must be set in .env}"

npm run typecheck
npm test
npm run build:firefox

mkdir -p "$EXT_DIR"
npx --yes web-ext@10.8.0 sign \
  --channel=unlisted \
  --source-dir=.output/firefox-mv2 \
  --artifacts-dir="$EXT_DIR" \
  --api-key="$AMO_JWT_ISSUER" \
  --api-secret="$AMO_JWT_SECRET"
