// OmniFit service worker.
//
// Its only job is the Android "Share to OmniFit" target: when a user shares a
// post or screenshot from Instagram, Pinterest or YouTube, the phone POSTs it
// to /share-target. We park it in a cache and open the Style Library, which
// picks it up (see App.jsx) and saves it once the user is signed in.
// Everything else goes straight to the network; nothing else is cached.

const SHARE_CACHE = "omnifit-share";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(receiveShare(event.request));
  }
});

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const image = form.get("image");
    const cache = await caches.open(SHARE_CACHE);

    await cache.put(
      "/shared/meta",
      new Response(
        JSON.stringify({
          title: form.get("title") || "",
          text: form.get("text") || "",
          url: form.get("url") || "",
          fileName: image && typeof image !== "string" ? image.name : "",
          sharedAt: Date.now(),
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );

    if (image && typeof image !== "string" && image.size) {
      await cache.put("/shared/image", new Response(image, { headers: { "Content-Type": image.type } }));
    } else {
      await cache.delete("/shared/image");
    }
  } catch {
    // Nothing usable was shared; the library opens normally
  }

  return Response.redirect("/#library?shared=1", 303);
}
