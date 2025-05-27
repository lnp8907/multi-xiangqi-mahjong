
// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { GamePhase, Tile } from '../types';
import {
    CLAIM_DECISION_TIMEOUT_SECONDS, PLAYER_TURN_ACTION_TIMEOUT_SECONDS,
    ACTION_TIMER_INTERVAL_MS as TIMER_INTERVAL, NEXT_ROUND_COUNTDOWN_SECONDS,
    REMATCH_VOTE_TIMEOUT_SECONDS, MAX_ROUND_DURATION_SECONDS
} from '../constants';
import * as PlayerActionHandler from './playerActionHandler';
import * as RoundHandler from './roundHandler'; 
import * as MatchHandler from './matchHandler'; 
import * as ClaimHandler from './claimHandler'; // 引入 ClaimHandler

/**
 * @description 為指定玩家啟動行動計時器 (回合內行動)。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 要啟動計時器的玩家ID。
 * @param {'turn' | 'claim'} timerType - 計時器類型。'claim' 將被新的全局宣告計時器取代。
 */
export const startActionTimerForPlayer = (room: GameRoom, playerId: number, timerType: 'turn' | 'claim'): void => {
    clearActionTimer(room); 
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        console.error(`[TimerManager ${room.roomId}] startActionTimerForPlayer: 玩家 ${playerId} 未找到。`);
        return;
    }

    if (!player.isHuman || !player.isOnline) {
        console.debug(`[TimerManager ${room.roomId}] 不為 AI/離線玩家 ${player.name} (座位: ${playerId}) 啟動UI計時器。`);
        return;
    }

    let timeoutDuration: number;
    if (timerType === 'claim') { // 舊的單人宣告計時器，在新模型中可能較少使用
        timeoutDuration = CLAIM_DECISION_TIMEOUT_SECONDS;
        room.gameState.actionTimerType = 'claim';
         // 確保是在正確的階段使用 'claim' 類型計時器
        if (room.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION && room.gameState.gamePhase !== GamePhase.ACTION_PENDING_CHI_CHOICE) {
            console.warn(`[TimerManager ${room.roomId}] 嘗試為玩家 ${playerId} 啟動 'claim' 計時器，但遊戲階段為 ${room.gameState.gamePhase}。`);
            return;
        }
    } else if (timerType === 'turn') { // 玩家回合內行動
        timeoutDuration = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
        room.gameState.actionTimerType = 'turn';
        if (room.gameState.gamePhase !== GamePhase.PLAYER_TURN_START && 
            room.gameState.gamePhase !== GamePhase.PLAYER_DRAWN && 
            room.gameState.gamePhase !== GamePhase.AWAITING_DISCARD) {
            console.warn(`[TimerManager ${room.roomId}] 嘗試為玩家 ${playerId} 啟動 'turn' 計時器，但遊戲階段為 ${room.gameState.gamePhase}。`);
            return;
        }
    } else {
        console.warn(`[TimerManager ${room.roomId}] 未知的計時器類型: ${timerType}。`);
        return;
    }
    

    room.gameState.actionTimer = timeoutDuration; 
    room.addLog(`${player.name} (座位: ${player.id}) 的行動計時開始 (${timeoutDuration}s)，類型: ${timerType}。`);
    room.broadcastGameState(); 

    room.actionTimerId = setInterval(() => {
        if (room.gameState.actionTimer !== null && room.gameState.actionTimer > 0) {
            room.gameState.actionTimer--; 
            room.broadcastGameState(); 
        }
        
        if (room.gameState.actionTimer === 0) {
            const currentTimerTypeOnTimeout = room.gameState.actionTimerType; // Capture current type at the moment of timeout
            // Check if the currentTimerTypeOnTimeout is one that handlePlayerActionTimeout can process
            if (currentTimerTypeOnTimeout === 'turn' || currentTimerTypeOnTimeout === 'claim') {
                const currentDecisionMakerId = currentTimerTypeOnTimeout === 'claim'
                    ? room.gameState.playerMakingClaimDecision
                    : room.gameState.currentPlayerIndex;

                if (playerId === currentDecisionMakerId) {
                    // Pass the validated currentTimerTypeOnTimeout
                    handlePlayerActionTimeout(room, playerId, currentTimerTypeOnTimeout, false);
                } else {
                    room.addLog(`[TimerManager ${room.roomId}] 玩家 ${playerId} 的計時器到期，但行動權已轉移。清除過期計時器。`);
                    clearActionTimer(room);
                }
            } else {
                // If actionTimerType is 'global_claim' or null, this specific player timer interval shouldn't handle it.
                // This implies the timer for this 'turn'/'claim' was cleared or superseded by a global one.
                // Simply clear this interval as its job is done or preempted.
                console.debug(`[TimerManager ${room.roomId}] Player-specific timer for ${playerId} (type ${currentTimerTypeOnTimeout}) expired but type is not 'turn' or 'claim'. Clearing timer.`);
                clearActionTimer(room);
            }
        }
    }, TIMER_INTERVAL);
};

