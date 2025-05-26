

// 定義牌的顏色 (黑、紅)
export enum Suit {
  BLACK = 'Black', // 黑色
  RED = 'Red',     // 紅色
}

// 定義各種棋子的類型 (牌面)
export enum TileKind {
  // 黑方棋子
  B_GENERAL = '將', // 黑方 - 將軍
  B_ADVISOR = '士', // 黑方 - 士
  B_ELEPHANT = '象', // 黑方 - 象
  B_CHARIOT = '車', // 黑方 - 車
  B_HORSE = '馬',   // 黑方 - 馬
  B_CANNON = '包',  // 黑方 - 包 (炮)
  B_SOLDIER = '卒', // 黑方 - 卒
  // 紅方棋子
  R_GENERAL = '帥', // 紅方 - 主帥
  R_ADVISOR = '仕', // 紅方 - 仕
  R_ELEPHANT = '相', // 紅方 - 相
  R_CHARIOT = '俥', // 紅方 - 俥
  R_HORSE = '傌',   // 紅方 - 傌
  R_CANNON = '炮',  // 紅方 - 炮
  R_SOLDIER = '兵', // 紅方 - 兵
}

/**
 * @description 定義單張牌的結構
 */
export interface Tile {
  id: string;       // 每張牌的唯一ID，例如 "B_GENERAL_1"
  kind: TileKind;   // 牌的種類 (例如：將、士、象)
  suit: Suit;       // 牌的顏色 (黑色或紅色)
}

/**
 * @description 定義組合牌的名稱 (面子)
 */
export enum MeldDesignation {
  SHUNZI = '順子', // 三張同花色且序數相連的牌
  KEZI = '刻子',   // 三張相同的牌
  GANGZI = '槓子', // 四張相同的牌
  DUIZI = '對子',   // 兩張相同的牌 (用於胡牌時的眼)
}

/**
 * @description 定義一個已完成的組合牌 (面子) 的結構
 */
export interface Meld {
  id: string;          // 該組合牌的唯一ID
  designation: MeldDesignation; // 組合的類型 (順子、刻子、槓子)
  tiles: Tile[];       // 組成此面子的牌
  isOpen: boolean;     // 此面子是否已明示在桌面上 (例如：吃、碰、明槓的面子為 true，暗槓為 false)
  claimedFromPlayerId?: number; // 若此面子是透過吃、碰、槓得來，則記錄被取牌的玩家ID (座位索引)
  claimedTileId?: string; // 若此面子是透過吃、碰、槓(來自棄牌)得來，記錄被取的那張牌的ID
}

/**
 * @description 定義玩家的結構 (客戶端與伺服器端通用)
 */
export interface Player {
  id: number;         // 玩家的唯一ID (由伺服器分配，通常是座位索引 0-3)
  name: string;       // 玩家名稱
  isHuman: boolean;   // 是否為真人玩家
  hand: Tile[];       // 玩家的手牌 (未成面子的牌)
  melds: Meld[];      // 玩家已完成並宣告的面子
  isDealer: boolean;  // 是否為莊家
  score: number;      // 玩家積分
  pendingClaims?: Claim[]; // 該玩家在當前棄牌上可以進行的宣告 (例如：碰、槓、胡) - 由伺服器計算
  isOnline?: boolean; // 多人遊戲中，玩家是否在線 (伺服器端維護)
  socketId?: string; // 多人遊戲中，玩家的 socket ID (僅對真人玩家有意義)
  isHost?: boolean; // 是否為房主 (由伺服器設定並同步到客戶端)
}


/**
 * @description 代表伺服器上的一個Socket連接的玩家資訊 (主要用於房間內玩家列表顯示)
 * @deprecated 此類型可能與 Player 重疊，未來可能整合或移除。
 */
export interface SocketPlayer {
  id: string; // socket.id
  name: string; // 玩家名稱
  isHost?: boolean; // 是否為房主
}


/**
 * @description 定義遊戲的不同階段
 */
