(function () {
  'use strict';

  var EXIT_MS = 460; 
  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function enter() {
    document.body.classList.remove('page-exit');
    document.body.classList.add('page-enter');
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

  document.addEventListener('DOMContentLoaded', function () {
    enter();

    if (prefersReducedMotion()) return;

    document.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('a[href]');
      if (!link || !shouldIntercept(link, event)) return;

      event.preventDefault();
      document.body.classList.remove('page-enter');
      document.body.classList.add('page-exit');

      var destination = link.href;
      window.setTimeout(function () {
        window.location.href = destination;
      }, EXIT_MS);
    });
  });

    window.addEventListener('pageshow', function (event) {
    if (event.persisted) enter();
  });
})();