/**
 * @description 清除當前行動計時器 (回合內或單人宣告)。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const clearActionTimer = (room: GameRoom): void => {
    if (room.actionTimerId) {
        clearInterval(room.actionTimerId);
        room.actionTimerId = null;
    }
    if (room.gameState.actionTimer !== null || room.gameState.actionTimerType !== null) {
        room.gameState.actionTimer = null;
        room.gameState.actionTimerType = null;
        // 通常在清除後會廣播狀態，但此函數可能被多次調用，由調用者決定何時廣播
    }
};


/**
 * @description 啟動全局宣告計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const startGlobalClaimTimer = (room: GameRoom): void => {
    clearGlobalClaimTimer(room); // 清除已有的
    room.gameState.actionTimer = CLAIM_DECISION_TIMEOUT_SECONDS; // 使用相同的秒數作為全局宣告時間
    room.gameState.actionTimerType = 'global_claim';
    room.gameState.globalClaimTimerActive = true;
    room.addLog(`全局宣告階段開始，所有相關玩家有 ${CLAIM_DECISION_TIMEOUT_SECONDS} 秒回應。`);
    room.broadcastGameState();

    room.actionTimerId = setInterval(() => { // 重用 actionTimerId，因為同一時間只有一種主要行動計時器
        if (room.gameState.actionTimer !== null && room.gameState.actionTimer > 0 && room.gameState.globalClaimTimerActive) {
            room.gameState.actionTimer--;
            room.broadcastGameState();
        }
        if (room.gameState.actionTimer === 0 && room.gameState.globalClaimTimerActive) {
            handleGlobalClaimTimeout(room);
        }
    }, TIMER_INTERVAL);
};

/**
 * @description 清除全局宣告計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const clearGlobalClaimTimer = (room: GameRoom): void => {
    if (room.actionTimerId && room.gameState.actionTimerType === 'global_claim') {
        clearInterval(room.actionTimerId);
        room.actionTimerId = null;
    }
    if (room.gameState.globalClaimTimerActive) {
        room.gameState.actionTimer = null;
        room.gameState.actionTimerType = null;
        room.gameState.globalClaimTimerActive = false;
        // room.broadcastGameState(); // 由調用者決定廣播
    }
};

/**
 * @description 處理全局宣告計時器到期的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const handleGlobalClaimTimeout = (room: GameRoom): void => {
    clearGlobalClaimTimer(room); // 首先清除計時器
    room.addLog("全局宣告時間到。處理已提交的宣告，未回應者視為跳過。");

    // 將所有尚未回應的、有權宣告的真人玩家視為已提交 "Pass"
    room.players.forEach(player => {
        if (player.isHuman && player.isOnline && 
            (player.pendingClaims && player.pendingClaims.length > 0) && 
            !player.hasRespondedToClaim) {
            
            room.gameState.submittedClaims.push({ playerId: player.id, action: 'Pass' });
            player.hasRespondedToClaim = true; // 標記為已回應 (跳過也是一種回應)
            room.addLog(`玩家 ${player.name} 因宣告超時，自動跳過。`);
        }
    });
    ClaimHandler.resolveAllSubmittedClaims(room); // 處理所有已收集的宣告
    // broadcastGameState 將由 resolveAllSubmittedClaims 內部觸發
};


/**
 * @description 處理玩家行動超時的邏輯 (回合內或舊的單人宣告)。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 超時的玩家ID。
 * @param {'claim' | 'turn'} timerType - 超時的計時器類型。
 * @param {boolean} isOffline - 玩家是否已離線 (用於日誌和可能的不同處理)。
 */
