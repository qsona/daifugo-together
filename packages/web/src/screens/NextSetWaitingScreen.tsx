import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';

import screen from './screen.module.css';

export function NextSetWaitingScreen({ onLeave }: { onLeave: () => void }) {
  return (
    <div className={screen.screen}>
      <AppBar title="次のセットを待っています" />
      <main className={screen.body}>
        <p role="status">
          今のセットは終了しました。次のセットから参加します。
        </p>
        <div className={screen.footer}>
          <Button block onClick={onLeave}>
            ホームにもどる
          </Button>
        </div>
      </main>
    </div>
  );
}
