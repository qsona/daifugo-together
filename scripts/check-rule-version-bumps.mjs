import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_FILE = 'rule-versions.json';
const BUNDLE_FILE = 'rule-bundles.json';
const RULE_DIRECTORY = /^r\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function sortedJson(value) {
  return `${JSON.stringify(
    Object.fromEntries(
      Object.entries(value).toSorted(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
    null,
    2,
  )}\n`;
}

function validateVersions(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([ruleId, version]) =>
        !RULE_DIRECTORY.test(ruleId) ||
        !Number.isSafeInteger(version) ||
        version < 2,
    )
  ) {
    throw new Error(
      `${VERSION_FILE} must map rule IDs to integer versions >= 2`,
    );
  }
}

function validateBundles(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([ruleId, record]) =>
        !RULE_DIRECTORY.test(ruleId) || !isBundleRecord(record),
    )
  ) {
    throw new Error(
      `${BUNDLE_FILE} must map rule IDs to versioned SHA-256 hashes`,
    );
  }
}

function isBundleRecord(value) {
  return (
    (typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)) ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Number.isSafeInteger(value.version) &&
      value.version >= 1 &&
      typeof value.hash === 'string' &&
      /^[0-9a-f]{64}$/u.test(value.hash))
  );
}

async function bundleHash(packageRoot, ruleId) {
  return createHash('sha256')
    .update(await readFile(join(packageRoot, 'dist', ruleId, 'rule.js')))
    .digest('hex');
}

export async function synchronizeRuleVersions({ packageRoot, write = false }) {
  const directories = (await readdir(packageRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && RULE_DIRECTORY.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const versionPath = join(packageRoot, VERSION_FILE);
  const bundlePath = join(packageRoot, BUNDLE_FILE);
  const versions = await readJson(versionPath, {});
  const recordedBundles = await readJson(bundlePath, {});
  validateVersions(versions);
  validateBundles(recordedBundles);

  const nextVersions = { ...versions };
  const nextBundles = {};
  const bumped = [];
  const acknowledged = [];
  const initialized = [];

  for (const ruleId of directories) {
    const hash = await bundleHash(packageRoot, ruleId);
    const recorded = recordedBundles[ruleId];
    const declaredVersion = nextVersions[ruleId] ?? 1;
    if (recorded === undefined) {
      nextBundles[ruleId] = { version: declaredVersion, hash };
      initialized.push(ruleId);
      continue;
    }
    const recordedVersion =
      typeof recorded === 'string' ? declaredVersion : recorded.version;
    const recordedHash =
      typeof recorded === 'string' ? recorded : recorded.hash;
    if (declaredVersion < recordedVersion) {
      throw new Error(
        `${ruleId} declares v${String(declaredVersion)} below recorded v${String(recordedVersion)}`,
      );
    }
    if (recordedHash === hash) {
      nextBundles[ruleId] = { version: declaredVersion, hash };
      continue;
    }
    const version =
      declaredVersion > recordedVersion ? declaredVersion : declaredVersion + 1;
    nextVersions[ruleId] = version;
    nextBundles[ruleId] = { version, hash };
    const change = {
      ruleId,
      previousVersion: recordedVersion,
      version,
      recorded: recordedHash,
      hash,
    };
    if (declaredVersion > recordedVersion) {
      acknowledged.push(change);
    } else {
      bumped.push(change);
    }
  }

  const versionSource = sortedJson(nextVersions);
  const bundleSource = sortedJson(nextBundles);
  const currentVersionSource = await readFile(versionPath, 'utf8').catch(
    () => '',
  );
  const currentBundleSource = await readFile(bundlePath, 'utf8').catch(
    () => '',
  );
  const changed =
    versionSource !== currentVersionSource ||
    bundleSource !== currentBundleSource;

  if (write && changed) {
    await mkdir(dirname(versionPath), { recursive: true });
    await writeFile(versionPath, versionSource);
    await writeFile(bundlePath, bundleSource);
  }

  return { changed, bumped, acknowledged, initialized };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageRoot = resolve('packages/rules');
  const write = process.argv.includes('--write');
  const result = await synchronizeRuleVersions({ packageRoot, write });

  for (const { ruleId, previousVersion, version } of result.bumped) {
    console.log(
      `${ruleId}: bundle changed, bumping v${String(previousVersion)} -> v${String(version)}`,
    );
  }
  for (const { ruleId, version } of result.acknowledged) {
    console.log(`${ruleId}: recording manually declared v${String(version)}`);
  }
  for (const ruleId of result.initialized) {
    console.log(`${ruleId}: recording initial bundle hash`);
  }

  if (result.changed && !write) {
    console.error(
      `Rule bundle hashes are out of sync. Run this command with --write.`,
    );
    process.exitCode = 1;
  }
}
