import { patchOriginal } from '../../src/utils/discord.js';

// Create a minimal Response mock to satisfy patchOriginal expectations
afterEach(() => {
  jest.resetAllMocks();
});

describe('patchOriginal', () => {
  it('calls Discord webhook with correct URL and body', async () => {
    const mockText = jest.fn().mockResolvedValue('OK');
    // Mock global fetch
    global.fetch = jest.fn().mockResolvedValue({ status: 204, text: mockText }) as any;

    const body = { content: 'hello' };
    await patchOriginal('123', 'tokenXYZ', body, 'test');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/webhooks/123/tokenXYZ?wait=true',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    expect(mockText).toHaveBeenCalled();
  });
});
