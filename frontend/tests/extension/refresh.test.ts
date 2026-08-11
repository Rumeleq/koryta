import { describe, it, expect, vi } from "vitest";
import {
  coalesceRefreshes,
  REFRESH_COOLDOWN_MS,
  // @ts-expect-error - the extension is plain JS with no types of its own.
} from "../../../extension/refresh.js";

/** A handoff whose outcome the test decides, and which counts its calls —
 * every call is one tab opened in front of somebody. */
function handoff() {
  let settle: (value: unknown) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const open = vi.fn(
    () =>
      new Promise((resolve, reject) => {
        settle = resolve;
        fail = reject;
      }),
  );
  return {
    open,
    resolve: (value: unknown = { token: "t" }) => settle(value),
    reject: (message = "nie udało się odświeżyć sesji") =>
      fail(new Error(message)),
  };
}

describe("coalesceRefreshes", () => {
  it("opens one tab for callers that arrive together", async () => {
    // The bug this exists for. A dev server restart refuses every stored token
    // at once, and the popup, the panel and `withToken`'s retry all ask for a
    // new one within the same instant.
    const { open, resolve } = handoff();
    const refresh = coalesceRefreshes(open);

    const waiting = [refresh(), refresh(), refresh(), refresh(), refresh()];
    expect(open).toHaveBeenCalledTimes(1);

    resolve({ token: "fresh" });
    expect(await Promise.all(waiting)).toEqual(
      Array(5).fill({ token: "fresh" }),
    );
  });

  it("opens another once the first has finished", async () => {
    const { open, resolve } = handoff();
    const refresh = coalesceRefreshes(open);

    const first = refresh();
    resolve();
    await first;

    void refresh().catch(() => {});
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("waits before opening another after one that failed", async () => {
    // Without this the panel reopens the tab on every tab switch and every
    // navigation, for as long as the site is down.
    const clock = { at: 1_000_000 };
    const { open, reject } = handoff();
    const refresh = coalesceRefreshes(open, { now: () => clock.at });

    const first = refresh();
    reject();
    await expect(first).rejects.toThrow("nie udało się odświeżyć sesji");

    await expect(refresh()).rejects.toThrow("połącz rozszerzenie ponownie");
    expect(open).toHaveBeenCalledTimes(1);

    // The message names what the reader can do, because every automatic caller
    // turns a refusal here into the "connect" prompt.
    clock.at += REFRESH_COOLDOWN_MS + 1;
    void refresh().catch(() => {});
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("lets a deliberate press through the wait", async () => {
    // Pressing "Połącz z koryta.pl" means they have just signed in, which is
    // exactly the thing the last failure could not know.
    const clock = { at: 0 };
    const { open, reject, resolve } = handoff();
    const refresh = coalesceRefreshes(open, { now: () => clock.at });

    const first = refresh();
    reject();
    await expect(first).rejects.toThrow();

    const forced = refresh({ force: true });
    expect(open).toHaveBeenCalledTimes(2);
    resolve({ token: "fresh" });
    expect(await forced).toEqual({ token: "fresh" });
  });

  it("stops waiting when a token turns up another way", async () => {
    // Someone opened /rozszerzenie themselves. The site is answering again, so
    // there is nothing left to wait out.
    const clock = { at: 0 };
    const { open, reject } = handoff();
    const refresh = coalesceRefreshes(open, { now: () => clock.at });

    const first = refresh();
    reject();
    await expect(first).rejects.toThrow();

    refresh.arrived();
    void refresh().catch(() => {});
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("clears the wait after a handoff that worked", async () => {
    const clock = { at: 0 };
    const { open, reject, resolve } = handoff();
    const refresh = coalesceRefreshes(open, { now: () => clock.at });

    const failed = refresh();
    reject();
    await expect(failed).rejects.toThrow();

    const forced = refresh({ force: true });
    resolve();
    await forced;

    // A success in between must not leave the earlier failure's cooldown
    // standing, or the next ordinary caller is refused for no reason.
    void refresh().catch(() => {});
    expect(open).toHaveBeenCalledTimes(3);
  });
});
