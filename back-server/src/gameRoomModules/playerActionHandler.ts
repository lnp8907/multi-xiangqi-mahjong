
// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { ServerPlayer } from '../Player';
import { Tile, TileKind, Meld, MeldDesignation, GamePhase, DiscardedTileInfo, SubmittedClaim } from '../types'; 
import { INITIAL_HAND_SIZE_DEALER, TILE_KIND_DETAILS, SHUNZI_DEFINITIONS, ACTION_PRIORITY } from '../constants'; 
import { sortHandVisually } from '../utils/deckManager'; 
import { removeTilesFromHand, countTilesOfKind, checkWinCondition } from '../utils/gameRules';
import * as ClaimHandler from './claimHandler';
import * as TurnHandler from './turnHandler';
import * as RoundHandler from './roundHandler';
import * as MatchHandler from './matchHandler'; // Import MatchHandler
import * as TimerManager from './timerManager'; // 標準導入 TimerManager
import * as AIHandler from './aiHandler'; // 新增引入 AIHandler


/**
 * @description 處理玩家摸牌的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 摸牌的玩家ID。
 * @returns {boolean} 動作是否成功。
 */
export const processDrawTile = (room: GameRoom, playerId: number): boolean => {
    const player = room.players.find(p => p.id === playerId);
    if (!player) { console.error(`[GameRoom ${room.roomId}] processDrawTile: 玩家 ${playerId} 未找到。`); return false; }
    
    if (room.gameState.currentPlayerIndex !== playerId || room.gameState.gamePhase !== GamePhase.PLAYER_TURN_START) {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '還沒輪到你摸牌或遊戲階段不正確。');
        return false;
    }
    if (room.gameState.deck.length === 0) {
        room.addLog("牌堆已空！本局流局。");
        room.gameState.isDrawGame = true;
        RoundHandler.handleRoundEndFlow(room);
        room.broadcastGameState();
        return true;
    }

    const drawnTile = room.gameState.deck.shift()!;
    room.gameState.lastDrawnTile = drawnTile; 
    room.gameState.gamePhase = GamePhase.PLAYER_DRAWN;
    room.addLog(`${player.name} (座位: ${player.id}) 摸了一張牌${player.isHuman && player.isOnline ? ` (${drawnTile.kind})` : ''}。`);
    TimerManager.startActionTimerForPlayer(room, playerId, 'turn'); 
    // AI 會在 AIHandler.processAITurnIfNeeded 中處理，此處無需立即廣播給 AI
    // 如果是真人玩家摸牌，則立即廣播
    if (player.isHuman && player.isOnline) {
        room.broadcastGameState();
    } else {
        // 如果是 AI 摸牌，確保 AIHandler 有機會處理
        AIHandler.processAITurnIfNeeded(room);
    }
    return true;
};

/**
 * @description 處理玩家打牌的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 打牌的玩家ID。
 * @param {string} tileIdToDiscard - 要打出的牌的ID。
 * @returns {boolean} 動作是否成功。
 */
export const processDiscardTile = (room: GameRoom, playerId: number, tileIdToDiscard: string): boolean => {
    const player = room.players.find(p => p.id === playerId);
    if (!player) { console.error(`[GameRoom ${room.roomId}] processDiscardTile: 玩家 ${playerId} 未找到。`); return false; }

    const isValidPhaseForDiscard =
        room.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
        (room.gameState.gamePhase === GamePhase.AWAITING_DISCARD && room.gameState.currentPlayerIndex === playerId);

    if (!isValidPhaseForDiscard) {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '還沒輪到你打牌或遊戲階段不正確。');
        return false;
    }
    TimerManager.clearActionTimer(room); // 打牌成功，清除回合計時器

    let tileToActuallyDiscard: Tile | null = null;

    if (room.gameState.gamePhase === GamePhase.PLAYER_DRAWN && room.gameState.lastDrawnTile) {
        if (room.gameState.lastDrawnTile.id === tileIdToDiscard) { 
            tileToActuallyDiscard = room.gameState.lastDrawnTile;
        } else { 
            tileToActuallyDiscard = player.removeTileFromHand(tileIdToDiscard);
            if (tileToActuallyDiscard) {
                player.addTileToHand(room.gameState.lastDrawnTile); 
            } else {
                if(player.socketId) room.io.to(player.socketId).emit('gameError', `在您的手中找不到要打出的牌 (ID: ${tileIdToDiscard})。`);
                TimerManager.startActionTimerForPlayer(room, playerId, 'turn'); // 操作失敗，重新啟動計時器
                return false;
            }
        }
        room.gameState.lastDrawnTile = null; 
    }
    else if (room.gameState.gamePhase === GamePhase.AWAITING_DISCARD) { 
        tileToActuallyDiscard = player.removeTileFromHand(tileIdToDiscard);
        if (!tileToActuallyDiscard) {
            if(player.socketId) room.io.to(player.socketId).emit('gameError', `在您的手中找不到要打出的牌 (ID: ${tileIdToDiscard})。`);
            TimerManager.startActionTimerForPlayer(room, playerId, 'turn'); // 操作失敗，重新啟動計時器
            return false;
        }
        if (player.isDealer && room.gameState.turnNumber === 1 && room.gameState.lastDrawnTile?.id === tileIdToDiscard) {
            room.gameState.lastDrawnTile = null;
        } else if (player.isDealer && room.gameState.turnNumber === 1 && room.gameState.lastDrawnTile) {
        }
        room.gameState.lastDrawnTile = null;
    } else {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '遊戲邏輯錯誤：不正確的打牌階段。');
        TimerManager.startActionTimerForPlayer(room, playerId, 'turn'); // 操作失敗，重新啟動計時器
        return false;
    }

    if (!tileToActuallyDiscard) {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '無法確定要打出的牌。');
        TimerManager.startActionTimerForPlayer(room, playerId, 'turn'); // 操作失敗，重新啟動計時器
        return false;
    }
    
    player.hand = sortHandVisually(player.hand); 

    const discardedInfo: DiscardedTileInfo = { tile: tileToActuallyDiscard, discarderId: playerId };
    room.gameState.discardPile.unshift(discardedInfo);
    room.gameState.lastDiscardedTile = tileToActuallyDiscard; 
    room.gameState.lastDiscarderIndex = playerId;

    room.addLog(`${player.name} (座位: ${player.id}) 打出了 ${tileToActuallyDiscard.kind}。`);
    room.broadcastActionAnnouncement(tileToActuallyDiscard.kind, playerId);

    const discardedPlayerForLog = room.players.find(p => p.id === playerId);
    if (discardedPlayerForLog) {
        // ... (手牌日誌驗證邏輯保持不變)
    }

    room.updateGameStatePlayers();
    ClaimHandler.checkForClaims(room, tileToActuallyDiscard, playerId); // checkForClaims 會處理後續流程
    return true;
};

