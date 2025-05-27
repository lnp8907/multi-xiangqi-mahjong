
// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { ServerPlayer } from '../Player';
import { Tile, TileKind, Claim, GamePhase, SubmittedClaim } from '../types';
import { checkWinCondition, canMingGang, canPeng, getChiOptions } from '../utils/gameRules';
import { ACTION_PRIORITY, NUM_PLAYERS, CLAIM_DECISION_TIMEOUT_SECONDS } from '../constants';
import * as TurnHandler from './turnHandler';
import * as PlayerActionHandler from './playerActionHandler';
import * as TimerManager from './timerManager'; // 標準導入 TimerManager
import * as AIHandler from './aiHandler'; 

/**
 * @description 當一張牌被打出後，檢查其他玩家是否可以對其進行宣告 (胡、碰、槓、吃)。
 *              如果存在宣告，則啟動全局宣告流程。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {Tile} discardedTile - 被打出的牌。
 * @param {number} discarderId - 打出該牌的玩家ID。
 */
export const checkForClaims = (room: GameRoom, discardedTile: Tile, discarderId: number): void => {
    room.gameState.potentialClaims = []; // 儲存所有玩家所有可能的宣告
    room.gameState.submittedClaims = []; // 清空上一輪提交的宣告
    room.gameState.chiOptions = null;    // 清除上一輪的吃牌選項

    let hasAnyClaim = false;

    room.players.forEach(player => {
        player.pendingClaims = []; // 清除該玩家上一輪的待處理宣告
        player.hasRespondedToClaim = false; // 重置回應狀態

        if (player.id === discarderId) return;

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
            const chiOptionsForThisPlayer = getChiOptions(player.hand, discardedTile);
            if (chiOptionsForThisPlayer.length > 0) {
                player.pendingClaims.push({ playerId: player.id, action: 'Chi', priority: ACTION_PRIORITY.CHI, tiles: [discardedTile] });
                // 將吃牌選項存儲到 gameState 中，供 UI 和 AI 決策使用
                room.gameState.chiOptions = chiOptionsForThisPlayer; 
            }
        }
        
        if (player.pendingClaims.length > 0) {
            hasAnyClaim = true;
            room.gameState.potentialClaims.push(...player.pendingClaims); // 收集所有潛在宣告
            
            // 如果是真人玩家且在線，通知其可用的宣告選項
            if (player.isHuman && player.isOnline && player.socketId) {
                let specificChiOptionsForEvent: Tile[][] | undefined;
                // 只有當是輪到吃牌的玩家，才可能傳遞 chiOptions
                if (player.id === (discarderId + 1) % NUM_PLAYERS) {
                    // 如果 room.gameState.chiOptions 不是 null，則賦值；否則 specificChiOptionsForEvent 保持 undefined
                    specificChiOptionsForEvent = room.gameState.chiOptions !== null ? room.gameState.chiOptions : undefined;
                } else {
                    specificChiOptionsForEvent = undefined; // 不是輪到吃牌的玩家，不傳遞 chiOptions
                }

                room.io.to(player.socketId).emit('availableClaimsNotification', { 
                    claims: player.pendingClaims || [], // 確保 claims 不為 undefined
                    chiOptions: specificChiOptionsForEvent // 現在確保是 Tile[][] 或 undefined
                });
            }
        }
    });

    if (hasAnyClaim) {
        room.gameState.gamePhase = GamePhase.AWAITING_ALL_CLAIMS_RESPONSE; // 新階段：等待所有玩家回應
        room.addLog(`棄牌 ${discardedTile.kind}。等待所有有宣告權的玩家回應...`);
        TimerManager.startGlobalClaimTimer(room); // 啟動全局宣告計時器

        // 觸發所有AI玩家立即決策
        room.players.forEach(p => {
            if ((!p.isHuman || !p.isOnline) && p.pendingClaims && p.pendingClaims.length > 0) {
                AIHandler.processAIClaimDecision(room, p); 
            }
        });

    } else {
        // 如果沒有人可以宣告
        room.addLog(`無人宣告 ${discardedTile.kind}。`);
        room.gameState.lastDiscardedTile = null; 
        TurnHandler.advanceToNextPlayerTurn(room, true); 
    }
    room.broadcastGameState(); 
};


