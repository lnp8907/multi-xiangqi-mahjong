

import { TileKind, Suit, GamePhase } from './types';

// 定義每種棋子(牌)的詳細屬性
export const TILE_KIND_DETAILS: Readonly<Record<TileKind, { suit: Suit, orderValue: number, group: 0 | 1 | 2 }>> = {
  // 黑方牌組 1 (將、士、象) - 用於判斷順子
  [TileKind.B_GENERAL]: { suit: Suit.BLACK, orderValue: 3, group: 1 }, // 將 (最大)
  [TileKind.B_ADVISOR]: { suit: Suit.BLACK, orderValue: 2, group: 1 }, // 士
  [TileKind.B_ELEPHANT]: { suit: Suit.BLACK, orderValue: 1, group: 1 }, // 象 (最小)
  // 黑方牌組 2 (車、馬、包) - 用於判斷順子
  [TileKind.B_CHARIOT]: { suit: Suit.BLACK, orderValue: 3, group: 2 }, // 車 (最大)
  [TileKind.B_HORSE]: { suit: Suit.BLACK, orderValue: 2, group: 2 },   // 馬
  [TileKind.B_CANNON]: { suit: Suit.BLACK, orderValue: 1, group: 2 }, // 包 (最小)
  // 黑方兵卒 (不與其他牌組合成順子)
  [TileKind.B_SOLDIER]: { suit: Suit.BLACK, orderValue: 0, group: 0 }, // 卒 (group 0 表示不參與順子)

  // 紅方牌組 1 (帥、仕、相) - 用於判斷順子
  [TileKind.R_GENERAL]: { suit: Suit.RED, orderValue: 3, group: 1 }, // 帥 (最大)
  [TileKind.R_ADVISOR]: { suit: Suit.RED, orderValue: 2, group: 1 }, // 仕
  [TileKind.R_ELEPHANT]: { suit: Suit.RED, orderValue: 1, group: 1 }, // 相 (最小)
  // 紅方牌組 2 (俥、傌、炮) - 用於判斷順子
  [TileKind.R_CHARIOT]: { suit: Suit.RED, orderValue: 3, group: 2 }, // 俥 (最大)
  [TileKind.R_HORSE]: { suit: Suit.RED, orderValue: 2, group: 2 },   // 傌
  [TileKind.R_CANNON]: { suit: Suit.RED, orderValue: 1, group: 2 }, // 炮 (最小)
  // 紅方兵卒
  [TileKind.R_SOLDIER]: { suit: Suit.RED, orderValue: 0, group: 0 }, // 兵 (group 0 表示不參與順子)
};

/** @description 所有牌的種類列表 */
export const ALL_TILE_KINDS: TileKind[] = Object.values(TileKind);
/** @description 遊戲中實際使用的牌的種類 (目前是全部14種)。 */
export const PLAYABLE_TILE_KINDS: TileKind[] = ALL_TILE_KINDS; 

/** @description 定義可以組成順子的牌組。 */
export const SHUNZI_DEFINITIONS: ReadonlyArray<ReadonlyArray<TileKind>> = [
  [TileKind.B_GENERAL, TileKind.B_ADVISOR, TileKind.B_ELEPHANT], // 黑方 將士象
  [TileKind.B_CHARIOT, TileKind.B_HORSE, TileKind.B_CANNON],   // 黑方 車馬包
  [TileKind.R_GENERAL, TileKind.R_ADVISOR, TileKind.R_ELEPHANT], // 紅方 帥仕相
  [TileKind.R_CHARIOT, TileKind.R_HORSE, TileKind.R_CANNON],   // 紅方 俥傌炮
];

// --- 遊戲通用常數 ---
/** @description 玩家數量 (此遊戲固定為4人)。 */
export const NUM_PLAYERS = 4; 
/** @description 每種牌有幾張 (例如，每種棋子有4張)。 */
export const TILES_PER_KIND = 4; 
/** @description 莊家初始手牌數量。 */
export const INITIAL_HAND_SIZE_DEALER = 8; 
/** @description 非莊家初始手牌數量。 */
export const INITIAL_HAND_SIZE_NON_DEALER = 7; 
/** @description 摸牌後，打牌前的最大手牌數量。 */
export const MAX_HAND_SIZE_BEFORE_DISCARD = 8; 