/**
 * @description 處理玩家提交宣告決策的邏輯 (新模型)。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {SubmittedClaim} decision - 玩家提交的宣告決策。
 * @returns {boolean} 動作是否成功。
 */
export const processSubmitClaimDecision = (room: GameRoom, decision: SubmittedClaim): boolean => {
    const player = room.players.find(p => p.id === decision.playerId);
    if (!player) {
        console.error(`[GameRoom ${room.roomId}] processSubmitClaimDecision: 玩家 ${decision.playerId} 未找到。`);
        return false;
    }
    if (room.gameState.gamePhase !== GamePhase.AWAITING_ALL_CLAIMS_RESPONSE) {
        if (player.socketId) room.io.to(player.socketId).emit('gameError', '現在不是提交宣告決策的時候。');
        return false;
    }
    if (player.hasRespondedToClaim) {
        if (player.socketId) room.io.to(player.socketId).emit('gameError', '您已經提交過宣告決策了。');
        return false;
    }

    // 驗證提交的宣告是否合法 (例如，吃牌時 chiCombination 是否有效)
    if (decision.action === 'Chi' && (!decision.chiCombination || decision.chiCombination.length !== 2)) {
         if (player.socketId) room.io.to(player.socketId).emit('gameError', '選擇的吃牌組合無效。');
        return false; // 讓玩家重新選擇或跳過
    }
    // 其他宣告類型 (碰、槓、胡) 的合法性已在 checkForClaims 時確認過 pendingClaims

    room.gameState.submittedClaims.push(decision);
    player.hasRespondedToClaim = true; // 標記玩家已回應
    room.addLog(`${player.name} (座位: ${player.id}) 提交宣告決策: ${decision.action}${decision.action === 'Chi' && decision.chiCombination ? ` 使用 ${decision.chiCombination.map(t=>t.kind).join(',')}` : ''}。`);
    
    // 如果玩家選擇了一個實際的宣告 (非 Pass)，則清除其對此棄牌的其他 pendingClaims
    if (decision.action !== 'Pass' && player.pendingClaims) {
        player.pendingClaims = player.pendingClaims.filter(pc => pc.action === decision.action);
    }


    // 檢查是否所有需要回應的真人玩家都已回應
    const humanPlayersWithPendingClaims = room.players.filter(p =>
        p.isHuman && p.isOnline && (p.pendingClaims && p.pendingClaims.length > 0)
    );
    const allHumansResponded = humanPlayersWithPendingClaims.every(p => p.hasRespondedToClaim);
    const allAIsResponded = room.players.filter(p => (!p.isHuman || !p.isOnline) && (p.pendingClaims && p.pendingClaims.length > 0))
                                       .every(p => room.gameState.submittedClaims.find(sc => sc.playerId === p.id));


    if (allHumansResponded && allAIsResponded) {
        room.addLog("所有需要回應的玩家均已提交決策或自動處理。");
        ClaimHandler.resolveAllSubmittedClaims(room); // 立即裁決
    } else {
        const humansNeedingResponse = humanPlayersWithPendingClaims.filter(p => !p.hasRespondedToClaim).length;
        const aisNeedingResponse = room.players.filter(p => (!p.isHuman || !p.isOnline) && (p.pendingClaims && p.pendingClaims.length > 0) && !room.gameState.submittedClaims.find(sc => sc.playerId === p.id)).length;
        if (humansNeedingResponse > 0 || aisNeedingResponse > 0) {
            room.addLog(`等待其他 ${humansNeedingResponse} 位真人玩家和 ${aisNeedingResponse} 位 AI 回應宣告...`);
        }
    }
    room.broadcastGameState(); // 廣播狀態以更新 UI (例如，顯示誰已回應)
    return true;
};


