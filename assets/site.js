// Small, dependency-free helpers: copy-to-clipboard for the install line,
// and a <dialog> lightbox for gallery figures. The site works without JS.
(function () {
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var text = button.getAttribute("data-copy");
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(function () {
        button.dataset.done = "1";
        button.textContent = "copied";
        setTimeout(function () { button.dataset.done = ""; button.textContent = "copy"; }, 1600);
      });
    });
  });

  var dialog = document.querySelector("dialog.lightbox");
  if (!dialog || typeof dialog.showModal !== "function") return;
  var image = dialog.querySelector("img");
  var caption = dialog.querySelector("p");
  document.querySelectorAll(".gallery button, .doc figure button").forEach(function (button) {
    button.addEventListener("click", function () {
      var thumb = button.querySelector("img");
      image.src = thumb.getAttribute("data-full") || thumb.src;
      image.alt = thumb.alt;
      caption.textContent = thumb.alt;
      dialog.showModal();
    });
  });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) dialog.close();
  });
})();
