declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export interface EmailSendResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface EmailService {
  send(payload: EmailPayload): Promise<EmailSendResult>;
}

export class ResendAdapter implements EmailService {
  constructor(
    private apiKey: string,
    private fromEmail = 'Announcement Room <onboarding@resend.dev>'
  ) {}

  async send(payload: EmailPayload): Promise<EmailSendResult> {
    const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: recipients,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        }),
      });

      const bodyText = await response.text();
      let data: Record<string, unknown> = {};
      try {
        data = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        const errorMsg = typeof data.message === 'string' ? data.message : `Resend API returned status ${response.status}`;
        return { success: false, error: errorMsg };
      }

      const id = typeof data.id === 'string' ? data.id : undefined;
      return { success: true, id };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown Resend error';
      return { success: false, error: message };
    }
  }
}

export class BrevoAdapter implements EmailService {
  constructor(
    private apiKey: string,
    private fromEmail = 'alerts@dxtech.ph',
    private fromName = 'Announcement Room'
  ) {}

  async send(payload: EmailPayload): Promise<EmailSendResult> {
    const recipients = (Array.isArray(payload.to) ? payload.to : [payload.to]).map((email) => ({ email }));
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: this.fromEmail, name: this.fromName },
          to: recipients,
          subject: payload.subject,
          htmlContent: payload.html,
          textContent: payload.text,
        }),
      });

      const bodyText = await response.text();
      let data: Record<string, unknown> = {};
      try {
        data = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        const errorMsg = typeof data.message === 'string' ? data.message : `Brevo API returned status ${response.status}`;
        return { success: false, error: errorMsg };
      }

      const id = typeof data.messageId === 'string' ? data.messageId : undefined;
      return { success: true, id };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown Brevo error';
      return { success: false, error: message };
    }
  }
}

export class GmailApiAdapter implements EmailService {
  constructor(
    private accessToken: string,
    private fromEmail: string
  ) {}

