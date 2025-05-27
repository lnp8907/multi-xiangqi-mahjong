// 引入類型和常數
import { GameRoom } from '../GameRoom';
// Fix: Changed import path for ServerPlayer
import { ServerPlayer } from '../Player'; 
import { GamePhase, GameActionPayload } from '../types';
import { AI_THINK_TIME_MS_MAX, AI_THINK_TIME_MS_MIN } from '../constants';
import * as PlayerActionHandler from './playerActionHandler';

/**
 * @description 檢查並處理AI玩家的行動 (如果輪到AI或離線玩家)。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const processAITurnIfNeeded = (room: GameRoom): void => {
    // 如果此房間已有一個 AI 行動的 setTimeout 在等待，則清除它。
    // 這樣可以確保如果此函數因某些原因被快速連續調用，只有最新的調度會生效。
    if (room.aiActionTimeoutId) {
        clearTimeout(room.aiActionTimeoutId);
        room.aiActionTimeoutId = null;
    }

    let aiPlayerToAct: ServerPlayer | undefined = undefined; // 明確類型為 ServerPlayer | undefined

    // 根據當前遊戲階段和決策者，判斷是否需要 AI 行動
    if (room.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && room.gameState.playerMakingClaimDecision !== null) {
        const player = room.players.find(p => p.id === room.gameState.playerMakingClaimDecision);
        if (player && (!player.isHuman || !player.isOnline) ) {
            aiPlayerToAct = player as ServerPlayer; // 類型斷言
        }
    }
    else if (
        (room.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
         room.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
         room.gameState.gamePhase === GamePhase.AWAITING_DISCARD) &&
        room.gameState.currentPlayerIndex !== null // 確保 currentPlayerIndex 不是 null
    ) {
        const player = room.players.find(p => p.id === room.gameState.currentPlayerIndex);
        if (player && (!player.isHuman || !player.isOnline) ) {
            aiPlayerToAct = player as ServerPlayer; // 類型斷言
        }
    }

    if (aiPlayerToAct) {
        const currentAIPlayer = aiPlayerToAct; // 捕獲當前要行動的 AI 玩家到閉包
        const thinkTime = Math.random() * (AI_THINK_TIME_MS_MAX - AI_THINK_TIME_MS_MIN) + AI_THINK_TIME_MS_MIN;

        room.addLog(`輪到 ${currentAIPlayer.name} (${currentAIPlayer.isHuman ? '離線真人':'AI'}, 座位: ${currentAIPlayer.id}) 行動 (思考 ${thinkTime.toFixed(0)}ms)，遊戲階段: ${room.gameState.gamePhase}`);
        console.debug(`[AIHandler ${room.roomId}] Scheduling AI/Offline player ${currentAIPlayer.name} (Seat: ${currentAIPlayer.id}) action for phase ${room.gameState.gamePhase} in ${thinkTime.toFixed(0)}ms.`);

        // 創建一個新的 setTimeout，並獲取其 ID
        const newTimeoutId = setTimeout(() => {
            // 關鍵檢查：只有當這個特定的 timeout 實例仍然是房間當前活動的 AI timeout 時才繼續。
            // 這樣可以防止被後續 processAITurnIfNeeded 調用所取代的舊 timeout 執行動作。
            if (room.aiActionTimeoutId !== newTimeoutId) {
                console.debug(`[AIHandler ${room.roomId}] AI action for ${currentAIPlayer.name} (Timeout ID ${newTimeoutId}) was superseded or cleared. Current active AI timeout ID: ${room.aiActionTimeoutId}.`);
                return;
            }

            let stillAIsTurn = false;
            // 再次確認是否仍然輪到此 AI 行動
            if (room.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && room.gameState.playerMakingClaimDecision === currentAIPlayer.id) {
                stillAIsTurn = true;
            } else if ((room.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
                         room.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
                         room.gameState.gamePhase === GamePhase.AWAITING_DISCARD) &&
                        room.gameState.currentPlayerIndex === currentAIPlayer.id) {
                stillAIsTurn = true;
            }

            if (stillAIsTurn) {
                console.debug(`[AIHandler ${room.roomId}] AI/Offline player ${currentAIPlayer.name} (Seat: ${currentAIPlayer.id}) is now executing its action. Timeout ID ${newTimeoutId}.`);
                const action = room.aiService.getNextAIMove(currentAIPlayer, room.getGameState());
                // room.addLog(`${currentAIPlayer.name} (${currentAIPlayer.isHuman ? '離線真人':'AI'}) 執行動作: ${action.type}`); // 日誌移到 handleAIAction 或具體處理函數中
                handleAIAction(room, currentAIPlayer.id, action);
            } else {
                console.debug(`[AIHandler ${room.roomId}] AI/Offline player ${currentAIPlayer.name} (Seat: ${currentAIPlayer.id})'s turn was preempted or game state changed. Action not executed. Timeout ID ${newTimeoutId}. Phase: ${room.gameState.gamePhase}, DecisionMaker: ${room.gameState.playerMakingClaimDecision}, CurrentPlayer: ${room.gameState.currentPlayerIndex}`);
            }

            // 一旦這個 timeout 完成了它的工作（無論是否執行了動作），
            // 如果它仍然是房間記錄的活動 timeout，則清除它。
            if (room.aiActionTimeoutId === newTimeoutId) {
                room.aiActionTimeoutId = null;
            }

        }, thinkTime);

        // 將新創建的 timeout ID 存儲到房間實例上，表示這是當前活動的 AI 行動計時器。
        room.aiActionTimeoutId = newTimeoutId;
    } else {
        // 如果當前沒有 AI 需要行動，確保清除任何可能存在的舊的 room.aiActionTimeoutId。
        // （儘管在函數開頭已經這樣做了，但為了邏輯清晰性再次確認）
        if (room.aiActionTimeoutId) {
            clearTimeout(room.aiActionTimeoutId);
            room.aiActionTimeoutId = null;
            console.debug(`[AIHandler ${room.roomId}] No AI needs to act currently. Ensured AI timeout is cleared.`);
        }
    }
};

/**
 * @description 處理AI玩家或離線玩家的遊戲動作。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} aiPlayerId - AI/離線玩家的ID。
 * @param {GameActionPayload} action - AI/離線玩家執行的動作。
 */
