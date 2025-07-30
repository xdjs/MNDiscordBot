// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('../../src/services/artistLinks.js', () => ({
  fetchArtistLinksByName: jest.fn().mockResolvedValue(null),
}));

global.fetch = jest.fn().mockResolvedValue({ json: jest.fn().mockResolvedValue({ choices: [] }) });

import { getFunFact, getSongFunFact, getChatAnswer } from '../../src/utils/openai.js';

describe('openai utils – fallback paths without API key', () => {
  beforeAll(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('getFunFact returns fallback', async () => {
    const fact = await getFunFact('Daft Punk');
    expect(fact.startsWith('Daft Punk is cool!')).toBe(true);
  });

  it('getSongFunFact returns fallback', async () => {
    const fact = await getSongFunFact('Random Access Memories');
    expect(fact).toBe('Random Access Memories sounds great!');
  });

  it('getChatAnswer returns offline message', async () => {
    const answer = await getChatAnswer('How are you?');
    expect(['I\'m offline right now. Try again later!', "I'm not sure." ]).toContain(answer);
  });
});
