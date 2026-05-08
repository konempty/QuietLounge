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
#   ./run-tests.sh             # 전체 실행 (순차)
#   ./run-tests.sh --parallel  # 독립 step 을 background 병렬 실행 (전체 ~50% 시간 절감)
#                              # — pnpm build 는 sync barrier 로 먼저 (Swift/Android 가 산출물 읽음)
#                              # — 메모리 헤드룸 부족 환경 (~8GB RAM 이하) 에선 순차 모드 권장
#   ./run-tests.sh --fast      # lint 스텝 생략
#   ./run-tests.sh --js        # JS 만
#   ./run-tests.sh --android   # Android 만
#   ./run-tests.sh --swift     # Swift 만

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
PARALLEL=false

for arg in "$@"; do
    case "$arg" in
        --js)       RUN_ANDROID=false; RUN_SWIFT=false; RUN_LINT=false ;;
        --android)  RUN_JS=false; RUN_SWIFT=false; RUN_LINT=false ;;
        --swift)    RUN_JS=false; RUN_ANDROID=false; RUN_LINT=false ;;
        --fast)     RUN_LINT=false ;;
        --parallel) PARALLEL=true ;;
        -h|--help)
            sed -n '1,28p' "$0"
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

# ── 병렬 실행 helper ─────────────────────────────────────────────
# 각 task 를 background 로 띄우고 stdout/stderr 을 임시 log 에 buffer.
# 모든 task 종료 후 log 를 순서대로 출력 — interleaving 회피.
declare -a BG_PIDS=()
declare -a BG_LABELS=()
declare -a BG_LOGS=()

bg_run() {
    local label="$1"; shift
    local logf
    logf=$(mktemp -t qltest.XXXXXX)
    (
        printf '%s→%s %s%s%s\n' "$CYAN" "$RESET" "$DIM" "$*" "$RESET"
        "$@"
    ) >"$logf" 2>&1 &
    BG_PIDS+=("$!")
    BG_LABELS+=("$label")
    BG_LOGS+=("$logf")
}

bg_wait_all() {
    local i
    for i in "${!BG_PIDS[@]}"; do
        local pid="${BG_PIDS[$i]}"
        local label="${BG_LABELS[$i]}"
        local logf="${BG_LOGS[$i]}"
        if wait "$pid"; then
            grep -v '^QL_COV:' "$logf" 2>/dev/null
            ok "$label"
        else
            grep -v '^QL_COV:' "$logf" 2>/dev/null
            fail "$label"
        fi
        # phase 가 출력한 QL_COV: 라인을 마지막 요약용 COVERAGE 배열에 흡수
        while IFS= read -r line; do
            COVERAGE+=("${line#QL_COV:}")
        done < <(grep '^QL_COV:' "$logf" 2>/dev/null)
        rm -f "$logf"
    done
    BG_PIDS=()
    BG_LABELS=()
    BG_LOGS=()
}

# 커버리지 저장소 — 테스트 스텝에서 채움, 마지막 요약에서 출력.
declare -a COVERAGE=()

# ── parallel 모드용 phase wrapper ────────────────────────────────
# 각 phase 가 build + test + coverage 출력까지 완결. parallel 모드에서 background 로 실행.
# coverage 라인은 `QL_COV:<row>` 접두로 stdout 출력 → bg_wait_all 이 log 에서 grep 으로 흡수.
# 자세한 stdout 은 bg_wait_all 이 log 를 그대로 출력하므로 fine-grained 진행은 그대로 보임.
# parallel barrier — 산출물 (esbuild) 을 Swift / Android phase 가 읽기 *전* 에 sync 빌드.
# Swift WebViewScriptsTests / Android preBuild 가 같은 산출물을 검증하므로 race / stale read 회피.
phase_build() {
    command -v pnpm >/dev/null 2>&1 || { echo "skip: pnpm 미설치"; return 0; }
    [ -d node_modules ] || { pnpm install --frozen-lockfile 2>/dev/null || pnpm install; }
    pnpm build
}

