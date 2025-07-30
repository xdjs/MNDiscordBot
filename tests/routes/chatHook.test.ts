// @ts-nocheck
import request from 'supertest';
import express from 'express';

const mockChatChannels = new Set<string>();
const scheduleChatTimeoutMock = jest.fn();

jest.mock('../../src/sessions/chat.js', () => ({
  chatChannels: mockChatChannels,
  scheduleChatTimeout: scheduleChatTimeoutMock,
}));

import { registerChatHook } from '../../src/routes/chatHook.js';

describe('/chat-hook route', () => {
  const app = express();
  app.use(express.json());
  registerChatHook(app, {} as any);

  it('returns 400 when channel_id is missing', async () => {
    const res = await request(app).post('/chat-hook').send({});
    expect(res.status).toBe(400);
  });

  it('activates chat mode and schedules timeout', async () => {
    const res = await request(app).post('/chat-hook').send({ channel_id: '123' });
    expect(res.status).toBe(200);
    expect(mockChatChannels.has('123')).toBe(true);
    expect(scheduleChatTimeoutMock).toHaveBeenCalled();
  });
});
