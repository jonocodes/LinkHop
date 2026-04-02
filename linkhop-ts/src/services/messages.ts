import type { Database } from '@db/sqlite';
import type { AppConfig, DeviceRecord } from '../types.ts';
import { getDeviceById } from './devices.ts';
import { relayPushMessage } from './push.ts';

export class MessageValidationError extends Error {}

export function validateMessage(messageType: string, body: string): void {
  if (messageType !== 'url' && messageType !== 'text') {
    throw new MessageValidationError("Message type must be 'url' or 'text'.");
  }

  if (messageType === 'url') {
    if (body.length > 2048) {
      throw new MessageValidationError('URL must be at most 2048 characters.');
    }

    let parsed: URL;
    try {
      parsed = new URL(body);
    } catch {
      throw new MessageValidationError(
        'body must be a valid absolute http or https URL',
      );
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new MessageValidationError(
        'body must be a valid absolute http or https URL',
      );
    }
  }

  if (messageType === 'text') {
    if (body.length > 8000) {
      throw new MessageValidationError(
        'Text body must be at most 8000 characters.',
      );
    }
    if (!body.trim()) {
      throw new MessageValidationError('Text body cannot be empty.');
    }
  }
}

export function resolveRecipient(
  db: Database,
  recipientId: string,
): DeviceRecord | null {
  const device = getDeviceById(db, recipientId);
  if (!device || !device.is_active || device.revoked_at) {
    return null;
  }
  return device;
}

export async function relayMessage(
  db: Database,
  config: AppConfig,
  input: {
    senderDevice: DeviceRecord;
    recipientDevice: DeviceRecord;
    messageType: string;
    body: string;
    skipSelfSendCheck?: boolean;
  },
): Promise<{
  id: string;
  type: string;
  body: string;
  sender_device_id: string;
  recipient_device_id: string;
  created_at: string;
  push_delivered: boolean;
  push_subscriptions: number;
}> {
  if (
    !input.skipSelfSendCheck &&
    input.senderDevice.id === input.recipientDevice.id &&
    !config.allowSelfSend
  ) {
    throw new MessageValidationError(
      'Sending a message to yourself is not allowed.',
    );
  }

  validateMessage(input.messageType, input.body);

  const messageId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const pushResult = await relayPushMessage(db, config, {
    device: input.recipientDevice,
    messageId,
    messageType: input.messageType,
    body: input.body,
    senderName: input.senderDevice.name,
    recipientDeviceId: input.recipientDevice.id,
    createdAt,
  });

  if (
    input.messageType === 'text' &&
    input.body.trim().toLowerCase() === 'ping server'
  ) {
    await relayMessage(db, config, {
      senderDevice: input.recipientDevice,
      recipientDevice: input.senderDevice,
      messageType: 'text',
      body: 'pong (server)',
      skipSelfSendCheck: true,
    });
  }

  return {
    id: messageId,
    type: input.messageType,
    body: input.body,
    sender_device_id: input.senderDevice.id,
    recipient_device_id: input.recipientDevice.id,
    created_at: createdAt,
    push_delivered: pushResult.delivered > 0,
    push_subscriptions: pushResult.total,
  };
}