  async send(payload: EmailPayload): Promise<EmailSendResult> {
    const toHeader = Array.isArray(payload.to) ? payload.to.join(', ') : payload.to;
    // Format valid RFC 2822 email to ensure it sends directly to Inbox and never lands in Drafts
    const utf8Subject = `=?utf-8?B?${btoa(encodeURIComponent(payload.subject).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))))}?=`;
    const messageLines = [
      `From: ${this.fromEmail}`,
      `To: ${toHeader}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      payload.html,
    ];

    const rawMessage = messageLines.join('\r\n');
    const base64UrlMessage = btoa(encodeURIComponent(rawMessage).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    try {
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: base64UrlMessage }),
      });

      const bodyText = await response.text();
      let data: Record<string, unknown> = {};
      try {
        data = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        const errorData = data.error && typeof data.error === 'object' ? (data.error as Record<string, unknown>) : {};
        const errorMsg = typeof errorData.message === 'string' ? errorData.message : `Gmail API returned status ${response.status}`;
        return { success: false, error: errorMsg };
      }

      const id = typeof data.id === 'string' ? data.id : undefined;
      return { success: true, id };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown Gmail API error';
      return { success: false, error: message };
    }
  }
}

export class ConsoleLogAdapter implements EmailService {
  async send(payload: EmailPayload): Promise<EmailSendResult> {
    const to = Array.isArray(payload.to) ? payload.to.join(', ') : payload.to;
    console.log(`[EMAIL_DISPATCH_CONSOLE] To: ${to} | Subject: ${payload.subject}`);
    return { success: true, id: `mock-${Date.now()}` };
  }
}

export function getEmailService(): EmailService {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim();
  const brevoApiKey = Deno.env.get('BREVO_API_KEY')?.trim();
  const gmailAccessToken = Deno.env.get('GMAIL_ACCESS_TOKEN')?.trim();
  const fromEmail = Deno.env.get('EMAIL_FROM')?.trim();

  if (resendApiKey) {
    return new ResendAdapter(resendApiKey, fromEmail || 'Announcement Room <onboarding@resend.dev>');
  }

  if (brevoApiKey) {
    return new BrevoAdapter(brevoApiKey, fromEmail || 'alerts@dxtech.ph');
  }

  if (gmailAccessToken) {
    return new GmailApiAdapter(gmailAccessToken, fromEmail || 'me');
  }

  return new ConsoleLogAdapter();
}

// ---------------------------------------------------------------------------
// HTML Email Templates with high contrast, responsive styling
// ---------------------------------------------------------------------------

function emailContainer(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Announcement Room</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b131a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0b131a; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #14202b; border: 1px solid #233544; border-radius: 12px; overflow: hidden; padding: 28px 24px;">
          <tr>
            <td>
              <div style="border-bottom: 1px solid #233544; padding-bottom: 16px; margin-bottom: 20px;">
                <span style="font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: #f97316; text-transform: uppercase;">ANNOUNCEMENT ROOM</span>
                <h1 style="margin: 6px 0 0 0; font-size: 20px; font-weight: 700; color: #ffffff;">DXTECH PisoWiFi</h1>
              </div>
              ${content}
              <div style="margin-top: 32px; border-top: 1px solid #233544; padding-top: 16px; font-size: 11px; color: #64748b; text-align: center;">
                Announcement Room • Automated operational notification • 10.0.0.1
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderAdminNewPromoRequestEmail(params: {
  promoName: string;
  branchName: string;
  userName: string;
  deviceId: string;
  requestId: string;
}): EmailPayload {
  const subject = `[Bagong Request] ${params.promoName} - ${params.branchName}`;
  const html = emailContainer(`
    <div style="background-color: #1e293b; border-left: 4px solid #f97316; padding: 14px 16px; border-radius: 6px; margin-bottom: 20px;">
      <strong style="color: #fb923c; font-size: 14px;">May bagong pending promo request!</strong>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #cbd5e1;">Kinakailangan ito ng manual top-up review bago ma-fulfill.</p>
    </div>

    <table role="presentation" width="100%" style="font-size: 13px; color: #cbd5e1; line-height: 1.6;">
      <tr>
        <td style="padding: 6px 0; color: #94a3b8; width: 120px;">Customer Name:</td>
        <td style="padding: 6px 0; color: #ffffff; font-weight: 600;">${params.userName}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #94a3b8;">Device ID:</td>
        <td style="padding: 6px 0; color: #ffffff; font-family: monospace; font-weight: 700;">${params.deviceId}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #94a3b8;">Branch:</td>
        <td style="padding: 6px 0; color: #ffffff;">${params.branchName}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #94a3b8;">Promo:</td>
        <td style="padding: 6px 0; color: #f97316; font-weight: 700;">${params.promoName}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #94a3b8;">Request ID:</td>
        <td style="padding: 6px 0; font-family: monospace; font-size: 11px; color: #64748b;">${params.requestId}</td>
      </tr>
    </table>

    <div style="margin-top: 24px;">
      <p style="font-size: 13px; color: #94a3b8;">Pumunta sa Admin Dashboard para ma-approve o ma-reject ang request na ito.</p>
    </div>
  `);

  return {
    to: '', // Set by caller
    subject,
    html,
    text: `Bagong Promo Request: ${params.promoName}\nCustomer: ${params.userName}\nDevice ID: ${params.deviceId}\nBranch: ${params.branchName}`,
  };
}

export function renderUserPromoReviewedEmail(params: {
  userName: string;
  promoName: string;
  status: 'approved' | 'rejected';
  branchName: string;
}): EmailPayload {
  const isApproved = params.status === 'approved';
  const statusColor = isApproved ? '#22c55e' : '#ef4444';
  const statusLabel = isApproved ? 'APPROVED ✓' : 'NOT APPROVED ✕';
  const subject = `[Update] Ang iyong request para sa ${params.promoName} ay ${isApproved ? 'Approved' : 'Not Approved'}`;

  const html = emailContainer(`
    <p style="font-size: 14px; margin-top: 0; color: #cbd5e1;">Mabuhay, <strong style="color: #ffffff;">${params.userName}</strong>,</p>

    <div style="background-color: #1e293b; border-left: 4px solid ${statusColor}; padding: 14px 16px; border-radius: 6px; margin: 18px 0;">
      <div style="font-size: 12px; font-weight: 700; color: ${statusColor}; text-transform: uppercase; letter-spacing: 0.05em;">STATUS: ${statusLabel}</div>
      <h2 style="margin: 4px 0 0 0; font-size: 16px; color: #ffffff;">${params.promoName}</h2>
      <p style="margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1;">
        ${isApproved
          ? 'Na-approve na ng admin ang iyong request! Pumunta sa admin o subaybayan ang iyong promo sa Announcement Room.'
          : 'Paumanhin, hindi na-approve ang iyong request para sa promo na ito. Maaari kang mag-request ng iba pang promos.'}
      </p>
    </div>

    <div style="font-size: 12px; color: #94a3b8; margin-top: 20px;">
      Branch: <strong>${params.branchName}</strong>
    </div>
  `);

  return {
    to: '',
    subject,
    html,
    text: `Update para sa ${params.promoName}: ${statusLabel}\nBranch: ${params.branchName}`,
  };
}

export function renderUserIssueReviewedEmail(params: {
  userName: string;
  issueType: string;
  status: 'approved' | 'rejected';
  branchName: string;
}): EmailPayload {
  const isApproved = params.status === 'approved';
  const statusColor = isApproved ? '#22c55e' : '#ef4444';
  const statusLabel = isApproved ? 'RESOLVED / APPROVED ✓' : 'NOT APPROVED ✕';
  const issueLabel = params.issueType === 'ghost_credit' ? 'Ghost Credit' : 'Lost Points';
  const subject = `[Issue Update] Ang iyong report (${issueLabel}) ay ${isApproved ? 'Resolved' : 'Closed'}`;

  const html = emailContainer(`
    <p style="font-size: 14px; margin-top: 0; color: #cbd5e1;">Mabuhay, <strong style="color: #ffffff;">${params.userName}</strong>,</p>

    <div style="background-color: #1e293b; border-left: 4px solid ${statusColor}; padding: 14px 16px; border-radius: 6px; margin: 18px 0;">
      <div style="font-size: 12px; font-weight: 700; color: ${statusColor}; text-transform: uppercase;">STATUS: ${statusLabel}</div>
      <h2 style="margin: 4px 0 0 0; font-size: 16px; color: #ffffff;">Report: ${issueLabel}</h2>
      <p style="margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1;">
        ${isApproved
          ? 'Nasuri at na-approve na ng admin ang iyong report. Na-credit na ang iyong adjustment ayon sa review.'
          : 'Nasuri ng admin ang iyong report at minarkahang hindi approved.'}
      </p>
    </div>

    <div style="font-size: 12px; color: #94a3b8; margin-top: 20px;">
      Branch: <strong>${params.branchName}</strong>
    </div>
  `);

  return {
    to: '',
    subject,
    html,
    text: `Report update (${issueLabel}): ${statusLabel}\nBranch: ${params.branchName}`,
  };
}

export function renderUserNewPromoPublishedEmail(params: {
  userName: string;
  promoName: string;
  branchName: string;
  description?: string | null;
}): EmailPayload {
  const subject = `[Bagong Promo] ${params.promoName} sa ${params.branchName}!`;

  const html = emailContainer(`
    <p style="font-size: 14px; margin-top: 0; color: #cbd5e1;">Mabuhay, <strong style="color: #ffffff;">${params.userName}</strong>,</p>

    <div style="background-color: #1e293b; border-left: 4px solid #f97316; padding: 16px; border-radius: 6px; margin: 18px 0;">
      <div style="font-size: 11px; font-weight: 800; color: #fb923c; text-transform: uppercase; letter-spacing: 0.08em;">BAGONG PROMO AVAILABLE</div>
      <h2 style="margin: 4px 0 8px 0; font-size: 18px; color: #ffffff;">${params.promoName}</h2>
      ${params.description ? `<p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.5;">${params.description}</p>` : ''}
    </div>

    <p style="font-size: 13px; color: #cbd5e1;">Pumunta sa Announcement Room sa iyong browser para mag-claim o mag-request bago maubos ang slots!</p>
    <div style="font-size: 12px; color: #94a3b8; margin-top: 16px;">
      Branch: <strong>${params.branchName}</strong>
    </div>
  `);

  return {
    to: '',
    subject,
    html,
    text: `Bagong Promo: ${params.promoName} sa ${params.branchName}!\n${params.description || ''}`,
  };
}
