# Move orbit-site to GitLab: MRs and CI on the owner's runner, GitHub as mirror and Pages host

**Status: complete (2026-10-10), kept as the record of the move.**

Tracking plan, written here because the agent credential could not file issues on this repository at the time.

## Goal

Move orbit-site's development to `gitlab.tomlawson.io/ai/orbit-site`, following orbit (orbit#801) and orbit-launcher (orbit-launcher#140) under the shared GitLab-first model: branches, merge requests and CI on the owner's runner; GitHub `tomlawesome/orbit-site` becomes a one-way mirror that keeps **GitHub Pages** (the site's public host), CodeQL and secret scanning.

## Inventory (2026-10-08)

- **GitLab:** no `ai/orbit-site` project exists. The `glab` agent credential works for the API. Nothing can have diverged: the import is the first copy.
- **GitHub repo:** public, default branch `main`, Pages (legacy build) serves `main` at `/`. Issues on (2 open: #1 Gaia licence, #2 door freeze), 10 labels, no milestones, no pull requests ever.
- **Branches:** `main`; `classic-door` and `install-into-orbit` fully merged; `perf-base`, `perf-loops`, `perf-skip`, `perf-split` unmerged experiments from 2026-10-03 (the ones PERFORMANCE.md describes). The importer carries them all.
- **Workflows (1):** `import-docs.yml` — nightly cron plus dispatch, `contents: write`, fetches the markdown from `tomlawesome/orbit` and `tomlawesome/orbit-launcher` on GitHub `main`, commits to `main` as `github-actions[bot]`. **This is a second writer of `main`** and cannot survive the move as it is (one branch has one writer).
- **Secrets:** none beyond `github.token` as far as the agent credential can see (secrets, branch protection, deploy keys and milestone creation return 403 to it). Owner to confirm.
- **No CI gate at all**, no `LICENSE`, no `AGENTS.md`, `SECURITY.md` or `CONTRIBUTING.md`, no Renovate. The site has no build step; the `tools/` scripts are run by hand.
- **Cross-repo:** orbit `AGENTS.md` records orbit-site as GitHub-only "for now, to use cloud credit that works nowhere else"; that line goes once this lands.

## What is different from orbit and orbit-launcher

- **Publishing is GitHub Pages**, not a registry or a release. `main` on the mirror *is* the deploy. Nothing to sign, no digest to promote; the mirror push is the release path.
- **The docs import is the only automation**, and it is a committer. It moves to GitLab as a scheduled pipeline; which branch it commits to is decision (a) below.
- No existing GitLab project to rename: the GitHub importer creates `ai/orbit-site` directly.

## Progress

- 2026-10-10: the scheduled import merged itself into `main` for the first time (!25, after #13 and #15); orbit's `AGENTS.md` describes the site as part of the project, on GitLab (orbit !1053). CodeQL runs on the mirror.
- 2026-10-09: !4 (nightly import MR, licence fixes, closes #1) merged; !5 promoted `dev` to `main` and the mirror carried it to GitHub in seconds. Owner accepted the licence (decision (c), 16).
- 2026-10-09: !1 (CI, scaffolding) and !3 (GitHub main's last import, back-merged) merged into `dev`. GitHub's `import-docs.yml` disabled by the owner. Owner settings done: default branch `dev`, `dev` and `main` protected, pipelines must succeed, merge commits, 60-minute timeout, push mirror added (first push refused by GitHub: deploy key to check).
- 2026-10-09, decision 13a: the runner cannot reach GitLab over SSH and the owner will not open it, so the import cannot push with a deploy key (9a). It opens a merge request into `main` that merges itself when the gate passes, with a Maintainer project access token, `ORBIT_SITE_IMPORT_TOKEN`.
- 2026-10-08: imported by the owner as `ai/orbit-site` (project id 57). Every branch at the same commit as GitHub, issues #1 and #2, all 10 labels. Nothing else writes GitHub's `main` (the session that pushed to it is archived).

## Plan

Each step is its own MR/PR (`Cut: risk`) and leaves the previous setup working.

**Step 1 — scaffolding and `.gitlab-ci.yml` on a feature branch, GitHub still the source.** `AGENTS.md` (project id, remotes, how to run and check the site), `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE` (decision (c)), `renovate.json`, `.gitignore` adds `.agents/`. CI: `lint` (`node --check` on every module, every file the pages name exists), `live` (a Playwright journey in Firefox against the site served locally: the door lights, `#install`, `#docs`, `#info` arrive, no console errors — never optional), `import_docs` (schedule-only, commits to `main`) *(superseded 2026-10-09 by decision 13a: a self-merging merge request; see Progress)*, `renovate` (schedule-only). Tags `light` only; nothing needs Docker.

**Step 2 — import.** Owner creates `ai/orbit-site` with GitLab's GitHub importer (repo, branches, issues, labels). The agent cannot: the importer needs a GitHub token handed to GitLab. Milestone `M1 — Foundation on GitLab` is created on GitLab afterwards (the agent credential cannot create milestones on GitHub).

**Step 3 — owner settings on GitLab.** Default branch `dev`; `dev` and `main` protected; pipelines must succeed; merge commits; delete source branch on merge; a push mirror to `ssh://git@github.com/tomlawesome/orbit-site.git`, protected branches only, keep divergent refs, with the GitLab-generated key added on GitHub as a write deploy key (as orbit-launcher). Pipeline schedules: nightly `IMPORT_DOCS=true` on `main`, weekly `RENOVATE=true` on `dev`. Variables, Masked + Protected: `RENOVATE_TOKEN`; `ORBIT_SITE_IMPORT_TOKEN`, a project access token (role Maintainer, scopes `api` and `write_repository`); `main` stays push "No one" (decision 13a).

**Step 4 — disable the reverse writer, then prove the mirror.** Delete `.github/workflows/import-docs.yml` in the first GitLab MR (the GitLab job replaces it), merge something small, watch it reach GitHub and Pages redeploy.

**Step 5 — prune GitHub.** Issues off on GitHub (tracker is GitLab), `codeql.yml` added (`javascript`, `actions`), repository settings per the new-project skill's GitHub reference. Update orbit's `AGENTS.md` line about orbit-site (sibling project: report, do not edit from here).

## Decisions (owner, 2026-10-08)

- **(a) The import commits to `main`** through a project access token the owner allows to push (1b): docs stay nightly-fresh. One host, so one writer. *(Superseded 2026-10-09 by decision 13a: the import opens a merge request into `main` that merges itself; see Progress.)*
- **(b) `dev -> main`, no `preview`** (2b): Pages serves one branch; a `preview` would deploy nowhere.
- **(c) A noncommercial licence of the owner's own** that leaves third-party terms intact (3): `LICENSE`, adapted from birdcage's, with the NASA and ESA/Gaia terms named. Accepted by the owner as it stands after !4 (16, 2026-10-09): the priority is not infringing anyone's licence.
- **(d) The GitHub token stays narrow** (4, recommendation accepted by default): after the import nothing is filed or pushed on GitHub by hand, so orbit-site is not added to the agent's GitHub token. This plan and the step-1 branch go to GitLab after the import.
- **(e) The Milky Way is the site's own drawing** (17, 2026-10-09): Gaia's picture (CC BY-NC) and its credit go (#6). The owner saw the drawn galaxy in Firefox and judged it fine; NASA's public-domain Deep Star Maps 2012 were compared and not chosen, ESO's all-sky picture was declined. With it, the licence's ESA/Gaia terms leave `LICENSE`.

### As they were put

- (a) Where the nightly docs import commits. Options: `dev`, so imported docs go live at the next promotion; or `main` directly through a project access token the owner allows to push, so docs stay nightly-fresh as today. The second keeps today's behaviour but gives `main` a second committer inside GitLab; it is still one host, so the one-writer rule holds.
- (b) Branch flow. The shared `dev -> preview -> main`, or `dev -> main` as orbit-base-image does. `preview` would only mean something if it deployed somewhere a human looks at before `main`; GitHub Pages serves one branch.
- (c) Licence. None in the repo. Orbit is AGPL-3.0; the site carries NASA/ESA imagery under their own terms (see #1).

## Done when

- [x] `ai/orbit-site` exists on GitLab with every branch, issue and label; `dev` is the default and protected.
- [x] The gate (lint + live Firefox journey) runs on every MR and is required to merge.
- [x] The push mirror has delivered one merge to GitHub `main` and Pages served it.
- [x] `import-docs.yml` is gone from GitHub and the GitLab schedule has committed one nightly import.
- [x] GitHub issues are off; CodeQL runs on the mirror. Private vulnerability reporting is on (owner, 2026-10-10).
- [x] orbit's `AGENTS.md` no longer says the site is GitHub-only.

