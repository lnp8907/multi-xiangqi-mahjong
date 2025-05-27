// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { ServerPlayer } from '../Player';
import { Tile, TileKind, Claim, GamePhase } from '../types';
import { checkWinCondition, canMingGang, canPeng, getChiOptions } from '../utils/gameRules';
import { ACTION_PRIORITY, NUM_PLAYERS } // 確保 NUM_PLAYERS 已引入
from '../constants';
import * as TurnHandler from './turnHandler';
import * as PlayerActionHandler from './playerActionHandler';
import * as TimerManager from './timerManager';
import * as AIHandler from './aiHandler'; // 引入 AIHandler

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

        // 檢查胡牌
        if (checkWinCondition([...player.hand, discardedTile], player.melds).isWin) {
            player.pendingClaims.push({ playerId: player.id, action: 'Hu', priority: ACTION_PRIORITY.HU, tiles: [discardedTile] });
        }
        // 檢查明槓
        if (canMingGang(player.hand, discardedTile)) {
            player.pendingClaims.push({ playerId: player.id, action: 'Gang', priority: ACTION_PRIORITY.GANG, tiles: [discardedTile] });
        }
        // 檢查碰牌
        if (canPeng(player.hand, discardedTile)) {
            player.pendingClaims.push({ playerId: player.id, action: 'Peng', priority: ACTION_PRIORITY.PENG, tiles: [discardedTile] });
        }
        // 檢查吃牌 (只有下家可以吃)
        if (player.id === (discarderId + 1) % NUM_PLAYERS) {
            const chiOptions = getChiOptions(player.hand, discardedTile);
            if (chiOptions.length > 0) {
                player.pendingClaims.push({ playerId: player.id, action: 'Chi', priority: ACTION_PRIORITY.CHI, tiles: [discardedTile] }); // tiles 欄位在此僅為標記，實際吃的牌在 chiOptions
                // 將吃牌選項存儲到 gameState 中，供 UI 和 AI 決策使用
                room.gameState.chiOptions = chiOptions;
            }
        }
        // 將該玩家所有可能的宣告加入到房間的潛在宣告列表中
        room.gameState.potentialClaims.push(...player.pendingClaims);
    });

    // 如果有任何潛在的宣告
    if (room.gameState.potentialClaims.length > 0) {
        room.gameState.gamePhase = GamePhase.AWAITING_CLAIMS_RESOLUTION; // 設定遊戲階段為等待宣告處理
        startClaimDecisionProcess(room); // 開始宣告決策流程
    } else {
        // 如果沒有人可以宣告
        room.addLog(`無人宣告 ${discardedTile.kind}。`);
        room.gameState.lastDiscardedTile = null; // 清除上一張棄牌的記錄
        TurnHandler.advanceToNextPlayerTurn(room, true); // 推進到下一個玩家的回合 (true 表示是在棄牌後)
    }
    room.broadcastGameState(); // 廣播遊戲狀態更新
};

/**
 * @description 開始宣告決策流程，按優先順序遍歷可宣告的玩家。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const startClaimDecisionProcess = (room: GameRoom): void => {
    // 對潛在宣告按優先順序排序 (高優先序在前)
    room.gameState.potentialClaims.sort((a, b) => b.priority - a.priority);

    const highestPriorityClaim = room.gameState.potentialClaims[0];
    if (!highestPriorityClaim) { // 如果沒有宣告 (理論上在 checkForClaims 已處理，此處為防禦)
        TurnHandler.advanceToNextPlayerTurn(room, true);
        return;
    }
    // 找出所有與最高優先序相同的宣告 (例如多個玩家可以胡同一張牌)
    const highestPriorityClaims = room.gameState.potentialClaims.filter(
        claim => claim.priority === highestPriorityClaim.priority
    );

    // 處理一炮多響 (多個玩家胡同一張牌)
    if (highestPriorityClaim.action === 'Hu' && highestPriorityClaims.length > 1) {
        room.addLog(`一炮多響！玩家 ${highestPriorityClaims.map(c => `${room.players.find(p=>p.id===c.playerId)?.name}(${c.playerId})`).join(', ')} 均可胡牌 ${room.gameState.lastDiscardedTile!.kind}。`);
        // 讓所有胡牌的玩家都執行胡牌動作
        highestPriorityClaims.forEach(huClaim => {
            PlayerActionHandler.processDeclareHu(room, huClaim.playerId);
        });
        // 胡牌後遊戲通常會結束或進入下一局，由 processDeclareHu -> handleRoundEndFlow 處理
        return; // 完成一炮多響處理
    }

    // 如果不是一炮多響，則選擇第一個最高優先序的宣告者
    const playerToDecide = room.players.find(p => p.id === highestPriorityClaim.playerId);
    if (playerToDecide) {
        room.gameState.playerMakingClaimDecision = playerToDecide.id; // 設定正在做決定的玩家
        room.gameState.gamePhase = GamePhase.AWAITING_PLAYER_CLAIM_ACTION; // 設定遊戲階段
        
        // 如果是吃牌，確保 chiOptions 更新
        if (highestPriorityClaim.action === 'Chi') {
            room.gameState.chiOptions = getChiOptions(playerToDecide.hand, room.gameState.lastDiscardedTile!);
        } else {
            room.gameState.chiOptions = null; // 其他宣告清除吃牌選項
        }

        room.addLog(`輪到 ${playerToDecide.name} (座位: ${playerToDecide.id}) 決定是否宣告 ${highestPriorityClaim.action} ${room.gameState.lastDiscardedTile!.kind}。`);
        TimerManager.startActionTimerForPlayer(room, playerToDecide.id); // 為真人玩家啟動UI計時器
        room.broadcastGameState(); // 廣播狀態

        // *** 新增：如果輪到 AI 玩家做宣告決定，則立即觸發其思考流程 ***
        if (!playerToDecide.isHuman || !playerToDecide.isOnline) {
            AIHandler.processAITurnIfNeeded(room);
        }
    } else {
        // 理論上 playerToDecide 應該總能找到，如果找不到則跳過並推進回合
        console.warn(`[ClaimHandler ${room.roomId}] 在 startClaimDecisionProcess 中未找到玩家 ID: ${highestPriorityClaim.playerId}。`);
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
    TimerManager.clearActionTimer(room); // 使用 TimerManager 清除計時器
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
    // 玩家宣告無效後，應自動為其執行 PASS_CLAIM
    PlayerActionHandler.processPassClaim(room, player.id);
};

/**
 * @description 從棄牌堆中消耗掉一張被面子 (碰、吃、槓) 使用的牌。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {string} tileId - 被消耗的牌的ID。
 */
export const consumeDiscardedTileForMeld = (room: GameRoom, tileId: string): void => {
    // 檢查是否為最新棄牌
    if (room.gameState.lastDiscardedTile && room.gameState.lastDiscardedTile.id === tileId) {
        room.gameState.discardPile.shift(); // 從棄牌堆頂部移除
        room.gameState.lastDiscardedTile = null; // 清除最新棄牌標記
    } else {
        // 如果不是最新棄牌 (理論上不應發生在常規碰吃槓流程，除非有特殊規則或錯誤)
        const indexToRemove = room.gameState.discardPile.findIndex(info => info.tile.id === tileId);
        if (indexToRemove !== -1) {
            room.gameState.discardPile.splice(indexToRemove, 1); // 從棄牌堆中移除
        } else {
            console.warn(`[ClaimHandler ${room.roomId}] 嘗試消耗棄牌 ${tileId}，但在棄牌堆中未找到。`);
        }
    }
};
