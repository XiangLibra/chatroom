/* ========= Mermaid 初始化 ========= */
mermaid.initialize({ startOnLoad: false });

/* ===== 使用者暱稱 ===== */
let username = sessionStorage.getItem("chat_username");
if (!username) {
  username = "使用者" + Math.floor(Math.random() * 1000);
  sessionStorage.setItem("chat_username", username);
}


/* ===== 發訊息 ===== */
$("#send-button").on("click", send);
$("#message-input").on("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});


/* ===== 清空訊息 ===== */
// $("#clear-btn").on("click", () => {
//   if (confirm("確定要清空聊天？")) $("#chat-messages").empty();
// });


/* ========= 滑到底部 ========= */
function scrollBottom() {
  const m = document.getElementById("chat-messages");
  m.scrollTop = m.scrollHeight;
}

/* ===== Markdown / Mermaid / Highlight ===== */
function format(txt) {
  txt = txt.trim();
  let html = marked.parse(txt);
  html = DOMPurify.sanitize(html);

  html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (m, c) => {
    const raw = c.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    return `<div class="mermaid-container"><button class="copy-btn" onclick="copyText(this,'${encodeURIComponent(
      raw
    )}')">複製</button><pre class="mermaid">${raw}</pre></div>`;
  });

  html = html.replace(/<pre><code class="language-([\w]+)">([\s\S]*?)<\/code><\/pre>/g, (m, l, c) => {
    if (l === "mermaid") return m;
    return `<div class="code-block"><button class="copy-btn" onclick="copyText(this,'${encodeURIComponent(
      c
    )}')">複製</button><pre><code class="language-${l} hljs">${c}</code></pre></div>`;
  });

  return html;
}

// ===== 執行 Highlight.js 與 Mermaid 渲染 =====
function renderCode() {
  requestAnimationFrame(() => {
    document.querySelectorAll("pre code").forEach((b) => hljs.highlightElement(b));
    mermaid.init(undefined, ".mermaid");
  });
}

// ===== 複製按鈕功能 =====
function copyText(btn, encoded) {
  const text = decodeURIComponent(encoded);
  navigator.clipboard
    .writeText(text)
    .then(() => {
      btn.innerText = "已複製！";
      setTimeout(() => (btn.innerText = "複製"), 1500);
    })
    .catch(() => alert("複製失敗"));
}

function addMessage(content, isMe, sender) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const html = `
    <div class="message ${isMe ? "user-message" : "other-message"} clearfix">
      ${!isMe ? `<div class="user-info"><span class="user-name">${sender}</span></div>` : ""}
      <div class="message-content">${format(content)}</div>
      <div class="message-time">${time}</div>
    </div>`;
  $("#chat-messages").append(html);
  renderCode();
  scrollBottom();
}

/* ===== 表情選單（ ===== */
$(".emoji-btn").on("click", function () {
  const emojis = ["😊", "😂", "😍", "👍", "❤️", "😉", "🎉", "👋"];
  if ($(".emoji-menu").length) {
    $(".emoji-menu").remove();
    return;
  }
  let menu = '<div class="emoji-menu p-2 bg-white rounded shadow">';
  emojis.forEach((e) => (menu += `<span class="emoji-item p-1" style="cursor:pointer;font-size:1.5rem;">${e}</span>`));
  menu += "</div>";
  $(this).after(menu);
  $(".emoji-item").on("click", function () {
    $("#message-input").val($("#message-input").val() + $(this).text());
    $(".emoji-menu").remove();
  });
  $(document).one("click", (e) => {
    if (!$(e.target).hasClass("emoji-btn")) $(".emoji-menu").remove();
  });
});


/* ===== 連線 ===== */
const socket = io(); // 連到同主機:5000


/* ===== 線上人數 ===== */
socket.on("user_count", (d) => $("#online-count").text(d.count));

/* ===== 更新連線狀態 ===== */
function updateStatus(ok, msg = "已連線") {
  const el = $("#connection-status");
  if (ok) {
    el.text(msg).css("background-color", "#d4edda");
    setTimeout(() => el.fadeOut(), 3000);
  } else {
    el.stop().show().text(msg).css("background-color", "#f8d7da");
  }
}

socket.on("connect", () => updateStatus(true));
socket.on("disconnect", () => updateStatus(false, "連線中斷"));
socket.on("connect_error", () => updateStatus(false, "連線錯誤"));



/* ===== 初次加入 ===== */
socket.emit("join", { username });
/* ===== 工具函式 ===== */
function addSystem(text) {
  $("#chat-messages").append(`<div class="connection-status">${text}</div>`);
  scrollBottom();
}

/* ===== 系統事件 ===== */
socket.on("user_joined", (d) => addSystem(`${d.username} 加入了聊天`));
socket.on("user_left", (d) => addSystem(`${d.username} 離開了聊天`));





function send() {
  const txt = $("#message-input").val().trim();
  if (!txt) return;
  addMessage(txt, true, username);
  socket.emit("send_message", {
    username,
    content: txt,
  });
  $("#message-input").val("").height("auto");
  scrollBottom();
}

/* ===== 聊天事件 ===== */
socket.on("chat_message", (d) =>
  addMessage(d.content, d.username === username, d.username)
);




function showTyping(user) {
  if (user === username) return;
  const cls = "typing-" + user.replace(/\s+/g, "-");
  if ($("." + cls).length) {
    clearTimeout($("." + cls).data("timer"));
  } else {
    $("#chat-messages").append(
      `<div class="${cls} typing-indicator">${user} 正在輸入...</div>`
    );
  }
  const timer = setTimeout(
    () => $("." + cls).fadeOut(() => $(this).remove()),
    3000
  );
  $("." + cls).data("timer", timer);
  scrollBottom();
}
/* ===== Typing ===== */
socket.on("typing", (d) => showTyping(d.username));

/* ===== 輸入狀態 ===== */
let typingTimer;
$("#message-input").on("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
  if (!typingTimer) {
    socket.emit("typing", { username });
    typingTimer = setTimeout(() => (typingTimer = null), 1000);
  }
});





/* ===== 改暱稱 ===== */
$("#change-name-btn").on("click", () => {
  const v = prompt("輸入新名稱：", username);
  if (v && v.trim() && v !== username) {
    socket.emit("change_username", { oldUsername: username, newUsername: v });
    username = v.trim();
    sessionStorage.setItem("chat_username", username);
  }
});

socket.on("user_changed_name", (d) =>
  addSystem(`${d.oldUsername} 更名為 ${d.newUsername}`)
);


// ===== 初次拉取歷史訊息 =====
fetch("/get_history")
  .then((r) => r.json())
  .then((list) => {
    list.forEach((m) => {
      addMessage(m.content, m.username === username, m.username);
      // 若想用伺服器時間，也可改 addMessage(m.content, m.username === username, m.username, m.timestamp)
    });
  })
  .catch(() => console.warn("載入歷史失敗"));

$("#clear-btn").on("click", () => {
  if (!confirm("確定要清空聊天？")) return;
  fetch("/clear_history", { method: "POST" })
    .then((r) => r.json())
    .then(() => {
      $("#chat-messages").empty();
      addSystem("歷史紀錄已清除");
    })
    .catch(() => alert("清除失敗"));
});



//更新狀態
updateStatus(false, "連線中…");