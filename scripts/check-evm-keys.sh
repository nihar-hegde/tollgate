#!/bin/sh
# secretlint doesn't recognise raw EVM private keys (0x + 64 hex), so catch them here.
# Matches only key-like names, so tx hashes (also 0x + 64 hex) don't trip it.
# Usage: check-evm-keys.sh [files...]   (no args = all tracked files)
pattern='(private[_-]?key|PRIVATE_KEY|privateKey|mnemonic)[^=:]{0,20}[=:][[:space:]]*["'"'"']?0x[0-9a-fA-F]{64}'
if [ "$#" -eq 0 ]; then
  matches=$(git grep -nIE "$pattern" -- . ':!scripts/check-evm-keys.sh')
else
  matches=$(grep -nHIE "$pattern" "$@" 2>/dev/null)
fi
if [ -n "$matches" ]; then
  echo "Possible EVM private key found:" >&2
  echo "$matches" >&2
  exit 1
fi
