
// 引入遊戲相關類型定義
import { GameState, Player, Tile, TileKind, Meld, GameActionPayload, Claim, GamePhase, AIExecutableAction, DiscardedTileInfo } from './types';
// 引入遊戲常數
import { TILE_KIND_DETAILS, ACTION_PRIORITY } from './constants';
// 引入遊戲規則相關的輔助函數
import { 
    canDeclareAnGang, 
    canDeclareMingGangFromHand, 
    checkWinCondition, 
    getChiOptions,
    countTilesOfKind // 計算手牌中特定牌的數量
} from './utils/gameRules';

/**
 * @description 判斷一張牌是否為「孤張」或「邊張」類型的牌 (此處根據 group 0 定義)。
 *              在象棋麻將中，兵/卒 (group 0) 可能類似於傳統麻將中的字牌，較難組成順子。
 * @param {TileKind} kind - 要判斷的牌的種類。
 * @returns {boolean} 如果是 group 0 (例如兵/卒)，返回 true，否則 false。
 */
const isIsolatedTileGroup = (kind: TileKind): boolean => {
  return TILE_KIND_DETAILS[kind].group === 0; 
};

/**
 * @description 預估一張牌對其他玩家的危險程度 (簡化版)。
 *              危險度越高，表示其他玩家可能越需要這張牌。
 * @param {Tile} tileToDiscard - 準備打出的牌。
 * @param {GameState} gameState - 當前的遊戲狀態。
 * @returns {number} 返回一個數字，代表預估的危險程度。
 */
const estimateTileDanger = (tileToDiscard: Tile, gameState: GameState): number => {
  let danger = 0; // 初始危險度
  // 檢查這張牌在棄牌堆中已出現的次數
  // 修改: 從 discardInfo.tile.kind 獲取牌的種類
  const occurrencesInDiscard = gameState.discardPile.filter(info => info.tile.kind === tileToDiscard.kind).length;

  // 棄牌堆中出現次數越少，代表越可能是生張，危險度越高
  if (occurrencesInDiscard === 0) danger += 6;      // 未見過，高度危險
  else if (occurrencesInDiscard === 1) danger += 3; // 已見一張，中度危險
  else if (occurrencesInDiscard === 2) danger += 1; // 已見兩張，相對安全

  // 象棋牌中，某些關鍵牌（將帥、車馬炮等，即非 group 0 的牌）通常更容易被其他玩家需要
  if (TILE_KIND_DETAILS[tileToDiscard.kind].group !== 0) {
    danger += 3; // 非兵卒牌，增加一些危險度
  }
  return danger;
};

/**
 * @description 獲取全局棄牌堆中每種牌的出現頻率。
 * @param {GameState} gameState - 當前的遊戲狀態。
 * @returns {Record<string, number>} 返回一個記錄，鍵為牌的種類 (string)，值為出現次數。
 */
const getGlobalDiscardFrequency = (gameState: GameState): Record<string, number> => {
  const frequencyMap: Record<string, number> = {}; // 初始化頻率映射
  // 修改: 從 discardInfo.tile.kind 獲取牌的種類
  gameState.discardPile.forEach(discardInfo => { // 遍歷棄牌堆
    frequencyMap[discardInfo.tile.kind] = (frequencyMap[discardInfo.tile.kind] || 0) + 1; // 累加計數
  });
  return frequencyMap;
};

/**
 * @description 根據牌型和遊戲狀態為一張準備打出的牌評分。
 *              分數越低，AI 越傾向於打出這張牌。
 * @param {Tile} tile - 準備評分的牌。
 * @param {Tile[]} hand - AI 當前完整的手牌 (包含 tile)。
 * @param {GameState} gameState - 當前的遊戲狀態。
 * @returns {number} 返回評分結果。
 */