/**
 * @description 處理玩家宣告胡牌的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 宣告胡牌的玩家ID。
 * @returns {boolean} 動作是否成功。
 */
export const processDeclareHu = (room: GameRoom, playerId: number): boolean => {
    const player = room.players.find(p => p.id === playerId);
    if (!player) { console.error(`[GameRoom ${room.roomId}] processDeclareHu: 玩家 ${playerId} 未找到。`); return false; }

    TimerManager.clearActionTimer(room); // 清除可能存在的單人回合計時器
    // 全局宣告計時器由 resolveAllSubmittedClaims 或其觸發的流程清除

    let handToCheck: Tile[];
    let isSelfDrawnHu = false;
    let winTile: Tile | null = null;
    let actionTextForAnnouncement: "天胡" | "自摸" | "胡" = "胡";
    
    // 判斷是自摸還是食胡
    // 條件1: 輪到自己，且剛摸牌 (PLAYER_DRAWN)
    // 條件2: 輪到自己，莊家開局打第一張前 (AWAITING_DISCARD + dealer + turn1 + 8張牌)
    // 條件3: 輪到自己，莊家開局摸第一張牌前 (PLAYER_TURN_START + dealer + turn1 + 7張牌) -> 天胡
    // 條件4: 非自己回合，對手打出牌，自己有胡的宣告權 (AWAITING_ALL_CLAIMS_RESPONSE 或 AWAITING_CLAIMS_RESOLUTION)
    
    const isCurrentPlayerTurn = room.gameState.currentPlayerIndex === playerId;
    const isDealerInitialDiscard = player.isDealer && room.gameState.turnNumber === 1 && room.gameState.gamePhase === GamePhase.AWAITING_DISCARD && player.hand.length + (room.gameState.lastDrawnTile ? 1:0) === INITIAL_HAND_SIZE_DEALER;
    const isDealerInitialDraw = player.isDealer && room.gameState.turnNumber === 1 && room.gameState.gamePhase === GamePhase.PLAYER_TURN_START && player.hand.length === INITIAL_HAND_SIZE_DEALER -1;


    if (isCurrentPlayerTurn && (room.gameState.gamePhase === GamePhase.PLAYER_DRAWN || isDealerInitialDiscard || isDealerInitialDraw)) {
        isSelfDrawnHu = true;
        winTile = room.gameState.lastDrawnTile; // lastDrawnTile 此時是剛摸的牌或莊家第8張牌

        if (isDealerInitialDraw || (isDealerInitialDiscard && !room.gameState.lastDrawnTile) /*理論上莊家AWAITING_DISCARD時lastDrawnTile會有值*/) {
            // 天胡的判斷: 莊家在 PLAYER_TURN_START (摸第一張前) 或 AWAITING_DISCARD (打第一張前)
            // 手牌組合方式略有不同
            handToCheck = isDealerInitialDraw ? [...player.hand] : (room.gameState.lastDrawnTile ? [...player.hand, room.gameState.lastDrawnTile] : [...player.hand]);
            if(handToCheck.length !== (isDealerInitialDraw ? INITIAL_HAND_SIZE_DEALER -1 : INITIAL_HAND_SIZE_DEALER) && player.isDealer && room.gameState.turnNumber === 1) {
                 console.warn(`[GameRoom ${room.roomId}] 天胡檢查時手牌數量 (${handToCheck.length}) 不正確。莊家: ${player.name}。階段: ${room.gameState.gamePhase}`);
            }
            // 如果是 PLAYER_TURN_START，則 winTile 此時是 null，胡牌後需要補一張 (這部分邏輯需要小心)
            // 天胡通常是在發完牌後直接胡，所以 handToCheck 應該是完整的初始手牌。
            // 此處簡化：如果是在 PLAYER_TURN_START 宣告天胡，則假定手牌已包含胡牌張。
             actionTextForAnnouncement = "天胡";
             winTile = winTile || player.hand.find(t => countTilesOfKind(handToCheck, t.kind) % 2 !== 0 || checkWinCondition([...handToCheck, t], player.melds).isWin) || handToCheck[0]; // 盡量找一個合理的胡牌張

        } else { // 一般自摸
            if (!room.gameState.lastDrawnTile) {
                 if(player.socketId) room.io.to(player.socketId).emit('gameError', '錯誤：宣告自摸時找不到剛摸的牌。'); return false;
            }
            handToCheck = [...player.hand, room.gameState.lastDrawnTile!];
            actionTextForAnnouncement = "自摸";
        }
    }
    // 食胡: 遊戲處於等待宣告回應或正在裁決宣告的階段，且棄牌存在
    else if (room.gameState.lastDiscardedTile && 
             (room.gameState.gamePhase === GamePhase.AWAITING_ALL_CLAIMS_RESPONSE || room.gameState.gamePhase === GamePhase.AWAITING_CLAIMS_RESOLUTION || room.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION) ) {
        // 檢查 submittedClaims 中是否有此玩家的胡牌宣告
        const submittedHuClaim = room.gameState.submittedClaims.find(sc => sc.playerId === playerId && sc.action === 'Hu');
        if (!submittedHuClaim && room.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION /*向下兼容舊的逐個問詢*/) { // 如果在新的集中提交流程中找不到，則可能無效
             if(player.socketId) room.io.to(player.socketId).emit('gameError', '現在不是宣告食胡的時機或您未提交胡牌宣告。');
            return false;
        }
        isSelfDrawnHu = false;
        winTile = room.gameState.lastDiscardedTile;
        handToCheck = [...player.hand, room.gameState.lastDiscardedTile]; 
        actionTextForAnnouncement = "胡";
    } else {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '現在不是宣告胡牌的時機。');
        return false;
    }

    const winInfo = checkWinCondition(handToCheck, player.melds);
    if (winInfo.isWin) {
        room.gameState.winnerId = playerId;
        room.gameState.winType = isSelfDrawnHu ? 'selfDrawn' : 'discard';
        let huMessage = `${player.name} (座位: ${player.id}) `;

        if (isSelfDrawnHu) {
            if (actionTextForAnnouncement === "天胡") huMessage += "天胡";
            else huMessage += `自摸 (摸到 ${winTile?.kind || '牌'})`;
            room.gameState.winningTileDiscarderId = null;
            room.gameState.winningDiscardedTile = null; 
            
            if (winTile && room.gameState.lastDrawnTile && winTile.id === room.gameState.lastDrawnTile.id) {
                // 如果胡的是剛摸的牌，確保它已在 handToCheck 中，lastDrawnTile 會在打牌流程或回合結束時自然清除
            }
        } else { // 食胡
            huMessage += `食胡 (ロン了 ${room.players.find(p=>p.id === room.gameState.lastDiscarderIndex)?.name || '上家'} 的 ${winTile!.kind})`;
            room.gameState.winningTileDiscarderId = room.gameState.lastDiscarderIndex;
            room.gameState.winningDiscardedTile = winTile;
            if (room.gameState.lastDiscardedTile && room.gameState.lastDiscardedTile.id === winTile!.id) {
                ClaimHandler.consumeDiscardedTileForMeld(room, winTile!.id); 
            }
            player.addTileToHand(winTile!); 
        }
        player.hand = sortHandVisually(player.hand); 

        huMessage += "了！";
        room.addLog(huMessage);
        // 檢查是否一炮多響 (移到 ClaimHandler.resolveAllSubmittedClaims 中統一處理宣告時的廣播)
        // const isMultiTarget = room.gameState.submittedClaims.filter(sc => sc.action === 'Hu').length > 1;
        // room.broadcastActionAnnouncement(actionTextForAnnouncement, playerId, isMultiTarget);
        room.broadcastActionAnnouncement(actionTextForAnnouncement, playerId, room.gameState.potentialClaims.filter(c => c.action === 'Hu').length > 1);


        room.updateGameStatePlayers();
        ClaimHandler.clearClaimsAndTimer(room); // 胡牌後，結束當前宣告流程
        RoundHandler.handleRoundEndFlow(room); // 處理本局結束
    } else { // 詐胡
        room.addLog(`${player.name} 宣告 ${actionTextForAnnouncement} 失敗 (詐胡)。`);
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '不符合胡牌條件。');

        // 詐胡處理：
        // 如果是食胡宣告失敗，則該玩家的此輪宣告視為 "Pass"
        if (!isSelfDrawnHu) {
            const submissionIndex = room.gameState.submittedClaims.findIndex(sc => sc.playerId === playerId && sc.action === 'Hu');
            if (submissionIndex !== -1) {
                room.gameState.submittedClaims[submissionIndex].action = 'Pass'; // 將詐胡的宣告改為跳過
                 room.addLog(`${player.name} 的胡牌宣告因詐胡而視為跳過。`);
            }
            // 檢查是否所有人都已回應，若是，則重新裁決
            const humanPlayersWithPendingClaims = room.players.filter(p =>
                p.isHuman && p.isOnline && (p.pendingClaims && p.pendingClaims.length > 0) && !p.hasRespondedToClaim
            );
            if (humanPlayersWithPendingClaims.length === 0) {
                ClaimHandler.resolveAllSubmittedClaims(room);
            }
        } else { // 自摸宣告失敗
            if (actionTextForAnnouncement === "天胡") {
                if (room.gameState.lastDrawnTile) { // 莊家第8張牌
                    player.addTileToHand(room.gameState.lastDrawnTile);
                    player.hand = sortHandVisually(player.hand);
                    room.gameState.lastDrawnTile = null; 
                }
                room.gameState.gamePhase = GamePhase.AWAITING_DISCARD; // 等待莊家打第一張
            } else { // 一般自摸失敗
                // lastDrawnTile 保持，等待玩家打出
                room.gameState.gamePhase = GamePhase.PLAYER_DRAWN;
            }
            TimerManager.startActionTimerForPlayer(room, playerId, 'turn'); 
            room.broadcastGameState();
        }
        return false;
    }
    return true;
};


