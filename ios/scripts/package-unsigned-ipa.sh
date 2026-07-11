#!/usr/bin/env bash
# 将未签名的 .app 打成可上传的 unsigned IPA。
# 安装前需用户用自己的 Apple 证书重签；CI 不会嵌入 Team/密钥。
set -euo pipefail

APP_PATH="${1:?usage: package-unsigned-ipa.sh /path/to/MoonCut.app /path/to/out.ipa}"
IPA_PATH="${2:?usage: package-unsigned-ipa.sh /path/to/MoonCut.app /path/to/out.ipa}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "error: app not found: $APP_PATH" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/Payload"
cp -R "$APP_PATH" "$WORK/Payload/"

# 确保 Payload 内为 .app
APP_NAME="$(basename "$APP_PATH")"
if [[ "$APP_NAME" != *.app ]]; then
  echo "error: expected .app bundle" >&2
  exit 1
fi

(
  cd "$WORK"
  zip -qry "$IPA_PATH" Payload
)

echo "packed unsigned ipa: $IPA_PATH"
ls -lh "$IPA_PATH"
