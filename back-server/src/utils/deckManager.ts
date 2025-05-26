
import { Tile, TileKind, Player, Suit } from '../types'; // 引入類型定義
import { PLAYABLE_TILE_KINDS, TILES_PER_KIND, TILE_KIND_DETAILS } from '../constants'; // 引入常數

// 創建初始牌堆的函數
export const createInitialDeck = (): Tile[] => {
  const deck: Tile[] = []; // 初始化空牌堆
  // 遍歷所有可玩的牌種
  PLAYABLE_TILE_KINDS.forEach(kind => {
    // 每種牌創建 TILES_PER_KIND (通常是4) 張
    for (let i = 0; i < TILES_PER_KIND; i++) {
      deck.push({
        id: `${kind}_${i}`, // 牌的唯一 ID，例如 "B_GENERAL_0"
        kind: kind, // 牌的種類
        suit: TILE_KIND_DETAILS[kind].suit, // 牌的顏色 (從 TILE_KIND_DETAILS 獲取)
      });
    }
  });

  // --- BEGIN ADDED LOGGING ---
  // 日誌：開始驗證初始牌堆的牌數量
  console.log(`[DeckManager] createInitialDeck: 完整牌堆已創建。開始驗證牌的數量...`);
  const counts = new Map<TileKind, number>(); // 用於計數的 Map
  deck.forEach(tile => { // 遍歷牌堆中的每張牌
    counts.set(tile.kind, (counts.get(tile.kind) || 0) + 1); // 對每種牌進行計數
  });

  let countsCorrect = true; // 標記牌數量是否全部正確
  PLAYABLE_TILE_KINDS.forEach(kind => { // 遍歷所有可玩的牌種
    const count = counts.get(kind) || 0; // 獲取該牌種的計數
    if (count !== TILES_PER_KIND) { // 如果計數不等於預期的每種牌的數量
      // 錯誤日誌：記錄牌種、實際數量和預期數量
      console.error(`[DeckManager] 錯誤於 createInitialDeck: 牌種 ${kind} 的數量為 ${count}，應為 ${TILES_PER_KIND}。`);
      countsCorrect = false; // 標記為不正確
    }
  });

  if (countsCorrect) { // 如果所有牌的數量都正確
    // 日誌：確認所有牌的數量正確，並記錄總牌數
    console.log(`[DeckManager] createInitialDeck: 所有牌的數量已驗證正確 (${TILES_PER_KIND} 張/種)。總牌數: ${deck.length}`);
  } else { // 如果有牌的數量不正確
    // 錯誤日誌：牌數量驗證失敗
    console.error(`[DeckManager] createInitialDeck: 牌數量驗證失敗。`);
  }
  // --- END ADDED LOGGING ---
  return deck; // 返回創建好的完整牌堆
};

// 洗牌函數 (泛型版本，可洗任何類型的陣列)
export const shuffleDeck = <T,>(array: T[]): T[] => {
  const shuffledArray = [...array]; // 創建陣列副本，避免修改原陣列
  // Fisher-Yates 洗牌演算法
  for (let i = shuffledArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); // 隨機選擇一個索引
    // 交換元素
    [shuffledArray[i], shuffledArray[j]] = [shuffledArray[j], shuffledArray[i]];
  }
  return shuffledArray; // 返回洗好的牌堆
};

// 發牌函數
export const dealTiles = (
  deck: Tile[],       // 洗好的牌堆
  players: Player[],  // 玩家列表
  dealerIndex: number, // 莊家在 players 陣列中的索引
  dealerHandSize: number, // 莊家手牌數
  nonDealerHandSize: number // 非莊家手牌數
): { hands: Tile[][]; remainingDeck: Tile[] } => { // 返回每個玩家的手牌和剩餘牌堆
  let currentDeck = [...deck]; // 複製牌堆用於發牌
  const numPlayers = players.length;
  // 初始化每個玩家的手牌為空陣列
  const hands: Tile[][] = Array(numPlayers).fill(null).map(() => []);

  // 按照莊家優先，然後順時針的順序發牌
  for (let i = 0; i < numPlayers; i++) {
    // 這裡的 playerIndex 是指在 players 陣列中的索引，而不是玩家 ID
    const playerActualIndex = (dealerIndex + i) % numPlayers; // 計算當前發牌的玩家在 players 陣列中的索引
    
    // 決定該玩家的手牌數量 (莊家多一張)
    const handSize = players[playerActualIndex].isDealer ? dealerHandSize : nonDealerHandSize;
    
    // 為該玩家發指定數量的牌
    for (let j = 0; j < handSize; j++) {
      // 如果牌堆還有牌
      if (currentDeck.length > 0) {
        hands[playerActualIndex].push(currentDeck.shift()!); // 從牌堆頂部取一張牌加入手牌
      }
    }
  }
  return { hands, remainingDeck: currentDeck }; // 返回所有玩家的手牌和發牌後剩餘的牌堆
};

// 手牌排序函數 (視覺上，通常用於客戶端，但伺服器端有時也需要一致的順序)
export const sortHandVisually = (hand: Tile[]): Tile[] => {
  return [...hand].sort((a, b) => {
    const detailsA = TILE_KIND_DETAILS[a.kind];
    const detailsB = TILE_KIND_DETAILS[b.kind];
    if (detailsA.suit !== detailsB.suit) {
      return detailsA.suit === Suit.BLACK ? -1 : 1; 
    }
    const groupOrderValue = (group: 0 | 1 | 2) => {
      if (group === 1) return 1; 
      if (group === 2) return 2; 
      if (group === 0) return 3; 
      return 4; 
    };
    if (detailsA.group !== detailsB.group) {
      return groupOrderValue(detailsA.group) - groupOrderValue(detailsB.group);
    }
    return detailsB.orderValue - detailsA.orderValue; // OrderValue 大的在前
  });
};