/**
 * @description 處理玩家宣告碰牌的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 宣告碰牌的玩家ID。
 * @param {Tile} tileToPeng - 要碰的牌 (來自棄牌堆)。
 * @returns {boolean} 動作是否成功。
 */
export const processClaimPeng = (room: GameRoom, playerId: number, tileToPeng: Tile): boolean => {
    const player = room.players.find(p => p.id === playerId);
    // 碰牌時，不再檢查 playerMakingClaimDecision 或 AWAITING_PLAYER_CLAIM_ACTION，
    // 因為此函數現在由 resolveAllSubmittedClaims 在確認玩家有權碰之後調用。
    if (!player || !room.gameState.lastDiscardedTile || room.gameState.lastDiscardedTile.kind !== tileToPeng.kind) {
        if(player?.socketId) room.io.to(player.socketId).emit('gameError', '無效的碰牌宣告或目標牌不符。');
        return false;
    }
    TimerManager.clearGlobalClaimTimer(room); // 碰牌成功，清除全局宣告計時器

    const { handAfterAction, newMeldTiles } = removeTilesFromHand(player.hand, tileToPeng.kind, 2);
    if (!newMeldTiles || newMeldTiles.length !== 2) {
        room.addLog(`錯誤: ${player.name} 無法碰 ${tileToPeng.kind}，手牌中該牌數量不足。`);
        // 此處不應再調用 ClaimHandler.handleInvalidClaim，因為已在裁決階段
        // 若此處出錯，表示裁決前的檢查有誤，應記錄嚴重錯誤
        console.error(`[GameRoom ${room.roomId}] 嚴重錯誤: processClaimPeng 時手牌不足，但先前檢查應已通過。`);
        return false;
    }
    player.hand = handAfterAction; 
    player.hand = sortHandVisually(player.hand); 

    const pengMeld: Meld = {
        id: `meld-${player.id}-${Date.now()}`,
        designation: MeldDesignation.KEZI,
        tiles: [...newMeldTiles, tileToPeng].sort((a,b) => TILE_KIND_DETAILS[b.kind].orderValue - TILE_KIND_DETAILS[a.kind].orderValue), // 修正排序為降序
        isOpen: true,
        claimedFromPlayerId: room.gameState.lastDiscarderIndex!,
        claimedTileId: tileToPeng.id,
    };
    player.melds.push(pengMeld);
    room.addLog(`${player.name} (座位: ${player.id}) 碰了 ${tileToPeng.kind}。請出牌。`);
    room.broadcastActionAnnouncement("碰", playerId);

    ClaimHandler.consumeDiscardedTileForMeld(room, tileToPeng.id);
    ClaimHandler.clearClaimsAndTimer(room); // 清理宣告相關狀態
    room.gameState.currentPlayerIndex = player.id;
    room.gameState.gamePhase = GamePhase.AWAITING_DISCARD;
    room.updateGameStatePlayers();
    TimerManager.startActionTimerForPlayer(room, player.id, 'turn'); 
    room.broadcastGameState();
    AIHandler.processAITurnIfNeeded(room); // 修正：碰牌後輪到AI出牌
    return true;
};

