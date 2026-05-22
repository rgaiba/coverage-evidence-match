#!/bin/bash
# Coverage Evidence Match — one-shot GitHub setup
# Run from the project directory: bash setup-github.sh
set -e

REPO="rgaiba/coverage-evidence-match"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "▶ Coverage Evidence Match — GitHub Setup"
echo "  Project: $DIR"
echo ""

# 1. Clear stale git lock
rm -f .git/index.lock 2>/dev/null && echo "  ✓ Cleared index.lock" || true

# 2. Git identity
git config user.email "rahulgaiba@gmail.com"
git config user.name "Rahul Gaiba"
git branch -M main 2>/dev/null || true

# 3. Remote
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$REPO.git"

# 4. Stage & commit
git add -A
git diff --cached --quiet && echo "  ✓ Nothing to commit (already up to date)" || \
  git commit -m "Initial commit: Coverage Evidence Match SPA

- React 19 + Vite 8 + Tailwind CSS v4
- GitHub Pages base path /coverage-evidence-match/
- Pipeline: CMS Coverage → PubMed (NCBI E-utilities) → Consensus → Claude
- Report card: Policy Summary, Evidence Since Revision, Gap Direction,
  Staleness Score bar, Recommended Action badge, Key Citations
- GitHub Actions CI/CD for automated Pages deployment"

# 5. Create repo on GitHub (requires gh CLI)
if command -v gh &>/dev/null; then
  echo ""
  echo "▶ Creating GitHub repo via gh CLI..."
  gh repo create "$REPO" \
    --public \
    --description "Audit-ready evidence gap analysis for UM Committees — CMS NCD/LCD vs. current literature" \
    --source . \
    --push \
    --remote origin 2>/dev/null || {
      echo "  Repo may already exist — pushing to existing remote..."
      git push -u origin main
    }
  echo "  ✓ Repo created and pushed"
else
  echo ""
  echo "▶ gh CLI not found. Creating repo via API..."
  # Try to create via GitHub API using stored credential
  TOKEN=$(security find-internet-password -s "github.com" -a "rahulgaiba" -w 2>/dev/null || \
          git credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null | grep password | cut -d= -f2 || echo "")
  if [ -n "$TOKEN" ]; then
    curl -sf -X POST -H "Authorization: token $TOKEN" \
      -H "Accept: application/vnd.github.v3+json" \
      https://api.github.com/user/repos \
      -d "{\"name\":\"coverage-evidence-match\",\"private\":false,\"description\":\"Audit-ready evidence gap analysis for UM Committees\"}" \
      > /dev/null && echo "  ✓ Repo created" || echo "  Repo may already exist"
    git push -u origin main
  else
    echo ""
    echo "  ── Manual steps needed ──────────────────────────────"
    echo "  1. Create the repo:"
    echo "     https://github.com/new?name=coverage-evidence-match&visibility=public"
    echo ""
    echo "  2. Then run:"
    echo "     git push -u origin main"
    echo "  ────────────────────────────────────────────────────"
  fi
fi

echo ""
echo "▶ GitHub Pages setup:"
echo "  Go to: https://github.com/$REPO/settings/pages"
echo "  Source → GitHub Actions"
echo ""
echo "  The GitHub Actions workflow (.github/workflows/deploy.yml) will"
echo "  build and deploy automatically on every push to main."
echo ""
echo "  Live URL: https://rgaiba.github.io/coverage-evidence-match/"
echo ""
echo "✓ Done."
