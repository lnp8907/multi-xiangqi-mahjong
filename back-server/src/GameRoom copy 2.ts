
import { Server, Socket } from 'socket.io';
import {
    GameState, Player, Tile, Meld, RoomSettings, GamePhase, TileKind, Claim, GameActionPayload, MeldDesignation, ChatMessage,
    ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData, AIExecutableAction, Suit
} from './types';
import {
    NUM_PLAYERS, INITIAL_HAND_SIZE_DEALER, INITIAL_HAND_SIZE_NON_DEALER, ACTION_PRIORITY,
    CLAIM_DECISION_TIMEOUT_SECONDS, PLAYER_TURN_ACTION_TIMEOUT_SECONDS,
    NEXT_ROUND_COUNTDOWN_SECONDS, SYSTEM_SENDER_NAME, AI_THINK_TIME_MS_MIN, AI_THINK_TIME_MS_MAX,
    MAX_HAND_SIZE_BEFORE_DISCARD, ACTION_TIMER_INTERVAL_MS, EMPTY_ROOM_TIMEOUT_MS, GAME_END_EMPTY_ROOM_TIMEOUT_MS,
    TILE_KIND_DETAILS
} from './constants';
import { createInitialDeck, shuffleDeck, dealTiles, sortHandVisually } from './utils/deckManager';
import {
    checkWinCondition, getChiOptions, canPeng, canMingGang,
    canDeclareAnGang, canDeclareMingGangFromHand, removeTilesFromHand, countTilesOfKind, findTileInHand
} from './utils/gameRules';
import { AIService } from './AIService';
import { ServerPlayer } from './Player';


export class GameRoom {
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  public roomId: string;
  private roomSettings: RoomSettings;
  private gameState: GameState;
  private players: ServerPlayer[] = []; // Internal list of player objects, source of truth for player data. MUST BE KEPT SORTED BY ID.
  private aiService: AIService;
  private onRoomEmptyCallback: () => void;
  private emptyRoomTimer: NodeJS.Timeout | null = null;
  private actionTimerInterval: NodeJS.Timeout | null = null;
  private nextRoundTimerInterval: NodeJS.Timeout | null = null;
  private aiActionTimeout: NodeJS.Timeout | null = null;
  private actionSubmitLock: Set<number> = new Set();


  constructor(
    roomId: string,
    settings: RoomSettings,
    io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    onRoomEmptyCallback: () => void
  ) {
    this.io = io;
    this.roomId = roomId;
    this.roomSettings = settings; // Store the initial settings
    this.aiService = new AIService();
    this.onRoomEmptyCallback = onRoomEmptyCallback;

    this.gameState = this.createInitialCleanGameState();
    this.resetEmptyRoomTimer();

    console.log(`[GameRoom ${this.roomId}] 創建成功，設定:`, JSON.stringify(this.roomSettings));
  }

  private createInitialCleanGameState(): GameState {
    return {
      roomId: this.roomId,
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
    };
  }

  private initializeOrResetGameForRound(isNewMatch: boolean): void {
    if (isNewMatch) {
        this.gameState.currentRound = 1;
        this.gameState.matchOver = false;
        this.players.forEach(p => p.score = 0);
        if (this.players.length > 0) {
            this.gameState.dealerIndex = Math.floor(Math.random() * this.players.length);
            this.players.forEach((p) => p.isDealer = (p.id === this.gameState.dealerIndex));
        } else {
            this.gameState.dealerIndex = 0; 
        }
        this.addLog(`新比賽開始！共 ${this.gameState.numberOfRounds} 局。`);
    } else {
        if (this.players.length > 0) {
            if (this.gameState.winnerId === null || (this.gameState.winnerId !== null && this.gameState.winnerId !== this.gameState.dealerIndex)) {
                this.gameState.dealerIndex = (this.gameState.dealerIndex + 1) % this.players.length;
            }
            this.players.forEach((p) => p.isDealer = (p.id === this.gameState.dealerIndex));
        }
        this.addLog(`準備開始第 ${this.gameState.currentRound}/${this.gameState.numberOfRounds} 局。`);
    }
    this.gameState.configuredHumanPlayers = this.roomSettings.humanPlayers;


    this.players.forEach((p) => { 
        p.hand = [];
        p.melds = [];
        console.log(`[GameRoom ${this.roomId}] Round Init: Player ${p.id} (${p.name}) - isHuman: ${p.isHuman}, isDealer: ${p.isDealer}`);
    });

    this.gameState.deck = shuffleDeck(createInitialDeck());
    this.gameState.discardPile = [];
    this.gameState.lastDiscardedTile = null;
    this.gameState.lastDrawnTile = null;
    this.gameState.turnNumber = 1;
    this.gameState.potentialClaims = [];
    this.gameState.winnerId = null;
    this.gameState.winningTileDiscarderId = null;
    this.gameState.winType = null;
    this.gameState.winningDiscardedTile = null;
    this.gameState.isDrawGame = false;
    this.gameState.chiOptions = null;
    this.gameState.playerMakingClaimDecision = null;
    this.clearActionTimer();
    this.clearNextRoundTimer();
    this.gameState.humanPlayersReadyForNextRound = [];

    this.sortPlayersById(); 
    this.updateGameStatePlayers(); 

    const { hands, remainingDeck } = dealTiles(
        this.gameState.deck,
        this.gameState.players, 
        this.gameState.dealerIndex, 
        INITIAL_HAND_SIZE_DEALER,
        INITIAL_HAND_SIZE_NON_DEALER
    );

    this.players.forEach((p) => {
        p.hand = sortHandVisually(hands[p.id]); 
    });
    this.gameState.deck = remainingDeck;
    this.updateGameStatePlayers(); 

    this.gameState.currentPlayerIndex = this.gameState.dealerIndex; 
    const dealerPlayer = this.players.find(p => p.id === this.gameState.dealerIndex); 
    
    if(!dealerPlayer) {
        console.error(`[GameRoom ${this.roomId}] CRITICAL: Dealer player (ID: ${this.gameState.dealerIndex}) not found in this.players after dealing.`);
        this.addLog("嚴重錯誤：找不到莊家，遊戲無法繼續。");
        this.gameState.isDrawGame = true;
        this.handleRoundEndFlow();
        this.broadcastGameState();
        return;
    }

    this.addLog(`莊家是 ${dealerPlayer.name} (${dealerPlayer.isHuman ? '真人' : 'AI'}, Seat: ${dealerPlayer.id})。`);

    if (dealerPlayer.hand.length === INITIAL_HAND_SIZE_DEALER && dealerPlayer.hand.length > 0) {
        this.gameState.lastDrawnTile = dealerPlayer.hand[dealerPlayer.hand.length - 1];
        this.gameState.gamePhase = GamePhase.AWAITING_DISCARD;
        this.addLog(`輪到莊家 ${dealerPlayer.name} (Seat: ${dealerPlayer.id}) 打牌。`);
    } else {
        this.gameState.gamePhase = GamePhase.PLAYER_TURN_START;
        this.addLog(`輪到 ${dealerPlayer.name} (Seat: ${dealerPlayer.id}) 摸牌。`);
    }

    this.broadcastGameState();
    this.startActionTimerForPlayer(this.gameState.currentPlayerIndex);
    this.processAITurnIfNeeded();
  }

  private initializeAIPlayers(): void {
    const currentHumanPlayersCount = this.players.filter(p => p.isHuman).length; // Count all humans, online or offline placeholders
    let desiredTotalPlayers = NUM_PLAYERS; 

    let aisNeeded = 0;
    if (this.roomSettings.fillWithAI) {
        aisNeeded = desiredTotalPlayers - currentHumanPlayersCount;
    }
    // If fillWithAI is false, aisNeeded remains 0, meaning no AIs will be added regardless of human player count.
    
    aisNeeded = Math.max(0, aisNeeded); // Ensure not negative

    let currentAICount = this.players.filter(p => !p.isHuman).length;
    let aisToAddCount = aisNeeded - currentAICount;

    console.log(`[GameRoom ${this.roomId}] InitAI (at game start): Humans=${currentHumanPlayersCount}, ConfigHumans=${this.roomSettings.humanPlayers}, FillWithAI=${this.roomSettings.fillWithAI}. CurrentAIInRoom=${currentAICount}. AIsTargetToFill=${aisNeeded}. AIsToAdd=${aisToAddCount}.`);

    if (aisToAddCount > 0) {
        let aiPlayerNameCounter = this.players.filter(p => !p.isHuman).length; 
        for (let i = 0; i < NUM_PLAYERS; i++) { 
            if (aisToAddCount <= 0) break;

            const seatIsOccupied = this.players.some(p => p.id === i);
            if (!seatIsOccupied) {
                const aiName = `電腦 ${String.fromCharCode(65 + aiPlayerNameCounter)}`;
                const aiPlayer = new ServerPlayer(i, aiName, false, null, false);
                this.players.push(aiPlayer);
                this.addLog(`${aiName} (AI, Seat ${i}) 已加入遊戲以填補空位。`);
                console.log(`[GameRoom ${this.roomId}] AI 玩家 ${aiName} (ID: ${i}) 加入。`);
                aisToAddCount--;
                aiPlayerNameCounter++;
            }
        }
    }

    this.sortPlayersById();
    this.updateGameStatePlayers(); 
    console.log(`[GameRoom ${this.roomId}] After InitAI (at game start), this.players: ${this.players.map(p=>`(ID:${p.id},N:${p.name},H:${p.isHuman})`).join('; ')}`);
  }


