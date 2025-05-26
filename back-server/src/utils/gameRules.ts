import { Tile, Meld, MeldDesignation, TileKind, Player, Suit } from '../types'; // 引入類型定義
import { SHUNZI_DEFINITIONS, TILE_KIND_DETAILS } from '../constants'; // 引入常數

// 計算手牌中特定種類牌的數量
export const countTilesOfKind = (tiles: Tile[], kind: TileKind): number => {
  // 過濾出種類相符的牌，然後返回其數量
  return tiles.filter(tile => tile.kind === kind).length;
};

// 在手牌中尋找特定種類的牌 (返回找到的第一張)
export const findTileInHand = (hand: Tile[], kind: TileKind): Tile | undefined => {
  // 尋找種類相符的牌
  return hand.find(tile => tile.kind === kind);
};

// 從手牌中移除指定數量、指定種類的牌
export const removeTilesFromHand = (
  hand: Tile[],          // 原始手牌
  kindToRemove: TileKind, // 要移除的牌的種類
  count: number          // 要移除的數量
): { handAfterAction: Tile[]; newMeldTiles: Tile[] | null } => { // 返回操作後的手牌和被移除的牌(用於組成面子)
  const handCopy = [...hand]; // 複製手牌，避免修改原陣列
  const removedTiles: Tile[] = []; // 存放被移除的牌

  // 根據指定的數量進行移除
  for (let i = 0; i < count; i++) {
    // 在手牌副本中尋找符合種類的牌的索引
    const tileIndex = handCopy.findIndex(t => t.kind === kindToRemove);
    if (tileIndex !== -1) { // 如果找到
      removedTiles.push(handCopy.splice(tileIndex, 1)[0]); // 從手牌副本中移除，並加入到 removedTiles
    } else { // 如果找不到足夠的牌
      return { handAfterAction: hand, newMeldTiles: null }; // 返回原始手牌和 null (表示操作失敗)
    }
  }
  // 如果成功移除所有指定的牌
  return { handAfterAction: handCopy, newMeldTiles: removedTiles }; // 返回修改後的手牌和被移除的牌
};


// 檢查是否可以組成順子 (吃牌)
// hand: 玩家手牌
// discardedTile: 其他玩家打出的牌
// 返回: 一個二維陣列，每個子陣列包含兩張手牌，這兩張手牌可以與 discardedTile 組成順子
export const getChiOptions = (hand: Tile[], discardedTile: Tile): Tile[][] => {
  const options: Tile[][] = []; // 存放所有可能的吃牌組合
  
  // 遍歷所有預定義的順子組合 (例如：將士象、車馬包)
  SHUNZI_DEFINITIONS.forEach(shunziSet => {
    // 如果棄牌是此順子定義中的一張牌
    if (shunziSet.includes(discardedTile.kind)) {
      const handTilesForShunzi: Tile[] = []; // 用於存放手牌中能與棄牌組成此順子的牌
      let missingForShunzi = 0; // 記錄還缺少幾張牌才能組成此順子 (除了棄牌之外)
      
      // 遍歷當前順子定義中的每種牌
      shunziSet.forEach(kindInSet => {
        // 如果不是棄牌本身
        if (kindInSet !== discardedTile.kind) {
          // 在手牌中尋找這張牌
          const tileInHand = findTileInHand(hand, kindInSet);
          if (tileInHand) { // 如果手牌中有
            handTilesForShunzi.push(tileInHand); // 加入到候選列表
          } else { // 如果手牌中沒有
            missingForShunzi++; // 記錄缺少一張
          }
        }
      });

      // 如果沒有缺少其他牌 (即手牌中湊齊了另外兩張)，並且確實找到了兩張手牌
      if (missingForShunzi === 0 && handTilesForShunzi.length === 2) {
        // (順子定義已確保同花色)
        options.push(handTilesForShunzi); // 將這兩張手牌作為一個可吃的組合加入到 options
      }
    }
  });
  return options; // 返回所有可吃的組合
};

// 檢查是否可以碰牌
export const canPeng = (hand: Tile[], discardedTile: Tile): boolean => {
  // 手牌中至少有兩張與棄牌相同的牌
  return countTilesOfKind(hand, discardedTile.kind) >= 2;
};

// 檢查是否可以明槓 (別人打出一張，自己手上有三張相同的)
export const canMingGang = (hand: Tile[], discardedTile: Tile): boolean => {
  // 手牌中至少有三張與棄牌相同的牌
  return countTilesOfKind(hand, discardedTile.kind) >= 3;
};

