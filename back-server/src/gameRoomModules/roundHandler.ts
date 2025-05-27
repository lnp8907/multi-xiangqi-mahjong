// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { GamePhase, TileKind, Tile } from '../types';
import { INITIAL_HAND_SIZE_DEALER, INITIAL_HAND_SIZE_NON_DEALER, NEXT_ROUND_COUNTDOWN_SECONDS, DEFAULT_NUMBER_OF_ROUNDS, PLAYABLE_TILE_KINDS, TILES_PER_KIND, GamePhaseTranslations as Translations } from '../constants';
import { shuffleDeck, createInitialDeck, dealTiles, sortHandVisually } from '../utils/deckManager';
import * as MatchHandler from './matchHandler';
import * as TurnHandler from './turnHandler';
import * as AIHandler from './aiHandler'; // For processAITurnIfNeeded
import * as TimerManager from './timerManager'; // 引入計時器管理器
import * as ScoringHandler from './scoringHandler'; // 引入計分處理器


/**
 * @description 初始化或重置一局遊戲的狀態。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {boolean} isNewMatch - 是否為一場全新的比賽 (相對於開始下一局)。
 */
export const initializeOrResetGameForRound = (room: GameRoom, isNewMatch: boolean): void => {
    if (isNewMatch) {
        room.gameState.currentRound = 1;
        room.gameState.matchOver = false;
        room.players.forEach(p => p.score = 0);
        if (room.players.length > 0) {
            room.gameState.dealerIndex = Math.floor(Math.random() * room.players.length);
            room.players.forEach((p) => p.isDealer = (p.id === room.gameState.dealerIndex));
        } else {
            room.gameState.dealerIndex = 0;
        }
        room.addLog(`新比賽開始！共 ${room.gameState.numberOfRounds} 局。`);
    } else {
        if (room.players.length > 0) {
            if (room.gameState.winnerId === null || (room.gameState.winnerId !== null && room.gameState.winnerId !== room.gameState.dealerIndex)) {
                room.gameState.dealerIndex = (room.gameState.dealerIndex + 1) % room.players.length;
            }
            room.players.forEach((p) => p.isDealer = (p.id === room.gameState.dealerIndex));
        }
        room.addLog(`準備開始第 ${room.gameState.currentRound}/${room.gameState.numberOfRounds} 局。`);
    }
    room.gameState.roomName = room.roomSettings.roomName;
    room.gameState.configuredHumanPlayers = room.roomSettings.humanPlayers;
    room.gameState.configuredFillWithAI = room.roomSettings.fillWithAI;
    room.gameState.hostPlayerName = room.roomSettings.hostName;
    room.gameState.numberOfRounds = room.roomSettings.numberOfRounds;

    room.players.forEach((p) => {
        p.hand = [];
        p.melds = [];
        console.debug(`[GameRoom ${room.roomId}] 本局初始化: 玩家 ${p.id} (${p.name}) - 真人: ${p.isHuman}, 莊家: ${p.isDealer}`);
    });

    room.gameState.deck = shuffleDeck(createInitialDeck());
    room.gameState.discardPile = [];
    room.gameState.lastDiscardedTile = null;
    room.gameState.lastDrawnTile = null;
    room.gameState.turnNumber = 1;
    room.gameState.potentialClaims = [];
    room.gameState.winnerId = null;
    room.gameState.winningTileDiscarderId = null;
    room.gameState.winType = null;
    room.gameState.winningDiscardedTile = null;
    room.gameState.isDrawGame = false;
    room.gameState.chiOptions = null;
    room.gameState.playerMakingClaimDecision = null;
    TimerManager.clearActionTimer(room); // 改用 TimerManager
    TimerManager.clearNextRoundTimer(room); // 改用 TimerManager
    TimerManager.clearRematchTimer(room); // 改用 TimerManager
    room.gameState.humanPlayersReadyForNextRound = [];
    room.gameState.rematchVotes = [];

    room.sortPlayersById();
    room.updateGameStatePlayers();

    const { hands, remainingDeck } = dealTiles(
        room.gameState.deck,
        room.gameState.players,
        room.gameState.dealerIndex,
        INITIAL_HAND_SIZE_DEALER,
        INITIAL_HAND_SIZE_NON_DEALER
    );

    room.players.forEach((p) => {
        p.hand = sortHandVisually(hands[p.id]);
    });
    room.gameState.deck = remainingDeck;

    room.addLog("發牌完成。驗證手牌與剩餘牌堆...");
    console.debug(`[GameRoom ${room.roomId}] 第 ${room.gameState.currentRound} 局 - 發牌後驗證:`);
    const overallKindCounts = new Map<TileKind, number>();
    const allTilesInGameForIdCheck: Tile[] = [];

    room.players.forEach(p => {
        console.debug(`  玩家 ${p.id} (${p.name}) 手牌 (${p.hand.length} 張):`);
        allTilesInGameForIdCheck.push(...p.hand);
        const handKindCounts = new Map<TileKind, number>();
        const handTileIds = new Set<string>();
        p.hand.forEach(tile => {
            if (!tile || !tile.id || !tile.kind) {
                console.error(`    !!!! 嚴重錯誤 !!!! 玩家 ${p.id} (${p.name}) 手牌中發現無效的牌物件: ${JSON.stringify(tile)}`);
                room.addLog(`嚴重錯誤: 玩家 ${p.name} 手牌中發現無效牌!`);
                return;
            }
            handKindCounts.set(tile.kind, (handKindCounts.get(tile.kind) || 0) + 1);
            overallKindCounts.set(tile.kind, (overallKindCounts.get(tile.kind) || 0) + 1);
            if (handTileIds.has(tile.id)) {
                console.error(`    !!!! 嚴重錯誤 !!!! 玩家 ${p.id} (${p.name}) 手牌中出現重複ID的牌: ${tile.id} (${tile.kind})！`);
                room.addLog(`嚴重錯誤：玩家 ${p.name} 手牌中出現重複ID的牌: ${tile.id} (${tile.kind})！`);
            }
            handTileIds.add(tile.id);
        });
        handKindCounts.forEach((count, kind) => {
            console.debug(`    ${kind}: ${count}`);
            if (count > TILES_PER_KIND) {
                console.error(`    !!!! 嚴重錯誤 !!!! 玩家 ${p.id} (${p.name}) 手牌中出現 ${count} 張 ${kind}！`);
                room.addLog(`嚴重錯誤：玩家 ${p.name} 手牌中出現 ${count} 張 ${kind}！`);
            }
        });
    });

    console.debug(`  剩餘牌堆 (${room.gameState.deck.length} 張):`);
    allTilesInGameForIdCheck.push(...room.gameState.deck);
    const deckKindCounts = new Map<TileKind, number>();
    room.gameState.deck.forEach(tile => {
        if (!tile || !tile.id || !tile.kind) {
            console.error(`    !!!! 嚴重錯誤 !!!! 牌堆中發現無效的牌物件: ${JSON.stringify(tile)}`);
            room.addLog(`嚴重錯誤: 牌堆中發現無效牌!`);
            return;
        }
        deckKindCounts.set(tile.kind, (deckKindCounts.get(tile.kind) || 0) + 1);
        overallKindCounts.set(tile.kind, (overallKindCounts.get(tile.kind) || 0) + 1);
    });
    deckKindCounts.forEach((count, kind) => {
        console.debug(`    ${kind}: ${count}`);
    });

    console.debug(`  遊戲中各種牌的總數 (手牌 + 牌堆):`);
    let allOverallKindCountsCorrect = true;
    PLAYABLE_TILE_KINDS.forEach(kind => {
        const totalCount = overallKindCounts.get(kind) || 0;
        console.debug(`    ${kind}: ${totalCount}`);
        if (totalCount !== TILES_PER_KIND) {
            console.error(`    !!!! 嚴重錯誤 !!!! ${kind} 的總數為 ${totalCount}，應為 ${TILES_PER_KIND}。`);
            room.addLog(`嚴重錯誤：遊戲中 ${kind} 總數為 ${totalCount}，應為 ${TILES_PER_KIND}！`);
            allOverallKindCountsCorrect = false;
        }
    });
    if (allOverallKindCountsCorrect) {
        console.debug(`  所有牌的種類總數已驗證正確。`);
    } else {
        console.error(`  所有牌的種類總數驗證失敗。`);
    }

    console.debug(`  驗證遊戲中所有牌的ID唯一性...`);
    const allEncounteredTileIds = new Set<string>();
    let duplicateIdFoundOverall = false;
    for (const tile of allTilesInGameForIdCheck) {
        if (!tile || !tile.id) continue;
        if (allEncounteredTileIds.has(tile.id)) {
            console.error(`    !!!! 嚴重錯誤 !!!! 遊戲中檢測到重複的牌ID: ${tile.id} (${tile.kind})`);
            room.addLog(`嚴重錯誤：遊戲中檢測到重複的牌ID: ${tile.id} (${tile.kind})`);
            duplicateIdFoundOverall = true;
        }
        allEncounteredTileIds.add(tile.id);
    }
    if (!duplicateIdFoundOverall) {
        console.debug(`  所有牌的ID已驗證唯一。總獨立ID數: ${allEncounteredTileIds.size} (理論應為 ${PLAYABLE_TILE_KINDS.length * TILES_PER_KIND})`);
    } else {
        console.error(`  所有牌的ID唯一性驗證失敗。`);
    }

    room.updateGameStatePlayers();

    room.gameState.currentPlayerIndex = room.gameState.dealerIndex;
    const dealerPlayer = room.players.find(p => p.id === room.gameState.dealerIndex);

    if(!dealerPlayer) {
        console.error(`[GameRoom ${room.roomId}] 嚴重錯誤: 發牌後找不到莊家 (ID: ${room.gameState.dealerIndex})。遊戲無法繼續。`);
        room.addLog("嚴重錯誤：找不到莊家，遊戲無法繼續。");
        room.gameState.isDrawGame = true;
        handleRoundEndFlow(room);
        room.broadcastGameState();
        return;
    }

    room.addLog(`莊家是 ${dealerPlayer.name} (${dealerPlayer.isHuman ? '真人' : 'AI'}, 座位: ${dealerPlayer.id})。`);

    if (dealerPlayer.hand.length === INITIAL_HAND_SIZE_DEALER && dealerPlayer.hand.length > 0) {
        room.gameState.lastDrawnTile = dealerPlayer.hand[dealerPlayer.hand.length - 1];
        room.gameState.gamePhase = GamePhase.AWAITING_DISCARD;
        room.addLog(`輪到莊家 ${dealerPlayer.name} (座位: ${dealerPlayer.id}) 打牌。`);
    } else {
        room.gameState.gamePhase = GamePhase.PLAYER_TURN_START;
        room.addLog(`輪到 ${dealerPlayer.name} (座位: ${dealerPlayer.id}) 摸牌。`);
    }

    room.broadcastGameState();
    TimerManager.startActionTimerForPlayer(room, room.gameState.currentPlayerIndex); // 改用 TimerManager
    AIHandler.processAITurnIfNeeded(room);
};


