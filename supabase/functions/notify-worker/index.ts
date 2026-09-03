import webpush from 'npm:web-push@3.6.7';
import { corsHeaders, errorResponse, HttpError, jsonResponse } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/auth.ts';

const client = getServiceClient();
const maxJobs = 20;

type Job = {
  id: string;
  event_type: string;
  target_profile_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
};

type Subscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function isGone(error: unknown): boolean {
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 0;
  return statusCode === 404 || statusCode === 410;
}

function retryTime(attempts: number): string {
  const delay = Math.min(60 * 60, 2 ** Math.min(attempts, 10) * 10);
  return new Date(Date.now() + delay * 1000).toISOString();
}

async function subscriptionsFor(job: Job): Promise<Subscription[]> {
  let query = client.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('active', true);
  if (job.target_profile_id) query = query.eq('profile_id', job.target_profile_id);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as Subscription[];
}

async function sendJob(job: Job): Promise<void> {
  const subscriptions = await subscriptionsFor(job);
  const failures: string[] = [];
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(job.payload));
      await client.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', subscription.id);
    } catch (error) {
      if (isGone(error)) {
        await client.from('push_subscriptions').update({ active: false }).eq('id', subscription.id);
      } else {
        failures.push(error instanceof Error ? error.message : 'Push delivery failed.');
      }
    }
  }

  const update = failures.length && job.attempts < 5
    ? { status: 'pending', next_attempt_at: retryTime(job.attempts), last_error: failures.join(' | ').slice(0, 2000), locked_at: null, locked_by: null }
    : failures.length
      ? { status: 'failed', last_error: failures.join(' | ').slice(0, 2000), locked_at: null, locked_by: null }
      : { status: 'sent', sent_at: new Date().toISOString(), last_error: null, locked_at: null, locked_by: null };
  const { error } = await client.from('notification_jobs').update(update).eq('id', job.id);
  if (error) throw new Error(error.message);
}

async function runWorker(): Promise<{ processed: number; failed: number }> {
  const { data, error } = await client.rpc('claim_notification_jobs', { p_limit: maxJobs });
  if (error) throw new Error(error.message);
  const jobs = (data || []) as Job[];
  let failed = 0;
  for (const job of jobs) {
    try {
      await sendJob(job);
    } catch (error) {
      failed += 1;
      await client.from('notification_jobs').update({ status: job.attempts < 5 ? 'pending' : 'failed', next_attempt_at: job.attempts < 5 ? retryTime(job.attempts) : null, last_error: error instanceof Error ? error.message : 'Notification job failed.', locked_at: null, locked_by: null }).eq('id', job.id);
    }
  }
  return { processed: jobs.length, failed };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return errorResponse(request, new HttpError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED'));
  try {
    if (request.headers.get('x-cron-secret') !== requiredEnv('NOTIFY_WORKER_SECRET')) throw new HttpError(401, 'Worker authentication failed.', 'UNAUTHORIZED');
    webpush.setVapidDetails(requiredEnv('VAPID_SUBJECT'), requiredEnv('VAPID_PUBLIC_KEY'), requiredEnv('VAPID_PRIVATE_KEY'));
    return jsonResponse(request, await runWorker());
  } catch (error) {
    return errorResponse(request, error);
  }
});
