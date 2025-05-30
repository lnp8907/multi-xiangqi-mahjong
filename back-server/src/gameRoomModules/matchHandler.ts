
// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { GamePhase, Player } from '../types'; // 新增 Player
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

        // 1. 保存所有當前玩家 (包括AI) 的分數
        const allCurrentPlayersScores: Record<number, { score: number, name: string, isAI: boolean }> = {};
        room.players.forEach(p => {
            allCurrentPlayersScores[p.id] = { score: p.score, name: p.name, isAI: !p.isHuman };
            console.info(`[MatchHandler ${room.roomId}] 再戰前，保存玩家 ${p.name} (ID: ${p.id}, AI: ${!p.isHuman}) 分數: ${p.score}`);
        });


        // 2. 只保留同意再戰的真人玩家，並重新指派房主
        room.players = agreedHumanPlayers; 
        const originalHostAgreed = agreedHumanPlayers.find(p => p.socketId === room.roomSettings.hostSocketId);
        if (originalHostAgreed) {
            room.players.forEach(p => p.isHost = (p.id === originalHostAgreed.id));
            room.roomSettings.hostName = originalHostAgreed.name;
        } else if (agreedHumanPlayers.length > 0) { 
            agreedHumanPlayers[0].isHost = true;
            room.roomSettings.hostName = agreedHumanPlayers[0].name;
            room.roomSettings.hostSocketId = agreedHumanPlayers[0].socketId!;
            agreedHumanPlayers.slice(1).forEach(p => p.isHost = false);
        }
        room.gameState.hostPlayerName = room.roomSettings.hostName;
        room.players.forEach(p => { 
            if (p.socketId === room.roomSettings.hostSocketId) p.isHost = true;
            else p.isHost = false;
        });

        // 3. 重新填充AI以達到 NUM_PLAYERS
        room.initializeAIPlayers(); 

        if (room.players.length < NUM_PLAYERS) {
             room.addLog(`同意再戰的玩家加上AI後人數不足 ${NUM_PLAYERS}。比賽無法開始，房間關閉。`);
             room.gameState.gamePhase = GamePhase.GAME_OVER;
             room.gameState.matchOver = true;
             room.broadcastGameState();
             room.requestClosure();
             return;
        }

        // 4. 開始新一場比賽 (isNewMatch = true 會重置牌局、隨機莊家)
        // RoundHandler.initializeOrResetGameForRound 中已修正 isNewMatch 不重置分數
        RoundHandler.startGameRound(room, true); 

        // 5. 恢復先前保存的分數 (包括 AI)
        room.players.forEach(playerInNewMatch => {
            if (allCurrentPlayersScores[playerInNewMatch.id] !== undefined) {
                playerInNewMatch.score = allCurrentPlayersScores[playerInNewMatch.id].score;
                console.info(`[MatchHandler ${room.roomId}] 恢復玩家 ${playerInNewMatch.name} (ID: ${playerInNewMatch.id}, AI: ${!playerInNewMatch.isHuman}) 的分數為: ${playerInNewMatch.score}`);
            } else {
                 console.info(`[MatchHandler ${room.roomId}] 未找到玩家 ${playerInNewMatch.name} (ID: ${playerInNewMatch.id}) 的保留分數。分數保持為 ${playerInNewMatch.score}。這可能是新加入的AI。`);
            }
        });
        room.updateGameStatePlayers(); // 確保 gameState 中的玩家分數也更新
        room.broadcastGameState(); // 廣播包含已恢復分數的狀態
        room.addLog("玩家分數已延續到新的一場比賽。");

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
