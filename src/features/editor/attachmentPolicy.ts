export const FREE_ATTACHMENT_LIMIT = 3;

export function canAddAttachment(count: number, isPro: boolean): boolean {
  return isPro || count < FREE_ATTACHMENT_LIMIT;
}
