// GET /api/webhooks/whatsapp (subscription check) and POST (signed updates from Meta).
export { verifyWebhook as GET, receiveWebhook as POST } from '../server/whatsapp';
