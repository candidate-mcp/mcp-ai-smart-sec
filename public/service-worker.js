//THIS FILE NEEDS TO OVERWRITE THE EXISTING ONE IN CLOUD RUN'S SOURCE CODE IN ORDER FOR iOS DEVICES TO WORK
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// service-workers.js

// This service worker intercepts requests to the Google Generative AI API 
// and proxies them through the application's backend to avoid CORS issues
// and keep the API key secure. It includes a fix for browsers that do not
// support ReadableStream in request bodies (e.g., Safari on iOS).

const TARGET_URL_PREFIX = 'https://generativelanguage.googleapis.com';

// The install event is fired when the service worker is first installed.
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  // self.skipWaiting() forces the waiting service worker to become the
  // active service worker.
  event.waitUntil(self.skipWaiting());
});

// The activate event is fired when the service worker is activated.
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  // self.clients.claim() allows an active service worker to take control
  // of all clients (pages) that are in its scope.
  event.waitUntil(self.clients.claim());
});

// The fetch event is fired for every network request made by the page.
self.addEventListener('fetch', (event) => {
  try {
    const requestUrl = event.request.url;

    // Check if the request is for the target API.
    if (requestUrl.startsWith(TARGET_URL_PREFIX)) {
      // We use an async IIFE passed to event.respondWith to handle the
      // asynchronous nature of fetching and body buffering.
      event.respondWith((async () => {
        try {
          console.log(`Service Worker: Intercepting request to ${requestUrl}`);
          
          // Construct the proxy URL.
          const remainingPathAndQuery = requestUrl.substring(TARGET_URL_PREFIX.length);
          const proxyUrl = `${self.location.origin}/api/proxy${remainingPathAndQuery}`;
          console.log(`Service Worker: Proxying to ${proxyUrl}`);

          const newHeaders = new Headers();
          // Copy essential headers from the original request to the new one.
          const headersToCopy = [
            'Content-Type',
            'Accept',
            'Access-Control-Request-Method',
            'Access-Control-Request-Headers',
          ];

          for (const headerName of headersToCopy) {
            if (event.request.headers.has(headerName)) {
              newHeaders.set(headerName, event.request.headers.get(headerName));
            }
          }
          
          if (event.request.method === 'POST' && !newHeaders.has('Content-Type')) {
              console.warn("Service Worker: POST request was missing Content-Type. Defaulting to application/json.");
              newHeaders.set('Content-Type', 'application/json');
          }

          // WORKAROUND for Safari/iOS: Buffer the request body.
          // Some browsers do not support ReadableStream as a request body.
          // To fix this, we read the stream into an ArrayBuffer before fetching.
          let body = null;
          if (event.request.method !== 'GET' && event.request.method !== 'HEAD' && event.request.body) {
              try {
                  // .clone() is essential because the request body can only be read once.
                  body = await event.request.clone().arrayBuffer();
              } catch (e) {
                  console.error("Service Worker: Could not read request body.", e);
              }
          }

          const requestOptions = {
            method: event.request.method,
            headers: newHeaders,
            body: body, // Use the buffered ArrayBuffer.
          };
          
          const proxyRequest = new Request(proxyUrl, requestOptions);
          const response = await fetch(proxyRequest);
          
          console.log(`Service Worker: Successfully proxied request to ${proxyUrl}, Status: ${response.status}`);
          return response;

        } catch (error) {
          console.error(`Service Worker: Error proxying request to ${requestUrl}.`, error);
          // If the proxy fails, return a user-friendly error response.
          return new Response(
            JSON.stringify({
              error: 'Proxying failed',
              details: error.message,
              name: error.name
            }), {
              status: 502, // Bad Gateway
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
      })());
    } else {
      // For all other requests that don't match the target URL,
      // let them pass through to the network as normal.
      event.respondWith(fetch(event.request));
    }
  } catch (error) {
    // Log more error details for unhandled errors too
    console.error('Service Worker: Unhandled error in fetch event handler. Message:', error.message, 'Name:', error.name, 'Stack:', error.stack);
    event.respondWith(
      new Response(
        JSON.stringify({ error: 'Service worker fetch handler failed', details: error.message, name: error.name }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );
  }
});
