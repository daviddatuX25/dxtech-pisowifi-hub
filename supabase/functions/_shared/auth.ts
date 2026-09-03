import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './cors.ts';

export interface ProfileContext {
  id: string;
  deviceId: string;
  name: string;
  branchId: string;
  branchName: string;
}

let cachedClient: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('Supabase service configuration is missing.');
  cachedClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return cachedClient;
}

export async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function requireProfile(request: Request, client: SupabaseClient): Promise<ProfileContext> {
  const token = request.headers.get('x-profile-token')?.trim();
  if (!token || token.length < 32 || token.length > 256) {
    throw new HttpError(401, 'Complete onboarding before continuing.', 'PROFILE_SESSION_REQUIRED');
  }
  const tokenHash = await hashText(token);
  const { data: session, error: sessionError } = await client
    .from('profile_sessions')
    .select('id, profile_id, expires_at')
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (sessionError || !session) {
    throw new HttpError(401, 'Your profile session is no longer valid.', 'PROFILE_SESSION_INVALID');
  }

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id, device_id, name, branch_id, branches(name)')
    .eq('id', session.profile_id)
    .maybeSingle();
  if (profileError || !profile) throw new HttpError(401, 'Your profile could not be found.', 'PROFILE_NOT_FOUND');
  await client.from('profile_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id);

  const branch = Array.isArray(profile.branches) ? profile.branches[0] : profile.branches;
  return {
    id: profile.id,
    deviceId: profile.device_id,
    name: profile.name,
    branchId: profile.branch_id,
    branchName: branch?.name || 'Unknown branch',
  };
}

export async function requireAdmin(request: Request, client: SupabaseClient): Promise<string> {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Admin sign-in is required.', 'ADMIN_AUTH_REQUIRED');
  const accessToken = authorization.slice('Bearer '.length).trim();
  const { data: userData, error: userError } = await client.auth.getUser(accessToken);
  if (userError || !userData.user) throw new HttpError(401, 'Admin session is invalid.', 'ADMIN_AUTH_INVALID');
  const { data: admin, error: adminError } = await client
    .from('admins')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (adminError || !admin) throw new HttpError(403, 'This account is not an administrator.', 'ADMIN_FORBIDDEN');
  return userData.user.id;
}

export function getClientIdentity(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('cf-connecting-ip') || forwarded || 'unknown';
}

export async function enforceRateLimit(
  request: Request,
  client: SupabaseClient,
  action: string,
  limit: number,
  windowSeconds = 60,
  profileId = '',
): Promise<void> {
  const salt = Deno.env.get('RATE_LIMIT_SALT') || 'announcement-room-rate-limit';
  const keyHash = await hashText(`${salt}:${action}:${getClientIdentity(request)}:${profileId}`);
  const { data, error } = await client.rpc('consume_rate_limit', {
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  if (!data) throw new HttpError(429, 'Please wait a moment and try again.', 'RATE_LIMITED');
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