/**
 * @description 收集完所有玩家的宣告決策 (或超時) 後，處理並裁決這些宣告。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const resolveAllSubmittedClaims = (room: GameRoom): void => {
    TimerManager.clearGlobalClaimTimer(room); // 清除全局計時器
    room.gameState.gamePhase = GamePhase.AWAITING_CLAIMS_RESOLUTION; // 進入裁決階段

    const actualClaims = room.gameState.submittedClaims.filter(sc => sc.action !== 'Pass');

    if (actualClaims.length === 0) {
        room.addLog("所有玩家選擇跳過宣告。");
        room.gameState.lastDiscardedTile = null;
        clearClaimsAndTimer(room); // 清理 submittedClaims 等
        TurnHandler.advanceToNextPlayerTurn(room, true);
        room.broadcastGameState();
        return;
    }

    // 按優先級排序 (Hu > Gang/Peng > Chi)
    actualClaims.sort((a, b) => {
        const priorityA = ACTION_PRIORITY[a.action.toUpperCase() as keyof typeof ACTION_PRIORITY] || 0;
        const priorityB = ACTION_PRIORITY[b.action.toUpperCase() as keyof typeof ACTION_PRIORITY] || 0;
        return priorityB - priorityA;
    });

    const highestPriorityAction = actualClaims[0].action;
    const highestPriorityLevel = ACTION_PRIORITY[highestPriorityAction.toUpperCase() as keyof typeof ACTION_PRIORITY];

    // 找出所有具有相同最高優先級的宣告
    const topPriorityClaims = actualClaims.filter(claim => 
        (ACTION_PRIORITY[claim.action.toUpperCase() as keyof typeof ACTION_PRIORITY] || 0) === highestPriorityLevel
    );

    if (highestPriorityAction === 'Hu' && topPriorityClaims.length > 0) {
        // 處理胡牌 (包括一炮多響)
        room.addLog(`胡牌宣告優先！玩家 ${topPriorityClaims.map(c => room.players.find(p=>p.id===c.playerId)?.name).join(', ')} 胡牌。`);
        let gameAlreadyEnded = false;
        topPriorityClaims.forEach(huClaim => {
            if (!gameAlreadyEnded) { // 防止因第一個胡牌導致遊戲結束後，後續胡牌邏輯出錯
                 const success = PlayerActionHandler.processDeclareHu(room, huClaim.playerId);
                 if (success && (room.gameState.gamePhase === GamePhase.ROUND_OVER || room.gameState.gamePhase === GamePhase.GAME_OVER)) {
                     gameAlreadyEnded = true;
                 }
            }
        });
        if (!gameAlreadyEnded) { // 如果胡牌宣告處理後遊戲未正常結束 (例如詐胡)
            room.addLog("胡牌宣告處理完畢，但遊戲未結束。可能為詐胡或多響後仍有流程。");
             // 如果所有胡牌都失敗了，需要有回退機制，例如讓下一個宣告者行動或推進回合
             // 這部分邏輯比較複雜，暫時簡化為如果胡牌都失敗，則認為無有效宣告
             // 實際上 processDeclareHu 內部會在詐胡時調用 processPassClaim，這會重新觸發宣告檢查或推進回合
        }
         clearClaimsAndTimer(room); // 清理
    } else if (topPriorityClaims.length > 0) {
        // 處理非胡牌的最高優先級宣告 (碰、槓、吃)
        // 由於碰/槓優先級高於吃，且不能同時發生，這裡取第一個即可 (已排序)
        const winningClaim = topPriorityClaims[0];
        const player = room.players.find(p => p.id === winningClaim.playerId);
        
        if (player && room.gameState.lastDiscardedTile) {
            room.addLog(`玩家 ${player.name} 的 ${winningClaim.action} 宣告優先。`);
            let success = false;
            switch (winningClaim.action) {
                case 'Gang':
                    success = PlayerActionHandler.processClaimGang(room, player.id, room.gameState.lastDiscardedTile);
                    break;
                case 'Peng':
                    success = PlayerActionHandler.processClaimPeng(room, player.id, room.gameState.lastDiscardedTile);
                    break;
                case 'Chi':
                    // 確保 chiCombination 存在
                    if (winningClaim.chiCombination) {
                        success = PlayerActionHandler.processClaimChi(room, player.id, winningClaim.chiCombination, room.gameState.lastDiscardedTile);
                    } else {
                        room.addLog(`錯誤：玩家 ${player.name} 嘗試吃牌但未提供組合。`);
                        PlayerActionHandler.processPassClaim(room, player.id); // 出錯則跳過
                    }
                    break;
            }
            if (!success && winningClaim.action !== 'Pass') { // 如果宣告執行失敗且不是主動Pass
                 PlayerActionHandler.processPassClaim(room, player.id);
            }
        } else {
            room.addLog("無法執行優先宣告，將推進回合。");
            clearClaimsAndTimer(room);
            TurnHandler.advanceToNextPlayerTurn(room, true);
        }
    } else {
        // 理論上不應到達此處，因為已檢查 actualClaims.length === 0
        room.addLog("無有效宣告被執行。");
        clearClaimsAndTimer(room);
        TurnHandler.advanceToNextPlayerTurn(room, true);
    }
    room.broadcastGameState();
};


/**
 * @description 清除所有與當前宣告流程相關的狀態。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const clearClaimsAndTimer = (room: GameRoom): void => {
    room.players.forEach(p => {
        p.pendingClaims = [];
        p.hasRespondedToClaim = false;
    });
    room.gameState.potentialClaims = [];
    room.gameState.submittedClaims = []; // 清除已提交的宣告
    room.gameState.playerMakingClaimDecision = null; // 此欄位可能不再主要使用
    TimerManager.clearGlobalClaimTimer(room); // 清除全局宣告計時器
    room.gameState.chiOptions = null;
};

/**
 * @description 處理無效宣告。在新模型下，此函數可能較少被直接調用，
 *              因為決策是先收集再統一處理。但可保留用於AI或特定錯誤場景。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {ServerPlayer} player - 執行無效宣告的玩家。
 * @param {string} claimType - 無效宣告的類型 (例如 "Peng", "Chi")。
 */
