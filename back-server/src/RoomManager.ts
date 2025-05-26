
// 引入 Socket.IO 相關類型
import { Server, Socket } from 'socket.io';
// 引入遊戲房間類別
import { GameRoom } from './GameRoom';
// 引入類型定義
import { RoomSettings, RoomListData, ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData, ChatMessage, ClientRoomSettingsData, GamePhase } from './types';
// 引入常數
import { DEFAULT_NUMBER_OF_ROUNDS, MAX_ROOM_NAME_LENGTH, MAX_PASSWORD_LENGTH, NUM_PLAYERS, SYSTEM_SENDER_NAME, DEFAULT_HOST_NAME, DEFAULT_PLAYER_NAME, LOBBY_ROOM_NAME } from './constants';

/**
 * @class RoomManager
 * @description 管理所有遊戲房間的創建、加入、移除以及大廳的相關操作。
 */
export class RoomManager {
  private rooms: Map<string, GameRoom>; // 儲存所有遊戲房間的 Map，鍵為 roomId
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>; // Socket.IO 伺服器實例

  /**
   * @constructor
   * @param {Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>} io - Socket.IO 伺服器實例。
   */
  constructor(io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
    this.io = io;
    this.rooms = new Map<string, GameRoom>(); // 初始化房間列表
  }