/**
 * @description 處理玩家宣告明槓 (別人打出的牌) 的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 宣告槓牌的玩家ID。
 * @param {Tile} tileToGang - 要槓的牌 (來自棄牌堆)。
 * @returns {boolean} 動作是否成功。
 */
export const processClaimGang = (room: GameRoom, playerId: number, tileToGang: Tile): boolean => {
    const player = room.players.find(p => p.id === playerId);
    if (!player || !room.gameState.lastDiscardedTile || room.gameState.lastDiscardedTile.kind !== tileToGang.kind) {
        if(player?.socketId) room.io.to(player.socketId).emit('gameError', '無效的槓牌宣告或目標牌不符。');
        return false;
    }
    TimerManager.clearGlobalClaimTimer(room);

    const { handAfterAction, newMeldTiles } = removeTilesFromHand(player.hand, tileToGang.kind, 3);
    if (!newMeldTiles || newMeldTiles.length !== 3) {
        room.addLog(`錯誤: ${player.name} 無法槓 ${tileToGang.kind}，手牌中該牌數量不足。`);
        console.error(`[GameRoom ${room.roomId}] 嚴重錯誤: processClaimGang 時手牌不足。`);
        return false;
    }
    player.hand = handAfterAction;
    player.hand = sortHandVisually(player.hand);

    const gangMeld: Meld = {
        id: `meld-${player.id}-${Date.now()}`,
        designation: MeldDesignation.GANGZI,
        tiles: [...newMeldTiles, tileToGang].sort((a,b) => TILE_KIND_DETAILS[b.kind].orderValue - TILE_KIND_DETAILS[a.kind].orderValue), // 修正排序為降序
        isOpen: true,
        claimedFromPlayerId: room.gameState.lastDiscarderIndex!,
        claimedTileId: tileToGang.id,
    };
    player.melds.push(gangMeld);
    room.addLog(`${player.name} (座位: ${player.id}) 槓了 ${tileToGang.kind}。請摸牌。`);
    room.broadcastActionAnnouncement("槓", playerId);

    ClaimHandler.consumeDiscardedTileForMeld(room, tileToGang.id);
    ClaimHandler.clearClaimsAndTimer(room);
    room.gameState.currentPlayerIndex = player.id;
    room.gameState.gamePhase = GamePhase.PLAYER_TURN_START; // 槓牌後摸牌
    room.updateGameStatePlayers();
    TimerManager.startActionTimerForPlayer(room, player.id, 'turn'); 
    room.broadcastGameState();
    AIHandler.processAITurnIfNeeded(room); // 槓牌後輪到AI摸牌
    return true;
};

