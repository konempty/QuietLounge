#!/usr/bin/env bash
# run-tests.sh — 모든 플랫폼 테스트를 순차 실행하는 래퍼.
#
# 실행 순서:
#   1. JS (shared + chrome-extension + safari-extension 공통 로직) via pnpm + Vitest
#   2. Android 네이티브 Kotlin via Gradle + JUnit
#   3. Swift Package (iOS/macOS 공통 pure logic) via swift test
#   4. SwiftLint + ktlintCheck + ESLint 요약 (빠른 회귀 체크)
#
# 플랫폼 도구가 누락된 경우 해당 스텝은 skip 하고 진행.
# 실패한 스텝이 있으면 마지막에 비0 exit.
#
# 사용:
#   ./run-tests.sh           # 전체 실행
#   ./run-tests.sh --fast    # lint 스텝 생략
#   ./run-tests.sh --js      # JS 만
#   ./run-tests.sh --android # Android 만
#   ./run-tests.sh --swift   # Swift 만

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# 색상
BOLD=$'\033[1m'
GREEN=$'\033[32m'
RED=$'\033[31m'
YELLOW=$'\033[33m'
CYAN=$'\033[36m'
DIM=$'\033[2m'
RESET=$'\033[0m'

RUN_JS=true
RUN_ANDROID=true
RUN_SWIFT=true
RUN_LINT=true

for arg in "$@"; do
    case "$arg" in
        --js)      RUN_ANDROID=false; RUN_SWIFT=false; RUN_LINT=false ;;
        --android) RUN_JS=false; RUN_SWIFT=false; RUN_LINT=false ;;
        --swift)   RUN_JS=false; RUN_ANDROID=false; RUN_LINT=false ;;
        --fast)    RUN_LINT=false ;;
        -h|--help)
            sed -n '1,25p' "$0"
            exit 0
            ;;
    esac
done

declare -a RESULTS=()
declare -a FAILED=()

section() {
    printf '\n%s%s━━━ %s ━━━%s\n' "$BOLD" "$CYAN" "$1" "$RESET"
}

ok()   { printf '%s✓%s %s\n'   "$GREEN" "$RESET" "$1"; RESULTS+=("✓ $1"); }
fail() { printf '%s✗%s %s\n'   "$RED"   "$RESET" "$1"; RESULTS+=("✗ $1"); FAILED+=("$1"); }
skip() { printf '%s-%s %s %s(skipped)%s\n' "$YELLOW" "$RESET" "$1" "$DIM" "$RESET"; RESULTS+=("- $1 (skipped)"); }

run() {
    local label="$1"; shift
    printf '%s→%s %s%s%s\n' "$CYAN" "$RESET" "$DIM" "$*" "$RESET"
    if "$@"; then ok "$label"; else fail "$label"; fi
}

# 커버리지 저장소 — 테스트 스텝에서 채움, 마지막 요약에서 출력.
declare -a COVERAGE=()

