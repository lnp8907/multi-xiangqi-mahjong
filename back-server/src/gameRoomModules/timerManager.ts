// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { GamePhase, Tile } from '../types';
import {
    CLAIM_DECISION_TIMEOUT_SECONDS, PLAYER_TURN_ACTION_TIMEOUT_SECONDS,
    ACTION_TIMER_INTERVAL_MS as TIMER_INTERVAL, NEXT_ROUND_COUNTDOWN_SECONDS,
    REMATCH_VOTE_TIMEOUT_SECONDS
} from '../constants';
import * as PlayerActionHandler from './playerActionHandler';
import * as RoundHandler from './roundHandler'; // For startGameRound
import * as MatchHandler from './matchHandler'; // For handleRematchVoteTimeout

/**
 * @description 為指定玩家啟動行動計時器 (宣告或回合)。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 要啟動計時器的玩家ID。
 */
export const startActionTimerForPlayer = (room: GameRoom, playerId: number): void => {
    clearActionTimer(room); // 先清除任何已存在的行動計時器
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        console.error(`[TimerManager ${room.roomId}] startActionTimerForPlayer: 玩家 ${playerId} 未找到。`);
        return;
    }

    // AI 或離線玩家不啟動客戶端計時器，他們的行動由 AIHandler 和特定邏輯處理
    if (!player.isHuman || !player.isOnline) {
        console.debug(`[TimerManager ${room.roomId}] 不為 AI/離線玩家 ${player.name} (座位: ${playerId}) 啟動計時器。`);
        return;
    }

    let timeoutDuration: number;
    // 根據遊戲階段決定計時器類型和時長
    if (room.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION || room.gameState.gamePhase === GamePhase.ACTION_PENDING_CHI_CHOICE) {
        timeoutDuration = CLAIM_DECISION_TIMEOUT_SECONDS;
        room.gameState.actionTimerType = 'claim';
    } else if (room.gameState.gamePhase === GamePhase.PLAYER_TURN_START || room.gameState.gamePhase === GamePhase.PLAYER_DRAWN || room.gameState.gamePhase === GamePhase.AWAITING_DISCARD) {
        timeoutDuration = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
        room.gameState.actionTimerType = 'turn';
    } else {
        // 其他階段不應啟動行動計時器
        console.warn(`[TimerManager ${room.roomId}] 試圖在不適當的遊戲階段 (${room.gameState.gamePhase}) 為玩家 ${playerId} 啟動行動計時器。`);
        return;
    }

    room.gameState.actionTimer = timeoutDuration; // 設定計時器剩餘時間
    room.addLog(`${player.name} (座位: ${player.id}) 的行動計時開始 (${timeoutDuration}s)。`);
    room.broadcastGameState(); // 廣播狀態，讓客戶端顯示計時器

    // 設定計時器間隔，每秒更新
    room.actionTimerId = setInterval(() => {
        if (room.gameState.actionTimer !== null && room.gameState.actionTimer > 0) {
            room.gameState.actionTimer--; // 倒數
            room.broadcastGameState(); // 廣播更新後的狀態
        }
        // 當計時器到0
        if (room.gameState.actionTimer === 0) {
            // 確認超時的玩家是否仍然是當前需要行動的玩家
            const currentDecisionMakerId = room.gameState.actionTimerType === 'claim'
                ? room.gameState.playerMakingClaimDecision
                : room.gameState.currentPlayerIndex;

            if (playerId === currentDecisionMakerId) {
                handlePlayerActionTimeout(room, playerId, room.gameState.actionTimerType!, false);
            } else {
                // 如果行動權已轉移，則清除此過期計時器
                room.addLog(`[TimerManager ${room.roomId}] 玩家 ${playerId} 的計時器到期，但行動權已轉移。清除過期計時器。`);
                clearActionTimer(room);
                room.broadcastGameState();
            }
        }
    }, TIMER_INTERVAL);
};

/**
 * @description 清除當前行動計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const clearActionTimer = (room: GameRoom): void => {
    if (room.actionTimerId) {
        clearInterval(room.actionTimerId);
        room.actionTimerId = null;
    }
    // 重置遊戲狀態中的計時器相關欄位
    room.gameState.actionTimer = null;
    room.gameState.actionTimerType = null;
};

/**
 * @description 處理玩家行動超時的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 超時的玩家ID。
 * @param {'claim' | 'turn'} timerType - 超時的計時器類型。
 * @param {boolean} isOffline - 玩家是否已離線 (用於日誌和可能的不同處理)。
 */
