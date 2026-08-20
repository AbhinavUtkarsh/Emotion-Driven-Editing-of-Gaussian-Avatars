(function () {
  var KEY = 'emoga-theme';

  function readStored() {
    try {
      return window.localStorage.getItem(KEY);
    } catch (e) {
      return null;     }
  }

  function store(value) {
    try {
      window.localStorage.setItem(KEY, value);
    } catch (e) {
          }
  }

  function apply(isLight) {
    document.body.classList.toggle('light-mode', isLight);

    var icon = document.getElementById('mode-icon');
    if (!icon) return;

        var replacement = document.createElement('i');
    replacement.id = 'mode-icon';
    replacement.setAttribute('class', isLight ? 'fas fa-moon' : 'fas fa-sun');
    icon.parentNode.replaceChild(replacement, icon);
  }

  document.addEventListener('DOMContentLoaded', function () {
    apply(readStored() === 'light');

    var toggleBtn = document.getElementById('mode-toggle');
    if (!toggleBtn) return;

    var isCooldown = false;
    toggleBtn.addEventListener('click', function () {
      if (isCooldown) return;
      isCooldown = true;
      toggleBtn.classList.add('pressed');
      setTimeout(function () {
        var nowLight = !document.body.classList.contains('light-mode');
        apply(nowLight);
        store(nowLight ? 'light' : 'dark');
        toggleBtn.classList.remove('pressed');
        setTimeout(function () {
          isCooldown = false;
        }, 300);
      }, 300);
    });
  });
})();
