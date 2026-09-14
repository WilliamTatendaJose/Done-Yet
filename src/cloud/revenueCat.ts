import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import Purchases, { type CustomerInfo, type CustomerInfoUpdateListener, type PurchasesPackage } from 'react-native-purchases';
import { developerProOverride, hasProEntitlement, PRO_ENTITLEMENT, selectPackage } from './subscriptionPolicy';

export { hasProEntitlement, PRO_ENTITLEMENT, selectPackage } from './subscriptionPolicy';
export interface RevenueCatState { configured: boolean; loading: boolean; resolving: boolean; isPro: boolean; developerOverride: boolean; error: string | null; packages: PurchasesPackage[] }
export interface RevenueCatClient { state: RevenueCatState; purchase(packageId?: string): Promise<boolean>; restore(): Promise<boolean>; manageSubscriptions(): Promise<void> }
const initial: RevenueCatState = { configured: false, loading: false, resolving: true, isPro: false, developerOverride: false, error: null, packages: [] };
const keyForPlatform = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
const useDeveloperOverride = developerProOverride(__DEV__, process.env.EXPO_PUBLIC_DEV_PRO_OVERRIDE);
export function useRevenueCat(userId?: string): RevenueCatClient {
  const [state, setState] = useState(initial);

  useEffect(() => {
    let mounted = true;
    let listener: CustomerInfoUpdateListener | null = null;
    if (useDeveloperOverride) {
      setState({ ...initial, resolving: false, isPro: true, developerOverride: true });
      return () => { mounted = false; };
    }
    setState({ ...initial, resolving: Boolean(userId) });

    const start = async () => {
      if (!userId) {
        try {
          if (await Purchases.isConfigured()) await Purchases.logOut();
        } catch { /* The signed-out app remains safely non-Pro even if SDK cleanup fails. */ }
        return;
      }
      if (!keyForPlatform?.trim()) {
        if (mounted) setState({ ...initial, resolving: false, error: 'Subscriptions are not configured for this platform.' });
        return;
      }
      try {
        if (!(await Purchases.isConfigured())) Purchases.configure({ apiKey: keyForPlatform.trim(), appUserID: userId });
        else await Purchases.logIn(userId);
        listener = (next: CustomerInfo) => {
          if (mounted) setState(current => ({ ...current, isPro: hasProEntitlement(next), resolving: false }));
        };
        Purchases.addCustomerInfoUpdateListener(listener);
        const [info, offerings] = await Promise.all([Purchases.getCustomerInfo(), Purchases.getOfferings()]);
        if (mounted) setState({ configured: true, loading: false, resolving: false, isPro: hasProEntitlement(info), developerOverride: false, error: null, packages: offerings.current?.availablePackages ?? [] });
      } catch {
        if (mounted) setState({ ...initial, resolving: false, error: 'Subscriptions are temporarily unavailable.' });
      }
    };

    void start();
    return () => {
      mounted = false;
      if (listener) Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, [userId]);

  const purchase = useCallback(async (packageId?: string) => {
    const target = selectPackage(state.packages, packageId);
    if (!target) { setState(current => ({ ...current, error: 'No Pro plan is available right now.' })); return false; }
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const result = await Purchases.purchasePackage(target);
      const ok = hasProEntitlement(result.customerInfo);
      setState(current => ({ ...current, loading: false, isPro: ok }));
      return ok;
    } catch (error) {
      const cancelled = typeof error === 'object' && error !== null && 'userCancelled' in error && Boolean(error.userCancelled);
      setState(current => ({ ...current, loading: false, error: cancelled ? null : 'Purchase could not be completed.' }));
      return false;
    }
  }, [state.packages]);
  const restore = useCallback(async () => { setState(s => ({ ...s, loading: true, error: null })); try { const info = await Purchases.restorePurchases(); const ok = hasProEntitlement(info); setState(s => ({ ...s, loading: false, isPro: ok })); return ok; } catch { setState(s => ({ ...s, loading: false, error: 'Purchases could not be restored.' })); return false; } }, []);
  const manageSubscriptions = useCallback(async () => {
    try { await Purchases.showManageSubscriptions(); }
    catch { await Linking.openURL(Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions'); }
  }, []);
  return { state, purchase, restore, manageSubscriptions };
}