export const handlePlayerActionTimeout = (room: GameRoom, playerId: number, timerType: 'claim' | 'turn', isOffline: boolean): void => {
    clearActionTimer(room); // 首先清除計時器
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        console.error(`[TimerManager ${room.roomId}] handlePlayerActionTimeout: 玩家 ${playerId} 未找到。`);
        return;
    }

    room.addLog(`${player.name} (座位: ${player.id}) 行動超時${isOffline ? ' (因離線)' : ''}。`);

    if (timerType === 'claim') {
        // 宣告超時，自動跳過
        room.addLog(`${player.name} 宣告超時，自動跳過。`);
        PlayerActionHandler.processPassClaim(room, playerId); // 調用處理跳過宣告的函數
    } else if (timerType === 'turn') {
        // 回合行動超時，系統自動打牌
        room.addLog(`${player.name} 回合行動超時，系統自動打牌。`);
        let tileToDiscard: Tile | null = null;

        // 決定要打哪張牌
        if (room.gameState.gamePhase === GamePhase.PLAYER_DRAWN && room.gameState.lastDrawnTile) {
            // 如果是剛摸牌後超時，優先打出剛摸的牌
            tileToDiscard = room.gameState.lastDrawnTile;
        } else if (player.hand.length > 0) {
            // 如果手牌不為空，選擇一張牌打出
            const handForDiscardChoice = (room.gameState.gamePhase === GamePhase.PLAYER_DRAWN && room.gameState.lastDrawnTile)
                ? [...player.hand, room.gameState.lastDrawnTile] // 包含剛摸的牌
                : player.hand; // 僅手牌

            if (isOffline || !player.isHuman) {
                // 如果是AI或離線玩家，使用AI服務選擇棄牌
                tileToDiscard = room.aiService.chooseDiscardForTimeoutOrOffline(handForDiscardChoice, room.getGameState());
            } else {
                // 真人玩家超時，隨機打出一張手牌 (如果沒有剛摸的牌)
                // 如果有剛摸的牌，上面已處理。此處應是 AWAITING_DISCARD 階段。
                tileToDiscard = player.hand[Math.floor(Math.random() * player.hand.length)];
            }
        }
        // 再次檢查，如果上面邏輯未能選出牌，但有剛摸的牌，則使用它
        if (!tileToDiscard && room.gameState.lastDrawnTile) {
            tileToDiscard = room.gameState.lastDrawnTile;
        }

        if (tileToDiscard) {
            PlayerActionHandler.processDiscardTile(room, playerId, tileToDiscard.id); // 處理打牌
        } else {
            // 極端情況：超時且無牌可打
            console.error(`[TimerManager ${room.roomId}] 玩家 ${player.name} 回合超時，但無牌可打！`);
            room.addLog(`嚴重錯誤: ${player.name} 無牌可打，遊戲可能卡住。`);
            room.gameState.isDrawGame = true; // 判為流局
            RoundHandler.handleRoundEndFlow(room); // 處理本局結束
            room.broadcastGameState();
        }
    }
};

/**
 * @description 啟動下一局開始的倒數計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const startNextRoundTimer = (room: GameRoom): void => {
    clearNextRoundTimer(room); // 清除可能已存在的下一局計時器
    room.gameState.nextRoundCountdown = NEXT_ROUND_COUNTDOWN_SECONDS; // 設定倒數秒數
    room.broadcastGameState(); // 廣播初始倒數狀態

    room.nextRoundTimerId = setInterval(() => {
        if (room.gameState.nextRoundCountdown !== null && room.gameState.nextRoundCountdown > 0) {
            room.gameState.nextRoundCountdown--; // 倒數
            room.broadcastGameState();
        }
        if (room.gameState.nextRoundCountdown === 0) {
            // 倒數結束，自動開始下一局
            clearNextRoundTimer(room);
            RoundHandler.startGameRound(room, false); // isNewMatch = false
        }
    }, 1000); // 每秒執行一次
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
    room.gameState.nextRoundCountdown = null; // 重置倒數時間
};

/**
 * @description 啟動再戰投票的倒數計時器。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const startRematchVoteTimer = (room: GameRoom): void => {
    clearRematchTimer(room); // 清除可能已存在的再戰投票計時器
    room.gameState.rematchCountdown = REMATCH_VOTE_TIMEOUT_SECONDS; // 設定倒數秒數
    room.broadcastGameState(); // 廣播初始倒數狀態

    room.rematchTimerId = setInterval(() => {
        if (typeof room.gameState.rematchCountdown === 'number' && room.gameState.rematchCountdown > 0) {
            room.gameState.rematchCountdown--; // 倒數
            room.broadcastGameState();
        }
        if (room.gameState.rematchCountdown === 0) {
            // 投票時間到，處理投票結果
            MatchHandler.handleRematchVoteTimeout(room, false); // isEarlyStart = false
        }
    }, 1000); // 每秒執行一次
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
    room.gameState.rematchCountdown = null; // 重置倒數時間
};
