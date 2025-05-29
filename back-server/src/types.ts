
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
  hasRespondedToClaim?: boolean; // 新增：標記玩家是否已對當前回合的宣告做出回應
  isSpeaking?: boolean; // 新增：玩家是否正在說話 (主要由客戶端更新，伺服器轉發)
  isMuted?: boolean;    // 新增：玩家是否已靜音 (主要由客戶端更新，伺服器轉發)
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
  AWAITING_ALL_CLAIMS_RESPONSE = 'AWAITING_ALL_CLAIMS_RESPONSE', // 新增：等待所有有宣告權的玩家回應
  AWAITING_CLAIMS_RESOLUTION = 'AWAITING_CLAIMS_RESOLUTION', // 系統正在處理多個宣告的優先順序 (所有回應收集完畢後)
  AWAITING_PLAYER_CLAIM_ACTION = 'AWAITING_PLAYER_CLAIM_ACTION', // 單個玩家(舊流程)或所有相關玩家(新流程)正在決定是否對棄牌進行宣告
  ACTION_PENDING_CHI_CHOICE = 'ACTION_PENDING_CHI_CHOICE', // 真人玩家需要選擇吃的組合
  GAME_OVER = 'GAME_OVER', // 整場遊戲結束 (有玩家胡牌導致比賽結束，或所有局數完成)
  ROUND_OVER = 'ROUND_OVER', // 本局結束 (有玩家胡牌或流局，準備開始新的一局或結束比賽)
  AWAITING_REMATCH_VOTES = 'AWAITING_REMATCH_VOTES',
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
 * @description 棄牌堆中單個項目的詳細資訊結構
 */
export interface DiscardedTileInfo {
  tile: Tile;         // 牌物件本身
  discarderId: number; // 打出此牌的玩家 ID (座位索引)
}

/**
 * @description 玩家提交的宣告決策
 */
export interface SubmittedClaim {
  playerId: number;
  action: 'Hu' | 'Peng' | 'Gang' | 'Chi' | 'Pass'; // Pass 表示跳過
  // 如果是吃，還需要包含選擇的吃牌組合
  chiCombination?: Tile[];
  chosenPengGangTileKind?: TileKind; // 用於記錄碰或槓的目標牌種
}


/**
 * @description 定義整個遊戲的狀態結構 (客戶端與伺服器端同步的核心數據)
 */
export interface GameState {
  roomId: string | null;
  roomName: string;
  players: Player[];
  deck: Tile[];
  discardPile: DiscardedTileInfo[];
  currentPlayerIndex: number;
  dealerIndex: number;
  lastDiscarderIndex: number | null;
  gamePhase: GamePhase;
  lastDiscardedTile: Tile | null;
  lastDrawnTile: Tile | null;
  turnNumber: number;
  messageLog: string[];
  potentialClaims: Claim[];      // 仍用於初始識別，但決策流程會基於 submittedClaims

  winnerId: number | null;
  winningTileDiscarderId: number | null;
  winType: 'selfDrawn' | 'discard' | null;
  winningDiscardedTile: Tile | null;

  isDrawGame: boolean;
  chiOptions: Tile[][] | null;   // 仍用於為特定玩家提供吃牌選項

  playerMakingClaimDecision: number | null; // 可能會被 AWAITING_ALL_CLAIMS_RESPONSE 階段的新機制取代或輔助
  actionTimer: number | null;
  actionTimerType: 'claim' | 'turn' | 'global_claim' | null; // 新增 global_claim 類型

  numberOfRounds?: number;
  currentRound: number;
  matchOver: boolean;
  nextRoundCountdown: number | null;
  humanPlayersReadyForNextRound: number[];

  configuredHumanPlayers: number;
  configuredFillWithAI: boolean;
  hostPlayerName: string;
  clientPlayerId?: number | null;

  rematchVotes?: RematchVote[];
  rematchCountdown?: number | null;
  rematchInitiatorId?: number | null;

  // 新增：用於新的宣告流程
  submittedClaims: SubmittedClaim[]; // 儲存本輪所有玩家提交的實際宣告
  globalClaimTimerActive: boolean;   // 標記全局宣告計時器是否正在運行
}

