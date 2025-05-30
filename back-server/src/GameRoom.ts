
// 引入 Socket.IO 相關類型
import { Server, Socket } from 'socket.io';
// 引入遊戲相關類型定義
import {
    GameState, Player, Tile, Meld, RoomSettings, GamePhase, TileKind, Claim, GameActionPayload, MeldDesignation, ChatMessage,
    ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData, AIExecutableAction, Suit, RematchVote, SubmittedClaim,
    VoiceChatUser // 新增 VoiceChatUser
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
import * as TimerManager from './gameRoomModules/timerManager';


/**
 * @class GameRoom
 * @description 管理單個遊戲房間的邏輯，包括遊戲狀態、玩家互動、AI行為等。
 */
export class GameRoom {
  public io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  public roomId: string;
  public roomSettings: RoomSettings;
  public gameState: GameState;
  public players: ServerPlayer[] = [];
  public aiService: AIService;
  private onRoomEmptyCallback: () => void;

  public emptyRoomTimerId: NodeJS.Timeout | null = null;
  public actionTimerId: NodeJS.Timeout | null = null;
  public nextRoundTimerId: NodeJS.Timeout | null = null;
  public rematchTimerId: NodeJS.Timeout | null = null;
  public aiActionTimeoutId: NodeJS.Timeout | null = null;
  public roundTimeoutTimerId: NodeJS.Timeout | null = null;

  public actionSubmitLock: Set<number> = new Set();

  // 新增：語音聊天參與者列表
  private voiceParticipants: Map<string, VoiceChatUser> = new Map();


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
    this.roomSettings = { // 確保 voiceEnabled 被正確初始化
        ...settings,
        numberOfRounds: settings.numberOfRounds || DEFAULT_NUMBER_OF_ROUNDS,
        voiceEnabled: settings.voiceEnabled === undefined ? true : settings.voiceEnabled,
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
      voiceEnabled: this.roomSettings.voiceEnabled, // 新增：從 roomSettings 初始化
      rematchVotes: [],
      rematchCountdown: null,
      submittedClaims: [],
      globalClaimTimerActive: false,
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
                const aiPlayer = new ServerPlayer(i, aiName, false, undefined, false);
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


  public sortPlayersById(): void {
    this.players.sort((a, b) => a.id - b.id);
  }

  public updateGameStatePlayers(): void {
    this.sortPlayersById();
    this.gameState.players = this.players.map(serverPlayerInstance => {
        const voiceInfo = this.voiceParticipants.get(serverPlayerInstance.socketId || '');
        return {
            id: serverPlayerInstance.id,
            name: serverPlayerInstance.name,
            isHuman: serverPlayerInstance.isHuman,
            hand: [...serverPlayerInstance.hand],
            melds: serverPlayerInstance.melds.map(meld => ({...meld, tiles: [...meld.tiles]})),
            isDealer: serverPlayerInstance.isDealer,
            score: serverPlayerInstance.score,
            isOnline: serverPlayerInstance.isOnline,
            socketId: serverPlayerInstance.socketId === null ? undefined : serverPlayerInstance.socketId,
            pendingClaims: serverPlayerInstance.pendingClaims ? [...serverPlayerInstance.pendingClaims] : [],
            isHost: serverPlayerInstance.isHost,
            hasRespondedToClaim: serverPlayerInstance.hasRespondedToClaim,
            isSpeaking: voiceInfo?.isSpeaking || false, // 從 voiceParticipants 獲取
            isMuted: voiceInfo?.isMuted || false,     // 從 voiceParticipants 獲取
        };
    });
  }


  public getSettings(): RoomSettings {
    return this.roomSettings;
  }

  public getGameState(): GameState {
    this.updateGameStatePlayers();
    const currentFullGameState = {
        ...JSON.parse(JSON.stringify(this.gameState)),
        roomName: this.roomSettings.roomName,
        configuredHumanPlayers: this.roomSettings.humanPlayers,
        configuredFillWithAI: this.roomSettings.fillWithAI,
        hostPlayerName: this.roomSettings.hostName,
        numberOfRounds: this.roomSettings.numberOfRounds,
        voiceEnabled: this.roomSettings.voiceEnabled, // 確保 voiceEnabled 在 gameState 中
    };
    return currentFullGameState;
  }

  public getPlayers(): ReadonlyArray<ServerPlayer> {
    return this.players;
  }

  public isFull(): boolean {
    return this.players.filter(p => p.isHuman && p.isOnline).length >= this.roomSettings.humanPlayers;
  }

  public isEmpty(): boolean {
    return this.players.filter(p => p.isHuman && p.isOnline).length === 0;
  }

  public hasPlayer(socketId: string): boolean {
    return this.players.some(p => p.socketId === socketId);
  }

  public addLog(message: string): void {
    const timedMessage = `${new Date().toLocaleTimeString('zh-TW', { hour12: false})} - ${message}`;
    this.gameState.messageLog.unshift(timedMessage);
    if (this.gameState.messageLog.length > MAX_MESSAGE_LOG_ENTRIES) {
      this.gameState.messageLog.pop();
    }
  }

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

public addPlayer(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, playerName: string, isHost: boolean): boolean {
    console.info(`[GameRoom ${this.roomId}] addPlayer: 嘗試加入玩家 ${playerName} (房主: ${isHost})。目前房間内玩家數: ${this.players.length}`);

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

        // 重連時也加入語音聊天 (如果房間允許)
        if (this.roomSettings.voiceEnabled) {
            this.handleVoiceChatJoin(socket);
        }
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
        offlineHumanPlayerByName.isHost = isHost; // 房主狀態也可能需要更新
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
    socket.data.playerId = finalPlayerObject.id; // 確保 socket.data.playerId 被設定
    socket.data.isMutedInVoiceChat = false; // 初始化語音靜音狀態
    socket.join(this.roomId);

    if (this.gameState.gamePhase === GamePhase.LOADING || this.gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS) {
        this.gameState.gamePhase = GamePhase.WAITING_FOR_PLAYERS;
    }

    this.io.to(socket.id).emit('joinedRoom', { gameState: this.getGameState(), roomId: this.roomId, clientPlayerId: finalPlayerObject.id });
    this.addLog(`${playerName} (座位: ${finalPlayerObject.id}) 已加入房間。`);
    this.broadcastGameState();
    this.resetEmptyRoomTimer();

    // 新玩家加入房間後，處理語音聊天加入 (如果房間允許)
    if (this.roomSettings.voiceEnabled) {
        this.handleVoiceChatJoin(socket);
    }

    console.info(`[GameRoom ${this.roomId}] 玩家 ${playerName} (ID: ${finalPlayerObject.id}) 加入流程完成。房間内物件總數: ${this.players.length}。在線真人數: ${this.players.filter(p=>p.isHuman && p.isOnline).length}。`);
    return true;
  }

  public removePlayer(socketId: string, isGracefulQuit: boolean = false): void {
    const playerIndexInArray = this.players.findIndex(p => p.socketId === socketId);


    const removedPlayer = playerIndexInArray !== -1 ? this.players[playerIndexInArray] : null;
    console.info(`[GameRoom ${this.roomId}] 玩家 ${removedPlayer?.name || '未知'} (Socket: ${socketId}) 正在被移除。主動退出: ${isGracefulQuit}。遊戲階段: ${this.gameState.gamePhase}`);

    // 處理語音聊天離開 (如果房間允許語音)
    if (this.roomSettings.voiceEnabled) {
        this.handleVoiceChatLeave(socketId); 
    }

    if (!removedPlayer) {
        console.warn(`[GameRoom ${this.roomId}] 嘗試移除玩家 (Socket: ${socketId})，但未在核心玩家列表中找到。`);
        return;
    }


    const wasPlayingMidGame = ![
        GamePhase.WAITING_FOR_PLAYERS,
        GamePhase.GAME_OVER,
        GamePhase.ROUND_OVER,
        GamePhase.AWAITING_REMATCH_VOTES,
        GamePhase.LOADING
    ].includes(this.gameState.gamePhase);

    const logMessage = isGracefulQuit ? `${removedPlayer.name} 已離開房間。` : `${removedPlayer.name} 已斷線。`;

    if (wasPlayingMidGame && removedPlayer.isHuman) {
        removedPlayer.isOnline = false;
        this.addLog(logMessage);
        this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, message: logMessage });

        const isCurrentTurnPlayer = this.gameState.currentPlayerIndex === removedPlayer.id &&
                                    (this.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
                                     this.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
                                     this.gameState.gamePhase === GamePhase.AWAITING_DISCARD);

        const isCurrentClaimDecisionPlayer = (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && this.gameState.playerMakingClaimDecision === removedPlayer.id) ||
                                             (this.gameState.gamePhase === GamePhase.AWAITING_ALL_CLAIMS_RESPONSE &&
                                              removedPlayer.pendingClaims && removedPlayer.pendingClaims.length > 0 && !removedPlayer.hasRespondedToClaim);


        if (isCurrentTurnPlayer || isCurrentClaimDecisionPlayer) {
            TimerManager.clearActionTimer(this);
            this.addLog(`${removedPlayer.name} 的回合/宣告，因${isGracefulQuit ? '退出' : '斷線'}而自動處理。`);
            AIHandler.processAITurnIfNeeded(this);
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
            this.addLog("由於有玩家離開，且剩餘所有在線真人玩家已同意再戰，提前開始新比賽。");
            MatchHandler.handleRematchVoteTimeout(this, true);
        }

    } else if (this.gameState.gamePhase === GamePhase.ROUND_OVER && removedPlayer.isHuman) {
        this.addLog(`${removedPlayer.name} 在局間休息時離開。`);
        this.players.splice(playerIndexInArray, 1);
        this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, message: `${removedPlayer.name} 已離開房間。` });

        const onlineHumans = this.players.filter(p => p.isHuman && p.isOnline);
         if (onlineHumans.length > 0 && this.gameState.humanPlayersReadyForNextRound) {
             this.gameState.humanPlayersReadyForNextRound = this.gameState.humanPlayersReadyForNextRound.filter(id => id !== removedPlayer.id);
             if (onlineHumans.every(p => this.gameState.humanPlayersReadyForNextRound.includes(p.id))) {
                this.addLog("由於有玩家離開，且剩餘所有在線真人玩家已確認，提前開始下一局。");
                TimerManager.clearNextRoundTimer(this);
                RoundHandler.startGameRound(this, false);
            }
         }

    } else { // 遊戲未開始，或 AI 離開 (理論上 AI 不會主動離開)
        this.addLog(logMessage);
        this.players.splice(playerIndexInArray, 1);
        this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, message: logMessage });
    }

    if (removedPlayer.isHost) {
        const newHost = this.players.find(p => p.isHuman && p.isOnline);
        if (newHost) {
            newHost.isHost = true;
            this.roomSettings.hostName = newHost.name;
            this.roomSettings.hostSocketId = newHost.socketId;
            this.gameState.hostPlayerName = newHost.name;
            this.players.forEach(p => p.isHost = (p.id === newHost.id));
            this.addLog(`房主 ${removedPlayer.name} 已離開，由 ${newHost.name} 繼任為新房主。`);
            this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, newHostId: newHost.id, message: `房主 ${removedPlayer.name} 已離開，由 ${newHost.name} 繼任。` });
        } else {
             this.addLog(`房主 ${removedPlayer.name} 已離開，且無其他真人玩家可繼任。`);
        }
    }

    this.updateGameStatePlayers();
    this.broadcastGameState();
    this.resetEmptyRoomTimer(this.gameState.gamePhase === GamePhase.GAME_OVER && this.gameState.matchOver);

    // 如果所有真人玩家都離開了，則請求關閉房間
    if (this.isEmpty() && this.gameState.gamePhase !== GamePhase.LOADING) {
        console.info(`[GameRoom ${this.roomId}] 所有真人玩家均已離開，請求關閉房間。`);
        if (this.emptyRoomTimerId) { clearTimeout(this.emptyRoomTimerId); this.emptyRoomTimerId = null; }
        this.onRoomEmptyCallback(); // 立即關閉
    }
  }


  public requestStartGame(socketId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || !player.isHost) {
      this.io.to(socketId).emit('gameError', '只有房主才能開始遊戲。');
      return;
    }
    if (this.gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS) {
      this.io.to(socketId).emit('gameError', '遊戲已經開始或狀態不正確。');
      return;
    }

    const humanPlayersCount = this.players.filter(p => p.isHuman && p.isOnline).length;
    if (humanPlayersCount < this.roomSettings.humanPlayers) {
        this.io.to(socketId).emit('gameError', `真人玩家數量 (${humanPlayersCount}) 未達到房間設定的目標 (${this.roomSettings.humanPlayers})。`);
        return;
    }
    
    if (this.roomSettings.fillWithAI && this.players.length < NUM_PLAYERS) {
        this.initializeAIPlayers();
    }
    if (this.players.length < NUM_PLAYERS) {
         this.io.to(socketId).emit('gameError', `總玩家數量 (${this.players.length}) 不足 ${NUM_PLAYERS}。`);
        return;
    }

    this.addLog(`${player.name} (房主) 開始了遊戲。`);
    console.info(`[GameRoom ${this.roomId}] 房主 ${player.name} 開始遊戲。`);
    RoundHandler.startGameRound(this, true); // isNewMatch = true
  }

  public sendChatMessage(socketId: string, messageText: string): void {
    if (!messageText.trim()) return;
    const player = this.players.find(p => p.socketId === socketId);
    if (!player) return;

    const chatMessage: ChatMessage = {
      id: `game-${this.roomId}-${Date.now()}`,
      senderName: player.name,
      senderId: socketId,
      text: messageText.substring(0, 100),
      timestamp: Date.now(),
      type: 'player'
    };
    this.io.to(this.roomId).emit('gameChatMessage', chatMessage);
    this.addLog(`[聊天] ${player.name}: ${messageText}`);
    this.broadcastGameState();
  }

  public broadcastGameState(): void {
    this.updateGameStatePlayers();
    this.io.to(this.roomId).emit('gameStateUpdate', this.getGameState());
    // console.debug(`[GameRoom ${this.roomId}] 已廣播遊戲狀態至房間。階段: ${this.gameState.gamePhase}`);
  }

  public broadcastActionAnnouncement(text: string, playerId: number, isMultiHuTarget = false): void {
    this.io.to(this.roomId).emit('actionAnnouncement', {
      text: text,
      playerId: playerId,
      position: 'bottom', // 此 position 僅為預留，客戶端會根據 clientPlayerId 重新計算
      id: Date.now() + Math.random(),
      isMultiHuTarget
    });
  }

  public handlePlayerAction(socketId: string, action: GameActionPayload): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player) {
        console.warn(`[GameRoom ${this.roomId}] 來自 socket ${socketId} 的動作，但找不到對應玩家。動作: ${action.type}`);
        return;
    }
    // 防止短時間內重複提交相同動作
    if (this.actionSubmitLock.has(player.id)) {
        console.warn(`[GameRoom ${this.roomId}] 玩家 ${player.name} (ID: ${player.id}) 嘗試過快提交動作 ${action.type}，已忽略。`);
        this.io.to(socketId).emit('gameError', '您的操作太快了，請稍候。');
        return;
    }
    this.actionSubmitLock.add(player.id);
    setTimeout(() => this.actionSubmitLock.delete(player.id), 500); // 0.5秒後解鎖

    console.info(`[GameRoom ${this.roomId}] 收到玩家 ${player.name} (ID: ${player.id}) 的動作: ${action.type}`, JSON.stringify(action).substring(0,100));

    let actionProcessed = false;
    try {
        switch (action.type) {
            case 'START_GAME_DEAL': // 通常由房主觸發
                this.requestStartGame(socketId);
                actionProcessed = true; // requestStartGame 內部會處理廣播和AI
                break;
            case 'DRAW_TILE':
                actionProcessed = PlayerActionHandler.processDrawTile(this, player.id);
                break;
            case 'DISCARD_TILE':
                actionProcessed = PlayerActionHandler.processDiscardTile(this, player.id, action.tileId);
                break;
            case 'DECLARE_HU':
                actionProcessed = PlayerActionHandler.processDeclareHu(this, player.id);
                break;
            case 'CLAIM_PENG': // 舊版宣告，可能會被 SUBMIT_CLAIM_DECISION 取代
                actionProcessed = PlayerActionHandler.processClaimPeng(this, player.id, action.tile);
                break;
            case 'CLAIM_GANG': // 舊版宣告
                actionProcessed = PlayerActionHandler.processClaimGang(this, player.id, action.tile);
                break;
            case 'CLAIM_CHI': // 舊版宣告
                actionProcessed = PlayerActionHandler.processClaimChi(this, player.id, action.tilesToChiWith, action.discardedTile);
                break;
            case 'DECLARE_AN_GANG':
                actionProcessed = PlayerActionHandler.processDeclareAnGang(this, player.id, action.tileKind);
                break;
            case 'DECLARE_MING_GANG_FROM_HAND':
                actionProcessed = PlayerActionHandler.processDeclareMingGangFromHand(this, player.id, action.tileKind);
                break;
            case 'PASS_CLAIM': // 舊版宣告
                actionProcessed = PlayerActionHandler.processPassClaim(this, player.id);
                break;
            case 'SUBMIT_CLAIM_DECISION': // 新的宣告提交流程
                actionProcessed = PlayerActionHandler.processSubmitClaimDecision(this, action.decision);
                break;
            case 'PLAYER_CONFIRM_NEXT_ROUND':
                actionProcessed = RoundHandler.processPlayerConfirmNextRound(this, player.id);
                break;
            case 'PLAYER_VOTE_REMATCH':
                 actionProcessed = MatchHandler.processPlayerVoteRematch(this, player.id, action.vote);
                break;
            default:
                console.warn(`[GameRoom ${this.roomId}] 未處理的玩家動作類型: ${(action as any).type}`);
                this.io.to(socketId).emit('gameError', `未知的動作類型: ${(action as any).type}`);
        }

        if (actionProcessed) {
             // AIHandler.processAITurnIfNeeded(this); // 移到各處理函數内部更精確地調用
        } else if (action.type !== 'START_GAME_DEAL'){ // START_GAME_DEAL 內部已發送錯誤
            console.warn(`[GameRoom ${this.roomId}] 玩家 ${player.name} 的動作 ${action.type} 處理失敗或無效。`);
            // 可能需要通知客戶端動作失敗
        }

    } catch (error) {
        console.error(`[GameRoom ${this.roomId}] 處理玩家 ${player.name} 的動作 ${action.type} 時發生錯誤:`, error);
        this.io.to(socketId).emit('gameError', '處理您的動作時發生內部錯誤。');
    }
  }

  // --- 語音聊天處理 ---
  public handleVoiceChatJoin(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>): void {
    if (!this.roomSettings.voiceEnabled) {
        console.info(`[VoiceChat ${this.roomId}] 房間已禁用遊戲語音，${socket.data.playerName} (Socket: ${socket.id}) 的加入請求被忽略。`);
        return;
    }

    const player = this.players.find(p => p.socketId === socket.id);
    if (!player) {
      console.warn(`[VoiceChat ${this.roomId}] Socket ${socket.id} 請求加入語音但未找到對應玩家。`);
      return;
    }

    const existingParticipant = this.voiceParticipants.get(socket.id);
    if (existingParticipant) {
        console.log(`[VoiceChat ${this.roomId}] ${player.name} 已在語音聊天中。`);
        // 仍然發送 user list 給他，以防他重連需要重新建立 peer connections
        socket.emit('voiceChatUserList', { users: Array.from(this.voiceParticipants.values()) });
        return;
    }

    const newParticipant: VoiceChatUser = {
      socketId: socket.id,
      playerId: player.id,
      playerName: player.name,
      isMuted: socket.data.isMutedInVoiceChat || false, // 從 socket.data 初始化靜音狀態
    };
    this.voiceParticipants.set(socket.id, newParticipant);
    player.isMuted = newParticipant.isMuted; // 同步到 ServerPlayer 物件

    console.log(`[VoiceChat ${this.roomId}] ${player.name} (Socket: ${socket.id}) 加入語音聊天。目前參與者: ${this.voiceParticipants.size} 人。`);

    // 發送當前房間內所有語音參與者列表給新加入者
    socket.emit('voiceChatUserList', { users: Array.from(this.voiceParticipants.values()) });

    // 通知房間內其他語音參與者有新成員加入
    socket.to(this.roomId).emit('voiceChatUserJoined', newParticipant);
    this.updateGameStatePlayers(); // 更新 GameState 中的 isMuted
    this.broadcastGameState(); // 廣播狀態
  }

  public handleVoiceChatLeave(socketId: string): void {
    const participant = this.voiceParticipants.get(socketId);
    if (participant) {
      this.voiceParticipants.delete(socketId);
      const player = this.players.find(p => p.socketId === socketId);
      if (player) {
          player.isMuted = undefined; // 清除 ServerPlayer 的 isMuted
          player.isSpeaking = undefined; // 清除 ServerPlayer 的 isSpeaking
      }

      console.log(`[VoiceChat ${this.roomId}] ${participant.playerName} (Socket: ${socketId}) 離開語音聊天。剩餘參與者: ${this.voiceParticipants.size} 人。`);
      // 通知房間內其他語音參與者此成員已離開
      this.io.to(this.roomId).emit('voiceChatUserLeft', { socketId });
      this.updateGameStatePlayers();
      this.broadcastGameState();
    }
  }

  public handleVoiceChatSignal(fromSocketId: string, data: { toSocketId: string; signal: any }): void {
    if (!this.roomSettings.voiceEnabled) return;
    const recipientSocket = this.io.sockets.sockets.get(data.toSocketId);
    if (recipientSocket) {
      console.debug(`[VoiceChat ${this.roomId}] 轉發從 ${fromSocketId} 到 ${data.toSocketId} 的 WebRTC 信令。`);
      recipientSocket.emit('voiceSignal', { fromSocketId, signal: data.signal });
    } else {
      console.warn(`[VoiceChat ${this.roomId}] 嘗試轉發信令到 ${data.toSocketId}，但目標 Socket 未找到。`);
    }
  }

  public handleVoiceChatToggleMute(socketId: string, data: { muted: boolean }): void {
    if (!this.roomSettings.voiceEnabled) return;
    const participant = this.voiceParticipants.get(socketId);
    const playerSocket = this.io.sockets.sockets.get(socketId);

    if (participant && playerSocket) {
      participant.isMuted = data.muted;
      playerSocket.data.isMutedInVoiceChat = data.muted; // 更新 socket.data 中的狀態
      const player = this.players.find(p => p.socketId === socketId);
      if (player) {
          player.isMuted = data.muted; // 同步到 ServerPlayer
      }

      console.log(`[VoiceChat ${this.roomId}] ${participant.playerName} (Socket: ${socketId}) ${data.muted ? '已靜音' : '已取消靜音'}`);
      this.io.to(this.roomId).emit('voiceChatUserMuted', { socketId, muted: data.muted });
      this.updateGameStatePlayers();
      this.broadcastGameState();
    }
  }

  public handleVoiceChatSpeakingUpdate(socketId: string, data: { speaking: boolean }): void {
    if (!this.roomSettings.voiceEnabled) return;
    const participant = this.voiceParticipants.get(socketId);
    if (participant) {
        // 更新 participant 內部狀態 (如果需要)
        // participant.isSpeaking = data.speaking; // VoiceChatUser 類型中沒有 isSpeaking，依賴 Player
        const player = this.players.find(p => p.socketId === socketId);
        if (player) {
            player.isSpeaking = data.speaking;
        }

        // console.debug(`[VoiceChat ${this.roomId}] ${participant.playerName} (Socket: ${socketId}) 發言狀態: ${data.speaking}`);
        this.io.to(this.roomId).emit('voiceChatUserSpeaking', { socketId, speaking: data.speaking });
        this.updateGameStatePlayers(); // 更新 gameState.players
        this.broadcastGameState(); // 廣播包含 isSpeaking 的狀態
    }
  }


  public destroy(): void {
    console.info(`[GameRoom ${this.roomId}] 正在銷毀房間 ${this.roomSettings.roomName}...`);
    TimerManager.clearActionTimer(this);
    TimerManager.clearNextRoundTimer(this);
    TimerManager.clearRematchTimer(this);
    TimerManager.clearRoundTimeoutTimer(this);
    AIHandler.clearAiActionTimeout(this);
    if (this.emptyRoomTimerId) {
      clearTimeout(this.emptyRoomTimerId);
      this.emptyRoomTimerId = null;
    }
    // 可以在此處向房間內所有玩家發送一個房間解散的通知
    this.io.to(this.roomId).emit('gameError', '房間已被解散。');
    // 強制房間內所有 socket 離開
    const socketsInRoom = this.io.sockets.adapter.rooms.get(this.roomId);
    if (socketsInRoom) {
        socketsInRoom.forEach(socketId => {
            const s = this.io.sockets.sockets.get(socketId);
            if (s) {
                s.leave(this.roomId);
                // 可以選擇性地將他們移回大廳
                s.join(LOBBY_ROOM_NAME);
                console.info(`[GameRoom ${this.roomId}] Socket ${socketId} 因房間解散已移至大廳。`);
            }
        });
    }
    this.voiceParticipants.clear(); // 清理語音參與者
    console.info(`[GameRoom ${this.roomId}] 房間 ${this.roomSettings.roomName} 已銷毀。`);
  }

   public requestClosure(): void {
        this.onRoomEmptyCallback();
    }


  // 模組化處理函數的綁定
  public processDrawTile = (playerId: number) => PlayerActionHandler.processDrawTile(this, playerId);
  public processDiscardTile = (playerId: number, tileId: string) => PlayerActionHandler.processDiscardTile(this, playerId, tileId);
  public processDeclareHu = (playerId: number) => PlayerActionHandler.processDeclareHu(this, playerId);
  public processClaimPeng = (playerId: number, tile: Tile) => PlayerActionHandler.processClaimPeng(this, playerId, tile);
  public processClaimGang = (playerId: number, tile: Tile) => PlayerActionHandler.processClaimGang(this, playerId, tile);
  public processClaimChi = (playerId: number, tilesToChiWith: Tile[], discardedTile: Tile) => PlayerActionHandler.processClaimChi(this, playerId, tilesToChiWith, discardedTile);
  public processDeclareAnGang = (playerId: number, tileKind: TileKind) => PlayerActionHandler.processDeclareAnGang(this, playerId, tileKind);
  public processDeclareMingGangFromHand = (playerId: number, tileKind: TileKind) => PlayerActionHandler.processDeclareMingGangFromHand(this, playerId, tileKind);
  public processPassClaim = (playerId: number) => PlayerActionHandler.processPassClaim(this, playerId);
  public processSubmitClaimDecision = (decision: SubmittedClaim) => PlayerActionHandler.processSubmitClaimDecision(this, decision);


  public checkForClaims = (discardedTile: Tile, discarderId: number) => ClaimHandler.checkForClaims(this, discardedTile, discarderId);
  public resolveAllSubmittedClaims = () => ClaimHandler.resolveAllSubmittedClaims(this);
  public clearClaimsAndTimer = () => ClaimHandler.clearClaimsAndTimer(this);
  public handleInvalidClaim = (player: ServerPlayer, claimType: string) => ClaimHandler.handleInvalidClaim(this, player, claimType);

  public advanceToNextPlayerTurn = (afterDiscard: boolean) => TurnHandler.advanceToNextPlayerTurn(this, afterDiscard);

  public initializeOrResetGameForRound = (isNewMatch: boolean) => RoundHandler.initializeOrResetGameForRound(this, isNewMatch);
  public startGameRound = (isNewMatch: boolean) => RoundHandler.startGameRound(this, isNewMatch);
  public handleRoundEndFlow = () => RoundHandler.handleRoundEndFlow(this);
  public processPlayerConfirmNextRound = (playerId: number) => RoundHandler.processPlayerConfirmNextRound(this, playerId);

  public handleMatchEnd = () => MatchHandler.handleMatchEnd(this);
  public processPlayerVoteRematch = (playerId: number, vote: 'yes') => MatchHandler.processPlayerVoteRematch(this, playerId, vote);
  public handleRematchVoteTimeout = (isEarlyStart: boolean) => MatchHandler.handleRematchVoteTimeout(this, isEarlyStart);
}


/**
* @description 伺服器端的遊戲主循環或事件處理器。
* GameRoom 實例會在其內部處理大部分遊戲邏輯，
* RoomManager 會處理房間的創建、加入、玩家斷線等。
* 此處不需要額外的 "gameLoop" 函數。
* 遊戲的推進是事件驅動的 (玩家動作、計時器到期)。
*/
// export function gameLoop(room: GameRoom) {
//   // 遊戲主循環邏輯已分散到各個處理函數和計時器回調中
// }
