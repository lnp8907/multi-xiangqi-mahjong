
import { GameState, Player, Tile, TileKind, Meld, GameActionPayload, Claim, GamePhase, AIExecutableAction } from './types';
import { TILE_KIND_DETAILS, ACTION_PRIORITY } from './constants';
import { 
    canDeclareAnGang, 
    canDeclareMingGangFromHand, 
    checkWinCondition, 
    getChiOptions,
    countTilesOfKind
} from './utils/gameRules';

// 判斷是否為字牌（對象棋牌可能意義不大，保留作為潛在擴展點）
const isHonorTile = (kind: TileKind): boolean => {
  // 對於象棋麻將，可以定義哪些牌算 "重要牌" 或 "邊張牌"
  // 目前的 TILE_KIND_DETAILS 中 group: 0 (兵卒) 可能類似於字牌的孤張價值
  return TILE_KIND_DETAILS[kind].group === 0; 
};

// 預估一張牌對其他玩家的危險程度（簡化版）
const estimateTileDanger = (tileToDiscard: Tile, gameState: GameState): number => {
  let danger = 0;
  const occurrencesInDiscard = gameState.discardPile.filter(t => t.kind === tileToDiscard.kind).length;

  if (occurrencesInDiscard === 0) danger += 5;
  else if (occurrencesInDiscard === 1) danger += 3;
  else if (occurrencesInDiscard === 2) danger += 1;

  // 象棋牌中，某些關鍵牌（將帥、車馬炮等）可能一直都很危險
  // 此處簡化，假設 group 1 和 2 的牌比 group 0 (兵卒) 更容易被需要
  if (TILE_KIND_DETAILS[tileToDiscard.kind].group !== 0) {
    danger += 2;
  }
  return danger;
};

// 獲取全局棄牌堆中每種牌的出現頻率
const getGlobalDiscardFrequency = (gameState: GameState): Record<string, number> => {
  const frequencyMap: Record<string, number> = {};
  gameState.discardPile.forEach(tile => {
    frequencyMap[tile.kind] = (frequencyMap[tile.kind] || 0) + 1;
  });
  return frequencyMap;
};

// 根據牌型給出簡單評分（分數越低越適合打出）
const scoreTileForDiscard = (tile: Tile, hand: Tile[], gameState: GameState): number => {
  let score = 0; 
  const kindCountInHand = hand.filter(t => t.kind === tile.kind).length;

  // 盡量保留多張相同的牌
  if (kindCountInHand === 1) score -= 5; // 孤張，傾向於打出
  else if (kindCountInHand === 2) score += 5; // 對子，有點價值
  else if (kindCountInHand === 3) score += 15; // 刻子，很有價值
  else if (kindCountInHand === 4) score += 25; // 槓子，非常有價值

  // 檢查是否為潛在順子的一部分
  const potentialChiHand = hand.filter(t => t.id !== tile.id); 
  if (getChiOptions(potentialChiHand, tile).length > 0) { 
    score += 8; // 是順子的一部分，增加保留價值
  }

  // 牌本身的價值 (orderValue 越高通常越重要)
  score += TILE_KIND_DETAILS[tile.kind].orderValue * 2;

  // 危險度，危險度越高，打出分數應越低 (如果AI策略是避免放槍)
  // 但此處 score 代表保留價值，所以危險度高 -> 保留價值低
  // score -= estimateTileDanger(tile, gameState) * 2;

  // 或者，如果 score 代表“打出這張牌的傾向性”（越低越傾向打出）
  // 孤張 score 初始較低，對子刻子較高
  // 順子一部分 score 較高 (不傾向打出)
  // 基礎價值 (orderValue) score 較高
  // 危險度高 score 較高 (不傾向打出)
  score += estimateTileDanger(tile, gameState) * 2;


  // 安全牌邏輯：如果某牌在棄牌堆中出現多次，則打出它相對安全
  const discardFrequency = getGlobalDiscardFrequency(gameState);
  if (discardFrequency[tile.kind]) {
    score -= discardFrequency[tile.kind] * 3; // 出現頻率越高，打出越安全 (分數降低)
  }

  return score;
};

