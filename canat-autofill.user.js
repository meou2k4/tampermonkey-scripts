// ==UserScript==
// @name         Điền CANAT
// @namespace    local.canat.helper
// @version      1.0
// @description  Dán chuỗi CANAT để điền 5 ô trong form
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const names = [
    "message_id", "cycle_time", "can_message",
    "bus_channel", "message_type"
  ];

  const panels = new WeakMap();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => el.getClientRects().length > 0;
  const label = el => el.textContent.replace(/\*/g, "").trim();

  function fields(root) {
    return names.map(name => {
      const tags = [...root.querySelectorAll("span.ant-tag")]
        .filter(el => visible(el) && label(el) === name);

      return tags.length === 1
        ? tags[0].parentElement.querySelector("input")
        : null;
    });
  }

  function parse(raw) {
    const line = raw.trim().replace(/^\((.*)\)$/, "$1");
    const parts = line.split(";");

    if (/[\r\n]/.test(line) || parts.length < 6)
      throw Error("Dán một dòng CANAT đầy đủ, phân cách bằng dấu ;.");

    const id = parts[2].trim();
    const data = parts[5].trim().replace(/\s+/g, " ").toUpperCase();

    if (!/^0x[0-9a-f]{1,8}$/i.test(id) ||
        Number(id) > 0x1FFFFFFF)
      throw Error("Trường thứ 3 không phải CAN ID hợp lệ.");

    if (!/^[0-9A-F]{2}( [0-9A-F]{2}){0,63}$/.test(data))
      throw Error("Trường thứ 6 phải là dãy byte hex.");

    return [id, "1000", data, "2", "FD"];
  }

  function install(root) {
    const oldPanel = panels.get(root);
    if (oldPanel?.isConnected) return;

    const panel = document.createElement("div");
    panel.style.cssText =
      "padding:8px;background:#152538;border:1px solid #426b95;" +
      "border-radius:6px;margin-bottom:6px;";

    const title = document.createElement("div");
    title.textContent = "Điền nhanh CANAT";
    title.style.cssText =
      "font-size:12px;font-weight:bold;color:#b9dcff;margin-bottom:5px;";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Dán chuỗi CANAT rồi nhấn Enter";
    input.style.cssText =
      "flex:1;min-width:0;padding:6px;color:#fff;background:#101820;" +
      "border:1px solid #53718e;border-radius:4px;";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Điền";
    button.style.cssText =
      "padding:5px 12px;background:#1677ff;color:white;" +
      "border:0;border-radius:4px;cursor:pointer;";

    const status = document.createElement("div");
    status.style.cssText = "font-size:11px;margin-top:4px;color:#aec5dc;";
    status.textContent = "Điền 5 ô; không tự gửi CAN.";

    row.append(input, button);
    panel.append(title, row, status);
    panels.set(root, panel);
    root.prepend(panel);

    let busy = false;

    async function fill() {
      if (busy) return;

      try {
        const values = parse(input.value);
        const current = fields(root);

        if (current.some(el => !el || el.disabled || el.readOnly))
          throw Error("Chưa tìm đủ 5 ô có thể nhập.");

        busy = true;
        button.disabled = true;
        status.textContent = "Đang điền…";

        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype, "value"
        ).set;

        for (let i = 0; i < names.length; i++) {
          if (!root.isConnected)
            throw Error("Form đã thay đổi. Hãy mở lại form.");

          const el = fields(root)[i];
          if (!el || el.disabled || el.readOnly)
            throw Error("Không thể điền ô " + names[i]);

          el.focus();
          // Thay toàn bộ nội dung cũ, không nối thêm.
          setter.call(el, values[i]);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.blur();

          // Cho web cập nhật trước khi điền ô tiếp theo.
          await pause(30);
        }

        await pause(100);

        if (!fields(root).every((el, i) => el && el.value === values[i]))
          throw Error("Web chưa giữ đúng giá trị. Kiểm tra lại 5 ô.");

        status.style.color = "#8be0a4";
        status.textContent = "Đã điền đủ 5 ô. Bạn kiểm tra rồi gửi CAN.";
        input.focus();
        input.select();
      } catch (error) {
        status.style.color = "#ffaaa5";
        status.textContent = error.message;
      } finally {
        busy = false;
        button.disabled = false;
      }
    }

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      fill();
    });

    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.isComposing) fill();
      }
    });
  }

  function scan() {
    const tags = [...document.querySelectorAll("span.ant-tag")]
      .filter(el => visible(el) && label(el) === "message_id");

    for (const tag of tags) {
      let root = tag.parentElement;

      while (root && root !== document.body) {
        if (fields(root).every(Boolean)) {
          install(root);
          break;
        }
        root = root.parentElement;
      }
    }
  }

  // Theo dõi khi mở form hoặc chuyển Step.
  let timer;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 120);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  scan();
})();
