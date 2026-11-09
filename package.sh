#!/usr/bin/env bash
#
# Build the extension as a .vsix. Install it through your editor's UI:
#   Extensions view (Cmd+Shift+X) -> "..." menu -> "Install from VSIX..."
# Works the same in VSCode and Devin (any VSCode-based editor).
#
set -euo pipefail

cd "$(dirname "$0")"

NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
VSIX="$NAME-$VERSION.vsix"

echo "==> Packaging $VSIX"
npx --yes @vscode/vsce package --no-dependencies -o "$VSIX"

echo
echo "==> Built: $(pwd)/$VSIX"
echo "    Install it in your editor:"
echo "    Extensions (Cmd+Shift+X) -> '...' menu -> 'Install from VSIX...'"
