# 03_websocket/app.py
from flask import Flask, render_template, request,jsonify
from flask_socketio import SocketIO, emit
import os
import json
from datetime import datetime
import uuid
import re
app = Flask(__name__)
app.config["SECRET_KEY"] = "line-chat-secret-key"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# 線上使用者 { sid: {"username": str} }
clients = {}

@app.route("/")
def index():
    return render_template("index.html")
# ===== SocketIO 事件 =====

# ✅ 當有使用者連線到伺服器時觸發
@socketio.on("connect")
def on_connect():
    # 用 request.sid 作為 key，在 clients 字典中新增一個新連線的記錄，先設為未命名
    clients[request.sid] = {"username": None}
    # 在後端顯示誰連線了（sid 是 SocketIO 分配的 session ID）
    print("Client connect:", request.sid)

# ❌ 當使用者離線或關閉網頁時觸發
@socketio.on("disconnect")
def on_disconnect():
    # 從 clients 字典中移除該連線的記錄
    info = clients.pop(request.sid, None)
    # 如果該使用者有設定名稱，則廣播他已離線的訊息給其他人
    if info and info["username"]:
        emit("user_left",
             {"username": info["username"]},
             broadcast=True)
        # 同步更新聊天室中線上人數
        broadcast_user_count()
    # 後端印出該使用者已斷線
    print("Client disconnect:", request.sid)

# 🙋 當使用者傳送 "join" 事件進入聊天室時觸發
@socketio.on("join")
def on_join(data):
    # 從前端的資料中取得使用者名稱，如果沒有提供則預設為「匿名」
    username = data.get("username", "匿名")
    # 把該使用者名稱記錄到對應 sid 的資料中
    clients[request.sid]["username"] = username
    # 廣播給所有使用者，這位新用戶已加入聊天室
    emit("user_joined",
         {"username": username},
         broadcast=True)
    # 更新線上使用者總數
    broadcast_user_count()
    # 在伺服器端列印誰加入了聊天室
    print(username, "joined")

# 🔁 使用者更改暱稱時觸發
@socketio.on("change_username")
def on_change(data):
    # 從傳來的資料中取得舊名稱與新名稱
    old = data.get("oldUsername")
    new = data.get("newUsername")
    # 如果該使用者還在線上，就更新他的暱稱為新名稱
    if request.sid in clients:
        clients[request.sid]["username"] = new
    # 將變更名稱的資訊廣播給所有人
    emit("user_changed_name",
         {"oldUsername": old, "newUsername": new},
         broadcast=True)

# 💬 使用者送出訊息時觸發
@socketio.on("send_message")
def on_message(data):
    """ 轉送使用者訊息給所有人（不含自己，自己已立即渲染） """
    emit("chat_message", data, broadcast=True, include_self=False)

# ⌨️ 使用者正在輸入時觸發（例如前端有 input event）
@socketio.on("typing")
def on_typing(data):
    # 廣播「正在輸入」狀態給其他人（不包含自己）
    emit("typing", data, broadcast=True, include_self=False)

# ===== 工具 =====

# 📊 廣播目前有幾位使用者在線（有設定名稱的人才算）
def broadcast_user_count():
    emit("user_count",
         {"count": len([c for c in clients.values() if c["username"]])},
         broadcast=True)

# 保存使用者連線資訊
clients = {}
# 保存聊天歷史
chat_history = []
# 最大歷史訊息數量
MAX_HISTORY = 100
# 確保聊天記錄保存目錄存在
HISTORY_DIR = 'chat_history'
HISTORY_FILE = os.path.join(HISTORY_DIR, 'messages.json')

if not os.path.exists(HISTORY_DIR):
    os.makedirs(HISTORY_DIR)

# 載入歷史訊息
def load_chat_history():
    global chat_history
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                chat_history = json.load(f)
        except Exception as e:
            print(f"載入歷史訊息出錯: {e}")
            chat_history = []
    else:
        chat_history = []

# 保存歷史訊息
def save_chat_history():
    try:
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(chat_history, f, ensure_ascii=False)
    except Exception as e:
        print(f"保存歷史訊息出錯: {e}")

# 清除聊天紀錄
@app.route('/clear_history', methods=['POST'])
def clear_history():
    global chat_history
    chat_history = []  # 清空記憶體中的歷史
    if os.path.exists(HISTORY_FILE):
        os.remove(HISTORY_FILE)  # 刪除檔案
    return jsonify({"status": "success", "message": "歷史紀錄已清除"})

# 初始載入聊天歷史
load_chat_history()
@app.route('/get_history')
def get_history():
    return jsonify(chat_history)


@socketio.on('send_message')
def handle_send_message(data):
    # 1) 先存入user訊息
    user_message = {
        'content': data.get('content'),
        'username': data.get('username'),
        'timestamp': data.get('timestamp'),
        'id': str(uuid.uuid4())
    }
    chat_history.append(user_message)
    if len(chat_history) > MAX_HISTORY:
        chat_history.pop(0)
    save_chat_history()
    
    emit('chat_message', user_message, broadcast=True, include_self=False)



    # 找到目前最新的使用者名稱
    latest_username = None
    for msg in reversed(chat_history):  # 倒序遍歷，找到最新的使用者
        if msg['username'] != 'AI Bot':
            latest_username = msg['username']
            break  # 找到後立即跳出

    # 如果找不到使用者，預設為 "Unknown User"
    if latest_username is None:
        latest_username = "Unknown User"

    # **定義正則表達式，移除過去的 "user name is xxx\ncontent is" 格式**
    username_pattern = re.compile(r"user name is .*?\ncontent is ")

    for i, msg in enumerate(chat_history):
            # **去除舊的 username 只保留訊息內容**
        cleaned_content = re.sub(username_pattern, '', msg['content'])

        if i == len(chat_history) - 1:  # **僅對最新的訊息加上 `current time`**
            message_time = datetime.now().strftime("%H:%M")
            datetime.now().isoformat(timespec="minutes").split("T")[1]


    # **限制最大訊息數量**
    if len(chat_history) > MAX_HISTORY:
        chat_history.pop(0)

    save_chat_history()

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
