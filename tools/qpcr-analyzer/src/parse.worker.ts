import { parseFile } from './parsers';
self.onmessage = async (e: MessageEvent<{ name: string; bytes: Uint8Array }>) => {
  try { self.postMessage({ dataset: await parseFile(e.data.name, e.data.bytes) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
