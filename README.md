# daifugo-together

## 開発環境

- Node.js 26.5.0（`.node-version`）
- pnpm 11.17.0（`package.json#packageManager`）

Node.js 26 には Corepack が同梱されないため、初回だけ Corepack を導入します。

```sh
npm install --global corepack@latest
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

## 本番リリース

`main` への push では本番デプロイされません。`main` のリリース対象を確認し、
次のスクリプトで `release` ブランチへ fast-forward push します。

```sh
scripts/release.sh --dry-run
scripts/release.sh
```

`release` ブランチの CI が成功すると、検証済みの同一コミットが Fly.io へ
デプロイされます。スクリプトは未コミットの変更、`origin/main` と一致しない
ローカル `main`、fast-forward できない `release` を検出すると中断します。
