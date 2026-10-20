import type { IncomingMessage, ServerResponse } from 'node:http';
export function createRecordingHandler(root: string): ((req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>) & { dispose: () => Promise<void> };