  /**
   * @description 創建一個新的遊戲房間。
   * @param {Socket} socket - 創建房間的玩家的 Socket 連接實例。
   * @param {Omit<ClientRoomSettingsData, 'maxPlayers'> & { playerName: string }} clientSettings - 客戶端提交的房間設定及創建者名稱。
   * @param {(ack: { success: boolean; roomId?: string; message?: string }) => void} callback - 操作完成後的回調函數。
   */
  public createRoom(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
                    clientSettings: Omit<ClientRoomSettingsData, 'maxPlayers'> & { playerName: string }, 
                    callback: (ack: { success: boolean; roomId?: string; message?: string }) => void): void {
    
    // 獲取房主名稱，優先使用客戶端提交的，其次是 socket.data 中的，最後是預設名稱
    const hostNameFromClient = clientSettings.playerName || socket.data.playerName || DEFAULT_HOST_NAME; 

    // 驗證房間名稱
    if (!clientSettings.roomName || clientSettings.roomName.trim().length === 0 || clientSettings.roomName.length > MAX_ROOM_NAME_LENGTH) {
        callback({ success: false, message: `房間名稱無效或過長 (最多 ${MAX_ROOM_NAME_LENGTH} 字元)` });
        return;
    }
    // 驗證房間密碼長度
    if (clientSettings.password && clientSettings.password.length > MAX_PASSWORD_LENGTH) {
        callback({ success: false, message: `房間密碼過長 (最多 ${MAX_PASSWORD_LENGTH} 字元)` });
        return;
    }
    // 驗證真人玩家數量設定
    if (clientSettings.humanPlayers < 1 || clientSettings.humanPlayers > NUM_PLAYERS) {
        callback({ success: false, message: `真人玩家數量設定無效 (1-${NUM_PLAYERS})`});
        return;
    }

    // 生成唯一的房間ID
    const roomId = `room-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const actualHumanPlayers = clientSettings.humanPlayers; // 使用客戶端設定的真人玩家數
    let aiPlayers = 0; // AI玩家數量
    // 如果設定了用AI填充，則計算所需AI數量以達到總玩家數 NUM_PLAYERS
    if (clientSettings.fillWithAI) {
        aiPlayers = NUM_PLAYERS - actualHumanPlayers;
    }
    aiPlayers = Math.max(0, aiPlayers); // 確保AI數量不為負

    // 構建完整的房間設定物件
    const fullRoomSettings: RoomSettings = {
      roomName: clientSettings.roomName.trim(),
      humanPlayers: actualHumanPlayers,
      fillWithAI: clientSettings.fillWithAI,
      password: clientSettings.password ? clientSettings.password.trim() : undefined, // 密碼可選
      numberOfRounds: clientSettings.numberOfRounds || DEFAULT_NUMBER_OF_ROUNDS, // 局數，若未提供則使用預設值
      id: roomId,
      hostName: hostNameFromClient, // 房主名稱
      hostSocketId: socket.id, // 房主 Socket ID
      maxPlayers: NUM_PLAYERS, // 最大玩家數 (固定值)
      aiPlayers: aiPlayers, // 計算出的AI玩家數量
    };

    // 創建新的 GameRoom 實例
    const gameRoom = new GameRoom(roomId, fullRoomSettings, this.io, () => this.removeRoom(roomId));
    this.rooms.set(roomId, gameRoom); // 將房間加入到管理列表

    console.info(`[RoomManager] 玩家 ${hostNameFromClient} (Socket: ${socket.id}) 創建房間: ${fullRoomSettings.roomName} (ID: ${roomId})`); // Log level adjusted
    
    socket.leave(LOBBY_ROOM_NAME); // 讓創建者離開大廳
    console.info(`[RoomManager] Socket ${socket.id} 已離開 '${LOBBY_ROOM_NAME}' 群組，加入遊戲房間 ${roomId}。`); // Log level adjusted
    // 將房主加入到新創建的遊戲房間
    const addSuccess = gameRoom.addPlayer(socket, hostNameFromClient, true); // isHost = true

    if (addSuccess) { // 如果房主成功加入
        callback({ success: true, roomId }); // 回調成功訊息和房間ID
        this.broadcastLobbyUpdate(); // 廣播大廳房間列表更新
    } else { // 如果房主加入失敗 (理論上不應發生)
        this.rooms.delete(roomId); // 清理創建失敗的房間
        socket.join(LOBBY_ROOM_NAME); // 讓玩家重新加入大廳
        callback({ success: false, message: "創建房間失敗：無法將主持人加入房間。" });
    }
  }

  /**
   * @description 處理玩家加入已存在房間的請求。
   * @param {Socket} socket - 嘗試加入房間的玩家的 Socket 連接實例。
   * @param {object} data - 包含房間ID、密碼(可選)及玩家名稱的資料。
   * @param {string} data.roomId - 要加入的房間ID。
   * @param {string} [data.password] - 房間密碼。
   * @param {string} data.playerName - 加入者的玩家名稱。
   * @param {(ack: { success: boolean; message?: string }) => void} callback - 操作完成後的回調函數。
   */
  public joinRoom(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
                  data: { roomId: string; password?: string; playerName: string },  
                  callback: (ack: { success: boolean; message?: string }) => void): void {
    const room = this.rooms.get(data.roomId); // 查找房間
    if (!room) { // 如果房間不存在
      callback({ success: false, message: '房間不存在。' });
      return;
    }
    const roomSettings = room.getSettings(); // 獲取房間設定
    // 驗證密碼 (如果房間有密碼保護)
    if (roomSettings.password && roomSettings.password !== data.password) {
        callback({ success: false, message: '房間密碼錯誤。'});
        return;
    }
    
    // 獲取玩家名稱
    const playerName = data.playerName || socket.data.playerName || DEFAULT_PLAYER_NAME;

    // 檢查房間的真人玩家名額是否已滿
    const currentHumanPlayersInRoom = room.getPlayers().filter(p => p.isHuman && p.isOnline).length;
    if (currentHumanPlayersInRoom >= roomSettings.humanPlayers) {
        callback({ success: false, message: '房間的真人玩家名額已滿。'});
        return;
    }

    // 檢查遊戲是否已開始 (如果不是等待階段，則無法加入)
    const gameState = room.getGameState();
    if (gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS) {
        callback({ success: false, message: '遊戲已經開始，無法加入。'});
        return;
    }

    console.info(`[RoomManager] 玩家 ${playerName} (Socket: ${socket.id}) 嘗試加入房間: ${room.getSettings().roomName} (ID: ${data.roomId})`); // Log level adjusted
    
    socket.leave(LOBBY_ROOM_NAME); // 讓玩家離開大廳
    console.info(`[RoomManager] Socket ${socket.id} 已離開 '${LOBBY_ROOM_NAME}' 群組，準備加入遊戲房間 ${data.roomId}。`); // Log level adjusted
    // 嘗試將玩家加入到遊戲房間
    const successfullyAdded = room.addPlayer(socket, playerName, false); // isHost = false

    if (successfullyAdded) { // 如果成功加入
        callback({ success: true, message: '成功請求加入房間，等待伺服器回應...'}); 
        this.broadcastLobbyUpdate(); // 廣播大廳房間列表更新
    } else { // 如果加入失敗
        socket.join(LOBBY_ROOM_NAME); // 讓玩家重新加入大廳
        console.warn(`[RoomManager] Socket ${socket.id} 加入遊戲房間 ${data.roomId} 失敗，已重新加入 '${LOBBY_ROOM_NAME}' 群組。`); // Log level adjusted
        callback({ success: false, message: '無法加入房間，可能已滿員或發生錯誤。'});
    }
  }

  /**
   * @description 處理玩家離開遊戲房間的邏輯。
   * @param {Socket} socket - 離開房間的玩家的 Socket 連接實例。
   * @param {string} roomId - 玩家要離開的房間ID。
   */
  public leaveRoom(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, roomId: string): void {
    const room = this.rooms.get(roomId); // 查找房間
    if (room) { // 如果房間存在
      const playerName = socket.data.playerName || `Socket ${socket.id}`;
      console.info(`[RoomManager] 玩家 ${playerName} 請求離開房間: ${roomId}`); // Log level adjusted
      room.removePlayer(socket.id); // 從遊戲房間移除玩家
      socket.join(LOBBY_ROOM_NAME); // 讓玩家加入大廳
      console.info(`[RoomManager] Socket ${socket.id} 已重新加入 '${LOBBY_ROOM_NAME}' 群組。`); // Log level adjusted
      this.broadcastLobbyUpdate(); // 廣播大廳更新
    }
  }
  
  /**
   * @description 處理玩家斷線的邏輯。
   * @param {Socket} socket - 斷線的玩家的 Socket 連接實例。
   */
  public handlePlayerDisconnect(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>): void {
    const roomId = socket.data.currentRoomId; // 獲取玩家斷線前所在的房間ID
    if (roomId) { // 如果玩家在某個房間內
        const room = this.rooms.get(roomId);
        if (room && room.hasPlayer(socket.id)) { // 如果房間存在且玩家確實屬於該房間
            const playerName = socket.data.playerName || `Socket ${socket.id}`;
            console.info(`[RoomManager] 偵測到玩家 ${playerName} (Socket: ${socket.id}) 斷線，將從房間 ${room.getSettings().roomName} 處理。`); // Log level adjusted
            room.removePlayer(socket.id); // 從遊戲房間移除玩家 (GameRoom內部會處理離線邏輯)
            this.broadcastLobbyUpdate(); // 廣播大廳更新
        }
    } else { // 如果玩家斷線時不在任何遊戲房間內 (可能在大廳)
        socket.leave(LOBBY_ROOM_NAME); // 確保其離開大廳 (以防萬一)
        console.info(`[RoomManager] 玩家 ${socket.data.playerName || socket.id} 斷線，但未加入任何房間。已確保其離開 '${LOBBY_ROOM_NAME}' 群組。`); // Log level adjusted
    }
  }

  /**
   * @description 獲取當前所有房間的列表資訊 (用於大廳顯示)。
   * @returns {RoomListData[]} 房間列表數據陣列。
   */
  public getLobbyRoomsData(): RoomListData[] {
    const lobbyData: RoomListData[] = [];
    this.rooms.forEach(room => { // 遍歷所有房間
      const settings = room.getSettings(); // 獲取房間設定
      const gameState = room.getGameState(); // 獲取遊戲狀態
      const playersInRoom = room.getPlayers(); // 獲取房間內玩家列表 (ServerPlayer[])

      // 計算當前在線的真人玩家數量
      const currentHumanPlayersCount = playersInRoom.filter(p => p.isHuman && p.isOnline).length;
      // 房間內總玩家實體數 (包含AI，如果遊戲已開始且AI已加入)
      const totalPlayersInGameRoomObject = playersInRoom.length;

      // 構建用於大廳列表的房間數據
      lobbyData.push({
        id: settings.id,
        name: settings.roomName,
        playersCount: totalPlayersInGameRoomObject, // 房間內總玩家實體數
        maxPlayers: settings.maxPlayers, // 房間最大玩家數 (通常為 NUM_PLAYERS)
        currentHumanPlayers: currentHumanPlayersCount, // 當前在線真人數
        targetHumanPlayers: settings.humanPlayers, // 房間設定的目標真人數
        // 根據遊戲階段判斷房間狀態
        status: gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS ? '等待中' : (gameState.gamePhase === GamePhase.GAME_OVER && gameState.matchOver ? '已結束' : '遊戲中'),
        passwordProtected: !!settings.password, // 是否有密碼保護
        numberOfRounds: settings.numberOfRounds, // 總局數
        hostName: settings.hostName, // 房主名稱
      });
    });
    return lobbyData;
  }

  /**
   * @description 向所有在大廳 ('lobby' 群組) 的客戶端廣播最新的房間列表。
   */
  public broadcastLobbyUpdate(): void {
    const clientsInLobby = this.io.sockets.adapter.rooms.get(LOBBY_ROOM_NAME); // 獲取大廳內的客戶端
    const numClientsInLobby = clientsInLobby ? clientsInLobby.size : 0; // 大廳客戶端數量
    this.io.to(LOBBY_ROOM_NAME).emit('lobbyRoomList', this.getLobbyRoomsData()); // 廣播房間列表
    console.info(`[RoomManager] 已廣播房間列表更新至 '${LOBBY_ROOM_NAME}' 群組 (${numClientsInLobby} 個客戶端)。`); // Log level adjusted
  }

  /**
   * @description 從管理列表中移除一個遊戲房間並銷毀它。
   * @param {string} roomId - 要移除的房間ID。
   */
  private removeRoom(roomId: string): void {
    const room = this.rooms.get(roomId); // 查找房間
    if (room) { // 如果房間存在
        const roomName = room.getSettings().roomName;
        room.destroy(); // 銷毀遊戲房間內部狀態 (例如計時器)
        this.rooms.delete(roomId); // 從管理列表中移除
        console.info(`[RoomManager] 房間 ${roomName} (ID: ${roomId}) 已被移除並銷毀。`); // Log level adjusted
        this.broadcastLobbyUpdate(); // 廣播大廳更新
    }
  }

  /**
   * @description 根據房間ID獲取 GameRoom 實例。
   * @param {string} roomId - 房間ID。
   * @returns {GameRoom | undefined} 如果找到則返回 GameRoom 實例，否則返回 undefined。
   */
  public getRoomById(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * @description 發送大廳聊天訊息。
   * @param {Socket} socket - 發送訊息的玩家的 Socket 連接實例。
   * @param {string} messageText - 訊息內容。
   */
  public sendLobbyChatMessage(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, messageText: string) {
    if (!messageText.trim()) return; // 忽略空訊息

    const playerName = socket.data.playerName || DEFAULT_PLAYER_NAME; // 獲取玩家名稱
    // 構建聊天訊息物件
    const chatMessage: ChatMessage = {
        id: `lobby-chat-${Date.now()}`, // 訊息唯一ID
        senderName: playerName,
        senderId: socket.id, // 發送者 Socket ID
        text: messageText.substring(0, 100), // 訊息內容 (限制長度)
        timestamp: Date.now(), // 時間戳
        type: 'player' // 訊息類型為玩家訊息
    };
    this.io.to(LOBBY_ROOM_NAME).emit('lobbyChatMessage', chatMessage); // 向大廳廣播聊天訊息
    console.debug(`[LobbyChat] ${playerName}: ${messageText} (發送到 '${LOBBY_ROOM_NAME}' 群組)`); // Log level adjusted
  }
}
