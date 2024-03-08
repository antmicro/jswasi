const CACHE_NAME = "wash-cache";
const urlsToCache = [
  "./md5.js",
  "./browser-apps.js",
  "./devices.js",
  "./third_party/hterm_all.js",
  "./third_party/vfs.js",
  "./third_party/enable_threads.js",
  "./third_party/idb-keyval.js",
  "./types.js",
  "./enable_threads.js",
  "./jswasi.js",
  "./process-manager.js",
  "./syscalls.js",
  "./filesystem/proc-filesystem/proc-tree.js",
  "./filesystem/proc-filesystem/proc-filesystem.js",
  "./filesystem/proc-filesystem/proc-descriptors.js",
  "./filesystem/top-level-fs.js",
  "./filesystem/filesystem.js",
  "./filesystem/fsa-filesystem/fsa-descriptors.js",
  "./filesystem/fsa-filesystem/fsa-filesystem.js",
  "./filesystem/fsa-filesystem/metadata.js",
  "./filesystem/fsa-filesystem/utils.js",
  "./filesystem/virtual-filesystem/wget-device.js",
  "./filesystem/virtual-filesystem/device-filesystem.js",
  "./filesystem/virtual-filesystem/driver-manager.js",
  "./filesystem/virtual-filesystem/virtual-filesystem.js",
  "./filesystem/virtual-filesystem/mem-devices.js",
  "./filesystem/virtual-filesystem/terminals/termios.js",
  "./filesystem/virtual-filesystem/terminals/terminal.js",
  "./filesystem/virtual-filesystem/terminals/hterm-terminal.js",
  "./constants.js",
  "./utils.js",
  "./service-worker.js",
];

self.addEventListener("install", async () => {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(urlsToCache);
});

async function handleFetch(request: Request): Promise<Response> {
  return caches.match(request).then(async (response: Response) => {
    if (response === undefined) {
      if(request.mode === "no-cors") {
        request = new Request(request.url, {
          cache: request.cache,
          credentials: "omit",
          headers: request.headers,
          integrity: request.integrity,
          // @ts-ignore
          destination: request.destination,
          keepalive: request.keepalive,
          method: request.method,
          mode: request.mode,
          redirect: request.redirect,
          referrer: request.referrer,
          referrerPolicy: request.referrerPolicy,
          signal: request.signal,
        });
      }

      response = await fetch(request);
    }

    if (response.status === 0)
      return response;

    const headers = new Headers(response.headers);
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");

    return new Response(
      response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
  });
}

self.addEventListener("fetch", (event: Event) => {
  const fetchEvent = event as FetchEvent;
  const request = fetchEvent.request;
  fetchEvent.respondWith(handleFetch(request));
});