export const handlePlayerActionTimeout = (room: GameRoom, playerId: number, timerType: 'claim' | 'turn', isOffline: boolean): void => {
    // 注意：此函數主要處理舊的單人宣告超時和玩家回合內行動超時。
    // 全局宣告超時由 handleGlobalClaimTimeout 處理。
    clearActionTimer(room); 
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        console.error(`[TimerManager ${room.roomId}] handlePlayerActionTimeout: 玩家 ${playerId} 未找到。`);
        return;
    }

    room.addLog(`${player.name} (座位: ${player.id}) 行動超時${isOffline ? ' (因離線)' : ''}，類型: ${timerType}。`);

    if (timerType === 'claim') { // 舊的單人宣告超時
        room.addLog(`${player.name} 的單獨宣告超時，自動跳過。`);
        PlayerActionHandler.processPassClaim(room, playerId); 
    } else if (timerType === 'turn') {
        room.addLog(`${player.name} 回合行動超時，系統自動打牌。`);
        let tileToDiscard: Tile | null = null;

        const handForDiscardChoice = (room.gameState.gamePhase === GamePhase.PLAYER_DRAWN && room.gameState.lastDrawnTile)
            ? [...player.hand, room.gameState.lastDrawnTile]
            : player.hand;

        if (isOffline || !player.isHuman) { 
            tileToDiscard = room.aiService.chooseDiscardForTimeoutOrOffline(handForDiscardChoice, room.getGameState());
            if (!tileToDiscard && handForDiscardChoice.length > 0) {
                 tileToDiscard = handForDiscardChoice[handForDiscardChoice.length -1]; // 打最後一張
                 room.addLog(`AI (${player.name}) 棄牌選擇異常，系統選擇最後一張牌 (${tileToDiscard?.kind}) 打出。`);
            }
        } else { 
            if (handForDiscardChoice.length > 0) {
                tileToDiscard = handForDiscardChoice[handForDiscardChoice.length - 1]; // 打出手牌中的最後一張
                room.addLog(`系統為 ${player.name} 自動選擇打出其手牌中最右邊的牌 (${tileToDiscard.kind})。`);
            }
        }
        
        // 如果經過上述邏輯，仍然沒有選出棄牌（例如手牌為空，且 lastDrawnTile 也未被納入）
        if (!tileToDiscard && room.gameState.lastDrawnTile && room.gameState.gamePhase === GamePhase.PLAYER_DRAWN) {
             tileToDiscard = room.gameState.lastDrawnTile;
             room.addLog(`系統為 ${player.name} 自動選擇打出剛摸到的牌 (${tileToDiscard.kind})，因無其他牌可選。`);
        }


        if (tileToDiscard) {
            PlayerActionHandler.processDiscardTile(room, playerId, tileToDiscard.id); 
        } else {
            console.error(`[TimerManager ${room.roomId}] 玩家 ${player.name} 回合超時，但無牌可打！手牌數: ${player.hand.length}, 剛摸的牌: ${room.gameState.lastDrawnTile?.kind}`);
            room.addLog(`嚴重錯誤: ${player.name} 無牌可打，遊戲可能卡住。`);
            room.gameState.isDrawGame = true; 
            RoundHandler.handleRoundEndFlow(room); 
            // room.broadcastGameState(); // handleRoundEndFlow會廣播
        }
    }
};

