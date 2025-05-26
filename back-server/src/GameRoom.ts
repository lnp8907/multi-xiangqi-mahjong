
// 引入 Socket.IO 相關類型
import { Server, Socket } from 'socket.io';
// 引入遊戲相關類型定義
import {
    GameState, Player, Tile, Meld, RoomSettings, GamePhase, TileKind, Claim, GameActionPayload, MeldDesignation, ChatMessage,
    ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData, AIExecutableAction, Suit, RematchVote
} from './types';
// 引入遊戲常數
import {
    NUM_PLAYERS, INITIAL_HAND_SIZE_DEALER, INITIAL_HAND_SIZE_NON_DEALER, ACTION_PRIORITY,
    CLAIM_DECISION_TIMEOUT_SECONDS, PLAYER_TURN_ACTION_TIMEOUT_SECONDS,
    NEXT_ROUND_COUNTDOWN_SECONDS, SYSTEM_SENDER_NAME, AI_THINK_TIME_MS_MIN, AI_THINK_TIME_MS_MAX,
    MAX_HAND_SIZE_BEFORE_DISCARD, ACTION_TIMER_INTERVAL_MS, EMPTY_ROOM_TIMEOUT_MS, GAME_END_EMPTY_ROOM_TIMEOUT_MS,
    TILE_KIND_DETAILS, MAX_MESSAGE_LOG_ENTRIES, AI_NAME_PREFIX, DEFAULT_NUMBER_OF_ROUNDS,
    // Fix: Import LOBBY_ROOM_NAME
    LOBBY_ROOM_NAME
} from './constants';
// 引入牌堆管理相關輔助函數
import { createInitialDeck, shuffleDeck, dealTiles, sortHandVisually } from './utils/deckManager';
// 引入遊戲規則相關輔助函數
import {
    checkWinCondition, getChiOptions, canPeng, canMingGang,
    canDeclareAnGang, canDeclareMingGangFromHand, removeTilesFromHand, countTilesOfKind, findTileInHand
} from './utils/gameRules';
// 引入 AI 服務
import { AIService } from './AIService';
// 引入伺服器端玩家類別
import { ServerPlayer } from './Player';

const REMATCH_VOTE_TIMEOUT_SECONDS = 30; // 再戰投票的超時時間 (秒)

/**
 * @class GameRoom
 * @description 管理單個遊戲房間的邏輯，包括遊戲狀態、玩家互動、AI行為等。
 */
export class GameRoom {
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>; // Socket.IO 伺服器實例
  public roomId: string; // 房間的唯一ID
  private roomSettings: RoomSettings; // 房間的設定
  private gameState: GameState; // 當前的遊戲狀態
  private players: ServerPlayer[] = []; // 房間內的玩家列表 (伺服器端權威來源，按座位ID排序)
  private aiService: AIService; // AI 決策服務
  private onRoomEmptyCallback: () => void; // 當房間變空時的回調函數 (通知 RoomManager 移除此房間)
  private emptyRoomTimer: NodeJS.Timeout | null = null; // 空房間自動關閉的計時器
  private actionTimerInterval: NodeJS.Timeout | null = null; // 玩家行動計時器的間隔
  private nextRoundTimerInterval: NodeJS.Timeout | null = null; // 下一局開始倒數的計時器間隔
  private rematchTimerInterval: NodeJS.Timeout | null = null; // 再戰投票倒數的計時器間隔
  private aiActionTimeout: NodeJS.Timeout | null = null; // AI 行動延遲的計時器
  private actionSubmitLock: Set<number> = new Set(); // 用於防止玩家重複提交動作的鎖 (儲存玩家ID)


  /**
   * @constructor
   * @param {string} roomId - 房間ID。
   * @param {RoomSettings} settings - 房間設定。
   * @param {Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>} io - Socket.IO 伺服器實例。
   * @param {() => void} onRoomEmptyCallback - 房間變空時的回調。
   */
  constructor(
    roomId: string,
    settings: RoomSettings,
    io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    onRoomEmptyCallback: () => void
  ) {
    this.io = io;
    this.roomId = roomId;
    // 確保 roomSettings.numberOfRounds 有一個預設值
    this.roomSettings = {
        ...settings,
        numberOfRounds: settings.numberOfRounds || DEFAULT_NUMBER_OF_ROUNDS,
    };
    this.aiService = new AIService(); // 初始化 AI 服務
    this.onRoomEmptyCallback = onRoomEmptyCallback; // 設定空房回調

    this.gameState = this.createInitialCleanGameState(); // 創建初始化的乾淨遊戲狀態
    this.resetEmptyRoomTimer(); // 啟動空房間檢測計時器

    console.log(`[GameRoom ${this.roomId}] 創建成功，設定:`, JSON.stringify(this.roomSettings));
  }

  /**
   * @description 創建一個初始且乾淨的遊戲狀態物件。
   * @returns {GameState} 初始遊戲狀態。
   */
  private createInitialCleanGameState(): GameState {
    return {
      roomId: this.roomId,
      roomName: this.roomSettings.roomName, // 從房間設定初始化房間名稱
      players: [], // 玩家列表初始為空
      deck: [], // 牌堆初始為空
      discardPile: [], // 棄牌堆初始為空
      currentPlayerIndex: 0, // 當前回合玩家索引
      dealerIndex: 0, // 莊家索引
      lastDiscarderIndex: null, // 上一個打牌的玩家索引
      gamePhase: GamePhase.LOADING, // 初始遊戲階段為載入中
      lastDiscardedTile: null, // 上一張棄牌
      lastDrawnTile: null, // 上一張摸到的牌
      turnNumber: 0, // 回合數
      messageLog: [], // 遊戲訊息記錄
      potentialClaims: [], // 潛在的宣告列表
      winnerId: null, // 贏家ID
      winningTileDiscarderId: null, // 放槍者ID
      winType: null, // 胡牌類型
      winningDiscardedTile: null, // 胡的那張牌
      isDrawGame: false, // 是否為流局
      chiOptions: null, // 吃牌選項 (供真人玩家選擇)
      playerMakingClaimDecision: null, // 正在做宣告決定的玩家ID
      actionTimer: null, // 行動計時器剩餘時間
      actionTimerType: null, // 計時器類型 ('claim' 或 'turn')
      numberOfRounds: this.roomSettings.numberOfRounds, // 總局數 (從房間設定初始化)
      currentRound: 1, // 當前局數
      matchOver: false, // 比賽是否結束
      nextRoundCountdown: null, // 下一局開始倒數
      humanPlayersReadyForNextRound: [], // 已確認下一局的真人玩家列表
      configuredHumanPlayers: this.roomSettings.humanPlayers, // 配置的真人玩家數 (從房間設定初始化)
      configuredFillWithAI: this.roomSettings.fillWithAI, // 是否用AI填充 (從房間設定初始化)
      hostPlayerName: this.roomSettings.hostName, // 房主名稱 (從房間設定初始化)
      rematchVotes: [], // 初始化再戰投票
      rematchCountdown: null, // 初始化再戰倒數
    };
  }

  /**
   * @description 初始化或重置一局遊戲的狀態。
   * @param {boolean} isNewMatch - 是否為一場全新的比賽 (相對於開始下一局)。
   */
  private initializeOrResetGameForRound(isNewMatch: boolean): void {
    // 如果是新比賽，重置局數、分數，並隨機決定初始莊家
    if (isNewMatch) {
        this.gameState.currentRound = 1;
        this.gameState.matchOver = false;
        this.players.forEach(p => p.score = 0); // 所有玩家分數歸零
        if (this.players.length > 0) {
            // 隨機選擇莊家
            this.gameState.dealerIndex = Math.floor(Math.random() * this.players.length);
            this.players.forEach((p) => p.isDealer = (p.id === this.gameState.dealerIndex));
        } else {
            this.gameState.dealerIndex = 0; // 若無玩家，預設莊家為0 (理論上不應發生於此)
        }
        this.addLog(`新比賽開始！共 ${this.gameState.numberOfRounds} 局。`);
    } else { // 如果是開始下一局
        if (this.players.length > 0) {
            // 決定下一局莊家：若本局流局或非莊家胡牌，則莊家輪莊 (順延一位)
            if (this.gameState.winnerId === null || (this.gameState.winnerId !== null && this.gameState.winnerId !== this.gameState.dealerIndex)) {
                this.gameState.dealerIndex = (this.gameState.dealerIndex + 1) % this.players.length;
            }
            // 若莊家胡牌，則莊家連莊 (dealerIndex 不變)
            this.players.forEach((p) => p.isDealer = (p.id === this.gameState.dealerIndex));
        }
        this.addLog(`準備開始第 ${this.gameState.currentRound}/${this.gameState.numberOfRounds} 局。`);
    }
    // 更新遊戲狀態中的房間設定相關資訊 (確保是最新的)
    this.gameState.roomName = this.roomSettings.roomName;
    this.gameState.configuredHumanPlayers = this.roomSettings.humanPlayers;
    this.gameState.configuredFillWithAI = this.roomSettings.fillWithAI;
    this.gameState.hostPlayerName = this.roomSettings.hostName;
    this.gameState.numberOfRounds = this.roomSettings.numberOfRounds; // 確保同步

    // 重置所有玩家的本局狀態 (手牌、面子)
    this.players.forEach((p) => { 
        p.hand = [];
        p.melds = [];
        console.log(`[GameRoom ${this.roomId}] 本局初始化: 玩家 ${p.id} (${p.name}) - 真人: ${p.isHuman}, 莊家: ${p.isDealer}`);
    });

    // 重置牌堆、棄牌堆等遊戲核心狀態
    this.gameState.deck = shuffleDeck(createInitialDeck()); // 創建並洗牌
    this.gameState.discardPile = [];
    this.gameState.lastDiscardedTile = null;
    this.gameState.lastDrawnTile = null;
    this.gameState.turnNumber = 1; // 本局的第一回合
    this.gameState.potentialClaims = [];
    this.gameState.winnerId = null;
    this.gameState.winningTileDiscarderId = null;
    this.gameState.winType = null;
    this.gameState.winningDiscardedTile = null;
    this.gameState.isDrawGame = false;
    this.gameState.chiOptions = null;
    this.gameState.playerMakingClaimDecision = null;
    this.clearActionTimer(); // 清除行動計時器
    this.clearNextRoundTimer(); // 清除下一局倒數計時器
    this.clearRematchTimer(); // 清除再戰倒數計時器
    this.gameState.humanPlayersReadyForNextRound = []; // 清空已確認下一局的玩家列表
    this.gameState.rematchVotes = []; // 清空再戰投票

    this.sortPlayersById(); // 確保玩家列表按ID排序
    this.updateGameStatePlayers(); // 更新 gameState.players (用於廣播)

    // 發牌
    const { hands, remainingDeck } = dealTiles(
        this.gameState.deck,
        this.gameState.players, // 使用 this.players (ServerPlayer[]) 進行發牌邏輯
        this.gameState.dealerIndex, 
        INITIAL_HAND_SIZE_DEALER,
        INITIAL_HAND_SIZE_NON_DEALER
    );

    // 將發好的牌分配給每個玩家
    this.players.forEach((p) => {
        p.hand = sortHandVisually(hands[p.id]); // 手牌排序後存入
    });
    this.gameState.deck = remainingDeck; // 更新剩餘牌堆
    this.updateGameStatePlayers(); // 再次更新 gameState.players 以包含手牌

    // 設定初始回合玩家為莊家
    this.gameState.currentPlayerIndex = this.gameState.dealerIndex; 
    const dealerPlayer = this.players.find(p => p.id === this.gameState.dealerIndex); 
    
    if(!dealerPlayer) { // 防禦性檢查：莊家是否存在
        console.error(`[GameRoom ${this.roomId}] 嚴重錯誤: 發牌後找不到莊家 (ID: ${this.gameState.dealerIndex})。遊戲無法繼續。`);
        this.addLog("嚴重錯誤：找不到莊家，遊戲無法繼續。");
        this.gameState.isDrawGame = true; // 標記為流局
        this.handleRoundEndFlow(); // 處理局結束流程
        this.broadcastGameState(); // 廣播遊戲狀態
        return;
    }

    this.addLog(`莊家是 ${dealerPlayer.name} (${dealerPlayer.isHuman ? '真人' : 'AI'}, 座位: ${dealerPlayer.id})。`);

    // 莊家初始有8張牌，直接進入等待出牌階段，並將第8張牌視為 "剛摸到的牌"
    if (dealerPlayer.hand.length === INITIAL_HAND_SIZE_DEALER && dealerPlayer.hand.length > 0) {
        this.gameState.lastDrawnTile = dealerPlayer.hand[dealerPlayer.hand.length - 1]; // 第8張牌
        this.gameState.gamePhase = GamePhase.AWAITING_DISCARD; // 等待莊家打出第一張牌
        this.addLog(`輪到莊家 ${dealerPlayer.name} (座位: ${dealerPlayer.id}) 打牌。`);
    } else { // 非莊家或其他情況，進入摸牌階段
        this.gameState.gamePhase = GamePhase.PLAYER_TURN_START;
        this.addLog(`輪到 ${dealerPlayer.name} (座位: ${dealerPlayer.id}) 摸牌。`);
    }

    this.broadcastGameState(); // 廣播更新後的遊戲狀態
    this.startActionTimerForPlayer(this.gameState.currentPlayerIndex); // 為莊家啟動行動計時器
    this.processAITurnIfNeeded(); // 如果莊家是AI，則處理其行動
  }

  /**
   * @description 初始化AI玩家以填補空位。
   *              此函數現在更通用，會根據當前房間內真人玩家數量和 NUM_PLAYERS 來決定需要多少AI。
   */
  private initializeAIPlayers(): void {
    const currentHumanPlayersCount = this.players.filter(p => p.isHuman).length; // 計算已有的真人玩家數 (無論是否在線)
    let aisNeeded = NUM_PLAYERS - currentHumanPlayersCount; // 需要的AI數量
    aisNeeded = Math.max(0, aisNeeded); // 確保不為負

    console.log(`[GameRoom ${this.roomId}] 初始化/填充AI玩家: 房間目標總人數=${NUM_PLAYERS}, 當前真人數=${currentHumanPlayersCount}, 需要AI數=${aisNeeded}`);

    if (aisNeeded > 0) {
        let aiNameCounter = this.players.filter(p => !p.isHuman).length; // 現有AI數量，用於命名
        for (let i = 0; i < NUM_PLAYERS; i++) { // 遍歷所有座位
            if (aisNeeded <= 0) break; // AI已填滿

            const seatIsOccupied = this.players.some(p => p.id === i); // 座位i是否已被佔用
            if (!seatIsOccupied) { // 如果座位空閒
                const aiName = `${AI_NAME_PREFIX}${String.fromCharCode(65 + aiNameCounter)}`;
                const aiPlayer = new ServerPlayer(i, aiName, false, null, false);
                this.players.push(aiPlayer);
                this.addLog(`${aiName} (AI, 座位 ${i}) 已加入遊戲。`);
                console.log(`[GameRoom ${this.roomId}] AI 玩家 ${aiName} (ID: ${i}) 加入。`);
                aisNeeded--;
                aiNameCounter++;
            }
        }
    }
    this.sortPlayersById();
    this.updateGameStatePlayers();
    console.log(`[GameRoom ${this.roomId}] AI填充完成後, this.players: ${this.players.map(p=>`(ID:${p.id},N:${p.name},H:${p.isHuman})`).join('; ')}`);
  }


