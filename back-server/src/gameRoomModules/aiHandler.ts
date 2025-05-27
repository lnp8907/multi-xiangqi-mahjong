
// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { ServerPlayer } from '../Player'; 
import { GamePhase, GameActionPayload, SubmittedClaim } from '../types';
import { AI_THINK_TIME_MS_MAX, AI_THINK_TIME_MS_MIN } from '../constants';
import * as PlayerActionHandler from './playerActionHandler';

/**
 * @description 檢查並處理AI玩家的行動 (如果輪到AI或離線玩家的回合內行動)。
 *              宣告階段的AI行動由 processAIClaimDecision 處理。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const processAITurnIfNeeded = (room: GameRoom): void => {
    if (room.aiActionTimeoutId) {
        clearTimeout(room.aiActionTimeoutId);
        room.aiActionTimeoutId = null;
    }

    let aiPlayerToAct: ServerPlayer | undefined = undefined;

    // 只處理AI的回合內行動 (摸牌、打牌、自摸、暗槓、加槓)
    if (
        (room.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
         room.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
         room.gameState.gamePhase === GamePhase.AWAITING_DISCARD) &&
        room.gameState.currentPlayerIndex !== null
    ) {
        const player = room.players.find(p => p.id === room.gameState.currentPlayerIndex);
        if (player && (!player.isHuman || !player.isOnline) ) {
            aiPlayerToAct = player as ServerPlayer; 
        }
    }

    if (aiPlayerToAct) {
        const currentAIPlayer = aiPlayerToAct; 
        const thinkTime = Math.random() * (AI_THINK_TIME_MS_MAX - AI_THINK_TIME_MS_MIN) + AI_THINK_TIME_MS_MIN;

        room.addLog(`輪到 ${currentAIPlayer.name} (${currentAIPlayer.isHuman ? '離線真人':'AI'}, 座位: ${currentAIPlayer.id}) 行動 (思考 ${thinkTime.toFixed(0)}ms)，遊戲階段: ${room.gameState.gamePhase}`);
        console.debug(`[AIHandler ${room.roomId}] Scheduling AI/Offline player ${currentAIPlayer.name} (Seat: ${currentAIPlayer.id}) turn action for phase ${room.gameState.gamePhase} in ${thinkTime.toFixed(0)}ms.`);

        const newTimeoutId = setTimeout(() => {
            if (room.aiActionTimeoutId !== newTimeoutId) {
                console.debug(`[AIHandler ${room.roomId}] AI turn action for ${currentAIPlayer.name} (Timeout ID ${newTimeoutId}) was superseded or cleared. Current active AI timeout ID: ${room.aiActionTimeoutId}.`);
                return;
            }

            let stillAIsTurn = false;
            if ((room.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
                 room.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
                 room.gameState.gamePhase === GamePhase.AWAITING_DISCARD) &&
                room.gameState.currentPlayerIndex === currentAIPlayer.id) {
                stillAIsTurn = true;
            }

            if (stillAIsTurn) {
                console.debug(`[AIHandler ${room.roomId}] AI/Offline player ${currentAIPlayer.name} (Seat: ${currentAIPlayer.id}) is now executing its turn action. Timeout ID ${newTimeoutId}.`);
                // getNextAIMove 應該能處理回合內的所有決策，包括摸牌、打牌、自摸等
                const action = room.aiService.getNextAIMove(currentAIPlayer, room.getGameState());
                handleAIAction(room, currentAIPlayer.id, action);
            } else {
                console.debug(`[AIHandler ${room.roomId}] AI/Offline player ${currentAIPlayer.name} (Seat: ${currentAIPlayer.id})'s turn was preempted or game state changed. Turn Action not executed. Timeout ID ${newTimeoutId}. Phase: ${room.gameState.gamePhase}, CurrentPlayer: ${room.gameState.currentPlayerIndex}`);
            }

            if (room.aiActionTimeoutId === newTimeoutId) {
                room.aiActionTimeoutId = null;
            }
        }, thinkTime);
        room.aiActionTimeoutId = newTimeoutId;
    } else {
        if (room.aiActionTimeoutId) {
            clearTimeout(room.aiActionTimeoutId);
            room.aiActionTimeoutId = null;
            console.debug(`[AIHandler ${room.roomId}] No AI needs to act in turn currently. Ensured AI turn timeout is cleared.`);
        }
    }
};


/**
 * @description 處理 AI 玩家在宣告階段的決策。
 *              此函數應在 checkForClaims 之後，當確定 AI 有宣告權時被調用。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {ServerPlayer} aiPlayer - 需要做宣告決策的 AI 玩家。
 */
