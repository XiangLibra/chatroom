import os
import re
import uuid
from datetime import datetime

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

# === MongoDB ===
from pymongo import MongoClient, ASCENDING, DESCENDING

import os
from dotenv import load_dotenv #使用讀取環境的套件
load_dotenv()


app = Flask(__name__)

# 🔌 SocketIO（eventlet 模式）
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# === 根路由 ===
@app.route("/")
def index():
    return render_template("index.html")

# === 參數 ===
MAX_HISTORY = 100

# === MongoDB 連線設定（環境變數可覆蓋） ===
# MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_URI = os.getenv("MONGO_URI","mongodb+srv://renderUser:StrongPassword123@cluster0.zgdff3f.mongodb.net/?appName=Cluster0")  # 使用自己mongodb atlas的網址  ex: mongodb://appuser:StrongPassword!@mongo-xxxx:27017/chatapp?authSource=chatapp


if not MONGO_URI:
    raise RuntimeError(
        "環境變數 MONGO_URI 未設定。請在本地 .env 或雲端環境變數中提供連線字串。"
        "\n例：MONGO_URI=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/chatapp?retryWrites=true&w=majority"
    )

DB_NAME = os.getenv("MONGO_DB", "chatapp")
COLLECTION_NAME = os.getenv("MONGO_COLLECTION", "messages")

mongo_client = MongoClient(MONGO_URI)
db = mongo_client[DB_NAME]
col = db[COLLECTION_NAME]


# 索引（啟動時確保存在）
# 以 timestamp 查詢最新訊息、以 _id（uuid 字串）快速查
col.create_index([("timestamp", ASCENDING)])


# === 工具 ===
def _doc_to_message(doc):
    """把 MongoDB 文件轉成前端要的訊息物件（timestamp 轉 ISO 字串）"""
    return {
        "id": doc.get("_id"),
        "username": doc.get("username"),
        "content": doc.get("content"),
        "timestamp": doc.get("timestamp").isoformat(timespec="seconds") + "Z" if doc.get("timestamp") else None,
    }

# === 你原本的線上使用者/事件 ===
clients = {}

def broadcast_user_count():
    emit(
        "user_count",
        {"count": len([c for c in clients.values() if c["username"]])},
        broadcast=True,
    )

@socketio.on("connect")
def on_connect():
    clients[request.sid] = {"username": None}
    print("Client connect:", request.sid)

@socketio.on("disconnect")
def on_disconnect():
    info = clients.pop(request.sid, None)
    if info and info["username"]:
        emit("user_left", {"username": info["username"]}, broadcast=True)
        broadcast_user_count()
    print("Client disconnect:", request.sid)

@socketio.on("join")
def on_join(data):
    username = data.get("username", "匿名")
    clients[request.sid]["username"] = username
    emit("user_joined", {"username": username}, broadcast=True)
    broadcast_user_count()
    print(username, "joined")

@socketio.on("typing")
def on_typing(data):
    emit("typing", data, broadcast=True, include_self=False)

@socketio.on("change_username")
def on_change(data):
    old = data.get("oldUsername")
    new = data.get("newUsername")
    if request.sid in clients:
        clients[request.sid]["username"] = new
    emit("user_changed_name", {"oldUsername": old, "newUsername": new}, broadcast=True)

# === send_message：改成寫入 MongoDB → 再廣播 ===
@socketio.on("send_message")
def on_message(data):
    try:
        username = (clients.get(request.sid, {}) or {}).get("username") or data.get("username") or "匿名"
        raw_content = str(data.get("content", "")).strip()
        cleaned_content = re.sub(r"user name is .*?\ncontent is ", "", raw_content, flags=re.IGNORECASE)

        msg_id = str(uuid.uuid4())
        now_utc = datetime.utcnow()

        doc = {
            "_id": msg_id,                # 用 uuid 當主鍵
            "username": username,
            "content": cleaned_content,
            "timestamp": now_utc,         # 以 datetime 儲存，查詢/排序方便
        }

        # 寫入 MongoDB
        col.insert_one(doc)

        # 給前端的訊息格式（timestamp 轉 ISO 字串）
        message = _doc_to_message(doc)

        # 廣播給其他人（不含自己）
        emit("chat_message", message, broadcast=True, include_self=False)

    except Exception as e:
        emit("chat_error", {"message": f"訊息處理失敗：{e}"}, to=request.sid)

# === 歷史 API：從 MongoDB 取最後 N 筆 ===
@app.route("/get_history", methods=["GET"])
def get_history():
    # 取最新的 MAX_HISTORY 筆，再反轉成由舊到新顯示
    cursor = col.find({}, {"_id": 1, "username": 1, "content": 1, "timestamp": 1}) \
                .sort("timestamp", DESCENDING) \
                .limit(MAX_HISTORY)
    docs = list(cursor)
    docs.reverse()
    return jsonify([_doc_to_message(d) for d in docs])

# === 清空歷史（刪除資料集合中的所有訊息） ===
@app.route("/clear_history", methods=["POST"])
def clear_history():
    try:
        col.delete_many({})
        return jsonify({"status": "success", "message": "歷史紀錄已清除"})
    except Exception as e:
        return jsonify({"status": "error", "message": f"刪除失敗: {e}"}), 500

if __name__ == "__main__":
    # 提醒：請先安裝 `pymongo`，並啟動你的 MongoDB
    # pip install pymongo
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)