// 選擇最不重要的一張牌打出
const chooseBestTileToDiscardAI = (tiles: Tile[], gameState: GameState): Tile | null => {
  if (tiles.length === 0) return null;

  let bestTile: Tile | null = null;
  let minScore = Infinity; // AI 想打出的牌，分數越低越好

  for (const tile of tiles) {
    // 此處 scoreTileForDiscard 的實現是：分數越低越適合打出
    const score = scoreTileForDiscard(tile, tiles, gameState);
    if (score < minScore) {
      minScore = score;
      bestTile = tile;
    } else if (score === minScore) {
      // 分數相同時的決勝負規則，例如優先打 orderValue 低的，或 group 0 的
      if (bestTile && TILE_KIND_DETAILS[tile.kind].orderValue < TILE_KIND_DETAILS[bestTile.kind].orderValue) {
         bestTile = tile;
      } else if (bestTile && TILE_KIND_DETAILS[tile.kind].group < TILE_KIND_DETAILS[bestTile.kind].group) {
         bestTile = tile;
      }
    }
  }
  return bestTile || tiles[0]; // Fallback
};


export class AIService {

    // 決定 AI 是否及如何宣告其他玩家的棄牌
    public getClaimForAI(aiPlayer: Player, discardedTile: Tile, gameState: GameState): GameActionPayload | null {
        // AI 使用其在 GameRoom 中計算的 pendingClaims
        const huClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Hu');
        if (huClaim) {
            return { type: 'DECLARE_HU' };
        }

        const gangClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Gang');
        if (gangClaim) { 
            return { type: 'CLAIM_GANG', tile: discardedTile };
        }

        const pengClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Peng');
        if (pengClaim) { 
            // 策略：如果碰牌會嚴重破壞手牌潛力，則可能跳過。此處簡化為總是碰。
            return { type: 'CLAIM_PENG', tile: discardedTile };
        }

        const chiClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Chi');
        if (chiClaim) {
            const actualChiOptions = getChiOptions(aiPlayer.hand, discardedTile);
            if (actualChiOptions.length > 0) {
                // AI 策略：選擇第一個可用的吃牌選項。更複雜的 AI 可以評估哪個更好。
                // 此處的 tilesToChiWith 應該是 AI 手中的兩張牌
                return { type: 'CLAIM_CHI', tilesToChiWith: actualChiOptions[0], discardedTile };
            }
        }
        return { type: 'PASS_CLAIM' }; // 如果沒有理想的宣告，則跳過
    }

    // 決定 AI 在摸牌前的行動 (例如暗槓)
    public getPreDrawActionForAI(aiPlayer: Player, gameState: GameState): GameActionPayload | null {
        const anGangOptions = canDeclareAnGang(aiPlayer.hand, null); // drawnTile 為 null
        if (anGangOptions.length > 0) {
            // AI 策略：目前如果可以就暗槓
            return { type: 'DECLARE_AN_GANG', tileKind: anGangOptions[0] };
        }
        // 可以在此加入天胡檢查 (gameState.turnNumber === 1 && aiPlayer.isDealer && checkWinCondition(...))
        // 但天胡通常是在摸牌後（發了8張）決定是否胡，所以可能放在 getSelfDrawnActionForAI 處理初始手牌
        return null; // 沒有摸牌前動作，則準備摸牌
    }

    // 決定 AI 在摸牌後的行動 (自摸、加槓、暗槓或打牌)
    public getSelfDrawnActionForAI(aiPlayer: Player, drawnTile: Tile, gameState: GameState): GameActionPayload | null {
        const handWithDrawnTile = [...aiPlayer.hand, drawnTile];
      
        if (checkWinCondition(handWithDrawnTile, aiPlayer.melds).isWin) {
            return { type: 'DECLARE_HU' }; // 自摸
        }

        // 檢查使用剛摸到的牌進行暗槓
        const anGangOptionsAfterDraw = canDeclareAnGang(aiPlayer.hand, drawnTile);
        if (anGangOptionsAfterDraw.length > 0) {
            return { type: 'DECLARE_AN_GANG', tileKind: anGangOptionsAfterDraw[0] };
        }

        // 檢查使用剛摸到的牌進行加槓
        const mingGangOptionsAfterDraw = canDeclareMingGangFromHand(aiPlayer.hand, aiPlayer.melds, drawnTile);
        if (mingGangOptionsAfterDraw.length > 0) {
            return { type: 'DECLARE_MING_GANG_FROM_HAND', tileKind: mingGangOptionsAfterDraw[0].pengMeldKind };
        }
        
        // 如果沒有自摸或槓牌，則必須打出一張牌
        const tileToDiscard = chooseBestTileToDiscardAI(handWithDrawnTile, gameState);
        if (tileToDiscard) {
            return { type: 'DISCARD_TILE', tileId: tileToDiscard.id };
        } else {
            // 這種情況不應該發生，因為摸牌後手牌必定增加
            console.error(`[AIService] AI ${aiPlayer.name} 摸牌後無牌可打! 手牌: ${JSON.stringify(handWithDrawnTile)}`);
            // 緊急備用方案：如果真的發生，打出剛摸的牌
            return { type: 'DISCARD_TILE', tileId: drawnTile.id };
        }
    }
    
