
import { Tile, Meld, MeldDesignation, TileKind, Player, Suit } from '../types'; // 引入類型定義
import { SHUNZI_DEFINITIONS, TILE_KIND_DETAILS } from '../constants'; // 引入常數

/**
 * @description 計算一組牌中特定種類牌的數量。
 * @param {Tile[]} tiles - 要檢查的牌陣列 (例如手牌)。
 * @param {TileKind} kind - 要計算的牌的種類。
 * @returns {number} 返回該種類牌的數量。
 */
export const countTilesOfKind = (tiles: Tile[], kind: TileKind): number => {
  // 過濾出種類相符的牌，然後返回其數量
  return tiles.filter(tile => tile.kind === kind).length;
};

/**
 * @description 在手牌中尋找特定種類的牌。
 * @param {Tile[]} hand - 玩家的手牌。
 * @param {TileKind} kind - 要尋找的牌的種類。
 * @returns {Tile | undefined} 如果找到，返回第一張符合種類的牌物件；否則返回 undefined。
 */
export const findTileInHand = (hand: Tile[], kind: TileKind): Tile | undefined => {
  // 尋找種類相符的牌
  return hand.find(tile => tile.kind === kind);
};

/**
 * @description 從手牌中移除指定數量、指定種類的牌。
 * @param {Tile[]} hand - 原始手牌。
 * @param {TileKind} kindToRemove - 要移除的牌的種類。
 * @param {number} count - 要移除的數量。
 * @returns {{ handAfterAction: Tile[]; newMeldTiles: Tile[] | null }} 返回一個物件：
 *           `handAfterAction`: 操作後的手牌。
 *           `newMeldTiles`: 被移除的牌組成的陣列 (用於組成面子)；如果操作失敗 (例如牌不夠)，則為 null。
 */
export const removeTilesFromHand = (
  hand: Tile[],          
  kindToRemove: TileKind, 
  count: number          
): { handAfterAction: Tile[]; newMeldTiles: Tile[] | null } => { 
  const handCopy = [...hand]; // 複製手牌，避免修改原陣列
  const removedTiles: Tile[] = []; // 存放被移除的牌

  // 根據指定的數量進行移除
  for (let i = 0; i < count; i++) {
    // 在手牌副本中尋找符合種類的牌的索引
    const tileIndex = handCopy.findIndex(t => t.kind === kindToRemove);
    if (tileIndex !== -1) { // 如果找到
      removedTiles.push(handCopy.splice(tileIndex, 1)[0]); // 從手牌副本中移除，並加入到 removedTiles
    } else { // 如果找不到足夠的牌
      console.warn(`[gameRules] removeTilesFromHand: 手牌中 ${kindToRemove} 數量不足以移除 ${count} 張。`);
      return { handAfterAction: hand, newMeldTiles: null }; // 返回原始手牌和 null (表示操作失敗)
    }
  }
  // 如果成功移除所有指定的牌
  return { handAfterAction: handCopy, newMeldTiles: removedTiles }; // 返回修改後的手牌和被移除的牌
};


/**
 * @description 檢查玩家是否可以利用指定的棄牌來組成順子 (吃牌)。
 * @param {Tile[]} hand - 玩家的手牌。
 * @param {Tile} discardedTile - 其他玩家打出的棄牌。
 * @returns {Tile[][]} 返回一個二維陣列，每個子陣列包含兩張手牌，這兩張手牌可以與 discardedTile 組成一個順子。
 *                     如果不能吃牌，則返回空陣列。
 */
