import { useEffect, useState } from 'react';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { NameField, validateDisplayName } from '../components/NameField';
import { RETRY_REQUEST } from '../messages';

import styles from './NameScreen.module.css';
import screen from './screen.module.css';

export function NameScreen({
  displayName,
  connection,
  rename,
  onBack,
}: {
  displayName: string | null;
  connection: 'connecting' | 'ready' | 'superseded';
  rename: (displayName: string) => Promise<void>;
  onBack: () => void;
}) {
  const [value, setValue] = useState(displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  useEffect(() => {
    if (!saving && displayName !== null) setValue(displayName);
  }, [displayName, saving]);

  const validation = validateDisplayName(value);
  const connected = connection === 'ready';
  const save = () => {
    if (!validation.ok || saving || !connected) return;
    setSaving(true);
    setSaveError(undefined);
    void rename(validation.displayName).then(
      () => onBack(),
      () => {
        setSaving(false);
        setSaveError(`保存できませんでした。${RETRY_REQUEST}`);
      },
    );
  };

  return (
    <div className={screen.screen}>
      <AppBar title="なまえ" onBack={onBack} />
      <main className={screen.body}>
        <NameField
          value={value}
          onChange={(next) => {
            setValue(next);
            setSaveError(undefined);
          }}
          disabled={saving}
          {...(saveError ? { error: saveError } : {})}
        />
        <Button
          variant="primary"
          block
          disabled={!validation.ok || saving || !connected}
          aria-busy={saving}
          onClick={save}
        >
          {saving ? '保存中…' : 'これにする'}
        </Button>
        {!connected && (
          <p className={styles.connection} role="status">
            サーバーとつながるまで待ってください
          </p>
        )}
      </main>
    </div>
  );
}
