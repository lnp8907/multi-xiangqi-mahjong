
// THIS SERVICE IS DEPRECATED.
// The AI decision-making logic has been moved to the server-side AIService.ts.
// The frontend no longer runs AI logic directly.
// This file can be safely removed.

/*
import { GameState, Player, GameActionPayload, Tile, TileKind, AIExecutableAction } from '../types';
import { checkWinCondition, getChiOptions, canDeclareAnGang, canDeclareMingGangFromHand, countTilesOfKind } from '../utils/gameRules';


const isHonorTile = (kind: TileKind): boolean => {
  return kind.startsWith('Z') || kind.startsWith('F'); 
};

const estimateTileDanger = (tileToDiscard: Tile, gameState: GameState): number => {
  let danger = 0;
  const occurrencesInDiscard = gameState.discardPile.filter(t => t.kind === tileToDiscard.kind).length;
  if (occurrencesInDiscard === 0) danger += 5;
  else if (occurrencesInDiscard === 1) danger += 3;
  else if (occurrencesInDiscard === 2) danger += 1;
  if (isHonorTile(tileToDiscard.kind)) danger += 4;
  return danger;
};

const getGlobalDiscardFrequency = (gameState: GameState): Record<string, number> => {
  const frequencyMap: Record<string, number> = {};
  gameState.discardPile.forEach(tile => {
    frequencyMap[tile.kind] = (frequencyMap[tile.kind] || 0) + 1;
  });
  return frequencyMap;
};

const getBestDiscardFromLLM = async (hand: Tile[], gameState: GameState): Promise<Tile | null> => {
  return null;
};

const scoreTileForDiscard = (tile: Tile, hand: Tile[], gameState: GameState): number => {
  let score = 0; 
  const kindCount = hand.filter(t => t.kind === tile.kind).length;
  if (kindCount > 1) score += kindCount * 10; 
  
  const potentialChiHand = hand.filter(t => t.id !== tile.id);
  if (getChiOptions(potentialChiHand, tile).length > 0) { 
    score += 5;
  }

  if (isHonorTile(tile.kind)) {
    score -= 5;
  }

  const dangerScore = estimateTileDanger(tile, gameState);
  score += dangerScore * 2;

  const discardFrequency = getGlobalDiscardFrequency(gameState);
  if (discardFrequency[tile.kind]) {
    score -= discardFrequency[tile.kind] * 3;
  }
  return score;
};

const chooseBestTileToDiscard = async (tiles: Tile[], gameState: GameState): Promise<Tile> => {
  const llmSuggestion = await getBestDiscardFromLLM(tiles, gameState);
  if (llmSuggestion) return llmSuggestion;
  if (tiles.length === 0) {
    throw new Error("AI沒有牌可以打。");
  }
  let bestTile = tiles[0];
  let minScore = Infinity;
  for (const tile of tiles) {
    const score = scoreTileForDiscard(tile, tiles, gameState);
    if (score < minScore) {
      minScore = score;
      bestTile = tile;
    } else if (score === minScore) {
      if (tile.id < bestTile.id) {
         bestTile = tile;
      }
    }
  }
  return bestTile;
};

export const getAIMove_DEPRECATED = async (gameState: GameState, aiPlayer: Player): Promise<AIExecutableAction> => {
  // ... (original AI logic here) ...
  return { type: 'PASS_CLAIM' }; // Placeholder
};
*/
console.warn("services/aiService.ts is deprecated and should be removed. AI logic is server-side.");
export {}; // To make this file a module.
