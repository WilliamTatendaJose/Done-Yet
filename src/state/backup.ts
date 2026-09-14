import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { AppState } from '../../../src/domain/types';
import { decodeState } from '../../../src/state/storage';

export async function exportBackup(state: AppState) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
  const file = new File(Paths.cache, 'done-yet-backup.json');
  file.write(JSON.stringify(state, null, 2));
  try { await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your Done Yet? backup', UTI: 'public.json' }); }
  finally { if (file.exists) file.delete(); }
}
export async function pickBackup(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  if ((asset.size ?? file.size) > 2_000_000) throw new Error('This backup is too large. Choose a Done Yet? JSON backup under 2 MB.');
  try { const raw = await file.text(); decodeState(raw); return raw; }
  finally { if (file.exists) file.delete(); }
}
