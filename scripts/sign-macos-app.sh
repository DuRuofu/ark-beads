#!/bin/sh
set -eu

ARK_BEADS_APP="src-tauri/target/release/bundle/macos/Ark Beads.app"
ARK_BEADS_ID="com.duruofu.ark-beads"

codesign \
  --force \
  --deep \
  --sign - \
  --identifier "$ARK_BEADS_ID" \
  --requirements "=designated => identifier \"$ARK_BEADS_ID\"" \
  "$ARK_BEADS_APP"

codesign --verify --deep --strict "$ARK_BEADS_APP"
codesign -d -r- "$ARK_BEADS_APP"
