import type { IncomingMessage, ServerResponse } from 'node:http';
export function createLiveHandler(): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
