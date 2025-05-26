
import { Tile, Meld, Player as PlayerInterface, Claim } from './types'; // 引入類型定義

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
  /** @property {string | null} socketId - 真人玩家的 Socket ID。 */
  socketId: string | null;
  /** @property {boolean} isHost - 是否為房主。 */
  isHost: boolean;
  /** @property {Claim[]} [pendingClaims] - 該玩家對當前棄牌可進行的宣告 (由伺服器計算)。 */
  pendingClaims?: Claim[]; 

  /**
   * @constructor
   * @param {number} id - 玩家座位索引。
   * @param {string} name - 玩家名稱。
   * @param {boolean} isHuman - 是否為真人玩家。
   * @param {string | null} [socketId=null] - 真人玩家的 Socket ID。
   * @param {boolean} [isHost=false] - 是否為房主。
   */
  constructor(id: number, name: string, isHuman: boolean, socketId: string | null = null, isHost = false) {
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
  }

  // 可在此處添加伺服器端玩家相關的特定方法，例如：
  // addTileToHand(tile: Tile) {
  //   this.hand.push(tile);
  // }
}
