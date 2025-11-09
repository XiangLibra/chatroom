mermaid.initialize({ startOnLoad: false });

/* ===== 使用者暱稱 ===== */
let username = sessionStorage.getItem("chat_username");
if (!username) {
  username = "使用者" + Math.floor(Math.random() * 1000);
  sessionStorage.setItem("chat_username", username);
}

/* ===== 連線 ===== */
const socket = io(); // 連到同主機:5000

socket.on("connect", () => updateStatus(true));
socket.on("disconnect", () => updateStatus(false, "連線中斷"));
socket.on("connect_error", () => updateStatus(false, "連線錯誤"));

/* ===== 初次加入 ===== */
socket.emit("join", { username });

/* ===== 線上人數 ===== */
socket.on("user_count", (d) => $("#online-count").text(d.count));

/* ===== 系統事件 ===== */
socket.on("user_joined", (d) => addSystem(`${d.username} 加入了聊天`));
socket.on("user_left", (d) => addSystem(`${d.username} 離開了聊天`));
socket.on("user_changed_name", (d) =>
  addSystem(`${d.oldUsername} 更名為 ${d.newUsername}`)
);

/* ===== 聊天事件 ===== */
socket.on("chat_message", (d) =>
  addMessage(d.content, d.username === username, d.username)
);

/* ===== Typing ===== */
socket.on("typing", (d) => showTyping(d.username));

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


function formatMessageContent(content) {
content = content.trim();

// 1) 用 marked 解析整段 Markdown
let parsedMarkdown = marked.parse(content);

// 2) 清理 XSS
let safeHtml = DOMPurify.sanitize(parsedMarkdown);

// 3) 特別處理 ```mermaid 這種區塊
safeHtml = safeHtml.replace(
  /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
  function (match, mermaidCode) {
    // 解碼 HTML 實體（可能帶 < 符號）
    let decodedCode = mermaidCode
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    
    // 回傳 <div class="mermaid"> </div>
    return `<div class="mermaid">\n${decodedCode}\n</div>`;
  }
);

// 4) 處理其他程式碼高亮 & 複製按鈕
safeHtml = safeHtml.replace(
  /<pre><code class="language-([\w]+)">([\s\S]*?)<\/code><\/pre>/g,
  function (match, lang, code) {
    // 如果是 mermaid 就不再處理
    if (lang === "mermaid") {
      return match;
    }
    return `
      <div class="code-block">
        <button class="copy-btn" onclick="copyCode(this)">複製</button>
        <pre><code class="language-${lang} hljs">${code}</code></pre>
      </div>
    `;
  }
);

return safeHtml;
}

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

/* ===== 改暱稱 ===== */
$("#change-name-btn").on("click", () => {
  const v = prompt("輸入新名稱：", username);
  if (v && v.trim() && v !== username) {
    socket.emit("change_username", { oldUsername: username, newUsername: v });
    username = v.trim();
    sessionStorage.setItem("chat_username", username);
  }
});

/* ===== 清空訊息 ===== */
$("#clear-btn").on("click", () => {
  if (confirm("確定要清空聊天？")) $("#chat-messages").empty();
});

/* ===== 工具函式 ===== */
function addSystem(text) {
  $("#chat-messages").append(`<div class="connection-status">${text}</div>`);
  scrollBottom();
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

// 🧠 功能：執行語法高亮與 Mermaid 圖表初始化
function renderCode() {
    requestAnimationFrame(() => {
      // 🔍 對所有 <pre><code> 區塊做語法高亮（highlight.js 套件）
      document.querySelectorAll("pre code").forEach((b) => hljs.highlightElement(b));
  
      // 🔄 初始化所有 .mermaid 區塊，將 Markdown 中的圖表語法轉為 SVG
      mermaid.init(undefined, ".mermaid");
    });
  }
  
// 📋 功能：將原始文字（通常是程式碼或 Mermaid 語法）複製到剪貼簿
function copyText(btn, encoded) {
    // 1️⃣ 將編碼過的文字（如 %3Chtml%3E）轉回正常文字
    const text = decodeURIComponent(encoded);
  
    // 2️⃣ 使用 Clipboard API 將文字寫入剪貼簿
    navigator.clipboard
      .writeText(text)
      .then(() => {
        // ✅ 複製成功後，將按鈕文字改成提示
        btn.innerText = "已複製！";
        // ⏳ 1.5 秒後恢復按鈕文字
        setTimeout(() => (btn.innerText = "複製"), 1500);
      })
      .catch(() => {
        // ❌ 若瀏覽器不支援或複製失敗，顯示提示
        alert("複製失敗");
      });
  }
  
/* ===== Emoji ===== */
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

updateStatus(false, "連線中…");



$(document).ready(function() {


  /* ===== 發訊息 ===== */
  $("#send-button").on("click", sendMessage);
$("#message-input").on("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    // send();
    sendMessage()
  }
});

        // 傳送訊息
        function sendMessage() {
    const messageContent = $('#message-input').val().trim();
    if (messageContent ) { //&& isConnected
      const formattedMessage = formatMessageContent(messageContent, true); // ✅ 轉換 `\n` 為 `<br>`

      const messageData = {
        content: messageContent,
        username: username,
        timestamp: new Date().toISOString()
      };
      
      // 發送訊息到服務器
      socket.emit('send_message', messageData);
      
      // 立即顯示自己的訊息
      addMessage(messageContent, username, messageData.timestamp, true);
      
      // 清空輸入框
      $('#message-input').val('');
      
      // 發送後立即滾動到底部
      scrollToBottom();
    }
  }


    // 系統訊息（置中顯示）
function addSystemMessage(content) {
    const messageHtml = `<div class="connection-status">${content}</div>`;
    $('#chat-messages').append(messageHtml);
    scrollToBottom();
  }
        // 滾動到最下方
function scrollToBottom() {
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

function loadHistoryMessages() {
$.ajax({
    url: "/get_history",
    method: "GET",
    dataType: "json",
    success: function (data) {
        $(".loading").remove();
        if (data && data.length > 0) {
            data.forEach(function (msg) {

                const isCurrentUser = msg.username === username;
                addMessage(msg.content, isCurrentUser, msg.username);
                // addMessage(msg.content, msg.username, msg.timestamp, isCurrentUser);
            });

            // 🔥 **確保 Mermaid 語法轉換** (解決重整後 Mermaid 消失問題)
            setTimeout(() => {
                mermaid.init(undefined, ".mermaid");
            }, 100);

            scrollToBottom();
        } else {
            addSystemMessage("歡迎來到聊天室！");
        }
    },
    error: function () {
        $(".loading").remove();
        addSystemMessage("無法載入歷史訊息");
    },
});
}     // 初始化

  // **清空聊天紀錄**按鈕
  $('#clear-btn').click(function() {
    if (confirm("確定要清空所有聊天記錄嗎？")) {
      // 用 AJAX POST 呼叫後端 /clear_history
      $.post('/clear_history', function(res) {
        if (res.status === "success") {
          alert("聊天記錄已清空！");
          location.reload();
        } else {
          alert("清空失敗，請稍後再試。");
        }
      });
    }
  });
  
loadHistoryMessages();

})