  /**
   * @description 對 this.players 列表按玩家ID (座位索引) 進行升序排序。
   */
  private sortPlayersById(): void {
    this.players.sort((a, b) => a.id - b.id);
  }

  /**
   * @description 更新 this.gameState.players 陣列，使其與 this.players (權威來源) 同步。
   *              同時處理手牌的隱藏邏輯 (對非當前客戶端的其他真人玩家隱藏手牌)。
   */
  private updateGameStatePlayers(): void {
    this.sortPlayersById(); // 確保 this.players 是排序的
    // 映射 this.players 到 gameState.players，並進行深拷貝及手牌隱藏處理
    this.gameState.players = this.players.map(p => ({
        id: p.id, 
        name: p.name,
        isHuman: p.isHuman,
        // 手牌顯示邏輯：
        // 1. 如果是真人玩家且在線，或者遊戲/本局已結束，或者正在等待再戰投票，則顯示真實手牌。
        // 2. 否則 (AI玩家，或離線/非主視角的真人玩家且遊戲進行中)，顯示隱藏的牌 (牌背)。
        hand: (p.isHuman && p.isOnline) || 
              (this.gameState.gamePhase === GamePhase.GAME_OVER || 
               this.gameState.gamePhase === GamePhase.ROUND_OVER ||
               this.gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES)
              ? [...p.hand] // 深拷貝真實手牌
              // 創建一個長度與手牌相同的陣列，內容為佔位的牌物件 (代表牌背)
              : Array(p.hand.length).fill({id:`hidden-${p.id}-${Math.random()}`, kind: TileKind.B_SOLDIER, suit: Suit.BLACK} as Tile), 
        melds: p.melds.map(m => ({...m, tiles: [...m.tiles]})), // 深拷貝面子
        isDealer: p.isDealer,
        score: p.score,
        isOnline: p.isOnline,
        socketId: p.socketId, // 傳輸 socketId 以供除錯或客戶端進階邏輯使用 (可選)
        pendingClaims: p.pendingClaims ? [...p.pendingClaims] : [], // 深拷貝待宣告動作
        isHost: p.isHost,
    }));
  }

  /** @description 獲取當前房間的設定。 */
  public getSettings(): RoomSettings {
    return this.roomSettings;
  }

  /** 
   * @description 獲取當前完整的遊戲狀態 (深拷貝)。
   *              確保遊戲狀態中的房間相關設定是最新的。
   */
  public getGameState(): GameState {
    this.updateGameStatePlayers(); // 確保 gameState.players 是最新的
    // 創建遊戲狀態的深拷貝副本，並更新其中可能從 roomSettings 變動的欄位
    const currentFullGameState = {
        ...JSON.parse(JSON.stringify(this.gameState)), 
        roomName: this.roomSettings.roomName, 
        configuredHumanPlayers: this.roomSettings.humanPlayers, 
        configuredFillWithAI: this.roomSettings.fillWithAI,
        hostPlayerName: this.roomSettings.hostName,
        numberOfRounds: this.roomSettings.numberOfRounds, // 確保這裡是最新的
    };
    return currentFullGameState;
  }

  /** @description 獲取房間內玩家列表 (唯讀)。 */
  public getPlayers(): ReadonlyArray<ServerPlayer> {
    return this.players;
  }

  /** @description 檢查房間的真人玩家名額是否已滿。 */
  public isFull(): boolean { 
    return this.players.filter(p => p.isHuman && p.isOnline).length >= this.roomSettings.humanPlayers;
  }

   /** @description 檢查房間內是否沒有在線的真人玩家。 */
  public isEmpty(): boolean { 
    return this.players.filter(p => p.isHuman && p.isOnline).length === 0;
  }

  /** @description 檢查指定 socketId 的玩家是否在房間內。 */
  public hasPlayer(socketId: string): boolean {
    return this.players.some(p => p.socketId === socketId);
  }

  /**
   * @description 向遊戲訊息記錄中添加一條帶時間戳的訊息。
   * @param {string} message - 要記錄的訊息內容。
   */
  private addLog(message: string): void {
    const timedMessage = `${new Date().toLocaleTimeString('zh-TW', { hour12: false})} - ${message}`;
    this.gameState.messageLog.unshift(timedMessage); // 將新訊息添加到記錄陣列的開頭
    // 維護訊息記錄的最大長度
    if (this.gameState.messageLog.length > MAX_MESSAGE_LOG_ENTRIES) {
      this.gameState.messageLog.pop(); // 移除最舊的訊息
    }
  }

  /**
   * @description 清除所有玩家的待宣告動作、潛在宣告列表、正在做宣告決定的玩家標記、
   *              行動計時器以及吃牌選項。
   */
  private clearClaimsAndTimer(): void {
    this.players.forEach(p => p.pendingClaims = []); // 清除每個玩家的待宣告動作
    this.gameState.potentialClaims = []; // 清除潛在宣告列表
    this.gameState.playerMakingClaimDecision = null; // 清除正在做宣告決定的玩家標記
    this.clearActionTimer(); // 清除行動計時器
    this.gameState.chiOptions = null; // 清除吃牌選項
  }

  /**
   * @description 重置空房間計時器。如果房間內已無真人玩家，則啟動計時器；否則清除計時器。
   * @param {boolean} [isGameEnded=false] - 遊戲是否已結束 (影響計時器時長)。
   */
  private resetEmptyRoomTimer(isGameEnded = false): void {
    if (this.emptyRoomTimer) { // 如果已有計時器，先清除
      clearTimeout(this.emptyRoomTimer);
      this.emptyRoomTimer = null;
    }
    if (this.isEmpty()) { // 如果房間內沒有在線的真人玩家
      // 根據遊戲是否結束設定不同的超時時長
      const timeoutDuration = isGameEnded ? GAME_END_EMPTY_ROOM_TIMEOUT_MS : EMPTY_ROOM_TIMEOUT_MS;
      this.emptyRoomTimer = setTimeout(() => {
        if (this.isEmpty()) { // 超時後再次檢查房間是否仍為空
          console.log(`[GameRoom ${this.roomId}] 房間因長時間無真人玩家而關閉。`);
          this.onRoomEmptyCallback(); // 觸發房間關閉回調
        }
      }, timeoutDuration);
    }
  }

/**
 * @description 將一個新玩家加入到遊戲房間，或處理重連玩家。
 * @param {Socket} socket - 玩家的 Socket 連接實例。
 * @param {string} playerName - 玩家的名稱。
 * @param {boolean} isHost - 該玩家是否為房主。
 * @returns {boolean} 如果成功加入或重連，返回 true；否則返回 false。
 */
public addPlayer(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, playerName: string, isHost: boolean): boolean {
    console.log(`[GameRoom ${this.roomId}] addPlayer: 嘗試加入玩家 ${playerName} (房主: ${isHost})。目前房間內玩家數: ${this.players.length}`);

    // 情況1：處理重連玩家 (根據 socket.id 查找)
    const existingPlayerBySocketId = this.players.find(p => p.socketId === socket.id);
    if (existingPlayerBySocketId) {
        existingPlayerBySocketId.isOnline = true; // 標記為在線
        existingPlayerBySocketId.name = playerName; // 更新名稱 (如果客戶端更改了)
        socket.data.currentRoomId = this.roomId; // 更新 socket 上的房間資訊
        socket.data.playerId = existingPlayerBySocketId.id; // 確保 socket 上的座位ID正確
        socket.join(this.roomId); // 重新加入 Socket.IO 房間
        // 向該玩家發送當前遊戲狀態，使其同步
        this.io.to(socket.id).emit('joinedRoom', { gameState: this.getGameState(), roomId: this.roomId, clientPlayerId: existingPlayerBySocketId.id });
        this.addLog(`${existingPlayerBySocketId.name} (座位: ${existingPlayerBySocketId.id}) 已重新連接。`);
        console.log(`[GameRoom ${this.roomId}] 玩家 ${playerName} (ID: ${existingPlayerBySocketId.id}) 重新連接成功。`);
        this.broadcastGameState(); // 廣播遊戲狀態 (通知其他玩家此人已上線)
        this.resetEmptyRoomTimer(); // 重置空房計時器
        return true;
    }

    // 情況2：檢查房間真人玩家名額是否已滿
    if (this.players.filter(p => p.isHuman && p.isOnline).length >= this.roomSettings.humanPlayers) {
        socket.emit('lobbyError', '房間的真人玩家名額已滿。');
        console.log(`[GameRoom ${this.roomId}] 玩家 ${playerName} 加入失敗：真人玩家名額已滿。`);
        return false;
    }

    let assignedSeatIndex = -1; // 分配給新玩家的座位索引
    // 嘗試恢復離線玩家的座位 (根據名稱匹配)
    const offlineHumanPlayerByName = this.players.find(p => p.isHuman && !p.isOnline && p.name === playerName);

    if (offlineHumanPlayerByName) { // 如果找到了同名的離線真人玩家
        assignedSeatIndex = offlineHumanPlayerByName.id;
        offlineHumanPlayerByName.socketId = socket.id; // 更新 socketId
        offlineHumanPlayerByName.isOnline = true;      // 標記為在線
        offlineHumanPlayerByName.isHost = isHost;      // 更新房主狀態 (如果原房主重連)
        this.addLog(`${offlineHumanPlayerByName.name} (座位: ${assignedSeatIndex}) 的席位已恢復。`);
        console.log(`[GameRoom ${this.roomId}] 玩家 ${playerName} (ID: ${assignedSeatIndex}) 已恢復離線座位。`);
    } else { // 如果是全新玩家或名稱不符，尋找空位
        for (let i = 0; i < NUM_PLAYERS; i++) { // 遍歷所有座位 (0 到 NUM_PLAYERS-1)
            if (!this.players.some(p => p.id === i)) { // 如果座位 i 未被佔用
                assignedSeatIndex = i; // 分配此座位
                break;
            }
        }
    }

    // 如果找不到可用座位 (理論上在檢查真人玩家名額後，此情況較少發生，除非AI已填滿)
    if (assignedSeatIndex === -1) {
        socket.emit('lobbyError', '無法找到空位加入房間。');
        console.log(`[GameRoom ${this.roomId}] 玩家 ${playerName} 加入失敗：找不到可用座位。`);
        return false;
    }

    // 如果是全新玩家 (不是恢復離線座位)，則創建新的 ServerPlayer 物件
    if (!offlineHumanPlayerByName) { 
        const newPlayer = new ServerPlayer(assignedSeatIndex, playerName, true, socket.id, isHost);
        this.players.push(newPlayer); // 加入到房間玩家列表
        this.sortPlayersById();       // 排序玩家列表
        if (isHost) { // 如果此玩家是房主
            this.roomSettings.hostName = playerName;         // 更新房間設定中的房主名稱
            this.roomSettings.hostSocketId = socket.id;      // 更新房主 Socket ID
            this.players.forEach(p => p.isHost = (p.id === newPlayer.id)); // 設定此玩家為房主，其他玩家非房主
        }
        console.log(`[GameRoom ${this.roomId}] 新玩家 ${playerName} (ID: ${newPlayer.id}) 已加入座位 ${assignedSeatIndex}。`);
    }
    
    // 獲取最終確認的玩家物件 (無論是新建還是恢復的)
    const finalPlayerObject = this.players.find(p => p.id === assignedSeatIndex)!;
    socket.data.currentRoomId = this.roomId; // 在 socket 上記錄當前房間ID
    socket.data.playerId = finalPlayerObject.id; // 在 socket 上記錄玩家座位ID
    socket.join(this.roomId); // 將 socket 加入到 Socket.IO 的房間

    // AI 玩家不會在此時初始化，而是在遊戲正式開始時 (房主點擊開始)
    // 更新遊戲階段 (如果之前是 LOADING 或 WAITING)
    if (this.gameState.gamePhase === GamePhase.LOADING || this.gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS) {
        this.gameState.gamePhase = GamePhase.WAITING_FOR_PLAYERS;
    }
    
    // 向加入的玩家發送 joinedRoom 事件，包含初始遊戲狀態和其客戶端ID
    this.io.to(socket.id).emit('joinedRoom', { gameState: this.getGameState(), roomId: this.roomId, clientPlayerId: finalPlayerObject.id });
    this.addLog(`${playerName} (座位: ${finalPlayerObject.id}) 已加入房間。`);
    this.broadcastGameState(); // 廣播遊戲狀態給房間內所有玩家
    this.resetEmptyRoomTimer(); // 重置空房計時器

    console.log(`[GameRoom ${this.roomId}] 玩家 ${playerName} (ID: ${finalPlayerObject.id}) 加入流程完成。房間內物件總數: ${this.players.length}。在線真人數: ${this.players.filter(p=>p.isHuman && p.isOnline).length}。`);
    return true;
  }

  /**
   * @description 從房間移除一個玩家 (通常因斷線或主動退出)。
   * @param {string} socketId - 要移除的玩家的 Socket ID。
   */
  public removePlayer(socketId: string): void {
    // 查找玩家在 this.players 陣列中的索引
    const playerIndexInArray = this.players.findIndex(p => p.socketId === socketId);
    if (playerIndexInArray === -1) { // 如果找不到該玩家
        console.log(`[GameRoom ${this.roomId}] 嘗試移除玩家 (Socket: ${socketId})，但未找到。`);
        return;
    }

    const removedPlayer = this.players[playerIndexInArray]; // 獲取被移除的玩家物件
    console.log(`[GameRoom ${this.roomId}] 玩家 ${removedPlayer.name} (ID: ${removedPlayer.id}, Socket: ${socketId}) 正在被移除。遊戲階段: ${this.gameState.gamePhase}`);

    // 判斷玩家離開時是否正在遊戲中 (不包括 WAITING_FOR_PLAYERS, GAME_OVER, ROUND_OVER, AWAITING_REMATCH_VOTES, LOADING)
    const wasPlayingMidGame = ![
        GamePhase.WAITING_FOR_PLAYERS,
        GamePhase.GAME_OVER,
        GamePhase.ROUND_OVER,
        GamePhase.AWAITING_REMATCH_VOTES,
        GamePhase.LOADING
    ].includes(this.gameState.gamePhase);


    if (wasPlayingMidGame && removedPlayer.isHuman) { // 如果是正在遊戲中的真人玩家離開
        removedPlayer.isOnline = false; // 標記為離線 (保留其資料，可能由AI接管或等待重連)
        this.addLog(`${removedPlayer.name} 已斷線。`);
        // 向房間內其他玩家廣播此玩家已離開
        this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, message: `${removedPlayer.name} 已斷線。` });

