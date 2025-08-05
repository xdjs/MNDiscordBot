// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – p-queue provides its own types once installed
import PQueue from 'p-queue';
import { runListenJob, ListenJobPayload } from './listen.js';

const listenQueue = new PQueue({ concurrency: 1 });

export function enqueueListenJob(payload: ListenJobPayload) {
  listenQueue
    .add(() => runListenJob(payload))
    .catch((err: unknown) => console.error('[queue] listen job failed', err));
}
