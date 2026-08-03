import { resolve } from 'node:path';

import { loadRuleCodeBundles } from '@daifugo/rules';

import { createAppServer } from './app-server.js';
import { AiTurnLogAggregator } from './ai-observability.js';
import { EvaluationService } from './evaluation/service.js';
import { InjectionStaticAnalyzer } from './injection/detector.js';
import { LocalScreeningService } from './injection/local-screening.js';
import { InjectionSignalRecorder } from './injection/screening.js';
import { YellowCardService } from './injection/yellow-card-service.js';
import { PipelineJudgementService } from './pipeline/service.js';
import { PipelineJobService } from './pipeline/jobs.js';
import { SqlitePersistence } from './persistence.js';
import { ProposalSubmissionService } from './proposal/submission.js';
import { RoomManager } from './room/manager.js';
import { RuleRegistryService } from './rules/service.js';
import { RuleCatalogService } from './rules/catalog.js';
import { AuthService } from './auth/service.js';
import { createGoogleAuthProvider } from './auth/provider.js';
import { NotificationService } from './notification/service.js';
import { PushSender, WebPushTransport } from './push/sender.js';
import { PushService } from './push/service.js';
import type { RoomSocketGateway } from './room/socket-gateway.js';
import {
  AdminAuthService,
  createGoogleAdminAuthProvider,
  type AdminAuthProvider,
} from './admin/auth.js';
import { AdminConsole } from './admin/console.js';
import { loadTrafficDashboardWithToken } from './operations/dashboard-local.js';

function errorFields(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { error: error.message, stack: error.stack }
    : { error: String(error) };
}

function writeLog(
  level: 'info' | 'error',
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  })}\n`;
  (level === 'error' ? process.stderr : process.stdout).write(line);
}

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
  throw new Error('PORT must be an integer between 0 and 65535');
}

const persistence = new SqlitePersistence(
  resolve(process.env.DATABASE_PATH ?? 'data/daifugo.sqlite'),
);
const signals = new InjectionSignalRecorder(
  new InjectionStaticAnalyzer(),
  persistence.injection,
);
const adminPipelineToken = process.env.ADMIN_PIPELINE_TOKEN;
if (adminPipelineToken !== undefined && adminPipelineToken.length < 32) {
  throw new Error('ADMIN_PIPELINE_TOKEN must be at least 32 characters');
}
const publicOrigin =
  process.env.PUBLIC_ORIGIN ?? `http://localhost:${String(port)}`;
const aiTurnLogs = new AiTurnLogAggregator();
const flushAiTurnLogs = (): void => {
  const summary = aiTurnLogs.flush();
  if (summary) writeLog('info', 'ai_turn_summary', { ...summary });
};
const aiTurnLogTimer = setInterval(flushAiTurnLogs, 60_000);
aiTurnLogTimer.unref();
let authProvider;
try {
  authProvider = await createGoogleAuthProvider({
    ...(process.env.GOOGLE_CLIENT_ID
      ? { clientId: process.env.GOOGLE_CLIENT_ID }
      : {}),
    ...(process.env.GOOGLE_CLIENT_SECRET
      ? { clientSecret: process.env.GOOGLE_CLIENT_SECRET }
      : {}),
  });
} catch (error) {
  writeLog('error', 'google_auth_provider_unavailable', errorFields(error));
}
const adminBasicUsername = process.env.ADMIN_BASIC_USERNAME;
const adminBasicPassword = process.env.ADMIN_BASIC_PASSWORD;
const adminAllowedEmail = process.env.ADMIN_ALLOWED_EMAIL;
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET;
const adminConfiguration = [
  adminBasicUsername,
  adminBasicPassword,
  adminAllowedEmail,
  adminSessionSecret,
];
if (
  adminConfiguration.some((value) => value !== undefined) &&
  adminConfiguration.some((value) => value === undefined)
) {
  throw new Error(
    'ADMIN_BASIC_USERNAME, ADMIN_BASIC_PASSWORD, ADMIN_ALLOWED_EMAIL, and ADMIN_SESSION_SECRET must be configured together',
  );
}
let createAdminConsole:
  ((notifications: NotificationService) => AdminConsole) | undefined;