# ── 1. JavaScript / TypeScript (Vitest) ─────────────────────────
if $RUN_JS; then
    section "JS / TS (Vitest)"
    if command -v pnpm >/dev/null 2>&1; then
        if [ ! -d node_modules ]; then
            printf '%snode_modules 가 없음 — pnpm install 먼저 실행%s\n' "$DIM" "$RESET"
            pnpm install --frozen-lockfile 2>/dev/null || pnpm install
        fi
        run "JS tests" pnpm test:coverage
        # vitest v8 "All files" 행: File | Stmts | Branch | Funcs | Lines | ...
        if [ -f coverage/coverage-summary.json ]; then
            cov=$(python3 -c "
import json
d = json.load(open('coverage/coverage-summary.json'))['total']
print(f\"stmts={d['statements']['pct']:.1f}%  branch={d['branches']['pct']:.1f}%  funcs={d['functions']['pct']:.1f}%  lines={d['lines']['pct']:.1f}%\")
" 2>/dev/null)
            [ -n "$cov" ] && COVERAGE+=("JS / TS      $cov")
        fi
    else
        skip "JS tests (pnpm 미설치)"
    fi
fi

# ── 2. Android (JUnit + JaCoCo) ─────────────────────────────────
if $RUN_ANDROID; then
    section "Android (JUnit)"
    if [ -x android-app/gradlew ]; then
        run "Android unit tests" bash -c "cd android-app && ./gradlew :app:jacocoTestReport"
        JACOCO_XML="android-app/app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml"
        if [ -f "$JACOCO_XML" ]; then
            cov=$(python3 -c "
import xml.etree.ElementTree as ET
r = ET.parse('$JACOCO_XML').getroot()
def pct(t):
    for c in r.findall('counter'):
        if c.get('type') == t:
            cov = int(c.get('covered', 0)); mis = int(c.get('missed', 0))
            tot = cov + mis
            return f'{100*cov/tot:.1f}%' if tot else 'n/a'
    return 'n/a'
print(f'instr={pct(\"INSTRUCTION\")}  branch={pct(\"BRANCH\")}  line={pct(\"LINE\")}  method={pct(\"METHOD\")}')
" 2>/dev/null)
            [ -n "$cov" ] && COVERAGE+=("Android      $cov")
        fi
    else
        skip "Android tests (gradlew 미존재)"
    fi
fi

# ── 3. Swift Package (XCTest + llvm-cov) ────────────────────────
if $RUN_SWIFT; then
    section "Swift (swift test)"
    if command -v swift >/dev/null 2>&1; then
        run "Swift tests" bash -c "cd swift-tests && swift test --enable-code-coverage"
        # llvm-cov report 의 TOTAL 행 파싱
        PROFDATA="swift-tests/.build/debug/codecov/default.profdata"
        XCTEST_BIN=$(ls -d swift-tests/.build/debug/*.xctest 2>/dev/null | head -1)
        if [ -n "$XCTEST_BIN" ] && [ -f "$PROFDATA" ]; then
            # macOS 번들은 .xctest/Contents/MacOS/<name> 경로에 실제 바이너리가 있음
            if [ -d "$XCTEST_BIN/Contents/MacOS" ]; then
                XCTEST_BIN="$XCTEST_BIN/Contents/MacOS/$(basename "$XCTEST_BIN" .xctest)"
            fi
            cov=$(xcrun llvm-cov report "$XCTEST_BIN" -instr-profile="$PROFDATA" 2>/dev/null | awk '
                /^TOTAL/ {
                    # 컬럼: Regions Missed Cover Functions Missed Exec Lines Missed Cover ...
                    printf "region=%s  func=%s  line=%s", $4, $7, $10
                }')
            [ -n "$cov" ] && COVERAGE+=("Swift        $cov")
        fi
    else
        skip "Swift tests (swift 미설치)"
    fi
fi

# ── 4. Lint (빠른 회귀 체크) ────────────────────────────────────
if $RUN_LINT; then
    section "Lint"
    if command -v pnpm >/dev/null 2>&1; then
        run "ESLint" pnpm run lint
    fi
    if [ -x android-app/gradlew ]; then
        run "ktlintCheck" bash -c "cd android-app && ./gradlew ktlintCheck"
    fi
    if command -v swiftlint >/dev/null 2>&1; then
        run "SwiftLint" bash -c "cd safari-extension/QuietLounge && swiftlint"
    else
        skip "SwiftLint (swiftlint 미설치 — brew install swiftlint)"
    fi
fi

# ── 커버리지 요약 ───────────────────────────────────────────────
if [ ${#COVERAGE[@]} -gt 0 ]; then
    section "Coverage"
    for c in "${COVERAGE[@]}"; do echo "  $c"; done
fi

# ── 요약 ────────────────────────────────────────────────────────
section "Summary"
for r in "${RESULTS[@]}"; do echo "  $r"; done

if [ ${#FAILED[@]} -gt 0 ]; then
    printf '\n%s%s%d failed:%s\n' "$BOLD" "$RED" "${#FAILED[@]}" "$RESET"
    for f in "${FAILED[@]}"; do echo "  - $f"; done
    exit 1
else
    printf '\n%s%sAll passed%s\n' "$BOLD" "$GREEN" "$RESET"
    exit 0
fi
