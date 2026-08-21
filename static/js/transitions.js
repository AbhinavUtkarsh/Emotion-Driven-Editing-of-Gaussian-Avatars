(function () {
  'use strict';

  var EXIT_MS = 200; 
    function pauseVideos() {
    var videos = document.getElementsByTagName('video');
    for (var i = 0; i < videos.length; i++) {
      try {
        videos[i].pause();
      } catch (e) {
              }
    }
  }

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

    function getVeil() {
    var veil = document.getElementById('page-veil');
    if (veil) return veil;
    veil = document.createElement('div');
    veil.className = 'page-veil';
    veil.id = 'page-veil';
    veil.setAttribute('aria-hidden', 'true');
    document.body.appendChild(veil);
    return veil;
  }

    function revealWhenReady(veil) {
    var done = false;

    function reveal() {
      if (done) return;
      done = true;
      veil.classList.add('is-ready');
    }

    function afterFonts() {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(reveal, reveal);
      } else {
        reveal();
      }
    }

    if (document.readyState === 'complete') {
      afterFonts();
    } else {
      window.addEventListener('load', afterFonts);
    }

        window.setTimeout(reveal, 2500);
  }

    function shouldIntercept(link, event) {
    if (event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (link.target && link.target !== '_self') return false;
    if (link.hasAttribute('download')) return false;

    var href = link.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return false;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;

    var url;
    try {
      url = new URL(link.href, window.location.href);
    } catch (e) {
      return false;
    }
    if (url.origin !== window.location.origin) return false;

        if (url.pathname === window.location.pathname && url.hash) return false;

    return true;
  }

    function arrivedFromThisSite() {
    if (!document.referrer) return false;
    try {
      var from = new URL(document.referrer);
      return (
        from.origin === window.location.origin &&
        from.pathname !== window.location.pathname
      );
    } catch (e) {
      return false;
    }
  }

    function initBackButton(veil) {
    var back = document.querySelector('.back-button');
    if (!back || !arrivedFromThisSite()) return;

    back.addEventListener('click', function (event) {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      event.preventDefault();

      if (prefersReducedMotion()) {
        window.history.back();
        return;
      }

      pauseVideos();
      veil.classList.add('is-leaving');
      window.setTimeout(function () {
        window.history.back();
      }, EXIT_MS);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var veil = getVeil();
    revealWhenReady(veil);
    initBackButton(veil);

    if (prefersReducedMotion()) return;

    document.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('a[href]');
      if (!link || !shouldIntercept(link, event)) return;

      event.preventDefault();
      pauseVideos();
      veil.classList.add('is-leaving');

      var destination = link.href;
      window.setTimeout(function () {
        window.location.href = destination;
      }, EXIT_MS);
    });

        window.addEventListener('pageshow', function (event) {
      if (!event.persisted) return;
      veil.classList.remove('is-leaving');
            veil.style.animation = 'none';
      void veil.offsetWidth;
      veil.style.animation = '';
    });
  });
})();
