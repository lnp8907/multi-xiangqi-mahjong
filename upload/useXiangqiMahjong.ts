
import { useReducer, useCallback } from 'react';
import { GameState, Player, Tile, Meld, MeldDesignation, GamePhase, GameAction, Claim, TileKind, AIExecutableAction, Suit, RoomSettings } from '../types';
import { 
    INITIAL_HAND_SIZE_DEALER, 
    INITIAL_HAND_SIZE_NON_DEALER, 
    NUM_PLAYERS, 
    MAX_HAND_SIZE_BEFORE_DISCARD, 
    ACTION_PRIORITY, 
    TILE_KIND_DETAILS,
    CLAIM_DECISION_TIMEOUT_SECONDS,
    PLAYER_TURN_ACTION_TIMEOUT_SECONDS,
    NEXT_ROUND_COUNTDOWN_SECONDS, 
} from '../constants';
import { createInitialDeck, shuffleDeck, dealTiles } from '../utils/deckManager';
import { checkWinCondition, getChiOptions, canDeclareAnGang, canDeclareMingGangFromHand, findTileInHand, countTilesOfKind, removeTilesFromHand } from '../utils/gameRules';
import { playActionSound } from '../utils/audioManager'; 

const createInitialPlayer = (id: number, name: string, isHuman: boolean, isDealer: boolean): Player => ({
  id,
  name,
  isHuman,
  hand: [], 
  melds: [], 
  isDealer,
  score: 0, // Initialize score, e.g., to 0 or a default starting score like 25000
  pendingClaims: [], 
});

const initialState: GameState = {
  players: [], 
  deck: [], 
  discardPile: [], 
  currentPlayerIndex: 0, 
  dealerIndex: 0, 
  lastDiscarderIndex: 0,  
  gamePhase: GamePhase.LOADING, 
  lastDiscardedTile: null, 
  lastDrawnTile: null, 
  turnNumber: 0, 
  messageLog: ["遊戲載入中..."], 
  potentialClaims: [], 
  
  winnerId: null, 
  winningTileDiscarderId: null, 
  winType: null, 
  winningDiscardedTile: null, 

  isDrawGame: false, 
  chiOptions: null, 
  playerMakingClaimDecision: null, 
  actionTimer: null, 
  actionTimerType: null, 
  numberOfRounds: 1, 
  currentRound: 1,   
  matchOver: false,  
  nextRoundCountdown: null, 
  humanPlayersReadyForNextRound: [], 
  roomId: null,
  // FIX: Add missing clientPlayerId property to initialState
  clientPlayerId: null, 
};

const sortHandVisually = (hand: Tile[]): Tile[] => {
  return [...hand].sort((a, b) => {
    const detailsA = TILE_KIND_DETAILS[a.kind];
    const detailsB = TILE_KIND_DETAILS[b.kind];
    if (detailsA.suit !== detailsB.suit) {
      return detailsA.suit === Suit.BLACK ? -1 : 1; 
    }
    const groupOrderValue = (group: 0 | 1 | 2) => {
      if (group === 1) return 1; 
      if (group === 2) return 2; 
      if (group === 0) return 3; 
      return 4; 
    };
    if (detailsA.group !== detailsB.group) {
      return groupOrderValue(detailsA.group) - groupOrderValue(detailsB.group);
    }
    return detailsB.orderValue - detailsA.orderValue;
  });
};