  private sortPlayersById(): void {
    this.players.sort((a, b) => a.id - b.id);
  }

  private updateGameStatePlayers(): void {
    this.sortPlayersById(); 
    this.gameState.players = this.players.map(p => ({
        id: p.id, 
        name: p.name,
        isHuman: p.isHuman,
        hand: (p.isHuman && p.isOnline) || (this.gameState.gamePhase === GamePhase.GAME_OVER || this.gameState.gamePhase === GamePhase.ROUND_OVER)
              ? [...p.hand]
              : Array(p.hand.length).fill({id:`hidden-${p.id}-${Math.random()}`, kind: TileKind.B_SOLDIER, suit: Suit.BLACK} as Tile), // Placeholder for hidden tiles
        melds: p.melds.map(m => ({...m, tiles: [...m.tiles]})),
        isDealer: p.isDealer,
        score: p.score,
        isOnline: p.isOnline,
        socketId: p.socketId, // Transmit socketId for debugging or advanced client logic if needed
        pendingClaims: p.pendingClaims ? [...p.pendingClaims] : [],
        isHost: p.isHost,
    }));
  }

  public getSettings(): RoomSettings {
    return this.roomSettings;
  }

  public getGameState(): GameState {
    this.updateGameStatePlayers(); // Ensure gameState.players is up-to-date
    const currentFullGameState = {
        ...JSON.parse(JSON.stringify(this.gameState)), // Deep clone
        configuredHumanPlayers: this.roomSettings.humanPlayers, 
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

  private addLog(message: string): void {
    const timedMessage = `${new Date().toLocaleTimeString('zh-TW', { hour12: false})} - ${message}`;
    this.gameState.messageLog.unshift(timedMessage);
    if (this.gameState.messageLog.length > 50) {
      this.gameState.messageLog.pop();
    }
  }

  private clearClaimsAndTimer(): void {
    this.players.forEach(p => p.pendingClaims = []);
    this.gameState.potentialClaims = [];
    this.gameState.playerMakingClaimDecision = null;
    this.clearActionTimer();
    this.gameState.chiOptions = null;
  }

  private resetEmptyRoomTimer(isGameEnded = false): void {
    if (this.emptyRoomTimer) {
      clearTimeout(this.emptyRoomTimer);
      this.emptyRoomTimer = null;
    }
    if (this.isEmpty()) { 
      const timeoutDuration = isGameEnded ? GAME_END_EMPTY_ROOM_TIMEOUT_MS : EMPTY_ROOM_TIMEOUT_MS;
      this.emptyRoomTimer = setTimeout(() => {
        if (this.isEmpty()) {
          console.log(`[GameRoom ${this.roomId}] 房間因長時間無真人玩家而關閉。`);
          this.onRoomEmptyCallback();
        }
      }, timeoutDuration);
    }
  }

public addPlayer(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, playerName: string, isHost: boolean): boolean {
    console.log(`[GameRoom ${this.roomId}] addPlayer: Attempting to add ${playerName} (host: ${isHost}). Current players: ${this.players.length}`);

    const existingPlayerBySocketId = this.players.find(p => p.socketId === socket.id);
    if (existingPlayerBySocketId) {
        existingPlayerBySocketId.isOnline = true;
        existingPlayerBySocketId.name = playerName; // Update name if changed
        socket.data.currentRoomId = this.roomId;
        socket.data.playerId = existingPlayerBySocketId.id; // Ensure socket data has correct seat ID
        socket.join(this.roomId);
        this.io.to(socket.id).emit('joinedRoom', { gameState: this.getGameState(), roomId: this.roomId, clientPlayerId: existingPlayerBySocketId.id });
        this.addLog(`${existingPlayerBySocketId.name} (Seat: ${existingPlayerBySocketId.id}) 已重新連接。`);
        console.log(`[GameRoom ${this.roomId}] Player ${playerName} (ID: ${existingPlayerBySocketId.id}) reconnected.`);
        this.broadcastGameState();
        this.resetEmptyRoomTimer();
        return true;
    }

    if (this.players.filter(p => p.isHuman && p.isOnline).length >= this.roomSettings.humanPlayers) {
        socket.emit('lobbyError', '房間的真人玩家名額已滿。');
        return false;
    }

    let assignedSeatIndex = -1;
    const offlineHumanPlayerByName = this.players.find(p => p.isHuman && !p.isOnline && p.name === playerName);

    if (offlineHumanPlayerByName) {
        assignedSeatIndex = offlineHumanPlayerByName.id;
        offlineHumanPlayerByName.socketId = socket.id;
        offlineHumanPlayerByName.isOnline = true;
        offlineHumanPlayerByName.isHost = isHost; // Update host status if original host reconnected
        this.addLog(`${offlineHumanPlayerByName.name} (Seat: ${assignedSeatIndex}) 的席位已恢復。`);
        console.log(`[GameRoom ${this.roomId}] Player ${playerName} (ID: ${assignedSeatIndex}) recovered offline seat.`);
    } else {
        // Find an empty seat (0 to NUM_PLAYERS-1)
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!this.players.some(p => p.id === i)) { // Check if seat 'i' is taken
                assignedSeatIndex = i;
                break;
            }
        }
    }

    if (assignedSeatIndex === -1) {
        socket.emit('lobbyError', '無法找到空位加入房間。'); // This can happen if all NUM_PLAYERS slots are taken by humans already.
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
        console.log(`[GameRoom ${this.roomId}] New player ${playerName} (ID: ${newPlayer.id}) added to seat ${assignedSeatIndex}.`);
    }
    
    const finalPlayerObject = this.players.find(p => p.id === assignedSeatIndex)!;
    socket.data.currentRoomId = this.roomId;
    socket.data.playerId = finalPlayerObject.id; 
    socket.join(this.roomId);

    // Do NOT initialize AI players here. They are added when game starts.
    if (this.gameState.gamePhase === GamePhase.LOADING || this.gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS) {
        this.gameState.gamePhase = GamePhase.WAITING_FOR_PLAYERS;
    }
    
    this.io.to(socket.id).emit('joinedRoom', { gameState: this.getGameState(), roomId: this.roomId, clientPlayerId: finalPlayerObject.id });
    this.addLog(`${playerName} (Seat: ${finalPlayerObject.id}) 已加入房間。`);
    this.broadcastGameState(); 
    this.resetEmptyRoomTimer();

    console.log(`[GameRoom ${this.roomId}] Player ${playerName} (ID: ${finalPlayerObject.id}) join process complete. Total players in room object: ${this.players.length}. Humans online: ${this.players.filter(p=>p.isHuman && p.isOnline).length}.`);
    return true;
  }


  public removePlayer(socketId: string): void {
    const playerIndexInArray = this.players.findIndex(p => p.socketId === socketId);
    if (playerIndexInArray === -1) {
        console.log(`[GameRoom ${this.roomId}] Attempt to remove player (Socket: ${socketId}), but not found.`);
        return;
    }

    const removedPlayer = this.players[playerIndexInArray];
    console.log(`[GameRoom ${this.roomId}] Player ${removedPlayer.name} (ID: ${removedPlayer.id}, Socket: ${socketId}) is being removed. Game phase: ${this.gameState.gamePhase}`);

    const wasPlaying = this.gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS &&
                       this.gameState.gamePhase !== GamePhase.GAME_OVER &&
                       this.gameState.gamePhase !== GamePhase.ROUND_OVER &&
                       this.gameState.gamePhase !== GamePhase.LOADING;

    if (wasPlaying && removedPlayer.isHuman) {
        removedPlayer.isOnline = false; 
        this.addLog(`${removedPlayer.name} 已斷線。`);
        this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, message: `${removedPlayer.name} 已斷線。` });

