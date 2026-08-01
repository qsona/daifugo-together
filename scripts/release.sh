#!/usr/bin/env bash
#
# 本番リリーススクリプト
#
# main を release に fast-forward push する。release の CI が成功すると、
# その検証済みコミットが Fly.io (https://daifugo-together.fly.dev) へデプロイされる。
#
# 使い方:
#   scripts/release.sh                         release を更新してデプロイを開始する
#   scripts/release.sh --dry-run               対象コミットと実行内容を表示する(pushしない)
#   scripts/release.sh --allow-dirty           未コミットの変更を無視して実行する
#   scripts/release.sh --dry-run --allow-dirty 両オプションは併用・順不同
#
set -euo pipefail

REMOTE=origin
MAIN=main
RELEASE=release

DRY_RUN=0
ALLOW_DIRTY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      ;;
    *)
      echo "✗ 不明な引数: $1 (使えるのは --dry-run / --allow-dirty)" >&2
      exit 2
      ;;
  esac
  shift
done

run() {
  if [ "$DRY_RUN" = 1 ]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

cd "$(git rev-parse --show-toplevel)"

# 未追跡ファイルも含め、意図しない作業中の状態からのリリースをデフォルトで防ぐ。
# --allow-dirty でもデプロイ対象は作業ツリーではなく、コミット済みの main のSHA。
DIRTY_STATUS=$(git status --porcelain)
if [ -n "$DIRTY_STATUS" ]; then
  if [ "$ALLOW_DIRTY" = 1 ]; then
    echo "⚠ 未コミットの変更を無視します。リリース対象には含まれません:" >&2
    printf '%s\n' "$DIRTY_STATUS" | sed 's/^/    /' >&2
  else
    echo "✗ 未コミットの変更があります。コミットまたは退避するか、--allow-dirty を指定してください。" >&2
    exit 1
  fi
fi

echo "▶ ${REMOTE} から ${MAIN}/${RELEASE} を取得..."
git fetch --quiet "$REMOTE" "$MAIN" "$RELEASE"

LOCAL_MAIN=$(git rev-parse "$MAIN")
ORIGIN_MAIN=$(git rev-parse "${REMOTE}/${MAIN}")
ORIGIN_RELEASE=$(git rev-parse "${REMOTE}/${RELEASE}")

# リリース対象は、すでに共有されている main のコミットに限定する。
if [ "$LOCAL_MAIN" != "$ORIGIN_MAIN" ]; then
  echo "✗ ローカル ${MAIN} が ${REMOTE}/${MAIN} と一致していません。" >&2
  echo "  先に ${MAIN} を push/同期してください: git log --oneline ${REMOTE}/${MAIN}..${MAIN}" >&2
  exit 1
fi

# release 独自のコミットや履歴の巻き戻しを許さない。
if ! git merge-base --is-ancestor "$ORIGIN_RELEASE" "$LOCAL_MAIN"; then
  echo "✗ ${REMOTE}/${RELEASE} は ${MAIN} の祖先ではないため fast-forward できません。" >&2
  echo "  ${RELEASE} に ${MAIN} 未取り込みのコミットがないか確認してください。" >&2
  exit 1
fi

if [ "$ORIGIN_RELEASE" = "$LOCAL_MAIN" ]; then
  echo "✓ ${REMOTE}/${RELEASE} は既に ${MAIN} と同一です。新しいCI/デプロイは開始しません。"
  echo "  直近の結果: https://github.com/qsona/daifugo-together/actions/workflows/deploy.yml"
  exit 0
fi

echo "▶ ${MAIN} → ${REMOTE}/${RELEASE} を fast-forward push..."
git --no-pager log --oneline "${REMOTE}/${RELEASE}..${MAIN}" | sed 's/^/    /'

# リモート側でも non-fast-forward push は拒否される。
run git push "$REMOTE" "${MAIN}:${RELEASE}"

# 次回の比較やローカルでの確認のため、ローカル release も同じSHAへ進める。
CURRENT=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT" = "$RELEASE" ]; then
  run git merge --ff-only "$MAIN"
else
  run git update-ref "refs/heads/${RELEASE}" "$LOCAL_MAIN"
fi

if [ "$DRY_RUN" = 1 ]; then
  echo "✓ [dry-run] 上記を実行すると release CI が始まり、成功後に本番デプロイされます。"
else
  echo "✓ release を pushしました。CI成功後に本番デプロイが始まります。"
  echo "  進行状況: https://github.com/qsona/daifugo-together/actions/workflows/deploy.yml"
fi
