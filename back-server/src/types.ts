
// 定義牌的顏色 (黑、紅)
export enum Suit {
  BLACK = 'Black', // 黑色
  RED = 'Red',     // 紅色
}

// 定義各種棋子的類型 (牌面)
export enum TileKind {
  // 黑方棋子
  B_GENERAL = '將', B_ADVISOR = '士', B_ELEPHANT = '象',
  B_CHARIOT = '車', B_HORSE = '馬', B_CANNON = '包', B_SOLDIER = '卒',
  // 紅方棋子
  R_GENERAL = '帥', R_ADVISOR = '仕', R_ELEPHANT = '相',
  R_CHARIOT = '俥', R_HORSE = '傌', R_CANNON = '炮', R_SOLDIER = '兵',
}

// 定義單張牌的結構
export interface Tile {
  id: string;       // 每張牌的唯一ID，例如 "B_GENERAL_1"
  kind: TileKind;   // 牌的種類 (例如：將、士、象)
  suit: Suit;       // 牌的顏色 (黑色或紅色)
}

// 定義組合牌的名稱 (面子)
export enum MeldDesignation {
  SHUNZI = '順子', // 三張同花色且序數相連的牌
  KEZI = '刻子',   // 三張相同的牌
  GANGZI = '槓子', // 四張相同的牌
  DUIZI = '對子',   // 兩張相同的牌 (用於胡牌時的眼)
}

// 定義一個已完成的組合牌 (面子) 的結構
export interface Meld {
  id: string;          // 該組合牌的唯一ID
  designation: MeldDesignation; // 組合的類型 (順子、刻子、槓子)
  tiles: Tile[];       // 組成此面子的牌
  isOpen: boolean;     // 此面子是否已明示在桌面上
  claimedFromPlayerId?: number; // 若此面子是透過吃、碰、槓得來，則記錄被取牌的玩家ID (seat index)
  claimedTileId?: string; // 若此面子是透過吃、碰、槓(來自棄牌)得來，記錄被取的那張牌的ID
}

// 定義玩家的結構 (Server-side and Client-side)
export interface Player {
  id: number;         // 玩家的唯一ID (seat index 0-3 for game logic)
  name: string;       // 玩家名稱
  isHuman: boolean;   // 是否為真人玩家
  hand: Tile[];       // 玩家的手牌 (未成面子的牌)
  melds: Meld[];      // 玩家已完成並宣告的面子
  isDealer: boolean;  // 是否為莊家
  score: number;      // 玩家積分
  pendingClaims?: Claim[]; // 該玩家在當前棄牌上可以進行的宣告 (例如：碰、槓、胡) - Server calculates this
  isOnline: boolean; // 多人遊戲中，玩家是否在線
  socketId: string | null; // 多人遊戲中，玩家的 socket ID (for human players)
  isHost?: boolean; // 是否為房主 (由伺服器設定並同步到客戶端)
}


// 代表伺服器上的一個Socket連接的玩家資訊 (用於房間內玩家列表) - This can be simplified or merged with Player
export interface SocketPlayer {
  id: string; // socket.id
  name: string;
  isHost?: boolean;
  // seatIndex?: number; // 玩家在遊戲桌上的座位索引 (0-3) - This is the Player.id
}


// 定義遊戲的不同階段
export enum GamePhase {
  LOADING = 'LOADING', // 遊戲載入中
  WAITING_FOR_PLAYERS = 'WAITING_FOR_PLAYERS', // 等待玩家加入或開始遊戲
  DEALING = 'DEALING', // 發牌階段
  PLAYER_TURN_START = 'PLAYER_TURN_START', // 玩家回合開始 (等待玩家摸牌或宣告暗槓/胡)
  PLAYER_DRAWN = 'PLAYER_DRAWN',         // 玩家已摸牌 (等待玩家打牌或宣告暗槓/胡)
  AWAITING_DISCARD = 'AWAITING_DISCARD', // 玩家已摸牌，等待玩家打出一張牌
  TILE_DISCARDED = 'TILE_DISCARDED',     // 有牌被打出，系統初步檢查是否有玩家可宣告
  AWAITING_CLAIMS_RESOLUTION = 'AWAITING_CLAIMS_RESOLUTION', // 系統正在處理多個宣告的優先順序
  AWAITING_PLAYER_CLAIM_ACTION = 'AWAITING_PLAYER_CLAIM_ACTION', // 特定玩家(通常是真人)正在決定是否對棄牌進行宣告 (有計時器)
  ACTION_PENDING_CHI_CHOICE = 'ACTION_PENDING_CHI_CHOICE', // 真人玩家需要選擇吃的組合
  GAME_OVER = 'GAME_OVER', // 遊戲結束 (有玩家胡牌或流局)
  ROUND_OVER = 'ROUND_OVER', // 本局結束 (用於流局後或莊家變動時，準備開始新的一局)
  AWAITING_REMATCH_VOTES = 'AWAITING_REMATCH_VOTES', // 新增：等待玩家對再戰進行投票
}

