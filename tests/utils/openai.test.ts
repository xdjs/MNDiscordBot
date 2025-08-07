// @ts-nocheck
import { getFunFact } from '../../src/utils/openai.js';

// ------------ mocks -----------------
const artistLinksMock = jest.fn().mockResolvedValue(null);
jest.mock('../../src/services/artistLinks.js', () => ({
  fetchArtistLinksByName: (name:string)=> artistLinksMock(name),
}));

// Supabase mock for Summary_prompts table
jest.mock('../../api/lib/supabase.js', () => {
  const selectMock = jest.fn().mockReturnThis();
  const limitMock = jest.fn().mockReturnThis();
  const singleMock = jest.fn().mockResolvedValue({ data: { fun_fact: 'Fun fact about {artist}' } });
  const fromMock = jest.fn().mockReturnValue({ select: selectMock, limit: limitMock, single: singleMock });
  return { supabase: { from: fromMock }, fromMock, __esModule: true };
});

// Extract mocks for assertions
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromMock } = require('../../api/lib/supabase.js');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.OPENAI_API_KEY;
  jest.resetModules(); // clear cached summaryPrompts/openai module state
});

describe('getFunFact', () => {
  it('returns fallback when no API key', async () => {
    const res = await getFunFact('Daft Punk');
    expect(res).toMatch(/Daft Punk/);
    // No strict expectation on DB calls; focus on output
  });

  it('calls OpenAI with prompt when API key present', async () => {
    process.env.OPENAI_API_KEY = 'KEY';
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ choices: [{ message: { content: '[1] They are robots.' } }] }),
    });
    global.fetch = fetchMock as any;

    const result = await getFunFact('Daft Punk');

    expect(fetchMock).toHaveBeenCalled();
    // Ensure footer appended due to missing artist in DB
    expect(result).toMatch(/robots/);
    expect(result).toMatch(/add-artist/);
  });

  it('falls back when OpenAI request fails', async () => {
    process.env.OPENAI_API_KEY = 'KEY';
    const fetchMock = jest.fn().mockRejectedValue(new Error('network'));
    global.fetch = fetchMock as any;

    const res = await getFunFact('Daft Punk');
    expect(res).toMatch(/Daft Punk/);
  });
});
