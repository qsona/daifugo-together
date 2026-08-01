export const NOTIFICATION_TYPES = [
  'proposal_released',
  'proposal_rejected',
  'proposal_failed',
  'proposal_implementing',
  'rule_debut',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationPriority = 'highest' | 'high' | 'medium' | 'low';
export type NotificationOpenedVia = 'center' | 'push';

export interface NotificationView {
  id: number;
  type: NotificationType;
  payload: Record<string, unknown>;
  title: string;
  body: string;
  url: string;
  priority: NotificationPriority;
  createdAt: number;
  readAt: number | null;
  openedAt: number | null;
  openedVia: NotificationOpenedVia | null;
}

export interface NotificationListResponse {
  items: NotificationView[];
  unreadCount: number;
}

export interface NotificationPresentation {
  title: string;
  body: string;
  url: string;
}

function payloadText(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string,
): string {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}

/**
 * 通知センターと Web Push が共有する唯一の表示文マッピング。
 * Push はこの結果を複製し、独自の情報や文面を足さない。
 */
export function notificationPresentation(
  type: NotificationType,
  payload: Readonly<Record<string, unknown>>,
): NotificationPresentation {
  const proposalName = payloadText(payload, 'proposalName', 'あなたの提案');
  switch (type) {
    case 'proposal_released':
      return {
        title: '提案がルールになったよ！',
        body: `「${proposalName}」が、みんなの対局で遊べるようになりました。`,
        url: '/proposals/mine',
      };
    case 'proposal_rejected':
      return {
        title: '提案の確認がおわりました',
        body: `「${proposalName}」の結果を確認できます。`,
        url: '/proposals/mine',
      };
    case 'proposal_failed':
      return {
        title: 'ルールの実装結果が出ました',
        body: `「${proposalName}」の結果を確認できます。`,
        url: '/proposals/mine',
      };
    case 'proposal_implementing':
      return {
        title: 'ルールを作りはじめました',
        body: `「${proposalName}」が実装に進みました。`,
        url: '/proposals/mine',
      };
    case 'rule_debut':
      return {
        title: '新しいルールが登場！',
        body: `「${payloadText(payload, 'ruleName', '新しいルール')}」が遊べるようになりました。`,
        url: '/rules',
      };
  }
}
