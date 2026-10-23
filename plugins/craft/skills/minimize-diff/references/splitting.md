# Splitting and extracting: the commands

Read this when you reach Step 6, or when you need to park drive-by work.

Everything below assumes the shrunken change is committed on the feature branch,
and that `$BASE` holds the merge base with the base resolved in Step 1:
`BASE=$(git merge-base <base> HEAD)`. Work on a copy first —
`git branch backup/<name>` — so a bad rebase costs nothing.

Nothing here waits for a keypress, because the shell you run it in has no
terminal: `git add -p` shows its first prompt, stages nothing and still exits 0,
and `git rebase -i` waits on an editor nobody can type into. Hunks are picked by
editing a patch file, and a rebase plan is written to a file that
`GIT_SEQUENCE_EDITOR` copies into place.

## Pick hunks with a patch file

```bash
git diff --binary "$BASE" <feature-branch> -- <file> > <scratch>/pick.patch
```

Open `pick.patch` with the Edit tool and delete every hunk you don't want — from
its `@@` line up to the next `@@` line, or to the end of that file's section.
Keep the `diff --git`, `---` and `+++` lines of each file you keep a hunk from.
Whole hunks can go without touching anything else. Don't edit inside a hunk:
git lists a hunk's `-` lines before its `+` lines, so keeping half of one by
hand easily writes lines back in the wrong order. When one hunk holds both
sides, make that part with the Edit tool on each branch instead, copying the
exact lines from the diff, and check it with `git diff` before you commit.

## Park drive-by work without losing it

The unrelated bug fix or rename you found in Step 3 goes somewhere it can be
merged on its own, and leaves the feature branch, so it exists in exactly one
place.

When it is whole files:

```bash
git switch -c fix/<scope>-<description> "$BASE"
git restore --source=<feature-branch> --staged --worktree -- <paths>
git commit -m "fix(<scope>): <description>"
git switch <feature-branch>
git restore --source="$BASE" --staged --worktree -- <paths>
git commit -m "<type>(<scope>): <description>"
```

When it is hunks inside a file you otherwise keep, pick them into
`<scratch>/drive-by.patch` as above, then:

```bash
git switch -c fix/<scope>-<description> "$BASE"
git apply --index <scratch>/drive-by.patch
git commit -m "fix(<scope>): <description>"
git switch <feature-branch>
git apply -R --index <scratch>/drive-by.patch
git commit -m "<type>(<scope>): <description>"
```

`git restore --source` also removes a path that does not exist in the source, so
a file the drive-by added comes off the feature branch too.

## Carve one branch into a stack

Best when the final state is right and only the history needs shaping. Each
layer is a patch of what the earlier layers have not taken yet, so take every
diff against `HEAD`:

```bash
git switch -c stack/1-<name> "$BASE"
git diff --binary HEAD <feature-branch> -- <layer-1 paths> > <scratch>/layer.patch
git apply --index <scratch>/layer.patch
<run the checks>
git commit -m "<type>(<scope>): <subject>"
git switch -c stack/2-<name>
```

Trim `layer.patch` first when a file is shared with a later layer. Repeat diff →
apply → check → commit → new branch for each layer. Verify at every step, not at
the end: a commit that does not build on its own defeats the whole point of
stacking, and you only find that out by actually running the build there. The
last layer takes everything left:

```bash
git diff --binary HEAD <feature-branch> | git apply --index
```

`--binary` and `--index` carry new, deleted and binary files along with the text
hunks.

## Reorder or split existing commits

When the branch already has sensible commits in the wrong order or granularity,
write the rebase plan to a file, oldest commit first:

```bash
git log --reverse --format='pick %h %s' "$BASE"..HEAD > <scratch>/todo
```

Edit `<scratch>/todo`:

- reorder lines to change commit order
- change `pick` to `edit` to stop at a commit and split it: `git reset HEAD^`,
  stage each piece with `git add -- <paths>` or `git apply --cached` of a picked
  patch, commit it, then `git rebase --continue`
- move a "fix typo from earlier commit" line under the commit it belongs to and
  change its `pick` to `fixup`

Then run the plan:

```bash
GIT_SEQUENCE_EDITOR="cp <scratch>/todo" GIT_EDITOR=true git rebase -i "$BASE"
```

For a fix you are about to commit, `git commit --fixup=<sha>` followed by
`GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash "$BASE"` folds it in with
no plan file.

## Check the stack before you open PRs

Each commit must build and pass on its own — assert it rather than assume it:

```bash
git rebase "$BASE" --exec "<test-command>"
```

That runs the command at every commit and stops at the first failure, even when
the branch is already up to date.

Confirm the stack is behavior-identical to where you started:

```bash
git diff backup/<name> HEAD           # should be empty, or only your cuts
```

## Opening the PRs

Each PR targets the one below it, so reviewers see only that layer's diff:

```bash
gh pr create --base <base>          --head stack/1-<name> --title "<type>(<scope>): <subject>"
gh pr create --base stack/1-<name>  --head stack/2-<name> --title "<type>(<scope>): <subject>"
```

Say in each description which PR it depends on and that it merges in order.
Retarget the later ones to `<base>` as the earlier ones land (`gh pr edit <n> --base <base>`).