/**
 * @description 開始一局新遊戲 (可以是全新比賽的第一局，或比賽中的下一局)。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {boolean} isNewMatch - 是否為全新比賽。
 */
export const startGameRound = (room: GameRoom, isNewMatch: boolean): void => {
    TimerManager.clearRematchTimer(room); // 改用 TimerManager
    room.gameState.rematchVotes = [];

    if (!isNewMatch && room.gameState.currentRound >= (room.roomSettings.numberOfRounds || DEFAULT_NUMBER_OF_ROUNDS)) {
        MatchHandler.handleMatchEnd(room);
        return;
    }
    if (!isNewMatch) {
        room.gameState.currentRound++;
    }

    room.gameState.gamePhase = GamePhase.DEALING;
    initializeOrResetGameForRound(room, isNewMatch);
};

/**
 * @description 處理一局遊戲結束後的流程 (胡牌或流局)。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const handleRoundEndFlow = (room: GameRoom): void => {
    TimerManager.clearActionTimer(room); // 改用 TimerManager
    AIHandler.clearAiActionTimeout(room);
    room.gameState.gamePhase = GamePhase.ROUND_OVER;

    ScoringHandler.calculateAndApplyScores(room); // 使用 ScoringHandler 處理計分
    
    room.updateGameStatePlayers();

    if (room.gameState.currentRound >= (room.roomSettings.numberOfRounds || DEFAULT_NUMBER_OF_ROUNDS)) {
        MatchHandler.handleMatchEnd(room);
    } else {
        room.addLog(`準備進入下一局。`);
        TimerManager.startNextRoundTimer(room); // 改用 TimerManager 啟動下一局倒數
    }
    room.broadcastGameState(); // 確保在啟動計時器後廣播一次包含倒數時間的狀態
};

/**
 * @description 處理玩家確認準備好下一局的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 確認的玩家ID。
 * @returns {boolean} 動作是否成功。
 */
export const processPlayerConfirmNextRound = (room: GameRoom, playerId: number): boolean => {
    if (room.gameState.gamePhase !== GamePhase.ROUND_OVER) {
        console.warn(`[GameRoom ${room.roomId}] 玩家 ${playerId} 嘗試在非 ROUND_OVER 階段確認下一局。`);
        return false;
    }
    if (!room.gameState.humanPlayersReadyForNextRound.includes(playerId)) {
        room.gameState.humanPlayersReadyForNextRound.push(playerId);
        room.addLog(`玩家 (ID: ${playerId}) 已確認準備好下一局。`);
        room.broadcastGameState();

        const onlineHumanPlayers = room.players.filter(p => p.isHuman && p.isOnline);
        if (onlineHumanPlayers.length > 0 &&
            onlineHumanPlayers.every(p => room.gameState.humanPlayersReadyForNextRound.includes(p.id))) {
            room.addLog("所有在線真人玩家已確認，提前開始下一局。");
            TimerManager.clearNextRoundTimer(room); // 改用 TimerManager
            startGameRound(room, false);
        }
    }
    return true;
};

// clearNextRoundTimer 函數已移至 timerManager.ts
