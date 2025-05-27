
// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { GamePhase, Tile } from '../types'; 
import { CLAIM_DECISION_TIMEOUT_SECONDS, PLAYER_TURN_ACTION_TIMEOUT_SECONDS, ACTION_TIMER_INTERVAL_MS as TIMER_INTERVAL, NUM_PLAYERS } from '../constants';
import * as PlayerActionHandler from './playerActionHandler';
import * as AIHandler from './aiHandler';
import * as RoundHandler from './roundHandler';
import * as TimerManager from './timerManager'; // 引入計時器管理器


/**
 * @description 推進遊戲到下一個玩家的回合。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {boolean} afterDiscard - 是否在一次成功的棄牌之後調用此函數。
 */
export const advanceToNextPlayerTurn = (room: GameRoom, afterDiscard: boolean): void => {
    // 清除與宣告相關的狀態，因為回合正在推進
    room.gameState.potentialClaims = [];
    room.gameState.playerMakingClaimDecision = null;
    room.gameState.chiOptions = null;
    
    // 如果是在棄牌後推進，則清除 lastDiscardedTile
    if (afterDiscard) {
        room.gameState.lastDiscardedTile = null;
    }

    // 計算下一個玩家的索引
    // 如果是在棄牌後 (afterDiscard is true)，則下一個玩家是棄牌者的下家
    // 否則 (例如，跳過宣告後)，是當前玩家的下家
    room.gameState.currentPlayerIndex = (room.gameState.lastDiscarderIndex !== null && afterDiscard)
                                    ? (room.gameState.lastDiscarderIndex + 1) % NUM_PLAYERS
                                    : (room.gameState.currentPlayerIndex + 1) % NUM_PLAYERS;

    room.gameState.turnNumber++; // 回合數增加
    room.gameState.gamePhase = GamePhase.PLAYER_TURN_START; // 設定遊戲階段為玩家回合開始 (等待摸牌)

    const nextPlayer = room.players.find(p => p.id === room.gameState.currentPlayerIndex);
    if(nextPlayer) {
        room.addLog(`輪到 ${nextPlayer.name} (座位: ${nextPlayer.id}) 摸牌。`);
        TimerManager.startActionTimerForPlayer(room, nextPlayer.id); // 為下一個玩家啟動行動計時器
    }
    room.broadcastGameState(); // 廣播遊戲狀態更新
    AIHandler.processAITurnIfNeeded(room); // 檢查是否需要 AI 行動
};

// startActionTimerForPlayer, clearActionTimer, handlePlayerActionTimeout 函數已移至 timerManager.ts
