/** One session handoff at a time, and a pause after one that failed.
 *
 * Getting a token means opening a tab: only a page with the Firebase session
 * can mint one. That is fine when it works, and it is what happens when it does
 * not that this exists for — a dev server restarting refuses every stored token
 * at once, and the extension asks for a new one from six places that do not
 * know about each other. The popup and the panel each ask what is known about
 * the page in front of them, that is two requests apiece, `withToken` asks
 * again after a 401, and the panel asks afresh on every tab switch and
 * navigation. Each call opened its own tab, so what the reader saw was five of
 * them appear at once.
 *
 * Kept apart from background.js because it is the one piece of that file with
 * an interesting state machine and no need for the chrome API — `open` is
 * whatever the caller passes.
 */

/** How long to leave the site alone after it failed to hand a token over.
 *
 * Long enough that the askers nobody set going stop reopening the tab, and
 * short enough to be over by the time someone has finished signing in. A
 * deliberate press of "Połącz z koryta.pl" skips it regardless — that is the
 * person saying they have.
 */
export const REFRESH_COOLDOWN_MS = 60_000;

export function coalesceRefreshes(
  open,
  { cooldownMs = REFRESH_COOLDOWN_MS, now = Date.now } = {},
) {
  let inFlight = null;
  let blockedUntil = 0;

  /** A token, from a handoff that may already be running for somebody else. */
  const refresh = ({ force = false } = {}) => {
    if (inFlight) return inFlight;
    if (!force && now() < blockedUntil) {
      // Named as what the reader can do about it. Every automatic caller turns
      // this into the "connect" prompt, and that button forces.
      return Promise.reject(
        new Error("sesja wygasła — połącz rozszerzenie ponownie"),
      );
    }

    inFlight = open()
      .then((value) => {
        blockedUntil = 0;
        return value;
      })
      .catch((error) => {
        blockedUntil = now() + cooldownMs;
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  /** A token arrived by some other route — someone opened /rozszerzenie
   * themselves, say — so there is nothing left to wait out. */
  refresh.arrived = () => {
    blockedUntil = 0;
  };

  return refresh;
}
