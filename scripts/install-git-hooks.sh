#!/bin/sh

set -eu

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "Gitリポジトリ内で実行してください。" >&2
  exit 1
}

cd "$repo_root"
expected=.githooks
actual=$(git config --local --get core.hooksPath || true)

if [ "${1:-}" = --check ]; then
  if [ "$actual" != "$expected" ]; then
    echo "Git hookが無効です。pnpm hooks:install を実行してください。" >&2
    exit 1
  fi
  if [ ! -x "$expected/pre-push" ]; then
    echo "$expected/pre-push に実行権限がありません。pnpm hooks:install を実行してください。" >&2
    exit 1
  fi
  echo "Git hookは有効です。"
  exit 0
fi

git config --local core.hooksPath "$expected"
chmod +x "$expected/pre-push"
echo "Git hookを有効にしました: core.hooksPath=$expected"
