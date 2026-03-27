#!/usr/bin/env bash
# 字体规范静态检查脚本
# 规范：font-size 只允许 $font-size-* 变量，font-weight 只允许 $font-weight-* 变量
# 豁免：variables.scss 本身、font-size: 0、clamp()、inherit、Login hero（800/900）

set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

errors=0
warnings=0

echo "=== 字体规范静态检查 ==="
echo ""

# 规则 1：font-size 裸写检查
echo -e "${YELLOW}[规则 1] font-size 必须使用 \$font-size-* 变量${NC}"
raw_sizes=$(grep -rn 'font-size:' src/ --include='*.scss' --include='*.css' \
    | grep -v node_modules \
    | grep -v variables.scss \
    | grep -v 'font-size: \$' \
    | grep -v 'font-size: 0' \
    | grep -v 'font-size:.*clamp' \
    | grep -v 'font-size: inherit' \
    | grep -v 'font-size: var(' \
    | grep -v '^\s*//' \
    || true)

if [ -n "$raw_sizes" ]; then
    echo "$raw_sizes" | while IFS= read -r line; do
        # Hero/品牌展示区豁免
        if echo "$line" | grep -qE "LoginPage|aboutTitle"; then
            echo -e "  ${YELLOW}[豁免] $line${NC}"
            continue
        fi
        echo -e "  ${RED}[违规] $line${NC}"
    done
    non_exempt=$(echo "$raw_sizes" | grep -cvE "LoginPage|aboutTitle" || true)
    errors=$((errors + non_exempt))
else
    echo -e "  ${GREEN}✓ 无违规${NC}"
fi
echo ""

# 规则 1b：clamp() 内部的裸写 px 检查
echo -e "${YELLOW}[规则 1b] clamp() 内不得含裸写 px（必须全用变量）${NC}"
clamp_raw=$(grep -rn 'font-size:.*clamp' src/ --include='*.scss' --include='*.css' \
    | grep -v variables.scss \
    | grep '[0-9]\+px' \
    || true)

if [ -n "$clamp_raw" ]; then
    echo "$clamp_raw" | while IFS= read -r line; do
        file=$(echo "$line" | cut -d: -f1)
        lineno=$(echo "$line" | cut -d: -f2)
        # 检查附近 5 行内是否有豁免标记（hero/品牌展示区）
        context=$(sed -n "$((lineno > 5 ? lineno - 5 : 1)),${lineno}p" "$file" 2>/dev/null || true)
        if echo "$context" | grep -qE "LoginPage|aboutTitle|brandWord|splashTitle|heroTitle"; then
            echo -e "  ${YELLOW}[豁免] $line${NC}"
            continue
        fi
        echo -e "  ${RED}[违规] $line${NC}"
    done
    non_exempt=$(echo "$clamp_raw" | while IFS= read -r line; do
        file=$(echo "$line" | cut -d: -f1)
        lineno=$(echo "$line" | cut -d: -f2)
        context=$(sed -n "$((lineno > 5 ? lineno - 5 : 1)),${lineno}p" "$file" 2>/dev/null || true)
        echo "$context" | grep -qE "LoginPage|aboutTitle|brandWord|splashTitle|heroTitle" || echo "v"
    done | wc -l || true)
    errors=$((errors + non_exempt))
else
    echo -e "  ${GREEN}✓ 无违规${NC}"
fi
echo ""

# 规则 2：font-weight 裸写检查
echo -e "${YELLOW}[规则 2] font-weight 必须使用 \$font-weight-* 变量${NC}"
raw_weights=$(grep -rn 'font-weight:' src/ --include='*.scss' --include='*.css' \
    | grep -v node_modules \
    | grep -v variables.scss \
    | grep -v 'font-weight: \$' \
    | grep -v 'font-weight: normal' \
    | grep -v 'font-weight: inherit' \
    | grep -v '^\s*//' \
    || true)

if [ -n "$raw_weights" ]; then
    echo "$raw_weights" | while IFS= read -r line; do
        file=$(echo "$line" | cut -d: -f1)
        if echo "$file" | grep -q "LoginPage"; then
            echo -e "  ${YELLOW}[豁免] $line${NC}"
            continue
        fi
        echo -e "  ${RED}[违规] $line${NC}"
    done
    non_exempt=$(echo "$raw_weights" | grep -cv "LoginPage" || true)
    errors=$((errors + non_exempt))
else
    echo -e "  ${GREEN}✓ 无违规${NC}"
fi
echo ""

# 规则 3：关键选择器必须有显式 font-size 声明
echo -e "${YELLOW}[规则 3] 关键选择器必须有显式 font-size${NC}"
# 定义必须有 font-size 的选择器（可见文本元素）
required_selectors=(
    ".btn"
    ".input"
    ".pageTitle"
    ".title"
    ".subtitle"
    ".description"
    ".label"
    ".badge"
    ".nav-item"
    ".nav-label"
    ".triggerText"
    ".sectionTitle"
    ".statLabel"
    ".statValue"
    ".statSublabel"
    ".vendorName"
    ".groupTitle"
    ".fieldLabel"
    ".fieldHint"
    ".pollIntervalLabel"
    ".tileLabel"
    ".tileValue"
    ".linkItem"
)

for selector in "${required_selectors[@]}"; do
    # 搜索定义了该选择器但没有 font-size 的文件
    files_with_selector=$(grep -rln "$selector {" src/ --include='*.scss' 2>/dev/null || true)
    for file in $files_with_selector; do
        # 提取该选择器块的内容（简化检查：看文件中是否在该选择器附近有 font-size）
        has_font_size=$(awk \
            "/$selector/"'{found=1} found && /font-size/{print; found=0} found && /\}$/{found=0}' \
            "$file" || true)
        if [ -z "$has_font_size" ]; then
            echo -e "  ${YELLOW}[警告] $file: $selector 缺少显式 font-size（可能靠继承）${NC}"
            warnings=$((warnings + 1))
        fi
    done
done
echo ""

# 汇总
echo "=== 检查完成 ==="
echo -e "违规: ${RED}${errors}${NC}  警告: ${YELLOW}${warnings}${NC}"

if [ "$errors" -gt 0 ]; then
    exit 1
fi
exit 0
