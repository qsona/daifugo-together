import { MenuScreen } from './screens/MenuScreen';
import { TitleScreen } from './screens/TitleScreen';
import { useScreenStore } from './store/screen';

export function App() {
  const current = useScreenStore((state) => state.current);
  const go = useScreenStore((state) => state.go);

  switch (current) {
    case 'title':
      return (
        <TitleScreen
          onStart={() => {
            go('menu');
          }}
        />
      );
    case 'menu':
      return <MenuScreen />;
  }
}
