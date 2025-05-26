
// FIX: 引入 Tile 類型
// FIX: 引入 AIExecutableAction 並將其用作 getAIMove 的返回類型
import { GameState, Player, GameAction, TileKind, GamePhase, Tile, AIExecutableAction, Meld } from '../types'; // 引入相關類型定義
import { checkWinCondition, getChiOptions, canDeclareAnGang, canDeclareMingGangFromHand, countTilesOfKind } from '../utils/gameRules'; // 引入遊戲規則相關函數

// 此服務目前為進階規則型 AI 的實作，未來可改為大型語言模型控制策略。

// 判斷是否為字牌（風牌、箭牌）
const isHonorTile = (kind: TileKind): boolean => {
  // 這是典型的麻將分類。對於象棋牌，可能需要調整
  // 如果「字牌」的概念不同或不適用。
  // 假設 TileKind 字串可能遵循類似 'Z_EAST' 的模式來表示字牌。
  // 對於象棋棋子，這可能意味著主棋子與兵卒的區別，或需要特定的種類檢查。
  // 鑑於目前的 TileKind 列舉 (將、士等)，若無對應關係，此預設邏輯可能不是很有用。
  return kind.startsWith('Z') || kind.startsWith('F'); // 基於常見麻將的預留位置
};

// 預估一張牌對其他玩家的危險程度（簡化版）
// FIX: 修改為使用全域棄牌堆，因為 Player 類型沒有 'discardPile' 屬性。
const estimateTileDanger = (tileToDiscard: Tile, gameState: GameState): number => {
  let danger = 0;
  const occurrencesInDiscard = gameState.discardPile.filter(t => t.kind === tileToDiscard.kind).length;

  // 在棄牌堆中出現次數較少，表示其他人可能更需要它。
  if (occurrencesInDiscard === 0) {
    danger += 5; // 尚未出現，危險性最高
  } else if (occurrencesInDiscard === 1) {
    danger += 3; // 出現過一次
  } else if (occurrencesInDiscard === 2) {
    danger += 1; // 出現過兩次，危險性較低
  }
  // 如果出現 3 次以上，則認為相對安全 (此因素危險度 += 0)。

  if (isHonorTile(tileToDiscard.kind)) {
    // 如果場上字牌不多，則字牌通常較危險。
    danger += 4;
  }
  return danger;
};

// FIX: 從 estimateOpponentWaits 改名並修改為使用全域棄牌堆。
// 此函數現在計算全域棄牌堆中每種牌出現的頻率。
const getGlobalDiscardFrequency = (gameState: GameState): Record<string, number> => {
  const frequencyMap: Record<string, number> = {};
  gameState.discardPile.forEach(tile => {
    frequencyMap[tile.kind] = (frequencyMap[tile.kind] || 0) + 1;
  });
  return frequencyMap;
};

// 街口：未來將接入 OpenAI API，分析出牌最佳選擇
// TODO: 實作 GPT API 接口，傳送局面資訊與候選牌，回傳建議出牌
const getBestDiscardFromLLM = async (hand: Tile[], gameState: GameState): Promise<Tile | null> => {
  return null; // 預留接口：尚未實作
};

