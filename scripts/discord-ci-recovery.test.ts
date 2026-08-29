import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = '.github/workflows/discord-ci-recovery-notify.yml';

describe('Discord CI recovery notification workflow', () => {
  it('CIとproduction deployの回復だけをalert channelへ通知する', async () => {
    const workflow = await readFile(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('- CI');
    expect(workflow).toContain('- Deploy production');
    expect(workflow).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
    expect(workflow).toContain(
      "failure_conclusions='^(failure|timed_out|startup_failure|action_required)$'",
    );
    expect(workflow).toContain("steps.meta.outputs.recovered == 'true'");
    expect(workflow).toContain(
      'webhook: ${{ secrets.DISCORD_ALERT_WEBHOOK_URL }}',
    );
    expect(workflow).not.toContain('DISCORD_CI_WEBHOOK_URL');
  });

  it('同一branchの直前runと再実行時の直前attemptを判定する', async () => {
    const workflow = await readFile(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('--data-urlencode "branch=$RUN_BRANCH"');
    expect(workflow).toContain('.run_number < $current_run_number');
    expect(workflow).toContain(
      'actions/runs/$RUN_ID/attempts/$previous_attempt',
    );
    expect(workflow).toContain('per_page=100');
  });

  it('workflow_runの権限を持たず、trigger元のcodeを実行しない', async () => {
    const workflow = await readFile(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('permissions: {}');
    expect(workflow).not.toContain('actions/checkout');
    expect(workflow).not.toContain('download-artifact');
    expect(workflow).toContain(
      'sarisia/actions-status-discord@eb045afee445dc055c18d3d90bd0f244fd062708',
    );
  });

  it('手動実行ではalert channelに明示的なtest回復通知を送る', async () => {
    const workflow = await readFile(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('recovered=true');
    expect(workflow).toContain('test_marker="[TEST] "');
  });
});
