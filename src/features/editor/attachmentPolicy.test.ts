import { describe, expect, it } from 'vitest';
import { canAddAttachment, FREE_ATTACHMENT_LIMIT } from './attachmentPolicy';

describe('attachment tier policy', () => {
  it('caps free tasks at three attachments', () => {
    expect(FREE_ATTACHMENT_LIMIT).toBe(3);
    expect(canAddAttachment(2, false)).toBe(true);
    expect(canAddAttachment(3, false)).toBe(false);
  });

  it('does not impose an attachment-count cap on Pro', () => {
    expect(canAddAttachment(3, true)).toBe(true);
    expect(canAddAttachment(10_000, true)).toBe(true);
  });

  it('does not force removal when an expired user already exceeds the free cap', () => {
    expect(canAddAttachment(7, false)).toBe(false);
  });
});