const scoreTileForDiscard = (tile: Tile, hand: Tile[], gameState: GameState): number => {
  let score = 0; // 初始分數
  // 該牌在手中的數量
  const kindCountInHand = hand.filter(t => t.kind === tile.kind).length;

  // AI 策略：盡量保留多張相同的牌 (對子、刻子、槓子)
  if (kindCountInHand === 1) score -= 5;      // 孤張，傾向於打出 (分數降低)
  else if (kindCountInHand === 2) score += 5; // 對子，保留價值增加
  else if (kindCountInHand === 3) score += 15;// 刻子，保留價值更高
  else if (kindCountInHand === 4) score += 25;// 槓子，保留價值非常高

  // 檢查是否為潛在順子的一部分
  // 建立一個不包含當前 tile 的臨時手牌，用於檢查吃牌可能性
  const potentialChiHandContext = hand.filter(t => t.id !== tile.id); 
  // 如果打出 tile 後，手上剩餘的牌仍能與 tile 形成吃牌關係 (說明 tile 是順子的一部分)
  // 注意：此處 getChiOptions 的第二個參數是被吃的牌，所以若 tile 是順子中的一張，
  // 它的鄰牌被打出時，它才能被吃。此邏輯需要確認是否符合預期。
  // 更準確的可能是：檢查 tile 是否能與手牌中其他兩張組成順子。
  // 簡化：如果 tile 參與了任何可能的順子組合
  if (getChiOptions(potentialChiHandContext, tile).length > 0 || 
      TILE_KIND_DETAILS[tile.kind].group !== 0) { // 非兵卒牌更容易參與順子
    score += 8; // 作為順子的一部分，增加保留價值
  }

  // 牌本身的基礎價值 (orderValue 越高通常越重要)
  score += TILE_KIND_DETAILS[tile.kind].orderValue * 2;

  // 牌的危險度：危險度越高，打出此牌的風險越大。
  // 如果 score 代表“打出傾向性”(越低越好)，則危險度高應使 score 增加 (不傾向打出)
  score += estimateTileDanger(tile, gameState) * 2;

  // 安全牌邏輯：如果某牌在棄牌堆中已出現多次，則打出它相對安全
  const discardFrequency = getGlobalDiscardFrequency(gameState);
  if (discardFrequency[tile.kind]) {
    score -= discardFrequency[tile.kind] * 3; // 出現頻率越高，打出越安全 (打出傾向性增加，分數降低)
  }

  return score;
};

/**
 * @description AI 選擇一張最不重要 (評分最低) 的牌打出。
 * @param {Tile[]} tiles - AI 當前可打出的手牌。
 * @param {GameState} gameState - 當前的遊戲狀態。
 * @returns {Tile | null} 返回選擇的牌，如果手牌為空則返回 null。
 */
const chooseBestTileToDiscardAI = (tiles: Tile[], gameState: GameState): Tile | null => {
  if (tiles.length === 0) return null; // 手牌為空，無法打牌

  let bestTile: Tile | null = null; // 最佳選擇的牌
  let minScore = Infinity;         // 追蹤最低評分 (越低越適合打出)

  for (const tile of tiles) {
    const score = scoreTileForDiscard(tile, tiles, gameState); // 計算每張牌的打出評分
    if (score < minScore) { // 如果找到更低分的牌
      minScore = score;
      bestTile = tile;
    } else if (score === minScore) { // 如果分數相同
      // 優先打 orderValue 低的牌 (例如 象/相 比 將/帥 優先打出)
      if (bestTile && TILE_KIND_DETAILS[tile.kind].orderValue < TILE_KIND_DETAILS[bestTile.kind].orderValue) {
         bestTile = tile;
      } 
      // 若 orderValue 也相同，則優先打 group 0 的牌 (兵/卒)
      else if (bestTile && TILE_KIND_DETAILS[tile.kind].group === 0 && TILE_KIND_DETAILS[bestTile.kind].group !== 0) {
         bestTile = tile;
      }
    }
  }
  return bestTile || tiles[0]; // 如果遍歷後 bestTile 仍為 null (理論上不會)，則打出第一張作為備用
};


/**
 * @class AIService
 * @description 提供 AI 玩家在遊戲中進行決策的服務。
 */
export class AIService {

