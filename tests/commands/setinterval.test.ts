// @ts-nocheck
import { InteractionResponseType } from 'discord-interactions';

// ---------------- Supabase mock ----------------
const upsertMock = jest.fn().mockResolvedValue({});
const fromMock = jest.fn().mockReturnValue({ upsert: upsertMock });

jest.mock('../../api/lib/supabase.js', () => ({
  supabase: { from: fromMock },
}));

import { setinterval } from '../../api/commands/setinterval.js';

function baseInteraction(overrides: Partial<any> = {}) {
  return {
    guild_id: 'guild1',
    member: {
      permissions: '0', // default no admin
      user: { id: 'user1' },
    },
    data: {},
    ...overrides,
  } as any;
}

function adminInteraction(hours: number) {
  return baseInteraction({
    member: { permissions: '8', user: { id: 'admin' } },
    data: { options: [{ value: hours }] },
  });
}

describe('setinterval command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects non-admin callers', async () => {
    const res = await setinterval(baseInteraction({ data: { options: [{ value: 3 }] } }));
    expect(res.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    expect(res.data.content).toMatch(/only server administrators/i);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('stores interval 3 when admin calls', async () => {
    const res = await setinterval(adminInteraction(3));
    expect(upsertMock).toHaveBeenCalledWith({ guild_id: 'guild1', interval: 3 });
    expect(res.data.content).toMatch(/3\s*hours/i);
  });

  it('values >6 default to daily (interval 0)', async () => {
    const res = await setinterval(adminInteraction(10));
    expect(upsertMock).toHaveBeenCalledWith({ guild_id: 'guild1', interval: 0 });
    expect(res.data.content).toMatch(/once per day/i);
  });
});