/**
 * @description 客戶端創建房間時提交的設定資料結構 (不含 maxPlayers，因其固定)
 */
export interface ClientRoomSettingsData {
  roomName: string;
  humanPlayers: number;
  fillWithAI: boolean;
  password?: string;
  numberOfRounds?: number;
}


/**
 * @description 房間設定的類型 (前端主要用於 GameBoard 顯示，伺服器端則有更完整的 RoomSettings)
 */
export interface RoomSettings {
  id: string;
  roomName: string;
  maxPlayers: number;
  humanPlayers: number;
  aiPlayers?: number;
  fillWithAI: boolean;
  hostName: string;
  password?: string;
  numberOfRounds?: number;
  hostSocketId?: string;
}

/**
 * @description 定義所有可能的遊戲動作類型和其負載 (payload)。
 */
export type GameActionPayload =
  | { type: 'INITIALIZE_GAME'; settings: RoomSettings }
  | { type: 'START_GAME_DEAL' }
  | { type: 'DRAW_TILE' }
  | { type: 'DISCARD_TILE'; tileId: string }
  | { type: 'DECLARE_AN_GANG'; tileKind: TileKind }
  | { type: 'DECLARE_MING_GANG_FROM_HAND'; tileKind: TileKind }
  | { type: 'CLAIM_PENG'; tile: Tile } // tile 是被碰的棄牌
  | { type: 'CLAIM_GANG'; tile: Tile } // tile 是被槓的棄牌
  | { type: 'CLAIM_CHI'; tilesToChiWith: Tile[]; discardedTile: Tile }
  | { type: 'DECLARE_HU' }
  | { type: 'PASS_CLAIM' } // 舊的跳過宣告，可能會被 SUBMIT_CLAIM_DECISION 取代
  | { type: 'SUBMIT_CLAIM_DECISION'; decision: SubmittedClaim } // 新增：玩家提交宣告決策
  | { type: 'SET_NEXT_ROUND_COUNTDOWN' }
  | { type: 'DECREMENT_NEXT_ROUND_COUNTDOWN' }
  | { type: 'PLAYER_CONFIRM_NEXT_ROUND'; playerId: number }
  | { type: 'START_NEXT_ROUND' }
  | { type: 'START_CLAIM_DECISION_PROCESS' } // 可能會被新的全局宣告流程取代
  | { type: 'SET_PLAYER_CLAIM_ACTION'; playerId: number; claims: Claim[] }
  | { type: 'RESOLVE_CLAIMS' } // 可能會被 resolveAllSubmittedClaims 取代
  | { type: 'DECREMENT_ACTION_TIMER' }
  | { type: 'ACTION_TIMER_EXPIRED'; payload?: { explicitlySelectedTileId?: string | null } }
  | { type: 'GLOBAL_CLAIM_TIMER_EXPIRED' } // 新增：全局宣告計時器到期
  | { type: 'ACTION_PENDING_CHI_CHOICE' }
  | { type: 'PLAYER_VOTE_REMATCH'; vote: 'yes' }
  | { type: 'START_REMATCH_VOTE' }
  | { type: 'PROCESS_REMATCH_VOTES' };


export type GameAction = GameActionPayload;


export type AIExecutableAction =
  | Extract<GameAction, { type: 'DRAW_TILE' }>
  | Extract<GameAction, { type: 'DISCARD_TILE' }>
  | Extract<GameAction, { type: 'DECLARE_AN_GANG' }>
  | Extract<GameAction, { type: 'DECLARE_MING_GANG_FROM_HAND' }>
  | Extract<GameAction, { type: 'CLAIM_PENG' }>
  | Extract<GameAction, { type: 'CLAIM_GANG' }>
  | Extract<GameAction, { type: 'CLAIM_CHI' }>
  | Extract<GameAction, { type: 'DECLARE_HU' }>
  | Extract<GameAction, { type: 'PASS_CLAIM' }>
  | Extract<GameAction, {type: 'SUBMIT_CLAIM_DECISION'}>; // AI 也會提交決策

export interface ChatMessage {
  id: string;
  senderId?: string;
  senderName: string;
  text: string;
  timestamp: number;
  type?: 'system' | 'player';
}

