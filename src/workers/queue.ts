// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – p-queue provides its own types once installed
import PQueue from 'p-queue';
import { runImageJob, ImageJobPayload } from './image.js';
import { runProfileJob, ProfileJobPayload } from './profile.js';
import { runListenJob, ListenJobPayload } from './listen.js';

const imageQueue = new PQueue({ concurrency: 1 });
const profileQueue = new PQueue({ concurrency: 1 });
const listenQueue = new PQueue({ concurrency: 1 });

export function enqueueImageJob(payload: ImageJobPayload) {
  imageQueue
    .add(() => runImageJob(payload))
    .catch((err: unknown) => console.error('[queue] image job failed', err));
}

export function enqueueProfileJob(payload: ProfileJobPayload) {
  profileQueue
    .add(() => runProfileJob(payload))
    .catch((err: unknown) => console.error('[queue] profile job failed', err));
}

export function enqueueListenJob(payload: ListenJobPayload) {
  listenQueue
    .add(() => runListenJob(payload))
    .catch((err: unknown) => console.error('[queue] listen job failed', err));
} 