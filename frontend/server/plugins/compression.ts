import { constants, brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);

/** Types where compression buys anything. Everything the app serves in bulk -
 * the SSR html, `_payload.json`, the sitemap - is in here; images, fonts and
 * video are already compressed and only cost cpu to re-do. */
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:json|ld\+json|javascript|xml|xhtml\+xml|rss\+xml|manifest\+json)|image\/svg\+xml)/i;

/** Below this the framing overhead is most of the win and the cpu is wasted.
 * Well under any page this exists for - the smallest is ~450 KB. */
const MIN_BYTES = 1024;

/** Brotli's default is quality 11, which is a text-book choice for a file you
 * compress once at build time and a bad one for a response you compress on
 * every miss: on `/lista`'s 10 MB document it is seconds of a Cloud Run cpu.
 * 4 is the usual dynamic-content setting, within a few percent of 11 on html
 * at a fraction of the time. */
const BROTLI_QUALITY = 4;

/** Neither the Nitro server nor the Envoy in front of it compresses anything,
 * so koryta.pl ships every response raw - 2.2 MB of it on a plain page view,
 * to an audience that is 69% mobile. `compressPublicAssets` in nuxt.config.ts
 * covers what the build emits; this covers what is rendered per request.
 *
 * It hooks `beforeResponse` rather than `render:response` on purpose. The swr
 * route rules cache the *renderer's* output, so compressing there would store
 * one client's encoding in the cache and replay it to everyone - including a
 * client that sent no `Accept-Encoding` at all. `beforeResponse` is the
 * outermost seam, past the cache, and h3 re-reads `response.body` after the
 * hook, so replacing it here is what actually goes out.
 *
 * Handlers that return an object are left alone: h3 serialises those after
 * this hook, so there is no body to compress yet and no content-type to test.
 * That is api routes only, which are small and mostly uncached. */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("beforeResponse", async (event, response) => {
    const body = response.body;
    const isBuffer = Buffer.isBuffer(body);
    if (typeof body !== "string" && !isBuffer) return;

    // Only compress what is going out over a socket. A sub-request made with
    // localFetch/$fetch runs through this same hook, and its caller reads the
    // result back in process - so compressing one hands binary to something
    // expecting text. Nitro's error handler does exactly that: it renders the
    // error page by localFetch-ing /__nuxt_error, takes `await res.text()` of
    // the reply, and copies the reply's headers onto the real response. Every
    // byte of the brotli that is not valid utf-8 became U+FFFD in that
    // `text()`, and `content-encoding: br` rode along on a body that was no
    // longer brotli - so the browser could not decode any 404 or 500, and sat
    // there until it gave up. node-mock-http, which backs those in-process
    // requests, leaves `socket` null on its ServerResponse; a real one always
    // has it by the time a body exists. Skipping when it is absent errs the
    // safe way: the cost of a false positive is a response that goes out
    // uncompressed.
    if (!event.node.res.socket) return;

    // Nitro's static handler serves the build's precompressed `.br`/`.gz`
    // siblings itself; re-encoding those would produce nonsense.
    if (getResponseHeader(event, "content-encoding")) return;

    const type = String(getResponseHeader(event, "content-type") || "");
    if (!COMPRESSIBLE.test(type)) return;

    const raw = isBuffer ? body : Buffer.from(body, "utf8");
    if (raw.byteLength < MIN_BYTES) return;

    const accepted = String(getRequestHeader(event, "accept-encoding") || "");
    const encoding = /\bbr\b/.test(accepted)
      ? "br"
      : /\bgzip\b/.test(accepted)
        ? "gzip"
        : undefined;

    // Whatever the client can take, the CDN has to key the entry on - it sits
    // in front of us and these responses carry an s-maxage.
    appendResponseHeader(event, "Vary", "Accept-Encoding");
    if (!encoding) return;

    let compressed: Buffer;
    try {
      compressed =
        encoding === "br"
          ? await compressBrotli(raw, {
              params: {
                [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
                [constants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
              },
            })
          : await compressGzip(raw);
    } catch (error) {
      // A response that went out uncompressed is a slow success; one that
      // failed to render is not. Never let this be the reason a page 500s.
      event.captureError?.(error as Error, { tags: ["compression"] });
      return;
    }

    setResponseHeader(event, "Content-Encoding", encoding);
    // The stale length is the uncompressed one; h3 sets the right one when it
    // sends the buffer, but only if this is not already sitting on the event.
    removeResponseHeader(event, "Content-Length");
    response.body = compressed;
  });
});
