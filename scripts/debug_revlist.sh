#!/usr/bin/env bash
set -e
cd "$(git rev-parse --show-toplevel)"
echo "to_edit:"
cat scripts/to_edit_commits.txt | sed -n '1,200p'

echo
 echo "rev-list (first 60):"
git rev-list --reverse HEAD | sed -n '1,60p'

echo
 echo "check presence:"
while IFS= read -r h; do
  h="${h//$'\r'/}"
  if [ -z "$h" ]; then continue; fi
  echo -n "$h -> "
  if git rev-list --all | grep -F -q "$h"; then
    echo "FOUND"
  else
    echo "MISSING"
  fi
done < scripts/to_edit_commits.txt
