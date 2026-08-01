import type { NotificationPriority, NotificationType } from '@daifugo/core';

export interface NotificationTypeDefinition {
  type: NotificationType;
  priority: NotificationPriority;
  audience: 'user' | 'broadcast';
  channel: 'center' | 'center_push';
}

export const NOTIFICATION_TYPE_REGISTRY: Readonly<
  Record<NotificationType, NotificationTypeDefinition>
> = {
  proposal_released: {
    type: 'proposal_released',
    priority: 'highest',
    audience: 'user',
    channel: 'center_push',
  },
  proposal_rejected: {
    type: 'proposal_rejected',
    priority: 'high',
    audience: 'user',
    channel: 'center_push',
  },
  proposal_failed: {
    type: 'proposal_failed',
    priority: 'high',
    audience: 'user',
    channel: 'center_push',
  },
  proposal_implementing: {
    type: 'proposal_implementing',
    priority: 'medium',
    audience: 'user',
    channel: 'center',
  },
  rule_debut: {
    type: 'rule_debut',
    priority: 'low',
    audience: 'broadcast',
    channel: 'center',
  },
};

// Reserved extension codes owned by later Epics:
// E18: friend_invite, friend_request, friend_accepted
// E19: stats_milestone

export const PUSH_NOTIFICATION_TYPES = Object.values(NOTIFICATION_TYPE_REGISTRY)
  .filter(({ channel }) => channel === 'center_push')
  .map(({ type }) => type);
