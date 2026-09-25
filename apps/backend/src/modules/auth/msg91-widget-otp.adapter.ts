import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { ExternalCallPolicy } from '../../common/http/external-call.policy';
import type { OtpPort, OtpPurpose, OtpSendReceipt } from './otp.port';

/**
 * Login codes through MSG91's OTP Widget (`OTP_PROVIDER=msg91_widget`).
 *
 * WHY THE WIDGET: it sends through MSG91's own DLT-approved templates, so MiTow
 * needs no DLT registration of its own (the owner's choice, 25 Sep 2026). The
 * price is that MSG91 MAKES and CHECKS the code: our generated code is ignored,
 * the send returns MSG91's `reqId`, and a typed code is checked by asking MSG91.
 *
 * WHAT STAYS OURS: the challenge, the 6-digit format the apps enforce, the
 * attempt cap and the expiry (`otp-delivery.ts`). MSG91 is called
 * server-to-server, so the widget token never ships inside an app and a
 * "verified" answer cannot be forged by a client.
 *
 * The endpoints are the ones MSG91's own SDKs call (`@msg91comm/sendotp-react-native`
 * 3.0.0, `API/api.url.ts`): `POST /api/v5/widget/sendOtpMobile` and
 * `POST /api/v5/widget/verifyOtp`, each with `widgetId` + `tokenAuth` in the body.
 *
 * The widget must be set to 6 digits (the apps' code boxes and the API contract
 * are 6), and "Invisible OTP" must stay off: it verifies without a code, which
 * this login flow has no step for.
 */
@Injectable()
export class Msg91WidgetOtpAdapter implements OtpPort, OnModuleInit {
  private readonly logger = new Logger(Msg91WidgetOtpAdapter.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly policy: ExternalCallPolicy,
  ) {}

  onModuleInit(): void {
    if (this.env.OTP_PROVIDER !== 'msg91_widget') return;
    if (!this.env.MSG91_WIDGET_ID || !this.env.MSG91_WIDGET_TOKEN) {
      this.logger.warn(
        'OTP_PROVIDER=msg91_widget but MSG91_WIDGET_ID or MSG91_WIDGET_TOKEN is missing',
      );
    }
  }

  async send(phone: string, _code: string, purpose: OtpPurpose): Promise<OtpSendReceipt> {
    const reply = await this.call('/api/v5/widget/sendOtpMobile', {
      identifier: phone.replace(/^\+/, ''),
    });
    if (reply.type !== 'success' || !reply.message) {
      throw new Msg91WidgetError(
        `MSG91 did not send the code: ${reply.message ?? 'no reason given'}`,
      );
    }
    if (reply['access-token'] || reply.invisibleVerified) {
      // Invisible OTP answered without a code. Nothing in this flow can use
      // that, so the customer will be asked for a code that never arrives.
      this.logger.warn('MSG91 widget verified invisibly: switch "Invisible OTP" off in the widget');
    }
    this.logger.log(`${purpose} code sent to ${mask(phone)} (MSG91 widget)`);
    return { vendorRef: reply.message };
  }

  async verify(vendorRef: string, code: string): Promise<boolean> {
    const reply = await this.call('/api/v5/widget/verifyOtp', { reqId: vendorRef, otp: code });
    if (reply.type === 'success') return true;
    // A wrong, expired or already-used code. Logged, because a misconfigured
    // token also answers "error" here and would otherwise look like a typo.
    this.logger.warn(`MSG91 widget refused a code: ${reply.message ?? 'no reason given'}`);
    return false;
  }

  private async call(path: string, body: Record<string, string>): Promise<WidgetReply> {
    if (!this.env.MSG91_WIDGET_ID || !this.env.MSG91_WIDGET_TOKEN) {
      throw new Msg91WidgetError('MSG91 widget is not configured');
    }
    return this.policy.run<WidgetReply>(
      {
        vendor: 'msg91',
        attempts: 2,
        backoffMs: 500,
        isRetryable: (error) => !(error instanceof Msg91WidgetError),
      },
      async (signal) => {
        const response = await fetch(`${this.env.MSG91_BASE_URL}${path}`, {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            widgetId: this.env.MSG91_WIDGET_ID,
            tokenAuth: this.env.MSG91_WIDGET_TOKEN,
            ...body,
          }),
        });
        const text = await response.text();
        if (response.status >= 500) throw new Error(`MSG91 returned ${response.status}: ${text}`);
        try {
          return JSON.parse(text) as WidgetReply;
        } catch {
          throw new Msg91WidgetError(`MSG91 returned ${response.status}: ${text}`);
        }
      },
    );
  }
}

type WidgetReply = {
  type?: string;
  message?: string;
  'access-token'?: string;
  invisibleVerified?: boolean;
};

export class Msg91WidgetError extends Error {}

function mask(phone: string): string {
  return phone.length <= 4 ? '****' : `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}
