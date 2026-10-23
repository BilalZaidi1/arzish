import { getCap } from '../state/claude';

interface DownloadsNs {
  save(r: { filename: string; data: string | Blob }): Promise<{ status: string }>;
}

export type SaveResult = 'saved' | 'declined' | 'copied' | 'failed';

/** Offer a file through the viewer's download capability; fall back to the clipboard for text. */
export async function saveFileStatus(filename: string, data: string | Blob): Promise<SaveResult> {
  const dl = await getCap<DownloadsNs>('downloads');
  if (dl) {
    try {
      await dl.save({ filename, data });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'declined') return 'declined';
    }
  }
  if (typeof data === 'string') {
    try {
      await navigator.clipboard.writeText(data);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}

export async function saveFile(filename: string, data: string | Blob): Promise<boolean> {
  const r = await saveFileStatus(filename, data);
  return r === 'saved' || r === 'declined';
}

export function saveMessage(r: SaveResult, what: string): string {
  switch (r) {
    case 'saved':
      return `${what} ready to save`;
    case 'declined':
      return 'Save cancelled';
    case 'copied':
      return `Downloads are not available here, so the ${what.toLowerCase()} was copied to your clipboard`;
    default:
      return `Could not save the ${what.toLowerCase()} here`;
  }
}
