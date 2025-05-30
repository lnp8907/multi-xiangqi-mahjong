

import { TileKind, Suit, GamePhase } from './types'; // 引入類型定義

/**
 * @description 定義每種棋子(牌)的詳細屬性。
 * - `suit`: 牌的顏色 (黑或紅)。
 * - `orderValue`: 在其組內的順序值，用於判斷順子大小 (例如象/相=1, 士/仕=2, 將/帥=3)。
 * - `group`: 牌組編號。
 *    - `0`: 獨立牌組 (兵/卒)，不參與常規順子。
 *    - `1`: 將士象 / 帥仕相 組。
 *    - `2`: 車馬包 / 俥傌炮 組。
 */
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

/** @description 所有牌的種類列表 (從 TileKind 枚舉中獲取)。 */
export const ALL_TILE_KINDS: TileKind[] = Object.values(TileKind);
/** @description 遊戲中實際使用的牌的種類 (目前是全部14種)。 */
export const PLAYABLE_TILE_KINDS: TileKind[] = ALL_TILE_KINDS;

/**
 * @description 定義可以組成順子的牌組。
 * 遊戲規則 (例如 `canChi`) 會檢查玩家是否擁有其中兩張，而第三張是被打出的牌。
 * 每個子陣列代表一個順子組合，例如 [將, 士, 象]。
 */
export const SHUNZI_DEFINITIONS: ReadonlyArray<ReadonlyArray<TileKind>> = [
  [TileKind.B_GENERAL, TileKind.B_ADVISOR, TileKind.B_ELEPHANT], // 黑方 將士象
  [TileKind.B_CHARIOT, TileKind.B_HORSE, TileKind.B_CANNON],   // 黑方 車馬包
  [TileKind.R_GENERAL, TileKind.R_ADVISOR, TileKind.R_ELEPHANT], // 紅方 帥仕相
  [TileKind.R_CHARIOT, TileKind.R_HORSE, TileKind.R_CANNON],   // 紅方 俥傌炮
];

// --- 遊戲相關常數 ---
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

/** @description 非玩家回合宣告的思考時間 (秒)。 */
export const CLAIM_DECISION_TIMEOUT_SECONDS = 30;
/** @description 玩家回合內行動的思考時間 (秒)。 */
export const PLAYER_TURN_ACTION_TIMEOUT_SECONDS = 30;

/**
 * @description 新增：局數設定選項。
 * 用於創建房間時選擇遊戲總局數。
 * - `value`: 局數的數值。
 * - `label`: 顯示給使用者的文字標籤。
 */
export const ROUND_OPTIONS: ReadonlyArray<{ value: number, label: string }> = [
  { value: 1, label: '1局 (單局決勝)' },
  { value: 4, label: '4局 (東風戰)' },
  { value: 8, label: '8局 (半莊戰)' },
  // { value: 16, label: '16局 (一莊戰)' }, // 可選，目前註解掉
];

/** @description 新增：下一局開始倒數秒數。 */
export const NEXT_ROUND_COUNTDOWN_SECONDS = 10;


/**
 * @description 用於音效模擬的牌面台語/中文名稱。
 * 目前直接使用牌面字元作為預留位置，實際音效檔名可能需要對應這些名稱。
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

/**
 * @description 遊戲階段的繁體中文翻譯。
 * 用於在 UI 上顯示當前的遊戲進程。
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

/** @description 新增：用於大廳聊天中識別系統訊息發送者名稱 (前端顯示用)。 */
export const SYSTEM_SENDER_NAME_FRONTEND = '系統訊息';