export interface RoomListData {
  id: string;
  name: string;
  playersCount: number;
  maxPlayers: number;
  currentHumanPlayers: number;
  targetHumanPlayers: number;
  status: string;
  passwordProtected: boolean;
  numberOfRounds?: number;
  hostName?: string;
}

// --- 語音聊天相關類型 ---
export interface VoiceChatUser {
  socketId: string;
  playerId: number; // 玩家在遊戲中的座位 ID (用於關聯遊戲玩家和語音參與者)
  playerName: string;
  isMuted: boolean; // 該參與者是否靜音
  isSpeaking?: boolean; // 該參與者是否正在發言 (可選，伺服器端可能不直接追蹤此細節)
}

export interface ServerToClientEvents {
  connect_error: (err: Error) => void;
  disconnect: (reason: string, description?: any) => void;
  lobbyRoomList: (rooms: RoomListData[]) => void;
  lobbyChatMessage: (message: ChatMessage) => void;
  lobbyError: (message: string) => void;
  joinedRoom: (data: { gameState: GameState; roomId: string; clientPlayerId: number }) => void;
  gameStateUpdate: (gameState: GameState) => void;
  gamePlayerJoined: (player: Player) => void;
  gamePlayerLeft: (data: { playerId: number; newHostId?: number; message?: string }) => void;
  gameChatMessage: (message: ChatMessage) => void;
  gameError: (message: string) => void;
  actionAnnouncement: (data: { text: string; playerId: number; position: 'top' | 'bottom' | 'left' | 'right', id: number, isMultiHuTarget?: boolean }) => void;
  availableClaimsNotification: (data: { claims: Claim[], chiOptions?: Tile[][] }) => void;

  // --- 語音聊天事件 (伺服器到客戶端) ---
  voiceSignal: (data: { fromSocketId: string; signal: any }) => void; // WebRTC 信令
  voiceChatUserList: (data: { users: VoiceChatUser[] }) => void; // 房間內現有的語音使用者列表
  voiceChatUserJoined: (userData: VoiceChatUser) => void; // 新使用者加入語音
  voiceChatUserLeft: (data: { socketId: string }) => void; // 使用者離開語音
  voiceChatUserMuted: (data: { socketId: string; muted: boolean }) => void; // 使用者靜音狀態更新
  voiceChatUserSpeaking: (data: { socketId: string; speaking: boolean }) => void; // 使用者發言狀態更新
}

export interface ClientToServerEvents {
  userSetName: (name: string, callback?: (ack: {success: boolean, message?: string}) => void) => void;
  lobbyCreateRoom: (settings: Omit<ClientRoomSettingsData, 'maxPlayers'> & { playerName: string }, callback?: (ack: {success: boolean, roomId?: string, message?: string}) => void) => void;
  lobbyJoinRoom: (data: { roomId: string; password?: string; playerName: string }, callback?: (ack: {success: boolean, message?: string}) => void) => void;
  lobbyGetRooms: () => void;
  lobbySendChatMessage: (messageText: string) => void;
  lobbyLeave: () => void;
  gamePlayerAction: (roomId: string, action: GameActionPayload) => void;
  gameSendChatMessage: (roomId: string, messageText: string) => void;
  gameRequestStart: (roomId: string) => void;
  gameQuitRoom: (roomId: string) => void;

  // --- 語音聊天事件 (客戶端到伺服器) ---
  voiceSignal: (data: { toSocketId: string; signal: any }) => void; // WebRTC 信令
  voiceChatJoinRoom: (data: { roomId: string }) => void; // 客戶端請求加入語音聊天
  voiceChatToggleMute: (data: { muted: boolean }) => void; // 客戶端更新自己的靜音狀態
  voiceChatSpeakingUpdate: (data: { speaking: boolean }) => void; // 客戶端更新自己的發言狀態
}


export interface InterServerEvents {
}

export interface SocketData {
  playerName: string;
  currentRoomId?: string;
  playerId?: number;
  // 伺服器端也記錄一下該 socket 的靜音狀態，以便新加入者獲取
  isMutedInVoiceChat?: boolean;
}

export type MockRoomData = RoomListData & { password?: string };
