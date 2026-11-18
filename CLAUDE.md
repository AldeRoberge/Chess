# Working in this repo

Many Claude sessions edit this folder at the same time, all uncommitted, in one shared working tree. Losing that work is the worst thing that can happen here: it already happened once (a reset wiped edits from a dozen sessions), and git cannot bring back uncommitted changes.

## Never destroy uncommitted work

This must NEVER happen. Do not run any of these, in any form, unless the user has asked for that exact command in this conversation:

- `git reset --hard`, `git reset` onto a different commit, `git checkout -- <path>`, `git checkout .`, `git restore` (working tree or `--staged` on files you did not edit)
- `git stash`, `git stash drop`, `git stash clear`, `git stash pop` (the stash hides everyone's edits from the working tree)
- `git clean`, `git rebase`, `git merge`, `git pull`, `git switch`/`git checkout <branch>` while the working tree is dirty
- `rm -rf`, `Remove-Item -Recurse`, or overwriting a file you have not read in this session

A dirty tree you did not make is not yours to clean up. If files you did not touch show as modified, leave them alone: another session is working on them.

## Before and after risky git work

- If the user asks for something that could discard changes (a pull, a branch switch, a reset), first save a snapshot without touching the tree: `git stash create` then `git update-ref refs/backup/<name> <hash>`, and save `git diff HEAD` as a patch. Then tell the user what could be lost.
- Prefer committing the current state to a throwaway branch before any operation that rewrites the tree, but only when the user asks you to commit.
- When you edit a file, make small targeted edits and re-read it first. If a file changed on disk since you read it, treat the new content as the truth and do not revert it.

## If work is lost anyway

1. Stop. Run no further git commands that change the tree.
2. Check `git reflog`, `git stash list`, `git fsck --lost-found --no-reflogs`, and the backup refs under `refs/backup/`.
3. Tell the user exactly which files may be affected, and ask the other sessions to verify and re-apply their own edits (they must not run reset, checkout or stash to do so).

## Tell the user

Uncommitted work is unprotected. Suggest committing often, and keep GitHub Desktop's pull, discard and stash actions away from this folder while sessions are active.