        // 如果離開的是當前回合玩家或正在做宣告決定的玩家，則自動處理其超時
        if (this.gameState.currentPlayerIndex === removedPlayer.id || this.gameState.playerMakingClaimDecision === removedPlayer.id) {
            this.clearActionTimer(); // 清除其行動計時器
            this.addLog(`${removedPlayer.name} 的回合，因斷線而自動處理。`);
            const timerType = this.gameState.actionTimerType || (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION ? 'claim' : 'turn');
            this.handlePlayerActionTimeout(removedPlayer.id, timerType, true); // isOffline = true
        }
        // 如果房間內已無在線真人玩家，則提前結束遊戲並解散房間
        if (this.isEmpty()) { 
            this.addLog(`所有真人玩家均已離開，遊戲提前結束並解散房間。`);
            this.gameState.gamePhase = GamePhase.GAME_OVER; 
            this.gameState.matchOver = true; // 標記比賽結束
            this.broadcastGameState(); // 廣播最後狀態
            if (this.emptyRoomTimer) { clearTimeout(this.emptyRoomTimer); this.emptyRoomTimer = null; }

            // *** 修改點：在呼叫 onRoomEmptyCallback 之前，先讓離開的玩家的 socket 離開房間 ***
            const departingSocket = this.io.sockets.sockets.get(socketId);
            if (departingSocket) {
                departingSocket.leave(this.roomId);
                console.log(`[GameRoom ${this.roomId}] 玩家 ${removedPlayer.name} (Socket: ${socketId}) 的 socket 已在房間解散前離開 Socket.IO 房間 ${this.roomId}。`);
            }
            // *** 修改點結束 ***

            this.onRoomEmptyCallback(); // 觸發房間關閉回調
            return; 
        }
    } else if (this.gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES && removedPlayer.isHuman) { // 如果是在再戰投票階段真人玩家離開
        this.addLog(`${removedPlayer.name} 在再戰投票階段離開。`);
        // 將其投票視為 "拒絕" (或從投票列表中移除)
        if (this.gameState.rematchVotes) {
            this.gameState.rematchVotes = this.gameState.rematchVotes.filter(v => v.playerId !== removedPlayer.id);
        }
        this.players.splice(playerIndexInArray, 1); // 從玩家列表中移除
        this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, message: `${removedPlayer.name} 已離開房間。` });

        // 檢查是否所有剩餘的在線真人玩家都已同意再戰
        const onlineHumans = this.players.filter(p => p.isHuman && p.isOnline);
        const agreedHumans = onlineHumans.filter(p => this.gameState.rematchVotes?.find(v => v.playerId === p.id && v.vote === 'yes'));
        if (onlineHumans.length > 0 && onlineHumans.length === agreedHumans.length) {
            this.addLog("所有剩餘在線真人玩家已同意再戰，提前開始。");
            this.handleRematchVoteTimeout(true); // isEarlyStart = true
        } else if (onlineHumans.length === 0 && this.gameState.rematchVotes && this.gameState.rematchVotes.length === 0) {
            // 如果沒有在線真人玩家了，且沒有再戰投票了 (可能之前就沒人)
            this.addLog("再戰投票階段已無真人玩家，房間關閉。");
            if (this.rematchTimerInterval) { clearInterval(this.rematchTimerInterval); this.rematchTimerInterval = null; }
            this.gameState.matchOver = true;
            // *** 修改點：在呼叫 onRoomEmptyCallback 之前，先讓離開的玩家的 socket 離開房間 ***
            const departingSocket = this.io.sockets.sockets.get(socketId);
            if (departingSocket) {
                departingSocket.leave(this.roomId);
            }
            // *** 修改點結束 ***
            this.onRoomEmptyCallback();
            return;
        }

    } else { // 如果是等待階段離開，或AI玩家離開(理論上AI不應主動離開)
        this.players.splice(playerIndexInArray, 1); // 直接從玩家列表中移除
        this.addLog(`${removedPlayer.name} 已離開房間。`);
        this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, message: `${removedPlayer.name} 已離開房間。` });
        
        // 如果離開的是真人玩家，且房間因此變空
        if (removedPlayer.isHuman && this.isEmpty()) {
            if (this.gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS) { // 等待階段房間空了
                console.log(`[GameRoom ${this.roomId}] 房間在等待階段因 ${removedPlayer.name} 離開而變空，關閉房間。`);
                if (this.emptyRoomTimer) { clearTimeout(this.emptyRoomTimer); this.emptyRoomTimer = null; }
                // *** 修改點：在呼叫 onRoomEmptyCallback 之前，先讓離開的玩家的 socket 離開房間 ***
                const departingSocket = this.io.sockets.sockets.get(socketId);
                if (departingSocket) {
                    departingSocket.leave(this.roomId);
                }
                // *** 修改點結束 ***
                this.onRoomEmptyCallback(); // 關閉房間
                return; 
            } else if (this.gameState.gamePhase === GamePhase.ROUND_OVER) { // 本局結束階段房間空了
                this.addLog(`所有真人玩家已於本局結束階段離開，取消下一局並準備關閉房間。`);
                this.clearNextRoundTimer(); // 清除下一局倒數
                this.gameState.gamePhase = GamePhase.GAME_OVER;
                this.gameState.matchOver = true;
                this.broadcastGameState();
            } else if (this.gameState.gamePhase === GamePhase.GAME_OVER && !this.gameState.matchOver) { // 比賽未完全結束但房間空了
                this.addLog(`所有真人玩家已於遊戲結束 (局完成) 階段離開，標記比賽結束。`);
                this.gameState.matchOver = true;
                this.broadcastGameState();
            }
        }
    }
    
    // 如果離開的玩家是房主，且房間内還有其他在線真人玩家，則指派新房主
    if (removedPlayer.isHost && this.players.some(p => p.isHuman && p.isOnline)) {
        this.assignNewHost();
    }
    
    this.sortPlayersById(); // 重新排序玩家列表
    this.updateGameStatePlayers(); // 更新遊戲狀態中的玩家資訊
    this.broadcastGameState();     // 廣播遊戲狀態

    // 重置空房計時器，如果遊戲已結束或本局結束，使用較短的超時
    this.resetEmptyRoomTimer(this.gameState.gamePhase === GamePhase.GAME_OVER || this.gameState.gamePhase === GamePhase.ROUND_OVER || this.gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES);
    
    // 清理該 socket 的房間相關資料
    const clientSocket = this.io.sockets.sockets.get(socketId);
    if(clientSocket) {
        // 只有當不是因為isEmpty()導致房間解散的情況下，才執行 socket.leave。
        // 如果是因為isEmpty()導致的，上面的邏輯已經處理了 socket.leave。
        if (!(wasPlayingMidGame && removedPlayer.isHuman && this.isEmpty())) {
             clientSocket.leave(this.roomId); // 讓 socket 離開 Socket.IO 房間
        }
        delete clientSocket.data.currentRoomId; // 刪除 socket 上的房間ID記錄
        delete clientSocket.data.playerId;      // 刪除 socket 上的座位ID記錄
    }
  }

  /**
   * @description 當原房主離開後，從房間内已有的真人玩家中指派一位新的房主。
   */
  private assignNewHost(): void {
    this.sortPlayersById(); // 確保玩家按ID排序，以便選擇第一個符合條件的
    const newHost = this.players.find(p => p.isHuman && p.isOnline); // 找到第一個在線的真人玩家
    if (newHost) { // 如果找到新房主
      this.players.forEach(p => p.isHost = (p.id === newHost.id)); // 更新所有玩家的 isHost 狀態
      this.roomSettings.hostName = newHost.name; // 更新房間設定中的房主名稱
      this.roomSettings.hostSocketId = newHost.socketId!; // 更新房主 Socket ID
      this.gameState.hostPlayerName = newHost.name; // 同步更新遊戲狀態中的房主名稱
      this.addLog(`${newHost.name} (座位: ${newHost.id}) 已被指定為新的房主。`);
      console.log(`[GameRoom ${this.roomId}] 新房主: ${newHost.name} (Socket: ${newHost.socketId})`);
    } else { // 如果沒有可用的真人玩家成為新房主
      this.roomSettings.hostName = "無"; // 標記房主為 "無"
      this.roomSettings.hostSocketId = undefined;
      this.gameState.hostPlayerName = "無";
      this.addLog(`沒有可用的真人玩家成為新房主。`);
      console.log(`[GameRoom ${this.roomId}] 沒有可用的真人玩家可成為新房主。`);
    }
  }

  /**
   * @description 處理房主發起的開始遊戲請求。
   * @param {string} socketId - 發起請求的玩家的 Socket ID。
   */
  public requestStartGame(socketId: string): void {
    const player = this.players.find(p => p.socketId === socketId); // 找到發起請求的玩家
    if (!player || !player.isHost) { // 如果玩家不存在或不是房主
      this.io.to(socketId).emit('gameError', '只有房主才能開始遊戲。');
      return;
    }
    if (this.gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS) { // 如果遊戲階段不正確
      this.io.to(socketId).emit('gameError', '遊戲已經開始或狀態不正確，無法開始。');
      return;
    }

    // 檢查在線真人玩家數量是否達到房間設定的目標數
    const humanPlayersOnlineCount = this.players.filter(p => p.isHuman && p.isOnline).length;
    if (humanPlayersOnlineCount < this.roomSettings.humanPlayers) {
         this.io.to(socketId).emit('gameError', `至少需要 ${this.roomSettings.humanPlayers} 位真人玩家才能開始。目前 ${humanPlayersOnlineCount} 位。`);
        return;
    }

    // 在房主請求開始遊戲時，才初始化AI玩家以填補空位
    this.initializeAIPlayers(); 
    
    // 再次檢查，確保AI填充後總玩家數達到 NUM_PLAYERS
    if (this.players.length < NUM_PLAYERS) {
        this.io.to(socketId).emit('gameError', `需要 ${NUM_PLAYERS} 位玩家才能開始遊戲 (AI填充後仍不足)。`);
        return;
    }

    console.log(`[GameRoom ${this.roomId}] 房主 ${player.name} (座位: ${player.id}) 開始遊戲。AI 已填充 (如果需要)。`);
    this.startGameRound(true); // 開始第一局 (isNewMatch = true)
  }

  /**
   * @description 開始一局新遊戲 (可以是全新比賽的第一局，或比賽中的下一局)。
   * @param {boolean} isNewMatch - 是否為全新比賽。
   */
  private startGameRound(isNewMatch: boolean): void {
    this.clearRematchTimer(); // 確保再戰計時器已清除
    this.gameState.rematchVotes = []; // 清除再戰投票狀態

    // 如果不是新比賽，且當前局數已達到總局數，則結束整場比賽
    if (!isNewMatch && this.gameState.currentRound >= (this.roomSettings.numberOfRounds || DEFAULT_NUMBER_OF_ROUNDS)) {
        this.handleMatchEnd();
        return;
    }
    // 如果不是新比賽，則局數加一
    if (!isNewMatch) {
        this.gameState.currentRound++;
    }

    this.gameState.gamePhase = GamePhase.DEALING; // 設定遊戲階段為發牌中
    this.initializeOrResetGameForRound(isNewMatch); // 初始化或重置本局遊戲狀態
  }

  /**
   * @description 處理來自真人玩家的遊戲動作。
   * @param {string} socketId - 執行動作的玩家的 Socket ID。
   * @param {GameActionPayload} action - 玩家執行的動作及其負載。
   */
  public handlePlayerAction(socketId: string, action: GameActionPayload): void {
    const player = this.players.find(p => p.socketId === socketId); // 找到執行動作的玩家
    if (!player || !player.isHuman) { // 如果玩家不存在或不是真人
        console.warn(`[GameRoom ${this.roomId}] 收到來自非人類或未知 socket (${socketId}) 的動作: `, action);
        this.io.to(socketId).emit('gameError', '無效的玩家身份。');
        return;
    }
    // 檢查動作提交鎖，防止重複提交
    if (this.actionSubmitLock.has(player.id)) {
        this.io.to(socketId).emit('gameError', '操作太頻繁或正在處理您的上一個動作。');
        return;
    }
    this.actionSubmitLock.add(player.id); // 添加鎖

    console.log(`[GameRoom ${this.roomId}] 玩家 ${player.name} (ID: ${player.id}, 真人: ${player.isHuman}) 嘗試執行動作: ${action.type}`, JSON.stringify(action).substring(0, 100));

    // 如果有AI正在思考，清除其計時器 (真人動作優先)
    if (this.aiActionTimeout) {
        clearTimeout(this.aiActionTimeout);
        this.aiActionTimeout = null;
    }

    // 如果是當前回合玩家或正在做宣告決定的玩家，清除其行動計時器
    if (player.id === this.gameState.currentPlayerIndex || player.id === this.gameState.playerMakingClaimDecision) {
        this.clearActionTimer();
    }

    let actionIsValid = true; // 標記動作是否有效

    try { // 處理各種動作類型
        switch (action.type) {
            case 'DRAW_TILE': // 摸牌
                actionIsValid = this.processDrawTile(player.id);
                break;
            case 'DISCARD_TILE': // 打牌
                actionIsValid = this.processDiscardTile(player.id, action.tileId);
                break;
            case 'DECLARE_HU': // 宣告胡牌
                actionIsValid = this.processDeclareHu(player.id);
                break;
            case 'CLAIM_PENG': // 宣告碰牌
                actionIsValid = this.processClaimPeng(player.id, action.tile);
                break;
            case 'CLAIM_GANG': // 宣告明槓 (別人打的牌)
                actionIsValid = this.processClaimGang(player.id, action.tile);
                break;
            case 'CLAIM_CHI': // 宣告吃牌
                actionIsValid = this.processClaimChi(player.id, action.tilesToChiWith, action.discardedTile);
                break;
            case 'DECLARE_AN_GANG': // 宣告暗槓
                actionIsValid = this.processDeclareAnGang(player.id, action.tileKind);
                break;
            case 'DECLARE_MING_GANG_FROM_HAND': // 宣告加槓 (手中碰牌摸到第四張)
                actionIsValid = this.processDeclareMingGangFromHand(player.id, action.tileKind);
                break;
            case 'PASS_CLAIM': // 跳過宣告
                actionIsValid = this.processPassClaim(player.id);
                break;
            case 'PLAYER_CONFIRM_NEXT_ROUND': // 確認下一局
                actionIsValid = this.processPlayerConfirmNextRound(player.id);
                break;
            case 'PLAYER_VOTE_REMATCH': // 玩家投票再戰
                actionIsValid = this.processPlayerVoteRematch(player.id, action.vote);
                break;
            default: // 未知動作類型
                console.warn(`[GameRoom ${this.roomId}] 未處理的玩家動作類型:`, (action as any).type);
                this.io.to(socketId).emit('gameError', '未知的動作類型。');
                actionIsValid = false;
        }
    } catch (error) { // 捕獲處理動作時的錯誤
        console.error(`[GameRoom ${this.roomId}] 處理玩家 ${player.name} 動作 ${action.type} 時發生錯誤:`, error);
        this.io.to(socketId).emit('gameError', `處理動作時發生內部錯誤: ${(error as Error).message}`);
        actionIsValid = false;
    } finally {
        this.actionSubmitLock.delete(player.id); // 釋放動作提交鎖
    }

    if (actionIsValid) { // 如果動作有效，則檢查是否輪到AI行動
        this.processAITurnIfNeeded();
    } else { // 如果動作無效
        // 如果是輪到此玩家行動或做宣告決定，則重新啟動其計時器並廣播狀態
        if (player.id === this.gameState.currentPlayerIndex &&
            (this.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
             this.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
             this.gameState.gamePhase === GamePhase.AWAITING_DISCARD)) {
           this.startActionTimerForPlayer(player.id);
           this.broadcastGameState(); 
        } else if (player.id === this.gameState.playerMakingClaimDecision &&
                   (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION ||
                    this.gameState.gamePhase === GamePhase.ACTION_PENDING_CHI_CHOICE)) {
           this.startActionTimerForPlayer(player.id);
           this.broadcastGameState();
        }
    }
  }

  /**
   * @description 處理玩家摸牌的邏輯。
   * @param {number} playerId - 摸牌的玩家ID。
   * @returns {boolean} 動作是否成功。
   */
  private processDrawTile(playerId: number): boolean {
    const player = this.players.find(p => p.id === playerId); // 找到摸牌玩家
    if (!player) { console.error(`[GameRoom ${this.roomId}] processDrawTile: 玩家 ${playerId} 未找到。`); return false; }
    // 檢查是否輪到此玩家摸牌且遊戲階段正確
    if (this.gameState.currentPlayerIndex !== playerId || this.gameState.gamePhase !== GamePhase.PLAYER_TURN_START) {
        if(player.socketId) this.io.to(player.socketId).emit('gameError', '還沒輪到你摸牌或遊戲階段不正確。');
        return false;
    }
    // 檢查牌堆是否已空
    if (this.gameState.deck.length === 0) {
        this.addLog("牌堆已空！本局流局。");
        this.gameState.isDrawGame = true; // 標記為流局
        this.handleRoundEndFlow(); // 處理局結束流程
        this.broadcastGameState(); // 廣播遊戲狀態
        return true;
    }

    const drawnTile = this.gameState.deck.shift()!; // 從牌堆頂部摸一張牌
    this.gameState.lastDrawnTile = drawnTile; // 記錄剛摸到的牌
    
    this.gameState.gamePhase = GamePhase.PLAYER_DRAWN; // 更新遊戲階段為 "玩家已摸牌"
    // 記錄日誌 (對真人玩家顯示摸到的牌，對AI不顯示)
    this.addLog(`${player.name} (座位: ${player.id}) 摸了一張牌${player.isHuman && player.isOnline ? ` (${drawnTile.kind})` : ''}。`); 
    this.startActionTimerForPlayer(playerId); // 為該玩家啟動行動計時器
    // 如果摸牌的是AI或離線玩家，立即廣播狀態 (真人玩家可能因計時器啟動而收到廣播)
    if (!player.isHuman || !player.isOnline) this.broadcastGameState(); 
    return true;
  }

  /**
   * @description 處理玩家打牌的邏輯。
   * @param {number} playerId - 打牌的玩家ID。
   * @param {string} tileId - 要打出的牌的ID。
   * @returns {boolean} 動作是否成功。
   */
  private processDiscardTile(playerId: number, tileId: string): boolean {
    const player = this.players.find(p => p.id === playerId); // 找到打牌玩家
    if (!player) { console.error(`[GameRoom ${this.roomId}] processDiscardTile: 玩家 ${playerId} 未找到。`); return false; }

    // 檢查是否輪到此玩家打牌且遊戲階段正確 (已摸牌或等待出牌)
    if (this.gameState.currentPlayerIndex !== playerId ||
        (this.gameState.gamePhase !== GamePhase.PLAYER_DRAWN && this.gameState.gamePhase !== GamePhase.AWAITING_DISCARD)) {
        if(player.socketId) this.io.to(player.socketId).emit('gameError', '還沒輪到你打牌或遊戲階段不正確。');
        return false;
    }

    let tileToDiscard: Tile | null = null; // 要打出的牌
    let handAfterDiscard = [...player.hand]; // 複製手牌用於操作

    // 情況1：打出的是剛摸到的牌 (PLAYER_DRAWN 階段)
    if (this.gameState.lastDrawnTile && this.gameState.lastDrawnTile.id === tileId && this.gameState.gamePhase === GamePhase.PLAYER_DRAWN) {
        tileToDiscard = this.gameState.lastDrawnTile; // 直接使用剛摸的牌
        this.gameState.lastDrawnTile = null; // 清除 lastDrawnTile
    } else { // 情況2：打出的是原手牌中的一張
        const tileIndexInHand = player.hand.findIndex(t => t.id === tileId); // 在原手牌中查找
        if (tileIndexInHand === -1) { // 如果找不到
            if(player.socketId) this.io.to(player.socketId).emit('gameError', `在您的手中找不到要打出的牌 (ID: ${tileId})。`);
            return false;
        }
        tileToDiscard = player.hand[tileIndexInHand]; // 獲取要打的牌
        handAfterDiscard.splice(tileIndexInHand, 1); // 從手牌副本中移除

        // 如果是在 PLAYER_DRAWN 階段打原手牌，則剛摸的牌需要加入到手牌中
        if (this.gameState.lastDrawnTile && this.gameState.gamePhase === GamePhase.PLAYER_DRAWN) { 
            handAfterDiscard.push(this.gameState.lastDrawnTile);
            this.gameState.lastDrawnTile = null; // 清除 lastDrawnTile
        } 
        // 如果是在 AWAITING_DISCARD 階段 (例如莊家開局，第8張牌存在 lastDrawnTile 中)，打出的是原7張之一
        else if (this.gameState.gamePhase === GamePhase.AWAITING_DISCARD && this.gameState.lastDrawnTile) {
            // 假設此時 lastDrawnTile 是莊家第8張牌，若打的是原7張牌之一，則第8張牌會加入手牌。
            // 但 current logic for dealer: lastDrawnTile is set to the 8th card, gamePhase is AWAITING_DISCARD.
            // If dealer discards one of the original 7, the 8th card (lastDrawnTile) must be added.
            // If dealer discards the 8th card itself, then lastDrawnTile is cleared.
            // The initial code for dealer:
            // if (dealerPlayer.hand.length === INITIAL_HAND_SIZE_DEALER && dealerPlayer.hand.length > 0) {
            //    this.gameState.lastDrawnTile = dealerPlayer.hand[dealerPlayer.hand.length - 1]; // lastDrawnTile is the 8th card
            //    this.gameState.gamePhase = GamePhase.AWAITING_DISCARD;
            // }
            // So, if tileToDiscard is NOT lastDrawnTile, then lastDrawnTile should be added to hand.
            if (tileToDiscard.id !== this.gameState.lastDrawnTile.id) {
                handAfterDiscard.push(this.gameState.lastDrawnTile);
            }
            this.gameState.lastDrawnTile = null; // 清除 lastDrawnTile
        }
    }

    // 再次確認是否成功確定要打出的牌
    if (!tileToDiscard) {
        if(player.socketId) this.io.to(player.socketId).emit('gameError', '無法確定要打出的牌。');
        return false;
    }

    player.hand = sortHandVisually(handAfterDiscard); // 更新玩家手牌並排序
    this.gameState.discardPile.unshift(tileToDiscard); // 將打出的牌加入棄牌堆頂部
    this.gameState.lastDiscardedTile = tileToDiscard; // 記錄最後棄牌
    this.gameState.lastDiscarderIndex = playerId; // 記錄打牌者

    this.addLog(`${player.name} (座位: ${player.id}) 打出了 ${tileToDiscard.kind}。`);
    this.broadcastActionAnnouncement(tileToDiscard.kind, playerId); // 廣播打牌宣告動畫
    this.updateGameStatePlayers(); // 更新 gameState.players (因手牌變化)
    this.checkForClaims(tileToDiscard, playerId); // 檢查其他玩家是否可以對此棄牌進行宣告
    return true;
  }

