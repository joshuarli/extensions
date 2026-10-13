export function createRebuildQueue(reportFailure: (error: unknown) => void) {
  let queue = Promise.resolve();

  return (rebuild: () => Promise<void>) => {
    queue = queue.then(rebuild).catch(reportFailure);
    return queue;
  };
}
