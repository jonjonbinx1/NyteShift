#!/usr/bin/env bash
set -e
MAPFILE="scripts/to_edit_commits.txt"
if [ ! -f "$MAPFILE" ]; then
  echo ""; exit 1
fi
# load hashes into associative array
declare -A M
while IFS= read -r h; do
  # strip possible CR (Windows line endings)
  h="${h//$'\r'/}"
  if [ -n "$h" ]; then M[$h]=1; fi
done < "$MAPFILE"

prev=""
# iterate commits from root -> HEAD
for c in $(git rev-list --reverse HEAD); do
  # normalize rev-list entries as well
  c="${c//$'\r'/}"
  if [ "${M[$c]+_}" ]; then
    if [ -z "$prev" ]; then
      echo "--root"
    else
      echo "$prev"
    fi
    exit 0
  fi
  prev="$c"
done
# not found
echo ""
exit 1
