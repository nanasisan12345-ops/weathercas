import type { IncomingMessage, ServerResponse } from 'node:http';
export function createWeatherHandler(): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
