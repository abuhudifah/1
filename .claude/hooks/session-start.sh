#!/bin/bash
set -euo pipefail

# تشغيل فقط في البيئة السحابية
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# --include=dev: يضمن تثبيت devDependencies حتى لو NODE_ENV=production
npm install --include=dev
