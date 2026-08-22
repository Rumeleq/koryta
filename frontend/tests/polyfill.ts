import { TextEncoder, TextDecoder } from "node:util";
Object.assign(globalThis, { TextDecoder, TextEncoder });
if (typeof window !== "undefined") {
  Object.assign(window, { TextDecoder, TextEncoder });
}
if (typeof global !== "undefined") {
  Object.assign(global, { TextDecoder, TextEncoder });
}

// Vuetify's overlay positioning (v-snackbar, v-menu, v-dialog) reads the bare
// `visualViewport` global. happy-dom does not define it at all, so the read is
// a ReferenceError thrown inside a watcher - which surfaces as an unhandled
// rejection that fails the run rather than as a failing assertion. Vuetify
// already handles the property being absent (`if (!visualViewport)`), it just
// needs the binding to exist.
if (!("visualViewport" in globalThis)) {
  Object.defineProperty(globalThis, "visualViewport", {
    value: undefined,
    writable: true,
    configurable: true,
  });
}