/** 
 * @description 宣告動作的優先順序。
 * - `HU`: 胡牌，優先序最高。
 * - `GANG`: 槓牌。
 * - `PENG`: 碰牌 (與槓相同優先序)。
 * - `CHI`: 吃牌，優先序最低。
 */
export const ACTION_PRIORITY = {
  HU: 3,   
  GANG: 2, 
  PENG: 2, 
  CHI: 1,  
};

// --- 時間相關常數 ---
/** @description 玩家非回合宣告的思考/行動時間 (秒)。GameState 中的 actionTimer 以秒為單位。 */
export const CLAIM_DECISION_TIMEOUT_SECONDS = 30; 
/** @description 玩家回合內行動的思考/行動時間 (秒)。 */
export const PLAYER_TURN_ACTION_TIMEOUT_SECONDS = 30; 
/** @description AI 思考時間的最小值 (毫秒)。 */
export const AI_THINK_TIME_MS_MIN = 100; 
/** @description AI 思考時間的最大值 (毫秒)。 */
export const AI_THINK_TIME_MS_MAX = 3000; 
/** @description 計時器更新間隔 (毫秒)，例如每秒更新一次。 */
export const ACTION_TIMER_INTERVAL_MS = 1000;
/** @description 空房間自動關閉的超時時間 (毫秒)，例如 5 分鐘。 */
export const EMPTY_ROOM_TIMEOUT_MS = 1 * 60 * 1000; 
/** @description 遊戲結束後，若房間變空，則在此超時後關閉房間 (毫秒)，例如 1 分鐘。 */
export const GAME_END_EMPTY_ROOM_TIMEOUT_MS = 1 * 60 * 1000; 
/** @description 下一局開始倒數秒數。GameState 中的 nextRoundCountdown 以秒為單位。 */
export const NEXT_ROUND_COUNTDOWN_SECONDS = 10; 
/** @description 再戰投票的超時時間 (秒)。 */
export const REMATCH_VOTE_TIMEOUT_SECONDS = 20;
/** @description 全局單局最大持續時間 (秒)，例如 5 分鐘。 */
export const MAX_ROUND_DURATION_SECONDS = 600; // 5 分鐘 (可調整)


// --- 設定選項相關常數 ---
/** 
 * @description 局數設定選項。用於創建房間時選擇遊戲總局數。
 * - `value`: 局數的數值。
 * - `label`: 顯示給使用者的文字標籤。
 */
export const ROUND_OPTIONS: ReadonlyArray<{ value: number, label: string }> = [
  { value: 1, label: '1局 (單局決勝)' },
  { value: 4, label: '4局 (東風戰)' },
  { value: 8, label: '8局 (半莊戰)' },
];
/** @description 預設的遊戲總局數。 */
export const DEFAULT_NUMBER_OF_ROUNDS = ROUND_OPTIONS[0].value; // 預設為1局

// --- 遊戲階段翻譯 (伺服器端主要用於日誌記錄) ---
/** 
 * @description 遊戲階段的繁體中文翻譯。
 * 用於在 UI 上顯示當前的遊戲進程，伺服器端也可能用於日誌。
 */
export const GamePhaseTranslations: Record<GamePhase, string> = {
  [GamePhase.LOADING]: "載入中",
  [GamePhase.WAITING_FOR_PLAYERS]: "等待玩家開始",
  [GamePhase.DEALING]: "發牌中",
  [GamePhase.PLAYER_TURN_START]: "玩家回合開始", // 等待摸牌
  [GamePhase.PLAYER_DRAWN]: "玩家已摸牌",    // 等待打牌或自摸/槓
  [GamePhase.AWAITING_DISCARD]: "等待出牌",    // 例如莊家開局或吃碰槓後
  [GamePhase.TILE_DISCARDED]: "等待宣告",     // 有牌被打出，等待其他玩家宣告
  [GamePhase.AWAITING_ALL_CLAIMS_RESPONSE]: "等待所有宣告回應", // 新增翻譯
  [GamePhase.AWAITING_CLAIMS_RESOLUTION]: "處理宣告中", // 系統處理多個宣告的優先順序
  [GamePhase.AWAITING_PLAYER_CLAIM_ACTION]: "等待玩家宣告決定", // 特定玩家決定是否宣告
  [GamePhase.ACTION_PENDING_CHI_CHOICE]: "選擇吃牌組合", // 玩家選擇吃的具體牌型
  [GamePhase.GAME_OVER]: "遊戲結束",        // 整場比賽結束
  [GamePhase.ROUND_OVER]: "本局結束",       // 一局結束，準備下一局或結束比賽
  [GamePhase.AWAITING_REMATCH_VOTES]: "等待再戰投票",
};