// 定義玩家可以對棄牌進行的宣告動作
export interface Claim {
  playerId: number; // 宣告動作的玩家ID (seat index)
  action: 'Hu' | 'Peng' | 'Gang' | 'Chi'; // 宣告的類型 (胡、碰、槓、吃)
  tiles?: Tile[];    // 對於 "吃" 的動作，這裡會包含組成順子的兩張手牌
  priority: number; // 宣告的優先序 (胡 > 槓/碰 > 吃)
}

/**
 * @description 再戰投票狀態
 */
export interface RematchVote {
  playerId: number; // 投票的玩家 ID (座位索引)
  vote: 'yes' | 'pending'; // 投票狀態 ('no' 通常是超時或離開)
}

// 定義整個遊戲的狀態結構
export interface GameState {
  roomId: string | null; // 當前房間的ID // 允許 null for initial state
  roomName: string; // 房間的名稱 (來自初始設定)
  players: Player[];             // 所有玩家的列表 (sorted by seat index)
  deck: Tile[];                  // 牌堆中剩餘的牌
  discardPile: Tile[];           // 棄牌堆
  currentPlayerIndex: number;    // 當前回合的玩家索引 (相對於 players 陣列)
  dealerIndex: number;           // 莊家的索引 (相對於 players 陣列)
  lastDiscarderIndex: number | null;    // 上一個打出牌的玩家索引
  gamePhase: GamePhase;          // 當前的遊戲階段
  lastDiscardedTile: Tile | null;// 上一張被打出的牌
  lastDrawnTile: Tile | null;    // 當前玩家摸到的牌
  turnNumber: number;            // 當前回合數 (指遊戲內的總摸打回合)
  messageLog: string[];          // 遊戲訊息記錄 (例如：誰摸了什麼牌、誰宣告了什麼)
  potentialClaims: Claim[];      // 系統記錄的，所有對上一張棄牌可能的宣告 (用於判斷優先序)
  
  winnerId: number | null;       // 若有贏家，其ID (玩家索引)
  winningTileDiscarderId: number | null; // 若為食胡，放槍的玩家ID (玩家索引)
  winType: 'selfDrawn' | 'discard' | null; // 胡牌類型：自摸或食胡
  winningDiscardedTile: Tile | null; // 若為食胡，胡的那張牌

  isDrawGame: boolean;           // 是否為流局
  chiOptions: Tile[][] | null;   // 若真人玩家可以吃牌，這裡存放可吃的組合選項

  // 用於宣告決策過程的狀態
  playerMakingClaimDecision: number | null; // 正在被提示對宣告作決定的玩家ID (玩家索引)
  actionTimer: number | null; // 通用行動計時器 (秒)
  actionTimerType: 'claim' | 'turn' | null; // 計時器類型：宣告階段或玩家回合階段

  // 局數相關狀態
  numberOfRounds?: number;        // 本次比賽總局數 (來自 RoomSettings, 改為可選)
  currentRound: number;          // 當前是第幾局
  matchOver: boolean;            // 是否所有局數已完成
  nextRoundCountdown: number | null; // 下一局開始倒數計時 (秒)
  humanPlayersReadyForNextRound: number[]; // 已確認下一局的真人玩家ID列表 (seat indexes)
  
  configuredHumanPlayers: number; // 房間創建時設定的真人玩家數量
  configuredFillWithAI: boolean; // 房間創建時設定的 AI 填充選項
  hostPlayerName: string; // 房間創建者的名稱

