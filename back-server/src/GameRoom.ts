
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
    LOBBY_ROOM_NAME,
    PLAYABLE_TILE_KINDS,
    TILES_PER_KIND,
    GamePhaseTranslations
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

// 引入新的模組化處理器
import * as PlayerActionHandler from './gameRoomModules/playerActionHandler';
import * as ClaimHandler from './gameRoomModules/claimHandler';
import * as TurnHandler from './gameRoomModules/turnHandler';
import * as RoundHandler from './gameRoomModules/roundHandler';
import * as MatchHandler from './gameRoomModules/matchHandler';
import * as AIHandler from './gameRoomModules/aiHandler';
import * as TimerManager from './gameRoomModules/timerManager'; // 引入計時器管理器


/**
 * @class GameRoom
 * @description 管理單個遊戲房間的邏輯，包括遊戲狀態、玩家互動、AI行為等。
 */
export class GameRoom {
  public io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>; // Socket.IO 伺服器實例
  public roomId: string; // 房間的唯一ID
  public roomSettings: RoomSettings; // 房間的設定
  public gameState: GameState; // 當前的遊戲狀態
  public players: ServerPlayer[] = []; // 房間內的玩家列表 (伺服器端權威來源，按座位ID排序)
  public aiService: AIService; // AI 決策服務
  private onRoomEmptyCallback: () => void; // 當房間變空時的回調函數 (通知 RoomManager 移除此房間)
  
  // 計時器 ID，由 TimerManager 模組管理和設定
  public emptyRoomTimerId: NodeJS.Timeout | null = null; 
  public actionTimerId: NodeJS.Timeout | null = null; 
  public nextRoundTimerId: NodeJS.Timeout | null = null; 
  public rematchTimerId: NodeJS.Timeout | null = null; 
  public aiActionTimeoutId: NodeJS.Timeout | null = null; // AI 行動的延遲計時器 ID
  public roundTimeoutTimerId: NodeJS.Timeout | null = null; // 全局單局超時計時器 ID
  
  public actionSubmitLock: Set<number> = new Set(); // 用於防止玩家重複提交動作的鎖 (儲存玩家ID)


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
    this.roomSettings = {
        ...settings,
        numberOfRounds: settings.numberOfRounds || DEFAULT_NUMBER_OF_ROUNDS,
    };
    this.aiService = new AIService(); 
    this.onRoomEmptyCallback = onRoomEmptyCallback; 

    this.gameState = this.createInitialCleanGameState(); 
    this.resetEmptyRoomTimer(); 