export const processAIClaimDecision = (room: GameRoom, aiPlayer: ServerPlayer): void => {
    if (!aiPlayer.pendingClaims || aiPlayer.pendingClaims.length === 0) {
        // 如果 AI 沒有待處理的宣告，則無需進一步操作
        // (理論上調用此函數前應已檢查過 pendingClaims)
        return;
    }

    // AI 服務決定宣告動作
    // 注意: getClaimForAI 應返回 GameActionPayload，我們需要將其轉換為 SubmittedClaim
    // 或者 AIService.getNextAIMove 能處理宣告階段並返回 SUBMIT_CLAIM_DECISION 類型
    const decisionPayload = room.aiService.getNextAIMove(aiPlayer, room.getGameState());

    let submittedDecision: SubmittedClaim;

    // 將 AIService 返回的 GameActionPayload 轉換為 SubmittedClaim
    if (decisionPayload.type === 'PASS_CLAIM') {
        submittedDecision = { playerId: aiPlayer.id, action: 'Pass' };
    } else if (decisionPayload.type === 'DECLARE_HU') {
        submittedDecision = { playerId: aiPlayer.id, action: 'Hu' };
    } else if (decisionPayload.type === 'CLAIM_PENG' && decisionPayload.tile) {
        submittedDecision = { playerId: aiPlayer.id, action: 'Peng', chosenPengGangTileKind: decisionPayload.tile.kind };
    } else if (decisionPayload.type === 'CLAIM_GANG' && decisionPayload.tile) {
        submittedDecision = { playerId: aiPlayer.id, action: 'Gang', chosenPengGangTileKind: decisionPayload.tile.kind };
    } else if (decisionPayload.type === 'CLAIM_CHI' && decisionPayload.tilesToChiWith && decisionPayload.discardedTile) {
        submittedDecision = { playerId: aiPlayer.id, action: 'Chi', chiCombination: decisionPayload.tilesToChiWith };
    } else {
        // 如果 AI 返回了非預期的宣告動作，或者宣告動作缺少必要信息，則預設為跳過
        console.warn(`[AIHandler ${room.roomId}] AI ${aiPlayer.name} 返回了不符合預期的宣告動作 payload: ${JSON.stringify(decisionPayload)}。將視為跳過。`);
        submittedDecision = { playerId: aiPlayer.id, action: 'Pass' };
    }
    
    // 提交 AI 的決策
    PlayerActionHandler.processSubmitClaimDecision(room, submittedDecision);
};