// 檢查可以宣告的暗槓選項
// hand: 玩家當前手牌
// drawnTile: 玩家剛摸到的牌 (可能為 null，例如回合開始時檢查)
// 返回: 一個包含可暗槓的 TileKind 的陣列
export const canDeclareAnGang = (hand: Tile[], drawnTile: Tile | null): TileKind[] => {
  const possibleAnGangs: TileKind[] = []; // 存放可暗槓的牌種
  // 有效手牌：考慮剛摸到的牌 (如果有的話)
  const effectiveHand = drawnTile ? [...hand, drawnTile] : hand; 
  
  // 計算有效手牌中每種牌的數量
  const counts: Record<string, number> = {};
  effectiveHand.forEach(t => { counts[t.kind] = (counts[t.kind] || 0) + 1; });
  
  // 遍歷計數結果
  for (const kindStr in counts) {
    const kind = kindStr as TileKind;
    if (counts[kind] === 4) { // 如果某種牌有四張
       // 1. 剛摸到一張，手牌中原本有三張相同的
       if (drawnTile && kind === drawnTile.kind && countTilesOfKind(hand.filter(t=> t.id !== drawnTile.id), kind) === 3) {
            possibleAnGangs.push(kind);
       } else if (countTilesOfKind(hand, kind) === 4) { 
       // 2. 手牌中原本就有四張 (例如，發牌後或多次摸牌形成，在摸這張 drawnTile 之前就已經有四張)
            // 確保不重複添加
            if (!possibleAnGangs.includes(kind)) {
                 possibleAnGangs.push(kind);
            }
       }
    }
  }
  // 再次檢查原始手牌中是否有四張相同的情況 (drawnTile為null時，或drawnTile不是組成槓子的關鍵牌)
  const handCounts: Record<string, number> = {};
  hand.forEach(t => { handCounts[t.kind] = (handCounts[t.kind] || 0) + 1; });
  for (const kindStr in handCounts) {
    if (handCounts[kindStr as TileKind] === 4 && !possibleAnGangs.includes(kindStr as TileKind)) {
      possibleAnGangs.push(kindStr as TileKind);
    }
  }
  return possibleAnGangs;
};

// 檢查是否可以宣告加槓 (從手中已有的碰，摸到第四張)
// hand: 玩家手牌
// melds: 玩家已宣告的面子
// drawnTile: 玩家剛摸到的牌 (必須有摸牌才能加槓)
// 返回: 一個包含可加槓的選項的陣列，每個選項包含碰的面子的牌種和剛摸到的牌
export const canDeclareMingGangFromHand = (hand: Tile[], melds: Meld[], drawnTile: Tile): {pengMeldKind: TileKind, drawnTile: Tile}[] => {
    const options: {pengMeldKind: TileKind, drawnTile: Tile}[] = [];
    // 如果沒有摸牌，則不能宣告此種加槓
    if (!drawnTile) return options;

    // 遍歷玩家已宣告的面子
    melds.forEach(meld => {
        // 如果面子是碰出來的刻子 (KEZI)，且其牌種與剛摸到的牌相同
        if (meld.designation === MeldDesignation.KEZI && meld.tiles[0].kind === drawnTile.kind && meld.isOpen) {
             options.push({pengMeldKind: meld.tiles[0].kind, drawnTile}); // 加入到可加槓的選項
        }
    });
    return options;
};


// 輔助函數：計算手牌中每種牌的數量，返回 Map
const getTileCounts = (tiles: Tile[]): Map<TileKind, number> => {
  const counts = new Map<TileKind, number>();
  tiles.forEach(tile => {
    counts.set(tile.kind, (counts.get(tile.kind) || 0) + 1);
  });
  return counts;
};

