# Facebook Messenger Channel

Receive and reply to Facebook Messenger DMs from your NyteShift agents.

## Setup

1. **Create a Facebook App** at [developers.facebook.com](https://developers.facebook.com/)
2. **Add the Messenger product** and subscribe to a Page
3. **Generate a Page Access Token** and store it in NyteShift secrets
4. **Configure the Webhook URL** to point to your server on the configured port (default 7450)
5. **Set the Verify Token** to match the one configured in NyteShift

## Config Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pageAccessToken` | secret | Yes | Long-lived Page Access Token |
| `appSecret` | secret | Yes | App Secret for webhook signature verification |
| `verifyToken` | string | Yes | Custom webhook verification token |
| `webhookPort` | number | No | Local webhook port (default: 7450) |
