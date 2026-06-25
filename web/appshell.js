/**
 * appshell.js — shared PWA shell helpers for the Gabriel app.
 *
 *  1. Live version stamp (GET /api/version) in the footer — correct even when
 *     the installed shell is cached/stale.
 *  2. Pull-to-refresh PILL — a faithful port of the spesen app's gesture
 *     (spesen-app/cloudflare/pages/js/app.js, ptr-redesign 06.06.2026): pull
 *     from the very top of the scroller, HOLD ~3s while a ring fills → full
 *     location.reload(). Releasing early cancels → normal scroll. The 3s hold
 *     (not distance/release) is the gate, so casual scroll-bounce never reloads.
 *     Same 30px navy pill, top-right, white progress ring.
 *
 *  Difference from spesen: spesen scrolls a single #screen element; Gabriel
 *  scrolls the document (chess dashboard, WM "Spiele"). So the gesture binds to
 *  the document's root scroller, and `nearestScroller` gates it so a nested
 *  scroller — the WM highlights swipe-feed — never arms it (it owns its swipe).
 *
 *  Bump APP_BUILT in lockstep with package.json + wrangler [vars] APP_VERSION.
 */

"use strict";

(function () {
  var APP_BUILT = "1.10.1"; // version of THIS shipped asset

  // ── 1. Version stamp ─────────────────────────────────────────────────────
  function showVersion() {
    var el = document.getElementById("appVer");
    fetch("/api/version", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var live = (d && d.version) || "?";
        if (!el) return;
        el.textContent = live !== "?" && live !== APP_BUILT ? "v" + APP_BUILT + " → v" + live : "v" + live;
      })
      .catch(function () { if (el) el.textContent = "v" + APP_BUILT; });
  }

  // ── 2. Pull-to-refresh pill (ported from spesen) ─────────────────────────
  var THRESHOLD = 140;   // px pull that confirms intent
  var HOLD_MS = 3000;    // sustained hold before reload
  var RING_R = 11;
  var RING_C = 2 * Math.PI * RING_R;

  function rootScroller() {
    return document.scrollingElement || document.documentElement;
  }

  // Nearest vertical-scrollable ancestor of `node`, falling back to the document
  // root scroller. A nested scroller (the WM .wm-feed) returns itself → the
  // pull-to-refresh only arms when the finger is on the document itself.
  function nearestScroller(node) {
    var el = node instanceof Element ? node : null;
    while (el && el !== document.body && el !== document.documentElement) {
      var oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return rootScroller();
  }

  function svg(name, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, String(attrs[k]));
    return node;
  }

  function attachPullToRefresh() {
    var ring = svg("circle", {
      cx: "15", cy: "15", r: RING_R,
      fill: "none", stroke: "#fff", "stroke-width": "2.5", "stroke-linecap": "round",
      "stroke-dasharray": RING_C, "stroke-dashoffset": RING_C,
      transform: "rotate(-90 15 15)",
    });
    var ringSvg = svg("svg", { width: "30", height: "30", viewBox: "0 0 30 30" });
    ringSvg.appendChild(svg("circle", {
      cx: "15", cy: "15", r: RING_R, fill: "none",
      stroke: "rgba(255,255,255,.3)", "stroke-width": "2.5",
    }));
    ringSvg.appendChild(ring);

    var pill = document.createElement("div");
    pill.setAttribute("aria-hidden", "true");
    var s = pill.style;
    s.position = "fixed";
    s.top = "calc(env(safe-area-inset-top, 0px) + 10px)";
    s.right = "12px"; s.left = "auto";
    s.width = "30px"; s.height = "30px";
    s.display = "flex"; s.alignItems = "center"; s.justifyContent = "center";
    s.transform = "translateY(-150%)";
    s.transition = "transform .15s ease, opacity .15s ease";
    s.opacity = "0";
    // Pill colour adapts to the page (CSS var --ptr-bg); spesen navy as fallback.
    s.background = (getComputedStyle(document.body).getPropertyValue("--ptr-bg") || "").trim() || "#0e2438";
    s.borderRadius = "999px";
    s.boxShadow = "0 2px 10px rgba(14,36,56,.25)";
    s.zIndex = "999"; s.pointerEvents = "none";
    pill.appendChild(ringSvg);
    document.body.appendChild(pill);

    var typing = function () {
      var a = document.activeElement;
      return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
    };

    var pulling = false, startY = 0, dy = 0, activeScroller = null;
    var armTimer = null, armRaf = null, armStart = 0;

    var setRing = function (frac) {
      ring.setAttribute("stroke-dashoffset", String(RING_C * (1 - Math.max(0, Math.min(1, frac)))));
    };
    var showPill = function () { pill.style.opacity = "1"; pill.style.transform = "translateY(0)"; };
    var hidePill = function () { pill.style.opacity = "0"; pill.style.transform = "translateY(-150%)"; };
    var clearArm = function () {
      if (armTimer != null) { clearTimeout(armTimer); armTimer = null; }
      if (armRaf != null) { cancelAnimationFrame(armRaf); armRaf = null; }
      setRing(0);
    };
    var startArming = function () {
      if (armTimer != null) return;
      armStart = Date.now();
      armTimer = setTimeout(function () { location.reload(); }, HOLD_MS);
      var tick = function () {
        setRing((Date.now() - armStart) / HOLD_MS);
        if (armTimer != null) armRaf = requestAnimationFrame(tick);
      };
      armRaf = requestAnimationFrame(tick);
    };
    var reset = function () { pulling = false; dy = 0; clearArm(); hidePill(); };

    document.addEventListener("touchstart", function (e) {
      // Arm at the top of WHICHEVER scroller the finger is on — the document
      // (chess, WM "Spiele") or the WM highlights feed at its first clip. The 3s
      // hold gate stops a casual swipe from ever reloading.
      var sc = nearestScroller(e.target);
      if (typing() || sc.scrollTop > 0) { pulling = false; return; }
      activeScroller = sc;
      startY = e.touches[0].clientY; dy = 0; pulling = true;
    }, { passive: true });

    document.addEventListener("touchmove", function (e) {
      if (!pulling) return;
      dy = e.touches[0].clientY - startY;
      if ((activeScroller && activeScroller.scrollTop > 0) || dy < THRESHOLD) {
        if (armTimer != null) clearArm();
        if (dy <= 0) hidePill(); else showPill();
        return;
      }
      showPill();
      startArming();
    }, { passive: true });

    document.addEventListener("touchend", function () { reset(); }, { passive: true });
    document.addEventListener("touchcancel", function () { reset(); }, { passive: true });
  }

  // Evict a stale/old service worker automatically. appshell.js itself is never
  // SW-cached (not under /wm/ or /vendor/), so this fresh code always runs even
  // when a bad SW is controlling the page: force an update, and when the new
  // (network-first) worker takes control, reload ONCE so fresh modules load.
  function swRecover() {
    if (!("serviceWorker" in navigator)) return;
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update(); }).catch(function () {});
    if (!hadController) return; // first visit / no SW yet → nothing to evict
    var reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (reloaded) return;
      reloaded = true;
      // Persist the active WM sub-tab across the recovery reload so the user
      // isn't bounced back to Highlights mid-load. app.js reads + clears this
      // key on boot. sessionStorage so it never leaks past this tab/session.
      try {
        var tab = document.body && document.body.dataset ? document.body.dataset.tab : null;
        if (tab) sessionStorage.setItem("wm.tab", tab);
      } catch (_e) {/* storage may be unavailable; non-fatal */}
      location.reload();
    });

    // Fallback: if a controller is present but the running build != live build
    // and no controllerchange fired (e.g. a same-bytes deploy), force one reload
    // to pull the fresh nav doc + module graph. One-shot via sessionStorage.
    fetch("/api/version", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var live = d && d.version;
        if (!live || live === APP_BUILT) return;
        if (!navigator.serviceWorker.controller) return;
        if (sessionStorage.getItem("wm.recovered") === live) return;
        sessionStorage.setItem("wm.recovered", live);
        location.reload();
      })
      .catch(function () {});
  }

  // ── 3. Add-to-home-screen nudge (v1.9.10) ────────────────────────────────
  // beforeinstallprompt: Chrome/Edge/Android Chromium fires when the app meets
  // installability criteria. iOS Safari has no event — detect heuristically
  // and show a static "Teilen → Zum Home-Bildschirm" hint instead.
  var INSTALL_LS_KEY = "wm.install.dismissed";
  var INSTALL_SUPPRESS_DAYS = 7;
  var deferredInstallPrompt = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
      || window.navigator.standalone === true;
  }

  function isIOSSafari() {
    var ua = navigator.userAgent;
    if (!/iPad|iPhone|iPod/.test(ua) || window.MSStream) return false;
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  }

  function installRecentlyDismissed() {
    try {
      var ts = parseInt(localStorage.getItem(INSTALL_LS_KEY) || "0", 10);
      if (!ts) return false;
      return (Date.now() - ts) < INSTALL_SUPPRESS_DAYS * 86400 * 1000;
    } catch (_e) { return false; }
  }

  function markInstallDismissed() {
    try { localStorage.setItem(INSTALL_LS_KEY, String(Date.now())); } catch (_e) {}
  }

  function hideInstallBanner() {
    var el = document.getElementById("wmInstallBanner");
    if (!el) return;
    el.classList.add("is-hiding");
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }

  // Builds + shows the banner. `forceShow` skips the recently-dismissed gate so
  // the Einstellungen "Anleitung anzeigen" button can always re-trigger it.
  function showInstallBanner(forceShow) {
    if (isStandalone()) return;
    if (!forceShow && installRecentlyDismissed()) return;
    var existing = document.getElementById("wmInstallBanner");
    if (existing) existing.parentNode.removeChild(existing);

    var banner = document.createElement("div");
    banner.id = "wmInstallBanner";
    banner.className = "wm-install-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "App installieren");

    var hasNativePrompt = !!deferredInstallPrompt;
    var ios = isIOSSafari();
    // iOS-style Share icon — square with arrow rising from the top. Inline SVG
    // so it renders identically on every platform (emoji shifted from
    // platform to platform; an SVG matches Apple's actual button glyph).
    var SHARE_SVG =
      '<svg class="wm-ios-icon" viewBox="0 0 16 18" width="14" height="16" aria-hidden="true">' +
        '<path d="M8 1.5v9.5M8 1.5L5 4.5M8 1.5L11 4.5" ' +
          'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<rect x="2.5" y="7.25" width="11" height="9" rx="2" ' +
          'fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '</svg>';
    // Banner leading-icon: small iPhone silhouette for iOS variant (matches
    // the "Auf den Startbildschirm" mental model), download-arrow glyph for
    // Chrome variant ("Installieren" CTA).
    var IPHONE_SVG =
      '<svg class="wm-iphone-icon" viewBox="0 0 18 28" width="22" height="34" aria-hidden="true">' +
        '<rect x="1.5" y="1.5" width="15" height="25" rx="3" ' +
          'fill="none" stroke="currentColor" stroke-width="1.6"/>' +
        '<line x1="7" y1="23.2" x2="11" y2="23.2" ' +
          'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '</svg>';
    var DOWNLOAD_SVG =
      '<svg class="wm-download-icon" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
        '<path d="M12 3v12M12 15l-4-4M12 15l4-4" ' +
          'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" ' +
          'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    var iconHtml = '<div class="wm-install-icon" aria-hidden="true">' + (ios ? IPHONE_SVG : DOWNLOAD_SVG) + '</div>';
    var dismissHtml = '<button class="wm-install-dismiss" type="button" aria-label="Schließen">✕</button>';
    var bodyHtml;
    if (hasNativePrompt) {
      bodyHtml =
        '<div class="wm-install-text">' +
          '<strong>WM 2026 installieren</strong>' +
          '<span>Eigenes Icon auf dem Startbildschirm — startet schneller, läuft auch offline.</span>' +
        '</div>' +
        '<button class="wm-install-go" type="button">Installieren</button>';
    } else if (ios) {
      bodyHtml =
        '<div class="wm-install-text">' +
          '<strong>Auf den Startbildschirm</strong>' +
          '<span>Tippe unten auf <b>Teilen</b> ' + SHARE_SVG + ' → <b>Zum Home-Bildschirm</b>.</span>' +
        '</div>';
    } else {
      bodyHtml =
        '<div class="wm-install-text">' +
          '<strong>App installieren</strong>' +
          '<span>Im Browser-Menü: «App installieren» / «Zum Dock hinzufügen».</span>' +
        '</div>';
    }
    banner.innerHTML = iconHtml + bodyHtml + dismissHtml;
    document.body.appendChild(banner);

    var goBtn = banner.querySelector(".wm-install-go");
    if (goBtn) {
      goBtn.addEventListener("click", function () {
        if (!deferredInstallPrompt) { hideInstallBanner(); return; }
        try {
          deferredInstallPrompt.prompt();
          var p = deferredInstallPrompt.userChoice;
          if (p && typeof p.then === "function") {
            p.then(function () { deferredInstallPrompt = null; hideInstallBanner(); });
          } else {
            deferredInstallPrompt = null;
            hideInstallBanner();
          }
        } catch (_e) {
          deferredInstallPrompt = null;
          hideInstallBanner();
        }
      });
    }
    banner.querySelector(".wm-install-dismiss").addEventListener("click", function () {
      markInstallDismissed();
      hideInstallBanner();
    });
  }

  function attachInstallNudge() {
    if (isStandalone()) return;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredInstallPrompt = e;
      showInstallBanner(false);
    });
    window.addEventListener("appinstalled", function () {
      deferredInstallPrompt = null;
      markInstallDismissed();
      hideInstallBanner();
    });
    // iOS Safari has no event — auto-show after a beat so the page paints first.
    if (isIOSSafari() && !installRecentlyDismissed()) {
      setTimeout(function () { showInstallBanner(false); }, 1500);
    }
  }

  // Expose a manual trigger for the Einstellungen "Anleitung anzeigen" button.
  window.wmShowInstallPrompt = function () { showInstallBanner(true); };
  window.wmInstallStatus = function () {
    if (isStandalone()) return "installed";
    if (deferredInstallPrompt) return "installable";
    if (isIOSSafari()) return "ios-instructions";
    return "unsupported";
  };

  // ── 4. Pull-to-refresh nudge (v1.9.13) ───────────────────────────────────
  // First-time visitors don't know the 3-second hold-at-top gesture exists.
  // Show a one-shot bouncing pill near the top after the page settles, then
  // fade it after a few seconds. Only fires in standalone PWA mode — in a
  // browser tab the user already has a native reload button.
  var PTR_HINT_KEY = "wm.ptr.hint.shown";
  function attachUpdateNudge() {
    if (!isStandalone()) return;
    try { if (localStorage.getItem(PTR_HINT_KEY)) return; } catch (_e) { return; }
    setTimeout(function () {
      if (document.getElementById("wmPtrHint")) return;
      var hint = document.createElement("div");
      hint.id = "wmPtrHint";
      hint.className = "wm-ptr-hint";
      hint.setAttribute("role", "status");
      hint.innerHTML = '<span class="wm-ptr-arrow" aria-hidden="true">↓</span><span>Ziehen + halten zum Aktualisieren</span>';
      document.body.appendChild(hint);
      try { localStorage.setItem(PTR_HINT_KEY, String(Date.now())); } catch (_e) {}
      // Tap dismisses early.
      hint.addEventListener("click", function () { hideHint(); });
      function hideHint() {
        hint.classList.add("is-hiding");
        setTimeout(function () { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 400);
      }
      setTimeout(hideHint, 7000);
    }, 3500);
  }

  function init() {
    swRecover();
    showVersion();
    attachPullToRefresh();
    attachInstallNudge();
    attachUpdateNudge();
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
