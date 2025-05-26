
// THIS HOOK IS LARGELY DEPRECATED.
// The core game logic (reducer) has been moved to the server-side GameRoom.ts.
// The frontend (App.tsx and GameBoard.tsx) now receives game state updates directly from the server via Socket.IO.
// This file can be safely removed or kept as an empty placeholder if absolutely necessary for project structure,
// but its functionality is no longer used for game state management.

// import { useState, useCallback, useEffect } from 'react';
// import { GameState, GameActionPayload } from '../types';
// import { GamePhase } from '../types';

/*
const initialLocalState: GameState = {
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
  messageLog: ["等待伺服器同步遊戲狀態..."], 
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
  clientPlayerId: null,
};
*/

const useXiangqiMahjong_DEPRECATED = (/* initialServerState?: GameState | null */) => {
  // const [gameState, setGameState] = useState<GameState>(initialServerState || initialLocalState);

  // useEffect(() => {
  //   if (initialServerState) {
  //     setGameState(initialServerState);
  //   }
  // }, [initialServerState]);
  
  // const dispatch = useCallback((action: GameActionPayload) => {
  //   console.warn("useXiangqiMahjong local dispatch called with action:", action, "This should be a server event.");
  // }, []);

  // return { gameState, setGameState, dispatch };
  console.warn("useXiangqiMahjong.ts is deprecated and should be removed. Game logic is server-side.");
  return {};
};

// export default useXiangqiMahjong_DEPRECATED; // Exporting with a deprecated name or not at all
export {}; // To make this file a module and avoid errors if it's empty.