/**
 * @description 處理玩家宣告吃牌的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 宣告吃牌的玩家ID。
 * @param {Tile[]} tilesToChiWith - 玩家選擇用來吃的兩張手牌。
 * @param {Tile} discardedTileToChi - 被吃的棄牌。
 * @returns {boolean} 動作是否成功。
 */
export const processClaimChi = (room: GameRoom, playerId: number, tilesToChiWith: Tile[], discardedTileToChi: Tile): boolean => {
    const player = room.players.find(p => p.id === playerId);
    if (!player || !room.gameState.lastDiscardedTile || room.gameState.lastDiscardedTile.id !== discardedTileToChi.id) {
        if(player?.socketId) room.io.to(player.socketId).emit('gameError', '無效的吃牌宣告或目標牌不符。');
        return false;
    }
    if (tilesToChiWith.length !== 2) {
         if(player?.socketId) room.io.to(player.socketId).emit('gameError', '吃牌必須選擇兩張手牌。');
        return false;
    }
    TimerManager.clearGlobalClaimTimer(room);

    let handCopy = [...player.hand];
    const removedForChi: Tile[] = [];
    let allFound = true;
    for (const tile of tilesToChiWith) {
        const index = handCopy.findIndex(t => t.id === tile.id);
        if (index !== -1) {
            removedForChi.push(handCopy.splice(index, 1)[0]);
        } else {
            allFound = false; break;
        }
    }

    if (!allFound || removedForChi.length !== 2) {
        room.addLog(`錯誤: ${player.name} 嘗試吃 ${discardedTileToChi.kind}，但選擇的手牌 ${tilesToChiWith.map(t=>t.kind).join(',')} 無效或不足。`);
        console.error(`[GameRoom ${room.roomId}] 嚴重錯誤: processClaimChi 時手牌不足或選擇錯誤。`);
        return false;
    }

    player.hand = handCopy; 
    player.hand = sortHandVisually(player.hand); 

    const threeTilesForShunzi: Tile[] = [...removedForChi, discardedTileToChi];
    let finalMeldTiles: Tile[] = [];

    for (const shunziDef of SHUNZI_DEFINITIONS) { 
        const kindsInDef = new Set(shunziDef);
        const kindsInThreeTiles = new Set(threeTilesForShunzi.map(t => t.kind));
        let isCurrentShunziDefMatch = kindsInDef.size === kindsInThreeTiles.size && [...kindsInThreeTiles].every(kind => kindsInDef.has(kind));
        if (isCurrentShunziDefMatch) {
            finalMeldTiles = shunziDef.map(definedKind => 
                threeTilesForShunzi.find(actualTile => actualTile.kind === definedKind)!
            ).sort((a,b)=> TILE_KIND_DETAILS[b.kind].orderValue - TILE_KIND_DETAILS[a.kind].orderValue); // 修正排序為降序
            break; 
        }
    }

    if (finalMeldTiles.length !== 3) {
        console.error(`[PlayerActionHandler ${room.roomId}] 無法確定 ${discardedTileToChi.kind} 的順子定義。吃牌手牌: ${removedForChi.map(t=>t.kind).join(',')}. 將使用備用排序邏輯。`);
        const sortedHandTilesFallback = [...removedForChi].sort(
            (a, b) => TILE_KIND_DETAILS[b.kind].orderValue - TILE_KIND_DETAILS[a.kind].orderValue // 修正排序為降序
        );
        // 嘗試按 orderValue 排序組合
        finalMeldTiles = [sortedHandTilesFallback[0], discardedTileToChi, sortedHandTilesFallback[1]].sort((a,b)=> TILE_KIND_DETAILS[b.kind].orderValue - TILE_KIND_DETAILS[a.kind].orderValue); // 修正排序為降序
    }
    
    const chiMeld: Meld = {
        id: `meld-${player.id}-${Date.now()}`,
        designation: MeldDesignation.SHUNZI,
        tiles: finalMeldTiles, 
        isOpen: true,
        claimedFromPlayerId: room.gameState.lastDiscarderIndex!,
        claimedTileId: discardedTileToChi.id,
    };
    player.melds.push(chiMeld);
    room.addLog(`${player.name} (座位: ${player.id}) 吃了 ${discardedTileToChi.kind}。請出牌。`);
    room.broadcastActionAnnouncement("吃", playerId);

    ClaimHandler.consumeDiscardedTileForMeld(room, discardedTileToChi.id);
    ClaimHandler.clearClaimsAndTimer(room); 
    room.gameState.currentPlayerIndex = player.id;
    room.gameState.gamePhase = GamePhase.AWAITING_DISCARD;
    room.updateGameStatePlayers();
    TimerManager.startActionTimerForPlayer(room, player.id, 'turn'); 
    room.broadcastGameState();
    AIHandler.processAITurnIfNeeded(room); // 修正：吃牌後輪到AI出牌
    return true;
};