/**
 * @description 處理AI玩家或離線玩家的遊戲動作 (通常是回合內的)。
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
            // CLAIM_PENG, CLAIM_GANG, CLAIM_CHI 現在應該透過 SUBMIT_CLAIM_DECISION 處理
            // 但如果 AIService.getNextAIMove 仍然返回這些舊的宣告類型，則保留兼容性處理
            case 'CLAIM_PENG': actionIsValid = PlayerActionHandler.processClaimPeng(room, aiPlayerId, action.tile); break;
            case 'CLAIM_GANG': actionIsValid = PlayerActionHandler.processClaimGang(room, aiPlayerId, action.tile); break;
            case 'CLAIM_CHI': actionIsValid = PlayerActionHandler.processClaimChi(room, aiPlayerId, action.tilesToChiWith, action.discardedTile); break;
            
            case 'DECLARE_AN_GANG': actionIsValid = PlayerActionHandler.processDeclareAnGang(room, aiPlayerId, action.tileKind); break;
            case 'DECLARE_MING_GANG_FROM_HAND': actionIsValid = PlayerActionHandler.processDeclareMingGangFromHand(room, aiPlayerId, action.tileKind); break;
            
            // PASS_CLAIM 也應該透過 SUBMIT_CLAIM_DECISION 處理
            case 'PASS_CLAIM': 
                actionIsValid = PlayerActionHandler.processSubmitClaimDecision(room, {playerId: aiPlayerId, action: 'Pass'});
                break;
            
            // AI 不應直接發送 SUBMIT_CLAIM_DECISION，它應由 processAIClaimDecision 封裝
             case 'SUBMIT_CLAIM_DECISION': // AI 不會直接發這個，而是 processAIClaimDecision 會調用 processSubmitClaimDecision
                 console.warn(`[AIHandler ${room.roomId}] AI ${aiPlayer.name} 嘗試直接提交 SUBMIT_CLAIM_DECISION，這應由 processAIClaimDecision 處理。`);
                 actionIsValid = PlayerActionHandler.processSubmitClaimDecision(room, action.decision);
                 break;

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
        // 也需要檢查是否有新的宣告機會
        if (room.gameState.lastDiscardedTile && room.gameState.gamePhase === GamePhase.TILE_DISCARDED) {
            // 如果 AI 打牌後產生了新的棄牌，則應觸發 checkForClaims
            // ClaimHandler.checkForClaims(room, room.gameState.lastDiscardedTile, aiPlayerId); // checkForClaims 會處理AI和人類玩家
        } else {
            processAITurnIfNeeded(room); // 檢查是否輪到下一個AI的回合內行動
        }
    } else {
        room.addLog(`AI/離線玩家 ${aiPlayer.name} (座位: ${aiPlayer.id}) 嘗試的動作 ${action.type} 無效或失敗。`);
        console.error(`[AIHandler ${room.roomId}] AI/離線玩家 ${aiPlayer.name} 的動作 ${action.type} 無效。遊戲階段: ${room.gameState.gamePhase}`);

        if ( (room.gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
              room.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
              room.gameState.gamePhase === GamePhase.AWAITING_DISCARD) &&
             room.gameState.currentPlayerIndex === aiPlayerId
        ) {
            console.error(`[AIHandler ${room.roomId}] AI ${aiPlayer.name} 在其主要回合行動失敗 (${action.type})，遊戲可能卡住。`);
            room.addLog(`嚴重警告：AI ${aiPlayer.name} 在其回合行動 ${action.type} 失敗。`);
             // 強制AI打出一張牌作為備用方案
            const handToConsider = (room.gameState.gamePhase === GamePhase.PLAYER_DRAWN && room.gameState.lastDrawnTile) ? [...aiPlayer.hand, room.gameState.lastDrawnTile] : aiPlayer.hand;
            if (handToConsider.length > 0) {
                const emergencyDiscard = handToConsider[handToConsider.length -1];
                room.addLog(`緊急措施：AI ${aiPlayer.name} 強制打出 ${emergencyDiscard.kind}。`);
                PlayerActionHandler.processDiscardTile(room, aiPlayerId, emergencyDiscard.id);
            } else {
                // 極端情況，AI手牌也空了
                 room.addLog(`嚴重錯誤：AI ${aiPlayer.name} 回合行動失敗且無牌可打。`);
                 // 可能需要判流局等
            }
        }
    }
};


/**
 * @description 清除AI行動的延遲計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const clearAiActionTimeout = (room: GameRoom): void => {
    if (room.aiActionTimeoutId) {
        clearTimeout(room.aiActionTimeoutId);
        room.aiActionTimeoutId = null;
        console.debug(`[AIHandler ${room.roomId}] AI 行動延遲計時器已被外部清除。`);
    }
};