// 根據牌型給出簡單評分（加入防守與對手聽牌機率）
const scoreTileForDiscard = (tile: Tile, hand: Tile[], gameState: GameState): number => {
  let score = 0; // 分數越低越適合打出
  const kindCount = hand.filter(t => t.kind === tile.kind).length;
  if (kindCount > 1) score += kindCount * 10; // 優先保留對子/刻子/多張相同的牌。分數越高 = 越不該打出。
  
  // 檢查 'tile' 是否為手牌中潛在順子的一部分。
  // 這會檢查如果 'tile' 是被吃的那張棄牌，剩餘的手牌是否能與 'tile' 組成吃。
  // 這表示 'tile' 是手牌中三張連續牌的一部分，或可能是。
  const potentialChiHand = hand.filter(t => t.id !== tile.id); // 不含 'tile' 的手牌
  if (getChiOptions(potentialChiHand, tile).length > 0) { 
    score += 5; // 牌是順子的一部分，較不適合打出 (分數較高)。
  }

  // 基於 charAt(1) 的原始排序邏輯不適用於像 '將'、'士' 這樣的象棋牌種類。
  // TILE_KIND_DETAILS.orderValue 或 group 可能更適合象棋。
  // 目前，這部分邏輯可能影響很小或需要調整。
  // 讓我們假設一個通用的「中間值」概念。
  // const rank = parseInt(tile.kind.charAt(1)); // 這有問題。
  // if (!isNaN(rank) && rank >= 3 && rank <= 7) score += 2; // 中間數字的牌更有價值。

  if (isHonorTile(tile.kind)) { // 如果 'isHonorTile' 針對象棋主要棋子進行了調整。
    score -= 5; // 字牌 (如果這樣定義) 若是孤張，可能較適合早期打出 (分數較低)。
  }

  const dangerScore = estimateTileDanger(tile, gameState);
  // FIX: 如果 dangerScore 高，表示該牌危險，因此其分數應增加，使其較不適合打出。
  // score 越高代表越不應該打出
  score += dangerScore * 2; 

  // 如果某種牌經常被其他玩家打出 (即「安全牌」)，則 AI 較適合打出。
  const discardFrequency = getGlobalDiscardFrequency(gameState);
  if (discardFrequency[tile.kind]) {
    // 如果 discardFrequency[tile.kind] 高，則此牌較安全。
    // 因此，降低其分數，使其成為更具吸引力的棄牌。
    score -= discardFrequency[tile.kind] * 3; // 出現頻率越高 -> 分數越低 -> 越適合打出。
  }

  return score;
};

// 選擇最不重要的一張牌打出（加入防守與模擬）
const chooseBestTileToDiscard = async (tiles: Tile[], gameState: GameState): Promise<Tile> => {
  const llmSuggestion = await getBestDiscardFromLLM(tiles, gameState);
  if (llmSuggestion) return llmSuggestion;

  if (tiles.length === 0) {
    // 這種情況應由呼叫邏輯來避免，但作為安全措施。
    console.error("AI 錯誤: chooseBestTileToDiscard 被呼叫時傳入空的牌陣列。");
    // 根據遊戲規則，這可能需要特定動作或表示存在錯誤。
    // 目前，由於這是此函數的無效狀態，因此拋出錯誤。
    throw new Error("AI 沒有牌可以打。");
  }

  let bestTile = tiles[0];
  let minScore = Infinity;

  for (const tile of tiles) {
    const score = scoreTileForDiscard(tile, tiles, gameState);
    if (score < minScore) {
      minScore = score;
      bestTile = tile;
    } else if (score === minScore) {
      // 決勝負：一致的決勝負規則較好。
      // 例如，優先打出 ID 較小的牌，或根據牌種類的字典順序。
      if (tile.id < bestTile.id) { // 假設 ID 允許有意義的比較以進行決勝負。
         bestTile = tile;
      }
    }
  }
  return bestTile;
};