export const getChiOptions = (hand: Tile[], discardedTile: Tile): Tile[][] => {
  const options: Tile[][] = []; // 存放所有可能的吃牌組合 (每組是手上的兩張牌)
  
  // 遍歷所有預定義的順子組合 (例如：將士象、車馬包)
  SHUNZI_DEFINITIONS.forEach(shunziSet => {
    // 檢查棄牌是否屬於當前這個順子定義 (shunziSet)
    if (shunziSet.includes(discardedTile.kind)) {
      const handTilesForShunzi: Tile[] = []; // 用於存放手牌中能與棄牌組成此順子的牌
      let missingForShunzi = 0; // 記錄還缺少幾張牌才能組成此順子 (除了棄牌之外)
      
      // 遍歷當前順子定義 (shunziSet) 中的每種牌
      shunziSet.forEach(kindInSet => {
        // 如果不是棄牌本身 (我們要找的是手上的另兩張)
        if (kindInSet !== discardedTile.kind) {
          // 在手牌中尋找這張牌 (kindInSet)
          const tileInHand = findTileInHand(hand, kindInSet);
          if (tileInHand) { // 如果手牌中有
            handTilesForShunzi.push(tileInHand); // 加入到候選列表
          } else { // 如果手牌中沒有
            missingForShunzi++; // 記錄缺少一張
          }
        }
      });

      // 如果沒有缺少其他牌 (即 missingForShunzi === 0) 並且確實找到了兩張手牌
      if (missingForShunzi === 0 && handTilesForShunzi.length === 2) {
        // (順子定義已確保同花色同組，無需再次檢查)
        options.push(handTilesForShunzi); // 將這兩張手牌作為一個可吃的組合加入到 options
      }
    }
  });
  return options; // 返回所有可吃的組合
};

/**
 * @description 檢查玩家是否可以碰指定的棄牌。
 * @param {Tile[]} hand - 玩家的手牌。
 * @param {Tile} discardedTile - 其他玩家打出的棄牌。
 * @returns {boolean} 如果手牌中至少有兩張與棄牌相同的牌，則返回 true；否則返回 false。
 */
export const canPeng = (hand: Tile[], discardedTile: Tile): boolean => {
  return countTilesOfKind(hand, discardedTile.kind) >= 2;
};

/**
 * @description 檢查玩家是否可以明槓指定的棄牌 (即手上有三張與棄牌相同的牌)。
 * @param {Tile[]} hand - 玩家的手牌。
 * @param {Tile} discardedTile - 其他玩家打出的棄牌。
 * @returns {boolean} 如果手牌中至少有三張與棄牌相同的牌，則返回 true；否則返回 false。
 */
export const canMingGang = (hand: Tile[], discardedTile: Tile): boolean => {
  return countTilesOfKind(hand, discardedTile.kind) >= 3;
};

/**
 * @description 檢查玩家可以宣告的暗槓選項。
 * 暗槓可以是：1. 手中已有四張相同的牌。 2. 手中已有三張相同的牌，又摸到一張。
 * @param {Tile[]} hand - 玩家當前手牌 (不包含剛摸到的牌，除非 drawnTile 為 null 且 hand 代表完整手牌)。
 * @param {Tile | null} drawnTile - 玩家剛摸到的牌 (若為 null，則表示檢查摸牌前的情況，例如莊家開局)。
 * @returns {TileKind[]} 返回一個包含所有可暗槓的牌種類 (TileKind) 的陣列。
 */
export const canDeclareAnGang = (hand: Tile[], drawnTile: Tile | null): TileKind[] => {
  const possibleAnGangs: TileKind[] = []; // 存放可暗槓的牌種
  // 有效手牌：組合當前手牌和剛摸到的牌 (如果有的話)
  const effectiveHand = drawnTile ? [...hand, drawnTile] : hand; 
  
  // 計算有效手牌中每種牌的數量
  const counts: Record<string, number> = {}; // 使用 Record<string, number> 簡化計數
  effectiveHand.forEach(t => { counts[t.kind] = (counts[t.kind] || 0) + 1; });
  
  // 遍歷計數結果
  for (const kindStr in counts) {
    const kind = kindStr as TileKind; // 將字串索引轉回 TileKind
    if (counts[kind] === 4) { // 如果某種牌有四張
       // 情況1: 剛摸到一張，手牌中原本有三張相同的 (不包含 drawnTile 本身)
       if (drawnTile && kind === drawnTile.kind && countTilesOfKind(hand.filter(t=> t.id !== drawnTile.id), kind) === 3) {
            possibleAnGangs.push(kind);
       } else if (countTilesOfKind(hand, kind) === 4) { 
       // 情況2: 手牌中原本就有四張 (例如，發牌後或多次摸牌形成，在摸這張 drawnTile 之前就已經有四張)
            // 確保不重複添加 (理論上 kind 唯一，但以防萬一)
            if (!possibleAnGangs.includes(kind)) {
                 possibleAnGangs.push(kind);
            }
       }
    }
  }
  // 再次檢查原始手牌中是否有四張相同的情況 (處理 drawnTile 為 null，或 drawnTile 不是組成槓子的關鍵牌時)
  // 這是為了確保檢查到所有 "手牌中本來就有四張" 的情況
  const handCounts: Record<string, number> = {};
  hand.forEach(t => { handCounts[t.kind] = (handCounts[t.kind] || 0) + 1; });
  for (const kindStr in handCounts) {
    if (handCounts[kindStr as TileKind] === 4 && !possibleAnGangs.includes(kindStr as TileKind)) {
      possibleAnGangs.push(kindStr as TileKind);
    }
  }
  return possibleAnGangs;
};

