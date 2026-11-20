# Releasing

A release here is a merge of `dev` into `main`, by merge request. When it merges, GitLab
pushes `main` to the public GitHub mirror and Pages serves it. There is no `preview`, no
version number and no change log; each release has a dated record instead.

Before opening the merge request, run this on `dev`'s tip:

```
node tools/ci/release-readiness.mjs --target main
```

From a worktree that is not on `dev`, name it: `--source gitlab/dev --remote gitlab` (after a fetch).

It checks what a machine can (steps 1, 2 and 4) and ends with `Ready:` or `Not ready:`. The
merge request's own pipeline runs it again as the `release_readiness` job. The record
(`docs/releases/YYYY-MM-DD.md`, or `YYYY-MM-DD-N.md` for a second on one day) is copied from
`docs/releases/TEMPLATE.md`.

## Step 1: dev holds everything on main

Who: the agent. Checked by the job.

Any change that merged into `main` alone (the nightly docs import reaches `main` only by
promotion, but a hotfix may) is merged back into `dev` by merge request. The merge commit an
earlier release left on `main` changes nothing and needs no merge back: the job passes when
merging `main` into `dev` would change no file.

## Step 2: the last release reached the public mirror

Who: the agent; fixing a broken push mirror is the owner's. Checked by the job.

The mirror's `main` must equal GitLab's `main`. If it does not, the last push did not arrive:
tell the owner.

## Step 3: say whether the door folder changed

Who: the agent. Manual.

If `assets/door/` differs between `main` and `dev`, say so in the record: Orbit copies that
folder (ADR-0001). If it does not differ, write `not needed` with the owner's decision or
the check you ran.

## Step 4: write the release record

Who: the agent. Checked by the job.

Copy `docs/releases/TEMPLATE.md`, fill in one line per step and commit it on the batch that
carries the release, before that batch merges into `dev`. Commit it with
`git commit --trailer "Signed-off-by: <your name>"`, and use the same name on the record's
`Signed-off-by:` line. The job checks that the record is the only new one, names this
guide's current blob id, has one line per step in order, and is signed as described.

## Step 5: run the check on dev's tip

Who: the agent.

Run `node tools/ci/release-readiness.mjs --target main` on `dev`'s tip. Open the merge
request only when it says ready.

## Step 6: the pipeline is green

Who: the agent.

The merge request's pipeline is green, the `release_readiness` job included.

## Step 7: the owner approves and merges

Who: the owner. Manual.

The owner approves on the merge request; then it is merged.

## Step 8: confirm the release is live

Who: the agent. Manual.

After the merge, GitLab pushes `main` to the mirror and Pages serves it. Open the public
site and confirm the change is there.

## Step 9: tell the Orbit session about a door change

Who: the agent. Manual.

After the merge, if step 3 said the door changed, tell the Orbit session so it can import
the new folder.
