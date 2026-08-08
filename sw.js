"use strict";

// 이 파일이나 앱 셸 파일(index.html, app.js, manifest, 아이콘)을 하나라도 고치면
// 아래 CACHE_VERSION을 반드시 올릴 것. 안 올리면 사용자 폰에 옛날 화면이 계속 남는다.
const CACHE_VERSION = "v8";
const CACHE_NAME = "mbn-shell-" + CACHE_VERSION;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // API 응답은 캐시하지 않는다

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
