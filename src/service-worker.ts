const CACHE_NAME = "wash-cache";
const urlsToCache = [
  "resources/favicon.ico",

  "browser-apps.js",
  "constants.js",
  "devices.js",
  "filesystem.js",
  "process-manager.js",
  "process.js",
  "service-worker.js",
  "syscalls.js",
  "terminal.js",
  "utils.js",

  "hterm_all.js",
  "resources/motd.txt",
  "resources/wash.wasm",

  "https://cdn.jsdelivr.net/npm/safari-14-idb-fix@3.0.0/+esm",
];

self.addEventListener("install", async () => {
  // Perform install steps
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(urlsToCache);
});

self.addEventListener("fetch", (event: Event) => {
  const fetchEvent = event as FetchEvent;
  fetchEvent.respondWith(
    caches.match(fetchEvent.request).then((response) => {
      // Cache hit - return response
      if (response) {
        // TODO: add some logger, this is good info for development, but spam for production
        // console.log("Returning cached response for: ", response);
        return response;
      }
      return fetch(fetchEvent.request);
    })
  );
});
