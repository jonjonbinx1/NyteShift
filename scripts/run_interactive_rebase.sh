#!/usr/bin/env bash
set -e
cd "$(git rev-parse --show-toplevel)"
# Ensure we're on the rewrite branch
git checkout rewrite/no-business-hours/feature-audit-trail || git switch rewrite/no-business-hours/feature-audit-trail
parent=$(scripts/find_parent_of_first_offending.sh)
echo "parent='$parent'"
if [ "$parent" = "--root" ]; then
  GIT_SEQUENCE_EDITOR='./scripts/sequence_editor.sh' git rebase -i --root
else
  GIT_SEQUENCE_EDITOR='./scripts/sequence_editor.sh' git rebase -i "$parent"
fi