export const handleInvalidClaim = (room: GameRoom, player: ServerPlayer, claimType: string): void => {
    room.addLog(`${player.name} (座位: ${player.id}) 嘗試的 ${claimType} 宣告無效。`);
    if(player.socketId) room.io.to(player.socketId).emit('gameError', `您的 ${claimType} 宣告無效或條件不符。`);
    // 在新模型中，如果一個宣告在 resolveAllSubmittedClaims 中被認定為無效，
    // 應該從 submittedClaims 中移除或標記，然後重新評估次高優先級的宣告，
    // 而不是簡單地讓該玩家 PASS_CLAIM。
    // 但如果是在提交前客戶端就發送了無效請求，則此處直接讓其 PASS_CLAIM 可能是合理的。
    const existingSubmission = room.gameState.submittedClaims.find(sc => sc.playerId === player.id);
    if (!existingSubmission) { // 如果玩家還未提交過任何決策，則認為是主動跳過
        room.gameState.submittedClaims.push({ playerId: player.id, action: 'Pass' });
        // 檢查是否所有人都已回應
        const humanPlayersNeedingToRespond = room.players.filter(p =>
            p.isHuman && p.isOnline && (p.pendingClaims && p.pendingClaims.length > 0) && !p.hasRespondedToClaim
        );
        if (humanPlayersNeedingToRespond.length === 0) {
            resolveAllSubmittedClaims(room);
        }
    }
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
        const indexToRemove = room.gameState.discardPile.findIndex(info => info.tile.id === tileId);
        if (indexToRemove !== -1) {
            room.gameState.discardPile.splice(indexToRemove, 1); 
        } else {
            console.warn(`[ClaimHandler ${room.roomId}] 嘗試消耗棄牌 ${tileId}，但在棄牌堆中未找到。`);
        }
    }
};
