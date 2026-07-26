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
