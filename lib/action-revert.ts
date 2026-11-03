export interface ActionRevert {
  begin: (tabId: number) => number;
  schedule: (
    tabId: number,
    generation: number,
    scheduleCallback: (callback: () => void, delayMs: number) => void,
    delayMs: number,
    revert: () => void,
  ) => void;
  forget: (tabId: number) => void;
}

export function createActionRevert(): ActionRevert {
  const generations = new Map<number, number>();
  return {
    begin(tabId) {
      const generation = (generations.get(tabId) ?? 0) + 1;
      generations.set(tabId, generation);
      return generation;
    },
    schedule(tabId, generation, scheduleCallback, delayMs, revert) {
      if (generations.get(tabId) !== generation) return;
      scheduleCallback(() => {
        if (generations.get(tabId) !== generation) return;
        generations.delete(tabId);
        revert();
      }, delayMs);
    },
    forget(tabId) {
      generations.delete(tabId);
    },
  };
}
