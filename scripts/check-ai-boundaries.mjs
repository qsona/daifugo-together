import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const sourceExtensions = /\.(?:[cm]?[jt]s|tsx)$/;
const forbiddenImport =
  /(?:^|\/)(?:openai|anthropic|langchain|llamaindex|ollama)(?:$|\/)|^@anthropic-ai\/|^@google\/generative-ai$|^(?:node:)?(?:http|https|net|tls|dns|dgram)$|^undici$/;
const networkUse =
  /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\s*\(|\bhttps?:\/\//;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(path);
      }
      return sourceExtensions.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

function importsOf(source) {
  const imports = [];
  const pattern =
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    imports.push(match[1] ?? match[2]);
  }
  return imports.filter(Boolean);
}

async function violations(aiDirectory) {
  const packageJsonPath = resolve(aiDirectory, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const declared = {
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies,
  };
  const findings = Object.keys(declared)
    .filter((dependency) => forbiddenImport.test(dependency))
    .map(
      (dependency) => `${packageJsonPath}: forbidden dependency ${dependency}`,
    );

  for (const path of await sourceFiles(resolve(aiDirectory, 'src'))) {
    const source = await readFile(path, 'utf8');
    for (const dependency of importsOf(source)) {
      if (forbiddenImport.test(dependency)) {
        findings.push(`${path}: forbidden import ${dependency}`);
      }
    }
    if (networkUse.test(source)) {
      findings.push(`${path}: direct network I/O is forbidden`);
    }
  }
  return findings;
}

const aiDirectory = resolve(process.argv[2] ?? 'packages/ai');
const findings = await violations(aiDirectory);
if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log('AI boundary OK (no LLM SDK or network I/O)');
}
