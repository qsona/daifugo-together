import {
  outstandingChoiceRequests,
  type PrivateGameState,
} from '@daifugo/core';

import type { RoomMember } from './types.js';

export function nextRoomChoiceRequest(
  pending: PrivateGameState['pendingChoice'],
  members: readonly RoomMember[],
) {
  const requests = outstandingChoiceRequests(pending);
  return (
    requests.find((request) => {
      const member = members.find(
        (candidate) => candidate.memberId === request.player,
      );
      return !member || member.isAI || member.departed;
    }) ?? requests[0]
  );
}