export enum GamePhase {
  LOADING = 'LOADING', // 遊戲載入中 (例如：等待伺服器初始化)
  WAITING_FOR_PLAYERS = 'WAITING_FOR_PLAYERS', // 等待玩家加入或房主開始遊戲
  DEALING = 'DEALING', // 發牌階段
  PLAYER_TURN_START = 'PLAYER_TURN_START', // 玩家回合開始 (等待玩家摸牌或宣告暗槓/胡)
  PLAYER_DRAWN = 'PLAYER_DRAWN',         // 玩家已摸牌 (等待玩家打牌或宣告暗槓/自摸/加槓)
  AWAITING_DISCARD = 'AWAITING_DISCARD', // 玩家已摸牌，等待玩家打出一張牌 (例如莊家開局或吃碰槓後)
  TILE_DISCARDED = 'TILE_DISCARDED',     // 有牌被打出，系統初步檢查是否有玩家可宣告
  AWAITING_CLAIMS_RESOLUTION = 'AWAITING_CLAIMS_RESOLUTION', // 系統正在處理多個玩家對同一棄牌的宣告的優先順序
  AWAITING_PLAYER_CLAIM_ACTION = 'AWAITING_PLAYER_CLAIM_ACTION', // 特定玩家(通常是真人)正在決定是否對棄牌進行宣告 (有計時器)
  ACTION_PENDING_CHI_CHOICE = 'ACTION_PENDING_CHI_CHOICE', // 真人玩家需要選擇吃的組合
  GAME_OVER = 'GAME_OVER', // 整場遊戲結束 (有玩家胡牌導致比賽結束，或所有局數完成)
  ROUND_OVER = 'ROUND_OVER', // 本局結束 (有玩家胡牌或流局，準備開始新的一局或結束比賽)
  AWAITING_REMATCH_VOTES = 'AWAITING_REMATCH_VOTES', // 新增：等待玩家對再戰進行投票
}

/**
 * @description 定義玩家可以對棄牌進行的宣告動作
 */
export interface Claim {
  playerId: number; // 宣告動作的玩家ID (座位索引)
  action: 'Hu' | 'Peng' | 'Gang' | 'Chi'; // 宣告的類型 (胡、碰、槓、吃)
  tiles?: Tile[];    // 對於 "吃" 的動作，這裡會包含組成順子的兩張手牌；對於 "胡" 或 "槓"，可能是觸發的牌
  priority: number; // 宣告的優先序 (胡 > 槓/碰 > 吃)
}

/**
 * @description 再戰投票狀態
 */
export interface RematchVote {
  playerId: number; // 投票的玩家 ID (座位索引)
  vote: 'yes' | 'pending'; // 投票狀態 ('no' 通常是超時或離開)
}

/**
 * @description 定義整個遊戲的狀態結構 (客戶端與伺服器端同步的核心數據)
 */
export interface GameState {
  roomId: string | null; // 當前房間的ID (伺服器端保證有值，客戶端可能初始為null)
  roomName: string; // 房間的名稱 (來自初始設定)
  players: Player[];             // 所有玩家的列表 (按座位索引排序)
  deck: Tile[];                  // 牌堆中剩餘的牌
  discardPile: Tile[];           // 棄牌堆 (通常最新棄牌在最前面或最後面，依實現)
  currentPlayerIndex: number;    // 當前回合的玩家索引 (相對於 players 陣列)
  dealerIndex: number;           // 莊家的索引 (相對於 players 陣列)
  lastDiscarderIndex: number | null;    // 上一個打出牌的玩家索引
  gamePhase: GamePhase;          // 當前的遊戲階段
  lastDiscardedTile: Tile | null;// 上一張被打出的牌 (等待被宣告的牌)
  lastDrawnTile: Tile | null;    // 當前玩家摸到的牌
  turnNumber: number;            // 當前回合數 (指遊戲內的總摸打回合，非局數)
  messageLog: string[];          // 遊戲訊息記錄 (例如：誰摸了什麼牌、誰宣告了什麼)
  potentialClaims: Claim[];      // 系統記錄的，所有對上一張棄牌可能的宣告 (用於判斷優先序)
  