/**
 * @description 檢查玩家是否可以宣告加槓 (也稱小明槓、補槓)。
 * 條件是：玩家之前已經碰了一個刻子，現在又摸到了第四張相同的牌。
 * @param {Tile[]} hand - 玩家當前手牌 (不包含剛摸到的牌)。
 * @param {Meld[]} melds - 玩家已宣告的面子。
 * @param {Tile} drawnTile - 玩家剛摸到的牌 (必須有摸牌才能加槓)。
 * @returns {{pengMeldKind: TileKind, drawnTile: Tile}[]} 返回一個包含可加槓選項的陣列。
 *         每個選項包含被加槓的碰牌的種類 (pengMeldKind) 和剛摸到的那張牌 (drawnTile)。
 */
export const canDeclareMingGangFromHand = (hand: Tile[], melds: Meld[], drawnTile: Tile): {pengMeldKind: TileKind, drawnTile: Tile}[] => {
    const options: {pengMeldKind: TileKind, drawnTile: Tile}[] = [];
    // 如果沒有摸牌，則不能宣告此種加槓
    if (!drawnTile) return options;

    // 遍歷玩家已宣告的面子
    melds.forEach(meld => {
        // 如果面子是碰出來的刻子 (KEZI)，其牌種與剛摸到的牌相同，且是公開的 (isOpen)
        if (meld.designation === MeldDesignation.KEZI && meld.tiles[0].kind === drawnTile.kind && meld.isOpen) {
            // 此處 hand 參數應為加槓前的 player.hand，drawnTile 尚未加入
            // 所以此檢查確認的是 drawnTile 本身，而不是手牌中是否 *還有* drawnTile
             options.push({pengMeldKind: meld.tiles[0].kind, drawnTile}); // 加入到可加槓的選項
        }
    });
    return options;
};


/**
 * @description 輔助函數：計算一組牌中每種牌的數量。
 * @param {Tile[]} tiles - 要計算的牌陣列。
 * @returns {Map<TileKind, number>} 返回一個 Map，鍵為牌的種類 (TileKind)，值為該種類牌的數量。
 */
const getTileCounts = (tiles: Tile[]): Map<TileKind, number> => {
  const counts = new Map<TileKind, number>();
  tiles.forEach(tile => {
    counts.set(tile.kind, (counts.get(tile.kind) || 0) + 1);
  });
  return counts;
};

// 輔助函數：(已註解，原為複雜的尋找所有面子組合的函數，目前未使用)
// const findMelds = (tiles: Tile[], canFormGangzi: boolean = true): Meld[][] => {
//   // ... (複雜的組合尋找邏輯，暫時用簡化版替代)
//   return []; 
// };


/**
 * @description 檢查胡牌條件：象棋麻將的胡牌牌型通常是「2 組面子 + 1 組對子 (眼)」。
 * 面子可以是順子、刻子或槓子。槓子算作一個面子。
 * @param {Tile[]} hand - 玩家當前手牌 (未成面子部分)。
 * @param {Meld[]} existingMelds - 玩家已宣告的明面子 (吃、碰、明槓)。暗槓也算已完成面子。
 * @returns {{ isWin: boolean; winningPair?: Meld; winningMelds?: Meld[] }} 返回一個物件：
 *           `isWin`: 布林值，表示是否胡牌。
 *           `winningPair`: (可選) 如果胡牌，則為組成的對子 (眼)。
 *           `winningMelds`: (可選) 如果胡牌，則為從手牌中組成的面子 (不包含 existingMelds)。
 */