// 檢查胡牌條件：2 組面子 + 1 組對子 (眼)
export const checkWinCondition = (
  hand: Tile[],       // 玩家當前手牌 (未成面子部分)
  existingMelds: Meld[] // 玩家已宣告的明面子
): { isWin: boolean; winningPair?: Meld; winningMelds?: Meld[] } => { // 返回是否胡牌，及胡牌的對子和面子組合 (用於可能的番種計算)
  
  const requiredTotalMelds = 2; 
  const requiredPairs = 1;      

  // 遞迴函數，檢查是否能從 currentHandTiles 中湊出所需的 meldsNeeded 個面子和 pairsNeeded 個對子
  function canFormWinningHand(
    currentHandTiles: Tile[], 
    meldsNeeded: number,      
    pairsNeeded: number       
  ): { possible: boolean; pair?: Meld; foundMelds?: Meld[] } { 
    
    if (meldsNeeded === 0 && pairsNeeded === 0) {
      return { possible: currentHandTiles.length === 0, pair: undefined, foundMelds: [] };
    }
    if (currentHandTiles.length === 0) {
      return { possible: false };
    }

    const sortedHand = [...currentHandTiles].sort((a, b) => {
        const detailsA = TILE_KIND_DETAILS[a.kind];
        const detailsB = TILE_KIND_DETAILS[b.kind];
        if (detailsA.suit !== detailsB.suit) return a.suit.localeCompare(b.suit);
        if (detailsA.group !== detailsB.group) return detailsA.group - detailsB.group; 
        return detailsA.orderValue - detailsB.orderValue;
    });

    // 1. 嘗試湊對子 (如果還需要對子)
    if (pairsNeeded > 0) {
      const counts = getTileCounts(sortedHand); 
      for (const [kind, count] of counts) { 
        if (count >= 2) { 
          const pairTiles = sortedHand.filter(t => t.kind === kind).slice(0, 2); 
          const remainingAfterPair = sortedHand.filter(t => !pairTiles.find(p => p.id === t.id));
          const result = canFormWinningHand(remainingAfterPair, meldsNeeded, pairsNeeded - 1);
          if (result.possible) { 
            return { 
                possible: true, 
                pair: { id: `pair-${kind}-${Date.now()}`, designation: MeldDesignation.DUIZI, tiles: pairTiles, isOpen: false }, 
                foundMelds: result.foundMelds 
            };
          }
        }
      }
    }

    // 2. 嘗試湊面子 (刻子、槓子被視為刻子處理，順子) (如果還需要面子)
    if (meldsNeeded > 0) {
      const counts = getTileCounts(sortedHand); 

      // 2a. 嘗試湊刻子 (或槓子，此處簡化為取三張)
      for (const [kind, count] of counts) {
        if (count >= 3) { 
          const keziTiles = sortedHand.filter(t => t.kind === kind).slice(0, 3); 
          const remainingAfterKezi = sortedHand.filter(t => !keziTiles.find(k => k.id === t.id)); 
          const result = canFormWinningHand(remainingAfterKezi, meldsNeeded - 1, pairsNeeded);
          if (result.possible) { 
            return { 
                possible: true, 
                pair: result.pair, 
                foundMelds: [ 
                    { id: `kezi-${kind}-${Date.now()}`, designation: MeldDesignation.KEZI, tiles: keziTiles, isOpen: false }, 
                    ...(result.foundMelds || [])
                ]
            };
          }
        }
      }
      
      // 2b. 嘗試湊順子
      for (const shunziDef of SHUNZI_DEFINITIONS) {
        const tilesForShunzi: Tile[] = []; 
        let possibleShunzi = true; 
        let tempHandForShunziSearch = [...sortedHand]; 

        for (const kind of shunziDef) { 
          const tileIndexInTempHand = tempHandForShunziSearch.findIndex(t => t.kind === kind);
          if (tileIndexInTempHand !== -1) { 
            tilesForShunzi.push(tempHandForShunziSearch.splice(tileIndexInTempHand, 1)[0]); 
          } else { 
            possibleShunzi = false; 
            break; 
          }
        }
        if (possibleShunzi && tilesForShunzi.length === 3) {
          const remainingAfterShunzi = tempHandForShunziSearch; 
          const result = canFormWinningHand(remainingAfterShunzi, meldsNeeded - 1, pairsNeeded);
          if (result.possible) { 
             return { 
                possible: true, 
                pair: result.pair, 
                foundMelds: [
                    { id: `shunzi-${shunziDef.join('')}-${Date.now()}`, designation: MeldDesignation.SHUNZI, tiles: tilesForShunzi, isOpen: false },
                    ...(result.foundMelds || [])
                ]
            };
          }
        }
      }
    }
    return { possible: false };
  }

  const meldsToFormFromHand = requiredTotalMelds - existingMelds.filter(m => m.designation !== MeldDesignation.DUIZI && m.isOpen).length;
  const pairsToFormFromHand = requiredPairs; // 胡牌必須有一個對子眼，此處簡化為總是從手牌湊

  if (hand.length < (meldsToFormFromHand * 3 + pairsToFormFromHand * 2)) {
    if (meldsToFormFromHand >=0 && pairsToFormFromHand >=0) return { isWin: false };
  }

  const result = canFormWinningHand(hand, meldsToFormFromHand, pairsToFormFromHand);
  
  if (result.possible) { 
    return { isWin: true, winningPair: result.pair, winningMelds: result.foundMelds };
  }

  return { isWin: false };
};
