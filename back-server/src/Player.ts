
import { Tile, Meld, Player as PlayerInterface, Claim } from './types'; // 引入類型定義
// sortHandVisually is not typically available directly in the server-side Player model
// If sorting is needed internally, it should be a server-side utility or passed in.
// For now, methods will just add/remove, sorting will be handled by calling code if necessary.

/**
 * @class ServerPlayer
 * @description 伺服器端的玩家物件表示。
 *              此類別包裝或擴展 PlayerInterface，用於伺服器內部管理玩家狀態。
 *              AIService 可能會操作更特定的 AIPlayer 類別 (如果需要)。
 */
export class ServerPlayer implements PlayerInterface {
  /** @property {number} id - 玩家的座位索引 (0-3)，用於遊戲邏輯。 */
  id: number; 
  /** @property {string} name - 玩家名稱。 */
  name: string;
  /** @property {boolean} isHuman - 是否為真人玩家。 */
  isHuman: boolean;
  /** @property {Tile[]} hand - 玩家的手牌 (未成面子部分)。 */
  hand: Tile[];
  /** @property {Meld[]} melds - 玩家已完成並宣告的面子。 */
  melds: Meld[];
  /** @property {boolean} isDealer - 是否為莊家。 */
  isDealer: boolean;
  /** @property {number} score - 玩家積分。 */
  score: number;
  /** @property {boolean} isOnline - 玩家是否在線 (真人玩家)。AI 玩家在伺服器邏輯中視為永遠在線。 */
  isOnline: boolean;
  /** @property {string | undefined} socketId - 真人玩家的 Socket ID。 */ // MODIFIED HERE
  socketId: string | undefined;
  /** @property {boolean} isHost - 是否為房主。 */
  isHost: boolean;
  /** @property {Claim[]} [pendingClaims] - 該玩家對當前棄牌可進行的宣告 (由伺服器計算)。 */
  pendingClaims?: Claim[]; 
  /** @property {boolean} [hasRespondedToClaim] - 標記玩家是否已對當前回合的宣告做出回應。 */
  hasRespondedToClaim?: boolean;

  /**
   * @constructor
   * @param {number} id - 玩家座位索引。
   * @param {string} name - 玩家名稱。
   * @param {boolean} isHuman - 是否為真人玩家。
   * @param {string | undefined} [socketId=undefined] - 真人玩家的 Socket ID。 */ // MODIFIED HERE
  constructor(id: number, name: string, isHuman: boolean, socketId: string | undefined = undefined, isHost = false) { // MODIFIED HERE
    this.id = id;
    this.name = name;
    this.isHuman = isHuman;
    this.hand = []; // 初始化空手牌
    this.melds = []; // 初始化空面子列表
    this.isDealer = false; // 預設非莊家
    this.score = 0; // 初始積分，可根據遊戲設定調整
    this.isOnline = isHuman; // AI 玩家在伺服器邏輯中視為恆在線
    this.socketId = socketId;
    this.isHost = isHost;
    this.pendingClaims = []; // 初始化空宣告列表
    this.hasRespondedToClaim = false; // 初始化回應狀態
  }

  /**
   * @description 向玩家手牌中添加一張牌。
   * @param {Tile} tile - 要添加的牌。
   */
  public addTileToHand(tile: Tile): void {
    this.hand.push(tile);
    // 注意：此處不自動排序，排序邏輯由調用方 (例如 PlayerActionHandler) 在適當時機處理。
    console.debug(`[Player ${this.id}] 將牌 ${tile.kind} (ID: ${tile.id}) 加入手牌。新手牌數: ${this.hand.length}`);
  }

  /**
   * @description 從玩家手牌中移除指定ID的牌。
   * @param {string} tileId - 要移除的牌的ID。
   * @returns {Tile | null} 如果找到並移除，返回被移除的牌；否則返回 null。
   */
  public removeTileFromHand(tileId: string): Tile | null {
    const tileIndex = this.hand.findIndex(t => t.id === tileId);
    if (tileIndex !== -1) {
      const removedTile = this.hand.splice(tileIndex, 1)[0];
      // 注意：此處不自動排序，排序邏輯由調用方處理。
      console.debug(`[Player ${this.id}] 從手牌移除牌 ${removedTile.kind} (ID: ${removedTile.id})。新手牌數: ${this.hand.length}`);
      return removedTile;
    }
    console.warn(`[Player ${this.id}] 嘗試移除手牌中的牌 ID ${tileId}，但未找到。`);
    return null;
  }
}