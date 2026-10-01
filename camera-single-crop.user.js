// ==UserScript==
// @name         Camera - tự chọn Single Crop và chụp toàn ảnh
// @namespace    local.canat.crop
// @version      1.1
// @description  Bấm camera của Step để tự chọn Single Crop và kéo toàn ảnh
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  let running = false;
  let openingMenu = false;
  let cancelled = false;
  let automaticButton = null;

  function visible(el) {
    return el.isConnected &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== "hidden";
  }

  function cropDialogs() {
    return [...document.querySelectorAll('[role="dialog"]')]
      .filter(dialog =>
        visible(dialog) &&
        dialog.querySelector(".ant-modal-title")
          ?.textContent.includes("Crop Expected Image")
      );
  }

  function notify(message) {
    const box = document.createElement("div");
    box.textContent = message;
    box.style.cssText =
      "position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
      "background:#152538;color:white;padding:10px 14px;" +
      "border:1px solid #5283ae;border-radius:6px;font-size:13px;";
    document.body.append(box);
    setTimeout(() => box.remove(), 4500);
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") cancelled = true;
  }, true);

  // Nhận thao tác Single Crop, bao gồm nút do script tự chọn.
  document.addEventListener("click", event => {
    const button = event.target instanceof Element
      ? event.target.closest("button")
      : null;

    if (!button) return;

    if (button.closest('[role="dialog"]') &&
        (button.matches(".ant-modal-close") ||
         button.textContent.trim() === "Cancel")) {
      cancelled = true;
    }

    if ((!event.isTrusted && button !== automaticButton) ||
        button.disabled ||
        !button.closest(".ant-popover") ||
        !visible(button) ||
        button.textContent.trim() !== "Single Crop") return;

    if (running) return;

    if (cropDialogs().length) {
      notify("Hãy đóng cửa sổ Crop cũ trước khi thử.");
      return;
    }

    running = true;
    cancelled = false;

    // Để web xử lý nút Single Crop và mở đúng Step trước.
    setTimeout(() => {
      runCrop().finally(() => {
        running = false;
      });
    }, 0);
  }, true);

  // Bấm camera → chọn Single Crop trong đúng menu liên kết.
  document.addEventListener("click", async event => {
    const button = event.target instanceof Element
      ? event.target.closest("button")
      : null;

    if (!event.isTrusted || !button || button.disabled ||
        !button.querySelector('[aria-label="camera"]') ||
        !button.classList.contains("ant-btn-icon-only") ||
        button.closest(".ant-popover, [role='dialog']") ||
        openingMenu || running) return;

    if (cropDialogs().length) return;

    openingMenu = true;
    cancelled = false;

    try {
      const deadline = Date.now() + 2000;

      // Chờ thao tác click gốc mở menu.
      await wait(50);

      while (Date.now() < deadline) {
        if (!button.isConnected || cancelled || running) return;

        // ID được đọc lại mỗi lần, không cố định theo Step.
        const ids = (button.getAttribute("aria-describedby") || "")
          .split(/\s+/)
          .filter(Boolean);

        const menus = [...new Set(
          ids
            .map(id => document.getElementById(id))
            .filter(Boolean)
            .map(el => el.closest(".ant-popover"))
            .filter(el => el && visible(el))
        )];

        if (menus.length === 1) {
          const choices = [...menus[0].querySelectorAll("button")]
            .filter(el =>
              !el.disabled &&
              visible(el) &&
              el.textContent.trim() === "Single Crop"
            );

          if (choices.length === 1) {
            automaticButton = choices[0];

            try {
              automaticButton.click();
            } finally {
              automaticButton = null;
            }

            return;
          }
        }

        await wait(50);
      }

      notify("Chưa nhận diện được menu. Bạn chọn Single Crop bằng tay.");
    } catch (error) {
      notify(error.message);
    } finally {
      openingMenu = false;
    }
  }, true);

  async function runCrop() {
    try {
      let dialog;
      let canvas;

      const deadline = Date.now() + 5000;

      while (Date.now() < deadline && !cancelled) {
        const dialogs = cropDialogs();

        if (dialogs.length > 1)
          throw Error("Có nhiều cửa sổ Crop. Đã dừng.");

        if (dialogs.length === 1) {
          dialog = dialogs[0];
          canvas = dialog.querySelector("canvas");

          if (canvas && canvas.width > 0 && canvas.height > 0)
            break;
        }

        await wait(50);
      }

      if (cancelled) return;

      if (!canvas)
        throw Error("Chưa tìm thấy canvas của cửa sổ Crop.");

      const title = dialog.querySelector(".ant-modal-title").textContent;

      function stillValid() {
        return !cancelled &&
          visible(dialog) &&
          dialog.querySelector("canvas") === canvas &&
          dialog.querySelector(".ant-modal-title")?.textContent === title;
      }

      // Giữ thời gian chờ của bản chụp đã thử thành công.
      await wait(400);
      if (!stillValid()) return;

      let rect = canvas.getBoundingClientRect();
      let stable = 0;

      for (let i = 0; i < 20 && stable < 3; i++) {
        await wait(50);
        if (!stillValid()) return;

        const next = canvas.getBoundingClientRect();

        const same = ["left", "top", "width", "height"]
          .every(key => Math.abs(next[key] - rect[key]) < 0.2);

        stable = same ? stable + 1 : 0;
        rect = next;
      }

      if (stable < 3 || rect.width < 10 || rect.height < 10)
        throw Error("Khung ảnh chưa ổn định. Đã dừng.");

      function mouse(type, x, y, buttons) {
        canvas.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 0,
          buttons
        }));
      }

      mouse("mousemove", rect.left, rect.top, 0);
      mouse("mousedown", rect.left, rect.top, 1);

      await wait(60);

      for (let i = 1; i <= 6; i++) {
        if (!stillValid()) return;

        mouse(
          "mousemove",
          rect.left + rect.width * i / 6,
          rect.top + rect.height * i / 6,
          1
        );

        await wait(25);
      }

      if (!stillValid()) return;

      mouse("mouseup", rect.right, rect.bottom, 0);

      // Không tự thử lại để tránh lưu trùng.
      await wait(800);

      if (stillValid()) {
        notify("Đã kéo thử. Nếu chưa lưu, hãy thao tác tay và báo lại kết quả.");
      }
    } catch (error) {
      notify(error.message);
    }
  }
})();