export const checkWinCondition = (
  hand: Tile[],       
  existingMelds: Meld[] 
): { isWin: boolean; winningPair?: Meld; winningMelds?: Meld[] } => { 
  
  // 胡牌所需的面子和對子數量
  const requiredTotalMelds = 2; // 總共需要2個面子
  const requiredPairs = 1;      // 總共需要1個對子 (眼)

  /**
   * @description 遞迴輔助函數，檢查 `currentHandTiles` 是否能湊出 `meldsNeeded` 個面子和 `pairsNeeded` 個對子。
   * @param {Tile[]} currentHandTiles - 當前用於組合的手牌。
   * @param {number} meldsNeeded - 還需要湊出的面子數量。
   * @param {number} pairsNeeded - 還需要湊出的對子數量。
   * @returns {{ possible: boolean; pair?: Meld; foundMelds?: Meld[] }} 返回一個物件，
   *           `possible`: 布林值，表示是否能湊成。
   *           `pair`: (可選) 找到的對子。
   *           `foundMelds`: (可選) 找到的面子陣列。
   */
  function canFormWinningHand(
    currentHandTiles: Tile[], 
    meldsNeeded: number,      
    pairsNeeded: number       
  ): { possible: boolean; pair?: Meld; foundMelds?: Meld[] } { 
    
    // 基本情況：如果不需要再湊任何面子和對子
    if (meldsNeeded === 0 && pairsNeeded === 0) {
      // 如果手牌也剛好用完，則表示成功湊出胡牌牌型
      return { possible: currentHandTiles.length === 0, pair: undefined, foundMelds: [] };
    }
    // 如果手牌已用完，但還需要湊面子或對子，則失敗
    if (currentHandTiles.length === 0) {
      return { possible: false };
    }

    // 為了方便處理，先將手牌排序 (按花色、組別、順序值)
    const sortedHand = [...currentHandTiles].sort((a, b) => {
        const detailsA = TILE_KIND_DETAILS[a.kind];
        const detailsB = TILE_KIND_DETAILS[b.kind];
        if (detailsA.suit !== detailsB.suit) return a.suit.localeCompare(b.suit);
        if (detailsA.group !== detailsB.group) return detailsA.group - detailsB.group; // 確保同組的牌在一起
        return detailsA.orderValue - detailsB.orderValue; // 順序值小的在前 (便於找順子)
    });

    // 1. 嘗試湊對子 (如果還需要對子)
    if (pairsNeeded > 0) {
      const counts = getTileCounts(sortedHand); // 計算手牌中各種牌的數量
      for (const [kind, count] of counts) { // 遍歷每種牌
        if (count >= 2) { // 如果某種牌的數量大於等於2，可以湊成對子
          const pairTiles = sortedHand.filter(t => t.kind === kind).slice(0, 2); // 取出兩張作為對子
          // 從手牌中移除這兩張牌，得到剩餘手牌
          const remainingAfterPair = sortedHand.filter(t => !pairTiles.find(p => p.id === t.id));
          // 遞迴呼叫，看剩餘手牌能否湊出剩餘所需的面子 (對子已湊齊一個)
          const result = canFormWinningHand(remainingAfterPair, meldsNeeded, pairsNeeded - 1);
          if (result.possible) { // 如果遞迴成功
            return { 
                possible: true, 
                // 記錄找到的對子 (ID 僅為示意，實際可更複雜或由伺服器生成)
                pair: { id: `pair-${kind}-${Date.now()}`, designation: MeldDesignation.DUIZI, tiles: pairTiles, isOpen: false }, 
                foundMelds: result.foundMelds // 加上遞迴中找到的面子
            };
          }
        }
      }
    }

    // 2. 嘗試湊面子 (刻子、槓子被視為刻子處理，順子) (如果還需要面子)
    if (meldsNeeded > 0) {
      const counts = getTileCounts(sortedHand); // 重新計算 (或傳遞) 手牌中各種牌的數量

      // 2a. 嘗試湊刻子 (或槓子，此處簡化為取三張)
      for (const [kind, count] of counts) {
        if (count >= 3) { // 如果某種牌的數量大於等於3，可以湊成刻子
          const keziTiles = sortedHand.filter(t => t.kind === kind).slice(0, 3); // 取出三張作為刻子
          const remainingAfterKezi = sortedHand.filter(t => !keziTiles.find(k => k.id === t.id)); // 剩餘手牌
          // 遞迴呼叫，看剩餘手牌能否湊出剩餘所需的面子和對子 (刻子已湊齊一個)
          const result = canFormWinningHand(remainingAfterKezi, meldsNeeded - 1, pairsNeeded);
          if (result.possible) { // 如果遞迴成功
            return { 
                possible: true, 
                pair: result.pair, // 加上遞迴中找到的對子
                foundMelds: [ // 加上本次找到的刻子和遞迴中找到的其他面子
                    { id: `kezi-${kind}-${Date.now()}`, designation: MeldDesignation.KEZI, tiles: keziTiles, isOpen: false }, 
                    ...(result.foundMelds || [])
                ]
            };
          }
        }
      }
      
      // 2b. 嘗試湊順子
      // 遍歷所有預定義的順子牌組
      for (const shunziDef of SHUNZI_DEFINITIONS) {
        const tilesForShunzi: Tile[] = []; // 用於存放組成此順子的三張牌
        let possibleShunzi = true; // 標記是否可能湊成此順子
        // 複製一份當前手牌，用於從中 "取出" 牌來組順子，避免影響其他順子組合的判斷
        let tempHandForShunziSearch = [...sortedHand]; 

        for (const kind of shunziDef) { // 遍歷順子定義中的每種牌
          // 在臨時手牌中尋找對應種類的牌
          const tileIndexInTempHand = tempHandForShunziSearch.findIndex(t => t.kind === kind);
          if (tileIndexInTempHand !== -1) { // 如果找到
            tilesForShunzi.push(tempHandForShunziSearch.splice(tileIndexInTempHand, 1)[0]); // 取出並加入到 tilesForShunzi
          } else { // 如果找不到
            possibleShunzi = false; // 標記無法湊成此順子
            break; // 跳出當前順子定義的遍歷
          }
        }
        // 如果成功湊齊三張牌組成順子
        if (possibleShunzi && tilesForShunzi.length === 3) {
          // 剩餘手牌 (tempHandForShunziSearch 在上面已被修改)
          const remainingAfterShunzi = tempHandForShunziSearch; 
          // 遞迴呼叫，看剩餘手牌能否湊出剩餘所需的面子和對子 (順子已湊齊一個)
          const result = canFormWinningHand(remainingAfterShunzi, meldsNeeded - 1, pairsNeeded);
          if (result.possible) { // 如果遞迴成功
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
    // 如果以上所有嘗試都失敗
    return { possible: false };
  }

  // 計算總共需要從手牌中湊出的面子數量
  // existingMelds 包含所有已宣告的面子 (吃碰槓)，槓子算一個面子
  const meldsToFormFromHand = requiredTotalMelds - existingMelds.filter(m => m.designation !== MeldDesignation.DUIZI && m.isOpen).length;
  // 計算總共需要從手牌中湊出的對子數量
  // 簡化版：胡牌必須有一個對子眼，此處假設總是從手牌湊。更複雜規則可能允許碰出的對子作眼。
  const pairsToFormFromHand = requiredPairs; // 假設眼必須是手牌中的

  // 初步的牌數檢查：如果手牌數量不足以組成剩餘所需的面子和對子，則直接判斷不能胡牌
  // 每個面子至少需要3張牌，每個對子需要2張牌。
  // 這裡的 hand 參數是 *未成面子* 的手牌。
  if (hand.length < (meldsToFormFromHand * 3 + pairsToFormFromHand * 2)) {
    // 此條件需小心處理：如果 meldsToFormFromHand 或 pairsToFormFromHand < 0 (例如已有超過數量的面子/對子)，則此檢查可能不適用。
    // 確保 meldsToFormFromHand 和 pairsToFormFromHand 不為負
    if (meldsToFormFromHand >=0 && pairsToFormFromHand >=0) return { isWin: false };
  }


  // 初始呼叫遞迴函數，使用未成面子的手牌 (hand) 去湊齊剩餘的面子和對子
  const result = canFormWinningHand(hand, meldsToFormFromHand, pairsToFormFromHand);
  
  if (result.possible) { // 如果遞迴結果表示可以湊成胡牌牌型
    return { isWin: true, winningPair: result.pair, winningMelds: result.foundMelds };
  }

  // 如果所有嘗試都失敗
  return { isWin: false };
};
