/*
 * webshark live update shim
 *
 * Watches the currently opened capture file (via the backend /webshark/watch
 * SSE endpoint) and, when the file grows, fetches ONLY the new frames
 * (method=frames&skip=N) and appends them to the packet list and the packet
 * length chart -- no page reload needed.
 *
 * The web/ folder ships a prebuilt Angular bundle, so instead of rebuilding
 * it, two one-line hooks are injected into the minified main.*.js bundle:
 *
 *   getBufferGate(e){window.__wsLive&&window.__wsLive.svc(this); ...
 *   initData(){var e=this;window.__wsLive&&window.__wsLive.comp(this); ...
 *
 * They hand this shim the live instances of the app's WebSharkDataService
 * and of the packet list component the first time they are used. This file
 * must be loaded as a classic script BEFORE the bundle (see index.html).
 */
(function () {
  'use strict';

  var REFRESH_DEBOUNCE_MS = 400;
  var FALLBACK_POLL_MS = 5000;

  var svc = null;             // WebSharkDataService instance
  var comp = null;            // packet list component instance
  var es = null;              // EventSource
  var pollTimer = null;       // fallback when EventSource is unavailable
  var watchedCapture = null;
  var lastSize = -1;
  var refreshTimer = null;
  var refreshing = false;
  var pendingRefresh = false;
  var pendingFull = false;

  function log() {
    try {
      console.debug.apply(console, ['[webshark-live]'].concat([].slice.call(arguments)));
    } catch (e) { /* ignore */ }
  }

  // Called from the hooks injected into the main bundle.
  window.__wsLive = {
    svc: function (inst) {
      if (svc !== inst) { svc = inst; onReady(); }
    },
    comp: function (inst) {
      if (comp !== inst) { comp = inst; onReady(); }
    }
  };

  function onReady() {
    if (svc && comp) { ensureWatch(); }
  }

  window.addEventListener('hashchange', function () {
    // capture file switched (setCaptureFile updates location.hash)
    ensureWatch();
  });

  /* ---------- watching the capture file ---------- */

  function currentCapture() {
    if (svc && typeof svc.getCapture === 'function') {
      var c = svc.getCapture();
      if (c) { return c; }
    }
    if (location.hash.length > 1) {
      try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { /* ignore */ }
    }
    return null;
  }

  function ensureWatch() {
    var capture = currentCapture();
    if (!capture) { stopWatch(); return; }
    if (capture === watchedCapture && (es || pollTimer)) { return; }
    stopWatch();
    watchedCapture = capture;
    lastSize = -1;

    if (typeof EventSource === 'undefined') {
      pollTimer = setInterval(function () { scheduleRefresh(false); }, FALLBACK_POLL_MS);
      log('EventSource unavailable, polling', capture);
      return;
    }

    es = new EventSource('/webshark/watch?capture=' + encodeURIComponent(capture));
    es.addEventListener('capture-status', onSizeEvent);
    es.addEventListener('capture-changed', onSizeEvent);
    log('watching', capture);
  }

  function stopWatch() {
    if (es) { try { es.close(); } catch (e) { /* ignore */ } es = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    watchedCapture = null;
    lastSize = -1;
  }

  function onSizeEvent(ev) {
    var size = -1;
    try { size = JSON.parse(ev.data).size; } catch (e) { /* ignore */ }
    var first = lastSize < 0;
    var shrank = !first && size >= 0 && size < lastSize;
    lastSize = size;
    if (first) { return; } // initial status; the app already loaded this state
    // A shrinking file means it was replaced/truncated: reload everything.
    scheduleRefresh(shrank);
  }

  function scheduleRefresh(full) {
    pendingFull = pendingFull || !!full;
    if (refreshTimer) { return; }
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      var doFull = pendingFull;
      pendingFull = false;
      refresh(doFull);
    }, REFRESH_DEBOUNCE_MS);
  }

  /* ---------- fetching and applying new frames ---------- */

  function refresh(full) {
    if (!svc || !comp) { return; }
    var capture = currentCapture();
    if (!capture) { return; }
    if (capture !== watchedCapture) { ensureWatch(); return; }
    if (refreshing) { pendingRefresh = true; pendingFull = pendingFull || full; return; }
    refreshing = true;

    // Same URL the app itself uses for getFrames(0) (includes display filter),
    // so we share its response cache entry and keep it consistent.
    var baseUrl = svc.url + '?' + svc.params('frames', {});

    getCachedFrames(baseUrl).then(function (cached) {
      var dest = comp.destDetailsTable || [];
      var skip = full ? 0 : (cached ? cached.length : dest.length);
      // sharkd rejects skip=0, so omit it when fetching everything
      return fetch(skip > 0 ? baseUrl + '&skip=' + skip : baseUrl)
        .then(function (r) { return r.json(); })
        .then(function (frames) {
          if (!Array.isArray(frames)) { return; }
          if (full) {
            applyFull(cached, frames);
          } else if (frames.length) {
            applyAppend(cached, frames);
          }
        });
    }).catch(function (e) {
      log('refresh failed', e);
    }).then(function () {
      refreshing = false;
      if (pendingRefresh) {
        pendingRefresh = false;
        scheduleRefresh(false);
      }
    });
  }

  // Returns the app's cached raw frames array (by reference) for the URL, so
  // we can extend it in place and keep the in-app cache consistent.
  function getCachedFrames(url) {
    return new Promise(function (resolve) {
      var settled = false;
      var done = function (v) { if (!settled) { settled = true; resolve(v); } };
      try {
        svc.getBufferGate(url).subscribe({
          next: function (v) { done(Array.isArray(v) ? v : null); },
          error: function () { done(null); }
        });
      } catch (e) {
        done(null);
      }
    });
  }

  // Mirror of the row mapping in the app's initData()
  function toRow(frame) {
    var c = frame.c || [];
    return {
      id: c[0], time: c[1], source: c[2], description: c[3],
      protocol: c[4], length: c[5], info: c[6],
      bg: frame.bg, fg: frame.fg
    };
  }

  function applyAppend(cached, frames) {
    var dest = comp.destDetailsTable || [];
    // Guard against overlap: only keep frames newer than the last shown one.
    var lastId = dest.length ? +dest[dest.length - 1].id : 0;
    frames = frames.filter(function (f) { return f.c && +f.c[0] > lastId; });
    if (!frames.length) { return; }

    if (cached) { Array.prototype.push.apply(cached, frames); }

    var sameRef = comp.detailsTable === comp.destDetailsTable;
    comp.destDetailsTable = dest.concat(frames.map(toRow));
    if (sameRef) {
      // no chart range selection active: keep the table showing everything
      comp.detailsTable = comp.destDetailsTable;
    }
    updateView(frames.length + ' new frame(s)');
  }

  function applyFull(cached, frames) {
    if (cached) {
      cached.length = 0;
      Array.prototype.push.apply(cached, frames);
    }
    comp.destDetailsTable = frames.map(toRow);
    comp.detailsTable = comp.destDetailsTable;
    updateView('capture replaced, reloaded ' + frames.length + ' frame(s)');
  }

  function updateView(msg) {
    try {
      // refresh the packet length chart (same payload initData emits)
      comp.ready.emit([{
        color: 'rgba(255,255,255, 0.8)',
        data: comp.destDetailsTable.map(function (r) { return 1 * r.length; })
      }]);
    } catch (e) { /* ignore */ }
    try { comp.cdr.detectChanges(); } catch (e) { /* ignore */ }
    log(msg, '- total', comp.destDetailsTable.length);
  }
})();