// 獲取 AI 玩家行動的主邏輯函式
export const getAIMove = async (gameState: GameState, aiPlayer: Player): Promise<AIExecutableAction> => {
  // ✅ 如果輪到 AI 做決定，AI 會回應棄牌。
  if ((gameState.gamePhase === GamePhase.TILE_DISCARDED || 
       gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION || 
       gameState.gamePhase === GamePhase.AWAITING_CLAIMS_RESOLUTION) &&
      gameState.lastDiscardedTile &&
      gameState.playerMakingClaimDecision === aiPlayer.id) {
    
    const discardedTile = gameState.lastDiscardedTile;
    
    // AI 使用其預先計算的 pendingClaims。
    const aiHuClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Hu');
    if (aiHuClaim) {
      return { type: 'DECLARE_HU' };
    }

    const aiGangClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Gang');
    if (aiGangClaim) { 
      return { type: 'CLAIM_GANG', tile: discardedTile };
    }

    const aiPengClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Peng');
    if (aiPengClaim) { 
      return { type: 'CLAIM_PENG', tile: discardedTile };
    }

    const aiChiClaim = (aiPlayer.pendingClaims || []).find(c => c.action === 'Chi');
    if (aiChiClaim) {
        // reducer 會為真人玩家設定 chiOptions。對於 AI，它有一個 'Chi' 宣告。
        // AI 需要決定使用其手牌和棄牌中的哪種吃牌組合。
        const actualChiOptions = getChiOptions(aiPlayer.hand, discardedTile);
        if (actualChiOptions.length > 0) {
            // AI 僅選擇第一個可用的吃牌選項。更複雜的 AI 可以進行選擇。
            return { type: 'CLAIM_CHI', tilesToChiWith: actualChiOptions[0], discardedTile };
        }
    }
    // 如果 AI 有待處理的宣告但未行動 (例如，策略性跳過，或未找到上述有效的吃牌選項)，
    // 或者如果沒有根據宣告採取特定行動，AI 將跳過。
    return { type: 'PASS_CLAIM' };
  }

  // 自己回合階段：摸牌、暗槓、自摸、加槓、出牌
  if (gameState.currentPlayerIndex === aiPlayer.id) {
    if (gameState.gamePhase === GamePhase.PLAYER_TURN_START) {
      // 摸牌前檢查暗槓。
      const anGangOptions = canDeclareAnGang(aiPlayer.hand, null); // drawnTile 為 null，因為這是摸牌前。
      if (anGangOptions.length > 0) {
        // AI 可能有何時暗槓的策略。目前，如果可能就宣告。
        return { type: 'DECLARE_AN_GANG', tileKind: anGangOptions[0] };
      }
      return { type: 'DRAW_TILE' };
    }

    if (gameState.gamePhase === GamePhase.PLAYER_DRAWN) {
      const drawnTile = gameState.lastDrawnTile; // 這是 AI 剛摸到的牌。
      const fullHand = drawnTile ? [...aiPlayer.hand, drawnTile] : [...aiPlayer.hand];
      
      if (checkWinCondition(fullHand, aiPlayer.melds).isWin) {
        return { type: 'DECLARE_HU' }; // 自摸胡牌。
      }

      const anGangOptions = canDeclareAnGang(aiPlayer.hand, drawnTile);
      if (anGangOptions.length > 0) {
        return { type: 'DECLARE_AN_GANG', tileKind: anGangOptions[0] };
      }

      if (drawnTile) {
        const mingGangOptions = canDeclareMingGangFromHand(aiPlayer.hand, aiPlayer.melds, drawnTile);
        if (mingGangOptions.length > 0) {
          return { type: 'DECLARE_MING_GANG_FROM_HAND', tileKind: mingGangOptions[0].pengMeldKind };
        }
      }
      
      if (fullHand.length === 0) { 
          console.error("AI 錯誤: 摸牌後 fullHand 中沒有牌可以打。");
          return { type: 'PASS_CLAIM' }; // 後備方案，儘管可能對遊戲流程造成問題。
      }
      const tileToDiscard = await chooseBestTileToDiscard(fullHand, gameState);
      return { type: 'DISCARD_TILE', tileId: tileToDiscard.id };
    }

    if (gameState.gamePhase === GamePhase.AWAITING_DISCARD) {
      // 此階段發生在 AI 宣告碰/吃/槓之後，現在必須從其手牌中打出一張。
      if (aiPlayer.hand.length > 0) {
        const tileToDiscard = await chooseBestTileToDiscard(aiPlayer.hand, gameState);
        return { type: 'DISCARD_TILE', tileId: tileToDiscard.id };
      } else {
        console.error(`AI 錯誤: ${aiPlayer.name} 處於 AWAITING_DISCARD 階段，但手中沒有牌。`);
        // 此狀態有問題。AI 必須打牌。在此情況下，跳過不是有效的遊戲動作。
        // 如果走到這一步且 reducer 未處理 PASS_CLAIM，遊戲可能會掛起或崩潰。
        // 為求穩健，理想情況下不應達到此處或應由特定的錯誤動作處理。
        // 返回 PASS_CLAIM 作為避免未處理 promise 拒絕的最後手段，但這不是遊戲的解決方案。
        return { type: 'PASS_CLAIM' }; 
      }
    }
  }

  // 如果未滿足其他條件或 AI 處於意外狀態，則執行預設動作。
  // 如果 AI *必須* 行動 (例如打牌)，此 PASS_CLAIM 可能會有問題。
  return { type: 'PASS_CLAIM' };
};