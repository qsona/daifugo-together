import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const target = process.argv[2];
if (!target) {
  process.stderr.write(
    'Usage: node scripts/verify-production-set.mjs https://app.example\n',
  );
  process.exitCode = 2;
} else {
  const requireFromWeb = createRequire(resolve('packages/web/package.json'));
  const { io } = requireFromWeb('socket.io-client');
  const socket = io(target, {
    transports: ['websocket'],
    reconnection: false,
  });
  let started = false;
  let completed = false;
  let actingTurnSeq = -1;

  const finish = (error) => {
    if (completed) return;
    completed = true;
    clearTimeout(timeout);
    socket.disconnect();
    if (error) {
      process.stderr.write(`${error.stack ?? String(error)}\n`);
      process.exitCode = 1;
    }
  };

  const emitAck = (event, payload) =>
    new Promise((resolveAck, rejectAck) => {
      socket.timeout(8_000).emit(event, payload, (timeoutError, result) => {
        if (timeoutError) {
          rejectAck(timeoutError);
        } else if (!result?.ok) {
          rejectAck(
            new Error(
              `${event} failed: ${result?.code ?? 'invalid response'}${
                result?.message ? ` (${result.message})` : ''
              }`,
            ),
          );
        } else {
          resolveAck(result.value);
        }
      });
    });

  const handleRoom = async (room) => {
    if (completed || !room) return;
    if (room.phase === 'waiting' && !started) {
      started = true;
      await emitAck('room:start', {});
      return;
    }
    if (room.phase === 'setResult') {
      process.stdout.write(
        `${JSON.stringify({
          status: 'completed',
          roomId: room.roomId,
          standings: room.setResult?.standings ?? [],
        })}\n`,
      );
      finish();
      return;
    }
    const game = room.game;
    if (
      room.phase !== 'playing' ||
      game?.status !== 'playing' ||
      !game.turn ||
      game.turn.seat !== room.you.seatId ||
      game.turn.turnSeq <= actingTurnSeq
    ) {
      return;
    }
    actingTurnSeq = game.turn.turnSeq;
    const play = game.legalMoves?.[0];
    if (play) {
      await emitAck('game:play', {
        turnSeq: game.turn.turnSeq,
        cards: play.cards.map((card) => card.id),
      });
    } else {
      await emitAck('game:pass', { turnSeq: game.turn.turnSeq });
    }
  };

  socket.on('session:ready', (session) => {
    Promise.resolve(
      session.room ? handleRoom(session.room) : emitAck('room:create', {}),
    ).catch(finish);
  });
  socket.on('room:state', (room) => {
    void handleRoom(room).catch(finish);
  });
  socket.on('connect_error', finish);
  socket.on('room:closed', ({ reason }) => {
    finish(new Error(`room closed before set completion: ${reason}`));
  });

  const timeout = setTimeout(() => {
    finish(new Error('production set verification timed out after 10 minutes'));
  }, 10 * 60_000);
}
