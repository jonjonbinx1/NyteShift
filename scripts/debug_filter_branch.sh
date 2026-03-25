#!/usr/bin/env bash
set -e
# Debug: run filter-branch and log GIT_COMMIT values to scripts/filter_debug.txt
git reset --hard backup/feature-audit-trail-pre-rewrite-20260319T1200
:> scripts/filter_debug.txt
git filter-branch --env-filter 'echo "$GIT_COMMIT" >> scripts/filter_debug.txt' -- HEAD
