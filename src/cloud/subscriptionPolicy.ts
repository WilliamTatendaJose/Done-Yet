export const PRO_ENTITLEMENT = 'pro';

export interface ProAccess {
  isPro: boolean;
  resolving: boolean;
}

export interface CustomerInfoLike {
  entitlements: { active: Record<string, unknown> };
}

export interface PackageLike {
  identifier: string;
}

export function hasProEntitlement(info: CustomerInfoLike): boolean {
  return Boolean(info.entitlements.active[PRO_ENTITLEMENT]);
}

export function selectPackage<T extends PackageLike>(packages: T[], id?: string): T | undefined {
  if (id) return packages.find(item => item.identifier === id);
  return packages.find(item => /annual|year/i.test(item.identifier))
    ?? packages.find(item => /monthly|month/i.test(item.identifier))
    ?? packages[0];
}

export type ProFeature = 'cloud sync' | 'cloud attachments' | 'AI assistance';

export function proAccessReason(access: ProAccess, feature: ProFeature): string {
  if (access.resolving) return 'Checking your Pro access…';
  return access.isPro ? '' : `Done Yet? Pro is required for ${feature}.`;
}

/**
 * Enables the local development convenience only in React Native's development runtime.
 * An environment variable can turn it off, but can never turn it on in a production bundle.
 */
export function developerProOverride(isDevelopmentRuntime: boolean, configuredValue?: string): boolean {
  return isDevelopmentRuntime && configuredValue?.trim().toLowerCase() !== 'false';
}