  winnerId: number | null;       // 若有贏家，其ID (玩家索引)
  winningTileDiscarderId: number | null; // 若為食胡，放槍的玩家ID (玩家索引)
  winType: 'selfDrawn' | 'discard' | null; // 胡牌類型：自摸或食胡
  winningDiscardedTile: Tile | null; // 若為食胡，胡的那張牌

  isDrawGame: boolean;           // 是否為流局
  chiOptions: Tile[][] | null;   // 若真人玩家可以吃牌，這裡存放可吃的組合選項 (每組為手上的兩張牌)

  // 用於宣告決策過程的狀態
  playerMakingClaimDecision: number | null; // 正在被提示對宣告作決定的玩家ID (玩家索引)
  actionTimer: number | null; // 通用行動計時器 (秒)，用於玩家回合或宣告決定
  actionTimerType: 'claim' | 'turn' | null; // 計時器類型：宣告階段或玩家回合階段

  // 新增：局數相關狀態
  numberOfRounds?: number;        // 本次比賽總局數 (來自 RoomSettings, 變為可選以兼容舊數據)
  currentRound: number;          // 當前是第幾局
  matchOver: boolean;            // 是否所有局數已完成 (整場比賽結束)
  nextRoundCountdown: number | null; // 下一局開始倒數計時 (秒)
  humanPlayersReadyForNextRound: number[]; // 已確認下一局的真人玩家ID列表 (座位索引)
  
  // 多人遊戲特定狀態 (從 RoomSettings 同步或初始化)
  configuredHumanPlayers: number; // 房間創建時設定的真人玩家數量
  configuredFillWithAI: boolean; // 房間創建時設定的 AI 填充選項
  hostPlayerName: string; // 房間創建者的名稱
  clientPlayerId?: number | null; // 客戶端專用：當前客戶端對應的玩家 ID (座位索引 0-3)，伺服器不直接使用此欄位，而是透過 joinedRoom 事件傳遞

  // 再戰相關狀態
  rematchVotes?: RematchVote[]; // 玩家的再戰投票
  rematchCountdown?: number | null; // 再戰投票倒數計時 (秒)
  rematchInitiatorId?: number | null; // (棄用或重新思考) 原設計可能用於追蹤誰發起再戰，但新邏輯是全員投票
}

/**
 * @description 客戶端創建房間時提交的設定資料結構 (不含 maxPlayers，因其固定)
 */
export interface ClientRoomSettingsData {
  roomName: string; // 房間名稱
  humanPlayers: number; // 目標真人玩家數量
  fillWithAI: boolean; // 若真人玩家不足，是否用 AI 填滿
  password?: string; // 房間密碼 (可選)
  numberOfRounds?: number; // 總局數 (改為可選)
  // playerName: string; // 玩家名稱，在 App.tsx 中發送請求前附加
}


/**
 * @description 房間設定的類型 (前端主要用於 GameBoard 顯示，伺服器端則有更完整的 RoomSettings)
 */
export interface RoomSettings {
  id: string; // 房間的唯一ID
  roomName: string; // 房間名稱
  maxPlayers: number; // 總玩家數 (通常固定為4)
  humanPlayers: number; // 真人玩家數量 (創建時的設定)
  aiPlayers?: number; // AI 玩家數量 (伺服器計算後填入，客戶端主要用於顯示)
  fillWithAI: boolean; // 若 humanPlayers < maxPlayers，是否用 AI 填滿
  playerName: string; // 創建此房間的玩家名稱 (房主名稱)
  password?: string; // 房間密碼 (可選)
  numberOfRounds?: number; // 總局數 (改為可選)
  hostSocketId?: string; // (僅伺服器端使用) 房主的 socket ID
}

/**
 * @description 定義所有可能的遊戲動作類型和其負載 (payload)。
 * 用於客戶端與伺服器之間的遊戲指令通訊，以及伺服器內部狀態機的事件。
 */
