import { parentPort } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('Partial-search fixture must run inside worker_threads');
}

parentPort.postMessage({ kind: 'ready' });
parentPort.on('message', (message) => {
  const play = message.payload.legalPlays[0];
  parentPort.postMessage({
    kind: 'progress',
    id: message.id,
    value: {
      play,
      completed: false,
      stats: {
        playouts: 1,
        candidates: [
          {
            cardIds: play.cards.map((card) => card.id),
            visits: 1,
            meanReward: 0,
          },
        ],
        workerThread: true,
      },
    },
  });
});
