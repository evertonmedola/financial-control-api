#!/usr/bin/env bash
# Pre-publish secret and hygiene scan (Phase 9, D-02). Re-runnable.
# Publishing history that contains a secret needs a history rewrite plus
# rotation, so this is the hard gate in front of the public push.
#
# HARD gate (any hit prints SCAN_FAIL:<class>, exit non-zero; hits are listed
# as short hash + subject + path only, never the matched text):
#   paths       dangerous files ever committed (dotenv, tf state/plan, keys)
#   credentials AWS key ids, PEM private-key headers, GitHub/Slack tokens in
#               full history diffs
#   jwt         the real JWT signing secret (Secrets Manager) appears in
#               history or the tracked tree; the AWS call failing is a FAIL
#   ignore      .gitignore does not cover the sensitive patterns
# SOFT review (informational): SCAN_REVIEW_ITEMS=<n> + file:line entries,
# SCAN_INFO account_id_files=<n>. On success prints SCAN_CLEAN.
#
# Env: SCAN_REPO_DIR (default: repo toplevel), SCAN_SKIP_JWT=1 (self-test only).
# Secret values live in shell variables, are compared with grep -F, never
# echoed, and are unset at the end.
set -u
export MSYS_NO_PATHCONV=1 PYTHONIOENCODING=utf-8 PYTHONUTF8=1

REPO="${SCAN_REPO_DIR:-$(git rev-parse --show-toplevel)}"
# Native git.exe cannot resolve MSYS paths such as /tmp/x while MSYS_NO_PATHCONV=1;
# normalize to a native path (pwd -W on Git Bash, plain pwd elsewhere).
REPO="$(cd "$REPO" && { pwd -W 2>/dev/null || pwd; })"
R=sa-east-1
SECRET_ID=financial-control/jwt-access-secret
ACCOUNT_ID=796897109626
FAILED=0
HIST="$(mktemp)"
trap 'rm -f "$HIST"; unset JWT_VAL' EXIT

g() { git -C "$REPO" "$@"; }
flag() { echo "SCAN_FAIL:$1"; FAILED=1; }

# Patterns are assembled from fragments so this file's own source text never
# satisfies them (the scan must stay clean after this script is committed).
P_AWS='(AK'"IA|AS"'IA)[0-9A-Z]{16}'
P_PEM='-----BEG'"IN"' [A-Z ]*PRIV'"ATE"' KEY-----'
P_GH='(gh[pousr]_[A-Za-z0-9]{36}|github_pa'"t"'_[A-Za-z0-9_]{22,})'
P_SLACK='xo'"x"'[abposr]-[A-Za-z0-9-]{10,}'
P_PATHS='(^|/)\.env($|\.)|\.tfstate($|\.)|(^|/)tfplan[^/]*$|(^|/)\.terraform/|\.(pem|key|p12|pfx)$|(^|/)id_rsa'
P_PATHS_OK='(^|/)\.env\.example$'

# ---- HARD: dangerous paths ever committed
echo "==> scanning history for dangerous paths"
BAD_PATHS=$(g log --all --name-only --pretty=format: | sort -u | grep -E "$P_PATHS" | grep -Ev "$P_PATHS_OK" || true)
if [ -n "$BAD_PATHS" ]; then
  flag paths
  echo "$BAD_PATHS" | while IFS= read -r p; do
    [ -n "$p" ] && g log --all --pretty=format:'  %h %s' -- "$p" | sed "s|\$| :: $p|"
    echo
  done
fi
TRACKED_BAD=$(g ls-files | grep -E "$P_PATHS" | grep -Ev "$P_PATHS_OK" || true)
if [ -n "$TRACKED_BAD" ]; then
  flag paths
  echo "$TRACKED_BAD" | sed 's/^/  tracked: /'
fi

# ---- HARD: credential patterns in full history diffs
echo "==> scanning full history diffs for credential patterns"
g log --all -p > "$HIST" 2>/dev/null
for entry in "aws-key:$P_AWS" "private-key:$P_PEM" "github-token:$P_GH" "slack-token:$P_SLACK"; do
  cls=${entry%%:*}
  pat=${entry#*:}
  if grep -Eq -- "$pat" "$HIST"; then
    flag "credentials($cls)"
    g log --all -G "$pat" --pretty=format:'  %h %s' --name-only | sed 's/^/  /' | head -20
  fi
done

# ---- HARD: the real JWT secret value must be absent
if [ "${SCAN_SKIP_JWT:-0}" = "1" ]; then
  echo "==> skipping JWT value check (SCAN_SKIP_JWT=1, self-test only)"
else
  echo "==> checking that the JWT signing secret is absent from history and tree"
  JWT_VAL=$(aws secretsmanager get-secret-value --region "$R" --secret-id "$SECRET_ID" --query SecretString --output text 2>/dev/null) || JWT_VAL=""
  if [ -z "${JWT_VAL:-}" ] || [ "$JWT_VAL" = "None" ]; then
    flag "jwt(secret-unreadable)"
  else
    if grep -qF -- "$JWT_VAL" "$HIST"; then flag "jwt(in-history)"; fi
    if g grep -qF -- "$JWT_VAL" 2>/dev/null; then flag "jwt(in-tree)"; fi
  fi
  unset JWT_VAL
fi

# ---- HARD: ignore-rule coverage
echo "==> checking .gitignore coverage"
for sample in .env infra/.terraform/x terraform.tfstate terraform.tfstate.backup tfplan-x prod.tfvars; do
  g check-ignore -q --no-index -- "$sample" || { flag "ignore($sample)"; }
done

# ---- SOFT: review items and account-id exposure (never fails)
REVIEW=$(g grep -nEiI -e '(password|secret|token|api[_-]?key)[A-Za-z_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'$[:space:]]{8,}["'"'"']' -- . ':!package-lock.json' 2>/dev/null | cut -d: -f1,2 || true)
N=0
[ -n "$REVIEW" ] && N=$(printf '%s\n' "$REVIEW" | wc -l | tr -d ' ')
echo "SCAN_REVIEW_ITEMS=$N"
[ -n "$REVIEW" ] && printf '%s\n' "$REVIEW" | head -40 | sed 's/^/  review: /'
AID=$(g grep -lIF -- "$ACCOUNT_ID" 2>/dev/null | wc -l | tr -d ' ')
echo "SCAN_INFO account_id_files=$AID"

if [ "$FAILED" -ne 0 ]; then
  echo "SCAN_FAILED" >&2
  exit 1
fi
echo "SCAN_CLEAN"