export type GameActionPayload =
  | { type: 'INITIALIZE_GAME'; settings: RoomSettings } // 伺服器內部使用，或用於再戰時初始化
  | { type: 'START_GAME_DEAL' } // 客戶端 (房主) 請求開始遊戲，伺服器處理後觸發發牌
  | { type: 'DRAW_TILE' } // 玩家執行摸牌動作
  | { type: 'DISCARD_TILE'; tileId: string } // 玩家打出一張牌
  | { type: 'DECLARE_AN_GANG'; tileKind: TileKind } // 玩家宣告暗槓
  | { type: 'DECLARE_MING_GANG_FROM_HAND'; tileKind: TileKind } // 玩家宣告加槓 (碰牌後摸到第四張)
  | { type: 'CLAIM_PENG'; tile: Tile } // 玩家宣告碰牌 (tile 為被碰的棄牌)
  | { type: 'CLAIM_GANG'; tile: Tile } // 玩家宣告明槓 (tile 為被槓的棄牌)
  | { type: 'CLAIM_CHI'; tilesToChiWith: Tile[]; discardedTile: Tile } // 玩家宣告吃牌 (tilesToChiWith 為手中的兩張牌，discardedTile 為被吃的牌)
  | { type: 'DECLARE_HU' } // 玩家宣告胡牌
  | { type: 'PASS_CLAIM' } // 玩家選擇跳過宣告 (不吃、不碰、不槓、不胡)
  | { type: 'SET_NEXT_ROUND_COUNTDOWN' } // (僅伺服器) 設定下一局開始的倒數計時
  | { type: 'DECREMENT_NEXT_ROUND_COUNTDOWN' } // (僅伺服器或客戶端內部) 減少下一局倒數計時
  | { type: 'PLAYER_CONFIRM_NEXT_ROUND'; playerId: number } // 客戶端玩家確認準備好下一局
  | { type: 'START_NEXT_ROUND' } // (僅伺服器) 開始下一局的流程
  | { type: 'START_CLAIM_DECISION_PROCESS' } // (僅伺服器) 開始宣告決策流程 (遍歷可宣告的玩家)
  | { type: 'SET_PLAYER_CLAIM_ACTION'; playerId: number; claims: Claim[] } // (僅伺服器內部) 設定特定玩家的可宣告動作
  | { type: 'RESOLVE_CLAIMS' } // (僅伺服器) 處理所有宣告並決定最終執行者
  | { type: 'DECREMENT_ACTION_TIMER' } // (僅伺服器) 減少玩家行動計時器
  | { type: 'ACTION_TIMER_EXPIRED'; payload?: { explicitlySelectedTileId?: string | null } } // (僅伺服器) 玩家行動計時器到期，附帶可能的自動操作資訊
  | { type: 'ACTION_PENDING_CHI_CHOICE' } // (僅伺服器) 更新遊戲階段，提示客戶端玩家選擇吃牌組合
  // 再戰相關動作 (取代舊的 REQUEST_REMATCH)
  | { type: 'PLAYER_VOTE_REMATCH'; vote: 'yes' } // 玩家投票同意再戰
  | { type: 'START_REMATCH_VOTE' } // (僅伺服器) 開始再戰投票流程
  | { type: 'PROCESS_REMATCH_VOTES' }; // (僅伺服器) 處理再戰投票結果


// GameAction 與 GameActionPayload 在此處是同義詞，代表一個遊戲動作
export type GameAction = GameActionPayload;


/**
 * @description AI 玩家可以執行的動作子集
 */
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

/**
 * @description 聊天訊息的結構
 */
export interface ChatMessage {
  id: string; // 訊息的唯一ID
  senderId?: string; // 發送者的唯一標識 (socketId 或玩家的伺服器端ID)
  senderName: string; // 發送者名稱
  text: string; // 訊息內容
  timestamp: number; // 訊息發送的時間戳 (毫秒)
  type?: 'system' | 'player'; // 訊息類型：系統訊息或玩家訊息
}

/**
 * @description 大廳中顯示的房間列表項目資料結構 (從伺服器獲取)
 */
export interface RoomListData {
  id: string; // 房間的唯一ID
  name: string; // 房間名稱
  playersCount: number; // 房間內總玩家數 (包含真人與AI，若遊戲已開始)
  maxPlayers: number; // 房間最大玩家數 (對此遊戲固定為 NUM_PLAYERS)
  currentHumanPlayers: number; // 當前房間內的真人玩家數量
  targetHumanPlayers: number; // 房間創建時設定的目標真人玩家數量
  status: string; // 房間狀態，例如："等待中", "遊戲中", "已結束"
  passwordProtected: boolean; // 是否有密碼保護
  numberOfRounds?: number; // 房間設定的總局數
  hostName?: string; // (可選) 房主名稱
}

