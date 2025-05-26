
// 引入 logger.ts 以啟用檔案日誌記錄並覆寫 console 方法
// 必須將此 import 放在所有其他 import 和程式碼之前，
// 特別是那些可能使用 console 的程式碼。
import './logger';

// 引入 Node.js http 模組用於創建 HTTP 伺服器
import { createServer } from 'http';
// 引入 Socket.IO Server 類別及相關類型
import { Server, Socket } from 'socket.io';
// 引入房間管理器
import { RoomManager } from './RoomManager';
// 引入類型定義
import { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData, ChatMessage, GameActionPayload } from './types';
// 引入常數
// Fix: Import DEFAULT_HOST_NAME
import { SERVER_PORT, MAX_PLAYER_NAME_LENGTH, SYSTEM_SENDER_NAME, DEFAULT_PLAYER_NAME, LOBBY_ROOM_NAME, DEFAULT_HOST_NAME } from './constants';

// 創建 HTTP 伺服器實例
const httpServer = createServer();
// 創建 Socket.IO 伺服器實例，並配置 CORS (跨來源資源共享)
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: {
    origin: "*", // 允許所有來源的連接 (在生產環境中應配置為特定來源)
    methods: ["GET", "POST"] // 允許的 HTTP 方法
  }
});

// 實例化房間管理器
const roomManager = new RoomManager(io);

// 監聽新的 Socket 連接事件
io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) => {
  console.log(`[Server] 新的連接: ${socket.id}`);
  
  // 從連接查詢參數中獲取初始玩家名稱，並存儲在 socket.data 中
  // 這允許客戶端在建立連接時就傳遞一個預設名稱
  const initialNameFromQuery = socket.handshake.query.playerName;
  socket.data.playerName = Array.isArray(initialNameFromQuery) 
    ? initialNameFromQuery[0] // 如果是陣列，取第一個
    : initialNameFromQuery || `${DEFAULT_PLAYER_NAME}${Math.floor(Math.random() * 10000)}`; // 否則使用查詢參數或生成隨機名稱

  // --- 使用者管理事件 ---
  // 監聽客戶端 'userSetName' 事件 (設定玩家名稱)
  socket.on('userSetName', (name, callback) => {
    const trimmedName = name.trim(); // 去除名稱前後空白
    // 驗證名稱長度
    if (trimmedName && trimmedName.length > 0 && trimmedName.length <= MAX_PLAYER_NAME_LENGTH) {
      socket.data.playerName = trimmedName; // 更新 socket.data 中的玩家名稱
      socket.join(LOBBY_ROOM_NAME); // 讓此 socket 加入 'lobby' 群組 (房間)
      console.log(`[Server] Socket ${socket.id} (${socket.data.playerName}) 設定名稱並已加入 '${LOBBY_ROOM_NAME}' 群組。`);
      if(callback) callback({ success: true }); // 回調客戶端告知成功
      // 向剛設定完名稱並加入大廳的此客戶端發送當前的房間列表
      socket.emit('lobbyRoomList', roomManager.getLobbyRoomsData());
    } else { // 如果名稱無效
      if(callback) callback({ success: false, message: `名稱無效或過長 (1-${MAX_PLAYER_NAME_LENGTH} 字元)` }); // 回調失敗訊息
    }
  });

  // --- 大廳相關事件 ---
  // 監聽客戶端 'lobbyCreateRoom' 事件 (創建新房間)
  socket.on('lobbyCreateRoom', (clientSettings, callback) => {
    // 如果客戶端未提供 playerName，則使用 socket.data 中的名稱
    if (!clientSettings.playerName || clientSettings.playerName.trim() === "") {
        clientSettings.playerName = socket.data.playerName || DEFAULT_HOST_NAME;
    }
    roomManager.createRoom(socket, clientSettings, callback); // 呼叫 RoomManager 處理創建房間
  });

  // 監聽客戶端 'lobbyJoinRoom' 事件 (加入房間)
  socket.on('lobbyJoinRoom', (data, callback) => {
     // 如果客戶端未提供 playerName，則使用 socket.data 中的名稱
     if (!data.playerName || data.playerName.trim() === "") {
        data.playerName = socket.data.playerName || DEFAULT_PLAYER_NAME;
    }
    roomManager.joinRoom(socket, data, callback); // 呼叫 RoomManager 處理加入房間
  });

  // 監聽客戶端 'lobbyGetRooms' 事件 (獲取房間列表)
  socket.on('lobbyGetRooms', () => {
    // 確保客戶端已在 'lobby' 群組內才發送列表
    // 通常在 'userSetName' 後客戶端會自動加入 'lobby'
    if (socket.rooms.has(LOBBY_ROOM_NAME)) {
        socket.emit('lobbyRoomList', roomManager.getLobbyRoomsData());
    } else { // 如果因某些原因客戶端不在 'lobby' 群組
        console.warn(`[Server] Socket ${socket.id} 請求大廳房間列表但不在 '${LOBBY_ROOM_NAME}' 群組。強制加入後發送。`);
        socket.join(LOBBY_ROOM_NAME); // 強制加入
        socket.emit('lobbyRoomList', roomManager.getLobbyRoomsData()); // 發送列表
    }
  });

  // 監聽客戶端 'lobbySendChatMessage' 事件 (發送大廳聊天訊息)
  socket.on('lobbySendChatMessage', (messageText) => {
    roomManager.sendLobbyChatMessage(socket, messageText); // 呼叫 RoomManager 處理
  });

  // 監聽客戶端 'lobbyLeave' 事件 (玩家離開大廳視圖，例如返回主頁)
  socket.on('lobbyLeave', () => {
    // 如果玩家當時在某個遊戲房間內，則先處理離開該房間的邏輯
    if (socket.data.currentRoomId) {
        roomManager.leaveRoom(socket, socket.data.currentRoomId);
    }
    socket.leave(LOBBY_ROOM_NAME); // 讓 socket 離開 'lobby' 群組
    console.log(`[Server] Socket ${socket.id} (${socket.data.playerName}) 離開 '${LOBBY_ROOM_NAME}' 群組並返回主頁。`);
  });


  // --- 遊戲相關事件 (直接由 RoomManager -> GameRoom 處理) ---
  // 監聽客戶端 'gamePlayerAction' 事件 (玩家執行遊戲動作)
  socket.on('gamePlayerAction', (roomId: string, action: GameActionPayload) => {
    const room = roomManager.getRoomById(roomId); // 根據 roomId 獲取 GameRoom 實例
    if (room && room.hasPlayer(socket.id)) { // 如果房間存在且玩家在該房間內
      room.handlePlayerAction(socket.id, action); // 呼叫 GameRoom 處理玩家動作
    } else if (room) { // 如果房間存在但玩家不在該房間內 (異常情況)
       console.warn(`[Server] Socket ${socket.id} (${socket.data.playerName}) 嘗試向房間 ${roomId} 發送動作，但不在該房間內。`);
       socket.emit('gameError', '您不在該遊戲房間內。');
    } else { // 如果房間不存在
        console.warn(`[Server] Socket ${socket.id} (${socket.data.playerName}) 嘗試向不存在的房間 ${roomId} 發送動作。`);
        socket.emit('gameError', '遊戲房間不存在。');
    }
  });

  // 監聽客戶端 'gameSendChatMessage' 事件 (發送遊戲內聊天訊息)
  socket.on('gameSendChatMessage', (roomId, messageText) => {
    const room = roomManager.getRoomById(roomId);
     if (room && room.hasPlayer(socket.id)) { // 驗證房間和玩家身份
      room.sendChatMessage(socket.id, messageText); // 呼叫 GameRoom 處理
    } else {
        socket.emit('gameError', '無法在指定房間發送訊息。');
    }
  });

  // 監聽客戶端 'gameRequestStart' 事件 (房主請求開始遊戲)
  socket.on('gameRequestStart', (roomId) => {
    const room = roomManager.getRoomById(roomId);
     if (room && room.hasPlayer(socket.id)) { // 驗證房間和玩家身份
      room.requestStartGame(socket.id); // 呼叫 GameRoom 處理
    } else {
        socket.emit('gameError', '無法請求開始遊戲。');
    }
  });

  // 監聽客戶端 'gameQuitRoom' 事件 (玩家退出遊戲房間)
  socket.on('gameQuitRoom', (roomId) => {
    roomManager.leaveRoom(socket, roomId); // 呼叫 RoomManager 處理
  });

  // --- 斷線處理 ---
  // 監聽 Socket 'disconnect' 事件
  socket.on('disconnect', (reason) => {
    console.log(`[Server] 連接斷開: ${socket.id} (${socket.data.playerName})。原因: ${reason}`);
    socket.leave(LOBBY_ROOM_NAME); // 確保斷線玩家離開大廳群組
    roomManager.handlePlayerDisconnect(socket); // 呼叫 RoomManager 處理玩家斷線
  });

});

