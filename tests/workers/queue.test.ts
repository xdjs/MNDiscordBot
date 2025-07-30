// @ts-nocheck

jest.mock('../../src/workers/image.js', () => ({ runImageJob: jest.fn() }));
jest.mock('../../src/workers/profile.js', () => ({ runProfileJob: jest.fn() }));
jest.mock('../../src/workers/listen.js', () => ({ runListenJob: jest.fn() }));

const addMock = jest.fn().mockReturnValue({ catch: jest.fn() });
jest.mock('p-queue', () => jest.fn().mockImplementation(() => ({ add: addMock })));

import { enqueueImageJob, enqueueProfileJob, enqueueListenJob } from '../../src/workers/queue.js';

describe('queue worker', () => {
  beforeEach(() => {
    addMock.mockClear();
  });

  it('enqueueImageJob schedules', () => {
    enqueueImageJob({} as any);
    expect(addMock).toHaveBeenCalled();
  });

  it('enqueueProfileJob schedules', () => {
    enqueueProfileJob({} as any);
    expect(addMock).toHaveBeenCalled();
  });

  it('enqueueListenJob schedules', () => {
    enqueueListenJob({} as any);
    expect(addMock).toHaveBeenCalled();
  });
});
