
// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { ServerPlayer } from '../Player';
import { Tile, TileKind, Meld, MeldDesignation, GamePhase, DiscardedTileInfo } from '../types'; // SHUNZI_DEFINITIONS was removed from here, DiscardedTileInfo added
import { INITIAL_HAND_SIZE_DEALER, TILE_KIND_DETAILS, SHUNZI_DEFINITIONS } from '../constants'; // SHUNZI_DEFINITIONS added here, TILE_KIND_DETAILS might still be needed
import { sortHandVisually } from '../utils/deckManager'; 
import { removeTilesFromHand, countTilesOfKind, checkWinCondition } from '../utils/gameRules';
import * as ClaimHandler from './claimHandler';
import * as TurnHandler from './turnHandler';
import * as RoundHandler from './roundHandler';
import * as TimerManager from './timerManager'; 

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
    room.gameState.lastDrawnTile = drawnTile; // 暫存摸到的牌，待打牌時才正式加入手牌
    room.gameState.gamePhase = GamePhase.PLAYER_DRAWN;
    room.addLog(`${player.name} (座位: ${player.id}) 摸了一張牌${player.isHuman && player.isOnline ? ` (${drawnTile.kind})` : ''}。`);
    TimerManager.startActionTimerForPlayer(room, playerId); 
    if (!player.isHuman || !player.isOnline) room.broadcastGameState(); // 如果是AI摸牌，則廣播狀態讓前端更新剩餘牌堆
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

    let tileToActuallyDiscard: Tile | null = null;

    if (room.gameState.gamePhase === GamePhase.PLAYER_DRAWN && room.gameState.lastDrawnTile) {
        if (room.gameState.lastDrawnTile.id === tileIdToDiscard) { // 打出剛摸的牌
            tileToActuallyDiscard = room.gameState.lastDrawnTile;
            // lastDrawnTile 已取出，手牌不變
        } else { // 打出手中的牌，並將剛摸的牌加入手牌
            tileToActuallyDiscard = player.removeTileFromHand(tileIdToDiscard);
            if (tileToActuallyDiscard) {
                player.addTileToHand(room.gameState.lastDrawnTile); // 將剛摸的牌加入手牌
            } else {
                if(player.socketId) room.io.to(player.socketId).emit('gameError', `在您的手中找不到要打出的牌 (ID: ${tileIdToDiscard})。`);
                return false;
            }
        }
        room.gameState.lastDrawnTile = null; // 清空剛摸的牌
    }
    else if (room.gameState.gamePhase === GamePhase.AWAITING_DISCARD) { // 通常是吃碰槓後，或莊家開局
        tileToActuallyDiscard = player.removeTileFromHand(tileIdToDiscard);
        if (!tileToActuallyDiscard) {
            if(player.socketId) room.io.to(player.socketId).emit('gameError', `在您的手中找不到要打出的牌 (ID: ${tileIdToDiscard})。`);
            return false;
        }
        // 如果是莊家開局，lastDrawnTile 可能代表第8張牌，此時應清空
        if (player.isDealer && room.gameState.turnNumber === 1 && room.gameState.lastDrawnTile?.id === tileIdToDiscard) {
            room.gameState.lastDrawnTile = null;
        } else if (player.isDealer && room.gameState.turnNumber === 1 && room.gameState.lastDrawnTile) {
             // 莊家打出的是手牌中的一張，則 lastDrawnTile (第8張) 應該已經加入手牌
             // Player.addTileToHand 應該在發牌時處理好
        }
         // 無論如何，打牌後清除 lastDrawnTile
        room.gameState.lastDrawnTile = null;
    } else {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '遊戲邏輯錯誤：不正確的打牌階段。');
        return false;
    }

    if (!tileToActuallyDiscard) {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '無法確定要打出的牌。');
        // 如果之前因 removeTileFromHand 失敗而返回，這裡可能不需要再次發送錯誤，但以防萬一
        return false;
    }
    
    player.hand = sortHandVisually(player.hand); // 打牌後對手牌進行排序

    // 修改: 將 DiscardedTileInfo 物件加入棄牌堆
    const discardedInfo: DiscardedTileInfo = { tile: tileToActuallyDiscard, discarderId: playerId };
    room.gameState.discardPile.unshift(discardedInfo);
    room.gameState.lastDiscardedTile = tileToActuallyDiscard; // lastDiscardedTile 仍儲存 Tile 物件本身
    room.gameState.lastDiscarderIndex = playerId;

    room.addLog(`${player.name} (座位: ${player.id}) 打出了 ${tileToActuallyDiscard.kind}。`);
    room.broadcastActionAnnouncement(tileToActuallyDiscard.kind, playerId);

    const discardedPlayerForLog = room.players.find(p => p.id === playerId);
    if (discardedPlayerForLog) {
        const handIds = new Set<string>();
        let duplicateIdInHandAfterDiscard = false;
        console.debug(`[GameRoom ${room.roomId}] 玩家 ${discardedPlayerForLog.name} (ID:${playerId}) 打出 ${tileToActuallyDiscard.kind} (ID:${tileToActuallyDiscard.id}) 後，手牌 (${discardedPlayerForLog.hand.length}張):`);
        discardedPlayerForLog.hand.forEach(t => {
            console.debug(`    牌: ${t.kind}, ID: ${t.id}`);
            if (handIds.has(t.id)) {
                console.error(`    !!!! 嚴重錯誤 !!!! 手牌中出現重複ID: ${t.id} (${t.kind})`);
                room.addLog(`嚴重錯誤: ${discardedPlayerForLog.name} 打牌後手牌重複ID: ${t.id}`);
                duplicateIdInHandAfterDiscard = true;
            }
            handIds.add(t.id);
        });
        if (!duplicateIdInHandAfterDiscard) {
            console.debug(`    手牌ID驗證唯一。`);
        }
    }

    room.updateGameStatePlayers();
    ClaimHandler.checkForClaims(room, tileToActuallyDiscard, playerId);
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

    let handToCheck: Tile[];
    let isSelfDrawnHu = false;
    let winTile: Tile | null = null;
    let actionTextForAnnouncement: "天胡" | "自摸" | "胡" = "胡";
    let isMultiHuTarget = false;

    if (room.gameState.currentPlayerIndex === playerId &&
        (room.gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
         (room.gameState.gamePhase === GamePhase.AWAITING_DISCARD && player.isDealer && room.gameState.turnNumber === 1 && player.hand.length + (room.gameState.lastDrawnTile ? 1:0) === INITIAL_HAND_SIZE_DEALER) ||
         (room.gameState.gamePhase === GamePhase.PLAYER_TURN_START && player.isDealer && room.gameState.turnNumber === 1 && player.hand.length === INITIAL_HAND_SIZE_DEALER -1) 
        )) {
        isSelfDrawnHu = true;
        winTile = room.gameState.lastDrawnTile;

        if ((room.gameState.gamePhase === GamePhase.PLAYER_TURN_START || room.gameState.gamePhase === GamePhase.AWAITING_DISCARD) && player.isDealer && room.gameState.turnNumber === 1) {
            // 天胡時，lastDrawnTile 代表的是初始發牌的第8張
            handToCheck = room.gameState.lastDrawnTile ? [...player.hand, room.gameState.lastDrawnTile] : [...player.hand];
             if(handToCheck.length !== INITIAL_HAND_SIZE_DEALER && player.isDealer && room.gameState.turnNumber === 1) {
                console.warn(`[GameRoom ${room.roomId}] 天胡檢查時手牌數量 (${handToCheck.length}) 不正確，應為 ${INITIAL_HAND_SIZE_DEALER}。莊家: ${player.name}`);
             }
            actionTextForAnnouncement = "天胡";
        } else {
            if (!room.gameState.lastDrawnTile) {
                 if(player.socketId) room.io.to(player.socketId).emit('gameError', '錯誤：宣告自摸時找不到剛摸的牌。'); return false;
            }
            handToCheck = [...player.hand, room.gameState.lastDrawnTile!];
            actionTextForAnnouncement = "自摸";
        }
    }
    else if (room.gameState.lastDiscardedTile &&
               room.gameState.potentialClaims.some(c => c.playerId === playerId && c.action === 'Hu') &&
               (room.gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION || room.gameState.gamePhase === GamePhase.AWAITING_CLAIMS_RESOLUTION)) {
        isSelfDrawnHu = false;
        winTile = room.gameState.lastDiscardedTile;
        handToCheck = [...player.hand, room.gameState.lastDiscardedTile]; // 食胡時，將棄牌加入手牌進行檢查
        actionTextForAnnouncement = "胡";

        const huClaimsForThisTile = room.gameState.potentialClaims.filter(c => c.action === 'Hu' && room.gameState.lastDiscardedTile && c.tiles && c.tiles.some(t => t.id === room.gameState.lastDiscardedTile!.id));
        if (huClaimsForThisTile.length > 1) {
            isMultiHuTarget = true;
        }

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
            // 自摸時，lastDrawnTile (即 winTile) 不應再放回手牌，它已經是手牌的一部分了
            if (winTile && room.gameState.lastDrawnTile && winTile.id === room.gameState.lastDrawnTile.id) {
                room.gameState.lastDrawnTile = null; // 清除，因為它已被計入手牌
            }
             // 天胡時，lastDrawnTile (第8張) 也被計入手牌
             if(actionTextForAnnouncement === "天胡" && room.gameState.lastDrawnTile){
                 player.addTileToHand(room.gameState.lastDrawnTile); // 確保第8張牌加入手牌
                 room.gameState.lastDrawnTile = null;
             }
        } else { // 食胡
            huMessage += `食胡 (ロン了 ${room.players.find(p=>p.id === room.gameState.lastDiscarderIndex)?.name || '上家'} 的 ${winTile!.kind})`;
            room.gameState.winningTileDiscarderId = room.gameState.lastDiscarderIndex;
            room.gameState.winningDiscardedTile = winTile;
            if (room.gameState.lastDiscardedTile && room.gameState.lastDiscardedTile.id === winTile!.id) {
                ClaimHandler.consumeDiscardedTileForMeld(room, winTile!.id); // 從棄牌堆移除
            }
            player.addTileToHand(winTile!); // 將胡的牌加入手牌
        }
        player.hand = sortHandVisually(player.hand); // 排序最終手牌

        huMessage += "了！";
        room.addLog(huMessage);
        room.broadcastActionAnnouncement(actionTextForAnnouncement, playerId, isMultiHuTarget);

        room.updateGameStatePlayers();
        RoundHandler.handleRoundEndFlow(room);
    } else {
        room.addLog(`${player.name} 宣告 ${actionTextForAnnouncement} 失敗 (詐胡)。`);
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '不符合胡牌條件。');

        if (!isSelfDrawnHu && room.gameState.playerMakingClaimDecision === playerId) {
             processPassClaim(room, playerId);
        }
        else if (isSelfDrawnHu) {
            if (actionTextForAnnouncement === "天胡") {
                // 天胡失敗，lastDrawnTile (第8張) 應加入手牌，等待打出
                if (room.gameState.lastDrawnTile) {
                    player.addTileToHand(room.gameState.lastDrawnTile);
                    player.hand = sortHandVisually(player.hand);
                    room.gameState.lastDrawnTile = null; // 已加入手牌
                }
                room.gameState.gamePhase = GamePhase.AWAITING_DISCARD;
            } else {
                // 自摸失敗，lastDrawnTile 保持，等待打出
                room.gameState.gamePhase = GamePhase.PLAYER_DRAWN;
            }
            TimerManager.startActionTimerForPlayer(room, playerId); 
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
    if (!player || room.gameState.playerMakingClaimDecision !== playerId || room.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION || !room.gameState.lastDiscardedTile || room.gameState.lastDiscardedTile.kind !== tileToPeng.kind) {
        if(player?.socketId) room.io.to(player.socketId).emit('gameError', '無效的碰牌宣告。');
        return false;
    }

    // 使用 removeTilesFromHand 工具函數，它處理從手牌副本中移除牌
    const { handAfterAction, newMeldTiles } = removeTilesFromHand(player.hand, tileToPeng.kind, 2);
    if (!newMeldTiles || newMeldTiles.length !== 2) {
        room.addLog(`錯誤: ${player.name} 無法碰 ${tileToPeng.kind}，手牌中該牌數量不足。`);
        ClaimHandler.handleInvalidClaim(room, player, 'Peng');
        return false;
    }
    player.hand = handAfterAction; // 更新玩家手牌
    player.hand = sortHandVisually(player.hand); // 排序

    const pengMeld: Meld = {
        id: `meld-${player.id}-${Date.now()}`,
        designation: MeldDesignation.KEZI,
        tiles: [...newMeldTiles, tileToPeng].sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue),
        isOpen: true,
        claimedFromPlayerId: room.gameState.lastDiscarderIndex!,
        claimedTileId: tileToPeng.id,
    };
    player.melds.push(pengMeld);
    room.addLog(`${player.name} (座位: ${player.id}) 碰了 ${tileToPeng.kind}。請出牌。`);
    room.broadcastActionAnnouncement("碰", playerId);

    ClaimHandler.consumeDiscardedTileForMeld(room, tileToPeng.id);
    ClaimHandler.clearClaimsAndTimer(room);
    room.gameState.currentPlayerIndex = player.id;
    room.gameState.gamePhase = GamePhase.AWAITING_DISCARD;
    room.updateGameStatePlayers();
    TimerManager.startActionTimerForPlayer(room, player.id); 
    room.broadcastGameState();
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
    if (!player || room.gameState.playerMakingClaimDecision !== playerId || room.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION || !room.gameState.lastDiscardedTile || room.gameState.lastDiscardedTile.kind !== tileToGang.kind) {
        if(player?.socketId) room.io.to(player.socketId).emit('gameError', '無效的槓牌宣告。');
        return false;
    }

    const { handAfterAction, newMeldTiles } = removeTilesFromHand(player.hand, tileToGang.kind, 3);
    if (!newMeldTiles || newMeldTiles.length !== 3) {
        room.addLog(`錯誤: ${player.name} 無法槓 ${tileToGang.kind}，手牌中該牌數量不足。`);
        ClaimHandler.handleInvalidClaim(room, player, 'Gang');
        return false;
    }
    player.hand = handAfterAction;
    player.hand = sortHandVisually(player.hand);

    const gangMeld: Meld = {
        id: `meld-${player.id}-${Date.now()}`,
        designation: MeldDesignation.GANGZI,
        tiles: [...newMeldTiles, tileToGang].sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue),
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
    TimerManager.startActionTimerForPlayer(room, player.id); 
    room.broadcastGameState();
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
    if (!player || room.gameState.playerMakingClaimDecision !== playerId ||
        (room.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION && room.gameState.gamePhase !== GamePhase.ACTION_PENDING_CHI_CHOICE) ||
        !room.gameState.lastDiscardedTile || room.gameState.lastDiscardedTile.id !== discardedTileToChi.id) {
        if(player?.socketId) room.io.to(player.socketId).emit('gameError', '無效的吃牌宣告。');
        return false;
    }
    if (tilesToChiWith.length !== 2) {
         if(player?.socketId) room.io.to(player.socketId).emit('gameError', '吃牌必須選擇兩張手牌。');
        return false;
    }

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
        ClaimHandler.handleInvalidClaim(room, player, 'Chi');
        return false;
    }

    player.hand = handCopy; // 更新手牌
    player.hand = sortHandVisually(player.hand); // 排序

    const threeTilesForShunzi: Tile[] = [...removedForChi, discardedTileToChi];
    let finalMeldTiles: Tile[] = [];

    for (const shunziDef of SHUNZI_DEFINITIONS) { 
        const kindsInDef = new Set(shunziDef);
        const kindsInThreeTiles = new Set(threeTilesForShunzi.map(t => t.kind));

        let isCurrentShunziDefMatch = true;
        if (kindsInDef.size !== kindsInThreeTiles.size) {
            isCurrentShunziDefMatch = false;
        } else {
            for (const kind of kindsInThreeTiles) {
                if (!kindsInDef.has(kind)) {
                    isCurrentShunziDefMatch = false;
                    break;
                }
            }
        }

        if (isCurrentShunziDefMatch) {
            finalMeldTiles = shunziDef.map(definedKind => 
                threeTilesForShunzi.find(actualTile => actualTile.kind === definedKind)!
            );
            break; 
        }
    }

    if (finalMeldTiles.length !== 3) {
        console.error(`[PlayerActionHandler ${room.roomId}] 無法確定 ${discardedTileToChi.kind} 的順子定義。吃牌手牌: ${removedForChi.map(t=>t.kind).join(',')}. 將使用備用排序邏輯。`);
        const sortedHandTilesFallback = [...removedForChi].sort(
            (a, b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue
        );
        finalMeldTiles = [sortedHandTilesFallback[0], discardedTileToChi, sortedHandTilesFallback[1]];
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
    TimerManager.startActionTimerForPlayer(room, player.id); 
    room.broadcastGameState();
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
    if (!player) return false;
    
    if (room.gameState.currentPlayerIndex !== playerId ||
        (room.gameState.gamePhase !== GamePhase.PLAYER_TURN_START && room.gameState.gamePhase !== GamePhase.PLAYER_DRAWN &&
        !(room.gameState.gamePhase === GamePhase.AWAITING_DISCARD && player.isDealer && room.gameState.turnNumber === 1))
       ) {
        if(player.socketId) room.io.to(player.socketId).emit('gameError', '現在不是宣告暗槓的時機。');
        return false;
    }

    // 組成檢查手牌，包含剛摸到的牌（如果有的話）
    const handForAnGangCheck = (room.gameState.gamePhase === GamePhase.PLAYER_DRAWN && room.gameState.lastDrawnTile)
        ? [...player.hand, room.gameState.lastDrawnTile]
        : (room.gameState.gamePhase === GamePhase.AWAITING_DISCARD && player.isDealer && room.gameState.turnNumber === 1 && room.gameState.lastDrawnTile)
        ? [...player.hand, room.gameState.lastDrawnTile]
        : player.hand;

    if (countTilesOfKind(handForAnGangCheck, tileKindToGang) < 4) {
         if(player.socketId) room.io.to(player.socketId).emit('gameError', `您沒有四張 ${tileKindToGang} 可以暗槓。`);
        return false;
    }

    // 實際從手牌中移除
    const { handAfterAction, newMeldTiles } = removeTilesFromHand(player.hand, tileKindToGang, 4);
    if (!newMeldTiles) { // 如果移除失敗 (理論上 countTilesOfKind 已檢查過)
         if(player.socketId) room.io.to(player.socketId).emit('gameError', `暗槓時移除手牌失敗。`);
        return false;
    }
    player.hand = handAfterAction;

    // 如果是在 PLAYER_DRAWN 階段且剛摸的牌不是組成槓子的那張，則將其加回手牌
    if (room.gameState.gamePhase === GamePhase.PLAYER_DRAWN && room.gameState.lastDrawnTile && room.gameState.lastDrawnTile.kind !== tileKindToGang) {
        player.addTileToHand(room.gameState.lastDrawnTile);
    }
    // 如果是莊家開局 AWAITING_DISCARD，且 lastDrawnTile (第8張) 不是槓子的一部分，也加回
    else if (room.gameState.gamePhase === GamePhase.AWAITING_DISCARD && player.isDealer && room.gameState.turnNumber === 1 && room.gameState.lastDrawnTile && room.gameState.lastDrawnTile.kind !== tileKindToGang) {
        player.addTileToHand(room.gameState.lastDrawnTile);
    }
    
    player.hand = sortHandVisually(player.hand);
    room.gameState.lastDrawnTile = null; // 無論如何，暗槓後清除 lastDrawnTile，因為接下來是摸牌

    const anGangMeld: Meld = {
        id: `meld-${player.id}-${Date.now()}`,
        designation: MeldDesignation.GANGZI,
        tiles: newMeldTiles, // 這四張是從手牌中移除的
        isOpen: false, // 暗槓
    };
    player.melds.push(anGangMeld);
    room.addLog(`${player.name} (座位: ${player.id}) 暗槓了 ${tileKindToGang}。請摸牌。`);
    room.broadcastActionAnnouncement("暗槓", playerId);

    room.gameState.gamePhase = GamePhase.PLAYER_TURN_START; // 暗槓後摸牌
    room.updateGameStatePlayers();
    TimerManager.startActionTimerForPlayer(room, player.id); 
    room.broadcastGameState();
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
    const pengMeldIndex = player.melds.findIndex(m => m.designation === MeldDesignation.KEZI && m.tiles[0].kind === tileKindToGang && m.isOpen);
    if (pengMeldIndex === -1) {
         if(player.socketId) room.io.to(player.socketId).emit('gameError', `您沒有 ${tileKindToGang} 的碰牌可以加槓。`);
        return false;
    }

    player.melds[pengMeldIndex].designation = MeldDesignation.GANGZI;
    player.melds[pengMeldIndex].tiles.push(room.gameState.lastDrawnTile); // 將剛摸的牌加入到面子中
    player.melds[pengMeldIndex].tiles.sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue);

    room.gameState.lastDrawnTile = null; // 清除剛摸的牌
    room.addLog(`${player.name} (座位: ${player.id}) 加槓了 ${tileKindToGang}。請摸牌。`);
    room.broadcastActionAnnouncement("加槓", playerId);

    room.gameState.gamePhase = GamePhase.PLAYER_TURN_START; // 加槓後摸牌
    room.updateGameStatePlayers();
    TimerManager.startActionTimerForPlayer(room, player.id); 
    room.broadcastGameState();
    return true;
};

/**
 * @description 處理玩家跳過宣告的邏輯。
 * @param {GameRoom} room - GameRoom 實例。
 * @param {number} playerId - 跳過宣告的玩家ID。
 * @returns {boolean} 動作是否成功。
 */
export const processPassClaim = (room: GameRoom, playerId: number): boolean => {
    const player = room.players.find(p => p.id === playerId);
    if (!player || room.gameState.playerMakingClaimDecision !== playerId || room.gameState.gamePhase !== GamePhase.AWAITING_PLAYER_CLAIM_ACTION) {
        if(player?.socketId) room.io.to(player.socketId).emit('gameError', '現在不是你宣告或跳過。');
        return false;
    }
    room.addLog(`${player.name} (座位: ${player.id}) 選擇跳過宣告。`);
    room.gameState.playerMakingClaimDecision = null;
    // 跳過宣告後，應該推進到下一個玩家的回合，並且是基於上一個棄牌者
    // 注意: 此處 afterDiscard 應為 true，因為我們是處理對棄牌的宣告的跳過
    TurnHandler.advanceToNextPlayerTurn(room, true); 
    return true;
};