    /**
     * @description 決定 AI 是否及如何宣告其他玩家的棄牌。
     * @param {Player} aiPlayer - AI 玩家物件。
     * @param {Tile} discardedTile - 其他玩家打出的棄牌。
     * @param {GameState} gameState - 當前的遊戲狀態。
     * @returns {GameActionPayload | null} AI 決定的動作，如果跳過則為 PASS_CLAIM。
     */
    public getClaimForAI(aiPlayer: Player, discardedTile: Tile, gameState: GameState): GameActionPayload | null {
        // AI 檢查其 pendingClaims (由 GameRoom 計算並填充)
        // 優先順序：胡 > 槓 > 碰 > 吃

        // 檢查是否能胡牌
        const huClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Hu');
        if (huClaim) {
            console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 決定宣告 胡 ${discardedTile.kind}。`); // Log level adjusted
            return { type: 'DECLARE_HU' };
        }

        // 檢查是否能槓牌
        const gangClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Gang');
        if (gangClaim) { 
            console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 決定宣告 槓 ${discardedTile.kind}。`); // Log level adjusted
            return { type: 'CLAIM_GANG', tile: discardedTile };
        }

        // 檢查是否能碰牌
        const pengClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Peng');
        if (pengClaim) { 
            // AI 策略：如果碰牌會嚴重破壞手牌潛力，則可能跳過。此處簡化為總是碰。
            console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 決定宣告 碰 ${discardedTile.kind}。`); // Log level adjusted
            return { type: 'CLAIM_PENG', tile: discardedTile };
        }

        // 檢查是否能吃牌
        const chiClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Chi');
        if (chiClaim) {
            // 從 GameState 或 GameRoom 傳入的 chiOptions (已為此 AI 計算好的) 中選擇
            const actualChiOptions = gameState.chiOptions || getChiOptions(aiPlayer.hand, discardedTile); // 備用
            if (actualChiOptions && actualChiOptions.length > 0) {
                // AI 策略：選擇第一個可用的吃牌選項。更複雜的 AI 可以評估哪個更好。
                console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 決定宣告 吃 ${discardedTile.kind}，使用手牌 ${actualChiOptions[0].map(t => t.kind).join(', ')}。`); // Log level adjusted
                return { type: 'CLAIM_CHI', tilesToChiWith: actualChiOptions[0], discardedTile };
            }
        }
        // 如果沒有理想的宣告，則跳過
        console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 決定跳過對 ${discardedTile.kind} 的宣告。`); // Log level adjusted
        return { type: 'PASS_CLAIM' }; 
    }

    /**
     * @description 決定 AI 在摸牌前的行動 (例如暗槓、天胡)。
     * @param {Player} aiPlayer - AI 玩家物件。
     * @param {GameState} gameState - 當前的遊戲狀態。
     * @returns {GameActionPayload | null} AI 決定的動作，如果沒有則返回 null (表示準備摸牌)。
     */
    public getPreDrawActionForAI(aiPlayer: Player, gameState: GameState): GameActionPayload | null {
        // 檢查是否能暗槓 (手牌中已有四張相同)
        const anGangOptions = canDeclareAnGang(aiPlayer.hand, null); // drawnTile 為 null 表示檢查摸牌前
        if (anGangOptions.length > 0) {
            // AI 策略：目前如果可以就暗槓
            console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 摸牌前決定宣告 暗槓 ${anGangOptions[0]}。`); // Log level adjusted
            return { type: 'DECLARE_AN_GANG', tileKind: anGangOptions[0] };
        }

        // 檢查天胡 (莊家第一回合，發完牌直接胡)
        // 天胡的條件判斷應該在莊家發完初始牌後 (AWAITING_DISCARD 階段 for dealer)
        // 此處是 PLAYER_TURN_START，莊家可能已經打過第一張牌，所以天胡邏輯不在此。
        // 天胡通常是在發完牌後，打第一張牌前檢查。GameRoom.ts的startGameRound中處理。

        console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 摸牌前無特殊動作，準備摸牌。`); // Log level adjusted
        return null; 
    }

    /**
     * @description 決定 AI 在摸牌後的行動 (自摸、加槓、暗槓或打牌)。
     * @param {Player} aiPlayer - AI 玩家物件。
     * @param {Tile} drawnTile - AI 剛摸到的牌。
     * @param {GameState} gameState - 當前的遊戲狀態。
     * @returns {GameActionPayload | null} AI 決定的動作。必定返回一個動作 (胡或打牌)。
     */
    public getSelfDrawnActionForAI(aiPlayer: Player, drawnTile: Tile, gameState: GameState): GameActionPayload | null {
        // 組合完整手牌 (包含剛摸到的牌)
        const handWithDrawnTile = [...aiPlayer.hand, drawnTile];
      
        // 檢查是否能自摸
        if (checkWinCondition(handWithDrawnTile, aiPlayer.melds).isWin) {
            console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 摸到 ${drawnTile.kind} 後決定宣告 自摸。`); // Log level adjusted
            return { type: 'DECLARE_HU' }; 
        }

        // 檢查使用剛摸到的牌進行暗槓 (摸到第四張相同的)
        const anGangOptionsAfterDraw = canDeclareAnGang(aiPlayer.hand, drawnTile);
        if (anGangOptionsAfterDraw.length > 0) {
            console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 摸到 ${drawnTile.kind} 後決定宣告 暗槓 ${anGangOptionsAfterDraw[0]}。`); // Log level adjusted
            return { type: 'DECLARE_AN_GANG', tileKind: anGangOptionsAfterDraw[0] };
        }

        // 檢查使用剛摸到的牌進行加槓 (碰牌後摸到第四張)
        const mingGangOptionsAfterDraw = canDeclareMingGangFromHand(aiPlayer.hand, aiPlayer.melds, drawnTile);
        if (mingGangOptionsAfterDraw.length > 0) {
            console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 摸到 ${drawnTile.kind} 後決定宣告 加槓 ${mingGangOptionsAfterDraw[0].pengMeldKind}。`); // Log level adjusted
            return { type: 'DECLARE_MING_GANG_FROM_HAND', tileKind: mingGangOptionsAfterDraw[0].pengMeldKind };
        }
        
        // 如果沒有自摸或槓牌，則必須打出一張牌
        const tileToDiscard = chooseBestTileToDiscardAI(handWithDrawnTile, gameState);
        if (tileToDiscard) {
            console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 摸到 ${drawnTile.kind} 後，選擇打出 ${tileToDiscard.kind} (ID: ${tileToDiscard.id})。`); // Log level adjusted
            return { type: 'DISCARD_TILE', tileId: tileToDiscard.id };
        } else {
            // 這種情況理論上不應該發生，因為摸牌後手牌必定增加，總有牌可打
            console.error(`[AIService] 嚴重錯誤: AI ${aiPlayer.name} 摸牌後無牌可打! 手牌: ${JSON.stringify(handWithDrawnTile)}`); // Log level adjusted
            // 緊急備用方案：如果真的發生，打出剛摸的牌
            console.debug(`[AIService] (備用方案) AI ${aiPlayer.name} 打出剛摸到的牌 ${drawnTile.kind}。`); // Log level adjusted
            return { type: 'DISCARD_TILE', tileId: drawnTile.id };
        }
    }
    
    /**
     * @description 決定 AI 在宣告吃、碰、明槓之後需要打出的牌。
     * @param {Player} aiPlayer - AI 玩家物件。
     * @param {GameState} gameState - 當前的遊戲狀態。
     * @returns {GameActionPayload} AI 決定的打牌動作。
     * @throws {Error} 如果 AI 在面子操作後手牌為空 (應為胡牌或錯誤狀態)。
     */
    public getDiscardAfterMeldAI(aiPlayer: Player, gameState: GameState): GameActionPayload {
        if (aiPlayer.hand.length === 0) {
            // 宣告面子後手牌空了，這通常意味著遊戲結束 (例如槓上開花然後胡牌)，或者是一個錯誤狀態。
            // 此函數預期是選擇一張牌打出。
            console.error(`[AIService] 嚴重錯誤: AI ${aiPlayer.name} 在面子操作後手牌為空，無法打牌!`); // Log level adjusted
            throw new Error("AI 手牌為空，無法在面子操作後打牌，此應為胡牌或錯誤狀態。");
        }
        const tileToDiscard = chooseBestTileToDiscardAI(aiPlayer.hand, gameState);
        if (tileToDiscard) {
            console.debug(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 在面子操作後，選擇打出 ${tileToDiscard.kind}。`); // Log level adjusted
            return { type: 'DISCARD_TILE', tileId: tileToDiscard.id };
        } else {
            // 幾乎不可能發生，因為上面檢查了 hand.length > 0
            console.error(`[AIService] 嚴重錯誤: AI ${aiPlayer.name} 的 chooseBestTileToDiscardAI 返回 null，但手牌不為空: ${JSON.stringify(aiPlayer.hand)}`); // Log level adjusted
            // 最後的備用方案：打出手牌中的第一張
            console.debug(`[AIService] (備用方案) AI ${aiPlayer.name} 打出手牌中的第一張 ${aiPlayer.hand[0].kind}。`); // Log level adjusted
            return { type: 'DISCARD_TILE', tileId: aiPlayer.hand[0].id }; 
        }
    }

    /**
     * @description 供 GameRoom 調用，以獲取 AI 在當前遊戲狀態下的決策。
     *              GameRoom 會根據 gameState.gamePhase 和 currentPlayerIndex/playerMakingClaimDecision 來調用此函數。
     * @param {Player} aiPlayer - AI 玩家物件。
     * @param {GameState} gameState - 當前的遊戲狀態。
     * @returns {GameActionPayload} AI 決定的下一個動作。
     */
    public getNextAIMove(aiPlayer: Player, gameState: GameState): GameActionPayload {
        const { gamePhase, lastDiscardedTile, lastDrawnTile, currentPlayerIndex, playerMakingClaimDecision } = gameState;

        // 1. 處理宣告棄牌的邏輯
        //    當有棄牌，且輪到此 AI 決定是否宣告時
        if ((gamePhase === GamePhase.TILE_DISCARDED || 
             gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION || 
             gamePhase === GamePhase.AWAITING_CLAIMS_RESOLUTION) && 
            lastDiscardedTile &&
            playerMakingClaimDecision === aiPlayer.id) { // 確認是此 AI 在做宣告決定
            
            // 使用 getClaimForAI 函數獲取宣告動作，如果沒有則跳過
            return this.getClaimForAI(aiPlayer, lastDiscardedTile, gameState) || { type: 'PASS_CLAIM' };
        }

        // 2. AI 輪到自己回合的邏輯
        if (currentPlayerIndex === aiPlayer.id) { // 確認輪到此 AI 行動
            // 2a. 回合開始，準備摸牌 (或摸牌前宣告暗槓/天胡)
            if (gamePhase === GamePhase.PLAYER_TURN_START) {
                const preDrawAction = this.getPreDrawActionForAI(aiPlayer, gameState); // 檢查摸牌前動作
                if (preDrawAction) return preDrawAction; // 如果有摸牌前動作，執行它
                return { type: 'DRAW_TILE' }; // 否則，摸牌
            }

            // 2b. 已摸牌，決定是否自摸、槓牌，或打出一張牌
            if (gamePhase === GamePhase.PLAYER_DRAWN && lastDrawnTile) {
                // getSelfDrawnActionForAI 必定會返回一個動作 (胡牌或打牌)
                return this.getSelfDrawnActionForAI(aiPlayer, lastDrawnTile, gameState)!; 
            }

            // 2c. 等待出牌 (通常在吃/碰/槓之後，或莊家開局)
            if (gamePhase === GamePhase.AWAITING_DISCARD) {
                return this.getDiscardAfterMeldAI(aiPlayer, gameState);
            }
        }
        
        // 預設或錯誤狀態處理：AI 跳過
        console.warn(`[AIService] AI ${aiPlayer.name} (Seat: ${aiPlayer.id}) 在未預期的遊戲階段 (${gamePhase}) 被要求行動，或非其決策回合。將跳過。`); // Log level adjusted
        return { type: 'PASS_CLAIM' };
    }

    /**
     * @description 選擇一張牌給 AI 或離線玩家在超時後打出。
     * @param {Tile[]} hand - AI/離線玩家的當前手牌 (可能包含剛摸的牌)。
     * @param {GameState} gameState - 當前的遊戲狀態。
     * @returns {Tile | null} 選擇打出的牌，如果手牌為空則返回 null。
     */
    public chooseDiscardForTimeoutOrOffline(hand: Tile[], gameState: GameState): Tile | null {
        return chooseBestTileToDiscardAI(hand, gameState);
    }
}