// --- Socket.IO 事件類型定義 ---

/**
 * @description 定義伺服器發送給客戶端的事件及其類型
 */
export interface ServerToClientEvents {
  /** @description Socket 連接錯誤事件 */
  connect_error: (err: Error) => void;
  /** @description Socket 斷開連接事件 
   * @param {string} reason - 斷開原因
   * @param {any} [description] - 伺服器提供的額外描述
  */
  disconnect: (reason: string, description?: any) => void; 
  
  // --- 大廳事件 ---
  /** @description 伺服器發送大廳房間列表
   * @param {RoomListData[]} rooms - 房間列表數據
   */
  lobbyRoomList: (rooms: RoomListData[]) => void;
  /** @description 伺服器廣播大廳聊天訊息
   * @param {ChatMessage} message - 聊天訊息對象
   */
  lobbyChatMessage: (message: ChatMessage) => void;
  /** @description 伺服器發送大廳相關錯誤訊息 (例如：創建房間失敗)
   * @param {string} message - 錯誤訊息
   */
  lobbyError: (message: string) => void; 

  // --- 遊戲事件 ---
  /** @description 客戶端成功加入房間後，伺服器發送此事件
   * @param {object} data - 包含遊戲狀態、房間ID和客戶端玩家ID的數據
   * @param {GameState} data.gameState - 初始遊戲狀態
   * @param {string} data.roomId - 加入的房間ID
   * @param {number} data.clientPlayerId - 客戶端在此房間中的玩家ID (座位索引)
   */
  joinedRoom: (data: { gameState: GameState; roomId: string; clientPlayerId: number }) => void;
  /** @description 伺服器發送遊戲狀態更新 (可以是完整或部分狀態)
   * @param {GameState} gameState - 最新的遊戲狀態
   */
  gameStateUpdate: (gameState: GameState) => void; 
  /** @description 有新玩家加入遊戲房間 (此事件目前被 gameStateUpdate 中的 players 陣列更新所隱含，可能移除)
   * @param {Player} player - 新加入的玩家資訊
   */
  gamePlayerJoined: (player: Player) => void; 
  /** @description 有玩家離開遊戲房間 (例如斷線)
   * @param {object} data - 包含離開玩家的資訊
   * @param {number} data.playerId - 離開的玩家ID (座位索引)
   * @param {number} [data.newHostId] - 如果房主離開，新的房主ID (座位索引)
   * @param {string} [data.message] - 相關訊息，例如離開原因
   */
  gamePlayerLeft: (data: { playerId: number; newHostId?: number; message?: string }) => void; 
  /** @description 伺服器廣播遊戲內聊天訊息
   * @param {ChatMessage} message - 聊天訊息對象
   */
  gameChatMessage: (message: ChatMessage) => void;
  /** @description 伺服器發送遊戲相關錯誤訊息 (例如：無效操作)
   * @param {string} message - 錯誤訊息
   */
  gameError: (message: string) => void; 
  /** @description 伺服器廣播玩家動作宣告的視覺特效 (例如：碰、槓、胡)
   * @param {object} data - 宣告特效的相關資訊
   * @param {string} data.text - 宣告的文字 (例如："碰")
   * @param {number} data.playerId - 執行動作的玩家ID (座位索引)
   * @param {'top' | 'bottom' | 'left' | 'right'} data.position - 伺服器視角的玩家位置 (客戶端會轉換成相對位置)
   * @param {number} data.id - 宣告的唯一ID (用於客戶端動畫管理)
   * @param {boolean} [data.isMultiHuTarget] - 是否為「一炮多響」的目標之一
   */
  actionAnnouncement: (data: { text: string; playerId: number; position: 'top' | 'bottom' | 'left' | 'right', id: number, isMultiHuTarget?: boolean }) => void;
  // ROUND_OVER 和 GAME_OVER 事件現在已整合到 gameStateUpdate.gamePhase 的變化中
}

