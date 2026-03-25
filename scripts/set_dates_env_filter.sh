#!/bin/sh
mapping_file="scripts/commit_date_map.txt"
if [ ! -f "$mapping_file" ]; then
  exit 0
fi
newdate=$(awk -v c="$GIT_COMMIT" '$1==c{print $2}' "$mapping_file")
if [ -n "$newdate" ]; then
  export GIT_AUTHOR_DATE="$newdate"
  export GIT_COMMITTER_DATE="$newdate"
fi