    console.info(`[GameRoom ${this.roomId}] 創建成功，設定:`, JSON.stringify(this.roomSettings)); 
  }

  /**
   * @description 創建一個初始且乾淨的遊戲狀態物件。
   * @returns {GameState} 初始遊戲狀態。
   */
  public createInitialCleanGameState(): GameState {
    return {
      roomId: this.roomId,
      roomName: this.roomSettings.roomName, 
      players: [], 
      deck: [], 
      discardPile: [], 
      currentPlayerIndex: 0, 
      dealerIndex: 0, 
      lastDiscarderIndex: null, 
      gamePhase: GamePhase.LOADING, 
      lastDiscardedTile: null, 
      lastDrawnTile: null, 
      turnNumber: 0, 
      messageLog: [], 
      potentialClaims: [], 
      winnerId: null, 
      winningTileDiscarderId: null, 
      winType: null, 
      winningDiscardedTile: null, 
      isDrawGame: false, 
      chiOptions: null, 
      playerMakingClaimDecision: null, 
      actionTimer: null, 
      actionTimerType: null, 
      numberOfRounds: this.roomSettings.numberOfRounds, 
      currentRound: 1, 
      matchOver: false, 
      nextRoundCountdown: null, 
      humanPlayersReadyForNextRound: [], 
      configuredHumanPlayers: this.roomSettings.humanPlayers, 
      configuredFillWithAI: this.roomSettings.fillWithAI, 
      hostPlayerName: this.roomSettings.hostName, 
      rematchVotes: [], 
      rematchCountdown: null, 
    };
  }

  /**
   * @description 初始化AI玩家以填補空位。
   */
  public initializeAIPlayers(): void {
    const currentHumanPlayersCount = this.players.filter(p => p.isHuman).length; 
    let aisNeeded = NUM_PLAYERS - currentHumanPlayersCount; 
    aisNeeded = Math.max(0, aisNeeded); 

    console.info(`[GameRoom ${this.roomId}] 初始化/填充AI玩家: 房間目標總人數=${NUM_PLAYERS}, 當前真人數=${currentHumanPlayersCount}, 需要AI數=${aisNeeded}`); 

    if (aisNeeded > 0) {
        let aiNameCounter = this.players.filter(p => !p.isHuman).length; 
        for (let i = 0; i < NUM_PLAYERS; i++) { 
            if (aisNeeded <= 0) break; 

            const seatIsOccupied = this.players.some(p => p.id === i); 
            if (!seatIsOccupied) { 
                const aiName = `${AI_NAME_PREFIX}${String.fromCharCode(65 + aiNameCounter)}`;
                const aiPlayer = new ServerPlayer(i, aiName, false, null, false);
                this.players.push(aiPlayer);
                this.addLog(`${aiName} (AI, 座位 ${i}) 已加入遊戲。`);
                console.info(`[GameRoom ${this.roomId}] AI 玩家 ${aiName} (ID: ${i}) 加入。`); 
                aisNeeded--;
                aiNameCounter++;
            }
        }
    }
    this.sortPlayersById();
    this.updateGameStatePlayers();
    console.debug(`[GameRoom ${this.roomId}] AI填充完成後, this.players: ${this.players.map(p=>`(ID:${p.id},N:${p.name},H:${p.isHuman})`).join('; ')}`); 
  }


  /**
   * @description 對 this.players 列表按玩家ID (座位索引) 進行升序排序。
   */
  public sortPlayersById(): void {
    this.players.sort((a, b) => a.id - b.id);
  }

  /**
   * @description 更新 this.gameState.players 陣列，使其與 this.players (權威來源) 同步。
   *              同時處理手牌的隱藏邏輯 (對非當前客戶端的其他真人玩家隱藏手牌)。
   */
  public updateGameStatePlayers(): void {
    this.sortPlayersById(); 
    this.gameState.players = this.players.map(p => ({
        id: p.id,
        name: p.name,
        isHuman: p.isHuman,
        hand: (p.isHuman && p.isOnline) ||
              (this.gameState.gamePhase === GamePhase.GAME_OVER ||
               this.gameState.gamePhase === GamePhase.ROUND_OVER ||
               this.gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES)
              ? [...p.hand] 
              : Array(p.hand.length).fill({id:`hidden-${p.id}-${Math.random()}`, kind: TileKind.B_SOLDIER, suit: Suit.BLACK} as Tile),
        melds: p.melds.map(m => ({...m, tiles: [...m.tiles]})), 
        isDealer: p.isDealer,
        score: p.score,
        isOnline: p.isOnline,
        socketId: p.socketId, 
        pendingClaims: p.pendingClaims ? [...p.pendingClaims] : [], 
        isHost: p.isHost,
    }));
  }

  /** @description 獲取當前房間的設定。 */
  public getSettings(): RoomSettings {
    return this.roomSettings;
  }

  /**
   * @description 獲取當前完整的遊戲狀態 (深拷貝)。
   */
  public getGameState(): GameState {
    this.updateGameStatePlayers(); 
    const currentFullGameState = {
        ...JSON.parse(JSON.stringify(this.gameState)),
        roomName: this.roomSettings.roomName,
        configuredHumanPlayers: this.roomSettings.humanPlayers,
        configuredFillWithAI: this.roomSettings.fillWithAI,
        hostPlayerName: this.roomSettings.hostName,
        numberOfRounds: this.roomSettings.numberOfRounds, 
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
  public addLog(message: string): void {
    const timedMessage = `${new Date().toLocaleTimeString('zh-TW', { hour12: false})} - ${message}`;
    this.gameState.messageLog.unshift(timedMessage); 
    if (this.gameState.messageLog.length > MAX_MESSAGE_LOG_ENTRIES) {
      this.gameState.messageLog.pop(); 
    }
  }
  
  /**
   * @description 重置空房間計時器。如果房間內已無真人玩家，則啟動計時器；否則清除計時器。
   * @param {boolean} [isGameEnded=false] - 遊戲是否已結束 (影響計時器時長)。
   */
  public resetEmptyRoomTimer(isGameEnded = false): void {
    if (this.emptyRoomTimerId) { 
      clearTimeout(this.emptyRoomTimerId);
      this.emptyRoomTimerId = null;
    }
    if (this.isEmpty()) { 
      const timeoutDuration = isGameEnded ? GAME_END_EMPTY_ROOM_TIMEOUT_MS : EMPTY_ROOM_TIMEOUT_MS;
      this.emptyRoomTimerId = setTimeout(() => {
        if (this.isEmpty()) { 
          console.info(`[GameRoom ${this.roomId}] 房間因長時間無真人玩家而關閉。`); 
          this.onRoomEmptyCallback(); 
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
    console.info(`[GameRoom ${this.roomId}] addPlayer: 嘗試加入玩家 ${playerName} (房主: ${isHost})。目前房間內玩家數: ${this.players.length}`); 

    const existingPlayerBySocketId = this.players.find(p => p.socketId === socket.id);
    if (existingPlayerBySocketId) {
        existingPlayerBySocketId.isOnline = true; 
        existingPlayerBySocketId.name = playerName; 
        socket.data.currentRoomId = this.roomId; 
        socket.data.playerId = existingPlayerBySocketId.id; 
        socket.join(this.roomId); 
        this.io.to(socket.id).emit('joinedRoom', { gameState: this.getGameState(), roomId: this.roomId, clientPlayerId: existingPlayerBySocketId.id });
        this.addLog(`${existingPlayerBySocketId.name} (座位: ${existingPlayerBySocketId.id}) 已重新連接。`);
        console.info(`[GameRoom ${this.roomId}] 玩家 ${playerName} (ID: ${existingPlayerBySocketId.id}) 重新連接成功。`); 
        this.broadcastGameState(); 
        this.resetEmptyRoomTimer(); 
        return true;
    }

    if (this.players.filter(p => p.isHuman && p.isOnline).length >= this.roomSettings.humanPlayers) {
        socket.emit('lobbyError', '房間的真人玩家名額已滿。');
        console.info(`[GameRoom ${this.roomId}] 玩家 ${playerName} 加入失敗：真人玩家名額已滿。`); 
        return false;
    }

    let assignedSeatIndex = -1; 
    const offlineHumanPlayerByName = this.players.find(p => p.isHuman && !p.isOnline && p.name === playerName);

    if (offlineHumanPlayerByName) { 
        assignedSeatIndex = offlineHumanPlayerByName.id;
        offlineHumanPlayerByName.socketId = socket.id; 
        offlineHumanPlayerByName.isOnline = true;      
        offlineHumanPlayerByName.isHost = isHost;      
        this.addLog(`${offlineHumanPlayerByName.name} (座位: ${assignedSeatIndex}) 的席位已恢復。`);
        console.info(`[GameRoom ${this.roomId}] 玩家 ${playerName} (ID: ${assignedSeatIndex}) 已恢復離線座位。`); 
    } else { 
        for (let i = 0; i < NUM_PLAYERS; i++) { 
            if (!this.players.some(p => p.id === i)) { 
                assignedSeatIndex = i; 
                break;
            }
        }
    }

    if (assignedSeatIndex === -1) {
        socket.emit('lobbyError', '無法找到空位加入房間。');
        console.info(`[GameRoom ${this.roomId}] 玩家 ${playerName} 加入失敗：找不到可用座位。`); 
        return false;
    }

    if (!offlineHumanPlayerByName) {
        const newPlayer = new ServerPlayer(assignedSeatIndex, playerName, true, socket.id, isHost);
        this.players.push(newPlayer); 
        this.sortPlayersById();       
        if (isHost) { 
            this.roomSettings.hostName = playerName;         
            this.roomSettings.hostSocketId = socket.id;      
            this.players.forEach(p => p.isHost = (p.id === newPlayer.id)); 
        }
        console.info(`[GameRoom ${this.roomId}] 新玩家 ${playerName} (ID: ${newPlayer.id}) 已加入座位 ${assignedSeatIndex}。`); 
    }

    const finalPlayerObject = this.players.find(p => p.id === assignedSeatIndex)!;
    socket.data.currentRoomId = this.roomId; 
    socket.data.playerId = finalPlayerObject.id; 
    socket.join(this.roomId); 

    if (this.gameState.gamePhase === GamePhase.LOADING || this.gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS) {
        this.gameState.gamePhase = GamePhase.WAITING_FOR_PLAYERS;
    }

    this.io.to(socket.id).emit('joinedRoom', { gameState: this.getGameState(), roomId: this.roomId, clientPlayerId: finalPlayerObject.id });
    this.addLog(`${playerName} (座位: ${finalPlayerObject.id}) 已加入房間。`);
    this.broadcastGameState(); 
    this.resetEmptyRoomTimer(); 

    console.info(`[GameRoom ${this.roomId}] 玩家 ${playerName} (ID: ${finalPlayerObject.id}) 加入流程完成。房間內物件總數: ${this.players.length}。在線真人數: ${this.players.filter(p=>p.isHuman && p.isOnline).length}。`); 
    return true;
  }

  /**
   * @description 從房間移除一個玩家 (通常因斷線或主動退出)。
   * @param {string} socketId - 要移除的玩家的 Socket ID。
   */
  public removePlayer(socketId: string): void {
    const playerIndexInArray = this.players.findIndex(p => p.socketId === socketId);
    if (playerIndexInArray === -1) { 
        console.warn(`[GameRoom ${this.roomId}] 嘗試移除玩家 (Socket: ${socketId})，但未找到。`); 
        return;
    }

    const removedPlayer = this.players[playerIndexInArray]; 
    console.info(`[GameRoom ${this.roomId}] 玩家 ${removedPlayer.name} (ID: ${removedPlayer.id}, Socket: ${socketId}) 正在被移除。遊戲階段: ${this.gameState.gamePhase}`); 

    const wasPlayingMidGame = ![
        GamePhase.WAITING_FOR_PLAYERS,
        GamePhase.GAME_OVER,
        GamePhase.ROUND_OVER,
        GamePhase.AWAITING_REMATCH_VOTES,
        GamePhase.LOADING
    ].includes(this.gameState.gamePhase);


    if (wasPlayingMidGame && removedPlayer.isHuman) { 
        removedPlayer.isOnline = false; 
        this.addLog(`${removedPlayer.name} 已斷線。`);
        this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, message: `${removedPlayer.name} 已斷線。` });

        if (this.gameState.currentPlayerIndex === removedPlayer.id || this.gameState.playerMakingClaimDecision === removedPlayer.id) {
            TimerManager.clearActionTimer(this); // 改用 TimerManager
            this.addLog(`${removedPlayer.name} 的回合，因斷線而自動處理。`);
            const timerType = this.gameState.actionTimerType || (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION ? 'claim' : 'turn');
            TimerManager.handlePlayerActionTimeout(this, removedPlayer.id, timerType, true); // 改用 TimerManager
        }
        if (this.isEmpty()) {
            this.addLog(`所有真人玩家均已離開，遊戲提前結束並解散房間。`);
            this.gameState.gamePhase = GamePhase.GAME_OVER;
            this.gameState.matchOver = true; 
            this.broadcastGameState(); 
            if (this.emptyRoomTimerId) { clearTimeout(this.emptyRoomTimerId); this.emptyRoomTimerId = null; }

            const departingSocket = this.io.sockets.sockets.get(socketId);
            if (departingSocket) {
                departingSocket.leave(this.roomId);
                console.info(`[GameRoom ${this.roomId}] 玩家 ${removedPlayer.name} (Socket: ${socketId}) 的 socket 已在房間解散前離開 Socket.IO 房間 ${this.roomId}。`); 
            }
            this.onRoomEmptyCallback(); 
            return;
        }
    } else if (this.gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES && removedPlayer.isHuman) { 
        this.addLog(`${removedPlayer.name} 在再戰投票階段離開。`);
        if (this.gameState.rematchVotes) {
            this.gameState.rematchVotes = this.gameState.rematchVotes.filter(v => v.playerId !== removedPlayer.id);
        }
        this.players.splice(playerIndexInArray, 1); 
        this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, message: `${removedPlayer.name} 已離開房間。` });

        const onlineHumans = this.players.filter(p => p.isHuman && p.isOnline);
        const agreedHumans = onlineHumans.filter(p => this.gameState.rematchVotes?.find(v => v.playerId === p.id && v.vote === 'yes'));
        if (onlineHumans.length > 0 && onlineHumans.length === agreedHumans.length) {
            this.addLog("所有剩餘在線真人玩家已同意再戰，提前開始。");
            MatchHandler.handleRematchVoteTimeout(this, true); 
        } else if (onlineHumans.length === 0 && this.gameState.rematchVotes && this.gameState.rematchVotes.length === 0) {
            this.addLog("再戰投票階段已無真人玩家，房間關閉。");
            TimerManager.clearRematchTimer(this); // 改用 TimerManager
            this.gameState.matchOver = true;
            const departingSocket = this.io.sockets.sockets.get(socketId);
            if (departingSocket) {
                departingSocket.leave(this.roomId);
            }
            this.onRoomEmptyCallback();
            return;
        }

    } else { 
        this.players.splice(playerIndexInArray, 1); 
        this.addLog(`${removedPlayer.name} 已離開房間。`);
        this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, message: `${removedPlayer.name} 已離開房間。` });

        if (removedPlayer.isHuman && this.isEmpty()) {
            if (this.gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS) { 
                console.info(`[GameRoom ${this.roomId}] 房間在等待階段因 ${removedPlayer.name} 離開而變空，關閉房間。`); 
                if (this.emptyRoomTimerId) { clearTimeout(this.emptyRoomTimerId); this.emptyRoomTimerId = null; }
                const departingSocket = this.io.sockets.sockets.get(socketId);
                if (departingSocket) {
                    departingSocket.leave(this.roomId);
                }
                this.onRoomEmptyCallback(); 
                return;
            } else if (this.gameState.gamePhase === GamePhase.ROUND_OVER) { 
                this.addLog(`所有真人玩家已於本局結束階段離開，取消下一局並準備關閉房間。`);
                TimerManager.clearNextRoundTimer(this); // 改用 TimerManager
                this.gameState.gamePhase = GamePhase.GAME_OVER;
                this.gameState.matchOver = true;
                this.broadcastGameState();
            } else if (this.gameState.gamePhase === GamePhase.GAME_OVER && !this.gameState.matchOver) { 
                this.addLog(`所有真人玩家已於遊戲結束 (局完成) 階段離開，標記比賽結束。`);
                this.gameState.matchOver = true;
                this.broadcastGameState();
            }
        }
    }

    if (removedPlayer.isHost && this.players.some(p => p.isHuman && p.isOnline)) {
        this.assignNewHost();
    }

    this.sortPlayersById(); 
    this.updateGameStatePlayers(); 
    this.broadcastGameState();     

    this.resetEmptyRoomTimer(this.gameState.gamePhase === GamePhase.GAME_OVER || this.gameState.gamePhase === GamePhase.ROUND_OVER || this.gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES);

    const clientSocket = this.io.sockets.sockets.get(socketId);
    if(clientSocket) {
        if (!(wasPlayingMidGame && removedPlayer.isHuman && this.isEmpty())) {
             clientSocket.leave(this.roomId); 
        }
        delete clientSocket.data.currentRoomId; 
        delete clientSocket.data.playerId;      
    }
  }

  /**
   * @description 當原房主離開後，從房間内已有的真人玩家中指派一位新的房主。
   */
  public assignNewHost(): void {
    this.sortPlayersById(); 
    const newHost = this.players.find(p => p.isHuman && p.isOnline); 
    if (newHost) { 
      this.players.forEach(p => p.isHost = (p.id === newHost.id)); 
      this.roomSettings.hostName = newHost.name; 
      this.roomSettings.hostSocketId = newHost.socketId!; 
      this.gameState.hostPlayerName = newHost.name; 
      this.addLog(`${newHost.name} (座位: ${newHost.id}) 已被指定為新的房主。`);
      console.info(`[GameRoom ${this.roomId}] 新房主: ${newHost.name} (Socket: ${newHost.socketId})`); 
    } else { 
      this.roomSettings.hostName = "無"; 
      this.roomSettings.hostSocketId = undefined;
      this.gameState.hostPlayerName = "無";
      this.addLog(`沒有可用的真人玩家成為新房主。`);
      console.info(`[GameRoom ${this.roomId}] 沒有可用的真人玩家可成為新房主。`); 
    }
  }

  /**
   * @description 處理房主發起的開始遊戲請求。
   * @param {string} socketId - 發起請求的玩家的 Socket ID。
   */
  public requestStartGame(socketId: string): void {
    const player = this.players.find(p => p.socketId === socketId); 
    if (!player || !player.isHost) { 
      this.io.to(socketId).emit('gameError', '只有房主才能開始遊戲。');
      return;
    }
    if (this.gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS) { 
      this.io.to(socketId).emit('gameError', '遊戲已經開始或狀態不正確，無法開始。');
      return;
    }

    const humanPlayersOnlineCount = this.players.filter(p => p.isHuman && p.isOnline).length;
    if (humanPlayersOnlineCount < this.roomSettings.humanPlayers) {
         this.io.to(socketId).emit('gameError', `至少需要 ${this.roomSettings.humanPlayers} 位真人玩家才能開始。目前 ${humanPlayersOnlineCount} 位。`);
        return;
    }

    this.initializeAIPlayers();

    if (this.players.length < NUM_PLAYERS) {
        this.io.to(socketId).emit('gameError', `需要 ${NUM_PLAYERS} 位玩家才能開始遊戲 (AI填充後仍不足)。`);
        return;
    }

    console.info(`[GameRoom ${this.roomId}] 房主 ${player.name} (座位: ${player.id}) 開始遊戲。AI 已填充 (如果需要)。`); 
    RoundHandler.startGameRound(this, true); // isNewMatch = true
  }


  /**
   * @description 處理來自真人玩家的遊戲動作。
   * @param {string} socketId - 執行動作的玩家的 Socket ID。
   * @param {GameActionPayload} action - 玩家執行的動作及其負載。
   */
  public handlePlayerAction(socketId: string, action: GameActionPayload): void {
    const player = this.players.find(p => p.socketId === socketId); 
    if (!player || !player.isHuman) { 
        console.warn(`[GameRoom ${this.roomId}] 收到來自非人類或未知 socket (${socketId}) 的動作: `, action); 
        this.io.to(socketId).emit('gameError', '無效的玩家身份。');
        return;
    }
    if (this.actionSubmitLock.has(player.id)) {
        this.io.to(socketId).emit('gameError', '操作太頻繁或正在處理您的上一個動作。');
        return;
    }
    this.actionSubmitLock.add(player.id); 

    console.debug(`[GameRoom ${this.roomId}] 玩家 ${player.name} (ID: ${player.id}, 真人: ${player.isHuman}) 嘗試執行動作: ${action.type}`, JSON.stringify(action).substring(0, 100)); 

    // AI 計時器的清除邏輯已移至 aiHandler.ts 內部或明確的遊戲階段轉換點
    // AIHandler.clearAiActionTimeout(this); 

    if (player.id === this.gameState.currentPlayerIndex || player.id === this.gameState.playerMakingClaimDecision) {
        TimerManager.clearActionTimer(this); // 改用 TimerManager (清除人類玩家的 UI 計時器)
    }

    let actionIsValid = true; 

    try { 
        switch (action.type) {
            case 'DRAW_TILE': 
                actionIsValid = PlayerActionHandler.processDrawTile(this, player.id);
                break;
            case 'DISCARD_TILE': 
                actionIsValid = PlayerActionHandler.processDiscardTile(this, player.id, action.tileId);
                break;
            case 'DECLARE_HU': 
                actionIsValid = PlayerActionHandler.processDeclareHu(this, player.id);
                break;
            case 'CLAIM_PENG': 
                actionIsValid = PlayerActionHandler.processClaimPeng(this, player.id, action.tile);
                break;
            case 'CLAIM_GANG': 
                actionIsValid = PlayerActionHandler.processClaimGang(this, player.id, action.tile);
                break;
            case 'CLAIM_CHI': 
                actionIsValid = PlayerActionHandler.processClaimChi(this, player.id, action.tilesToChiWith, action.discardedTile);
                break;
            case 'DECLARE_AN_GANG': 
                actionIsValid = PlayerActionHandler.processDeclareAnGang(this, player.id, action.tileKind);
                break;
            case 'DECLARE_MING_GANG_FROM_HAND': 
                actionIsValid = PlayerActionHandler.processDeclareMingGangFromHand(this, player.id, action.tileKind);
                break;
            case 'PASS_CLAIM': 
                actionIsValid = PlayerActionHandler.processPassClaim(this, player.id);
                break;
            case 'PLAYER_CONFIRM_NEXT_ROUND': 
                actionIsValid = RoundHandler.processPlayerConfirmNextRound(this, player.id);
                break;
            case 'PLAYER_VOTE_REMATCH': 
                actionIsValid = MatchHandler.processPlayerVoteRematch(this, player.id, action.vote);
                break;
            default: 
                console.warn(`[GameRoom ${this.roomId}] 未處理的玩家動作類型:`, (action as any).type); 
                this.io.to(socketId).emit('gameError', '未知的動作類型。');
                actionIsValid = false;
        }
    } catch (error) { 
        console.error(`[GameRoom ${this.roomId}] 處理玩家 ${player.name} 動作 ${action.type} 時發生錯誤:`, error); 
        this.io.to(socketId).emit('gameError', `處理動作時發生內部錯誤: ${(error as Error).message}`);
        actionIsValid = false;
    } finally {
        this.actionSubmitLock.delete(player.id); 
    }

    if (actionIsValid) { 
        // 在有效動作處理完畢後，檢查是否輪到 AI 行動
        // 注意：某些 PlayerActionHandler 函數內部可能已經改變了遊戲狀態，
        // 並直接或間接調用了 AIHandler.processAITurnIfNeeded
        // 此處的調用作為一個兜底，確保 AI 總是被考慮。
        AIHandler.processAITurnIfNeeded(this);
    } else { 
        // 如果人類玩家的動作無效，且該玩家仍在等待行動，則重新為其啟動計時器
        if (player.id === this.gameState.currentPlayerIndex &&
            (this.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
             this.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
             this.gameState.gamePhase === GamePhase.AWAITING_DISCARD)) {
           TimerManager.startActionTimerForPlayer(this, player.id); 
           this.broadcastGameState();
        } else if (player.id === this.gameState.playerMakingClaimDecision &&
                   (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION ||
                    this.gameState.gamePhase === GamePhase.ACTION_PENDING_CHI_CHOICE)) {
           TimerManager.startActionTimerForPlayer(this, player.id); 
           this.broadcastGameState();
        }
    }
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
        const player = this.players.find(p => p.socketId === socketId); 
        if (!player || !messageText.trim()) return; 

        const chatMessage: ChatMessage = {
            id: `game-chat-${this.roomId}-${Date.now()}`, 
            senderName: player.name, 
            senderId: player.socketId || player.id.toString(), 
            text: messageText.substring(0, 150), 
            timestamp: Date.now(), 
            type: 'player' 
        };
        this.io.to(this.roomId).emit('gameChatMessage', chatMessage); 
        this.addLog(`[聊天] ${player.name} (座位: ${player.id}): ${messageText}`); 
    }


    /**
     * @description 向房間內所有客戶端廣播一個動作宣告的視覺特效。
     * @param {string} text - 宣告的文字 (例如："碰", "胡", 或牌面)。
     * @param {number} playerId - 執行動作的玩家ID (座位索引)。
     * @param {boolean} [isMultiHuTarget=false] - 是否為一炮多響的目標之一。
     */
    public broadcastActionAnnouncement(text: string, playerId: number, isMultiHuTarget = false): void {
        this.io.to(this.roomId).emit('actionAnnouncement', {
            text,
            playerId, 
            position: 'bottom', 
            id: Date.now() + Math.random(), 
            isMultiHuTarget: isMultiHuTarget, 
        });
    }

    /**
     * @description 請求關閉房間 (通常在遊戲結束且無人再戰時調用)。
     */
    public requestClosure(): void {
        this.onRoomEmptyCallback();
    }

    /**
     * @description 銷毀遊戲房間，清除所有計時器。
     */
    public destroy(): void {
        TimerManager.clearActionTimer(this);
        TimerManager.clearNextRoundTimer(this);
        TimerManager.clearRematchTimer(this);
        TimerManager.clearRoundTimeoutTimer(this); // 清除全局單局超時計時器
        AIHandler.clearAiActionTimeout(this); // 清除 AI 專用的延遲計時器
        if (this.emptyRoomTimerId) {
            clearTimeout(this.emptyRoomTimerId);
            this.emptyRoomTimerId = null;
        }
        this.io.to(this.roomId).emit('gameError', '房間已被解散。');
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
        console.info(`[GameRoom ${this.roomId}] 已銷毀。`); 
    }
}
