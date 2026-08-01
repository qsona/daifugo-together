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
pnpm run release --dry-run
pnpm run release
```

`release` ブランチの CI が成功すると、検証済みの同一コミットが Fly.io へ
デプロイされます。スクリプトは未コミットの変更、`origin/main` と一致しない
ローカル `main`、fast-forward できない `release` を検出すると中断します。
未コミットの変更を残したまま、コミット済みの `main` だけをリリースする場合は
`--allow-dirty` を指定します。`--dry-run` と併用できます。

```sh
pnpm run release --dry-run --allow-dirty
pnpm run release --allow-dirty
```