/**
 * @description 處理玩家宣告暗槓的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 宣告暗槓的玩家ID。
 * @param {TileKind} tileKindToGang - 要暗槓的牌的種類。
 * @returns {boolean} 動作是否成功。
 */
export const processDeclareAnGang = (room: GameRoom, playerId: number, tileKindToGang: TileKind): boolean => {
    const player = room.players.find(p => p.id === playerId);
    if (!player) { console.error(`[GameRoom ${room.roomId}] processDeclareAnGang: 玩家 ${playerId} 未找到。`); return false; }
    
    if (room.gameState.currentPlayerIndex !== playerId ||
        (room.gameState.gamePhase !== GamePhase.PLAYER_TURN_START && 
         room.gameState.gamePhase !== GamePhase.PLAYER_DRAWN &&
         !(room.gameState.gamePhase === GamePhase.AWAITING_DISCARD && player.isDealer && room.gameState.turnNumber === 1))
       ) {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '現在不是宣告暗槓的時機。');
        return false;
    }
    TimerManager.clearActionTimer(room); // 清除回合計時器

    const isDrawnTilePartOfGang = room.gameState.gamePhase === GamePhase.PLAYER_DRAWN && 
                                  room.gameState.lastDrawnTile?.kind === tileKindToGang;

    // 檢查是否有足夠的牌來暗槓 (包含剛摸的牌，如果適用)
    const effectiveHandForCheck = isDrawnTilePartOfGang 
        ? [...player.hand, room.gameState.lastDrawnTile!] 
        : player.hand; // 如果不是PLAYER_DRAWN摸到槓牌，或PLAYER_TURN_START，則只檢查手牌

    if (countTilesOfKind(effectiveHandForCheck, tileKindToGang) < 4) {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', `您沒有四張 ${tileKindToGang} 可以暗槓。`);
        TimerManager.startActionTimerForPlayer(room, playerId, 'turn'); // 操作失敗，重啟計時器
        return false;
    }

    let finalMeldTiles: Tile[];
    let handAfterGang: Tile[];

    if (isDrawnTilePartOfGang) {
        // 第四張是剛摸到的牌
        const { handAfterAction, newMeldTiles: removedFromHand } = removeTilesFromHand(player.hand, tileKindToGang, 3);
        if (!removedFromHand || removedFromHand.length !== 3) {
             if(player.socketId) room.io.to(player.socketId).emit('gameError', `暗槓時內部錯誤：無法從手牌移除3張 ${tileKindToGang}。`);
             TimerManager.startActionTimerForPlayer(room, playerId, 'turn');
             return false;
        }
        finalMeldTiles = [...removedFromHand, room.gameState.lastDrawnTile!];
        handAfterGang = handAfterAction;
    } else {
        // 四張牌都在手上 (例如 PLAYER_TURN_START 或 PLAYER_DRAWN 但摸到的不是槓牌)
        const { handAfterAction, newMeldTiles: removedFromHand } = removeTilesFromHand(player.hand, tileKindToGang, 4);
        if (!removedFromHand || removedFromHand.length !== 4) {
             if(player.socketId) room.io.to(player.socketId).emit('gameError', `暗槓時內部錯誤：無法從手牌移除4張 ${tileKindToGang}。`);
             TimerManager.startActionTimerForPlayer(room, playerId, 'turn');
             return false;
        }
        finalMeldTiles = removedFromHand;
        handAfterGang = handAfterAction;
    }
    
    player.hand = sortHandVisually(handAfterGang);
    // 暗槓後，玩家會重新摸牌，所以清除 lastDrawnTile (無論之前是什麼)
    room.gameState.lastDrawnTile = null; 

    const anGangMeld: Meld = {
        id: `meld-${player.id}-${Date.now()}`,
        designation: MeldDesignation.GANGZI,
        tiles: finalMeldTiles.sort((a,b) => TILE_KIND_DETAILS[b.kind].orderValue - TILE_KIND_DETAILS[a.kind].orderValue),
        isOpen: false, 
    };
    player.melds.push(anGangMeld);
    room.addLog(`${player.name} (座位: ${player.id}) 暗槓了 ${tileKindToGang}。請摸牌。`);
    room.broadcastActionAnnouncement("暗槓", playerId);

    room.gameState.gamePhase = GamePhase.PLAYER_TURN_START; 
    room.updateGameStatePlayers();
    TimerManager.startActionTimerForPlayer(room, player.id, 'turn'); 
    room.broadcastGameState();
    AIHandler.processAITurnIfNeeded(room); // 暗槓後輪到AI摸牌
    return true;
};

/**
 * @description 處理玩家宣告加槓 (手中碰牌摸到第四張) 的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 宣告加槓的玩家ID。
 * @param {TileKind} tileKindToGang - 要加槓的牌的種類 (與碰牌種類相同)。
 * @returns {boolean} 動作是否成功。
 */
