#!/usr/bin/env bash
set -e
# This script is used as GIT_SEQUENCE_EDITOR during an interactive rebase.
# It inserts `exec` lines after `pick` entries for commits listed in
# scripts/commit_date_map.txt so those commits are amended with new dates.
TODOFILE="$1"
MAP="scripts/commit_date_map.txt"
if [ ! -f "$TODOFILE" ]; then
  echo "No todo file supplied to sequence editor" >&2
  exit 1
fi
if [ ! -f "$MAP" ]; then
  # nothing to do
  exit 0
fi
# Build mapping: commit -> date
declare -A dates
while read -r h d; do
  # skip empty lines
  if [ -n "$h" ]; then
    dates[$h]="$d"
  fi
done < "$MAP"

tmpfile=$(mktemp)
while IFS= read -r line || [ -n "$line" ]; do
  echo "$line" >> "$tmpfile"
  # match lines like: pick <hash> <message>
  if [[ "$line" =~ ^pick[[:space:]]+([0-9a-fA-F]+) ]]; then
    short_hash="${BASH_REMATCH[1]}"
    # resolve to full 40-char hash so mapping (which uses full hashes) matches
    full_hash=$(git rev-parse "$short_hash" 2>/dev/null || true)
    date="${dates[$full_hash]}"
    if [ -n "$date" ]; then
      # After this commit is applied, amend it to set the desired date.
      printf "exec GIT_AUTHOR_DATE='%s' GIT_COMMITTER_DATE='%s' git commit --amend --no-edit --date='%s' >/dev/null 2>&1 || true\n" "$date" "$date" "$date" >> "$tmpfile"
    fi
  fi
done < "$TODOFILE"

mv "$tmpfile" "$TODOFILE"
exit 0
