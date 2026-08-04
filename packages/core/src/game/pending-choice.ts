import type { PendingChoiceRequest, PrivateGameState } from './types.js';

type PendingChoice = NonNullable<PrivateGameState['pendingChoice']>;

function submitted(
  pending: PendingChoice,
  request: PendingChoiceRequest,
): boolean {
  return (pending.submittedChoices ?? []).some(
    (response) =>
      response.player === request.player &&
      response.choiceId === request.choiceId,
  );
}

export function outstandingChoiceRequests(
  pending: PendingChoice | undefined,
): PendingChoiceRequest[] {
  if (!pending) return [];
  return pending.simultaneousChoices
    ? pending.simultaneousChoices.filter(
        (request) => !submitted(pending, request),
      )
    : [pending];
}

export function pendingChoiceRequestForPlayer(
  pending: PendingChoice | undefined,
  player: string,
): PendingChoiceRequest | undefined {
  return outstandingChoiceRequests(pending).find(
    (request) => request.player === player,
  );
}
