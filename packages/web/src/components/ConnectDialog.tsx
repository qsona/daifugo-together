import { useEffect, useState } from 'react';

import { Button } from './Button';
import { Dialog, DialogBody } from './Dialog';
import { isDefaultDisplayName } from './AccountRow';
import { NameField, validateDisplayName } from './NameField';
import {
  CONFIRM_BACK_LABEL,
  LOGIN_RESTORE_HINT,
  RETRY_REQUEST,
} from '../messages';

import styles from './ConnectDialog.module.css';

export function ConnectDialog({
  displayName,
  connectionReady,
  pending,
  rename,
  onProceed,
  onBack,
}: {
  displayName: string | null;
  connectionReady: boolean;
  pending: boolean;
  rename: (displayName: string) => Promise<void>;
  onProceed: () => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(displayName ?? '');
  const [shownName, setShownName] = useState(displayName ?? '—');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  useEffect(() => {
    if (displayName === null) return;
    setShownName(displayName);
    setValue(displayName);
  }, [displayName]);

  const validation = validateDisplayName(value);
  const save = () => {
    if (!validation.ok || saving || !connectionReady) return;
    setSaving(true);
    setSaveError(undefined);
    void rename(validation.displayName).then(
      () => {
        setShownName(validation.displayName);
        setSaving(false);
        setEditing(false);
      },
      () => {
        setSaving(false);
        setSaveError(`保存できませんでした。${RETRY_REQUEST}`);
      },
    );
  };

  return (
    <Dialog
      title="Googleでログインしますか?"
      actions={
        <>
          <Button
            variant="primary"
            disabled={editing || pending || !connectionReady}
            aria-busy={pending}
            onClick={onProceed}
          >
            {pending ? 'Googleへ進んでいます' : 'Googleへ進む'}
          </Button>
          {!editing && (
            <Button disabled={pending} onClick={onBack}>
              {CONFIRM_BACK_LABEL}
            </Button>
          )}
        </>
      }
    >
      {/* この画面に来る人は、はじめての人と前にあそんだ人が混ざっている。
          クライアントには見分けがつかないので、両方に同時に効く文にする。 */}
      <DialogBody>
        {LOGIN_RESTORE_HINT}
        はじめての人は、ほかの端末でも同じなまえ・同じ提案であそべるようになります。
      </DialogBody>
      <DialogBody>
        Googleの画面に移りますが、受け取るのはIDだけで、終わったらここにもどります。
      </DialogBody>
      {/* 前にあそんだ人がログインすると、なまえはそのアカウントのものになる。
          ここで入れたなまえが効くのは、はじめての人だけ。 */}
      <section className={styles.nameBox} aria-label="はじめての人のなまえ">
        <span className={styles.nameLabel}>はじめての人のなまえ</span>
        {editing ? (
          <>
            <NameField
              label="なまえ"
              value={value}
              disabled={saving}
              onChange={(next) => {
                setValue(next);
                setSaveError(undefined);
              }}
              {...(saveError ? { error: saveError } : {})}
            />
            <div className={styles.editActions}>
              <Button
                size="small"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setValue(shownName === '—' ? '' : shownName);
                  setSaveError(undefined);
                }}
              >
                やめる
              </Button>
              <Button
                size="small"
                disabled={!validation.ok || saving || !connectionReady}
                aria-busy={saving}
                onClick={save}
              >
                {saving ? '保存中…' : 'これにする'}
              </Button>
            </div>
          </>
        ) : (
          <div className={styles.nameRow}>
            <strong
              className={
                isDefaultDisplayName(shownName) ? styles.defaultName : undefined
              }
            >
              {shownName}
            </strong>
            <Button
              size="small"
              disabled={pending}
              onClick={() => setEditing(true)}
            >
              変える
            </Button>
          </div>
        )}
      </section>
      {!connectionReady && (
        <p className={styles.connection} role="status">
          サーバーとつながるまで待ってください
        </p>
      )}
    </Dialog>
  );
}