export const handleAIAction = (room: GameRoom, aiPlayerId: number, action: GameActionPayload): void => {
    const aiPlayer = room.players.find(p => p.id === aiPlayerId);
    if (!aiPlayer) { console.error(`[AIHandler ${room.roomId}] handleAIAction: AI/離線玩家 ${aiPlayerId} 未找到。`); return; }

    console.debug(`[AIHandler ${room.roomId}] AI/離線玩家 ${aiPlayer.name} (座位: ${aiPlayer.id}) 執行動作: ${action.type}`, JSON.stringify(action).substring(0,100));
    let actionIsValid = true;

    try {
        switch (action.type) {
            case 'DRAW_TILE': actionIsValid = PlayerActionHandler.processDrawTile(room, aiPlayerId); break;
            case 'DISCARD_TILE': actionIsValid = PlayerActionHandler.processDiscardTile(room, aiPlayerId, action.tileId); break;
            case 'DECLARE_HU': actionIsValid = PlayerActionHandler.processDeclareHu(room, aiPlayerId); break;
            case 'CLAIM_PENG': actionIsValid = PlayerActionHandler.processClaimPeng(room, aiPlayerId, action.tile); break;
            case 'CLAIM_GANG': actionIsValid = PlayerActionHandler.processClaimGang(room, aiPlayerId, action.tile); break;
            case 'CLAIM_CHI': actionIsValid = PlayerActionHandler.processClaimChi(room, aiPlayerId, action.tilesToChiWith, action.discardedTile); break;
            case 'DECLARE_AN_GANG': actionIsValid = PlayerActionHandler.processDeclareAnGang(room, aiPlayerId, action.tileKind); break;
            case 'DECLARE_MING_GANG_FROM_HAND': actionIsValid = PlayerActionHandler.processDeclareMingGangFromHand(room, aiPlayerId, action.tileKind); break;
            case 'PASS_CLAIM': actionIsValid = PlayerActionHandler.processPassClaim(room, aiPlayerId); break;
            default:
                console.warn(`[AIHandler ${room.roomId}] AI/離線玩家執行了未處理的動作類型:`, (action as any).type);
                actionIsValid = false;
        }
    } catch (error) {
        console.error(`[AIHandler ${room.roomId}] AI/離線玩家動作 ${action.type} 處理時發生錯誤:`, error);
        actionIsValid = false;
    }

    if (actionIsValid) {
        // 如果 AI 動作有效，則再次調用 processAITurnIfNeeded，
        // 以便在遊戲狀態改變後，檢查是否有下一個 AI 需要行動（例如，槓上開花後的摸牌，或者輪到下一個 AI）。
        processAITurnIfNeeded(room);
    } else {
        room.addLog(`AI/離線玩家 ${aiPlayer.name} (座位: ${aiPlayer.id}) 嘗試的動作 ${action.type} 無效或失敗。`);
        console.error(`[AIHandler ${room.roomId}] AI/離線玩家 ${aiPlayer.name} 的動作 ${action.type} 無效。遊戲階段: ${room.gameState.gamePhase}`);

        // 如果 AI 的宣告動作無效 (例如詐胡)，且不是主動 PASS_CLAIM，則讓 AI 強制 PASS_CLAIM。
        if (room.gameState.playerMakingClaimDecision === aiPlayerId && action.type !== 'PASS_CLAIM') {
            room.addLog(`AI/離線玩家 ${aiPlayer.name} (座位: ${aiPlayer.id}) 因無效宣告 ${action.type} 而自動跳過。`);
            PlayerActionHandler.processPassClaim(room, aiPlayerId); // 這会進一步觸發 processAITurnIfNeeded
        } else if ( (room.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
                     room.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
                     room.gameState.gamePhase === GamePhase.AWAITING_DISCARD) &&
                    room.gameState.currentPlayerIndex === aiPlayerId
        ) {
            // 如果是 AI 自己的回合行動失敗 (例如打牌邏輯錯誤)，這裡需要一個回退機制。
            // 目前，如果打牌失敗，processDiscardTile 會返回 false，這裡會記錄錯誤。
            // 理想情況下，AI 應該總是能選擇一個有效的棄牌。
            // 如果 AI 在自己的回合卡住，可能需要一個更強的超時或錯誤恢復機制，但暫時依賴於 AI 邏輯的正確性。
            console.error(`[AIHandler ${room.roomId}] AI ${aiPlayer.name} 在其主要回合行動失敗 (${action.type})，遊戲可能卡住。`);
            room.addLog(`嚴重警告：AI ${aiPlayer.name} 在其回合行動 ${action.type} 失敗。`);
            // 暫時不自動處理，依賴於 AI Service 內部邏輯的健壯性。若持續卡住，需要更深層的 AI 錯誤處理。
        }
    }
};

/**
 * @description 清除AI行動的延遲計時器。
 *              此函數主要由外部模組調用，例如當人類玩家行動時，
 *              或者遊戲進入明確不需要等待 AI 延遲的階段（如回合結束）。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const clearAiActionTimeout = (room: GameRoom): void => {
    if (room.aiActionTimeoutId) {
        clearTimeout(room.aiActionTimeoutId);
        room.aiActionTimeoutId = null;
        console.debug(`[AIHandler ${room.roomId}] AI 行動延遲計時器已被外部清除。`);
    }
};