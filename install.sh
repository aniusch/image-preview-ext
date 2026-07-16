#!/usr/bin/env bash
# Symlink this extension into VSCode and/or Cursor so it loads on every window.
# Re-run is safe (idempotent). Reload the editor afterwards.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="local.inline-image-preview-0.0.1"

link_into() {
  local dir="$1" label="$2"
  if [ -d "$dir" ]; then
    ln -sfn "$SRC" "$dir/$NAME"
    echo "linked into $label -> $dir/$NAME"
  else
    echo "skip $label (no $dir)"
  fi
}

link_into "$HOME/.vscode/extensions" "VSCode"
link_into "$HOME/.cursor/extensions" "Cursor"

echo "Done. Reload/restart your editor (Cmd/Ctrl+Shift+P -> 'Reload Window')."