// 啟動 HTTP 伺服器並監聽指定埠號
httpServer.listen(SERVER_PORT, () => {
  console.log(`[Server] 象棋麻將後端伺服器正在監聽埠 ${SERVER_PORT}`);
  // 伺服器啟動時，可以向大廳廣播一條系統訊息 (如果大廳已有人)
  const systemMessage: ChatMessage = {
      id: `system-start-${Date.now()}`,
      senderName: SYSTEM_SENDER_NAME,
      text: `伺服器已啟動。現在時間: ${new Date().toLocaleTimeString('zh-TW', {hour12: false})}`,
      timestamp: Date.now(),
      type: 'system'
  };
  io.to(LOBBY_ROOM_NAME).emit('lobbyChatMessage', systemMessage); // 發送到 'lobby' 群組
});

// 處理伺服器關閉信號 (例如 Ctrl+C)
// 將 'process' 轉型為 'any' 以避免 TypeScript 對 'on' 和 'exit' 方法的類型檢查錯誤
(process as any).on('SIGINT', () => {
  console.log('[Server] 收到 SIGINT，開始關閉伺服器...');
  // 關閉 Socket.IO 伺服器，停止接受新連接，並等待現有連接處理完成
  io.close(() => {
    console.log('[Server] Socket.IO 伺服器已關閉。');
    // 關閉 HTTP 伺服器
    httpServer.close(() => {
      console.log('[Server] HTTP 伺服器已關閉。');
      // 銷毀所有遊戲房間
      roomManager.getLobbyRoomsData().forEach(roomData => {
          const room = roomManager.getRoomById(roomData.id);
          room?.destroy(); // 呼叫 GameRoom 的銷毀方法
      });
      console.log('[Server] 所有遊戲房間已清理。');
      // 退出 Node.js 程序
      // logger.ts 中的 process.on('exit', closeLogStream) 會在此處之前被觸發
      (process as any).exit(0);
    });
  });
});
