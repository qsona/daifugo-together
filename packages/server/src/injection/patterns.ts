export interface Layer1Hits {
  hard: string[];
  soft: string[];
}

type Pattern = { id: string; expression: RegExp };

const HARD_PATTERNS: Pattern[] = [
  {
    id: 'ignore-instructions-en',
    expression:
      /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?)\b/iu,
  },
  {
    id: 'ignore-instructions-ja',
    expression:
      /(?:これまで|以前)の(?:指示|命令|プロンプト)を(?:すべて)?(?:無視|忘れ)/u,
  },
  {
    id: 'force-role-ja',
    expression:
      /あなたは(?:今から|以後)[、,\s]?.{0,20}(?:ai|アシスタント|シェル|ターミナル|開発者モード)/iu,
  },
  {
    id: 'force-role-en',
    expression: /\b(?:you are now|developer mode|dan)\b/iu,
  },
  {
    id: 'system-assets',
    expression:
      /system\s*prompt|システムプロンプト|環境変数|api\s*key|packages\/(?:core|server|ai|pipeline|web)|meta\.json|rule\.test\.ts|\.github\//iu,
  },
  {
    id: 'code-execution',
    expression:
      /```|require\s*\(|\bimport\s+|eval\s*\(|child_process|fetch\s*\(|\bcurl\s+|rm\s+-rf/iu,
  },
  {
    id: 'pipeline-interference',
    expression:
      /テストを(?:スキップ|skip|飛ば)|ci\s*を(?:通|パス)せ|(?:auto-?)?merge|レビュー(?:なし|を通)|差分ガード/iu,
  },
];

const SOFT_PATTERNS: Pattern[] = [
  { id: 'prompt', expression: /プロンプト|prompt/iu },
  { id: 'injection', expression: /インジェクション|injection/iu },
  { id: 'llm', expression: /\bllm\b/iu },
  { id: 'codex', expression: /\bcodex\b/iu },
  { id: 'implementation', expression: /実装(?:する|の際|時)/u },
  { id: 'repository', expression: /リポジトリ|repository/iu },
  { id: 'code', expression: /コード|code/iu },
  { id: 'output', expression: /出力(?:せよ|して)|output/iu },
];

export function matchPatterns(normalizedText: string): Layer1Hits {
  return {
    hard: HARD_PATTERNS.filter(({ expression }) =>
      expression.test(normalizedText),
    ).map(({ id }) => id),
    soft: SOFT_PATTERNS.filter(({ expression }) =>
      expression.test(normalizedText),
    ).map(({ id }) => id),
  };
}
