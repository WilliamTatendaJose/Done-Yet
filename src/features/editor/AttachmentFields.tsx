import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Attachment } from '../../../../src/domain/types';
import { deleteAttachmentFile, openAttachment, pickAttachment } from '../attachments/storage';
import { Button, Field, IconButton } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

interface Props {
  value: Attachment[];
  /** Ids present when the form opened. Removing one of these never deletes its file here — Cancel must mean nothing changed. */
  originalIds: Set<string>;
  onChange: (attachments: Attachment[]) => void;
  /** Fetches a remote-only attachment onto this device. Absent when cloud sync is not configured or the user is signed out. */
  downloadAttachment?: (attachment: Attachment) => Promise<{ ok: true; localName: string } | { ok: false; message: string }>;
}

const MAX_ATTACHMENTS = 10;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentFields({ value, originalIds, onChange, downloadAttachment }: Props) {
  const [busy, setBusy] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const atCap = value.length >= MAX_ATTACHMENTS;

  async function add() {
    setError('');
    setBusy(true);
    try {
      const attachment = await pickAttachment();
      if (!attachment) return;
      if (value.length >= MAX_ATTACHMENTS) {
        if (attachment.localName) { try { deleteAttachmentFile(attachment.localName); } catch { /* orphaned bytes are recoverable */ } }
        setError(`Limit of ${MAX_ATTACHMENTS} attachments reached.`);
        return;
      }
      onChange([...value, attachment]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that file.');
    } finally {
      setBusy(false);
    }
  }

  function remove(attachment: Attachment) {
    // This attachment was added during this editing session, so it isn't referenced by anything saved yet:
    // safe to delete its file immediately, whether the form is later saved or cancelled.
    if (!originalIds.has(attachment.id) && attachment.localName) {
      try { deleteAttachmentFile(attachment.localName); } catch { /* orphaned bytes are recoverable */ }
    }
    onChange(value.filter(a => a.id !== attachment.id));
  }

  async function open(attachment: Attachment) {
    setError('');
    setOpeningId(attachment.id);
    try {
      await openAttachment(attachment);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that file.');
    } finally {
      setOpeningId(null);
    }
  }

  async function download(attachment: Attachment) {
    if (!downloadAttachment) return;
    setError('');
    setDownloadingId(attachment.id);
    try {
      const result = await downloadAttachment(attachment);
      if (!result.ok) { setError(result.message); return; }
      onChange(value.map(a => a.id === attachment.id ? { ...a, localName: result.localName } : a));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download that file.');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <Field label="Attachments">
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {value.map(attachment => (
        <View key={attachment.id} style={styles.row}>
          <Pressable
            style={styles.info}
            accessibilityRole="button"
            accessibilityLabel={`Open attachment ${attachment.name}`}
            disabled={openingId === attachment.id}
            onPress={() => open(attachment)}
          >
            <Ionicons name="document-attach-outline" size={20} color={colors.textMuted} />
            <View style={styles.textCol}>
              <Text style={styles.name} numberOfLines={1}>{attachment.name}</Text>
              <Text style={styles.caption}>{formatSize(attachment.size)}</Text>
            </View>
            {openingId === attachment.id ? <ActivityIndicator color={colors.accent} /> : null}
          </Pressable>
          {!attachment.localName && attachment.remoteKey && downloadAttachment ? (
            downloadingId === attachment.id
              ? <ActivityIndicator color={colors.accent} />
              : <IconButton name="cloud-download-outline" label={`Download ${attachment.name} from the cloud`} onPress={() => download(attachment)} />
          ) : null}
          <IconButton name="close" label={`Remove attachment ${attachment.name}`} onPress={() => remove(attachment)} />
        </View>
      ))}
      {!atCap ? (
        <View style={styles.row}>
          {busy ? <ActivityIndicator color={colors.accent} /> : null}
          <Button quiet label={busy ? 'Adding file…' : 'Add a file'} icon="attach-outline" onPress={add} disabled={busy} />
        </View>
      ) : <Text style={styles.caption}>Limit of {MAX_ATTACHMENTS} attachments reached</Text>}
    </Field>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  info: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 14, minHeight: 46 },
  textCol: { flex: 1 },
  name: { color: colors.text, fontSize: 14 },
  caption: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.errorText, fontSize: 12 },
});
