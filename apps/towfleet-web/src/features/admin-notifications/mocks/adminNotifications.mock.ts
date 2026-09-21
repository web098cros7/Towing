import type {
  AdminNotificationDeliveriesQuery,
  AdminNotificationDeliveriesResponse,
  AdminNotificationTemplate,
  AdminNotificationTemplatesResponse,
  AdminNotificationTestSend,
  AdminNotificationTestSendResponse,
} from '@towing/api-contracts';

/**
 * W18's mock. Deterministic, shaped exactly like the API.
 *
 * The catalogue mirrors today's REAL state (every SMS/WhatsApp row unusable
 * because DLT/Meta approvals are pending) rather than a rosier fiction — the
 * screen's whole job in this milestone is telling that truth.
 */

const templates: AdminNotificationTemplate[] = [
  {
    templateKey: 'driver_kyc_approved',
    events: ['driver.kyc.approved'],
    matrixRows: ['kyc_approved'],
    channels: ['sms', 'whatsapp'],
    unusableChannels: ['sms', 'whatsapp'],
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['name'],
    sampleTitle: 'You are verified',
    sampleBody:
      'Hi, your documents are approved. You can start earning now — go online in TowPartner.',
    sampleSubject: null,
    category: 'transactional',
    alwaysOn: true,
  },
  {
    templateKey: 'job_invoice_email',
    events: ['booking.completed_invoice'],
    matrixRows: ['invoice'],
    channels: ['email'],
    unusableChannels: [],
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['amount'],
    sampleTitle: 'Invoice',
    sampleBody: 'Your trip invoice is attached.',
    sampleSubject: 'Your tow invoice',
    category: 'transactional',
    alwaysOn: true,
  },
  {
    templateKey: 'sos_ops_alert',
    events: ['sos.ops_alert'],
    matrixRows: [],
    channels: ['email', 'sms'],
    unusableChannels: ['sms'],
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['subject', 'link', 'alertRef'],
    sampleTitle: 'SOS alert — a user',
    sampleBody: 'A user triggered an SOS (alert —). Open the SOS console to acknowledge.',
    sampleSubject: 'SOS: a user needs help (—)',
    category: 'safety',
    alwaysOn: true,
  },
  {
    templateKey: 'analytics_weekly_report',
    events: ['analytics.report'],
    matrixRows: [],
    channels: ['email'],
    unusableChannels: [],
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['week', 'summary'],
    sampleTitle: 'Weekly marketplace report',
    sampleBody: 'Marketplace report for last week\n\n(no rows)',
    sampleSubject: 'Weekly marketplace report — last week',
    category: 'compliance',
    alwaysOn: true,
  },
  {
    templateKey: 'payment_receipt_email',
    events: ['payment.succeeded', 'payment.failed'],
    matrixRows: ['payment_status'],
    channels: ['push', 'sms', 'email'],
    unusableChannels: ['sms'],
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['bookingRef', 'amount', 'status'],
    sampleTitle: 'Payment received',
    sampleBody: 'We received  for booking . Your receipt is below.',
    sampleSubject: 'Receipt for booking ',
    category: 'money',
    alwaysOn: false,
  },
];

const deliveries: AdminNotificationDeliveriesResponse['items'] = [
  {
    id: '90000000-0000-4000-8000-000000000001',
    event: 'driver.kyc.approved',
    recipientKey: 'driver:91000000-0000-4000-8000-000000000001',
    channel: 'sms',
    status: 'failed',
    skipReason: null,
    destination: '****7788',
    vendor: 'msg91',
    attempts: 3,
    lastError: 'dlt_template_missing: SMS templates are not DLT-registered yet',
    sentAt: null,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  },
  {
    id: '90000000-0000-4000-8000-000000000002',
    event: 'booking.completed_invoice',
    recipientKey: 'user:91000000-0000-4000-8000-000000000002',
    channel: 'email',
    status: 'sent',
    skipReason: null,
    destination: 'm***@example.com',
    vendor: 'log',
    attempts: 1,
    lastError: null,
    sentAt: new Date(Date.now() - 7_200_000).toISOString(),
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
  },
  {
    id: '90000000-0000-4000-8000-000000000003',
    event: 'sos.ops_alert',
    recipientKey: 'ops:00000000-0000-0000-0000-000000000000',
    channel: 'sms',
    status: 'skipped',
    skipReason: 'no_address',
    destination: null,
    vendor: null,
    attempts: 0,
    lastError: null,
    sentAt: null,
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    id: '90000000-0000-4000-8000-000000000004',
    event: 'payout.paid',
    recipientKey: 'driver:91000000-0000-4000-8000-000000000004',
    channel: 'push',
    status: 'sent',
    skipReason: null,
    destination: 'ExponentPushToken[ab…uv]',
    vendor: 'log',
    attempts: 1,
    lastError: null,
    sentAt: new Date(Date.now() - 120_000).toISOString(),
    createdAt: new Date(Date.now() - 120_000).toISOString(),
  },
];

export function mockTemplates(): AdminNotificationTemplatesResponse {
  return { items: templates };
}

export function mockDeliveries(
  query: AdminNotificationDeliveriesQuery,
): AdminNotificationDeliveriesResponse {
  const matched = deliveries.filter((delivery) => {
    const statusMatches = query.status ? delivery.status === query.status : true;
    const channelMatches = query.channel ? delivery.channel === query.channel : true;
    const eventMatches = query.event ? delivery.event.includes(query.event) : true;
    return statusMatches && channelMatches && eventMatches;
  });

  const offset = (query.page - 1) * query.limit;
  return {
    items: matched.slice(offset, offset + query.limit),
    page: query.page,
    limit: query.limit,
    total: matched.length,
    // Two jobs waiting for a human, as if the nightly reconcile had drifted.
    deadLetterDepth: 2,
  };
}

export function mockTestSend(body: AdminNotificationTestSend): AdminNotificationTestSendResponse {
  if (body.templateKey === 'mock-failure') {
    return {
      sent: false,
      channel: body.channel,
      destination: body.channel === 'email' ? 'o***@towing.local' : '****0000',
      code: 'dlt_template_missing',
    };
  }
  return {
    sent: true,
    channel: body.channel,
    destination: body.channel === 'email' ? 'o***@towing.local' : '****0000',
    code: null,
  };
}