    // 決定 AI 在宣告吃碰槓後需要打出的牌
    public getDiscardAfterMeldAI(aiPlayer: Player, gameState: GameState): GameActionPayload {
        if (aiPlayer.hand.length === 0) {
            // 宣告後手牌空了，這通常意味著遊戲結束 (例如槓上開花然後胡牌)，或者是一個錯誤狀態
            console.error(`[AIService] AI ${aiPlayer.name} 在面子操作後手牌為空，無法打牌!`);
            // 這裡需要一個合理的後備，但正常遊戲流程不應如此。
            // 如果遊戲規則允許，這可能是胡牌。但此函數預期是打牌。
            // 暫時返回一個 pass，雖然這在 AWAITING_DISCARD 階段是無效的。GameRoom需要處理這種情況。
            // GameRoom 應該在這種情況下結束回合或遊戲。
            throw new Error("AI has no tiles to discard after meld, this should be a win or error state.");
        }
        const tileToDiscard = chooseBestTileToDiscardAI(aiPlayer.hand, gameState);
        if (tileToDiscard) {
            return { type: 'DISCARD_TILE', tileId: tileToDiscard.id };
        } else {
            // 幾乎不可能發生，因為上面檢查了 hand.length > 0
            console.error(`[AIService] AI ${aiPlayer.name} chooseBestTileToDiscardAI 返回 null，手牌: ${JSON.stringify(aiPlayer.hand)}`);
            return { type: 'DISCARD_TILE', tileId: aiPlayer.hand[0].id }; // 最後的備用
        }
    }

    /**
     * 供 GameRoom 調用，以獲取 AI 在當前遊戲狀態下的決策。
     * GameRoom 會根據 gameState.gamePhase 和 currentPlayerIndex/playerMakingClaimDecision 來調用此函數。
     */
    public getNextAIMove(aiPlayer: Player, gameState: GameState): GameActionPayload {
        const { gamePhase, lastDiscardedTile, lastDrawnTile, currentPlayerIndex, playerMakingClaimDecision } = gameState;

        // 處理宣告棄牌的邏輯
        if ((gamePhase === GamePhase.TILE_DISCARDED || 
             gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION || 
             gamePhase === GamePhase.AWAITING_CLAIMS_RESOLUTION) && // AWAITING_CLAIMS_RESOLUTION 階段 AI 也可能需要響應
            lastDiscardedTile &&
            playerMakingClaimDecision === aiPlayer.id) {
            
            return this.getClaimForAI(aiPlayer, lastDiscardedTile, gameState) || { type: 'PASS_CLAIM' };
        }

        // AI 輪到自己回合的邏輯
        if (currentPlayerIndex === aiPlayer.id) {
            if (gamePhase === GamePhase.PLAYER_TURN_START) {
                const preDrawAction = this.getPreDrawActionForAI(aiPlayer, gameState);
                if (preDrawAction) return preDrawAction;
                return { type: 'DRAW_TILE' }; // 如果沒有摸牌前動作，就摸牌
            }

            if (gamePhase === GamePhase.PLAYER_DRAWN && lastDrawnTile) {
                return this.getSelfDrawnActionForAI(aiPlayer, lastDrawnTile, gameState)!; // ! 因為 getSelfDrawnActionForAI 總會返回一個動作 (胡或打牌)
            }

            if (gamePhase === GamePhase.AWAITING_DISCARD) {
                // 此階段通常在 AI 宣告碰/吃/明槓之後，現在必須從其手牌中打出一張。
                // 或者莊家初始手牌8張，等待打出第一張。
                return this.getDiscardAfterMeldAI(aiPlayer, gameState);
            }
        }
        
        // 預設或錯誤狀態處理：AI 跳過
        console.warn(`[AIService] AI ${aiPlayer.name} 在未預期的遊戲階段 ${gamePhase} 被要求行動，或非其決策回合。將跳過。`);
        return { type: 'PASS_CLAIM' };
    }
}