phase_js() {
    command -v pnpm >/dev/null 2>&1 || { echo "skip: pnpm 미설치"; return 0; }
    pnpm typecheck || return $?
    pnpm test:coverage || return $?
    [ -f coverage/coverage-summary.json ] && python3 -c "
import json
d = json.load(open('coverage/coverage-summary.json'))['total']
print(f\"QL_COV:JS / TS      stmts={d['statements']['pct']:.1f}%  branch={d['branches']['pct']:.1f}%  funcs={d['functions']['pct']:.1f}%  lines={d['lines']['pct']:.1f}%\")
" 2>/dev/null
    return 0
}

phase_swift() {
    command -v swift >/dev/null 2>&1 || { echo "skip: swift 미설치"; return 0; }
    cd swift-tests || return 1
    swift test --enable-code-coverage || return $?
    local profdata=".build/debug/codecov/default.profdata"
    local xctest_bin
    xctest_bin=$(ls -d .build/debug/*.xctest 2>/dev/null | head -1)
    if [ -n "$xctest_bin" ] && [ -f "$profdata" ]; then
        [ -d "$xctest_bin/Contents/MacOS" ] && \
            xctest_bin="$xctest_bin/Contents/MacOS/$(basename "$xctest_bin" .xctest)"
        local cov
        cov=$(xcrun llvm-cov report "$xctest_bin" -instr-profile="$profdata" 2>/dev/null | awk '
            /^TOTAL/ { printf "region=%s  func=%s  line=%s", $4, $7, $10 }')
        [ -n "$cov" ] && echo "QL_COV:Swift        $cov"
    fi
    return 0
}

phase_eslint() {
    command -v pnpm >/dev/null 2>&1 || { echo "skip: pnpm 미설치"; return 0; }
    pnpm run lint
}

phase_swiftlint() {
    command -v swiftlint >/dev/null 2>&1 || { echo "skip: swiftlint 미설치"; return 0; }
    cd safari-extension/QuietLounge && swiftlint
}

phase_android() {
    [ -x android-app/gradlew ] || { echo "skip: gradlew 미존재"; return 0; }
    cd android-app || return 1
    ./gradlew :app:jacocoTestReport || return $?
    local jacoco_xml="app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml"
    [ -f "$jacoco_xml" ] && python3 -c "
import xml.etree.ElementTree as ET
r = ET.parse('$jacoco_xml').getroot()
def pct(t):
    for c in r.findall('counter'):
        if c.get('type') == t:
            cov = int(c.get('covered', 0)); mis = int(c.get('missed', 0))
            tot = cov + mis
            return f'{100*cov/tot:.1f}%' if tot else 'n/a'
    return 'n/a'
print(f'QL_COV:Android      instr={pct(\"INSTRUCTION\")}  branch={pct(\"BRANCH\")}  line={pct(\"LINE\")}  method={pct(\"METHOD\")}')
" 2>/dev/null
    return 0
}

phase_ktlint() {
    [ -x android-app/gradlew ] || { echo "skip: gradlew 미존재"; return 0; }
    cd android-app && ./gradlew ktlintCheck
}

# parallel 전용: Android + ktlint 는 같은 gradle daemon 을 점유하므로 한 background 안에서 직렬.
phase_gradle() {
    [ -x android-app/gradlew ] || { echo "skip: gradlew 미존재"; return 0; }
    cd android-app || return 1
    local rc=0
    if $RUN_ANDROID; then
        ./gradlew :app:jacocoTestReport || rc=$?
        local jacoco_xml="app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml"
        [ -f "$jacoco_xml" ] && python3 -c "
import xml.etree.ElementTree as ET
r = ET.parse('$jacoco_xml').getroot()
def pct(t):
    for c in r.findall('counter'):
        if c.get('type') == t:
            cov = int(c.get('covered', 0)); mis = int(c.get('missed', 0))
            tot = cov + mis
            return f'{100*cov/tot:.1f}%' if tot else 'n/a'
    return 'n/a'
print(f'QL_COV:Android      instr={pct(\"INSTRUCTION\")}  branch={pct(\"BRANCH\")}  line={pct(\"LINE\")}  method={pct(\"METHOD\")}')
" 2>/dev/null
    fi
    if $RUN_LINT; then ./gradlew ktlintCheck || rc=$?; fi
    return $rc
}

# ── parallel 분기 ───────────────────────────────────────────────
# barrier: pnpm build 를 sync 로 먼저 — Swift WebViewScriptsTests / Android preBuild 가 같은
#          esbuild 산출물을 읽으므로 race / 부분 write 가 닿지 않도록 한 번 끝낸 뒤 background 시작.
# Group A (background 동시): JS test / Swift / ESLint / SwiftLint
# Group B (background 1 슬롯, 내부 직렬): Android tests → ktlint (gradle daemon 공유)
# 모든 background 종료 후 sequential 코드 부분은 skip 하고 요약으로 점프.
#
# 참고: 메모리 헤드룸 부족 환경 (~8GB RAM 이하 등) 에선 swift / pnpm / gradle 동시 점유로
#       OOM 가능 — 그런 환경에선 `--parallel` 없이 순차 모드를 권장.
if $PARALLEL; then
    section "Parallel run"
    if $RUN_JS || $RUN_SWIFT || $RUN_ANDROID; then
        run "Build (esbuild) [barrier]" phase_build
        # barrier 실패 시 산출물이 stale 상태 → 모든 phase 가 의미 없음. 즉시 abort.
        if [ ${#FAILED[@]} -gt 0 ]; then
            section "Summary"
            for r in "${RESULTS[@]}"; do echo "  $r"; done
            printf '\n%s%sBuild (esbuild) [barrier] failed — parallel run aborted%s\n' "$BOLD" "$RED" "$RESET"
            exit 1
        fi
    fi
    $RUN_JS         && bg_run "JS / TS (Vitest)"   phase_js
    $RUN_SWIFT      && bg_run "Swift"              phase_swift
    $RUN_LINT       && bg_run "ESLint"             phase_eslint
    $RUN_LINT       && bg_run "SwiftLint"          phase_swiftlint
    if $RUN_ANDROID || $RUN_LINT; then
        bg_run "Android + ktlint (gradle)" phase_gradle
    fi
    bg_wait_all
fi

# ── 1. JavaScript / TypeScript (Vitest) ─────────────────────────
if ! $PARALLEL && $RUN_JS; then
    section "JS / TS (Vitest)"
    if command -v pnpm >/dev/null 2>&1; then
        if [ ! -d node_modules ]; then
            printf '%snode_modules 가 없음 — pnpm install 먼저 실행%s\n' "$DIM" "$RESET"
            pnpm install --frozen-lockfile 2>/dev/null || pnpm install
        fi
        # 산출물은 .gitignore — 매 실행 시 esbuild 가 결정론적으로 재생성한다.
        run "Build (esbuild)" pnpm build
        run "Typecheck (tsc)" pnpm typecheck
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
if ! $PARALLEL && $RUN_ANDROID; then
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
if ! $PARALLEL && $RUN_SWIFT; then
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
if ! $PARALLEL && $RUN_LINT; then
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
