
// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { ServerPlayer } from '../Player';
import { Tile, TileKind, Claim, GamePhase } from '../types';
import { checkWinCondition, canMingGang, canPeng, getChiOptions } from '../utils/gameRules';
import { ACTION_PRIORITY, NUM_PLAYERS } from '../constants';
import * as TurnHandler from './turnHandler';
import * as PlayerActionHandler from './playerActionHandler';
import * as TimerManager from './timerManager'; // Import TimerManager

/**
 * @description 當一張牌被打出後，檢查其他玩家是否可以對其進行宣告 (胡、碰、槓、吃)。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {Tile} discardedTile - 被打出的牌。
 * @param {number} discarderId - 打出該牌的玩家ID。
 */
export const checkForClaims = (room: GameRoom, discardedTile: Tile, discarderId: number): void => {
    room.gameState.potentialClaims = [];
    room.players.forEach(player => {
        if (player.id === discarderId) return;

        player.pendingClaims = [];

        if (checkWinCondition([...player.hand, discardedTile], player.melds).isWin) {
            player.pendingClaims.push({ playerId: player.id, action: 'Hu', priority: ACTION_PRIORITY.HU, tiles: [discardedTile] });
        }
        if (canMingGang(player.hand, discardedTile)) {
            player.pendingClaims.push({ playerId: player.id, action: 'Gang', priority: ACTION_PRIORITY.GANG, tiles: [discardedTile] });
        }
        if (canPeng(player.hand, discardedTile)) {
            player.pendingClaims.push({ playerId: player.id, action: 'Peng', priority: ACTION_PRIORITY.PENG, tiles: [discardedTile] });
        }
        if (player.id === (discarderId + 1) % NUM_PLAYERS) {
            const chiOptions = getChiOptions(player.hand, discardedTile);
            if (chiOptions.length > 0) {
                player.pendingClaims.push({ playerId: player.id, action: 'Chi', priority: ACTION_PRIORITY.CHI, tiles: [discardedTile] });
                room.gameState.chiOptions = chiOptions;
            }
        }
        room.gameState.potentialClaims.push(...player.pendingClaims);
    });

    if (room.gameState.potentialClaims.length > 0) {
        room.gameState.gamePhase = GamePhase.AWAITING_CLAIMS_RESOLUTION;
        startClaimDecisionProcess(room);
    } else {
        room.addLog(`無人宣告 ${discardedTile.kind}。`);
        room.gameState.lastDiscardedTile = null;
        TurnHandler.advanceToNextPlayerTurn(room, true);
    }
    room.broadcastGameState();
};

/**
 * @description 開始宣告決策流程，按優先順序遍歷可宣告的玩家。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const startClaimDecisionProcess = (room: GameRoom): void => {
    room.gameState.potentialClaims.sort((a, b) => b.priority - a.priority);

    const highestPriorityClaim = room.gameState.potentialClaims[0];
    if (!highestPriorityClaim) {
        TurnHandler.advanceToNextPlayerTurn(room, true);
        return;
    }
    const highestPriorityClaims = room.gameState.potentialClaims.filter(
        claim => claim.priority === highestPriorityClaim.priority
    );

    if (highestPriorityClaim.action === 'Hu' && highestPriorityClaims.length > 1) {
        room.addLog(`一炮多響！玩家 ${highestPriorityClaims.map(c => `${room.players.find(p=>p.id===c.playerId)?.name}(${c.playerId})`).join(', ')} 均可胡牌 ${room.gameState.lastDiscardedTile!.kind}。`);
        highestPriorityClaims.forEach(huClaim => {
            PlayerActionHandler.processDeclareHu(room, huClaim.playerId);
        });
        return;
    }

    const playerToDecide = room.players.find(p => p.id === highestPriorityClaim.playerId);
    if (playerToDecide) {
        room.gameState.playerMakingClaimDecision = playerToDecide.id;
        room.gameState.gamePhase = GamePhase.AWAITING_PLAYER_CLAIM_ACTION;
        
        if (highestPriorityClaim.action === 'Chi') {
            room.gameState.chiOptions = getChiOptions(playerToDecide.hand, room.gameState.lastDiscardedTile!);
        } else {
            room.gameState.chiOptions = null;
        }

        room.addLog(`輪到 ${playerToDecide.name} (座位: ${playerToDecide.id}) 決定是否宣告 ${highestPriorityClaim.action} ${room.gameState.lastDiscardedTile!.kind}。`);
        TimerManager.startActionTimerForPlayer(room, playerToDecide.id); // Use TimerManager
        room.broadcastGameState();
        // AIHandler.processAITurnIfNeeded(room); // This will be called by GameRoom after player action
    } else {
        TurnHandler.advanceToNextPlayerTurn(room, true);
    }
};

/**
 * @description 清除所有玩家的待宣告動作、潛在宣告列表、正在做宣告決定的玩家標記、
 *              行動計時器以及吃牌選項。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const clearClaimsAndTimer = (room: GameRoom): void => {
    room.players.forEach(p => p.pendingClaims = []);
    room.gameState.potentialClaims = [];
    room.gameState.playerMakingClaimDecision = null;
    TimerManager.clearActionTimer(room); // Use TimerManager
    room.gameState.chiOptions = null;
};

/**
 * @description 處理無效宣告 (例如手牌不足)。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {ServerPlayer} player - 執行無效宣告的玩家。
 * @param {string} claimType - 無效宣告的類型 (例如 "Peng", "Chi")。
 */
export const handleInvalidClaim = (room: GameRoom, player: ServerPlayer, claimType: string): void => {
    room.addLog(`${player.name} (座位: ${player.id}) 宣告 ${claimType} 失敗 (條件不符)。`);
    if(player.socketId) room.io.to(player.socketId).emit('gameError', `您的 ${claimType} 宣告無效。`);
    PlayerActionHandler.processPassClaim(room, player.id);
};

/**
 * @description 從棄牌堆中消耗掉一張被面子 (碰、吃、槓) 使用的牌。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {string} tileId - 被消耗的牌的ID。
 */
export const consumeDiscardedTileForMeld = (room: GameRoom, tileId: string): void => {
    if (room.gameState.lastDiscardedTile && room.gameState.lastDiscardedTile.id === tileId) {
        room.gameState.discardPile.shift();
        room.gameState.lastDiscardedTile = null;
    } else {
        const indexToRemove = room.gameState.discardPile.findIndex(t => t.id === tileId);
        if (indexToRemove !== -1) {
            room.gameState.discardPile.splice(indexToRemove, 1);
        } else {
            console.warn(`[GameRoom ${room.roomId}] 嘗試消耗棄牌 ${tileId}，但在棄牌堆中未找到。`);
        }
    }
};
