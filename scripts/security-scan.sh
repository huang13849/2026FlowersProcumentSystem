#!/usr/bin/env bash
# security-scan.sh v3 — 稳定版, 逐文件扫描, 减少误报
#
# Modes: precommit | head | audit
# Env:   SKIP_SECURITY_SCAN=1 绕过
# 行级白名单: 行末加  # security-scan: ignore  或  // security-scan: ignore

set -uo pipefail

MODE="${1:-precommit}"
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

RED='\033[0;31m'; YEL='\033[0;33m'; GRN='\033[0;32m'; CYA='\033[0;36m'; NC='\033[0m'
FOUND=0
TOTAL_HITS=0

# 危险文件名 (整个文件不该在 git 里)
DANGER_FILE='(^|/)(\.env$|\.env\.[a-zA-Z0-9]+$|\.env\..*\.bak.*|.*\.pem$|id_rsa$|.*\.p12$|.*\.pfx$|credentials(\.json)?$|secrets?\.(ya?ml|json)$)'
WHITELIST_FILE='(\.env\.template$|\.env\.sample$|\.env\.example$)'

# 二进制/无关文件跳过
SKIP_FILE_RE='\.(png|jpg|jpeg|gif|svg|ico|pdf|zip|gz|tar|min\.js|min\.css|lock|log|woff2?|ttf|eot|mp4|mov|webm|mp3|wav|ipynb)$|package-lock\.json|yarn\.lock|/node_modules/|/\.git/|/dist/|/build/|/\.next/|/\.venv/|__pycache__'

# 命名对应正则 (用 grep -P). 顺序: 高精度在前
declare -a RULES=(
  'AWS_KEY|AKIA[0-9A-Z]{16}'
  'STRIPE_KEY|sk_(live|test)_[0-9a-zA-Z]{20,}'
  'GITHUB_PAT|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|ghs_[A-Za-z0-9]{30,}'
  'SLACK_TOKEN|xox[baprs]-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24,}'
  'PEM_KEY|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'
  # 32-64 位 hex 赋值给 SECRET/KEY/TOKEN/AUTH/JWT (NextAuth/Zitadel/JWT)
  'HEX_SECRET|(SECRET|KEY|TOKEN|AUTH)[A-Z_]*\s*[:=]\s*["\x27]?[a-fA-F0-9]{32,64}["\x27]?'
  # 通用引号包裹的赋值 (值 8+ 字符, 排除 placeholder 由后置过滤处理)
  'ASSIGNED_LITERAL|(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|jwt_secret|client_secret)\s*[:=]\s*["\x27][^"\x27$\{\}<>]{8,}["\x27]'
  # DB URI 含明文密码
  'MONGO_URI|mongodb(\+srv)?://[A-Za-z0-9_.-]+:[^@\x27" /]{6,}@'
  'PG_URI|postgres(ql)?://[A-Za-z0-9_.-]+:[^@\x27" /]{6,}@'
  'MYSQL_URI|mysql://[A-Za-z0-9_.-]+:[^@\x27" /]{6,}@'
)

is_placeholder() {
  local v="${1,,}"  # tolower
  case "$v" in
    ""|"''"|'""') return 0;;
    *your_*|*change*me*|*example*|*xxxxx*|*'<'*|*'${'*|*'{{'*|*placeholder*|*redacted*|*fake*|*dummy*|*sample*|*template*|*process.env*|*'os.environ'*|*'system.getenv'*) return 0;;
  esac
  # 全同字符
  echo "$v" | grep -qE '^["\x27]?(.)\1{7,}["\x27]?$' && return 0
  return 1
}

is_ignored() {
  echo "$1" | grep -qE '# ?security-scan: ?ignore|// ?security-scan: ?ignore|<!-- ?security-scan: ?ignore'
}

report() {
  local label="$1"; shift
  local file="$1"; shift
  local ln="$1"; shift
  local content="$*"
  echo -e "${RED}❌ [$label]${NC} ${CYA}$file:$ln${NC}"
  echo "    $(echo "$content" | head -c 200)"
  FOUND=1
  TOTAL_HITS=$((TOTAL_HITS+1))
}

scan_one_file() {
  local f="$1"
  [ ! -f "$f" ] && return
  # 跳过二进制
  echo "$f" | grep -qE "$SKIP_FILE_RE" && return
  file --mime "$f" 2>/dev/null | grep -q "charset=binary" && return

  for entry in "${RULES[@]}"; do
    local label="${entry%%|*}"
    local pat="${entry#*|}"

    grep -PIn "$pat" "$f" 2>/dev/null | while IFS=: read -r ln rest; do
      # 行级 ignore
      is_ignored "$rest" && continue
      # 提取带引号值来判 placeholder (只对 ASSIGNED_LITERAL/HEX_SECRET/HARDCODED)
      case "$label" in
        ASSIGNED_LITERAL|HEX_SECRET)
          val=$(echo "$rest" | grep -oE '["\x27][^"\x27]{8,}["\x27]' | head -1 | sed 's/^["\x27]//; s/["\x27]$//')
          [ -n "$val" ] && is_placeholder "$val" && continue
          ;;
      esac
      # 输出 (subshell 用 tempfile 汇总)
      echo "$label|$f|$ln|$rest" >>"$TMPHITS"
    done
  done
}

