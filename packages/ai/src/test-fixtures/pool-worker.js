import { parentPort } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('Pool fixture must run inside worker_threads');
}

function response(payload) {
  const play = payload.legalPlays[0];
  return {
    play,
    completed: true,
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
  };
}

parentPort.postMessage({ kind: 'ready' });
parentPort.on('message', (message) => {
  if (message.payload.seed === 'exit-0') {
    process.exit(0);
  }
  const delay = message.payload.seed.startsWith('delay:')
    ? Number(message.payload.seed.slice('delay:'.length))
    : 0;
  setTimeout(() => {
    parentPort.postMessage({
      kind: 'result',
      id: message.id,
      value: response(message.payload),
    });
  }, delay);
});