/**
 * @description 處理玩家宣告胡牌的邏輯。
 * @param {number} playerId - 宣告胡牌的玩家ID。
 * @returns {boolean} 動作是否成功。
 */
private processDeclareHu(playerId: number): boolean {
    const player = this.players.find(p => p.id === playerId); // 找到宣告玩家
    if (!player) { console.error(`[GameRoom ${this.roomId}] processDeclareHu: 玩家 ${playerId} 未找到。`); return false; }

    let handToCheck: Tile[]; // 用於檢查胡牌的手牌
    let isSelfDrawnHu = false; // 是否為自摸
    let winTile: Tile | null = null; // 胡的那張牌 (自摸的牌或別人打的牌)
    let actionTextForAnnouncement: "天胡" | "自摸" | "胡" = "胡"; // 宣告動畫文字
    let isMultiHuTarget = false; // 是否為一炮多響的目標之一

    // 情況1：輪到自己行動時宣告胡牌 (天胡或自摸)
    if (this.gameState.currentPlayerIndex === playerId &&
        (this.gameState.gamePhase === GamePhase.PLAYER_DRAWN || // 摸牌後
         // 莊家開局第一回合 (手牌8張，等待出第一張牌時，此時第8張牌在 lastDrawnTile)
         (this.gameState.gamePhase === GamePhase.AWAITING_DISCARD && player.isDealer && this.gameState.turnNumber === 1 && player.hand.length + (this.gameState.lastDrawnTile ? 1:0) === INITIAL_HAND_SIZE_DEALER) ||
         // 莊家開局第一回合 (摸牌前，即發完7張，準備摸第8張時，手牌7張) - 天胡檢查
         (this.gameState.gamePhase === GamePhase.PLAYER_TURN_START && player.isDealer && this.gameState.turnNumber === 1 && player.hand.length === INITIAL_HAND_SIZE_NON_DEALER)
        )) {
        isSelfDrawnHu = true; // 標記為自摸類型
        winTile = this.gameState.lastDrawnTile; // 胡的牌是剛摸的牌 (或莊家第8張)

        if ((this.gameState.gamePhase === GamePhase.PLAYER_TURN_START || this.gameState.gamePhase === GamePhase.AWAITING_DISCARD) && player.isDealer && this.gameState.turnNumber === 1) {
            // 天胡檢查:
            // 如果是 PLAYER_TURN_START，hand 是7張，lastDrawnTile 是即將摸的第8張 (如果已摸)。
            // 如果是 AWAITING_DISCARD，hand 是7張，lastDrawnTile 是已發的第8張。
            // 天胡應該檢查包含第8張牌的8張手牌。
            handToCheck = this.gameState.lastDrawnTile ? [...player.hand, this.gameState.lastDrawnTile] : [...player.hand]; // 如果還沒摸第8張，則僅用7張檢查 (應為8張)
             if(handToCheck.length !== INITIAL_HAND_SIZE_DEALER && player.isDealer && this.gameState.turnNumber === 1) {
                console.warn(`[GameRoom ${this.roomId}] 天胡檢查時手牌數量 (${handToCheck.length}) 不正確，應為 ${INITIAL_HAND_SIZE_DEALER}。莊家: ${player.name}`);
                // 這種情況下，如果 lastDrawnTile 為 null，天胡邏輯可能有問題。
                // GameRoom 應確保莊家在 PLAYER_TURN_START 時，若要檢查天胡，是基於完整的8張牌。
                // 目前的流程是莊家在 AWAITING_DISCARD 時，lastDrawnTile 已是第8張。
             }
            actionTextForAnnouncement = "天胡";
        } else { // 普通自摸
            if (!this.gameState.lastDrawnTile) { // 防禦：自摸時必須有剛摸的牌
                 if(player.socketId) this.io.to(player.socketId).emit('gameError', '錯誤：宣告自摸時找不到剛摸的牌。'); return false;
            }
            handToCheck = [...player.hand, this.gameState.lastDrawnTile!]; // 手牌加上剛摸的牌
            actionTextForAnnouncement = "自摸";
        }
    } 
    // 情況2：宣告別人打出的牌 (食胡)
    else if (this.gameState.lastDiscardedTile && // 必須有棄牌
               this.gameState.potentialClaims.some(c => c.playerId === playerId && c.action === 'Hu') && // 此玩家有胡牌宣告權
               (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION || this.gameState.gamePhase === GamePhase.AWAITING_CLAIMS_RESOLUTION)) { // 遊戲階段正確
        isSelfDrawnHu = false; // 非自摸
        winTile = this.gameState.lastDiscardedTile; // 胡的牌是棄牌
        handToCheck = [...player.hand, this.gameState.lastDiscardedTile]; // 手牌加上棄牌
        actionTextForAnnouncement = "胡";
        
        // 檢查是否為一炮多響 (多個玩家胡同一張棄牌)
        // Fix: Ensure claim.tiles is not undefined before accessing its properties
        const huClaimsForThisTile = this.gameState.potentialClaims.filter(c => c.action === 'Hu' && this.gameState.lastDiscardedTile && c.tiles && c.tiles.some(t => t.id === this.gameState.lastDiscardedTile!.id));
        if (huClaimsForThisTile.length > 1) {
            isMultiHuTarget = true; // 標記為一炮多響
        }

    } else { // 不符合任何胡牌時機
        if(player.socketId) this.io.to(player.socketId).emit('gameError', '現在不是宣告胡牌的時機。');
        return false;
    }

    // 檢查胡牌條件
    const winInfo = checkWinCondition(handToCheck, player.melds);
    if (winInfo.isWin) { // 如果胡牌
        this.gameState.winnerId = playerId; // 設定贏家ID
        this.gameState.winType = isSelfDrawnHu ? 'selfDrawn' : 'discard'; // 設定胡牌類型

        let huMessage = `${player.name} (座位: ${player.id}) `;
        if (isSelfDrawnHu) { // 自摸相關處理
            if (actionTextForAnnouncement === "天胡") huMessage += "天胡";
            else huMessage += `自摸 (摸到 ${winTile?.kind || '牌'})`;
            this.gameState.winningTileDiscarderId = null; // 自摸無放槍者
            this.gameState.winningDiscardedTile = null;   // 自摸胡的不是棄牌
            // 如果胡的是剛摸的牌，則從 lastDrawnTile 中清除
            if (winTile && this.gameState.lastDrawnTile && winTile.id === this.gameState.lastDrawnTile.id) {
                this.gameState.lastDrawnTile = null; 
            }
        } else { // 食胡相關處理
            huMessage += `食胡 (ロン了 ${this.players.find(p=>p.id === this.gameState.lastDiscarderIndex)?.name || '上家'} 的 ${winTile!.kind})`;
            this.gameState.winningTileDiscarderId = this.gameState.lastDiscarderIndex; // 記錄放槍者
            this.gameState.winningDiscardedTile = winTile; // 記錄胡的棄牌
            // 從棄牌堆消耗掉被胡的牌
            if (this.gameState.lastDiscardedTile && this.gameState.lastDiscardedTile.id === winTile!.id) {
                this.consumeDiscardedTileForMeld(winTile!.id); 
            }
            player.hand.push(winTile!); // 將胡的牌加入手牌 (用於顯示完整牌型)
            player.hand = sortHandVisually(player.hand); // 排序手牌
        }
        huMessage += "了！";
        this.addLog(huMessage); // 記錄胡牌訊息
        // 廣播胡牌宣告動畫 (天胡、自摸或胡)，並標記是否為一炮多響
        this.broadcastActionAnnouncement(actionTextForAnnouncement, playerId, isMultiHuTarget);
        
        this.updateGameStatePlayers(); // 更新遊戲狀態中的玩家資訊 (因手牌變化)
        this.handleRoundEndFlow(); // 處理局結束流程
    } else { // 如果未胡牌 (詐胡)
        this.addLog(`${player.name} 宣告 ${actionTextForAnnouncement} 失敗 (詐胡)。`);
        if(player.socketId) this.io.to(player.socketId).emit('gameError', '不符合胡牌條件。');

        // 如果是宣告別人棄牌時詐胡，則視為跳過宣告
        if (!isSelfDrawnHu && this.gameState.playerMakingClaimDecision === playerId) {
             this.processPassClaim(playerId); 
        } 
        // 如果是自摸時詐胡，則恢復遊戲階段並讓其繼續打牌
        else if (isSelfDrawnHu) {
            if (actionTextForAnnouncement === "天胡") { // 莊家天胡詐胡，回到等待出牌
                this.gameState.gamePhase = GamePhase.AWAITING_DISCARD; 
            } else { // 普通自摸詐胡，回到已摸牌
                this.gameState.gamePhase = GamePhase.PLAYER_DRAWN; 
            }
            this.startActionTimerForPlayer(playerId); // 重新啟動計時器
            this.broadcastGameState(); // 廣播狀態
        }
        return false; // 宣告胡牌失敗
    }
    return true; // 宣告胡牌成功
  }

  /**
   * @description 處理玩家宣告碰牌的邏輯。
   * @param {number} playerId - 宣告碰牌的玩家ID。
   * @param {Tile} tileToPeng - 要碰的牌 (來自棄牌堆)。
   * @returns {boolean} 動作是否成功。
   */
  private processClaimPeng(playerId: number, tileToPeng: Tile): boolean {
    const player = this.players.find(p => p.id === playerId); // 找到宣告玩家
    // 檢查宣告時機和條件是否正確
    if (!player || this.gameState.playerMakingClaimDecision !== playerId || this.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION || !this.gameState.lastDiscardedTile || this.gameState.lastDiscardedTile.kind !== tileToPeng.kind) {
        if(player?.socketId) this.io.to(player.socketId).emit('gameError', '無效的碰牌宣告。');
        return false;
    }

    // 從手牌中移除兩張相同的牌用於碰牌
    const { handAfterAction, newMeldTiles } = removeTilesFromHand(player.hand, tileToPeng.kind, 2);
    if (!newMeldTiles || newMeldTiles.length !== 2) { // 如果手牌不足兩張
        this.addLog(`錯誤: ${player.name} 無法碰 ${tileToPeng.kind}，手牌中該牌數量不足。`);
        this.handleInvalidClaim(player, 'Peng'); // 處理無效宣告
        return false;
    }
    player.hand = handAfterAction; // 更新手牌
    // 創建碰出的面子
    const pengMeld: Meld = {
        id: `meld-${player.id}-${Date.now()}`, // 面子唯一ID
        designation: MeldDesignation.KEZI, // 面子類型為刻子
        tiles: [...newMeldTiles, tileToPeng].sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue), // 組成面子的三張牌 (排序)
        isOpen: true, // 碰牌是公開的
        claimedFromPlayerId: this.gameState.lastDiscarderIndex!, // 記錄被碰牌的玩家ID
        claimedTileId: tileToPeng.id, // 記錄被碰的牌的ID
    };
    player.melds.push(pengMeld); // 將面子加入玩家的面子列表
    this.addLog(`${player.name} (座位: ${player.id}) 碰了 ${tileToPeng.kind}。請出牌。`);
    this.broadcastActionAnnouncement("碰", playerId); // 廣播碰牌宣告動畫

    this.consumeDiscardedTileForMeld(tileToPeng.id); // 從棄牌堆消耗被碰的牌
    this.clearClaimsAndTimer(); // 清除所有宣告相關狀態和計時器
    this.gameState.currentPlayerIndex = player.id; // 輪到碰牌玩家行動
    this.gameState.gamePhase = GamePhase.AWAITING_DISCARD; // 更新遊戲階段為等待出牌
    this.updateGameStatePlayers(); // 更新遊戲狀態中的玩家資訊
    this.startActionTimerForPlayer(player.id); // 為碰牌玩家啟動行動計時器
    this.broadcastGameState(); // 廣播遊戲狀態
    return true;
  }

    /**
     * @description 清除當前行動計時器。
     */
    private clearActionTimer(): void {
        if (this.actionTimerInterval) {
            clearInterval(this.actionTimerInterval);
            this.actionTimerInterval = null;
        }
        this.gameState.actionTimer = null; // 清空計時器剩餘時間
        this.gameState.actionTimerType = null; // 清空計時器類型
    }

    /**
     * @description 清除下一局開始的倒數計時器。
     */
    private clearNextRoundTimer(): void {
        if (this.nextRoundTimerInterval) {
            clearInterval(this.nextRoundTimerInterval);
            this.nextRoundTimerInterval = null;
        }
        this.gameState.nextRoundCountdown = null; // 清空倒數秒數
    }

    /**
     * @description 清除再戰投票的倒數計時器。
     */
    private clearRematchTimer(): void {
        if (this.rematchTimerInterval) {
            clearInterval(this.rematchTimerInterval);
            this.rematchTimerInterval = null;
        }
        this.gameState.rematchCountdown = null;
    }


    /**
     * @description 向房間內所有客戶端廣播當前遊戲狀態。
     */
    public broadcastGameState(): void {
        this.io.to(this.roomId).emit('gameStateUpdate', this.getGameState());
    }

    /**
     * @description 處理遊戲內聊天訊息的發送。
     * @param {string} socketId - 發送訊息的玩家的 Socket ID。
     * @param {string} messageText - 訊息內容。
     */
    public sendChatMessage(socketId: string, messageText: string): void {
        const player = this.players.find(p => p.socketId === socketId); // 找到發送者
        if (!player || !messageText.trim()) return; // 如果玩家不存在或訊息為空，則不處理

        // 創建聊天訊息物件
        const chatMessage: ChatMessage = {
            id: `game-chat-${this.roomId}-${Date.now()}`, // 訊息唯一ID
            senderName: player.name, // 發送者名稱
            senderId: player.socketId || player.id.toString(), // 發送者ID (socketId 或座位ID)
            text: messageText.substring(0, 150), // 訊息內容 (限制長度)
            timestamp: Date.now(), // 時間戳
            type: 'player' // 訊息類型為玩家訊息
        };
        this.io.to(this.roomId).emit('gameChatMessage', chatMessage); // 向房間內所有客戶端廣播聊天訊息
        this.addLog(`[聊天] ${player.name} (座位: ${player.id}): ${messageText}`); // 記錄聊天日誌
    }

    /**
     * @description 為指定玩家啟動行動計時器。
     * @param {number} playerId - 要啟動計時器的玩家ID。
     */
    private startActionTimerForPlayer(playerId: number): void {
        this.clearActionTimer(); // 先清除已有的計時器
        const player = this.players.find(p => p.id === playerId); // 找到玩家
        if (!player) { console.error(`[GameRoom ${this.roomId}] startActionTimerForPlayer: 玩家 ${playerId} 未找到。`); return; }

        // 如果是AI或離線玩家，則不啟動客戶端計時器 (AI行動由 processAITurnIfNeeded 處理)
        if (!player.isHuman || !player.isOnline) {
             console.log(`[GameRoom ${this.roomId}] 不為 AI/離線玩家 ${player.name} (座位: ${playerId}) 啟動計時器。`);
            return; 
        }

        let timeoutDuration: number; // 計時器時長 (秒)
        // 根據遊戲階段設定不同的計時器時長和類型
        if (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION || this.gameState.gamePhase === GamePhase.ACTION_PENDING_CHI_CHOICE) {
            timeoutDuration = CLAIM_DECISION_TIMEOUT_SECONDS;
            this.gameState.actionTimerType = 'claim'; // 宣告階段計時器
        } else if (this.gameState.gamePhase === GamePhase.PLAYER_TURN_START || this.gameState.gamePhase === GamePhase.PLAYER_DRAWN || this.gameState.gamePhase === GamePhase.AWAITING_DISCARD) {
            timeoutDuration = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
            this.gameState.actionTimerType = 'turn'; // 回合階段計時器
        } else {
            return; // 其他階段不啟動計時器
        }

        this.gameState.actionTimer = timeoutDuration; // 設定計時器剩餘時間
        this.addLog(`${player.name} (座位: ${player.id}) 的行動計時開始 (${timeoutDuration}s)。`);
        this.broadcastGameState(); // 廣播遊戲狀態 (包含計時器資訊)

        // 設定間隔計時器，每秒更新剩餘時間
        this.actionTimerInterval = setInterval(() => {
            if (this.gameState.actionTimer !== null && this.gameState.actionTimer > 0) {
                this.gameState.actionTimer--; // 剩餘時間減一
                this.broadcastGameState(); // 廣播更新
            }
            // 如果計時器到0
            if (this.gameState.actionTimer === 0) {
                // 確認超時的玩家是否仍是當前需要行動的玩家
                const currentDecisionMakerId = this.gameState.actionTimerType === 'claim' ? this.gameState.playerMakingClaimDecision : this.gameState.currentPlayerIndex;
                if (playerId === currentDecisionMakerId) { // 如果是
                    this.handlePlayerActionTimeout(playerId, this.gameState.actionTimerType!, false); // 處理超時 (isOffline = false)
                } else { // 如果行動權已轉移
                    this.addLog(`[GameRoom ${this.roomId}] 玩家 ${playerId} 的計時器到期，但行動權已轉移。清除過期計時器。`);
                    this.clearActionTimer(); // 清除過期計時器
                    this.broadcastGameState(); 
                }
            }
        }, ACTION_TIMER_INTERVAL_MS); // 每秒執行一次
    }

    /**
     * @description 檢查並處理AI玩家的行動 (如果輪到AI或離線玩家)。
     */
    private processAITurnIfNeeded(): void {
        // 如果已有AI行動計時器，先清除
        if (this.aiActionTimeout) {
            clearTimeout(this.aiActionTimeout);
            this.aiActionTimeout = null;
        }

        let aiPlayerToAct: ServerPlayer | undefined = undefined; // 記錄需要行動的AI/離線玩家

        // 判斷是否輪到AI/離線玩家做宣告決定
        if (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && this.gameState.playerMakingClaimDecision !== null) {
            const player = this.players.find(p => p.id === this.gameState.playerMakingClaimDecision);
            if (player && (!player.isHuman || !player.isOnline) ) aiPlayerToAct = player;
        } 
        // 判斷是否輪到AI/離線玩家的回合行動 (摸牌、打牌)
        else if (
            (this.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
             this.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
             this.gameState.gamePhase === GamePhase.AWAITING_DISCARD) &&
            this.gameState.currentPlayerIndex !== null
        ) {
            const player = this.players.find(p => p.id === this.gameState.currentPlayerIndex);
            if (player && (!player.isHuman || !player.isOnline) ) aiPlayerToAct = player;
        }


        if (aiPlayerToAct) { // 如果確定有AI/離線玩家需要行動
            const currentAIPlayer = aiPlayerToAct; 
            this.addLog(`輪到 ${currentAIPlayer.name} (${currentAIPlayer.isHuman ? '離線真人':'AI'}, 座位: ${currentAIPlayer.id}) 行動，遊戲階段: ${this.gameState.gamePhase}`);
            console.log(`[GameRoom ${this.roomId}] 安排 AI/離線玩家 ${currentAIPlayer.name} (座位: ${currentAIPlayer.id}) 在階段 ${this.gameState.gamePhase} 的行動。`);
            
            // 設定延遲執行AI行動 (模擬思考時間)
            this.aiActionTimeout = setTimeout(() => {
                 // 再次確認是否仍輪到此AI/離線玩家行動 (防止狀態已改變)
                 let stillAIsTurn = false;
                 if (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && this.gameState.playerMakingClaimDecision === currentAIPlayer.id) {
                    stillAIsTurn = true;
                 } else if ((this.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
                             this.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
                             this.gameState.gamePhase === GamePhase.AWAITING_DISCARD) &&
                            this.gameState.currentPlayerIndex === currentAIPlayer.id) {
                    stillAIsTurn = true;
                 }

                if (this.aiActionTimeout && stillAIsTurn) { // 如果計時器仍然有效且仍輪到其行動
                    console.log(`[GameRoom ${this.roomId}] AI/離線玩家 ${currentAIPlayer.name} (座位: ${currentAIPlayer.id}) 現在執行其動作。`);
                    const action = this.aiService.getNextAIMove(currentAIPlayer, this.getGameState()); // 獲取AI決策
                    this.addLog(`${currentAIPlayer.name} (${currentAIPlayer.isHuman ? '離線真人':'AI'}) 執行動作: ${action.type}`);
                    this.handleAIAction(currentAIPlayer.id, action); // 處理AI動作
                } else { // 如果行動權已轉移或計時器被清除
                    console.log(`[GameRoom ${this.roomId}] AI/離線玩家 ${currentAIPlayer.name} (座位: ${currentAIPlayer.id}) 的行動被搶先或不再是其回合。AI 計時器已清除。`);
                }
            }, Math.random() * (AI_THINK_TIME_MS_MAX - AI_THINK_TIME_MS_MIN) + AI_THINK_TIME_MS_MIN); // 隨機延遲時間
        }
    }

    /**
     * @description 處理AI玩家或離線玩家的遊戲動作。
     * @param {number} aiPlayerId - AI/離線玩家的ID。
     * @param {GameActionPayload} action - AI/離線玩家執行的動作。
     */
    private handleAIAction(aiPlayerId: number, action: GameActionPayload): void {
        const aiPlayer = this.players.find(p => p.id === aiPlayerId); // 找到AI/離線玩家
        if (!aiPlayer) { console.error(`[GameRoom ${this.roomId}] handleAIAction: AI/離線玩家 ${aiPlayerId} 未找到。`); return; }

        console.log(`[GameRoom ${this.roomId}] AI/離線玩家 ${aiPlayer.name} (座位: ${aiPlayer.id}) 執行動作: ${action.type}`, JSON.stringify(action).substring(0,100));
        let actionIsValid = true; // 標記動作是否有效

        try { // 處理各種動作類型
            switch (action.type) {
                case 'DRAW_TILE': actionIsValid = this.processDrawTile(aiPlayerId); break;
                case 'DISCARD_TILE': actionIsValid = this.processDiscardTile(aiPlayerId, action.tileId); break;
                case 'DECLARE_HU': actionIsValid = this.processDeclareHu(aiPlayerId); break;
                case 'CLAIM_PENG': actionIsValid = this.processClaimPeng(aiPlayerId, action.tile); break;
                case 'CLAIM_GANG': actionIsValid = this.processClaimGang(aiPlayerId, action.tile); break;
                case 'CLAIM_CHI': actionIsValid = this.processClaimChi(aiPlayerId, action.tilesToChiWith, action.discardedTile); break;
                case 'DECLARE_AN_GANG': actionIsValid = this.processDeclareAnGang(aiPlayerId, action.tileKind); break;
                case 'DECLARE_MING_GANG_FROM_HAND': actionIsValid = this.processDeclareMingGangFromHand(aiPlayerId, action.tileKind); break;
                case 'PASS_CLAIM': actionIsValid = this.processPassClaim(aiPlayerId); break;
                default:
                    console.warn(`[GameRoom ${this.roomId}] AI/離線玩家執行了未處理的動作類型:`, (action as any).type);
                    actionIsValid = false;
            }
        } catch (error) { // 捕獲處理動作時的錯誤
            console.error(`[GameRoom ${this.roomId}] AI/離線玩家動作 ${action.type} 發生錯誤:`, error);
            actionIsValid = false;
        }

        if (actionIsValid) { // 如果動作有效，則檢查是否輪到下一個AI行動
            this.processAITurnIfNeeded();
        } else { // 如果動作無效
            this.addLog(`AI/離線玩家 ${aiPlayer.name} 嘗試的動作 ${action.type} 無效或失敗。`); // 補全此日誌
            console.error(`[GameRoom ${this.roomId}] AI/離線玩家 ${aiPlayer.name} 的動作 ${action.type} 無效。遊戲狀態: ${this.gameState.gamePhase}`);

            // 處理AI無效宣告的情況：自動跳過
            if (this.gameState.playerMakingClaimDecision === aiPlayerId && action.type !== 'PASS_CLAIM') {
                this.addLog(`[GameRoom ${this.roomId}] AI ${aiPlayer.name} (座位: ${aiPlayer.id}) 因無效宣告 ${action.type} 而自動跳過。`); // 補全此日誌
                this.processPassClaim(aiPlayerId); // 執行跳過
                // processPassClaim 內部會處理 advanceToNextPlayerTurn，進而觸發 processAITurnIfNeeded，所以此處無需再次調用
            }
        }
    }


    // --- 以下為其他動作處理函數 (processClaimGang, processClaimChi, processDeclareAnGang, etc.) ---
    // ... (這些函數的實現應保持完整) ...

    /**
     * @description 處理玩家宣告明槓 (別人打出的牌) 的邏輯。
     * @param {number} playerId - 宣告槓牌的玩家ID。
     * @param {Tile} tileToGang - 要槓的牌 (來自棄牌堆)。
     * @returns {boolean} 動作是否成功。
     */
    private processClaimGang(playerId: number, tileToGang: Tile): boolean {
        const player = this.players.find(p => p.id === playerId);
        if (!player || this.gameState.playerMakingClaimDecision !== playerId || this.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION || !this.gameState.lastDiscardedTile || this.gameState.lastDiscardedTile.kind !== tileToGang.kind) {
            if(player?.socketId) this.io.to(player.socketId).emit('gameError', '無效的槓牌宣告。');
            return false;
        }

        const { handAfterAction, newMeldTiles } = removeTilesFromHand(player.hand, tileToGang.kind, 3);
        if (!newMeldTiles || newMeldTiles.length !== 3) {
            this.addLog(`錯誤: ${player.name} 無法槓 ${tileToGang.kind}，手牌中該牌數量不足。`);
            this.handleInvalidClaim(player, 'Gang');
            return false;
        }
        player.hand = handAfterAction;
        const gangMeld: Meld = {
            id: `meld-${player.id}-${Date.now()}`,
            designation: MeldDesignation.GANGZI,
            tiles: [...newMeldTiles, tileToGang].sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue),
            isOpen: true,
            claimedFromPlayerId: this.gameState.lastDiscarderIndex!,
            claimedTileId: tileToGang.id,
        };
        player.melds.push(gangMeld);
        this.addLog(`${player.name} (座位: ${player.id}) 槓了 ${tileToGang.kind}。請摸牌。`);
        this.broadcastActionAnnouncement("槓", playerId);

        this.consumeDiscardedTileForMeld(tileToGang.id);
        this.clearClaimsAndTimer();
        this.gameState.currentPlayerIndex = player.id; // 槓牌後，輪到槓牌玩家摸牌
        this.gameState.gamePhase = GamePhase.PLAYER_TURN_START; // 更新遊戲階段為等待摸牌
        this.updateGameStatePlayers();
        this.startActionTimerForPlayer(player.id); // 為槓牌玩家啟動摸牌計時器
        this.broadcastGameState();
        return true;
    }

    /**
     * @description 處理玩家宣告吃牌的邏輯。
     * @param {number} playerId - 宣告吃牌的玩家ID。
     * @param {Tile[]} tilesToChiWith - 玩家選擇用來吃的兩張手牌。
     * @param {Tile} discardedTileToChi - 被吃的棄牌。
     * @returns {boolean} 動作是否成功。
     */
    private processClaimChi(playerId: number, tilesToChiWith: Tile[], discardedTileToChi: Tile): boolean {
        const player = this.players.find(p => p.id === playerId);
        // 驗證宣告時機和條件
        if (!player || this.gameState.playerMakingClaimDecision !== playerId || 
            (this.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION && this.gameState.gamePhase !== GamePhase.ACTION_PENDING_CHI_CHOICE) || 
            !this.gameState.lastDiscardedTile || this.gameState.lastDiscardedTile.id !== discardedTileToChi.id) {
            if(player?.socketId) this.io.to(player.socketId).emit('gameError', '無效的吃牌宣告。');
            return false;
        }
        if (tilesToChiWith.length !== 2) { // 吃牌必須使用兩張手牌
             if(player?.socketId) this.io.to(player.socketId).emit('gameError', '吃牌必須選擇兩張手牌。');
            return false;
        }

        // 從手牌中移除選擇的兩張牌
        let handCopy = [...player.hand];
        const removedForChi: Tile[] = [];
        let allFound = true;
        for (const tile of tilesToChiWith) {
            const index = handCopy.findIndex(t => t.id === tile.id);
            if (index !== -1) {
                removedForChi.push(handCopy.splice(index, 1)[0]);
            } else {
                allFound = false; break;
            }
        }

        if (!allFound || removedForChi.length !== 2) {
            this.addLog(`錯誤: ${player.name} 嘗試吃 ${discardedTileToChi.kind}，但選擇的手牌 ${tilesToChiWith.map(t=>t.kind).join(',')} 無效或不足。`);
            this.handleInvalidClaim(player, 'Chi');
            return false;
        }

        player.hand = handCopy; // 更新手牌
        const chiMeld: Meld = {
            id: `meld-${player.id}-${Date.now()}`,
            designation: MeldDesignation.SHUNZI,
            tiles: [...removedForChi, discardedTileToChi].sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue),
            isOpen: true,
            claimedFromPlayerId: this.gameState.lastDiscarderIndex!,
            claimedTileId: discardedTileToChi.id,
        };
        player.melds.push(chiMeld);
        this.addLog(`${player.name} (座位: ${player.id}) 吃了 ${discardedTileToChi.kind}。請出牌。`);
        this.broadcastActionAnnouncement("吃", playerId);

        this.consumeDiscardedTileForMeld(discardedTileToChi.id);
        this.clearClaimsAndTimer();
        this.gameState.currentPlayerIndex = player.id;
        this.gameState.gamePhase = GamePhase.AWAITING_DISCARD; // 吃牌後等待出牌
        this.updateGameStatePlayers();
        this.startActionTimerForPlayer(player.id);
        this.broadcastGameState();
        return true;
    }

    /**
     * @description 處理玩家宣告暗槓的邏輯。
     * @param {number} playerId - 宣告暗槓的玩家ID。
     * @param {TileKind} tileKindToGang - 要暗槓的牌的種類。
     * @returns {boolean} 動作是否成功。
     */
    private processDeclareAnGang(playerId: number, tileKindToGang: TileKind): boolean {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return false;
        // 檢查是否輪到此玩家且遊戲階段正確 (摸牌前或摸牌後)
        if (this.gameState.currentPlayerIndex !== playerId ||
            (this.gameState.gamePhase !== GamePhase.PLAYER_TURN_START && this.gameState.gamePhase !== GamePhase.PLAYER_DRAWN && 
            !(this.gameState.gamePhase === GamePhase.AWAITING_DISCARD && player.isDealer && this.gameState.turnNumber === 1)) // 莊家開局第一回合特殊處理
           ) {
            if(player.socketId) this.io.to(player.socketId).emit('gameError', '現在不是宣告暗槓的時機。');
            return false;
        }
        
        // 檢查手牌中是否有四張相同的牌
        const handForAnGangCheck = (this.gameState.gamePhase === GamePhase.PLAYER_DRAWN && this.gameState.lastDrawnTile) 
            ? [...player.hand, this.gameState.lastDrawnTile] 
            : (this.gameState.gamePhase === GamePhase.AWAITING_DISCARD && player.isDealer && this.gameState.turnNumber === 1 && this.gameState.lastDrawnTile)
            ? [...player.hand, this.gameState.lastDrawnTile] // 莊家開局，第8張牌在lastDrawnTile
            : player.hand;

        if (countTilesOfKind(handForAnGangCheck, tileKindToGang) < 4) {
             if(player.socketId) this.io.to(player.socketId).emit('gameError', `您沒有四張 ${tileKindToGang} 可以暗槓。`);
            return false;
        }

        // 從手牌中移除四張牌
        const { handAfterAction, newMeldTiles } = removeTilesFromHand(player.hand, tileKindToGang, 4);
        if (!newMeldTiles) { // 理論上不會發生，因為上面已檢查數量
             if(player.socketId) this.io.to(player.socketId).emit('gameError', `暗槓時移除手牌失敗。`);
            return false;
        }
        player.hand = handAfterAction;

        // 如果是 PLAYER_DRAWN 階段，且暗槓的牌不是剛摸到的牌，則將剛摸到的牌加入手牌
        if (this.gameState.gamePhase === GamePhase.PLAYER_DRAWN && this.gameState.lastDrawnTile && this.gameState.lastDrawnTile.kind !== tileKindToGang) {
            player.hand.push(this.gameState.lastDrawnTile);
            player.hand = sortHandVisually(player.hand);
        }
        this.gameState.lastDrawnTile = null; // 清除 lastDrawnTile

        const anGangMeld: Meld = {
            id: `meld-${player.id}-${Date.now()}`,
            designation: MeldDesignation.GANGZI,
            tiles: newMeldTiles,
            isOpen: false, // 暗槓不公開 (但在客戶端顯示時可能會有所區別)
        };
        player.melds.push(anGangMeld);
        this.addLog(`${player.name} (座位: ${player.id}) 暗槓了 ${tileKindToGang}。請摸牌。`);
        this.broadcastActionAnnouncement("暗槓", playerId);

        this.gameState.gamePhase = GamePhase.PLAYER_TURN_START; // 暗槓後摸牌
        this.updateGameStatePlayers();
        this.startActionTimerForPlayer(player.id);
        this.broadcastGameState();
        return true;
    }

    /**
     * @description 處理玩家宣告加槓 (手中碰牌摸到第四張) 的邏輯。
     * @param {number} playerId - 宣告加槓的玩家ID。
     * @param {TileKind} tileKindToGang - 要加槓的牌的種類 (與碰牌種類相同)。
     * @returns {boolean} 動作是否成功。
     */
    private processDeclareMingGangFromHand(playerId: number, tileKindToGang: TileKind): boolean {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return false;
        // 檢查是否輪到此玩家且遊戲階段正確 (已摸牌)
        if (this.gameState.currentPlayerIndex !== playerId || this.gameState.gamePhase !== GamePhase.PLAYER_DRAWN || !this.gameState.lastDrawnTile) {
            if(player.socketId) this.io.to(player.socketId).emit('gameError', '現在不是宣告加槓的時機。');
            return false;
        }
        // 檢查剛摸到的牌是否為要加槓的牌
        if (this.gameState.lastDrawnTile.kind !== tileKindToGang) {
             if(player.socketId) this.io.to(player.socketId).emit('gameError', '您剛摸到的牌不是要加槓的牌。');
            return false;
        }
        // 查找之前碰出的刻子
        const pengMeldIndex = player.melds.findIndex(m => m.designation === MeldDesignation.KEZI && m.tiles[0].kind === tileKindToGang && m.isOpen);
        if (pengMeldIndex === -1) {
             if(player.socketId) this.io.to(player.socketId).emit('gameError', `您沒有 ${tileKindToGang} 的碰牌可以加槓。`);
            return false;
        }

        // 更新面子為槓子
        player.melds[pengMeldIndex].designation = MeldDesignation.GANGZI;
        player.melds[pengMeldIndex].tiles.push(this.gameState.lastDrawnTile); // 加入第四張牌
        player.melds[pengMeldIndex].tiles.sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue); // 排序

        this.gameState.lastDrawnTile = null; // 消耗掉剛摸的牌
        this.addLog(`${player.name} (座位: ${player.id}) 加槓了 ${tileKindToGang}。請摸牌。`);
        this.broadcastActionAnnouncement("加槓", playerId);

        this.gameState.gamePhase = GamePhase.PLAYER_TURN_START; // 加槓後摸牌
        this.updateGameStatePlayers();
        this.startActionTimerForPlayer(player.id);
        this.broadcastGameState();
        return true;
    }

    /**
     * @description 處理玩家跳過宣告的邏輯。
     * @param {number} playerId - 跳過宣告的玩家ID。
     * @returns {boolean} 動作是否成功。
     */
    private processPassClaim(playerId: number): boolean {
        const player = this.players.find(p => p.id === playerId);
        if (!player || this.gameState.playerMakingClaimDecision !== playerId || this.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION) {
            if(player?.socketId) this.io.to(player.socketId).emit('gameError', '現在不是你宣告或跳過。');
            return false;
        }
        this.addLog(`${player.name} (座位: ${player.id}) 選擇跳過宣告。`);
        this.gameState.playerMakingClaimDecision = null; // 清除正在做宣告決定的玩家
        this.advanceToNextPlayerTurn(false); // 推進遊戲到下一個需要處理的狀態 (非棄牌後)
        return true;
    }

    /**
     * @description 處理玩家確認準備好下一局的邏輯。
     * @param {number} playerId - 確認的玩家ID。
     * @returns {boolean} 動作是否成功。
     */
    private processPlayerConfirmNextRound(playerId: number): boolean {
        if (this.gameState.gamePhase !== GamePhase.ROUND_OVER) {
            console.warn(`[GameRoom ${this.roomId}] 玩家 ${playerId} 嘗試在非 ROUND_OVER 階段確認下一局。`);
            return false;
        }
        // 如果玩家尚未確認，則將其加入已確認列表
        if (!this.gameState.humanPlayersReadyForNextRound.includes(playerId)) {
            this.gameState.humanPlayersReadyForNextRound.push(playerId);
            this.addLog(`玩家 (ID: ${playerId}) 已確認準備好下一局。`);
            this.broadcastGameState(); // 廣播狀態更新

            // 檢查是否所有在線真人玩家都已確認
            const onlineHumanPlayers = this.players.filter(p => p.isHuman && p.isOnline);
            if (onlineHumanPlayers.length > 0 && 
                onlineHumanPlayers.every(p => this.gameState.humanPlayersReadyForNextRound.includes(p.id))) {
                this.addLog("所有在線真人玩家已確認，提前開始下一局。");
                this.clearNextRoundTimer(); // 清除倒數計時器
                this.startGameRound(false); // 開始下一局 (非新比賽)
            }
        }
        return true;
    }

    /**
     * @description 處理玩家的再戰投票。
     * @param {number} playerId - 投票的玩家ID。
     * @param {'yes'} vote - 玩家的投票 ('yes' 表示同意)。
     * @returns {boolean} 動作是否成功。
     */
    private processPlayerVoteRematch(playerId: number, vote: 'yes'): boolean {
        if (this.gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES) {
            console.warn(`[GameRoom ${this.roomId}] 玩家 ${playerId} 嘗試在非 AWAITING_REMATCH_VOTES 階段投票再戰。`);
            return false;
        }
        const player = this.players.find(p => p.id === playerId);
        if (!player || !player.isHuman || !player.isOnline) {
            console.warn(`[GameRoom ${this.roomId}] 只有在線真人玩家才能投票再戰。玩家ID: ${playerId}`);
            return false;
        }

        // 初始化 rematchVotes 如果尚未存在
        if (!this.gameState.rematchVotes) {
            this.gameState.rematchVotes = [];
        }

        // 更新或添加玩家的投票
        const existingVoteIndex = this.gameState.rematchVotes.findIndex(v => v.playerId === playerId);
        if (existingVoteIndex !== -1) { // 如果已投票，更新 (理論上客戶端UI會阻止重複投票 'yes')
            this.gameState.rematchVotes[existingVoteIndex].vote = vote;
        } else { // 否則添加新投票
            this.gameState.rematchVotes.push({ playerId, vote });
        }
        this.addLog(`${player.name} (座位: ${playerId}) 投票同意再戰。`);
        this.broadcastGameState(); // 廣播狀態更新

        // 檢查是否所有在線真人玩家都已同意再戰
        const onlineHumans = this.players.filter(p => p.isHuman && p.isOnline);
        const agreedHumans = onlineHumans.filter(p => this.gameState.rematchVotes?.find(v => v.playerId === p.id && v.vote === 'yes'));

        if (onlineHumans.length > 0 && onlineHumans.length === agreedHumans.length) {
            this.addLog("所有在線真人玩家已同意再戰，提前開始新比賽。");
            this.handleRematchVoteTimeout(true); // isEarlyStart = true
        }
        return true;
    }


    /**
     * @description 處理無效宣告 (例如手牌不足)。
     * @param {ServerPlayer} player - 執行無效宣告的玩家。
     * @param {string} claimType - 無效宣告的類型 (例如 "Peng", "Chi")。
     */
    private handleInvalidClaim(player: ServerPlayer, claimType: string): void {
        this.addLog(`${player.name} (座位: ${player.id}) 宣告 ${claimType} 失敗 (條件不符)。`);
        if(player.socketId) this.io.to(player.socketId).emit('gameError', `您的 ${claimType} 宣告無效。`);
        // 自動將此玩家的宣告視為 PASS_CLAIM，並繼續宣告流程
        this.processPassClaim(player.id);
    }

    /**
     * @description 從棄牌堆中消耗掉一張被面子 (碰、吃、槓) 使用的牌。
     * @param {string} tileId - 被消耗的牌的ID。
     */
    private consumeDiscardedTileForMeld(tileId: string): void {
        // 移除棄牌堆中對應的牌 (理論上應為最後一張棄牌，即棄牌堆頂部)
        if (this.gameState.lastDiscardedTile && this.gameState.lastDiscardedTile.id === tileId) {
            this.gameState.discardPile.shift(); // 從頂部移除
            this.gameState.lastDiscardedTile = null; // 清除最後棄牌記錄
        } else {
            // 如果不是最後一張棄牌 (可能發生在一炮多響，或多重宣告中低優先級的宣告)，則從棄牌堆中查找並移除
            const indexToRemove = this.gameState.discardPile.findIndex(t => t.id === tileId);
            if (indexToRemove !== -1) {
                this.gameState.discardPile.splice(indexToRemove, 1);
            } else {
                console.warn(`[GameRoom ${this.roomId}] 嘗試消耗棄牌 ${tileId}，但在棄牌堆中未找到。`);
            }
        }
    }
    
    /**
     * @description 當一張牌被打出後，檢查其他玩家是否可以對其進行宣告 (胡、碰、槓、吃)。
     * @param {Tile} discardedTile - 被打出的牌。
     * @param {number} discarderId - 打出該牌的玩家ID。
     */
    private checkForClaims(discardedTile: Tile, discarderId: number): void {
        this.gameState.potentialClaims = []; // 清空潛在宣告列表
        // 遍歷所有其他玩家 (非打牌者)
        this.players.forEach(player => {
            if (player.id === discarderId) return; // 跳過打牌者自己

            player.pendingClaims = []; // 清空該玩家的待宣告動作

            // 檢查胡牌
            if (checkWinCondition([...player.hand, discardedTile], player.melds).isWin) {
                // Fix: Wrap discardedTile in an array for claim.tiles
                player.pendingClaims.push({ playerId: player.id, action: 'Hu', priority: ACTION_PRIORITY.HU, tiles: [discardedTile] });
            }
            // 檢查槓牌
            if (canMingGang(player.hand, discardedTile)) {
                player.pendingClaims.push({ playerId: player.id, action: 'Gang', priority: ACTION_PRIORITY.GANG, tiles: [discardedTile] });
            }
            // 檢查碰牌
            if (canPeng(player.hand, discardedTile)) {
                player.pendingClaims.push({ playerId: player.id, action: 'Peng', priority: ACTION_PRIORITY.PENG, tiles: [discardedTile] });
            }
            // 檢查吃牌 (僅限下家)
            if (player.id === (discarderId + 1) % NUM_PLAYERS) {
                const chiOptions = getChiOptions(player.hand, discardedTile);
                if (chiOptions.length > 0) {
                    // 實際的吃牌選項 (chiOptions) 將在 AWAITING_PLAYER_CLAIM_ACTION 階段傳給客戶端
                    // Fix: Wrap discardedTile in an array for claim.tiles
                    player.pendingClaims.push({ playerId: player.id, action: 'Chi', priority: ACTION_PRIORITY.CHI, tiles: [discardedTile] }); // tiles 這裡僅示意
                    this.gameState.chiOptions = chiOptions; // 暫存吃牌選項
                }
            }
            // 將該玩家所有可行的宣告加入到潛在宣告總列表
            this.gameState.potentialClaims.push(...player.pendingClaims);
        });

        if (this.gameState.potentialClaims.length > 0) { // 如果有任何宣告
            this.gameState.gamePhase = GamePhase.AWAITING_CLAIMS_RESOLUTION; // 進入宣告處理階段
            this.startClaimDecisionProcess(); // 開始宣告決策流程
        } else { // 如果沒有任何宣告
            this.addLog(`無人宣告 ${discardedTile.kind}。`);
            this.gameState.lastDiscardedTile = null; // 清除最後棄牌 (已被安全打出)
            this.advanceToNextPlayerTurn(true); // 推進到下一位玩家摸牌 (是棄牌後)
        }
        this.broadcastGameState(); // 廣播遊戲狀態
    }

    /**
     * @description 開始宣告決策流程，按優先順序遍歷可宣告的玩家。
     */
    private startClaimDecisionProcess(): void {
        // 按優先順序排序所有潛在宣告 (胡 > 槓/碰 > 吃)
        this.gameState.potentialClaims.sort((a, b) => b.priority - a.priority);

        // 找到最高優先順序的宣告者
        const highestPriorityClaim = this.gameState.potentialClaims[0];
        if (!highestPriorityClaim) { // 理論上不應發生，因為此函數在 potentialClaims > 0 時調用
            this.advanceToNextPlayerTurn(true); 
            return;
        }
        // 找到所有具有相同最高優先順序的宣告
        const highestPriorityClaims = this.gameState.potentialClaims.filter(
            claim => claim.priority === highestPriorityClaim.priority
        );

        // 處理一炮多響 (多個玩家胡同一張牌)
        if (highestPriorityClaim.action === 'Hu' && highestPriorityClaims.length > 1) {
            this.addLog(`一炮多響！玩家 ${highestPriorityClaims.map(c => `${this.players.find(p=>p.id===c.playerId)?.name}(${c.playerId})`).join(', ')} 均可胡牌 ${this.gameState.lastDiscardedTile!.kind}。`);
            // 逐個處理所有胡牌宣告
            highestPriorityClaims.forEach(huClaim => {
                this.processDeclareHu(huClaim.playerId); // 處理胡牌 (內部會判斷是否真胡)
            });
            // 胡牌處理完畢後，handleRoundEndFlow 會被觸發，無需再推進回合
            return;
        }

        // 對於單個最高優先順序宣告者，或非胡牌的多個同優先級宣告者 (例如同時可碰和槓，則槓優先)，
        // 讓該玩家做決定。
        const playerToDecide = this.players.find(p => p.id === highestPriorityClaim.playerId);
        if (playerToDecide) {
            this.gameState.playerMakingClaimDecision = playerToDecide.id; // 設定正在做決定的玩家
            this.gameState.gamePhase = GamePhase.AWAITING_PLAYER_CLAIM_ACTION; // 更新遊戲階段
             // 為該玩家的可宣告動作賦值 (pendingClaims 已在 checkForClaims 中設定)
             // playerToDecide.pendingClaims = [highestPriorityClaim]; // 此處邏輯調整：pendingClaims 應包含所有該玩家的可宣告選項
             // 在 checkForClaims 中，每個 player 的 pendingClaims 已經被賦值。
             // 此處只需確保 gameState.chiOptions 對應正確 (如果宣告的是Chi)
            if (highestPriorityClaim.action === 'Chi') {
                this.gameState.chiOptions = getChiOptions(playerToDecide.hand, this.gameState.lastDiscardedTile!);
            } else {
                this.gameState.chiOptions = null; // 非吃牌則清空
            }

            this.addLog(`輪到 ${playerToDecide.name} (座位: ${playerToDecide.id}) 決定是否宣告 ${highestPriorityClaim.action} ${this.gameState.lastDiscardedTile!.kind}。`);
            this.startActionTimerForPlayer(playerToDecide.id); // 啟動其行動計時器
            this.broadcastGameState(); // 廣播遊戲狀態
            this.processAITurnIfNeeded(); // 如果是AI，處理其行動
        } else { // 如果找不到該玩家 (理論上不應發生)
            this.advanceToNextPlayerTurn(true); 
        }
    }

    /**
     * @description 推進遊戲到下一個玩家的回合。
     * @param {boolean} afterDiscard - 是否在一次成功的棄牌之後調用此函數。
     */
    private advanceToNextPlayerTurn(afterDiscard: boolean): void {
        this.clearClaimsAndTimer(); // 清除所有宣告和計時器
        
        // 如果不是在棄牌後調用 (例如，是宣告被跳過後)，則不需要清除最後棄牌
        if (afterDiscard) { 
            this.gameState.lastDiscardedTile = null;
        }

        // 輪到下一位玩家
        this.gameState.currentPlayerIndex = (this.gameState.lastDiscarderIndex !== null && afterDiscard)
                                        ? (this.gameState.lastDiscarderIndex + 1) % NUM_PLAYERS // 下家
                                        : (this.gameState.currentPlayerIndex + 1) % NUM_PLAYERS; // 正常輪轉

        this.gameState.turnNumber++; // 回合數加一
        this.gameState.gamePhase = GamePhase.PLAYER_TURN_START; // 設定遊戲階段為等待摸牌
        
        const nextPlayer = this.players.find(p => p.id === this.gameState.currentPlayerIndex);
        if(nextPlayer) {
            this.addLog(`輪到 ${nextPlayer.name} (座位: ${nextPlayer.id}) 摸牌。`);
            this.startActionTimerForPlayer(nextPlayer.id); // 為下一位玩家啟動行動計時器
        }
        this.broadcastGameState(); // 廣播遊戲狀態
        this.processAITurnIfNeeded(); // 如果下一位是AI，處理其行動
    }
    
    /**
     * @description 處理玩家行動超時的邏輯。
     * @param {number} playerId - 超時的玩家ID。
     * @param {'claim' | 'turn'} timerType - 超時的計時器類型。
     * @param {boolean} isOffline - 玩家是否已離線。
     */
    private handlePlayerActionTimeout(playerId: number, timerType: 'claim' | 'turn', isOffline: boolean): void {
        this.clearActionTimer(); // 首先清除計時器
        const player = this.players.find(p => p.id === playerId); // 找到超時玩家
        if (!player) { console.error(`[GameRoom ${this.roomId}] handlePlayerActionTimeout: 玩家 ${playerId} 未找到。`); return; }

        this.addLog(`${player.name} (座位: ${player.id}) 行動超時${isOffline ? ' (因離線)' : ''}。`);

        if (timerType === 'claim') { // 如果是宣告階段超時
            this.addLog(`${player.name} 宣告超時，自動跳過。`);
            this.processPassClaim(playerId); // 自動跳過宣告
        } else if (timerType === 'turn') { // 如果是回合內行動超時
            this.addLog(`${player.name} 回合行動超時，系統自動打牌。`);
            let tileToDiscard: Tile | null = null; // 要自動打出的牌

            // 如果是 PLAYER_DRAWN 階段，且有剛摸的牌，則優先打出剛摸的牌
            if (this.gameState.gamePhase === GamePhase.PLAYER_DRAWN && this.gameState.lastDrawnTile) {
                tileToDiscard = this.gameState.lastDrawnTile;
            } else if (player.hand.length > 0) { // 否則，從手牌中選擇一張打出
                // AI 選擇策略：如果玩家離線或AI，用AI邏輯選牌；否則隨機選一張 (或選最後一張)
                const handForDiscardChoice = (this.gameState.gamePhase === GamePhase.PLAYER_DRAWN && this.gameState.lastDrawnTile) 
                        ? [...player.hand, this.gameState.lastDrawnTile] 
                        : player.hand;
                if (isOffline || !player.isHuman) {
                     // Fix: Use AIService method to choose discard tile
                    tileToDiscard = this.aiService.chooseDiscardForTimeoutOrOffline(handForDiscardChoice, this.getGameState());
                } else { // 真人玩家在線超時，隨機打出一張手牌
                    tileToDiscard = player.hand[Math.floor(Math.random() * player.hand.length)];
                }
            }
            // 如果最終仍無法確定打哪張牌 (例如手牌空了但未胡，異常情況)
            if (!tileToDiscard && this.gameState.lastDrawnTile) {
                 tileToDiscard = this.gameState.lastDrawnTile; // 打出剛摸的牌作為最後手段
            }


            if (tileToDiscard) { // 如果成功選定要打的牌
                this.processDiscardTile(playerId, tileToDiscard.id);
            } else { // 如果仍無牌可打 (嚴重錯誤)
                console.error(`[GameRoom ${this.roomId}] 玩家 ${player.name} 回合超時，但無牌可打！`);
                this.addLog(`嚴重錯誤: ${player.name} 無牌可打，遊戲可能卡住。`);
                // 此處可能需要更健壯的錯誤處理，例如強制流局或結束遊戲
                this.gameState.isDrawGame = true;
                this.handleRoundEndFlow();
                this.broadcastGameState();
            }
        }
        // processPassClaim 和 processDiscardTile 內部會調用 processAITurnIfNeeded
    }

    /**
     * @description 處理一局遊戲結束後的流程 (胡牌或流局)。
     */
    private handleRoundEndFlow(): void {
        this.clearActionTimer(); // 清除行動計時器
        this.clearAiActionTimeout(); // 清除AI行動計時器
        this.gameState.gamePhase = GamePhase.ROUND_OVER; // 設定遊戲階段為本局結束

        // 計算本局得分 (此處僅為示例，實際得分計算可能更複雜)
        if (this.gameState.winnerId !== null) {
            const winner = this.players.find(p => p.id === this.gameState.winnerId);
            if (winner) {
                let baseScore = 100; // 基礎分
                if (this.gameState.winType === 'selfDrawn') baseScore *= 2; // 自摸翻倍
                winner.score += baseScore; // 贏家加分
                this.addLog(`${winner.name} 本局獲勝，得分 ${baseScore}。總分: ${winner.score}`);
                // 如果是食胡，則放槍者扣分
                if (this.gameState.winType === 'discard' && this.gameState.winningTileDiscarderId !== null) {
                    const discarder = this.players.find(p => p.id === this.gameState.winningTileDiscarderId);
                    if (discarder) {
                        discarder.score -= baseScore; // 放槍者扣分
                        this.addLog(`${discarder.name} 放槍，扣分 ${baseScore}。總分: ${discarder.score}`);
                    }
                }
            }
        } else if (this.gameState.isDrawGame) {
            this.addLog("本局流局，無人得分變動。");
        }
        this.updateGameStatePlayers(); // 更新遊戲狀態中的玩家得分

        // 檢查是否所有局數都已完成
        if (this.gameState.currentRound >= (this.roomSettings.numberOfRounds || DEFAULT_NUMBER_OF_ROUNDS)) {
            this.handleMatchEnd(); // 處理整場比賽結束
        } else { // 如果比賽未結束，則準備開始下一局
            this.addLog(`準備進入下一局。`);
            this.gameState.nextRoundCountdown = NEXT_ROUND_COUNTDOWN_SECONDS; // 設定下一局倒數
            this.broadcastGameState(); // 廣播狀態 (包含倒數資訊)

            // 啟動下一局開始的倒數計時器
            this.nextRoundTimerInterval = setInterval(() => {
                if (this.gameState.nextRoundCountdown !== null && this.gameState.nextRoundCountdown > 0) {
                    this.gameState.nextRoundCountdown--;
                    this.broadcastGameState();
                }
                if (this.gameState.nextRoundCountdown === 0) {
                    this.clearNextRoundTimer(); // 清除計時器
                    this.startGameRound(false); // 開始下一局 (非新比賽)
                }
            }, 1000);
        }
    }

    /**
     * @description 處理整場比賽結束 (所有局數完成) 的邏輯。
     */
    private handleMatchEnd(): void {
        this.clearActionTimer();
        this.clearNextRoundTimer();
        this.clearAiActionTimeout();

        this.gameState.matchOver = true; // 標記比賽已結束
        this.gameState.gamePhase = GamePhase.AWAITING_REMATCH_VOTES; // 進入等待再戰投票階段
        this.addLog(`所有 ${this.roomSettings.numberOfRounds} 局已完成，比賽結束！`);
        
        // 初始化再戰投票狀態
        this.gameState.rematchVotes = this.players
            .filter(p => p.isHuman && p.isOnline) // 只為在線真人玩家初始化
            .map(p => ({ playerId: p.id, vote: 'pending' }));
        this.gameState.rematchCountdown = REMATCH_VOTE_TIMEOUT_SECONDS;
        
        console.log(`[GameRoom ${this.roomId}] 比賽結束，進入再戰投票階段。在線真人玩家數: ${this.players.filter(p=>p.isHuman && p.isOnline).length}`);
        this.broadcastGameState(); // 廣播最終結果和再戰投票狀態

        // 啟動再戰投票計時器
        this.rematchTimerInterval = setInterval(() => {
            // 修正：確保 rematchCountdown 是數字類型才進行操作
            if (typeof this.gameState.rematchCountdown === 'number' && this.gameState.rematchCountdown > 0) {
                this.gameState.rematchCountdown--;
                this.broadcastGameState();
            }
            // 如果計時器到0 (嚴格等於0，因為可能在其他地方被設為null)
            if (this.gameState.rematchCountdown === 0) {
                this.handleRematchVoteTimeout(false); // isEarlyStart = false
            }
        }, 1000);
    }

    /**
     * @description 處理再戰投票超時或提前開始的邏輯。
     * @param {boolean} isEarlyStart - 是否為所有玩家提前同意導致的開始。
     */
    private handleRematchVoteTimeout(isEarlyStart: boolean): void {
        this.clearRematchTimer(); // 清除計時器

        if (!isEarlyStart) {
            this.addLog("再戰投票時間到。");
        }

        const agreedHumanPlayers = this.players.filter(p => 
            p.isHuman && p.isOnline && this.gameState.rematchVotes?.find(v => v.playerId === p.id && v.vote === 'yes')
        );
        const onlineHumanPlayers = this.players.filter(p => p.isHuman && p.isOnline);

        // 條件：所有在線的真人玩家都必須同意
        if (onlineHumanPlayers.length > 0 && agreedHumanPlayers.length === onlineHumanPlayers.length) {
            this.addLog("所有在線真人玩家同意再戰！準備開始新的一場比賽。");
            
            // 重置玩家列表，只保留同意的真人玩家
            this.players = agreedHumanPlayers; 
            // 如果同意的玩家中有原房主，則其繼續為房主；否則重新指派
            const originalHostAgreed = agreedHumanPlayers.find(p => p.socketId === this.roomSettings.hostSocketId);
            if (originalHostAgreed) {
                this.players.forEach(p => p.isHost = (p.id === originalHostAgreed.id));
                this.roomSettings.hostName = originalHostAgreed.name;
                this.roomSettings.hostSocketId = originalHostAgreed.socketId!;
            } else if (agreedHumanPlayers.length > 0) { // 如果原房主未同意，但有其他同意者，則指派新房主
                this.players[0].isHost = true;
                this.roomSettings.hostName = this.players[0].name;
                this.roomSettings.hostSocketId = this.players[0].socketId!;
                this.players.slice(1).forEach(p => p.isHost = false);
            }
             // 確保房主狀態正確設定到 gameState
            this.gameState.hostPlayerName = this.roomSettings.hostName;
            this.players.forEach(p => {
                if (p.socketId === this.roomSettings.hostSocketId) p.isHost = true;
                else p.isHost = false;
            });

            this.initializeAIPlayers(); // 根據剩餘真人玩家填充AI
            
            // 再次檢查填充AI後人數是否足夠
            if (this.players.length < NUM_PLAYERS) {
                 this.addLog(`同意再戰的玩家加上AI後人數不足 ${NUM_PLAYERS}。比賽無法開始，房間關閉。`);
                 this.gameState.gamePhase = GamePhase.GAME_OVER;
                 this.gameState.matchOver = true; // 確保 matchOver 為 true
                 this.broadcastGameState();
                 this.onRoomEmptyCallback(); // 關閉房間
                 return;
            }

            this.startGameRound(true); // 開始一場全新的比賽 (isNewMatch = true)
        } else { // 如果並非所有在線真人玩家都同意，或沒有在線真人玩家
            this.addLog("並非所有在線真人玩家都同意再戰，或無人同意。比賽結束，房間關閉。");
             // 將未同意或超時的玩家送回大廳
            onlineHumanPlayers.forEach(p => {
                if (!this.gameState.rematchVotes?.find(v => v.playerId === p.id && v.vote === 'yes')) {
                    if (p.socketId) {
                        this.io.to(p.socketId).emit('gameError', '您未同意再戰或投票超時，已返回大廳。');
                        // RoomManager 的 leaveRoom 會處理 socket.join('lobby')
                        const playerSocket = this.io.sockets.sockets.get(p.socketId);
                        if (playerSocket) {
                            // Fix: Use socket.leave instead of adapter.remoteLeave
                            playerSocket.leave(this.roomId);
                            // Fix: Use imported LOBBY_ROOM_NAME
                            playerSocket.join(LOBBY_ROOM_NAME); // 加入大廳
                             // Fix: Use imported LOBBY_ROOM_NAME
                            console.log(`[GameRoom ${this.roomId}] Socket ${p.socketId} 因再戰投票未同意/超時，已加入 '${LOBBY_ROOM_NAME}' 群組。`);
                            // 通知大廳列表更新 (由 RoomManager 的 leaveRoom 或 disconnect 處理)
                        }
                    }
                }
            });

            this.gameState.gamePhase = GamePhase.GAME_OVER; // 確保遊戲狀態為最終結束
            this.gameState.matchOver = true; // 確保比賽結束標記
            this.broadcastGameState(); // 廣播最終狀態
            this.onRoomEmptyCallback(); // 觸發房間關閉回調 (RoomManager 會處理後續)
        }
    }

    /**
     * @description 清除AI行動的延遲計時器。
     */
    private clearAiActionTimeout(): void {
        if (this.aiActionTimeout) {
            clearTimeout(this.aiActionTimeout);
            this.aiActionTimeout = null;
        }
    }
    
    /**
     * @description 向房間內所有客戶端廣播一個動作宣告的視覺特效。
     * @param {string} text - 宣告的文字 (例如："碰", "胡", 或牌面)。
     * @param {number} playerId - 執行動作的玩家ID (座位索引)。
     * @param {boolean} [isMultiHuTarget=false] - 是否為一炮多響的目標之一。
     */
    private broadcastActionAnnouncement(text: string, playerId: number, isMultiHuTarget = false): void {
        // 伺服器端總是基於絕對的座位索引來定位玩家
        // 客戶端在接收到事件後，會根據自己的 clientPlayerId 計算出相對位置
        // 此處的 'position' 欄位可以省略，或由客戶端忽略
        this.io.to(this.roomId).emit('actionAnnouncement', {
            text,
            playerId, // 傳遞絕對的座位索引
            position: 'bottom', // 此 position 欄位實際上會被客戶端覆蓋
            id: Date.now() + Math.random(), // 產生唯一的宣告ID
            isMultiHuTarget: isMultiHuTarget, // 是否為一炮多響目標
        });
    }

    /**
     * @description 銷毀遊戲房間，清除所有計時器。
     */
    public destroy(): void {
        this.clearActionTimer();
        this.clearNextRoundTimer();
        this.clearRematchTimer();
        this.clearAiActionTimeout();
        if (this.emptyRoomTimer) {
            clearTimeout(this.emptyRoomTimer);
            this.emptyRoomTimer = null;
        }
        // 可以選擇性地通知房間內所有剩餘玩家房間已解散
        this.io.to(this.roomId).emit('gameError', '房間已被解散。');
        // 清空玩家列表，確保所有 Socket 離開房間
        this.players.forEach(player => {
            if (player.socketId) {
                const socket = this.io.sockets.sockets.get(player.socketId);
                if (socket) {
                    socket.leave(this.roomId);
                    delete socket.data.currentRoomId;
                    delete socket.data.playerId;
                }
            }
        });
        this.players = [];
        console.log(`[GameRoom ${this.roomId}] 已銷毀。`);
    }
}
