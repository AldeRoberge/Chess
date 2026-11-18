#!/usr/bin/env bash
# Turns chess-experience/ into its own repository, keeping its history.
#   scripts/split-to-new-repo.sh git@github.com:YOU/chess-experience.git
# Run from anywhere inside the Hexalt checkout. Requires an EMPTY target repository.
set -euo pipefail
remote="${1:?usage: split-to-new-repo.sh <new-repo-url>}"
root="$(git rev-parse --show-toplevel)"
cd "$root"
branch="chess-experience-split"
git subtree split --prefix=chess-experience --branch "$branch"
git push "$remote" "$branch:main"
git branch -D "$branch"
echo "Pushed chess-experience history to $remote (main)."
