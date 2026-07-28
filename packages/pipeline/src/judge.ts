if (process.argv.includes('--review')) {
  await import('./review-cli.js');
} else {
  await import('./judge-run.js');
}
