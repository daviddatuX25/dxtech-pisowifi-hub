import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const configuredHelpImageUrl = String(import.meta.env.VITE_DEVICE_ID_HELP_IMAGE_URL ?? '').trim();
const portalPattern = String(import.meta.env.VITE_PORTAL_VOUCHER_URL_PATTERN ?? '').trim();

export const appConfig = {
  supabaseUrl,
  functionsUrl: supabaseUrl ? `${supabaseUrl}/functions/v1/api` : '',
  vapidPublicKey: String(import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim(),
  helpImageUrl: configuredHelpImageUrl || '/device-id-help.jpg',
  appName: String(import.meta.env.VITE_APP_NAME ?? 'DXTECH PisoWiFi Hub').trim() || 'DXTECH PisoWiFi Hub',
  portalVoucherUrlPattern: portalPattern,
};

export function buildPortalVoucherUrl(code: string): { url: string; isDirectLink: boolean } {
  if (appConfig.portalVoucherUrlPattern && appConfig.portalVoucherUrlPattern.includes('{CODE}')) {
    return {
      url: appConfig.portalVoucherUrlPattern.replace('{CODE}', encodeURIComponent(code)),
      isDirectLink: true,
    };
  }
  return {
    url: 'http://10.0.0.1/',
    isDirectLink: false,
  };
}

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export const hasBackendConfig = Boolean(appConfig.functionsUrl && supabaseAnonKey);
export const hasAdminAuthConfig = Boolean(supabase);
export const profileTokenKey = 'announcement-room.profile-session';

export function getProfileToken(): string | null {
  return window.localStorage.getItem(profileTokenKey);
}

export function saveProfileToken(token: string): void {
  window.localStorage.setItem(profileTokenKey, token);
}

export function clearProfileToken(): void {
  window.localStorage.removeItem(profileTokenKey);
}
