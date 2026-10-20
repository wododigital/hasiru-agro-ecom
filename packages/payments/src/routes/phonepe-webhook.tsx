// POST /api/webhooks/phonepe: gateway callbacks (authenticated, stored once, processed by a job).
export { receiveWebhook as POST } from '../server/webhook';
