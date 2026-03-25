git reset --hard backup/feature/audit-trail-pre-rewrite-20260319T1200
git filter-branch --env-filter 'mapping_file="scripts/commit_date_map.txt"; if [ -f "$mapping_file" ]; then newdate=$(grep -F "$GIT_COMMIT " "$mapping_file" | cut -d" " -f2); if [ -n "$newdate" ]; then export GIT_AUTHOR_DATE="$newdate"; export GIT_COMMITTER_DATE="$newdate"; fi; fi' -- HEAD
#!/usr/bin/env bash
set -e
# Reset rewrite branch to clean backup state then apply mapped dates
git reset --hard backup/feature-audit-trail-pre-rewrite-20260319T1200

MAPFILE="scripts/commit_date_map.txt"
if [ ! -f "$MAPFILE" ] || [ ! -s "$MAPFILE" ]; then
	echo "No mapping file found or it's empty: $MAPFILE"
	exit 0
fi

# Build an env-filter case statement from the mapping file
env_cases=$(awk '{printf "%s) newdate=\"%s\";\\n", $1, $2}' "$MAPFILE")
env_filter=$(printf "case \"\$GIT_COMMIT\" in\\n%sesac\\nif [ -n \"\$newdate\" ]; then export GIT_AUTHOR_DATE=\"\$newdate\"; export GIT_COMMITTER_DATE=\"\$newdate\"; fi" "$env_cases")

echo "Running git filter-branch with the following env-filter:" >&2
echo "$env_filter" >&2

git filter-branch --env-filter "$env_filter" -- HEAD