if (
  adminBasicUsername &&
  adminBasicPassword &&
  adminAllowedEmail &&
  adminSessionSecret
) {
  let adminAuthProvider: AdminAuthProvider | undefined;
  try {
    adminAuthProvider = await createGoogleAdminAuthProvider({
      ...(process.env.GOOGLE_CLIENT_ID
        ? { clientId: process.env.GOOGLE_CLIENT_ID }
        : {}),
      ...(process.env.GOOGLE_CLIENT_SECRET
        ? { clientSecret: process.env.GOOGLE_CLIENT_SECRET }
        : {}),
    });
  } catch (error) {
    writeLog(
      'error',
      'google_admin_auth_provider_unavailable',
      errorFields(error),
    );
  }
  const flyMetricsToken = process.env.FLY_METRICS_TOKEN;
  const flyApp = process.env.FLY_APP_NAME ?? 'daifugo-together';
  const flyOrganization = process.env.FLY_ORG_SLUG ?? 'personal';
  let trafficCache:
    | {
        fetchedAt: number;
        value: Awaited<ReturnType<typeof loadTrafficDashboardWithToken>>;
      }
    | undefined;
  const traffic = flyMetricsToken
    ? async () => {
        const now = Date.now();
        if (trafficCache && now - trafficCache.fetchedAt < 45_000) {
          return trafficCache.value;
        }
        const value = await loadTrafficDashboardWithToken(
          flyApp,
          flyOrganization,
          flyMetricsToken,
          now,
        );
        trafficCache = { fetchedAt: now, value };
        return value;
      }
    : undefined;
  createAdminConsole = (notifications) =>
    new AdminConsole({
      repository: persistence.admin,
      auth: new AdminAuthService({
        ...(adminAuthProvider ? { provider: adminAuthProvider } : {}),
        publicOrigin,
        allowedEmail: adminAllowedEmail,
        sessionSecret: adminSessionSecret,
      }),
      basicUsername: adminBasicUsername,
      basicPassword: adminBasicPassword,
      notifications,
      ...(traffic ? { traffic } : {}),
    });
}
const codeRules = await loadRuleCodeBundles();
let refreshWaitingRules = (): void => undefined;
const notificationGateway: { current?: RoomSocketGateway } = {};
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT;
let pushTransport: WebPushTransport | undefined;
if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
  try {
    pushTransport = new WebPushTransport({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      subject: vapidSubject,
    });
  } catch (error) {
    writeLog('error', 'web_push_transport_unavailable', errorFields(error));
  }
}
const pushSender = new PushSender(persistence.push, {
  ...(pushTransport ? { transport: pushTransport } : {}),
  onError: (error) =>
    writeLog('error', 'web_push_send_failed', errorFields(error)),
});
const push = new PushService(persistence.push, {
  ...(pushTransport && vapidPublicKey ? { publicKey: vapidPublicKey } : {}),
  available: pushTransport !== undefined,
});
const notifications = new NotificationService(persistence.notifications, {
  push: pushSender,
  emit: {
    emitNew: (userId, item) =>
      notificationGateway.current?.emitNotification(userId, item),
    sync: (userId, unreadCount) =>
      notificationGateway.current?.emitNotificationSync(userId, unreadCount),
  },
  onError: (error) =>
    writeLog('error', 'notification_delivery_failed', errorFields(error)),
});
const adminConsole = createAdminConsole?.(notifications);
const rules = new RuleRegistryService(persistence.rules, codeRules, {
  proposals: persistence.proposals,
  pipeline: persistence.pipeline,
  onAutoDisable: (rule, incident) => {
    writeLog('error', 'rule_auto_disabled', {
      ruleId: rule.id,
      incidentId: incident.id,
    });
  },
  onLoadFailure: (rule, incident) => {
    writeLog('error', 'rule_load_failure', {
      ruleId: rule.id,
      incidentId: incident.id,
      detail: incident.detail,
    });
  },
  onReleased: (rule) => {
    writeLog('info', 'rule_released', {
      ruleId: rule.id,
      proposalId: rule.proposalId,
    });
    const proposal = persistence.proposals.findById(rule.proposalId);
    if (proposal) {
      notifications.publishProposal('proposal_released', proposal);
    }
  },
  onAvailabilityChanged: () => refreshWaitingRules(),
});
const registrySync = rules.synchronizeCodeRegistry();
for (const rule of registrySync.registered) {
  writeLog('info', 'rule_pending_enable_registered', { ruleId: rule.id });
}
for (const version of registrySync.versions) {
  writeLog('info', 'rule_version_registered', {
    ruleId: version.ruleId,
    version: version.version,
  });
}
for (const rule of registrySync.reverted) {
  writeLog('info', 'rule_revert_reconciled', { ruleId: rule.id });
}
for (const failure of registrySync.failures) {
  writeLog('error', 'rule_registry_sync_failed', { ...failure });
}
const roomManager = new RoomManager({
  ...persistence.roomManagerOptions(),
  availableRules: (setId) => rules.availableRules(setId),
  reducer: {
    rulePortForSet: (setId) => rules.rulePortForSet(setId),
    resolveRuleMessage: (ruleId, messageKey, params) =>
      rules.resolveMessage(ruleId, messageKey, params),
    releaseRulePort: (setId) => rules.releaseRulePort(setId),
    onRuleIncident: (incident) => {
      rules.disableRuleInSet(incident.setId, incident.ruleId);
      rules.recordIncident(incident);
    },
    onRuleConflict: (conflict) => {
      rules.recordConflict(conflict);
      writeLog('info', 'rule_conflict_resolved', conflict);
    },
  },
});
const app = createAppServer({
  webDistDir: resolve(process.env.WEB_DIST_DIR ?? 'packages/web/dist'),
  ...(adminConsole ? { adminConsole } : {}),
  checkDatabase: () => persistence.checkHealth(),
  auth: new AuthService(persistence.auth, {
    ...(authProvider ? { provider: authProvider } : {}),
    publicOrigin,
  }),
  proposals: new ProposalSubmissionService(persistence.proposals, {
    signals,
  }),
  notifications,
  push,
  evaluations: new EvaluationService(persistence.evaluations),
  ruleCatalog: new RuleCatalogService(persistence.rules, {
    eliminationEnabled: process.env.FEATURE_ELIMINATION !== 'false',
    priorityEnabled: process.env.FEATURE_PRIORITY !== 'false',
    popularityEnabled: process.env.FEATURE_POPULARITY !== 'false',
  }),
  yellowCards: new YellowCardService(
    persistence.injection,
    persistence.proposals,
  ),
  ...(adminPipelineToken
    ? {
        adminScreening: {
          token: adminPipelineToken,
          service: new LocalScreeningService(
            persistence.injection,
            persistence.proposals,
          ),
        },
        adminPipeline: {
          token: adminPipelineToken,
          service: new PipelineJudgementService(
            persistence.pipeline,
            persistence.proposals,
            persistence.injection,
            Date.now,
            notifications,
          ),
          jobs: new PipelineJobService(
            persistence.pipeline,
            persistence.proposals,
            Date.now,
            notifications,
          ),
        },
        adminRules: {
          token: adminPipelineToken,
          service: rules,
        },
      }
    : {}),
  gateway: {
    rooms: roomManager,
    sessions: persistence.sessions,
    rulePortForSet: (setId) => rules.rulePortForSet(setId),
    effectiveRuleChainForSet: (setId, entries) =>
      rules.effectiveRuleChainForSet(setId, entries),
    aiRuleBundles: (entries) => rules.aiRuleBundles(entries),
    notificationUnreadCount: (userId) =>
      persistence.notifications.unreadCount(userId, Date.now()),
    onError: (error) => {
      writeLog('error', 'socket_internal_error', errorFields(error));
    },
    onAiLog: (log) => {
      aiTurnLogs.record(log);
      if (log.fallback !== 'none') {
        writeLog('info', 'ai_fallback', {
          fallback: log.fallback,
          watchdog: log.watchdog,
          wallMs: log.wallMs,
          playouts: log.playouts,
          animationDelayMs: log.animationDelayMs,
          roomId: log.roomId,
          setId: log.setId,
          gameIndex: log.gameIndex,
          turnSeq: log.turnSeq,
          memberId: log.memberId,
          mode: log.mode,
        });
      }
    },
  },
});
notificationGateway.current = app.gateway;
refreshWaitingRules = () => {
  app.gateway.refreshWaitingRules();
};
const actualPort = await app.listen(port);
writeLog('info', 'server_listening', { port: actualPort });

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  writeLog('info', 'server_drain_started');
  try {
    await app.beginDrain();
    await app.close();
    clearInterval(aiTurnLogTimer);
    flushAiTurnLogs();
    persistence.close();
    writeLog('info', 'server_drain_completed');
    process.exitCode = 0;
  } catch (error) {
    writeLog('error', 'server_drain_failed', errorFields(error));
    process.exitCode = 1;
  }
};

process.on('uncaughtExceptionMonitor', (error, origin) => {
  writeLog('error', 'uncaught_exception', {
    origin,
    ...errorFields(error),
  });
});

process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