  // 再戰相關狀態
  rematchVotes?: RematchVote[]; // 玩家的再戰投票
  rematchCountdown?: number | null; // 再戰投票倒數計時 (秒)
  rematchInitiatorId?: number | null; // (已棄用或重新思考)
}

// 定義房間設定的類型 (Client sends this structure, maxPlayers is fixed on server)
export interface ClientRoomSettingsData {
  roomName: string;
  // maxPlayers: number; // Usually fixed to NUM_PLAYERS for this game
  humanPlayers: number; // This is the target number of human players
  fillWithAI: boolean;
  password?: string;
  numberOfRounds?: number; // 改為可選
  // playerName is added by server from socket.data or explicitly passed in ClientToServerEvents
}


// Full RoomSettings used by server
export interface RoomSettings extends ClientRoomSettingsData {
  id: string;
  hostName: string; // Name of the player who created the room
  hostSocketId?: string; // Socket ID of the host, can change if host disconnects/reconnects
  maxPlayers: number; // Always NUM_PLAYERS
  aiPlayers: number; // Calculated by server
  numberOfRounds: number; // 伺服器端保證有值，來自客戶端或預設
}


// 定義所有可能的遊戲動作 (用於 reducer / socket events)
// These are primarily what the client sends to the server.
export type GameActionPayload =
  | { type: 'INITIALIZE_GAME'; settings: RoomSettings } // Server internal or from rematch
  | { type: 'START_GAME_DEAL' } // Server internal, triggered by start game / next round
  | { type: 'START_NEXT_ROUND' } // Server internal, to manage round progression
  | { type: 'DRAW_TILE' } 
  | { type: 'DISCARD_TILE'; tileId: string } 
  | { type: 'DECLARE_AN_GANG'; tileKind: TileKind } 
  | { type: 'DECLARE_MING_GANG_FROM_HAND'; tileKind: TileKind } 
  | { type: 'CLAIM_PENG'; tile: Tile } 
  | { type: 'CLAIM_GANG'; tile: Tile } 
  | { type: 'CLAIM_CHI'; tilesToChiWith: Tile[]; discardedTile: Tile } 
  | { type: 'DECLARE_HU' } 
  | { type: 'PASS_CLAIM' } 
  | { type: 'PLAYER_CONFIRM_NEXT_ROUND'; playerId: number } // Client sends player ID (seat index)
  // | { type: 'REQUEST_REMATCH' } // Client requests - REMOVED, replaced by PLAYER_VOTE_REMATCH
  // | { type: 'CONFIRM_REMATCH' } // Server internal from REQUEST_REMATCH - REMOVED
  // Internal server-only or state-machine triggers from reducer logic
  | { type: 'START_CLAIM_DECISION_PROCESS' }
  | { type: 'SET_PLAYER_CLAIM_ACTION'; playerId: number; claims: Claim[] } // Used internally by reducer
  | { type: 'RESOLVE_CLAIMS' } // Server internal
  | { type: 'DECREMENT_ACTION_TIMER' } // Server internal for timer ticks
  | { type: 'ACTION_TIMER_EXPIRED'; payload?: { explicitlySelectedTileId?: string | null } } // Server internal
  | { type: 'ACTION_PENDING_CHI_CHOICE' } // Server internal to update phase for UI
  | { type: 'SET_NEXT_ROUND_COUNTDOWN' } // Server internal
  | { type: 'DECREMENT_NEXT_ROUND_COUNTDOWN' } // Server internal
  // 再戰相關動作
  | { type: 'PLAYER_VOTE_REMATCH'; vote: 'yes' } // 玩家投票同意再戰
  | { type: 'START_REMATCH_VOTE' } // (僅伺服器) 開始再戰投票流程
  | { type: 'PROCESS_REMATCH_VOTES' }; // (僅伺服器) 處理再戰投票結果


export type GameAction = GameActionPayload;

// AI能執行的動作，通常是GameAction的子集
export type AIExecutableAction =
  | Extract<GameAction, { type: 'DRAW_TILE' }>
  | Extract<GameAction, { type: 'DISCARD_TILE' }>
  | Extract<GameAction, { type: 'DECLARE_AN_GANG' }>
  | Extract<GameAction, { type: 'DECLARE_MING_GANG_FROM_HAND' }>
  | Extract<GameAction, { type: 'CLAIM_PENG' }>
  | Extract<GameAction, { type: 'CLAIM_GANG' }>
  | Extract<GameAction, { type: 'CLAIM_CHI' }>
  | Extract<GameAction, { type: 'DECLARE_HU' }>
  | Extract<GameAction, { type: 'PASS_CLAIM' }>;


