# GitHub settings guide

Last updated: 2026-10-29

Follow these steps once in the GitHub web interface, as the repository owner. The workflows and policy files in the repository (`.github/dependabot.yml`, `.github/workflows/codeql.yml`, `SECURITY.md`) only work fully once these settings are on. Merge the pull request that adds the CodeQL workflow first, so that its checks exist before you require them in step 3.

## 1. Code security

Open the repository, then Settings, then "Advanced Security" (called "Code security" in some views).

1. Dependency graph: Enable.
2. Dependabot alerts: Enable.
3. Dependabot security updates: Enable.
4. Dependabot version updates: nothing to click. `.github/dependabot.yml` turns them on.
5. Private vulnerability reporting: Enable. This is what makes "Report a vulnerability" in `SECURITY.md` work.
6. Secret scanning: Enable.
7. Push protection (under Secret scanning): Enable. It blocks a push that contains a secret.
8. Code scanning, CodeQL analysis: choose Set up, then Advanced. Do not use the Default setup. The repository already has `.github/workflows/codeql.yml`; do not add a second workflow. Once the workflow has run, results appear under the Security tab, Code scanning.

## 2. Actions permissions

Settings, then Actions, then General, then "Workflow permissions": choose "Read repository contents and packages permissions". Leave "Allow GitHub Actions to create and approve pull requests" off.

## 3. Branch ruleset on main

Settings, then Rules, then Rulesets, then New ruleset, then New branch ruleset.

1. Ruleset name: `main protection`. Enforcement status: Active.
2. Target branches: Add target, then "Include default branch".
3. Rules, tick:
   - "Restrict deletions".
   - "Block force pushes".
   - "Require a pull request before merging". Set "Required approvals" to 0. Leave the other options off.
   - "Require status checks to pass". Add these checks (type each name and pick it from the list):
     - `Database (pgTAP)`
     - `App (Jest, lint, typecheck)`
     - `Importer (pytest)`
     - `Web`
     - `Functions`
     - `Audit`
     - `Scripts`
     - `Analyze (javascript-typescript)`
     - `Analyze (python)`
     - `Analyze (actions)`
4. Do not add any bypass actors, so the rules apply to the owner too.
5. Click Create.

A check name only appears in the list after it has run at least once in the repository. If a name is missing, open a pull request first so the checks run, then come back.

### Why `Search ranking (pytest, local Supabase)` is not required

That job downloads an embedding model and starts a full local Supabase, with a 45-minute limit. It is slow and can fail for reasons that have nothing to do with the change (network, model download). Requiring it would block merges for the wrong reasons. It still runs on every pull request, so look at it when a change touches search. If it becomes quick and stable, add it to the list.

### Merging by pull request

Because direct pushes to `main` are blocked, every change goes through a pull request. It can be merged once the required checks are green. No review is required (0 approvals).

## 4. Account check: 2FA

1. Click your profile picture, then Settings, then "Password and authentication".
2. Under "Two-factor authentication", check that it says Enabled.
3. Check that at least one strong method is registered: a passkey (Passkeys section) or an authenticator app. Prefer a passkey. SMS alone is not enough.
4. Download and store the recovery codes somewhere safe and offline.
