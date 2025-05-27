// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { GamePhase } from '../types';
import { NUM_PLAYERS, LOBBY_ROOM_NAME, REMATCH_VOTE_TIMEOUT_SECONDS } from '../constants';
import * as TurnHandler from './turnHandler';
import * as RoundHandler from './roundHandler';
import * as AIHandler from './aiHandler';
import * as TimerManager from './timerManager'; // 引入計時器管理器


/**
 * @description 處理整場比賽結束 (所有局數完成) 的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const handleMatchEnd = (room: GameRoom): void => {
    TimerManager.clearActionTimer(room); // 改用 TimerManager
    TimerManager.clearNextRoundTimer(room); // 改用 TimerManager
    AIHandler.clearAiActionTimeout(room);

    room.gameState.matchOver = true;
    room.gameState.gamePhase = GamePhase.AWAITING_REMATCH_VOTES;
    room.addLog(`所有 ${room.roomSettings.numberOfRounds} 局已完成，比賽結束！`);

    room.gameState.rematchVotes = room.players
        .filter(p => p.isHuman && p.isOnline)
        .map(p => ({ playerId: p.id, vote: 'pending' }));
    
    console.info(`[GameRoom ${room.roomId}] 比賽結束，進入再戰投票階段。在線真人玩家數: ${room.players.filter(p=>p.isHuman && p.isOnline).length}`);
    TimerManager.startRematchVoteTimer(room); // 改用 TimerManager 啟動再戰投票計時器
    room.broadcastGameState(); // 確保在啟動計時器後廣播一次包含倒數時間的狀態
};

/**
 * @description 處理玩家的再戰投票。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 投票的玩家ID。
 * @param {'yes'} vote - 玩家的投票 ('yes' 表示同意)。
 * @returns {boolean} 動作是否成功。
 */
export const processPlayerVoteRematch = (room: GameRoom, playerId: number, vote: 'yes'): boolean => {
    if (room.gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES) {
        console.warn(`[GameRoom ${room.roomId}] 玩家 ${playerId} 嘗試在非 AWAITING_REMATCH_VOTES 階段投票再戰。`);
        return false;
    }
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.isHuman || !player.isOnline) {
        console.warn(`[GameRoom ${room.roomId}] 只有在線真人玩家才能投票再戰。玩家ID: ${playerId}`);
        return false;
    }

    if (!room.gameState.rematchVotes) {
        room.gameState.rematchVotes = [];
    }

    const existingVoteIndex = room.gameState.rematchVotes.findIndex(v => v.playerId === playerId);
    if (existingVoteIndex !== -1) {
        room.gameState.rematchVotes[existingVoteIndex].vote = vote;
    } else {
        room.gameState.rematchVotes.push({ playerId, vote });
    }
    room.addLog(`${player.name} (座位: ${playerId}) 投票同意再戰。`);
    room.broadcastGameState();

    const onlineHumans = room.players.filter(p => p.isHuman && p.isOnline);
    const agreedHumans = onlineHumans.filter(p => room.gameState.rematchVotes?.find(v => v.playerId === p.id && v.vote === 'yes'));

    if (onlineHumans.length > 0 && onlineHumans.length === agreedHumans.length) {
        room.addLog("所有在線真人玩家已同意再戰，提前開始新比賽。");
        handleRematchVoteTimeout(room, true);
    }
    return true;
};

/**
 * @description 處理再戰投票超時或提前開始的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {boolean} isEarlyStart - 是否為所有玩家提前同意導致的開始。
 */
export const handleRematchVoteTimeout = (room: GameRoom, isEarlyStart: boolean): void => {
    TimerManager.clearRematchTimer(room); // 改用 TimerManager

    if (!isEarlyStart) {
        room.addLog("再戰投票時間到。");
    }

    const agreedHumanPlayers = room.players.filter(p =>
        p.isHuman && p.isOnline && room.gameState.rematchVotes?.find(v => v.playerId === p.id && v.vote === 'yes')
    );
    const onlineHumanPlayers = room.players.filter(p => p.isHuman && p.isOnline);

    if (onlineHumanPlayers.length > 0 && agreedHumanPlayers.length === onlineHumanPlayers.length) {
        room.addLog("所有在線真人玩家同意再戰！準備開始新的一場比賽。");

        room.players = agreedHumanPlayers; // 只保留同意再戰的真人玩家
        // 重新指派房主
        const originalHostAgreed = agreedHumanPlayers.find(p => p.socketId === room.roomSettings.hostSocketId);
        if (originalHostAgreed) {
            room.players.forEach(p => p.isHost = (p.id === originalHostAgreed.id));
            room.roomSettings.hostName = originalHostAgreed.name;
            // hostSocketId 保持不變
        } else if (agreedHumanPlayers.length > 0) { // 如果原房主未同意，則指派第一個同意的玩家為新房主
            agreedHumanPlayers[0].isHost = true;
            room.roomSettings.hostName = agreedHumanPlayers[0].name;
            room.roomSettings.hostSocketId = agreedHumanPlayers[0].socketId!;
            agreedHumanPlayers.slice(1).forEach(p => p.isHost = false);
        }
        room.gameState.hostPlayerName = room.roomSettings.hostName;
         room.players.forEach(p => { // 確保 isHost 狀態正確
            if (p.socketId === room.roomSettings.hostSocketId) p.isHost = true;
            else p.isHost = false;
        });


        room.initializeAIPlayers(); // 重新填充AI以達到 NUM_PLAYERS

        if (room.players.length < NUM_PLAYERS) {
             room.addLog(`同意再戰的玩家加上AI後人數不足 ${NUM_PLAYERS}。比賽無法開始，房間關閉。`);
             room.gameState.gamePhase = GamePhase.GAME_OVER;
             room.gameState.matchOver = true;
             room.broadcastGameState();
             room.requestClosure();
             return;
        }

        RoundHandler.startGameRound(room, true); // isNewMatch = true
    } else {
        room.addLog("並非所有在線真人玩家都同意再戰，或無人同意。比賽結束，房間關閉。");
        onlineHumanPlayers.forEach(p => {
            if (!room.gameState.rematchVotes?.find(v => v.playerId === p.id && v.vote === 'yes')) {
                if (p.socketId) {
                    room.io.to(p.socketId).emit('gameError', '您未同意再戰或投票超時，已返回大廳。');
                    const playerSocket = room.io.sockets.sockets.get(p.socketId);
                    if (playerSocket) {
                        playerSocket.leave(room.roomId);
                        playerSocket.join(LOBBY_ROOM_NAME);
                        console.info(`[GameRoom ${room.roomId}] Socket ${p.socketId} 因再戰投票未同意/超時，已加入 '${LOBBY_ROOM_NAME}' 群組。`);
                    }
                }
            }
        });

        room.gameState.gamePhase = GamePhase.GAME_OVER;
        room.gameState.matchOver = true;
        room.broadcastGameState();
        room.requestClosure();
    }
};


// clearRematchTimer 函數已移至 timerManager.ts
