#!/usr/bin/env bash
# CI and review bring-up only. Probes never download tools.
set -euo pipefail
if command -v gitleaks >/dev/null && [ "$(gitleaks version)" = "8.21.2" ]; then
  exit 0
fi
if [ "$(uname -s)/$(uname -m)" != "Linux/x86_64" ]; then
  printf '%s\n' 'Install gitleaks 8.21.2 on PATH for this platform.' >&2
  exit 1
fi
mkdir -p .tools
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --silent --show-error --location \
  https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz \
  --output "$work/gitleaks.tar.gz"
printf '%s  %s\n' \
  5bc41815076e6ed6ef8fbecc9d9b75bcae31f39029ceb55da08086315316e3ba \
  "$work/gitleaks.tar.gz" | sha256sum --check
tar -xzf "$work/gitleaks.tar.gz" -C "$work" gitleaks
install -m 755 "$work/gitleaks" .tools/gitleaks
.tools/gitleaks version