scan_files() {
  local files="$1"
  local hits
  hits=$(echo "$files" | grep -E "$DANGER_FILE" | grep -Ev "$WHITELIST_FILE" || true)
  if [ -n "$hits" ]; then
    echo -e "${RED}❌ [DANGER_FILE] 以下文件不该出现在 git:${NC}"
    echo "$hits" | sed 's/^/    /'
    FOUND=1
    TOTAL_HITS=$((TOTAL_HITS + $(echo "$hits" | wc -l)))
  fi
  # 模板文件检查内容
  local wl; wl=$(echo "$files" | grep -E "$WHITELIST_FILE" || true)
  echo "$wl" | while read f; do
    [ -z "$f" ] || [ ! -f "$f" ] && continue
    while IFS= read -r line; do
      [[ "$line" =~ ^\s*# ]] && continue
      key="${line%%=*}"; val="${line#*=}"
      [ -z "$val" ] || [ "$val" = "$line" ] && continue
      if [ "${#val}" -ge 8 ] && ! is_placeholder "$val"; then
        echo "TEMPLATE_LEAK|$f|?|$line" >>"$TMPHITS"
      fi
    done < "$f"
  done
}

scan_content() {
  local files="$1"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    scan_one_file "$f"
  done <<< "$files"
}

scan_history() {
  echo -e "${CYA}--- 扫历史 diff-filter=A 出现过的敏感文件 ---${NC}"
  local hist
  hist=$(git log --all --pretty=format: --name-only --diff-filter=A 2>/dev/null | sort -u | grep -E "$DANGER_FILE" | grep -Ev "$WHITELIST_FILE" || true)
  if [ -n "$hist" ]; then
    echo -e "${RED}❌ [HISTORY_LEAK]${NC}"
    echo "$hist" | while read f; do
      c=$(git log --all --oneline --diff-filter=A -- "$f" 2>/dev/null | head -3)
      echo "  $f"
      echo "$c" | sed 's/^/     /'
    done
    echo -e "${YEL}    → git filter-repo --invert-paths --path <file> + force push${NC}"
    FOUND=1
    TOTAL_HITS=$((TOTAL_HITS + $(echo "$hist" | wc -l)))
  fi
}

# ---- 汇总打印 ----
print_hits() {
  [ ! -s "$TMPHITS" ] && return
  # 按 label 分组
  echo
  echo -e "${YEL}--- 详细命中 ---${NC}"
  # 排序去重
  sort -u "$TMPHITS" | while IFS='|' read -r label f ln content; do
    echo -e "${RED}❌ [$label]${NC} ${CYA}$f:$ln${NC}"
    echo "    $(echo "$content" | head -c 200)"
  done
  echo
  echo -e "${YEL}--- 类别汇总 ---${NC}"
  awk -F'|' '{print $1}' "$TMPHITS" | sort | uniq -c | sort -rn
  local n
  n=$(sort -u "$TMPHITS" | wc -l)
  TOTAL_HITS=$((TOTAL_HITS + n))
  FOUND=1
}

TMPHITS=$(mktemp)
trap "rm -f $TMPHITS" EXIT

case "$MODE" in
  precommit)
    FILES=$(git diff --cached --name-only --diff-filter=ACM)
    [ -z "$FILES" ] && { echo "no staged"; exit 0; }
    echo -e "${GRN}[security-scan] pre-commit ($(echo "$FILES" | wc -l) staged files)${NC}"
    scan_files "$FILES"
    scan_content "$FILES"
    ;;
  head)
    echo -e "${GRN}[security-scan] HEAD scan${NC}"
    FILES=$(git ls-files)
    scan_files "$FILES"
    scan_content "$FILES"
    ;;
  audit)
    echo -e "${GRN}[security-scan] full audit${NC}"
    FILES=$(git ls-files)
    scan_files "$FILES"
    scan_content "$FILES"
    scan_history
    ;;
  *)
    echo "Usage: $0 {precommit|head|audit}"; exit 2;;
esac

print_hits

if [ "$FOUND" -eq 0 ]; then
  echo -e "${GRN}✅ security-scan 通过 ($MODE)${NC}"
  exit 0
else
  echo
  echo -e "${RED}💥 发现 $TOTAL_HITS 处潜在密钥泄漏${NC}"
  echo -e "${YEL}   误报处理: 行末加  # security-scan: ignore${NC}"
  echo -e "${YEL}   紧急绕过: SKIP_SECURITY_SCAN=1 git commit ...${NC}"
  exit 1
fi
