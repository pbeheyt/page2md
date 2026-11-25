#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
  echo "Missing .env file with AMO_JWT_ISSUER and AMO_JWT_SECRET" >&2
  exit 1
fi

EXT_DIR="${PAGE2MD_EXT_DIR:-$HOME/.local/share/browser-extensions/page2md}"

set -a
source .env
set +a

: "${AMO_JWT_ISSUER:?AMO_JWT_ISSUER must be set in .env}"
: "${AMO_JWT_SECRET:?AMO_JWT_SECRET must be set in .env}"

npm run build:firefox
mkdir -p "$EXT_DIR"
npx --yes web-ext@10.8.0 sign \
  --channel=unlisted \
  --source-dir=.output/firefox-mv2 \
  --artifacts-dir="$EXT_DIR" \
  --api-key="$AMO_JWT_ISSUER" \
  --api-secret="$AMO_JWT_SECRET"
