(function () {
  const script = document.createElement('script');
  script.src = (typeof browser !== 'undefined' ? browser : chrome).runtime.getURL(
    'content-scripts/api-interceptor.js',
  );
  document.documentElement.appendChild(script);
  script.onload = function () {
    script.remove();
  };
})();
