// @ts-nocheck
import request from 'supertest';
import express from 'express';

jest.mock('../../src/utils/discord.js', () => ({ patchOriginal: jest.fn() }));

const chain = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  update: jest.fn().mockReturnThis(),
};
const supabaseStub = { from: jest.fn().mockReturnValue(chain) };

jest.mock('../../api/lib/supabase.js', () => ({ supabase: supabaseStub }));
jest.mock('../../api/lib/spotify.js', () => ({ spotifyClientId: 'cid', spotifyClientSecret: 'csecret' }));

import { registerImageHook } from '../../src/routes/imageHook.js';

describe('/image-hook route', () => {
  const app = express();
  app.use(express.json());
  registerImageHook(app);

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/image-hook').send({});
    expect(res.status).toBe(400);
  });

  describe('auth secret', () => {
    const ORIGINAL_SECRET = process.env.IMAGE_HOOK_SECRET;
    beforeAll(() => {
      process.env.IMAGE_HOOK_SECRET = 'mysecret';
    });
    afterAll(() => {
      if (ORIGINAL_SECRET !== undefined) process.env.IMAGE_HOOK_SECRET = ORIGINAL_SECRET; else delete process.env.IMAGE_HOOK_SECRET;
    });

    it('returns 401 on signature mismatch', async () => {
      const res = await request(app)
        .post('/image-hook')
        .send({ user_id: 'u1', application_id: 'a1', interaction_token: 't1' });
      expect(res.status).toBe(401);
    });

    it('returns 202 on valid signature', async () => {
      const res = await request(app)
        .post('/image-hook')
        .set('x-image-signature', 'mysecret')
        .send({ user_id: 'u1', application_id: 'a1', interaction_token: 't1' });
      expect(res.status).toBe(202);
    });
  });
});
