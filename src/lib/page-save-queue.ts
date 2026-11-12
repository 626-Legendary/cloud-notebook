// Shared by editor instances and navigation: never fetch a stale version while
// this tab is still flushing the same page's previous editor instance.
const pending = new Map<string, Promise<unknown>>();

export function serializePageSave<T>(pageId: string, operation: () => Promise<T>): Promise<T> {
  const task = (pending.get(pageId) ?? Promise.resolve()).catch(() => undefined).then(operation);
  pending.set(pageId, task);
  void task.finally(() => { if (pending.get(pageId) === task) pending.delete(pageId); }).catch(() => undefined);
  return task;
}

export async function waitForPageSaves(pageId: string) {
  while (pending.has(pageId)) await pending.get(pageId)!.catch(() => undefined);
}

const flushers = new Map<string, () => Promise<void>>();
export function registerPageFlush(pageId: string, flush: () => Promise<void>) {
  flushers.set(pageId, flush);
  return () => { if (flushers.get(pageId) === flush) flushers.delete(pageId); };
}
export async function flushPageEdits(pageId: string) {
  await flushers.get(pageId)?.();
  await waitForPageSaves(pageId);
}
