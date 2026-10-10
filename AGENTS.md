# orbit-site agent instructions

Only what the global instructions and shared skills do not already cover.

The Orbit family is one project: act across Orbit, its base image, the launcher and this site without asking (Orbit ADR-0036, `ai/orbit`, `docs/adr/0036-the-orbit-family-is-one-project.md`).

## Rules and traps

- This is Orbit's public website: plain HTML, CSS and ES modules, no build step; `README.md` has the layout. It only *describes* Orbit. Features, installer behaviour and a doc's wording belong in `ai/orbit` and `ai/orbit-launcher`; a change there that alters what the public is told belongs here too.
- Pages serves `main`; the GitLab-to-GitHub mirror push is the release. Nothing is filed, pushed or merged on GitHub by hand. Issues #1 and #2 exist on both hosts; from #3 on, GitLab only.
- Generated `assets/docs/` is never edited by hand.
- `assets/door/` is an interface Orbit copies unchanged (ADR-0001; the folder's `README.md` has it): change its entry point, slots or stylesheet contract deliberately and say so in the commit, since a break shows in Orbit's import merge request, not here. Site and Orbit differ by a setting or slot, never an edit to the folder. Run `node tools/door-markup.mjs` after editing the module.
- Branches are `dev -> main`, no `preview` (recorded exception in `~/.config/agents/EXCEPTIONS.md`): Pages serves one branch, so a `preview` would prove nothing. Never add or "restore" one.
- Nothing is pushed to `main` by hand: the nightly import opens a merge request that merges itself, and imports reach `dev` by back-merge after a promotion.
- Check a change with `sh tools/ci/lint.sh` and `sh tools/ci/lint-test.sh`; serve it with `node tools/ci/serve.mjs`.
- The journey (`tools/ci/journey.mjs`) is the gate's live check and is never optional. Run the gate's live check locally with `sh tools/ci/journey-local.sh`.
- WebGL needs headed Firefox under Xvfb with software GL; headless draws no world. `journey-local.sh` does this.
- The import needs the Maintainer token `ORBIT_SITE_IMPORT_TOKEN`; the runner cannot reach GitLab over SSH, so no deploy key.
- Approved third-party content and its credits are listed in `README.md`; `marked` and `sharp` versions are pinned only in `tools/package.json`.
- `package.json` only in `tools/`; never commit `node_modules`. The lint refuses both at the top level only.