function gameReducer(state: GameState, action: GameAction): GameState {
  let newState = { ...state, messageLog: [...state.messageLog] };
  newState.players = newState.players.map(p => ({
    ...p,
    hand: [...p.hand], 
    melds: p.melds.map(m => ({...m, tiles: [...m.tiles]})), 
    pendingClaims: p.pendingClaims ? [...p.pendingClaims] : []
  }));
  newState.humanPlayersReadyForNextRound = [...state.humanPlayersReadyForNextRound];


  const addLog = (message: string) => {
    newState.messageLog = [message, ...newState.messageLog.slice(0, 49)];
  };

  const clearClaimsAndTimer = () => {
    newState.players.forEach(p => p.pendingClaims = []);
    newState.potentialClaims = [];
    newState.playerMakingClaimDecision = null;
    newState.actionTimer = null;
    newState.actionTimerType = null;
    newState.chiOptions = null;
  };
  
  const currentNumPlayers = () => newState.players.length || NUM_PLAYERS; 

  const advanceToNextPlayerTurn = () => {
    newState.currentPlayerIndex = (newState.lastDiscarderIndex + 1) % currentNumPlayers();
    newState.gamePhase = GamePhase.PLAYER_TURN_START; 
    newState.turnNumber++; 
    newState.lastDiscardedTile = null; 
    newState.lastDrawnTile = null; 
    clearClaimsAndTimer(); 
    
    const nextPlayer = newState.players[newState.currentPlayerIndex];
    if (nextPlayer.isHuman) {
        newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
        newState.actionTimerType = 'turn';
        addLog(`所有宣告已處理或跳過。輪到 ${nextPlayer.name}。你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒行動。`);
    } else {
        addLog(`所有宣告已處理或跳過。輪到 ${nextPlayer.name}。`);
    }
  };
  
  const handleRoundEndFlow = () => {
    newState.humanPlayersReadyForNextRound = []; 
    // TODO: Add score calculation logic here based on winner, winType, etc.
    // For now, scores are just initialized and not updated.

    if (newState.currentRound < newState.numberOfRounds) {
        addLog(`第 ${newState.currentRound} 局結束。`);
        newState.gamePhase = GamePhase.ROUND_OVER;
        newState = gameReducer(newState, { type: 'SET_NEXT_ROUND_COUNTDOWN' });
    } else {
        addLog(`所有 ${newState.numberOfRounds} 局已完成！比賽結束。`);
        newState.gamePhase = GamePhase.GAME_OVER;
        newState.matchOver = true; 
    }
    clearClaimsAndTimer(); 
  };


  switch (action.type) {
    case 'INITIALIZE_GAME': {
      const { settings } = action;
      newState.messageLog = []; 
      addLog(`準備新局: ${settings.roomName} (${settings.maxPlayers}人房, 共${settings.numberOfRounds}局)...`);
      
      newState.roomId = settings.id;
      newState.numberOfRounds = settings.numberOfRounds; 
      // Only reset currentRound if it's a brand new game or a full rematch
      if (state.gamePhase === GamePhase.LOADING || state.players.length === 0 || (state.gamePhase === GamePhase.GAME_OVER && state.matchOver) || (action.type === 'INITIALIZE_GAME' && state.gamePhase !== GamePhase.ROUND_OVER /* from rematch */)) {
          newState.currentRound = 1;
      }
      newState.matchOver = false;
      newState.nextRoundCountdown = null;
      newState.humanPlayersReadyForNextRound = []; 


      const players: Player[] = [];
      const numActualPlayers = settings.maxPlayers;
      const numHumanPlayers = 1; 
      const numAiPlayers = settings.fillWithAI ? numActualPlayers - numHumanPlayers : 0;

      let newDealerIndex = state.dealerIndex;
      // Determine dealer for the first round of a match (or first game ever)
      if (state.gamePhase === GamePhase.LOADING || state.players.length === 0 || (state.gamePhase === GamePhase.GAME_OVER && state.matchOver) ) {
        newDealerIndex = Math.floor(Math.random() * numActualPlayers);
      } 
      // For subsequent rounds within a match (handled by START_NEXT_ROUND now) or if INITIALIZE_GAME is called for other reasons,
      // the dealer rotation will be handled by START_NEXT_ROUND. If it's a rematch, it's like a new game start.
      newState.dealerIndex = newDealerIndex;


      for (let i = 0; i < numHumanPlayers; i++) {
        const humanPlayerName = settings.playerName || `玩家 ${i + 1}`;
        players.push(createInitialPlayer(i, humanPlayerName, true, i === newState.dealerIndex));
        addLog(`${humanPlayerName} (真人玩家) 已加入房間。`);
      }
      for (let i = 0; i < numAiPlayers; i++) {
        const playerId = numHumanPlayers + i;
        const aiPlayerName = `電腦 ${i + 1}`;
        players.push(createInitialPlayer(playerId, aiPlayerName, false, playerId === newState.dealerIndex));
        addLog(`${aiPlayerName} (AI) 已加入房間。`);
      }
      
      newState.players = players.slice(0, numActualPlayers);

      if (newState.players.length === 0) {
          addLog("錯誤：沒有玩家可以開始遊戲。");
          newState.gamePhase = GamePhase.LOADING; 
          return newState;
      }
      if (newState.dealerIndex >= newState.players.length) {
          newState.dealerIndex = 0; 
      }
      newState.players.forEach((p,idx) => p.isDealer = (idx === newState.dealerIndex));

      newState.players.forEach(p => {
        p.hand = [];
        p.melds = [];
        p.score = 0; // Reset score on new game/match initialization
      });

      newState.deck = [];
      newState.discardPile = [];
      newState.lastDiscardedTile = null;
      newState.lastDrawnTile = null;
      newState.currentPlayerIndex = newState.dealerIndex;
      newState.lastDiscarderIndex = newState.dealerIndex; 
      newState.turnNumber = 0; 
      newState.winnerId = null;
      newState.winningTileDiscarderId = null;
      newState.winType = null;
      newState.winningDiscardedTile = null;
      newState.isDrawGame = false;
      clearClaimsAndTimer();

      newState.gamePhase = GamePhase.WAITING_FOR_PLAYERS;
      const dealerPlayer = newState.players[newState.dealerIndex];
      addLog(`第 ${newState.currentRound}/${newState.numberOfRounds} 局。莊家為 ${dealerPlayer.name}。等待主持人開始遊戲...`);
      
      return newState;
    }

    case 'START_GAME_DEAL': {
      // This action can be triggered by INITIALIZE_GAME (via WaitingRoomModal) or by START_NEXT_ROUND
      addLog(`第 ${newState.currentRound}/${newState.numberOfRounds} 局開始，正在發牌...`);
      const deck = shuffleDeck(createInitialDeck());
      const { hands, remainingDeck } = dealTiles(deck, newState.players, newState.dealerIndex, INITIAL_HAND_SIZE_DEALER, INITIAL_HAND_SIZE_NON_DEALER);
      
      newState.players.forEach((p, i) => {
        p.hand = hands[i];
        // Melds should be cleared by START_NEXT_ROUND or INITIALIZE_GAME, not here,
        // to allow previous melds to be visible until dealing starts.
        // p.melds = []; // This line is removed, melds are reset earlier.
      });
      newState.deck = remainingDeck;
      newState.discardPile = [];
      newState.lastDiscardedTile = null;
      newState.lastDrawnTile = null;
      
      newState.currentPlayerIndex = newState.dealerIndex;
      newState.lastDiscarderIndex = newState.dealerIndex; 
      newState.turnNumber = 1; 
      newState.isDrawGame = false; 
      newState.winnerId = null;   
      clearClaimsAndTimer();
      newState.humanPlayersReadyForNextRound = []; 

      const dealerPlayer = newState.players[newState.dealerIndex];
      if (dealerPlayer.hand.length === INITIAL_HAND_SIZE_DEALER) {
          dealerPlayer.hand = sortHandVisually(dealerPlayer.hand);
          if (dealerPlayer.hand.length > 0) {
              newState.lastDrawnTile = dealerPlayer.hand[dealerPlayer.hand.length - 1]; 
          }
          newState.gamePhase = GamePhase.AWAITING_DISCARD;
          if (dealerPlayer.isHuman) {
              newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
              newState.actionTimerType = 'turn';
              addLog(`輪到你打牌，你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒。`);
          } else {
              addLog(`輪到 ${dealerPlayer.name} 打牌。`);
          }
      } else { 
          newState.gamePhase = GamePhase.PLAYER_TURN_START;
          const currentPlayer = newState.players[newState.currentPlayerIndex];
           if (currentPlayer.isHuman) {
              newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
              newState.actionTimerType = 'turn';
              addLog(`輪到 ${currentPlayer.name} 摸牌，你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒。`);
          } else {
              addLog(`輪到 ${currentPlayer.name} 摸牌。`);
          }
      }
      return newState;
    }


    case 'DRAW_TILE': {
      if (newState.deck.length === 0) {
        addLog("牌堆已空！本局流局。");
        newState.isDrawGame = true;
        newState.actionTimer = null; newState.actionTimerType = null;
        handleRoundEndFlow(); 
        return newState;
      }
      const drawnTile = newState.deck[0];
      newState.deck = newState.deck.slice(1);
      newState.lastDrawnTile = drawnTile; 
      newState.gamePhase = GamePhase.PLAYER_DRAWN;
      
      const currentPlayer = newState.players[newState.currentPlayerIndex];

      if (currentPlayer.isHuman) {
        newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS; 
        newState.actionTimerType = 'turn';
        addLog(`${currentPlayer.name} 摸了一張牌 (${drawnTile.kind})。你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒決策。`);
      } else {
        addLog(`${currentPlayer.name} 摸了一張牌 (${drawnTile.kind})。`);
        newState.actionTimer = null; newState.actionTimerType = null; 
      }
      return newState;
    }

    case 'DISCARD_TILE': {
        const player = newState.players[newState.currentPlayerIndex];
        let tileToDiscard: Tile | null = null;
        
        const isDealerInitialAwaitingDiscard = 
            player.isDealer &&
            newState.turnNumber === 1 &&
            newState.gamePhase === GamePhase.AWAITING_DISCARD;

        if (newState.lastDrawnTile && action.tileId === newState.lastDrawnTile.id) {
            tileToDiscard = newState.lastDrawnTile;
            newState.lastDrawnTile = null; 

            if (isDealerInitialAwaitingDiscard) {
                const indexInHand = player.hand.findIndex(t => t.id === tileToDiscard!.id);
                if (indexInHand !== -1) {
                    player.hand.splice(indexInHand, 1);
                } else {
                    addLog(`警告: 莊家初始打牌，預期 lastDrawnTile (${tileToDiscard!.kind}) 在手牌中，但未找到。`);
                }
            }
        } else {
            const tileIndexInHand = player.hand.findIndex(t => t.id === action.tileId);

            if (tileIndexInHand === -1) {
                addLog(`錯誤: 在 ${player.name} 手中找不到牌 ID ${action.tileId} 來打出。`);
                return newState; 
            }
            tileToDiscard = player.hand[tileIndexInHand];
            player.hand.splice(tileIndexInHand, 1);

            if (newState.lastDrawnTile) {
                if (isDealerInitialAwaitingDiscard) {
                    newState.lastDrawnTile = null;
                } else {
                    player.hand.push(newState.lastDrawnTile);
                    newState.lastDrawnTile = null;
                }
            }
            player.hand = sortHandVisually(player.hand);
        }

        if (!tileToDiscard) {
            addLog(`錯誤: 無法確定要打出的牌 (tileToDiscard is null)。`);
            return newState; 
        }

        newState.discardPile = [tileToDiscard, ...newState.discardPile];
        newState.lastDiscardedTile = tileToDiscard;
        newState.lastDiscarderIndex = newState.currentPlayerIndex;
        addLog(`${player.name} 打出了 ${tileToDiscard.kind}。`);
        playActionSound("打牌", newState.lastDiscardedTile!.kind); 
        
        newState.actionTimer = null; 
        newState.actionTimerType = null;

        newState.potentialClaims = [];
        newState.players.forEach(p => p.pendingClaims = []); 

        for (let i = 0; i < currentNumPlayers(); i++) {
            const otherPlayer = newState.players[i];
            if (otherPlayer.id === newState.currentPlayerIndex) continue;

            const playerClaims: Claim[] = [];
            const handForHuCheck = [...otherPlayer.hand, newState.lastDiscardedTile!];
            if (checkWinCondition(handForHuCheck, otherPlayer.melds).isWin) {
                playerClaims.push({ playerId: otherPlayer.id, action: 'Hu', priority: ACTION_PRIORITY.HU });
            }
            if (countTilesOfKind(otherPlayer.hand, newState.lastDiscardedTile!.kind) === 3) {
                playerClaims.push({ playerId: otherPlayer.id, action: 'Gang', priority: ACTION_PRIORITY.GANG });
            }
            if (countTilesOfKind(otherPlayer.hand, newState.lastDiscardedTile!.kind) === 2) {
                playerClaims.push({ playerId: otherPlayer.id, action: 'Peng', priority: ACTION_PRIORITY.PENG });
            }
            if (otherPlayer.id === (newState.lastDiscarderIndex + 1) % currentNumPlayers()) {
                const chiOptions = getChiOptions(otherPlayer.hand, newState.lastDiscardedTile!);
                if (chiOptions.length > 0) {
                    playerClaims.push({ playerId: otherPlayer.id, action: 'Chi', priority: ACTION_PRIORITY.CHI });
                    if (otherPlayer.isHuman) newState.chiOptions = chiOptions;
                }
            }
            if (playerClaims.length > 0) {
                otherPlayer.pendingClaims = playerClaims.sort((a,b) => b.priority - a.priority);
                newState.potentialClaims.push(...playerClaims);
            }
        }
        newState.potentialClaims.sort((a,b) => b.priority - a.priority || a.playerId - b.playerId);

        if (newState.potentialClaims.length > 0) {
            newState.gamePhase = GamePhase.TILE_DISCARDED;
            return gameReducer(newState, { type: 'START_CLAIM_DECISION_PROCESS' });
        } else {
            advanceToNextPlayerTurn();
        }
        return newState;
    }
    
    case 'DECLARE_HU': {
        let playerDeclaringHu : Player | undefined;
        let handToCheck: Tile[];
        let isSelfDrawn = false;
        let usedLastDrawnTileForWin = false; 
        let winningTileForDisplay: Tile | null = null;

        if (newState.playerMakingClaimDecision !== null && newState.lastDiscardedTile) {
            playerDeclaringHu = newState.players.find(p => p.id === newState.playerMakingClaimDecision);
            if (!playerDeclaringHu) { addLog(`錯誤：宣告胡牌時找不到有效的宣告者。`); return newState; }
            handToCheck = [...playerDeclaringHu.hand, newState.lastDiscardedTile]; 
            winningTileForDisplay = newState.lastDiscardedTile;
            newState.winType = 'discard';
            newState.winningTileDiscarderId = newState.lastDiscarderIndex;
            newState.winningDiscardedTile = newState.lastDiscardedTile;
        } 
        else {
            playerDeclaringHu = newState.players[newState.currentPlayerIndex];
            handToCheck = newState.lastDrawnTile
                ? [...playerDeclaringHu.hand, newState.lastDrawnTile] 
                : playerDeclaringHu.hand; 
            isSelfDrawn = true; 
            winningTileForDisplay = newState.lastDrawnTile; 
            newState.winType = 'selfDrawn';
            newState.winningTileDiscarderId = null; 
            newState.winningDiscardedTile = null; 
            if (newState.lastDrawnTile) {
                const winWithDrawn = checkWinCondition([...playerDeclaringHu.hand, newState.lastDrawnTile], playerDeclaringHu.melds).isWin;
                const winWithoutDrawn = checkWinCondition(playerDeclaringHu.hand, playerDeclaringHu.melds).isWin;
                if (winWithDrawn && !winWithoutDrawn) usedLastDrawnTileForWin = true;
                else if (winWithDrawn && winWithoutDrawn) usedLastDrawnTileForWin = true;
            }
        }

        const winInfo = checkWinCondition(handToCheck, playerDeclaringHu.melds);
        if (winInfo.isWin) {
            const huTypeDisplay = newState.winType === 'selfDrawn' 
                ? (winningTileForDisplay ? `自摸 (${winningTileForDisplay.kind})` : "天胡") 
                : `食胡 (${winningTileForDisplay?.kind})`;
            addLog(`${playerDeclaringHu.name} ${huTypeDisplay}了！恭喜獲勝！`);
            playActionSound(newState.winType === 'selfDrawn' ? (winningTileForDisplay ? "自摸" : "天胡") : "胡牌", winningTileForDisplay?.kind);
            newState.winnerId = playerDeclaringHu.id;
            
            if (isSelfDrawn && usedLastDrawnTileForWin && newState.lastDrawnTile) {
                newState.lastDrawnTile = null; 
            } 
            else if (isSelfDrawn && newState.lastDrawnTile && !usedLastDrawnTileForWin) {
                playerDeclaringHu.hand.push(newState.lastDrawnTile);
                newState.lastDrawnTile = null;
            }
            if (newState.winType === 'discard') {
                newState.lastDiscardedTile = null; 
            }
            clearClaimsAndTimer();
            handleRoundEndFlow(); 
        } else { 
            addLog(`${playerDeclaringHu.name} 嘗試宣告${isSelfDrawn ? (winningTileForDisplay? "自摸":"天胡") : "食胡"}，但條件未達成 (詐胡)。`);
            newState.winType = null; newState.winningTileDiscarderId = null; newState.winningDiscardedTile = null;
            if (!isSelfDrawn && newState.playerMakingClaimDecision !== null) {
                 newState.potentialClaims = newState.potentialClaims.filter(c => !(c.playerId === newState.playerMakingClaimDecision && c.action === 'Hu'));
                 const player = newState.players.find(p => p.id === newState.playerMakingClaimDecision);
                 if(player) player.pendingClaims = player.pendingClaims?.filter(c => c.action !== 'Hu');
                 newState.playerMakingClaimDecision = null; 
                 if (player?.pendingClaims?.length > 0) {
                    if (newState.potentialClaims.length > 0) { 
                        return gameReducer(newState, { type: 'START_CLAIM_DECISION_PROCESS' });
                    } else {
                        advanceToNextPlayerTurn();
                    }
                 } else if (newState.potentialClaims.length > 0) { 
                    return gameReducer(newState, { type: 'START_CLAIM_DECISION_PROCESS' });
                 } else { 
                    advanceToNextPlayerTurn();
                 }
            } else if (isSelfDrawn) { 
                newState.gamePhase = newState.lastDrawnTile ? GamePhase.PLAYER_DRAWN : GamePhase.PLAYER_TURN_START;
                if (playerDeclaringHu.isHuman) {
                    newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS; 
                    newState.actionTimerType = 'turn';
                    addLog(`詐胡後，請繼續您的回合。你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒。`);
                }
            }
        }
        return newState;
    }

    case 'START_CLAIM_DECISION_PROCESS': 
    case 'CLAIM_PENG': 
    case 'CLAIM_GANG': 
    case 'DECLARE_AN_GANG': 
    case 'DECLARE_MING_GANG_FROM_HAND': 
    case 'CLAIM_CHI': 
    case 'PASS_CLAIM': 
    case 'ACTION_PENDING_CHI_CHOICE': 
    case 'SET_PLAYER_CLAIM_ACTION': 
    case 'RESOLVE_CLAIMS': 
    case 'DECREMENT_ACTION_TIMER': 
    case 'ACTION_TIMER_EXPIRED': {
        if (action.type === 'CLAIM_PENG') {
            if (newState.playerMakingClaimDecision === null || !newState.lastDiscardedTile) { addLog(`錯誤: 無效的碰牌宣告。`); return newState; }
            const player = newState.players.find(p => p.id === newState.playerMakingClaimDecision);
            if (!player) { addLog(`錯誤: 找不到碰牌玩家。`); return newState; }
            const tileToPeng = newState.lastDiscardedTile;

            const { handAfterAction, newMeld } = removeTilesFromHand(player.hand, tileToPeng.kind, 2);
            if (!newMeld || newMeld.length !== 2) {
                addLog(`錯誤: ${player.name} 無法碰 ${tileToPeng.kind}，數量不足。`);
                newState.potentialClaims = newState.potentialClaims.filter(c => !(c.playerId === player.id && c.action === 'Peng'));
                if(player) player.pendingClaims = player.pendingClaims?.filter(c => c.action !== 'Peng');
                newState.playerMakingClaimDecision = null;
                return gameReducer(newState, { type: 'START_CLAIM_DECISION_PROCESS' });
            }
            player.hand = handAfterAction;
            const pengMeld: Meld = {
                id: `meld-${player.id}-${Date.now()}`,
                designation: MeldDesignation.KEZI, 
                tiles: [...newMeld, tileToPeng].sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue),
                isOpen: true,
                claimedFromPlayerId: newState.lastDiscarderIndex,
                claimedTileId: tileToPeng.id,
            };
            player.melds.push(pengMeld);
            addLog(`${player.name} 碰了 ${tileToPeng.kind}。請出牌。`);
            playActionSound("碰", tileToPeng.kind);
            if(newState.discardPile.length > 0 && newState.discardPile[0].id === tileToPeng.id){ 
                newState.discardPile.shift(); 
            } else {
                addLog(`警告: 嘗試碰的牌 ${tileToPeng.kind} (${tileToPeng.id}) 並非棄牌堆的最新一張。`);
                newState.discardPile = newState.discardPile.filter(t => t.id !== tileToPeng.id);
            }
            newState.lastDiscardedTile = null; 
            clearClaimsAndTimer(); 
            newState.currentPlayerIndex = player.id; 
            newState.gamePhase = GamePhase.AWAITING_DISCARD; 
            if (player.isHuman) {
                newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
                newState.actionTimerType = 'turn';
                addLog(`輪到你出牌，你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒。`);
            }
            return newState;
        }
        
        if (action.type === 'START_CLAIM_DECISION_PROCESS') {
            if (!newState.lastDiscardedTile || newState.potentialClaims.length === 0) {
                advanceToNextPlayerTurn();
                return newState;
            }
            const nextClaimToProcess = newState.potentialClaims[0];
            const claimantId = nextClaimToProcess.playerId;
            const claimant = newState.players.find(p => p.id === claimantId);

            if (claimant) {
                newState.playerMakingClaimDecision = claimant.id;
                const claimsForThisPlayer = claimant.pendingClaims || [];
                if (claimant.isHuman) {
                    if (claimsForThisPlayer.length > 0) {
                        addLog(`${claimant.name}，你可以宣告 ${claimsForThisPlayer.map(c => c.action).join('/')}。你有 ${CLAIM_DECISION_TIMEOUT_SECONDS} 秒時間決定。`);
                        newState.actionTimer = CLAIM_DECISION_TIMEOUT_SECONDS;
                        newState.actionTimerType = 'claim';
                        newState.gamePhase = GamePhase.AWAITING_PLAYER_CLAIM_ACTION;
                    } else { 
                        newState.potentialClaims = newState.potentialClaims.filter(c => c.playerId !== claimant.id);
                        return gameReducer(newState, {type: 'START_CLAIM_DECISION_PROCESS'});
                    }
                } else { 
                    newState.gamePhase = GamePhase.AWAITING_CLAIMS_RESOLUTION; 
                    addLog(`輪到 ${claimant.name} (AI) 決定是否宣告...`);
                    newState.actionTimer = null; newState.actionTimerType = null;
                }
            } else { 
                advanceToNextPlayerTurn();
            }
            return newState;
        }
        
        if (action.type === 'DECREMENT_ACTION_TIMER') {
            if (newState.actionTimer !== null && newState.actionTimer > 0) {
                newState.actionTimer--;
            }
            return newState;
        }

        if (action.type === 'ACTION_TIMER_EXPIRED') {
            const explicitTileIdFromPayload = action.payload?.explicitlySelectedTileId;
            const playerWhoseTimerExpired = newState.players.find(p =>
                p.id === (newState.actionTimerType === 'claim' ? newState.playerMakingClaimDecision : newState.currentPlayerIndex)
            );
            const playerName = playerWhoseTimerExpired?.name || "玩家";

            if (newState.actionTimerType === 'claim') {
                addLog(`${playerName} 的宣告時間到，自動跳過。`);
                newState.potentialClaims = newState.potentialClaims.filter(c => c.playerId !== newState.playerMakingClaimDecision);
                if (playerWhoseTimerExpired) playerWhoseTimerExpired.pendingClaims = [];
                newState.playerMakingClaimDecision = null;
                newState.actionTimer = null;
                newState.actionTimerType = null;
                newState.chiOptions = null; 
                if (newState.potentialClaims.length > 0) {
                    return gameReducer(newState, { type: 'START_CLAIM_DECISION_PROCESS' });
                } else {
                    advanceToNextPlayerTurn();
                }
            } else if (newState.actionTimerType === 'turn') {
                addLog(`${playerName} 的回合行動時間到。`);
                const currentPlayer = newState.players[newState.currentPlayerIndex];

                if (newState.gamePhase === GamePhase.PLAYER_TURN_START) {
                    addLog(`自動為 ${playerName} 摸牌。`);
                    newState = gameReducer(newState, { type: 'DRAW_TILE' });
                } else if (newState.gamePhase === GamePhase.PLAYER_DRAWN || newState.gamePhase === GamePhase.AWAITING_DISCARD) {
                    let tileIdToDiscard: string | null = null;
                    let discardMethodMessage = "";
                    let tileToDiscardObjectForLog: Tile | null | undefined = null;

                    const isValidExplicitSelection = explicitTileIdFromPayload && (
                        currentPlayer.hand.some(t => t.id === explicitTileIdFromPayload) ||
                        (newState.lastDrawnTile?.id === explicitTileIdFromPayload && newState.gamePhase === GamePhase.PLAYER_DRAWN)
                    );

                    if (isValidExplicitSelection) {
                        tileIdToDiscard = explicitTileIdFromPayload!;
                        discardMethodMessage = `打出選中的牌`;
                    } else if (newState.gamePhase === GamePhase.PLAYER_DRAWN && newState.lastDrawnTile) {
                        tileIdToDiscard = newState.lastDrawnTile.id;
                        discardMethodMessage = `打出剛摸到的牌`;
                    } else if (currentPlayer.hand.length > 0) {
                        const sortedHand = sortHandVisually(currentPlayer.hand);
                        tileIdToDiscard = sortedHand[sortedHand.length - 1].id; 
                        discardMethodMessage = `打出手牌中最右邊的牌`;
                    }

                    if (tileIdToDiscard) {
                        if (newState.lastDrawnTile?.id === tileIdToDiscard) {
                            tileToDiscardObjectForLog = newState.lastDrawnTile;
                        } else {
                            tileToDiscardObjectForLog = currentPlayer.hand.find(t => t.id === tileIdToDiscard);
                        }
                        addLog(`自動為 ${playerName} ${discardMethodMessage} (${tileToDiscardObjectForLog?.kind || '未知牌'})。`);
                        newState = gameReducer(newState, { type: 'DISCARD_TILE', tileId: tileIdToDiscard });
                    } else {
                        addLog(`錯誤: ${playerName} 在 ${newState.gamePhase} 時超時，但無牌可打。`);
                        newState.actionTimer = null;
                        newState.actionTimerType = null;
                    }
                }
            } else {
                addLog(`計時器到期，但類型未知: ${newState.actionTimerType}`);
            }
            
            const currentActionTimerType = newState.actionTimerType; 
            if (newState.actionTimerType === currentActionTimerType && newState.actionTimer !== null) {
                newState.actionTimer = null;
                newState.actionTimerType = null;
            }
            return newState;
        }
        
        if (action.type === 'CLAIM_GANG') { 
            if (newState.playerMakingClaimDecision === null || !newState.lastDiscardedTile) { addLog(`錯誤: 無效的明槓宣告。`); return newState; }
            const player = newState.players.find(p => p.id === newState.playerMakingClaimDecision);
            if (!player) { addLog(`錯誤: 找不到槓牌玩家。`); return newState; }
            const tileToGang = newState.lastDiscardedTile;

            const { handAfterAction, newMeld } = removeTilesFromHand(player.hand, tileToGang.kind, 3);
            if (!newMeld || newMeld.length !== 3) {
                addLog(`錯誤: ${player.name} 無法槓 ${tileToGang.kind}，數量不足。`);
                newState.potentialClaims = newState.potentialClaims.filter(c => !(c.playerId === player.id && c.action === 'Gang'));
                if(player) player.pendingClaims = player.pendingClaims?.filter(c => c.action !== 'Gang');
                newState.playerMakingClaimDecision = null;
                return gameReducer(newState, { type: 'START_CLAIM_DECISION_PROCESS' });
            }
            player.hand = handAfterAction;
            const gangMeld: Meld = {
                id: `meld-${player.id}-${Date.now()}`,
                designation: MeldDesignation.GANGZI,
                tiles: [...newMeld, tileToGang].sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue),
                isOpen: true,
                claimedFromPlayerId: newState.lastDiscarderIndex,
                claimedTileId: tileToGang.id, 
            };
            player.melds.push(gangMeld);
            playActionSound("明槓", tileToGang.kind);
            if(newState.discardPile.length > 0 && newState.discardPile[0].id === tileToGang.id){
                newState.discardPile.shift();
            } else {
                addLog(`警告: 嘗試槓的牌 ${tileToGang.kind} (${tileToGang.id}) 並非棄牌堆的最新一張。`);
                newState.discardPile = newState.discardPile.filter(t => t.id !== tileToGang.id);
            }
            newState.lastDiscardedTile = null;
            clearClaimsAndTimer();
            newState.currentPlayerIndex = player.id;
            if (newState.deck.length > 0) {
                const replacementTile = newState.deck[0]; 
                newState.deck = newState.deck.slice(1);
                newState.lastDrawnTile = replacementTile;
                addLog(`${player.name} 明槓 ${tileToGang.kind} 並補花 (${replacementTile.kind})。`);
                newState.gamePhase = GamePhase.PLAYER_DRAWN;
                if (player.isHuman) {
                    newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
                    newState.actionTimerType = 'turn';
                    addLog(`請決策，你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒。`);
                }
            } else {
                addLog(`${player.name} 明槓 ${tileToGang.kind}。牌堆已空，無法補花。請出牌。`);
                newState.gamePhase = GamePhase.AWAITING_DISCARD;
                if (player.isHuman) {
                    newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
                    newState.actionTimerType = 'turn';
                    addLog(`請出牌，你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒。`);
                }
            }
            return newState;
        }

        if (action.type === 'DECLARE_AN_GANG') {
            const player = newState.players[newState.currentPlayerIndex];
            const tileKindToGang = action.tileKind;
            let handToModify = [...player.hand]; 
            let anGangTiles: Tile[] = [];
            let usedLastDrawnTile = false;

            if (newState.lastDrawnTile && newState.lastDrawnTile.kind === tileKindToGang && countTilesOfKind(player.hand, tileKindToGang) === 3) {
                anGangTiles = player.hand.filter(t => t.kind === tileKindToGang); 
                anGangTiles.push(newState.lastDrawnTile); 
                handToModify = player.hand.filter(t => t.kind !== tileKindToGang); 
                usedLastDrawnTile = true;
            } 
            else if (countTilesOfKind(player.hand, tileKindToGang) === 4) { 
                anGangTiles = player.hand.filter(t => t.kind === tileKindToGang); 
                handToModify = player.hand.filter(t => t.kind !== tileKindToGang); 
                if (newState.lastDrawnTile && newState.lastDrawnTile.kind !== tileKindToGang) {
                    handToModify.push(newState.lastDrawnTile); 
                } else if (newState.lastDrawnTile && newState.lastDrawnTile.kind === tileKindToGang) {
                    addLog(`警告: 暗槓時，手牌已有4張 ${tileKindToGang}，剛摸的牌 (${newState.lastDrawnTile.kind}) 也是。`);
                    usedLastDrawnTile = true; 
                }
            } else {
                addLog(`錯誤: ${player.name} 無法暗槓 ${tileKindToGang}，條件不符。`);
                return newState; 
            }

            player.hand = handToModify; 
            const anGangMeld: Meld = {
                id: `meld-${player.id}-${Date.now()}`,
                designation: MeldDesignation.GANGZI,
                tiles: anGangTiles.sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue),
                isOpen: false, 
            };
            player.melds.push(anGangMeld);
            if(usedLastDrawnTile) newState.lastDrawnTile = null;
            playActionSound("暗槓", action.tileKind);
            newState.actionTimer = null; newState.actionTimerType = null;

            if (newState.deck.length > 0) {
                const replacementTile = newState.deck[0]; 
                newState.deck = newState.deck.slice(1);
                newState.lastDrawnTile = replacementTile; 
                addLog(`${player.name} 宣告暗槓 ${action.tileKind} 並補花 (${replacementTile.kind})。`);
                newState.gamePhase = GamePhase.PLAYER_DRAWN;
                if (player.isHuman) {
                    newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
                    newState.actionTimerType = 'turn';
                    addLog(`請決策，你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒。`);
                }
            } else {
                addLog(`${player.name} 宣告暗槓 ${action.tileKind}。牌堆已空，無法補花。請出牌。`);
                newState.gamePhase = GamePhase.AWAITING_DISCARD; 
                if (player.isHuman) {
                    newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
                    newState.actionTimerType = 'turn';
                    addLog(`請出牌，你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒。`);
                }
            }
            return newState;
        }

        if (action.type === 'DECLARE_MING_GANG_FROM_HAND') { 
            const player = newState.players[newState.currentPlayerIndex];
            const tileKindToUpgrade = action.tileKind;

            if (!newState.lastDrawnTile || newState.lastDrawnTile.kind !== tileKindToUpgrade) {
                addLog(`錯誤: ${player.name} 加槓 ${tileKindToUpgrade} 失敗，並非剛摸到此牌。摸到的是: ${newState.lastDrawnTile?.kind}`);
                newState.gamePhase = GamePhase.PLAYER_DRAWN; 
                return newState;
            }

            const pengMeldIndex = player.melds.findIndex(m => m.designation === MeldDesignation.KEZI && m.tiles[0].kind === tileKindToUpgrade && m.isOpen);
            if (pengMeldIndex === -1) {
                addLog(`錯誤: ${player.name} 沒有 ${tileKindToUpgrade} 的碰牌可加槓。`);
                newState.gamePhase = GamePhase.PLAYER_DRAWN; 
                return newState;
            }

            const tileToAdd = newState.lastDrawnTile; 
            newState.lastDrawnTile = null; 

            player.melds[pengMeldIndex].designation = MeldDesignation.GANGZI; 
            player.melds[pengMeldIndex].tiles.push(tileToAdd); 
            player.melds[pengMeldIndex].tiles.sort((a,b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue);
            playActionSound("加槓", tileKindToUpgrade);
            newState.actionTimer = null; newState.actionTimerType = null;

            if (newState.deck.length > 0) {
                const replacementTile = newState.deck[0]; 
                newState.deck = newState.deck.slice(1);
                newState.lastDrawnTile = replacementTile;
                addLog(`${player.name} 將 ${tileKindToUpgrade} 的碰牌加槓並補花 (${replacementTile.kind})。`);
                newState.gamePhase = GamePhase.PLAYER_DRAWN;
                if (player.isHuman) {
                    newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
                    newState.actionTimerType = 'turn';
                    addLog(`請決策，你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒。`);
                }
            } else {
                addLog(`${player.name} 將 ${tileKindToUpgrade} 的碰牌加槓。牌堆已空，無法補花。請出牌。`);
                newState.gamePhase = GamePhase.AWAITING_DISCARD;
                if (player.isHuman) {
                    newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
                    newState.actionTimerType = 'turn';
                    addLog(`請出牌，你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒。`);
                }
            }
            return newState;
        }
        
        if (action.type === 'CLAIM_CHI') {
            if (newState.playerMakingClaimDecision === null || !newState.lastDiscardedTile) { addLog(`錯誤: 無效的吃牌宣告。`); return newState; }
            const player = newState.players.find(p => p.id === newState.playerMakingClaimDecision);
            if (!player) { addLog(`錯誤: 找不到吃牌玩家。`); return newState; }
            const { tilesToChiWith, discardedTile } = action; 

            let handAfterChi = [...player.hand]; 
            for (const tile of tilesToChiWith) {
                const idx = handAfterChi.findIndex(t => t.id === tile.id);
                if (idx !== -1) {
                    handAfterChi.splice(idx, 1); 
                } else {
                    addLog(`錯誤: ${player.name} 手中找不到 ${tile.kind} 來吃牌。`);
                    newState.potentialClaims = newState.potentialClaims.filter(c => !(c.playerId === player.id && c.action === 'Chi'));
                    if(player) player.pendingClaims = player.pendingClaims?.filter(c => c.action !== 'Chi');
                    newState.playerMakingClaimDecision = null; 
                    return gameReducer(newState, { type: 'START_CLAIM_DECISION_PROCESS' }); 
                }
            }
            player.hand = handAfterChi; 

            let meldTiles = [...tilesToChiWith, discardedTile];
            meldTiles.sort((a, b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue); 
            
            const chiMeld: Meld = {
                id: `meld-${player.id}-${Date.now()}`,
                designation: MeldDesignation.SHUNZI,
                tiles: meldTiles,
                isOpen: true,
                claimedFromPlayerId: newState.lastDiscarderIndex,
                claimedTileId: discardedTile.id,
            };
            player.melds.push(chiMeld);
            addLog(`${player.name} 吃了 ${discardedTile.kind}。請出牌。`);
            playActionSound("吃", discardedTile.kind);

            if(newState.discardPile.length > 0 && newState.discardPile[0].id === discardedTile.id){
                newState.discardPile.shift();
            } else {
                addLog(`警告: 嘗試吃的牌 ${discardedTile.kind} (${discardedTile.id}) 並非棄牌堆的最新一張。`);
                newState.discardPile = newState.discardPile.filter(t => t.id !== discardedTile.id);
            }
            newState.lastDiscardedTile = null; 
            clearClaimsAndTimer(); 
            newState.currentPlayerIndex = player.id; 
            newState.gamePhase = GamePhase.AWAITING_DISCARD; 
            if (player.isHuman) {
                newState.actionTimer = PLAYER_TURN_ACTION_TIMEOUT_SECONDS;
                newState.actionTimerType = 'turn';
                addLog(`輪到你出牌，你有 ${PLAYER_TURN_ACTION_TIMEOUT_SECONDS} 秒。`);
            }
            return newState;
        }

        if (action.type === 'PASS_CLAIM') {
            const passerId = newState.playerMakingClaimDecision !== null ? newState.playerMakingClaimDecision : newState.currentPlayerIndex;
            const player = newState.players.find(p => p.id === passerId);
            if (!player) { addLog(`錯誤: 跳過宣告時找不到玩家。`); return newState; }
            addLog(`${player.name} 選擇跳過宣告。`);
            newState.potentialClaims = newState.potentialClaims.filter(c => c.playerId !== player.id);
            if(player) player.pendingClaims = []; 
            newState.playerMakingClaimDecision = null; 
            newState.actionTimer = null; 
            newState.actionTimerType = null;
            newState.chiOptions = null; 
            if (newState.potentialClaims.length > 0) {
                return gameReducer(newState, { type: 'START_CLAIM_DECISION_PROCESS' });
            } else {
                advanceToNextPlayerTurn();
            }
            return newState;
        }

        if (action.type === 'ACTION_PENDING_CHI_CHOICE') {
            const player = newState.players.find(p => p.id === newState.playerMakingClaimDecision);
            if (player && player.isHuman && newState.chiOptions && newState.chiOptions.length > 0) {
                newState.gamePhase = GamePhase.ACTION_PENDING_CHI_CHOICE;
                addLog(`${player.name} 正在選擇吃牌組合。`);
            } else {
                addLog(`警告: ACTION_PENDING_CHI_CHOICE 呼叫但條件不符。`);
                if (newState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION) {
                    return gameReducer(newState, { type: 'PASS_CLAIM' });
                }
            }
            return newState;
        }
        
        if (action.type === 'SET_PLAYER_CLAIM_ACTION') {
          const playerToUpdate = newState.players.find(p => p.id === action.playerId);
          if (playerToUpdate) {
            playerToUpdate.pendingClaims = action.claims.sort((a, b) => b.priority - a.priority);
            addLog(`為玩家 ${playerToUpdate.name} 更新了可宣告動作: ${action.claims.map(c => c.action).join(', ')}`);
          } else {
            addLog(`錯誤: SET_PLAYER_CLAIM_ACTION 無法找到玩家 ID ${action.playerId}`);
          }
          return newState;
        }

        if (action.type === 'RESOLVE_CLAIMS') {
            addLog("警告: RESOLVE_CLAIMS 被呼叫，此流程應由 START_CLAIM_DECISION_PROCESS 管理。");
            if (newState.potentialClaims.length === 0) {
                advanceToNextPlayerTurn();
            } else {
                return gameReducer(newState, { type: 'START_CLAIM_DECISION_PROCESS' });
            }
            return newState;
        }
    } 

    case 'SET_NEXT_ROUND_COUNTDOWN': {
        newState.nextRoundCountdown = NEXT_ROUND_COUNTDOWN_SECONDS;
        newState.humanPlayersReadyForNextRound = []; 
        addLog(`下一局將在 ${newState.nextRoundCountdown} 秒後開始準備...`);
        return newState;
    }
    case 'DECREMENT_NEXT_ROUND_COUNTDOWN': {
        if (newState.nextRoundCountdown !== null && newState.nextRoundCountdown > 0) {
            newState.nextRoundCountdown--;
            if (newState.nextRoundCountdown === 0) {
                newState.nextRoundCountdown = null; 
                newState.humanPlayersReadyForNextRound = []; 
                addLog("倒數結束，自動開始下一局準備...");
                return gameReducer(newState, { type: 'START_NEXT_ROUND' });
            }
        }
        return newState;
    }
    case 'PLAYER_CONFIRM_NEXT_ROUND': {
        const playerId = action.playerId;
        if (!newState.humanPlayersReadyForNextRound.includes(playerId)) {
            newState.humanPlayersReadyForNextRound.push(playerId);
            const humanPlayer = newState.players.find(p => p.id === playerId);
            addLog(`${humanPlayer?.name || '玩家'} 已確認下一局。`);
        }

        const totalHumanPlayers = newState.players.filter(p => p.isHuman).length;
        if (newState.humanPlayersReadyForNextRound.length === totalHumanPlayers && totalHumanPlayers > 0) {
            addLog("所有真人玩家已確認，立即準備下一局...");
            newState.nextRoundCountdown = null; 
            newState.humanPlayersReadyForNextRound = []; 
            return gameReducer(newState, { type: 'START_NEXT_ROUND' });
        }
        return newState;
    }
    case 'START_NEXT_ROUND': { 
        if (newState.currentRound >= newState.numberOfRounds) {
            addLog("錯誤: START_NEXT_ROUND 被呼叫，但所有局數已完成。");
            newState.gamePhase = GamePhase.GAME_OVER;
            newState.matchOver = true;
            return newState;
        }
        
        newState.currentRound++;
        addLog(`準備開始第 ${newState.currentRound}/${newState.numberOfRounds} 局...`);
        newState.humanPlayersReadyForNextRound = []; 
        newState.nextRoundCountdown = null;
        
        // Dealer rotation logic
        const numActualPlayers = newState.players.length;
        if (newState.winnerId === null || (newState.winnerId !== null && newState.winnerId !== newState.dealerIndex)) {
            newState.dealerIndex = (newState.dealerIndex + 1) % numActualPlayers;
        } // Else, dealer won, so dealer remains the same (連莊)
        
        newState.players.forEach((p,idx) => p.isDealer = (idx === newState.dealerIndex));

        // Reset per-round game state
        newState.players.forEach(p => {
            p.hand = [];
            p.melds = [];
            // score is NOT reset here, it should persist across rounds within a match
            // it's reset in INITIALIZE_GAME for a new match
        });
        newState.deck = [];
        newState.discardPile = [];
        newState.lastDiscardedTile = null;
        newState.lastDrawnTile = null;
        newState.currentPlayerIndex = newState.dealerIndex;
        newState.lastDiscarderIndex = newState.dealerIndex; 
        newState.turnNumber = 0; 
        newState.winnerId = null;
        newState.winningTileDiscarderId = null;
        newState.winType = null;
        newState.winningDiscardedTile = null;
        newState.isDrawGame = false;
        clearClaimsAndTimer();

        // Directly dispatch START_GAME_DEAL to bypass WaitingRoomModal
        return gameReducer(newState, { type: 'START_GAME_DEAL' });
    }
    case 'REQUEST_REMATCH': {
        addLog(`請求再戰 ${newState.numberOfRounds} 局...`);
        newState.humanPlayersReadyForNextRound = []; 
        // For rematch, we simulate confirmation and go through INITIALIZE_GAME to show WaitingRoomModal
        return gameReducer(newState, { type: 'CONFIRM_REMATCH' });
    }
    case 'CONFIRM_REMATCH': {
        addLog("確認重賽！遊戲將重新開始。");
        newState.currentRound = 1; 
        newState.matchOver = false;  
        newState.humanPlayersReadyForNextRound = []; 
        newState.nextRoundCountdown = null;
        
        if (!state.roomId) {
            addLog("錯誤：無法確認重賽，房間ID未知。");
            newState.gamePhase = GamePhase.GAME_OVER; 
            return newState;
        }
        const humanPlayer = state.players.find(p=>p.isHuman);
        const currentSettings: RoomSettings = {
            id: state.roomId,
            roomName: humanPlayer?.name ? `${humanPlayer.name}的房間` : state.roomId, 
            maxPlayers: state.players.length || NUM_PLAYERS,
            humanPlayers: state.players.filter(p => p.isHuman).length || 1, // FIX: Added humanPlayers
            fillWithAI: state.players.some(p => !p.isHuman),
            playerName: humanPlayer?.name || "玩家",
            numberOfRounds: state.numberOfRounds, 
        };
        // Rematch uses INITIALIZE_GAME to go through the full setup including WaitingRoomModal
        return gameReducer(newState, { type: 'INITIALIZE_GAME', settings: currentSettings });
    }

    default:
      addLog(`未知的動作類型`); 
      return newState;
  }
}

const useXiangqiMahjong = () => {
  const [gameState, dispatch] = useReducer(gameReducer, initialState);
  return { gameState, dispatch: useCallback(dispatch, []) };
};

export default useXiangqiMahjong;