const CACHE = "films-shell-v10";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest", "./icons/films-option-1.svg", "./icons/films-option-1-192.png", "./icons/films-option-1-512.png"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const refreshOnVisit = ["/", "/index.html", "/app.js", "/style.css", "/manifest.webmanifest"]
    .some(path => url.pathname.endsWith(path));
  if (refreshOnVisit) {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match(event.request)));
  } else {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
      return response;
    })));
  }
});