export const processDeclareMingGangFromHand = (room: GameRoom, playerId: number, tileKindToGang: TileKind): boolean => {
    const player = room.players.find(p => p.id === playerId);
    if (!player) return false;
    
    if (room.gameState.currentPlayerIndex !== playerId || room.gameState.gamePhase !== GamePhase.PLAYER_DRAWN || !room.gameState.lastDrawnTile) {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '現在不是宣告加槓的時機。');
        return false;
    }
    if (room.gameState.lastDrawnTile.kind !== tileKindToGang) {
         if(player.socketId) room.io.to(player.socketId).emit('gameError', '您剛摸到的牌不是要加槓的牌。');
         return false;
    }
    TimerManager.clearActionTimer(room);

    const pengMeldIndex = player.melds.findIndex(m => m.designation === MeldDesignation.KEZI && m.tiles[0].kind === tileKindToGang && m.isOpen);
    if (pengMeldIndex === -1) {
         if(player.socketId) room.io.to(player.socketId).emit('gameError', `您沒有 ${tileKindToGang} 的碰牌可以加槓。`);
         TimerManager.startActionTimerForPlayer(room, playerId, 'turn');
        return false;
    }

    player.melds[pengMeldIndex].designation = MeldDesignation.GANGZI;
    player.melds[pengMeldIndex].tiles.push(room.gameState.lastDrawnTile); 
    player.melds[pengMeldIndex].tiles.sort((a,b) => TILE_KIND_DETAILS[b.kind].orderValue - TILE_KIND_DETAILS[a.kind].orderValue); // 修正排序為降序

    room.gameState.lastDrawnTile = null; 
    room.addLog(`${player.name} (座位: ${player.id}) 加槓了 ${tileKindToGang}。請摸牌。`);
    room.broadcastActionAnnouncement("加槓", playerId);

    room.gameState.gamePhase = GamePhase.PLAYER_TURN_START; 
    room.updateGameStatePlayers();
    TimerManager.startActionTimerForPlayer(room, player.id, 'turn'); 
    room.broadcastGameState();
    AIHandler.processAITurnIfNeeded(room); // 加槓後輪到AI摸牌
    return true;
};

/**
 * @description 處理玩家跳過宣告的邏輯 (舊的 PASS_CLAIM，在新模型中會被 SUBMIT_CLAIM_DECISION 取代)。
 *              此函數現在將玩家的 PASS_CLAIM 動作轉換為一個 'Pass' 的 SubmittedClaim。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 跳過宣告的玩家ID。
 * @returns {boolean} 動作是否成功。
 */
export const processPassClaim = (room: GameRoom, playerId: number): boolean => {
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        console.error(`[GameRoom ${room.roomId}] processPassClaim: 玩家 ${playerId} 未找到。`);
        return false;
    }
    // 驗證是否輪到該玩家做宣告決定 (全局宣告階段)
    if (room.gameState.gamePhase !== GamePhase.AWAITING_ALL_CLAIMS_RESPONSE && 
        !(room.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && room.gameState.playerMakingClaimDecision === playerId) /* 兼容舊流程 */) {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '現在不是你宣告或跳過的時候。');
        return false;
    }
    
    // 創建一個 'Pass' 的宣告決策
    const passDecision: SubmittedClaim = {
        playerId: playerId,
        action: 'Pass'
    };
    
    return processSubmitClaimDecision(room, passDecision);
};


/**
 * @description 處理玩家確認準備好下一局的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 確認的玩家ID。
 * @returns {boolean} 動作是否成功。
 */
export const processPlayerConfirmNextRound = (room: GameRoom, playerId: number): boolean => {
    if (room.gameState.gamePhase !== GamePhase.ROUND_OVER) {
        console.warn(`[GameRoom ${room.roomId}] 玩家 ${playerId} 嘗試在非 ROUND_OVER 階段確認下一局。`);
        return false;
    }
    if (!room.gameState.humanPlayersReadyForNextRound.includes(playerId)) {
        room.gameState.humanPlayersReadyForNextRound.push(playerId);
        const player = room.players.find(p => p.id === playerId);
        room.addLog(`玩家 ${player?.name || playerId} 已確認準備好下一局。`);
        room.broadcastGameState();

        const onlineHumanPlayers = room.players.filter(p => p.isHuman && p.isOnline);
        if (onlineHumanPlayers.length > 0 &&
            onlineHumanPlayers.every(p => room.gameState.humanPlayersReadyForNextRound.includes(p.id))) {
            room.addLog("所有在線真人玩家已確認，提前開始下一局。");
            TimerManager.clearNextRoundTimer(room); 
            RoundHandler.startGameRound(room, false);
        }
    }
    return true;
};

/**
 * @description 處理玩家的再戰投票。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 投票的玩家ID。
 * @param {'yes'} vote - 玩家的投票 ('yes' 表示同意)。
 * @returns {boolean} 動作是否成功。
 */
export const processPlayerVoteRematch = (room: GameRoom, playerId: number, vote: 'yes'): boolean => {
    return MatchHandler.processPlayerVoteRematch(room, playerId, vote);
};