        if (this.gameState.currentPlayerIndex === removedPlayer.id || this.gameState.playerMakingClaimDecision === removedPlayer.id) {
            this.clearActionTimer();
            this.addLog(`${removedPlayer.name}'s turn, auto-handling due to disconnect.`);
            const timerType = this.gameState.actionTimerType || (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION ? 'claim' : 'turn');
            this.handlePlayerActionTimeout(removedPlayer.id, timerType, true); 
        }
        if (this.isEmpty()) { 
            this.addLog(`所有真人玩家均已離開，遊戲提前結束並解散房間。`);
            this.gameState.gamePhase = GamePhase.GAME_OVER; 
            this.gameState.matchOver = true;
            this.broadcastGameState(); 
            if (this.emptyRoomTimer) { clearTimeout(this.emptyRoomTimer); this.emptyRoomTimer = null; }
            this.onRoomEmptyCallback();
            return; 
        }

    } else { 
        this.players.splice(playerIndexInArray, 1); 
        this.addLog(`${removedPlayer.name} 已離開房間。`);
        this.io.to(this.roomId).emit('gamePlayerLeft', { playerId: removedPlayer.id, message: `${removedPlayer.name} 已離開房間。` });
    }
    
    if (removedPlayer.isHuman) {
        if (this.gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS) {
            // AIs are not pre-filled, so no need to call initializeAIPlayers here.
            if (this.isEmpty()) { 
                console.log(`[GameRoom ${this.roomId}] Room empty of humans in WAITING_FOR_PLAYERS after ${removedPlayer.name} left. Closing.`);
                if (this.emptyRoomTimer) { clearTimeout(this.emptyRoomTimer); this.emptyRoomTimer = null; }
                this.onRoomEmptyCallback();
                return; 
            }
        }
    }

    if (removedPlayer.isHost && this.players.some(p => p.isHuman && p.isOnline)) {
        this.assignNewHost();
    }
    
    this.sortPlayersById(); 
    this.updateGameStatePlayers(); 
    this.broadcastGameState();     

    this.resetEmptyRoomTimer(this.gameState.gamePhase === GamePhase.GAME_OVER || this.gameState.gamePhase === GamePhase.ROUND_OVER);
    
    const clientSocket = this.io.sockets.sockets.get(socketId);
    if(clientSocket) {
        clientSocket.leave(this.roomId);
        delete clientSocket.data.currentRoomId;
        delete clientSocket.data.playerId;
    }
  }

  private assignNewHost(): void {
    this.sortPlayersById(); 
    const newHost = this.players.find(p => p.isHuman && p.isOnline); 
    if (newHost) {
      this.players.forEach(p => p.isHost = (p.id === newHost.id));
      this.roomSettings.hostName = newHost.name;
      this.roomSettings.hostSocketId = newHost.socketId!;
      this.addLog(`${newHost.name} (Seat: ${newHost.id}) 已被指定為新的房主。`);
      console.log(`[GameRoom ${this.roomId}] New host: ${newHost.name} (Socket: ${newHost.socketId})`);
    } else {
      this.roomSettings.hostName = "無"; 
      this.roomSettings.hostSocketId = undefined;
      this.addLog(`沒有可用的真人玩家成為新房主。`);
      console.log(`[GameRoom ${this.roomId}] No human player available to be new host.`);
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

    const humanPlayersOnlineCount = this.players.filter(p => p.isHuman && p.isOnline).length;
    if (humanPlayersOnlineCount < this.roomSettings.humanPlayers) {
         this.io.to(socketId).emit('gameError', `至少需要 ${this.roomSettings.humanPlayers} 位真人玩家才能開始。目前 ${humanPlayersOnlineCount} 位。`);
        return;
    }

    // Initialize AI players now that host requests to start
    this.initializeAIPlayers(); 
    
    // After attempting to fill with AI, check if we have NUM_PLAYERS
    if (this.players.length < NUM_PLAYERS) {
        this.io.to(socketId).emit('gameError', `需要 ${NUM_PLAYERS} 位玩家才能開始遊戲 (AI填充後仍不足)。`);
        // If AI filling was intended but failed to reach NUM_PLAYERS, game cannot start as it's fixed for 4.
        // This could happen if `fillWithAI` was false and humanPlayers < NUM_PLAYERS.
        // Or if `initializeAIPlayers` had an issue (unlikely with current logic).
        return;
    }

    console.log(`[GameRoom ${this.roomId}] 房主 ${player.name} (Seat: ${player.id}) 開始遊戲。AI 已填充 (如果需要)。`);
    this.startGameRound(true);
  }

  private startGameRound(isNewMatch: boolean): void {
    if (!isNewMatch && this.gameState.currentRound >= this.gameState.numberOfRounds) {
        this.handleMatchEnd();
        return;
    }
    if (!isNewMatch) {
        this.gameState.currentRound++;
    }

    this.gameState.gamePhase = GamePhase.DEALING;
    this.initializeOrResetGameForRound(isNewMatch);
  }

  public handlePlayerAction(socketId: string, action: GameActionPayload): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || !player.isHuman) {
        console.warn(`[GameRoom ${this.roomId}] 收到來自非人類或未知 socket 的動作: ${socketId}`, action);
        this.io.to(socketId).emit('gameError', '無效的玩家身份。');
        return;
    }
    if (this.actionSubmitLock.has(player.id)) {
        this.io.to(socketId).emit('gameError', '操作太頻繁或正在處理您的上一個動作。');
        return;
    }
    this.actionSubmitLock.add(player.id);

    console.log(`[GameRoom ${this.roomId}] 玩家 ${player.name} (ID: ${player.id}, isHuman: ${player.isHuman}) 嘗試執行動作:`, action.type, JSON.stringify(action).substring(0, 100));

    if (this.aiActionTimeout) {
        clearTimeout(this.aiActionTimeout);
        this.aiActionTimeout = null;
    }

    if (player.id === this.gameState.currentPlayerIndex || player.id === this.gameState.playerMakingClaimDecision) {
        this.clearActionTimer();
    }

    let actionIsValid = true;

    try {
        switch (action.type) {
            case 'DRAW_TILE':
                actionIsValid = this.processDrawTile(player.id);
                break;
            case 'DISCARD_TILE':
                actionIsValid = this.processDiscardTile(player.id, action.tileId);
                break;
            case 'DECLARE_HU':
                actionIsValid = this.processDeclareHu(player.id);
                break;
            case 'CLAIM_PENG':
                actionIsValid = this.processClaimPeng(player.id, action.tile);
                break;
            case 'CLAIM_GANG':
                actionIsValid = this.processClaimGang(player.id, action.tile);
                break;
            case 'CLAIM_CHI':
                actionIsValid = this.processClaimChi(player.id, action.tilesToChiWith, action.discardedTile);
                break;
            case 'DECLARE_AN_GANG':
                actionIsValid = this.processDeclareAnGang(player.id, action.tileKind);
                break;
            case 'DECLARE_MING_GANG_FROM_HAND':
                actionIsValid = this.processDeclareMingGangFromHand(player.id, action.tileKind);
                break;
            case 'PASS_CLAIM':
                actionIsValid = this.processPassClaim(player.id);
                break;
            case 'PLAYER_CONFIRM_NEXT_ROUND':
                actionIsValid = this.processPlayerConfirmNextRound(player.id);
                break;
            case 'REQUEST_REMATCH':
                 if (!player.isHost) {
                    this.io.to(socketId).emit('gameError', '只有房主才能發起再戰。');
                    actionIsValid = false;
                 } else if (!this.gameState.matchOver) {
                    this.io.to(socketId).emit('gameError', '當前比賽尚未完全結束。');
                    actionIsValid = false;
                 } else {
                    this.addLog(`${player.name} 發起了再戰 (${this.roomSettings.numberOfRounds}局)！`);
                    this.startGameRound(true); 
                 }
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
        this.processAITurnIfNeeded();
    } else {
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

  private processDrawTile(playerId: number): boolean {
    const player = this.players.find(p => p.id === playerId);
    if (!player) { console.error(`[GameRoom ${this.roomId}] processDrawTile: Player ${playerId} not found.`); return false; }
    if (this.gameState.currentPlayerIndex !== playerId || this.gameState.gamePhase !== GamePhase.PLAYER_TURN_START) {
        if(player.socketId) this.io.to(player.socketId).emit('gameError', '還沒輪到你摸牌或遊戲階段不正確。');
        return false;
    }
    if (this.gameState.deck.length === 0) {
        this.addLog("牌堆已空！本局流局。");
        this.gameState.isDrawGame = true;
        this.handleRoundEndFlow();
        this.broadcastGameState();
        return true;
    }

    const drawnTile = this.gameState.deck.shift()!;
    this.gameState.lastDrawnTile = drawnTile;
    
    this.gameState.gamePhase = GamePhase.PLAYER_DRAWN;
    this.addLog(`${player.name} (Seat: ${player.id}) 摸了一張牌${player.isHuman && player.isOnline ? ` (${drawnTile.kind})` : ''}。`); 
    this.startActionTimerForPlayer(playerId); 
    if (!player.isHuman || !player.isOnline) this.broadcastGameState(); 
    return true;
  }

  private processDiscardTile(playerId: number, tileId: string): boolean {
    const player = this.players.find(p => p.id === playerId);
    if (!player) { console.error(`[GameRoom ${this.roomId}] processDiscardTile: Player ${playerId} not found.`); return false; }

    if (this.gameState.currentPlayerIndex !== playerId ||
        (this.gameState.gamePhase !== GamePhase.PLAYER_DRAWN && this.gameState.gamePhase !== GamePhase.AWAITING_DISCARD)) {
        if(player.socketId) this.io.to(player.socketId).emit('gameError', '還沒輪到你打牌或遊戲階段不正確。');
        return false;
    }

    let tileToDiscard: Tile | null = null;
    let handAfterDiscard = [...player.hand];

    if (this.gameState.lastDrawnTile && this.gameState.lastDrawnTile.id === tileId && this.gameState.gamePhase === GamePhase.PLAYER_DRAWN) {
        tileToDiscard = this.gameState.lastDrawnTile;
        this.gameState.lastDrawnTile = null; 
    } else { 
        const tileIndexInHand = player.hand.findIndex(t => t.id === tileId);
        if (tileIndexInHand === -1) {
            if(player.socketId) this.io.to(player.socketId).emit('gameError', `在您的手中找不到要打出的牌 (ID: ${tileId})。`);
            return false;
        }
        tileToDiscard = player.hand[tileIndexInHand];
        handAfterDiscard.splice(tileIndexInHand, 1);

        if (this.gameState.lastDrawnTile && this.gameState.gamePhase === GamePhase.PLAYER_DRAWN) { 
            handAfterDiscard.push(this.gameState.lastDrawnTile);
            this.gameState.lastDrawnTile = null; 
        } else if (this.gameState.gamePhase === GamePhase.AWAITING_DISCARD && this.gameState.lastDrawnTile) {
            this.gameState.lastDrawnTile = null;
        }
    }

    if (!tileToDiscard) {
        if(player.socketId) this.io.to(player.socketId).emit('gameError', '無法確定要打出的牌。');
        return false;
    }

    player.hand = sortHandVisually(handAfterDiscard);
    this.gameState.discardPile.unshift(tileToDiscard);
    this.gameState.lastDiscardedTile = tileToDiscard;
    this.gameState.lastDiscarderIndex = playerId;

    this.addLog(`${player.name} (Seat: ${player.id}) 打出了 ${tileToDiscard.kind}。`);
    this.broadcastActionAnnouncement(tileToDiscard.kind, playerId);
    this.updateGameStatePlayers(); 
    this.checkForClaims(tileToDiscard, playerId); 
    return true;
  }

private processDeclareHu(playerId: number): boolean {
    const player = this.players.find(p => p.id === playerId);
    if (!player) { console.error(`[GameRoom ${this.roomId}] processDeclareHu: Player ${playerId} not found.`); return false; }

    let handToCheck: Tile[];
    let isSelfDrawnHu = false;
    let winTile: Tile | null = null;
    let actionTextForAnnouncement: "天胡" | "自摸" | "胡" = "胡";
    let isMultiHuTarget = false;

    if (this.gameState.currentPlayerIndex === playerId &&
        (this.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
         (this.gameState.gamePhase === GamePhase.PLAYER_TURN_START && player.isDealer && this.gameState.turnNumber === 1) || 
         (this.gameState.gamePhase === GamePhase.AWAITING_DISCARD && player.isDealer && this.gameState.turnNumber === 1 && player.hand.length === INITIAL_HAND_SIZE_DEALER) 
        )) {
        isSelfDrawnHu = true;
        winTile = this.gameState.lastDrawnTile; 

        if ((this.gameState.gamePhase === GamePhase.PLAYER_TURN_START || this.gameState.gamePhase === GamePhase.AWAITING_DISCARD) && player.isDealer && this.gameState.turnNumber === 1) {
            handToCheck = [...player.hand]; 
            actionTextForAnnouncement = "天胡";
        } else { 
            if (!this.gameState.lastDrawnTile) {
                 if(player.socketId) this.io.to(player.socketId).emit('gameError', '錯誤：宣告自摸時找不到剛摸的牌。'); return false;
            }
            handToCheck = [...player.hand, this.gameState.lastDrawnTile!];
            actionTextForAnnouncement = "自摸";
        }
    } else if (this.gameState.lastDiscardedTile &&
               this.gameState.potentialClaims.some(c => c.playerId === playerId && c.action === 'Hu') &&
               (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION || this.gameState.gamePhase === GamePhase.AWAITING_CLAIMS_RESOLUTION)) {
        isSelfDrawnHu = false;
        winTile = this.gameState.lastDiscardedTile;
        handToCheck = [...player.hand, this.gameState.lastDiscardedTile]; 
        actionTextForAnnouncement = "胡";
        
        const huClaimsForThisTile = this.gameState.potentialClaims.filter(c => c.action === 'Hu' && this.gameState.lastDiscardedTile && c.tiles?.some(t => t.id === this.gameState.lastDiscardedTile!.id));
        if (huClaimsForThisTile.length > 1) {
            isMultiHuTarget = true;
        }

    } else {
        if(player.socketId) this.io.to(player.socketId).emit('gameError', '現在不是宣告胡牌的時機。');
        return false;
    }

    const winInfo = checkWinCondition(handToCheck, player.melds);
    if (winInfo.isWin) {
        this.gameState.winnerId = playerId;
        this.gameState.winType = isSelfDrawnHu ? 'selfDrawn' : 'discard';

        let huMessage = `${player.name} (Seat: ${player.id}) `;
        if (isSelfDrawnHu) {
            if (actionTextForAnnouncement === "天胡") huMessage += "天胡";
            else huMessage += `自摸 (摸到 ${winTile?.kind || '牌'})`;
            this.gameState.winningTileDiscarderId = null;
            this.gameState.winningDiscardedTile = null; 
            if (winTile && this.gameState.lastDrawnTile && winTile.id === this.gameState.lastDrawnTile.id) {
                this.gameState.lastDrawnTile = null; 
            }
        } else { 
            huMessage += `食胡 (ロン了 ${this.players.find(p=>p.id === this.gameState.lastDiscarderIndex)?.name || '上家'} 的 ${winTile!.kind})`;
            this.gameState.winningTileDiscarderId = this.gameState.lastDiscarderIndex;
            this.gameState.winningDiscardedTile = winTile; 
            if (this.gameState.lastDiscardedTile && this.gameState.lastDiscardedTile.id === winTile!.id) {
                this.consumeDiscardedTileForMeld(winTile!.id); 
            }
            player.hand.push(winTile!); 
            player.hand = sortHandVisually(player.hand);
        }
        huMessage += "了！";
        this.addLog(huMessage);
        this.broadcastActionAnnouncement(actionTextForAnnouncement, playerId, isMultiHuTarget);
        
        this.updateGameStatePlayers(); 
        this.handleRoundEndFlow(); 
    } else { 
        this.addLog(`${player.name} 宣告 ${actionTextForAnnouncement} 失敗 (詐胡)。`);
        if(player.socketId) this.io.to(player.socketId).emit('gameError', '不符合胡牌條件。');

        if (!isSelfDrawnHu && this.gameState.playerMakingClaimDecision === playerId) {
             this.processPassClaim(playerId); 
        } else if (isSelfDrawnHu) {
            if (actionTextForAnnouncement === "天胡") {
                this.gameState.gamePhase = GamePhase.AWAITING_DISCARD; 
            } else {
                this.gameState.gamePhase = GamePhase.PLAYER_DRAWN; 
            }
            this.startActionTimerForPlayer(playerId);
            this.broadcastGameState();
        }
        return false;
    }
    return true;
  }

  private processClaimPeng(playerId: number, tileToPeng: Tile): boolean {
    const player = this.players.find(p => p.id === playerId);
    if (!player || this.gameState.playerMakingClaimDecision !== playerId || this.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION || !this.gameState.lastDiscardedTile || this.gameState.lastDiscardedTile.kind !== tileToPeng.kind) {
        if(player?.socketId) this.io.to(player.socketId).emit('gameError', '無效的碰牌宣告。');
        return false;
    }

    const { handAfterAction, newMeldTiles } = removeTilesFromHand(player.hand, tileToPeng.kind, 2);
    if (!newMeldTiles || newMeldTiles.length !== 2) {
        this.addLog(`錯誤: ${player.name} 無法碰 ${tileToPeng.kind}，數量不足。`);
        this.handleInvalidClaim(player, 'Peng');
        return false;
    }
    player.hand = handAfterAction;
    const pengMeld: Meld = {
        id: `meld-${player.id}-${Date.now()}`,
        designation: MeldDesignation.KEZI,
        tiles: [...newMeldTiles, tileToPeng].sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue),
        isOpen: true,
        claimedFromPlayerId: this.gameState.lastDiscarderIndex!,
        claimedTileId: tileToPeng.id,
    };
    player.melds.push(pengMeld);
    this.addLog(`${player.name} (Seat: ${player.id}) 碰了 ${tileToPeng.kind}。請出牌。`);
    this.broadcastActionAnnouncement("碰", playerId);

    this.consumeDiscardedTileForMeld(tileToPeng.id);
    this.clearClaimsAndTimer(); 
    this.gameState.currentPlayerIndex = player.id;
    this.gameState.gamePhase = GamePhase.AWAITING_DISCARD;
    this.updateGameStatePlayers();
    this.startActionTimerForPlayer(player.id);
    this.broadcastGameState();
    return true;
  }

    private clearActionTimer(): void {
        if (this.actionTimerInterval) {
            clearInterval(this.actionTimerInterval);
            this.actionTimerInterval = null;
        }
        this.gameState.actionTimer = null;
        this.gameState.actionTimerType = null;
    }

    private clearNextRoundTimer(): void {
        if (this.nextRoundTimerInterval) {
            clearInterval(this.nextRoundTimerInterval);
            this.nextRoundTimerInterval = null;
        }
        this.gameState.nextRoundCountdown = null;
    }

    public broadcastGameState(): void {
        this.io.to(this.roomId).emit('gameStateUpdate', this.getGameState());
    }

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
        this.addLog(`[聊天] ${player.name} (Seat: ${player.id}): ${messageText}`);
    }


    private startActionTimerForPlayer(playerId: number): void {
        this.clearActionTimer();
        const player = this.players.find(p => p.id === playerId);
        if (!player) { console.error(`[GameRoom ${this.roomId}] startActionTimerForPlayer: Player ${playerId} not found.`); return; }

        if (!player.isHuman || !player.isOnline) {
             console.log(`[GameRoom ${this.roomId}] Not starting timer for AI/Offline player ${player.name} (Seat: ${playerId}).`);
            return; 
        }

        let timeoutDuration = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
        if (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION || this.gameState.gamePhase === GamePhase.ACTION_PENDING_CHI_CHOICE) {
            timeoutDuration = CLAIM_DECISION_TIMEOUT_SECONDS;
            this.gameState.actionTimerType = 'claim';
        } else if (this.gameState.gamePhase === GamePhase.PLAYER_TURN_START || this.gameState.gamePhase === GamePhase.PLAYER_DRAWN || this.gameState.gamePhase === GamePhase.AWAITING_DISCARD) {
            timeoutDuration = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
            this.gameState.actionTimerType = 'turn';
        } else {
            return; 
        }

        this.gameState.actionTimer = timeoutDuration;
        this.addLog(`${player.name} (Seat: ${player.id}) 的行動計時開始 (${timeoutDuration}s)。`);
        this.broadcastGameState();

        this.actionTimerInterval = setInterval(() => {
            if (this.gameState.actionTimer !== null && this.gameState.actionTimer > 0) {
                this.gameState.actionTimer--;
                this.broadcastGameState();
            }
            if (this.gameState.actionTimer === 0) {
                const currentDecisionMakerId = this.gameState.actionTimerType === 'claim' ? this.gameState.playerMakingClaimDecision : this.gameState.currentPlayerIndex;
                if (playerId === currentDecisionMakerId) {
                    this.handlePlayerActionTimeout(playerId, this.gameState.actionTimerType!, false); 
                } else {
                    this.addLog(`[GameRoom ${this.roomId}] Timer for player ${playerId} expired, but action control has moved. Clearing stale timer.`);
                    this.clearActionTimer();
                    this.broadcastGameState(); 
                }
            }
        }, ACTION_TIMER_INTERVAL_MS);
    }

    private processAITurnIfNeeded(): void {
        if (this.aiActionTimeout) {
            clearTimeout(this.aiActionTimeout);
            this.aiActionTimeout = null;
        }

        let aiPlayerToAct: ServerPlayer | undefined = undefined;

        if (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && this.gameState.playerMakingClaimDecision !== null) {
            const player = this.players.find(p => p.id === this.gameState.playerMakingClaimDecision);
            if (player && (!player.isHuman || !player.isOnline) ) aiPlayerToAct = player; // AI or an offline human player
        } else if (
            (this.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
             this.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
             this.gameState.gamePhase === GamePhase.AWAITING_DISCARD) &&
            this.gameState.currentPlayerIndex !== null
        ) {
            const player = this.players.find(p => p.id === this.gameState.currentPlayerIndex);
            if (player && (!player.isHuman || !player.isOnline) ) aiPlayerToAct = player; // AI or an offline human player
        }


        if (aiPlayerToAct) {
            const currentAIPlayer = aiPlayerToAct; 
            this.addLog(`輪到 ${currentAIPlayer.name} (${currentAIPlayer.isHuman ? '離線真人':'AI'}, Seat: ${currentAIPlayer.id}) 行動，遊戲階段: ${this.gameState.gamePhase}`);
            console.log(`[GameRoom ${this.roomId}] Scheduling AI/Offline action for ${currentAIPlayer.name} (Seat: ${currentAIPlayer.id}) in phase ${this.gameState.gamePhase}`);
            
            this.aiActionTimeout = setTimeout(() => {
                 let stillAIsTurn = false;
                 if (this.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && this.gameState.playerMakingClaimDecision === currentAIPlayer.id) {
                    stillAIsTurn = true;
                 } else if ((this.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
                             this.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
                             this.gameState.gamePhase === GamePhase.AWAITING_DISCARD) &&
                            this.gameState.currentPlayerIndex === currentAIPlayer.id) {
                    stillAIsTurn = true;
                 }

                if (this.aiActionTimeout && stillAIsTurn) { 
                    console.log(`[GameRoom ${this.roomId}] AI/Offline ${currentAIPlayer.name} (Seat: ${currentAIPlayer.id}) is now taking its action.`);
                    const action = this.aiService.getNextAIMove(currentAIPlayer, this.getGameState());
                    this.addLog(`${currentAIPlayer.name} (${currentAIPlayer.isHuman ? '離線真人':'AI'}) 執行動作: ${action.type}`);
                    this.handleAIAction(currentAIPlayer.id, action);
                } else {
                    console.log(`[GameRoom ${this.roomId}] AI/Offline ${currentAIPlayer.name} (Seat: ${currentAIPlayer.id}) action was preempted or no longer its turn. AI Timeout Cleared.`);
                }
            }, Math.random() * (AI_THINK_TIME_MS_MAX - AI_THINK_TIME_MS_MIN) + AI_THINK_TIME_MS_MIN);
        }
    }

    private handleAIAction(aiPlayerId: number, action: GameActionPayload): void {
        const aiPlayer = this.players.find(p => p.id === aiPlayerId);
        if (!aiPlayer) { console.error(`[GameRoom ${this.roomId}] handleAIAction: AI/Offline Player ${aiPlayerId} not found.`); return; }

        console.log(`[GameRoom ${this.roomId}] AI/Offline ${aiPlayer.name} (Seat: ${aiPlayer.id}) 執行動作: ${action.type}`, JSON.stringify(action).substring(0,100));
        let actionIsValid = true;

        try {
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
                    console.warn(`[GameRoom ${this.roomId}] AI/Offline 執行了未處理的動作類型:`, (action as any).type);
                    actionIsValid = false;
            }
        } catch (error) {
            console.error(`[GameRoom ${this.roomId}] AI/Offline 動作 ${action.type} 發生錯誤:`, error);
            actionIsValid = false;
        }

        if (actionIsValid) {
            this.processAITurnIfNeeded();
        } else {
            this.addLog(`AI/Offline ${aiPlayer.name} 嘗試的動作 ${action.type} 無效或失敗。`);
            console.error(`[GameRoom ${this.roomId}] AI/Offline ${aiPlayer.name} action ${action.type} was invalid. State: ${this.gameState.gamePhase}`);

            if (this.gameState.playerMakingClaimDecision === aiPlayerId && action.type !== 'PASS_CLAIM') {
                this.addLog(`AI/Offline ${aiPlayer.name} 的宣告動作無效，自動跳過。`);
                this.handleAIAction(aiPlayerId, { type: 'PASS_CLAIM' }); 
            } else if (this.gameState.currentPlayerIndex === aiPlayerId) {
                this.addLog(`AI/Offline ${aiPlayer.name} 的回合動作 ${action.type} 無效。`);
                this.processAITurnIfNeeded();
            } else {
                 this.addLog(`AI/Offline ${aiPlayer.name} 的動作 ${action.type} 無效，且非其決策回合。`);
                 this.processAITurnIfNeeded();
            }
        }
    }


    private handlePlayerActionTimeout(playerId: number, timerType: 'claim' | 'turn', isOffline: boolean): void {
        this.clearActionTimer(); 
        const player = this.players.find(p => p.id === playerId);
        if (!player) { console.error(`[GameRoom ${this.roomId}] handlePlayerActionTimeout: Player ${playerId} not found.`); return; }

        this.addLog(`${player.name} (Seat: ${player.id}) 的 ${timerType === 'claim' ? '宣告' : '回合'} 時間到，自動處理。${isOffline ? "(因離線)" : ""}`);
        
        const currentExpectedActorId = timerType === 'claim' ? this.gameState.playerMakingClaimDecision : this.gameState.currentPlayerIndex;
        if (playerId !== currentExpectedActorId) {
            this.addLog(`[GameRoom ${this.roomId}] 玩家 ${player.name} (Seat: ${playerId}) 超時，但行動權已轉移。不執行自動操作。`);
            this.processAITurnIfNeeded(); 
            return;
        }

        if (timerType === 'claim') {
            if (player.isHuman && player.isOnline) this.handlePlayerAction(player.socketId!, { type: 'PASS_CLAIM' });
            else this.handleAIAction(playerId, { type: 'PASS_CLAIM' }); 
        } else if (timerType === 'turn') {
            if (this.gameState.gamePhase === GamePhase.PLAYER_TURN_START) {
                if (player.isHuman && player.isOnline) this.handlePlayerAction(player.socketId!, { type: 'DRAW_TILE' });
                else this.handleAIAction(playerId, { type: 'DRAW_TILE' });
            } else if (this.gameState.gamePhase === GamePhase.PLAYER_DRAWN || this.gameState.gamePhase === GamePhase.AWAITING_DISCARD) {
                let tileToDiscard: Tile | null = null;
                let discardMethodMessage = "";
                
                if (this.gameState.lastDrawnTile && this.gameState.gamePhase === GamePhase.PLAYER_DRAWN) {
                    tileToDiscard = this.gameState.lastDrawnTile; 
                    discardMethodMessage = `打出剛摸到的牌 (${tileToDiscard.kind})`;
                } else if (player.hand.length > 0) {
                    tileToDiscard = player.hand[0]; 
                    discardMethodMessage = `打出手中的一張牌 (${tileToDiscard?.kind || '未知'})`;
                }

                if (tileToDiscard) {
                    this.addLog(`自動為 ${player.name} ${discardMethodMessage}。`);
                    if (player.isHuman && player.isOnline) this.handlePlayerAction(player.socketId!, { type: 'DISCARD_TILE', tileId: tileToDiscard.id });
                    else this.handleAIAction(playerId, { type: 'DISCARD_TILE', tileId: tileToDiscard.id }); 
                } else {
                    this.addLog(`錯誤: ${player.name} 在 ${this.gameState.gamePhase} 時超時，但無牌可打。流局處理。`);
                     this.gameState.isDrawGame = true;
                     this.handleRoundEndFlow();
                     this.broadcastGameState();
                }
            }
        }
        this.processAITurnIfNeeded(); 
    }

    private handleMatchEnd(): void {
        this.gameState.matchOver = true;
        this.gameState.gamePhase = GamePhase.GAME_OVER;
        this.addLog(`所有 ${this.gameState.numberOfRounds} 局已完成！比賽結束。`);
        this.clearActionTimer();
        this.clearNextRoundTimer();
        this.broadcastGameState();
        this.resetEmptyRoomTimer(true);
    }

    private handleRoundEndFlow(): void {
        this.clearActionTimer();
        if (this.gameState.currentRound < this.gameState.numberOfRounds) {
            this.addLog(`第 ${this.gameState.currentRound} 局結束。`);
            this.gameState.gamePhase = GamePhase.ROUND_OVER;
            this.gameState.nextRoundCountdown = NEXT_ROUND_COUNTDOWN_SECONDS;
            this.gameState.humanPlayersReadyForNextRound = [];
            this.broadcastGameState();

            this.nextRoundTimerInterval = setInterval(() => {
                if (this.gameState.nextRoundCountdown !== null && this.gameState.nextRoundCountdown > 0) {
                    this.gameState.nextRoundCountdown--;
                    this.broadcastGameState();
                }
                if (this.gameState.nextRoundCountdown === 0) {
                    this.clearNextRoundTimer();
                    this.addLog("倒數結束，自動開始下一局準備...");
                    this.startGameRound(false);
                }
            }, ACTION_TIMER_INTERVAL_MS);
        } else {
            this.handleMatchEnd();
        }
    }

    private broadcastActionAnnouncement(text: string, playerId: number, isMultiHuTarget: boolean = false): void {
        const announcementData: {
            text: string;
            playerId: number; 
            position: 'top' | 'bottom' | 'left' | 'right'; 
            id: number;
            isMultiHuTarget?: boolean;
        } = { text, playerId, position: 'bottom', id: Date.now(), isMultiHuTarget }; 
        this.io.to(this.roomId).emit('actionAnnouncement', announcementData);
    }

    private checkForClaims(discardedTile: Tile, discarderId: number): void {
        this.gameState.potentialClaims = [];
        this.players.forEach(p => p.pendingClaims = []);
        let hasAnyClaim = false;

        for (let i = 0; i < this.players.length; i++) {
            const player = this.players[i];
            if (player.id === discarderId) continue; 

            const playerClaims: Claim[] = [];
            const handForHuCheck = [...player.hand, discardedTile];
            if (checkWinCondition(handForHuCheck, player.melds).isWin) {
                playerClaims.push({ playerId: player.id, action: 'Hu', priority: ACTION_PRIORITY.HU, tiles: [discardedTile] });
            }
            if (canMingGang(player.hand, discardedTile)) {
                playerClaims.push({ playerId: player.id, action: 'Gang', priority: ACTION_PRIORITY.GANG, tiles: [discardedTile] });
            }
            if (canPeng(player.hand, discardedTile)) {
                playerClaims.push({ playerId: player.id, action: 'Peng', priority: ACTION_PRIORITY.PENG, tiles: [discardedTile] });
            }
            
            if (player.id === (discarderId + 1) % this.players.length) {
                const chiOptions = getChiOptions(player.hand, discardedTile);
                if (chiOptions.length > 0) {
                    if (player.isHuman && player.isOnline) this.gameState.chiOptions = chiOptions;
                    playerClaims.push({ playerId: player.id, action: 'Chi', priority: ACTION_PRIORITY.CHI, tiles: chiOptions[0] }); 
                }
            }

            if (playerClaims.length > 0) {
                hasAnyClaim = true;
                player.pendingClaims = playerClaims.sort((a, b) => b.priority - a.priority); 
                this.gameState.potentialClaims.push(...playerClaims);
            }
        }

        if (hasAnyClaim) {
            this.gameState.potentialClaims.sort((a, b) => b.priority - a.priority || a.playerId - b.playerId); 
            this.gameState.gamePhase = GamePhase.TILE_DISCARDED; 
            this.startClaimDecisionProcess();
        } else {
            this.advanceToNextPlayerTurn();
        }
        this.broadcastGameState(); 
    }

    private startClaimDecisionProcess(): void {
        this.clearActionTimer();
        if (this.gameState.potentialClaims.length === 0 || !this.gameState.lastDiscardedTile) {
            this.advanceToNextPlayerTurn();
            return;
        }

        const nextClaimToProcess = this.gameState.potentialClaims[0];
        const claimantId = nextClaimToProcess.playerId;
        const claimant = this.players.find(p => p.id === claimantId);

        if (claimant) {
            this.gameState.playerMakingClaimDecision = claimant.id;
            const claimsForThisPlayer = claimant.pendingClaims || []; 

            if (claimsForThisPlayer.length > 0) {
                this.gameState.gamePhase = GamePhase.AWAITING_PLAYER_CLAIM_ACTION;
                if (claimant.isHuman && claimant.isOnline) {
                    this.addLog(`${claimant.name} (Seat: ${claimant.id})，你可以宣告 ${claimsForThisPlayer.map(c => c.action).join('/')}。`);
                    if (claimsForThisPlayer.some(c => c.action === 'Chi')) {
                        this.gameState.chiOptions = getChiOptions(claimant.hand, this.gameState.lastDiscardedTile!);
                    } else {
                        this.gameState.chiOptions = null;
                    }
                    this.startActionTimerForPlayer(claimant.id);
                } else { 
                    this.addLog(`輪到 ${claimant.name} (Seat: ${claimant.id}, ${claimant.isHuman ? '離線真人':'AI'}) 決定是否宣告...`);
                    this.processAITurnIfNeeded(); 
                }
            } else { 
                this.gameState.potentialClaims = this.gameState.potentialClaims.filter(c => c.playerId !== claimant.id);
                this.startClaimDecisionProcess(); 
            }
        } else { 
            this.advanceToNextPlayerTurn();
        }
        this.broadcastGameState();
    }

    private advanceToNextPlayerTurn(): void {
        this.clearClaimsAndTimer();
        if (this.gameState.lastDiscarderIndex === null) {
            console.error(`[GameRoom ${this.roomId}] advanceToNextPlayerTurn: lastDiscarderIndex is null. This should not happen.`);
             this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + 1) % this.players.length; 
        } else {
            this.gameState.currentPlayerIndex = (this.gameState.lastDiscarderIndex + 1) % this.players.length;
        }
        
        this.gameState.gamePhase = GamePhase.PLAYER_TURN_START;
        this.gameState.turnNumber++;
        this.gameState.lastDiscardedTile = null;
        this.gameState.lastDrawnTile = null; 

        const nextPlayer = this.players.find(p => p.id === this.gameState.currentPlayerIndex);
        if (!nextPlayer) {
            console.error(`[GameRoom ${this.roomId}] advanceToNextPlayerTurn: Critical error, next player at index ${this.gameState.currentPlayerIndex} is undefined.`);
            this.gameState.isDrawGame = true;
            this.handleRoundEndFlow();
            this.broadcastGameState();
            return;
        }
        this.addLog(`所有宣告已處理或跳過。輪到 ${nextPlayer.name} (Seat: ${nextPlayer.id})。`);
        this.startActionTimerForPlayer(this.gameState.currentPlayerIndex);
        this.broadcastGameState(); 
        this.processAITurnIfNeeded(); 
    }


    private handleClaimDecision(playerId: number, action: GameActionPayload): boolean {
        console.warn(`[GameRoom ${this.roomId}] handleClaimDecision was called for player ${playerId} with action ${action.type}. This should be processPassClaim or a specific claim action.`);
        if(action.type === 'PASS_CLAIM') return this.processPassClaim(playerId);
        return false;
    }


    private processClaimGang(playerId: number, tileToGang: Tile): boolean {
        const player = this.players.find(p => p.id === playerId);
        if (!player || this.gameState.playerMakingClaimDecision !== playerId || this.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION || !this.gameState.lastDiscardedTile || this.gameState.lastDiscardedTile.kind !== tileToGang.kind) {
             if(player?.socketId) this.io.to(player.socketId).emit('gameError', '無效的明槓宣告。');
            return false;
        }

        const { handAfterAction, newMeldTiles: newMeldGangTiles } = removeTilesFromHand(player.hand, tileToGang.kind, 3);
        if (!newMeldGangTiles || newMeldGangTiles.length !== 3) {
            this.addLog(`錯誤: ${player.name} 無法槓 ${tileToGang.kind}，數量不足。`);
            this.handleInvalidClaim(player, 'Gang');
            return false;
        }
        player.hand = handAfterAction;
        const gangMeld: Meld = {
            id: `meld-${player.id}-${Date.now()}`,
            designation: MeldDesignation.GANGZI,
            tiles: [...newMeldGangTiles, tileToGang].sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue),
            isOpen: true,
            claimedFromPlayerId: this.gameState.lastDiscarderIndex!,
            claimedTileId: tileToGang.id,
        };
        player.melds.push(gangMeld);
        this.addLog(`${player.name} (Seat: ${player.id}) 明槓 ${tileToGang.kind}。`);
        this.broadcastActionAnnouncement("槓", playerId);

        this.consumeDiscardedTileForMeld(tileToGang.id);
        this.clearClaimsAndTimer(); 
        this.gameState.currentPlayerIndex = player.id; 
        
        if (this.gameState.deck.length > 0) {
            const replacementTile = this.gameState.deck.shift()!;
            this.gameState.lastDrawnTile = replacementTile;
            this.addLog(`${player.name} 補花 (${player.isHuman && player.isOnline ? replacementTile.kind : ''})。`);
            this.gameState.gamePhase = GamePhase.PLAYER_DRAWN;
        } else {
            this.addLog(`${player.name}。牌堆已空，無法補花。請出牌。`);
            this.gameState.gamePhase = GamePhase.AWAITING_DISCARD;
        }
        this.updateGameStatePlayers();
        this.startActionTimerForPlayer(player.id);
        this.broadcastGameState();
        return true;
    }
    private processClaimChi(playerId: number, tilesToChiWithInput: Tile[], discardedTileInput: Tile): boolean {
        const player = this.players.find(p => p.id === playerId);
        if (!player || this.gameState.playerMakingClaimDecision !== playerId || this.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION || !this.gameState.lastDiscardedTile || this.gameState.lastDiscardedTile.id !== discardedTileInput.id) {
            if(player?.socketId) this.io.to(player.socketId).emit('gameError', '無效的吃牌宣告。');
            return false;
        }
        
        const actualDiscardedTile = this.gameState.lastDiscardedTile; 

        const tempChiOptions = getChiOptions(player.hand, actualDiscardedTile);
        const isValidChiCombination = tempChiOptions.some(option => 
            option.length === tilesToChiWithInput.length &&
            option.every(optTile => tilesToChiWithInput.find(inputTile => inputTile.id === optTile.id))
        );

        if (!isValidChiCombination) {
            this.addLog(`錯誤: ${player.name} 提供的吃牌組合無效。`);
            this.handleInvalidClaim(player, 'Chi');
            return false;
        }


        let handAfterChi = [...player.hand];
        const claimedTilesFromHand: Tile[] = [];
        for (const tile of tilesToChiWithInput) { 
            const idx = handAfterChi.findIndex(t => t.id === tile.id);
            if (idx !== -1) {
                claimedTilesFromHand.push(handAfterChi.splice(idx, 1)[0]);
            } else {
                this.addLog(`錯誤: ${player.name} 手中找不到 ${tile.kind} (ID: ${tile.id}) 來吃牌。`);
                this.handleInvalidClaim(player, 'Chi');
                return false;
            }
        }
        if (claimedTilesFromHand.length !== 2) { 
            this.addLog(`錯誤: ${player.name} 吃牌時選擇的手牌數量 (${claimedTilesFromHand.length}) 不正確。`);
            this.handleInvalidClaim(player, 'Chi');
            return false;
        }
        player.hand = handAfterChi;

        let meldTiles = [...claimedTilesFromHand, actualDiscardedTile]; 
        meldTiles.sort((a, b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue); 
            
        const chiMeld: Meld = {
            id: `meld-${player.id}-${Date.now()}`,
            designation: MeldDesignation.SHUNZI,
            tiles: meldTiles,
            isOpen: true,
            claimedFromPlayerId: this.gameState.lastDiscarderIndex!,
            claimedTileId: actualDiscardedTile.id,
        };
        player.melds.push(chiMeld);
        this.addLog(`${player.name} (Seat: ${player.id}) 吃了 ${actualDiscardedTile.kind}。請出牌。`);
        this.broadcastActionAnnouncement("吃", playerId);

        this.consumeDiscardedTileForMeld(actualDiscardedTile.id);
        this.clearClaimsAndTimer(); 
        this.gameState.currentPlayerIndex = player.id;
        this.gameState.gamePhase = GamePhase.AWAITING_DISCARD;
        this.updateGameStatePlayers();
        this.startActionTimerForPlayer(player.id);
        this.broadcastGameState();
        return true;
    }

    private processDeclareAnGang(playerId: number, tileKindToGang: TileKind): boolean {
        const player = this.players.find(p => p.id === playerId);
        if (!player || this.gameState.currentPlayerIndex !== playerId ||
            (this.gameState.gamePhase !== GamePhase.PLAYER_TURN_START && this.gameState.gamePhase !== GamePhase.PLAYER_DRAWN && this.gameState.gamePhase !== GamePhase.AWAITING_DISCARD )) {
            if(player?.socketId) this.io.to(player.socketId).emit('gameError', '無效的暗槓宣告時機。');
            return false;
        }
        
        const isDealerInitialAwaitingDiscard = player.isDealer && this.gameState.turnNumber === 1 && this.gameState.gamePhase === GamePhase.AWAITING_DISCARD;

        let handToModify = [...player.hand];
        let anGangTiles: Tile[] = [];
        let usedLastDrawnTile = false;

        if (this.gameState.lastDrawnTile && this.gameState.lastDrawnTile.kind === tileKindToGang && countTilesOfKind(player.hand, tileKindToGang) === 3 && this.gameState.gamePhase === GamePhase.PLAYER_DRAWN) {
            anGangTiles = player.hand.filter(t => t.kind === tileKindToGang); 
            anGangTiles.push(this.gameState.lastDrawnTile); 
            handToModify = player.hand.filter(t => t.kind !== tileKindToGang); 
            usedLastDrawnTile = true;
        } 
        else if (countTilesOfKind(player.hand, tileKindToGang) === 4 && (this.gameState.gamePhase === GamePhase.PLAYER_TURN_START || isDealerInitialAwaitingDiscard)) {
            anGangTiles = player.hand.filter(t => t.kind === tileKindToGang);
            handToModify = player.hand.filter(t => t.kind !== tileKindToGang);
            if (isDealerInitialAwaitingDiscard && this.gameState.lastDrawnTile && this.gameState.lastDrawnTile.kind !== tileKindToGang) {
                // This case implies An Gang from original 7, and the 8th (lastDrawnTile) is different.
            } else if (isDealerInitialAwaitingDiscard && this.gameState.lastDrawnTile && this.gameState.lastDrawnTile.kind === tileKindToGang) {
                 usedLastDrawnTile = true; 
            }
        } else {
            this.addLog(`錯誤: ${player.name} 無法暗槓 ${tileKindToGang}，條件不符。 手牌: ${player.hand.map(h=>h.kind).join(',')}, 摸牌: ${this.gameState.lastDrawnTile?.kind}, 階段: ${this.gameState.gamePhase}`);
             if(player.socketId) this.io.to(player.socketId).emit('gameError', `無法暗槓 ${tileKindToGang}，條件不符。`);
            return false;
        }

        player.hand = sortHandVisually(handToModify);
        const anGangMeld: Meld = {
            id: `meld-${player.id}-${Date.now()}`,
            designation: MeldDesignation.GANGZI,
            tiles: anGangTiles.sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue),
            isOpen: false, 
        };
        player.melds.push(anGangMeld);
        if(usedLastDrawnTile) this.gameState.lastDrawnTile = null;

        this.addLog(`${player.name} (Seat: ${player.id}) 宣告暗槓 ${tileKindToGang}。`);
        this.broadcastActionAnnouncement("暗槓", playerId);
        this.clearActionTimer(); 

        if (this.gameState.deck.length > 0) {
            const replacementTile = this.gameState.deck.shift()!;
            this.gameState.lastDrawnTile = replacementTile;
            this.addLog(`${player.name} 補花 (${player.isHuman && player.isOnline ? replacementTile.kind : ''})。`);
            this.gameState.gamePhase = GamePhase.PLAYER_DRAWN;
        } else {
            this.addLog(`${player.name}。牌堆已空，無法補花。請出牌。`);
            this.gameState.gamePhase = GamePhase.AWAITING_DISCARD; 
        }
        this.updateGameStatePlayers();
        this.startActionTimerForPlayer(player.id); 
        this.broadcastGameState();
        return true;
    }
    private processDeclareMingGangFromHand(playerId: number, tileKindToUpgrade: TileKind): boolean {
        const player = this.players.find(p => p.id === playerId);
        if (!player || this.gameState.currentPlayerIndex !== playerId || this.gameState.gamePhase !== GamePhase.PLAYER_DRAWN || !this.gameState.lastDrawnTile) {
            if(player?.socketId) this.io.to(player.socketId).emit('gameError', '無效的加槓宣告時機。');
            return false;
        }

        if (this.gameState.lastDrawnTile.kind !== tileKindToUpgrade) {
            this.addLog(`錯誤: ${player.name} 加槓 ${tileKindToUpgrade} 失敗，並非剛摸到此牌。摸到的是: ${this.gameState.lastDrawnTile?.kind}`);
             if(player.socketId) this.io.to(player.socketId).emit('gameError', `加槓 ${tileKindToUpgrade} 失敗，摸到的牌是 ${this.gameState.lastDrawnTile?.kind}。`);
            return false;
        }

        const pengMeldIndex = player.melds.findIndex(m => m.designation === MeldDesignation.KEZI && m.tiles[0].kind === tileKindToUpgrade && m.isOpen);
        if (pengMeldIndex === -1) {
            this.addLog(`錯誤: ${player.name} 沒有 ${tileKindToUpgrade} 的碰牌可加槓。`);
             if(player.socketId) this.io.to(player.socketId).emit('gameError', `沒有 ${tileKindToUpgrade} 的碰牌可加槓。`);
            return false;
        }

        const tileToAdd = this.gameState.lastDrawnTile;
        this.gameState.lastDrawnTile = null; 

        player.melds[pengMeldIndex].designation = MeldDesignation.GANGZI;
        player.melds[pengMeldIndex].tiles.push(tileToAdd);
        player.melds[pengMeldIndex].tiles.sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue);

        this.addLog(`${player.name} (Seat: ${player.id}) 將 ${tileKindToUpgrade} 的碰牌加槓。`);
        this.broadcastActionAnnouncement("加槓", playerId);
        this.clearActionTimer();

        if (this.gameState.deck.length > 0) {
            const replacementTile = this.gameState.deck.shift()!;
            this.gameState.lastDrawnTile = replacementTile;
            this.addLog(`${player.name} 補花 (${player.isHuman && player.isOnline ? replacementTile.kind : ''})。`);
            this.gameState.gamePhase = GamePhase.PLAYER_DRAWN;
        } else {
            this.addLog(`${player.name}。牌堆已空，無法補花。請出牌。`);
            this.gameState.gamePhase = GamePhase.AWAITING_DISCARD;
        }
        this.updateGameStatePlayers();
        this.startActionTimerForPlayer(player.id);
        this.broadcastGameState();
        return true;
    }
    private processPassClaim(playerId: number): boolean {
        const player = this.players.find(p => p.id === playerId);
        if (!player || this.gameState.playerMakingClaimDecision !== playerId ) {
            if(player?.socketId) this.io.to(player.socketId).emit('gameError', '無效的跳過宣告，非您決策。');
            return false;
        }
        
        this.addLog(`${player.name} (Seat: ${player.id}) 選擇跳過宣告。`);
        player.pendingClaims = []; 
        this.gameState.potentialClaims = this.gameState.potentialClaims.filter(c => c.playerId !== playerId); 
        this.gameState.playerMakingClaimDecision = null;
        this.clearActionTimer(); 
        this.gameState.chiOptions = null; 

        if (this.gameState.potentialClaims.length > 0) {
            this.startClaimDecisionProcess(); 
        } else {
            this.advanceToNextPlayerTurn(); 
        }
        this.broadcastGameState(); 
        return true;
    }

    private processPlayerConfirmNextRound(playerId: number): boolean {
        const player = this.players.find(p => p.id === playerId);
        if (!player || !player.isHuman || this.gameState.gamePhase !== GamePhase.ROUND_OVER || this.gameState.nextRoundCountdown === null) {
            if(player?.socketId) this.io.to(player.socketId).emit('gameError', '現在無法確認下一局。');
            return false;
        }

        if (!this.gameState.humanPlayersReadyForNextRound.includes(playerId)) {
            this.gameState.humanPlayersReadyForNextRound.push(playerId);
            this.addLog(`${player.name} 已確認下一局。`);
        }

        const totalHumanPlayersOnline = this.players.filter(p => p.isHuman && p.isOnline).length;
        if (totalHumanPlayersOnline > 0 && this.gameState.humanPlayersReadyForNextRound.length === totalHumanPlayersOnline) {
            this.addLog("所有在線真人玩家已確認，立即準備下一局...");
            this.clearNextRoundTimer();
            this.startGameRound(false);
        } else {
            this.broadcastGameState(); 
        }
        return true;
    }

    private consumeDiscardedTileForMeld(claimedTileId: string): void {
        if (this.gameState.lastDiscardedTile && this.gameState.lastDiscardedTile.id === claimedTileId) {
            const tileIndexInDiscard = this.gameState.discardPile.findIndex(t => t.id === claimedTileId);
            if (tileIndexInDiscard === 0) { 
                this.gameState.discardPile.shift();
            } else if (tileIndexInDiscard > 0) {
                this.addLog(`警告: 消耗的棄牌 ${claimedTileId} 不在棄牌堆頂部，但在堆中。正在移除...`);
                this.gameState.discardPile.splice(tileIndexInDiscard, 1);
            } else {
                 this.addLog(`警告: 嘗試消耗的棄牌 ${claimedTileId} 已不在棄牌堆中。`);
            }
            this.gameState.lastDiscardedTile = null; 
        } else {
            this.addLog(`警告: 嘗試為面子消耗的牌 ${claimedTileId} 與當前記錄的 lastDiscardedTile (${this.gameState.lastDiscardedTile?.id}) 不符。`);
        }
    }

    private handleInvalidClaim(player: ServerPlayer, claimType: 'Peng' | 'Gang' | 'Chi' | 'Hu') {
        this.addLog(`錯誤: ${player.name} 的 ${claimType} 宣告無效或失敗。`);
        player.pendingClaims = player.pendingClaims?.filter(c => c.action !== claimType);
        this.gameState.potentialClaims = this.gameState.potentialClaims.filter(c => !(c.playerId === player.id && c.action === claimType));
        
        this.gameState.playerMakingClaimDecision = null; 
        this.clearActionTimer(); 
        
        if (this.gameState.potentialClaims.length > 0) {
            this.startClaimDecisionProcess();
        } else {
            this.advanceToNextPlayerTurn();
        }
        this.broadcastGameState();
    }

    public destroy(): void {
        this.clearActionTimer();
        this.clearNextRoundTimer();
        if (this.emptyRoomTimer) clearTimeout(this.emptyRoomTimer);
        if (this.aiActionTimeout) clearTimeout(this.aiActionTimeout);
        
        this.players.forEach(player => {
            if (player.socketId) {
                const clientSocket = this.io.sockets.sockets.get(player.socketId);
                if (clientSocket) {
                    clientSocket.leave(this.roomId);
                    delete clientSocket.data.currentRoomId;
                    delete clientSocket.data.playerId;
                }
            }
        });

        this.players = [];
        this.addLog(`[GameRoom ${this.roomId}] 房間已銷毀。`);
        console.log(`[GameRoom ${this.roomId}] 房間已銷毀。`);
    }

}
