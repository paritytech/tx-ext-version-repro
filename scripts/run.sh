#!/usr/bin/env sh
# Run one script as the game product, the way host-rust-core runs its own e2e:
# `truapi-host signing-host --script <file>`.
#
#   scripts/run.sh <script.ts>
#
#   NETWORK       previewnet (default) | paseo-next-v2 — the host preset and the
#                 chain lib/chain.ts reads from, in one go
#   SESSION       the person to restore or onboard (default: demo). A fresh
#                 name onboards a lite person first (~1 min, prints nothing
#                 meanwhile); reuse the name the host prints as "Paired with".
#   TRUAPI_HOST   the host binary (default: truapi-host on PATH)
#   TX_EXT_VERSION  script 2 only: the value to send (0 or 5)
#   SUBMIT=1      also broadcast the transaction (the account needs funds for
#                 the fee); without it the runtime is only asked to VALIDATE it
set -eu
NETWORK="${NETWORK:-previewnet}"
case "$NETWORK" in
  previewnet)    TLD=testnet ;;
  paseo-next-v2) TLD=paseo ;;
  *) echo "NETWORK=$NETWORK: expected previewnet or paseo-next-v2" >&2; exit 2 ;;
esac
export NETWORK
exec "${TRUAPI_HOST:-truapi-host}" signing-host \
  --network "$NETWORK" \
  --product-id "dim2.$TLD" \
  --session "${SESSION:-demo}" \
  --base-path .state \
  --auto-accept \
  --script "$1"
