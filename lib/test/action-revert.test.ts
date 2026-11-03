import { expect, test } from "vitest";
import { createActionRevert } from "../action-revert.ts";

function harness() {
  const callbacks: (() => void)[] = [],
    reverter = createActionRevert(),
    schedule = (callback: () => void) => {
      callbacks.push(callback);
    };
  return { callbacks, reverter, schedule };
}

test("only the latest generation reverts", () => {
  const { callbacks, reverter, schedule } = harness();
  let reverts = 0;

  const first = reverter.begin(1);
  reverter.schedule(1, first, schedule, 2500, () => {
    reverts += 1;
  });
  const second = reverter.begin(1);
  reverter.schedule(1, second, schedule, 2500, () => {
    reverts += 1;
  });

  callbacks[0]!();
  expect(reverts).toBe(0);
  callbacks[1]!();
  expect(reverts).toBe(1);
});

test("a stale generation does not schedule a revert", () => {
  const { callbacks, reverter, schedule } = harness();
  const first = reverter.begin(1);
  reverter.begin(1);

  reverter.schedule(1, first, schedule, 2500, () => undefined);

  expect(callbacks).toHaveLength(0);
});

test("forgetting a tab cancels its pending revert", () => {
  const { callbacks, reverter, schedule } = harness();
  let reverts = 0;
  const generation = reverter.begin(1);
  reverter.schedule(1, generation, schedule, 2500, () => {
    reverts += 1;
  });

  reverter.forget(1);
  callbacks[0]!();

  expect(reverts).toBe(0);
});
