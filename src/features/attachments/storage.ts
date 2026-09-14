import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import type { Attachment } from '../../../../src/domain/types';

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

/** A stable `attachments/` directory under the document directory (never cache — cache can be evicted). */
export function attachmentsDirectory(): Directory {
  const dir = new Directory(Paths.document, 'attachments');
  try {
    if (!dir.exists) dir.create({ intermediates: true });
  } catch {
    throw new Error('Could not prepare storage for attachments.');
  }
  return dir;
}

/** Opens the document picker, enforces the size cap, and copies the file into the attachments directory. Returns null if cancelled. */
export async function pickAttachment(): Promise<Attachment | null> {
  let result: DocumentPicker.DocumentPickerResult;
  try {
    result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  } catch {
    throw new Error('Could not open the file picker.');
  }
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const name = asset.name.trim().slice(0, 200) || 'file';
  if ((asset.size ?? 0) > MAX_ATTACHMENT_SIZE) throw new Error(`"${name}" is larger than 10 MB. Choose a smaller file.`);

  const dir = attachmentsDirectory();
  // The picked name is untrusted: keep only a plain alphanumeric extension so the
  // generated localName can never carry a separator out of the attachments directory.
  const dot = asset.name.lastIndexOf('.');
  const raw = dot > 0 ? asset.name.slice(dot + 1) : '';
  const extension = /^[A-Za-z0-9]{1,12}$/.test(raw) ? `.${raw}` : '';
  const localName = `${randomUUID()}${extension}`;
  const dest = new File(dir, localName);
  try {
    const source = new File(asset.uri);
    await source.copy(dest);
  } catch {
    throw new Error(`Could not save "${name}".`);
  }

  const size = dest.exists ? dest.size : (asset.size ?? 0);
  if (size > MAX_ATTACHMENT_SIZE) {
    try { if (dest.exists) dest.delete(); } catch { /* orphaned bytes are recoverable */ }
    throw new Error(`"${name}" is larger than 10 MB. Choose a smaller file.`);
  }

  return {
    id: randomUUID(),
    name,
    mimeType: asset.mimeType ?? 'application/octet-stream',
    size,
    addedAt: new Date().toISOString(),
    localName,
    remoteKey: null,
  };
}

/** Removes an attachment's file, tolerating one that is already missing. */
export function deleteAttachmentFile(localName: string): void {
  try {
    const file = new File(attachmentsDirectory(), localName);
    if (file.exists) file.delete();
  } catch {
    throw new Error('Could not delete the attachment file.');
  }
}

/** The file URI for display/opening. */
export function attachmentUri(localName: string): string {
  try {
    return new File(attachmentsDirectory(), localName).uri;
  } catch {
    throw new Error('Could not locate the attachment file.');
  }
}

/** Opens/shares an attachment using expo-sharing. */
export async function openAttachment(attachment: Attachment): Promise<void> {
  if (!attachment.localName) throw new Error(`"${attachment.name}" is not available on this device.`);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
  const file = new File(attachmentsDirectory(), attachment.localName);
  if (!file.exists) throw new Error(`"${attachment.name}" is missing from this device.`);
  try {
    await Sharing.shareAsync(file.uri, { mimeType: attachment.mimeType });
  } catch {
    throw new Error(`Could not open "${attachment.name}".`);
  }
}
