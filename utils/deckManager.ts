
import { Tile, TileKind, Player, Suit } from '../types'; // 引入類型定義
import { PLAYABLE_TILE_KINDS, TILES_PER_KIND, TILE_KIND_DETAILS } from '../constants'; // 引入常數

/**
 * @description 創建一副完整的初始牌堆。
 * @returns {Tile[]} 返回包含所有牌的陣列。
 */
export const createInitialDeck = (): Tile[] => {
  const deck: Tile[] = []; // 初始化空牌堆
  // 遍歷所有可玩的牌種 (例如：將、士、象...兵)
  PLAYABLE_TILE_KINDS.forEach(kind => {
    // 每種牌創建 TILES_PER_KIND (通常是4) 張
    for (let i = 0; i < TILES_PER_KIND; i++) {
      deck.push({
        id: `${kind}_${i}`, // 牌的唯一 ID，例如 "B_GENERAL_0"
        kind: kind, // 牌的種類 (例如：TileKind.B_GENERAL)
        suit: TILE_KIND_DETAILS[kind].suit, // 牌的顏色 (從 TILE_KIND_DETAILS 獲取)
      });
    }
  });
  return deck; // 返回創建好的完整牌堆
};

/**
 * @description 使用 Fisher-Yates (Knuth) 洗牌演算法來隨機打亂一個陣列。
 * 这是一个泛型函数，可以用于任何类型的数组。
 * @template T - 陣列中元素的類型。
 * @param {T[]} array - 要被打亂的原始陣列。
 * @returns {T[]} 返回一個新的、被打亂順序的陣列 (原始陣列不會被修改)。
 */
export const shuffleDeck = <T,>(array: T[]): T[] => {
  const shuffledArray = [...array]; // 創建陣列副本，避免修改原陣列
  // Fisher-Yates 洗牌演算法
  // 從陣列的最後一個元素開始，向前遍歷
  for (let i = shuffledArray.length - 1; i > 0; i--) {
    // 隨機選擇一個當前元素之前(包含當前元素)的索引 j
    const j = Math.floor(Math.random() * (i + 1)); 
    // 交換 shuffledArray[i] 和 shuffledArray[j] 的位置
    [shuffledArray[i], shuffledArray[j]] = [shuffledArray[j], shuffledArray[i]];
  }
  return shuffledArray; // 返回洗好的牌堆
};

/**
 * @description 將牌發給所有玩家。
 * @param {Tile[]} deck - 洗好的牌堆。
 * @param {Player[]} players - 玩家列表。
 * @param {number} dealerIndex - 莊家在 players 陣列中的索引。
 * @param {number} dealerHandSize - 莊家應發的手牌數量。
 * @param {number} nonDealerHandSize - 非莊家應發的手牌數量。
 * @returns {{ hands: Tile[][]; remainingDeck: Tile[] }} 返回一個物件，包含：
 *           `hands`: 一個二維陣列，每個子陣列代表一個玩家的手牌。
 *           `remainingDeck`: 發牌後剩餘的牌堆。
 */
export const dealTiles = (
  deck: Tile[],       
  players: Player[],  
  dealerIndex: number, 
  dealerHandSize: number, 
  nonDealerHandSize: number 
): { hands: Tile[][]; remainingDeck: Tile[] } => { 
  let currentDeck = [...deck]; // 複製牌堆用於發牌，避免修改原始牌堆
  const numPlayers = players.length; // 玩家數量
  // 初始化每個玩家的手牌為空陣列
  // hands 陣列的索引對應 players 陣列中玩家的索引 (即座位號)
  const hands: Tile[][] = Array(numPlayers).fill(null).map(() => []);

  // 按照莊家優先，然後順時針的順序發牌 (此處的順序是指發牌的邏輯順序，非實際遊戲輪轉)
  // 重要的是確保每個玩家拿到正確數量的牌
  for (let i = 0; i < numPlayers; i++) {
    // playerActualIndex 是當前要發牌的玩家在 players 陣列中的實際索引
    // 這裡的實現是假設 players 陣列已經是按座位順序排列的
    // 例如，如果 dealerIndex 是 1 (0-indexed)，則發牌順序是 players[1], players[2], players[3], players[0] (假設4個玩家)
    // 但更常見的處理方式是直接遍歷 players 陣列，然後根據 isDealer 判斷手牌數
    // 此處的 playerActualIndex 實際上就是 i (如果 players 是按座位排序的)
    // 或者，如果 dealerIndex 是起始點，則應為 (dealerIndex + i) % numPlayers
    const playerActualIndex = i; // 直接使用 players 陣列的索引作為座位索引

    // 決定該玩家的手牌數量 (莊家和非莊家數量不同)
    const handSize = players[playerActualIndex].isDealer ? dealerHandSize : nonDealerHandSize;
    
    // 為該玩家發指定數量的牌
    for (let j = 0; j < handSize; j++) {
      // 如果牌堆還有牌
      if (currentDeck.length > 0) {
        hands[playerActualIndex].push(currentDeck.shift()!); // 從牌堆頂部取一張牌加入手牌
      } else {
        // 理論上牌堆應該足夠發牌，如果不足則打印錯誤
        console.error("[dealTiles] 錯誤：牌堆數量不足以完成發牌！");
        break; 
      }
    }
  }
  return { hands, remainingDeck: currentDeck }; // 返回所有玩家的手牌和發牌後剩餘的牌堆
};

/**
 * @description 對手牌進行視覺化排序 (通常用於客戶端顯示)。
 * 排序規則：花色 -> 牌組 -> 順序值 (大到小)。
 * @param {Tile[]} hand - 要排序的手牌。
 * @returns {Tile[]} 排序後的手牌副本。
 */
export const sortHandVisually = (hand: Tile[]): Tile[] => {
  return [...hand].sort((a, b) => {
    const detailsA = TILE_KIND_DETAILS[a.kind];
    const detailsB = TILE_KIND_DETAILS[b.kind];
    // 1. 按花色排序 (黑牌在前)
    if (detailsA.suit !== detailsB.suit) {
      return detailsA.suit === Suit.BLACK ? -1 : 1; 
    }
    // 2. 按牌組排序 (將士象組 -> 車馬包組 -> 兵卒組)
    const groupOrderValue = (group: 0 | 1 | 2) => {
      if (group === 1) return 1; // 將士象組
      if (group === 2) return 2; // 車馬包組
      if (group === 0) return 3; // 兵卒組
      return 4; // 預留，理論上不應出現
    };
    if (detailsA.group !== detailsB.group) {
      return groupOrderValue(detailsA.group) - groupOrderValue(detailsB.group);
    }
    // 3. 同花色同組內，按順序值降序排列 (orderValue 大的牌在前，例如 將 > 士 > 象)
    return detailsB.orderValue - detailsA.orderValue; 
  });
};
