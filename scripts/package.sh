#!/usr/bin/env bash
# Build a Dataverse solution containing the control.
# Needs: Power Platform CLI (pac) and the .NET SDK on PATH.
#
#   scripts/package.sh "<Publisher Name>" <prefix> [Managed|Unmanaged|Both]
#
# The control namespace in src/ControlManifest.Input.xml must be set first
# (it ships as PLACEHOLDER on purpose).
set -euo pipefail

PUBLISHER_NAME="${1:?publisher display name required}"
PUBLISHER_PREFIX="${2:?publisher prefix required}"
PACKAGE_TYPE="${3:-Both}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if grep -q 'namespace="PLACEHOLDER"' "$ROOT/src/ControlManifest.Input.xml"; then
    echo "Set the control namespace in src/ControlManifest.Input.xml before packaging (still PLACEHOLDER)." >&2
    exit 1
fi

cd "$ROOT"
npm ci
npm test
npm run build:prod

mkdir -p "$ROOT/Solution"
cd "$ROOT/Solution"
if [ ! -f Solution.cdsproj ]; then
    pac solution init --publisher-name "$PUBLISHER_NAME" --publisher-prefix "$PUBLISHER_PREFIX"
    pac solution add-reference --path "$ROOT"
fi
dotnet build -c Release -p:SolutionPackageType="$PACKAGE_TYPE"
echo "Solution zip(s):"
ls -1 "$ROOT/Solution/bin/Release/"*.zip