// --- 伺服器特定常數 ---
/** @description 伺服器監聽的埠號，優先從環境變數 `PORT` 讀取，否則使用預設值。 */
export const SERVER_PORT = process.env.PORT || 3001;
/** @description 房間名稱的最大長度限制。 */
export const MAX_ROOM_NAME_LENGTH = 20;
/** @description 房間密碼的最大長度限制。 */
export const MAX_PASSWORD_LENGTH = 20;
/** @description 玩家名稱的最大長度限制。 */
export const MAX_PLAYER_NAME_LENGTH = 15;
/** @description 系統訊息的發送者名稱。 */
export const SYSTEM_SENDER_NAME = '系統訊息';
/** @description 預設的主持人名稱。 */
export const DEFAULT_HOST_NAME = "主持人";
/** @description 預設的玩家名稱。 */
export const DEFAULT_PLAYER_NAME = "玩家";
/** @description AI 玩家名稱的前綴。 */
export const AI_NAME_PREFIX = "電腦 ";
/** @description Socket.IO 'lobby' 房間的名稱。 */
export const LOBBY_ROOM_NAME = 'lobby';
/** @description 遊戲訊息記錄的最大條數。 */
export const MAX_MESSAGE_LOG_ENTRIES = 50;

// --- 日誌相關常數 ---
/** @description 日誌級別枚舉，值越小級別越高。 */
export enum LogLevel {
  ERROR = 0, // 嚴重錯誤
  WARN = 1,  // 警告
  INFO = 2,  // 一般資訊
  DEBUG = 3, // 除錯資訊
}
/** @description 定義日誌級別名稱到 LogLevel 枚舉值的映射。 */
export const LOG_LEVEL_NAMES: { [key: string]: LogLevel } = {
  'ERROR': LogLevel.ERROR,
  'WARN': LogLevel.WARN,
  'INFO': LogLevel.INFO,
  'DEBUG': LogLevel.DEBUG,
};
/** @description 預設的日誌記錄目錄路徑。 */
export const DEFAULT_LOG_DIRECTORY = "C:/Users/lnp89/Downloads/mut-xiangqi-mahjong-log";
/** @description 預設的日誌輸出級別。 */
export const DEFAULT_LOG_LEVEL: LogLevel = LogLevel.DEBUG;

// 新增：前端聊天室中用於識別系統訊息的發送者名稱
// (與後端 SYSTEM_SENDER_NAME 區分，因前端可能需要不同顯示)
export const SYSTEM_SENDER_NAME_FRONTEND = '系統訊息';

/** 
 * @description 用於音效模擬的牌面台語/中文名稱。
 * (此常數已移至 constants.ts，若其他檔案有重複定義應移除)
 */
export const TAIWANESE_HOKKIEN_TILE_NAMES: Readonly<Record<TileKind, string>> = {
  [TileKind.B_GENERAL]: '將',
  [TileKind.B_ADVISOR]: '士',
  [TileKind.B_ELEPHANT]: '象',
  [TileKind.B_CHARIOT]: '車',
  [TileKind.B_HORSE]: '馬',
  [TileKind.B_CANNON]: '包',
  [TileKind.B_SOLDIER]: '卒',
  [TileKind.R_GENERAL]: '帥',
  [TileKind.R_ADVISOR]: '仕',
  [TileKind.R_ELEPHANT]: '相',
  [TileKind.R_CHARIOT]: '俥',
  [TileKind.R_HORSE]: '傌',
  [TileKind.R_CANNON]: '炮',
  [TileKind.R_SOLDIER]: '兵',
};