/**
 * @description 定義客戶端發送給伺服器的事件及其類型
 */
export interface ClientToServerEvents {
  // --- 使用者管理 ---
  /** @description 客戶端設定其玩家名稱
   * @param {string} name - 玩家設定的名稱
   * @param {(ack: {success: boolean, message?: string}) => void} [callback] - 伺服器回調，告知是否成功
   */
  userSetName: (name: string, callback?: (ack: {success: boolean, message?: string}) => void) => void;

  // --- 大廳事件 ---
  /** @description 客戶端請求創建一個新房間
   * @param {Omit<ClientRoomSettingsData, 'maxPlayers'> & { playerName: string }} settings - 房間設定 (不含 maxPlayers) 及創建者名稱
   * @param {(ack: {success: boolean, roomId?: string, message?: string}) => void} [callback] - 伺服器回調，告知是否成功及房間ID
   */
  lobbyCreateRoom: (settings: Omit<ClientRoomSettingsData, 'maxPlayers'> & { playerName: string }, callback?: (ack: {success: boolean, roomId?: string, message?: string}) => void) => void;
  /** @description 客戶端請求加入一個已存在的房間
   * @param {object} data - 加入房間所需的資料
   * @param {string} data.roomId - 要加入的房間ID
   * @param {string} [data.password] - 房間密碼 (如果需要)
   * @param {string} data.playerName - 加入者的玩家名稱
   * @param {(ack: {success: boolean, message?: string}) => void} [callback] - 伺服器回調，告知是否成功
   */
  lobbyJoinRoom: (data: { roomId: string; password?: string; playerName: string }, callback?: (ack: {success: boolean, message?: string}) => void) => void;
  /** @description 客戶端請求獲取大廳中的房間列表 */
  lobbyGetRooms: () => void;
  /** @description 客戶端發送大廳聊天訊息
   * @param {string} messageText - 聊天訊息內容
   */
  lobbySendChatMessage: (messageText: string) => void;
  /** @description 客戶端通知伺服器其已離開大廳視圖 (例如返回主頁) */
  lobbyLeave: () => void; 

  // --- 遊戲事件 ---
  /** @description 客戶端發送遊戲中的玩家動作
   * @param {string} roomId - 動作發生的房間ID
   * @param {GameActionPayload} action - 玩家執行的動作及其負載
   */
  gamePlayerAction: (roomId: string, action: GameActionPayload) => void; 
  /** @description 客戶端發送遊戲內的聊天訊息
   * @param {string} roomId - 訊息發送的房間ID
   * @param {string} messageText - 聊天訊息內容
   */
  gameSendChatMessage: (roomId: string, messageText: string) => void;
  // gameConfirmNextRound 事件已整合到 gamePlayerAction: {type: 'PLAYER_CONFIRM_NEXT_ROUND', playerId}
  /** @description 房主請求開始遊戲
   * @param {string} roomId - 要開始遊戲的房間ID
   */
  gameRequestStart: (roomId: string) => void; 
  /** @description 玩家請求退出當前所在的遊戲房間 (無論是等待中或遊戲中)
   * @param {string} roomId - 要退出的房間ID
   */
  gameQuitRoom: (roomId: string) => void; 
  // gameRequestRematch 已被新的 PLAYER_VOTE_REMATCH 取代
}


/**
 * @description 用於伺服器之間通訊的事件 (此專案中未使用)
 */
export interface InterServerEvents {
  // 例如: ping: () => void;
}

/**
 * @description 附加到每個 Socket 連接實例上的自訂資料 (伺服器端使用)
 */
export interface SocketData {
  playerName: string; // 此 Socket 連接對應的玩家名稱
  currentRoomId?: string; // 此 Socket 當前所在的房間 ID
  playerId?: number; // 此 Socket 在遊戲中的座位索引
}

/**
 * @description Lobby.tsx 內部使用的模擬房間數據類型，可能包含密碼。
 * @deprecated 此類型與 RoomListData 重疊，且密碼處理應分開。若 roomService 完全被後端取代則可移除。
 */
export type MockRoomData = RoomListData & { password?: string };