// --- 其他計時器函數 (startNextRoundTimer, clearNextRoundTimer, startRematchVoteTimer, clearRematchTimer, startRoundTimeoutTimer, clearRoundTimeoutTimer, handleRoundTimeout) 保持不變 ---
/**
 * @description 啟動下一局開始的倒數計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const startNextRoundTimer = (room: GameRoom): void => {
    clearNextRoundTimer(room); 
    room.gameState.nextRoundCountdown = NEXT_ROUND_COUNTDOWN_SECONDS; 
    room.broadcastGameState(); 

    room.nextRoundTimerId = setInterval(() => {
        if (room.gameState.nextRoundCountdown !== null && room.gameState.nextRoundCountdown > 0) {
            room.gameState.nextRoundCountdown--; 
            room.broadcastGameState();
        }
        if (room.gameState.nextRoundCountdown === 0) {
            clearNextRoundTimer(room);
            RoundHandler.startGameRound(room, false); 
        }
    }, 1000); 
};

/**
 * @description 清除下一局開始的倒數計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const clearNextRoundTimer = (room: GameRoom): void => {
    if (room.nextRoundTimerId) {
        clearInterval(room.nextRoundTimerId);
        room.nextRoundTimerId = null;
    }
    if (room.gameState.nextRoundCountdown !== null) {
        room.gameState.nextRoundCountdown = null;
    }
};

/**
 * @description 啟動再戰投票的倒數計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const startRematchVoteTimer = (room: GameRoom): void => {
    clearRematchTimer(room); 
    room.gameState.rematchCountdown = REMATCH_VOTE_TIMEOUT_SECONDS; 
    room.broadcastGameState(); 

    room.rematchTimerId = setInterval(() => {
        if (typeof room.gameState.rematchCountdown === 'number' && room.gameState.rematchCountdown > 0) {
            room.gameState.rematchCountdown--; 
            room.broadcastGameState();
        }
        if (room.gameState.rematchCountdown === 0) {
            MatchHandler.handleRematchVoteTimeout(room, false); 
        }
    }, 1000); 
};

/**
 * @description 清除再戰投票的倒數計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const clearRematchTimer = (room: GameRoom): void => {
    if (room.rematchTimerId) {
        clearInterval(room.rematchTimerId);
        room.rematchTimerId = null;
    }
    if (room.gameState.rematchCountdown !== null) {
        room.gameState.rematchCountdown = null;
    }
};

/**
 * @description 啟動全局單局超時計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const startRoundTimeoutTimer = (room: GameRoom): void => {
    clearRoundTimeoutTimer(room); 
    console.info(`[TimerManager ${room.roomId}] 全局單局超時計時器啟動 (${MAX_ROUND_DURATION_SECONDS}秒)。`);
    room.roundTimeoutTimerId = setTimeout(() => {
        handleRoundTimeout(room);
    }, MAX_ROUND_DURATION_SECONDS * 1000);
};

/**
 * @description 清除全局單局超時計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const clearRoundTimeoutTimer = (room: GameRoom): void => {
    if (room.roundTimeoutTimerId) {
        clearTimeout(room.roundTimeoutTimerId);
        room.roundTimeoutTimerId = null;
        console.info(`[TimerManager ${room.roomId}] 全局單局超時計時器已清除。`);
    }
};

/**
 * @description 處理全局單局超時的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const handleRoundTimeout = (room: GameRoom): void => {
    clearRoundTimeoutTimer(room); 
    if (room.gameState.gamePhase === GamePhase.GAME_OVER || room.gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES || room.gameState.matchOver) {
        console.warn(`[TimerManager ${room.roomId}] 全局單局超時觸發，但遊戲已結束或等待再戰。忽略。`);
        return;
    }
    
    room.addLog("本局因全局時間限制已到，自動結束 (流局)。");
    console.warn(`[TimerManager ${room.roomId}] 全局單局時間 (${MAX_ROUND_DURATION_SECONDS}秒) 已到，本局將以流局結束。`);
    
    room.gameState.isDrawGame = true; 
    RoundHandler.handleRoundEndFlow(room); 
};