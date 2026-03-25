#!/usr/bin/env bash
set -e
MAPFILE="scripts/commit_committer_map.txt"
if [ ! -f "$MAPFILE" ] || [ ! -s "$MAPFILE" ]; then
  echo "No mapping file found or it's empty: $MAPFILE"
  exit 0
fi

# Build an env-filter case statement from the mapping file using a safe loop
env_cases=""
while IFS= read -r line || [ -n "$line" ]; do
  # skip empty lines
  if [ -z "$line" ]; then
    continue
  fi
  hash=$(echo "$line" | awk '{print $1}')
  date=$(echo "$line" | awk '{print $2}')
  env_cases+="$hash) newdate=\"$date\";;"$'\n'
done < "$MAPFILE"

env_filter=$(printf "case \"\$GIT_COMMIT\" in\n%sesac\nif [ -n \"\$newdate\" ]; then export GIT_COMMITTER_DATE=\"\$newdate\"; fi" "$env_cases")

echo "Running git filter-branch with the following env-filter:" >&2
echo -e "$env_filter" >&2

git filter-branch --env-filter "$env_filter" -- HEAD
