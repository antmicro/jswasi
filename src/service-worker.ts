const CACHE_NAME = "wash-cache";
const urlsToCache = ["process.js"];

self.addEventListener("install", async () => {
  // Perform install steps
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(urlsToCache);
});

self.addEventListener("fetch", (event: FetchEvent) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Cache hit - return response
      if (response) {
        console.log("Returning cached response!");
        return response;
      }
      return fetch(event.request);
    })
  );
});