# import os
# import re
# import json
# import uuid
# from datetime import datetime

# from flask import Flask, render_template, request, jsonify
# from flask_socketio import SocketIO, emit

# app = Flask(__name__)

# # 🔌 SocketIO（eventlet 模式）
# socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# # === 根路由 ===
# @app.route("/")
# def index():
#     return render_template("index.html")

# # === 聊天歷史設定 ===
# MAX_HISTORY = 100
# HISTORY_DIR = "chat_history"
# HISTORY_FILE = os.path.join(HISTORY_DIR, "messages.json")
# os.makedirs(HISTORY_DIR, exist_ok=True)

# # 根據 async_mode 選用正確的鎖（避免 eventlet 被真正的 thread lock 卡死）
# if socketio.async_mode == "eventlet":
#     from eventlet.semaphore import Semaphore
#     _history_lock = Semaphore(1)
# else:
#     import threading
#     _history_lock = threading.Lock()

# chat_history = []  # in-memory 緩存


# def _load_chat_history():
#     global chat_history
#     if os.path.exists(HISTORY_FILE):
#         try:
#             with open(HISTORY_FILE, "r", encoding="utf-8") as f:
#                 data = json.load(f)
#             if isinstance(data, list):
#                 chat_history = data[-MAX_HISTORY:]
#             else:
#                 chat_history = []
#         except Exception as e:
#             print(f"[history] 讀取失敗：{e}")
#             chat_history = []
#     else:
#         chat_history = []


# def _save_chat_history():
#     """只負責把目前 chat_history 落盤；鎖由呼叫端保護。"""
#     try:
#         with open(HISTORY_FILE, "w", encoding="utf-8") as f:
#             json.dump(chat_history, f, ensure_ascii=False, indent=2)
#     except Exception as e:
#         print(f"[history] 寫入失敗：{e}")


# # 啟動先載一次
# _load_chat_history()

# # === 你原本的線上使用者/事件 ===
# clients = {}

# def broadcast_user_count():
#     emit(
#         "user_count",
#         {"count": len([c for c in clients.values() if c["username"]])},
#         broadcast=True,
#     )

# @socketio.on("connect")
# def on_connect():
#     clients[request.sid] = {"username": None}
#     print("Client connect:", request.sid)

# @socketio.on("disconnect")
# def on_disconnect():
#     info = clients.pop(request.sid, None)
#     if info and info["username"]:
#         emit("user_left", {"username": info["username"]}, broadcast=True)
#         broadcast_user_count()
#     print("Client disconnect:", request.sid)

# @socketio.on("join")
# def on_join(data):
#     username = data.get("username", "匿名")
#     clients[request.sid]["username"] = username
#     emit("user_joined", {"username": username}, broadcast=True)
#     broadcast_user_count()
#     print(username, "joined")

# @socketio.on("typing")
# def on_typing(data):
#     emit("typing", data, broadcast=True, include_self=False)

# @socketio.on("change_username")
# def on_change(data):
#     old = data.get("oldUsername")
#     new = data.get("newUsername")
#     if request.sid in clients:
#         clients[request.sid]["username"] = new
#     emit("user_changed_name", {"oldUsername": old, "newUsername": new}, broadcast=True)

# # === 這裡加「寫入歷史 → 廣播」且不會卡死 ===
# @socketio.on("send_message")
# def on_message(data):
#     try:
#         username = (clients.get(request.sid, {}) or {}).get("username") or data.get("username") or "匿名"
#         raw_content = str(data.get("content", "")).strip()
#         # 移除舊格式（可留可拿掉）
#         cleaned_content = re.sub(r"user name is .*?\ncontent is ", "", raw_content, flags=re.IGNORECASE)

#         message = {
#             "id": str(uuid.uuid4()),
#             "username": username,
#             "content": cleaned_content,
#             "timestamp": datetime.utcnow().isoformat(timespec="seconds") + "Z",
#         }

#         # 寫入 in-memory & 落盤（臨界區保持極短）
#         with _history_lock:
#             chat_history.append(message)
#             if len(chat_history) > MAX_HISTORY:
#                 del chat_history[0 : len(chat_history) - MAX_HISTORY]
#             _save_chat_history()

#         # 廣播給其他人（不含自己）
#         emit("chat_message", message, broadcast=True, include_self=False)

#     except Exception as e:
#         # 有任何例外，回一個 error 給送訊息的人（不影響其他人）
#         emit("chat_error", {"message": f"訊息處理失敗：{e}"}, to=request.sid)

# # === 歷史 API：給前端載入/清空 ===
# @app.route("/get_history", methods=["GET"])
# def get_history():
#     return jsonify(chat_history)

# @app.route("/clear_history", methods=["POST"])
# def clear_history():
#     global chat_history
#     with _history_lock:
#         chat_history = []
#         try:
#             if os.path.exists(HISTORY_FILE):
#                 os.remove(HISTORY_FILE)
#         except Exception as e:
#             return jsonify({"status": "error", "message": f"刪除檔案失敗: {e}"}), 500
#     return jsonify({"status": "success", "message": "歷史紀錄已清除"})

# if __name__ == "__main__":
#     # eventlet 模式建議已安裝 eventlet；未安裝可改 async_mode 或移除
#     socketio.run(app, host="0.0.0.0", port=5000, debug=True)

