# Git Master Skill

Atomic, semantic git commits with clean history. Use this skill when crafting commit messages, structuring a series of changes, resolving conflicts, or managing branches.

## Core Philosophy: Atomic Commits

One commit = one logical change. Not one file, not one session — one _reason to change_.

**Good**: "feat(auth): add JWT refresh token rotation"
**Bad**: "various fixes and updates"
**Bad**: "WIP"
**Bad**: "fix bug" (which bug? where?)

## Conventional Commits (required format)

```
<type>(<scope>): <description>

[optional body]

[optional footer: Breaking Change, Closes #issue]
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code restructuring without behaviour change |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `style` | Formatting, whitespace (no logic change) |
| `chore` | Build, dependencies, tooling |
| `ci` | CI/CD pipeline changes |
| `revert` | Reverting a previous commit |

### Scope Examples

```
feat(auth): add OAuth2 PKCE flow
fix(ui/header): correct mobile breakpoint overflow
refactor(api): extract pagination logic to shared util
test(hooks): add coverage for useSession edge cases
chore(deps): upgrade typescript to 5.8
```

### Description Rules

- Imperative mood: "add", "fix", "remove" — not "added", "fixed", "removed"
- No period at the end
- Max 72 characters for the subject line
- If it needs more explanation, use the body

### Body Format

```
feat(payments): add retry logic for failed Stripe charges

Stripe occasionally returns 429 rate-limit errors on high traffic.
Add exponential backoff with 3 retries (1s, 2s, 4s) before failing.

The existing error handler now distinguishes between retryable errors
(429, 503) and permanent failures (400, 401, 402).

Closes #847
```

## Commit Workflow

### Before Every Commit

```bash
# 1. Check what's staged
git diff --staged

# 2. Verify only intended changes are included
git status

# 3. Run checks
bun tsc --noEmit
bun test --related  # if applicable

# 4. Commit
git commit -m "type(scope): description"
```

### Staging Precisely

```bash
# Stage specific files (preferred)
git add src/auth/tokenRefresh.ts src/auth/tokenRefresh.test.ts

# Stage specific hunks interactively
git add -p src/bigFile.ts

# Never use git add -A without reviewing what changed
```

### Splitting a Large Change Into Atomic Commits

```bash
# Scenario: you changed 10 files but they represent 3 logical changes

# Stage and commit group 1
git add src/models/*.ts
git commit -m "refactor(models): extract validation to base class"

# Stage and commit group 2
git add src/api/users.ts src/api/users.test.ts
git commit -m "fix(api): validate email format on user creation"

# Stage and commit group 3
git add src/ui/UserForm.tsx
git commit -m "feat(ui): add email validation feedback to UserForm"
```

## Branch Strategy

```bash
# Feature branches from main
git checkout -b feat/payment-retry-logic

# Hotfix branches from main
git checkout -b fix/stripe-timeout

# Keep branches short-lived — merge or rebase within days, not weeks
```

## Rebase vs Merge

**Use rebase** to incorporate upstream changes before opening a PR:
```bash
git fetch origin
git rebase origin/main
```

**Use merge** only for integrating completed feature branches into main (via PR).

**Never rebase public branches** (main, dev, release) — it rewrites shared history.

## Fixing Mistakes (before pushing)

```bash
# Amend last commit message
git commit --amend -m "fix(auth): correct token expiry calculation"

# Add forgotten file to last commit
git add forgotten-file.ts
git commit --amend --no-edit

# Undo last commit (keep changes staged)
git reset --soft HEAD~1

# Discard last commit AND changes (destructive!)
git reset --hard HEAD~1  # only if not pushed
```

## Resolving Conflicts

```bash
# During rebase conflict
git status  # see conflicted files
# Edit files to resolve — keep <<<< ==== >>>> markers clear
git add resolved-file.ts
git rebase --continue

# Abort if overwhelmed
git rebase --abort
```

## Git Log Inspection

```bash
# Clean oneline log
git log --oneline --graph --decorate -20

# Changes to specific file
git log --follow -p src/auth/session.ts

# Search commit messages
git log --grep="token" --oneline

# Show changes between branches
git diff main...feat/my-feature --stat
```

## Pre-commit Checklist

Before every commit, verify:
- [ ] `tsc --noEmit` passes (TypeScript)
- [ ] Linter passes (`bun run lint` or equivalent)
- [ ] Only the intended files are staged
- [ ] Commit message follows conventional commits format
- [ ] No debug logs, commented-out code, or TODO left in staged changes
- [ ] Tests pass for modified code (`bun test`)