// 聊天訊息類型
export interface ChatMessage {
  id: string;
  senderId?: string; // socketId or player's server-side unique ID (seat index or special ID for system)
  senderName: string; 
  text: string;
  timestamp: number;
  type?: 'system' | 'player'; // For system messages like "Player X joined"
}

// 大廳中房間的列表資料 (從伺服器獲取)
export interface RoomListData {
  id: string;
  name: string;
  playersCount: number; // Total active players (human + AI if game started)
  maxPlayers: number; // Fixed (e.g., 4 for this game)
  currentHumanPlayers: number; // Number of current human players online
  targetHumanPlayers: number; // Number of human players set at room creation
  status: '等待中' | '遊戲中' | '已結束';
  passwordProtected: boolean;
  numberOfRounds?: number; // 改為可選 
  hostName?: string;
}


// Socket.IO 事件類型定義
// Events the server sends to the client
export interface ServerToClientEvents {
  connect_error: (err: Error) => void;
  disconnect: (reason: string, description?: any) => void; // Add description for context
  
  // Lobby Events
  lobbyRoomList: (rooms: RoomListData[]) => void;
  lobbyChatMessage: (message: ChatMessage) => void;
  lobbyError: (message: string) => void; // e.g. room creation failed, join failed

  // Game Events
  joinedRoom: (data: { gameState: GameState; roomId: string; clientPlayerId: number }) => void; // clientPlayerId is the seatIndex for this client
  gameStateUpdate: (gameState: GameState) => void; // Full or partial game state
  // gamePlayerJoined is implicit in gameStateUpdate.players
  gamePlayerLeft: (data: { playerId: number; newHostId?: number, message?: string }) => void; // playerId is seatIndex
  gameChatMessage: (message: ChatMessage) => void;
  gameError: (message: string) => void; // e.g., invalid action
  actionAnnouncement: (data: { text: string; playerId: number; position: 'top' | 'bottom' | 'left' | 'right', id: number, isMultiHuTarget?: boolean }) => void; // playerId is seatIndex
}

// Events the client sends to the server
export interface ClientToServerEvents {
  // User management
  userSetName: (name: string, callback: (ack: {success: boolean, message?: string}) => void) => void;

  // Lobby Events
  lobbyCreateRoom: (
    // Client sends its desired settings (maxPlayers is fixed) and its current name
    settings: Omit<ClientRoomSettingsData, 'maxPlayers'> & { playerName: string }, 
    callback: (ack: {success: boolean, roomId?: string, message?: string}) => void
  ) => void;
  lobbyJoinRoom: (
    // Client sends room to join, password if any, and its current name
    data: { roomId: string; password?: string; playerName: string }, 
    callback: (ack: {success: boolean, message?: string}) => void
  ) => void;
  lobbyGetRooms: () => void;
  lobbySendChatMessage: (messageText: string) => void;
  lobbyLeave: () => void; // When player leaves lobby view to go to home

  // Game Events
  // Client sends their action to a specific room. Player ID is inferred from socket on server.
  gamePlayerAction: (roomId: string, action: GameActionPayload) => void; 
  gameSendChatMessage: (roomId: string, messageText: string) => void;
  // gameConfirmNextRound is now part of gamePlayerAction with type: 'PLAYER_CONFIRM_NEXT_ROUND'
  gameRequestStart: (roomId: string) => void; // Host requests to start the game
  gameQuitRoom: (roomId: string) => void; // Player quits an active game or waiting room
  // gameRequestRematch is now part of gamePlayerAction {type: 'PLAYER_VOTE_REMATCH'}
}

// For inter-server communication or internal events (optional)
export interface InterServerEvents {
  // Example: ping: () => void;
}

// For socket.data (custom data attached to each socket instance on server)
export interface SocketData {
  playerName: string;
  currentRoomId?: string;
  playerId?: number; // seatIndex in a game
}
