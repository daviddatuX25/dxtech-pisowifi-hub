import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  BrevoAdapter,
  ConsoleLogAdapter,
  GmailApiAdapter,
  ResendAdapter,
  renderAdminNewPromoRequestEmail,
  renderUserIssueReviewedEmail,
  renderUserNewPromoPublishedEmail,
  renderUserPromoReviewedEmail,
} from '../supabase/functions/_shared/email';

describe('Email Templates', () => {
  it('renders admin new promo request email with complete operational details', () => {
    const payload = renderAdminNewPromoRequestEmail({
      promoName: 'Double Speed PisoWiFi',
      branchName: 'Candon Branch',
      userName: 'Maria Santos',
      deviceId: 'DEVICE99',
      requestId: 'req-uuid-1234',
    });

    expect(payload.subject).toContain('Double Speed PisoWiFi');
    expect(payload.subject).toContain('Candon Branch');
    expect(payload.html).toContain('Maria Santos');
    expect(payload.html).toContain('DEVICE99');
    expect(payload.html).toContain('Double Speed PisoWiFi');
    expect(payload.html).toContain('req-uuid-1234');
    expect(payload.text).toContain('DEVICE99');
  });

  it('renders user promo reviewed email for approval and rejection', () => {
    const approved = renderUserPromoReviewedEmail({
      userName: 'Juan',
      promoName: 'Night Owl Special',
      status: 'approved',
      branchName: 'Pudoc Branch',
    });
    expect(approved.subject).toContain('Approved');
    expect(approved.html).toContain('APPROVED ✓');
    expect(approved.html).toContain('Pudoc Branch');

    const rejected = renderUserPromoReviewedEmail({
      userName: 'Juan',
      promoName: 'Night Owl Special',
      status: 'rejected',
      branchName: 'Pudoc Branch',
    });
    expect(rejected.subject).toContain('Not Approved');
    expect(rejected.html).toContain('NOT APPROVED ✕');
  });

  it('renders user issue reviewed email with correct issue type labels', () => {
    const ghost = renderUserIssueReviewedEmail({
      userName: 'Pedro',
      issueType: 'ghost_credit',
      status: 'approved',
      branchName: 'Candon Branch',
    });
    expect(ghost.subject).toContain('Ghost Credit');
    expect(ghost.html).toContain('Ghost Credit');
    expect(ghost.html).toContain('RESOLVED / APPROVED ✓');

    const lost = renderUserIssueReviewedEmail({
      userName: 'Pedro',
      issueType: 'lost_points',
      status: 'rejected',
      branchName: 'Candon Branch',
    });
    expect(lost.subject).toContain('Lost Points');
    expect(lost.html).toContain('NOT APPROVED ✕');
  });

  it('renders user new promo published email', () => {
    const email = renderUserNewPromoPublishedEmail({
      userName: 'Ana',
      promoName: 'Weekend Unlimited',
      branchName: 'Pudoc Branch',
      description: 'Mag-surf buong weekend sa discounted rate!',
    });
    expect(email.subject).toContain('Weekend Unlimited');
    expect(email.html).toContain('Weekend Unlimited');
    expect(email.html).toContain('Mag-surf buong weekend');
    expect(email.html).toContain('Pudoc Branch');
  });
});

describe('Email Adapters', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ResendAdapter dispatches POST to resend API with authorization header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-msg-1' }), { status: 200 })
    );

    const adapter = new ResendAdapter('re_test_key_123', 'admin@dxtech.ph');
    const result = await adapter.send({
      to: 'customer@example.com',
      subject: 'Hello',
      html: '<p>Test</p>',
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe('resend-msg-1');
    expect(fetchSpy).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer re_test_key_123',
      }),
    }));
  });

  it('BrevoAdapter dispatches POST to Brevo API with api-key header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'brevo-msg-2' }), { status: 201 })
    );

    const adapter = new BrevoAdapter('xkeysib-test-key', 'alerts@dxtech.ph', 'DXTECH');
    const result = await adapter.send({
      to: 'customer@example.com',
      subject: 'Update',
      html: '<p>Update</p>',
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe('brevo-msg-2');
    expect(fetchSpy).toHaveBeenCalledWith('https://api.brevo.com/v3/smtp/email', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'api-key': 'xkeysib-test-key',
      }),
    }));
  });

  it('GmailApiAdapter constructs RFC 2822 raw message and calls users.messages.send', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'gmail-msg-3' }), { status: 200 })
    );

    const adapter = new GmailApiAdapter('google_oauth_token', 'me@gmail.com');
    const result = await adapter.send({
      to: 'admin@gmail.com',
      subject: 'New Request',
      html: '<h1>New Request</h1>',
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe('gmail-msg-3');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer google_oauth_token',
        }),
      })
    );
  });

  it('ConsoleLogAdapter returns mock id without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const adapter = new ConsoleLogAdapter();
    const result = await adapter.send({
      to: 'test@example.com',
      subject: 'Log Only',
      html: '<p>Log</p>',
    });

    expect(result.success).toBe(true);
    expect(result.id).toMatch(/^mock-/);
    expect(logSpy).toHaveBeenCalled();
  });

  it('gracefully handles adapter network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network down'));

    const adapter = new ResendAdapter('re_key', 'test@test.com');
    const result = await adapter.send({
      to: 'fail@test.com',
      subject: 'Fail',
      html: '<p>Fail</p>',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network down');
  });
});
