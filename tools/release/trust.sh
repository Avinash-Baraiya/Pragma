#!/usr/bin/env bash
# One-time: let .github/workflows/release.yml publish every package with npm
# trusted publishing (OIDC), so CI needs no npm token. Run it yourself; npm
# asks you to confirm in the browser (security key) for each package.
#
#   bash tools/release/trust.sh
set -euo pipefail

REPO="Avinash-Baraiya/Pragma"
WORKFLOW="release.yml"
PACKAGES=(pragma-core pragma-interpreter pragma-providers pragma-server pragma-react pragma-tanstack pragma)

for name in "${PACKAGES[@]}"; do
  echo "→ @avinash-baraiya/${name}"
  npm trust github "@avinash-baraiya/${name}" --repo "$REPO" --file "$WORKFLOW" --yes
done

echo
echo "Done. Check with: npm trust list @avinash-baraiya/pragma"
