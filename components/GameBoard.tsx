// 引入 React 相關的鉤子和 Socket.IO 客戶端類型
import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
// 引入各個 UI 組件
import PlayerDisplay from './PlayerDisplay';
import TileDisplay from './TileDisplay';
import ActionButton from './ActionButton';
import GameModal from './GameModal';
import ChatPanel from './ChatPanel';
import ChatBubbleIcon from './icons/ChatBubbleIcon';
import SettingsIcon from './icons/SettingsIcon';
import MicrophoneOnIcon from './icons/MicrophoneOnIcon';
import MicrophoneOffIcon from './icons/MicrophoneOffIcon';
import WaitingRoomModal from './WaitingRoomModal';
import NextRoundConfirmModal from './NextRoundConfirmModal';
import ActionAnnouncer, { ActionAnnouncement } from './ActionAnnouncer';
import ProgressBar from './ProgressBar';
// 引入類型定義和常數
import { Tile, GamePhase, Claim, TileKind, Player, GameState, RoomSettings, ChatMessage, ServerToClientEvents, ClientToServerEvents, GameActionPayload, Suit, RematchVote, DiscardedTileInfo, NotificationType } from '../types';
import { TILE_KIND_DETAILS, GamePhaseTranslations, INITIAL_HAND_SIZE_DEALER, PLAYER_TURN_ACTION_TIMEOUT_SECONDS, CLAIM_DECISION_TIMEOUT_SECONDS, NUM_PLAYERS, ALL_TILE_KINDS as TILE_KIND_ENUM_VALUES, NEXT_ROUND_COUNTDOWN_SECONDS } from '../constants';
// 引入遊戲規則相關的輔助函數 (主要用於 UI 判斷，伺服器為權威)
import { canDeclareAnGang, canDeclareMingGangFromHand, checkWinCondition } from '../utils/gameRules';
// 引入音效播放函數
import { playActionSound } from '../utils/audioManager';

/**
 * @description GameBoard 組件的 props 類型定義
 */
interface GameBoardProps {
  /** @param {Omit<RoomSettings, 'aiPlayers' | 'hostSocketId'> & { voiceEnabled: boolean }} roomSettings - 房間設定，確保包含 voiceEnabled。 */
  roomSettings: Omit<RoomSettings, 'aiPlayers' | 'hostSocketId'> & { voiceEnabled: boolean };
  /** @param {GameState} initialGameState - 初始的遊戲狀態。 */
  initialGameState: GameState;
  /** @param {number} clientPlayerId - 當前客戶端玩家在遊戲中的 ID (座位索引 0-3)。 */
  clientPlayerId: number;
  /** @param {() => void} onQuitGame - 退出遊戲的回調函數。 */
  onQuitGame: () => void;
  /** @param {() => void} toggleSettingsPanel - 切換設定面板顯示的回調函數。 */
  toggleSettingsPanel: () => void;
  /** @param {Socket<ServerToClientEvents, ClientToServerEvents>} socket - Socket.IO 連接實例。 */
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  /** @param {(message: string, type: NotificationType, duration?: number) => void} addNotification - 用於顯示通知的函數。 */
  addNotification: (message: string, type: NotificationType, duration?: number) => void;
  isMicrophoneMuted: boolean;
  onToggleMute: () => void;
  isVoiceChatSupported: boolean;
  localAudioStream: MediaStream | null;
}

/**
 * @description 伺服器發送的動作宣告資料類型 (用於 actionAnnouncement 事件)。
 */
type ServerActionAnnouncementData = {
  text: string;
  playerId: number;
  position: 'top' | 'bottom' | 'left' | 'right';
  id: number;
  isMultiHuTarget?: boolean;
};


/**
 * @description GameBoard 組件，負責渲染整個遊戲界面，包括玩家、牌桌、棄牌堆、操作按鈕等。
 * @param {GameBoardProps} props - 組件的屬性。
 * @returns {React.FC} React 函數組件。
 */
const GameBoard: React.FC<GameBoardProps> = ({
    roomSettings,
    initialGameState,
    clientPlayerId,
    onQuitGame,
    toggleSettingsPanel,
    socket,
    addNotification,
    isMicrophoneMuted,
    onToggleMute,
    isVoiceChatSupported,
    localAudioStream,
}) => {
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [isSelectingChiCombo, setIsSelectingChiCombo] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const prevLastDrawnTileRef = useRef<Tile | null | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionAnnouncements, setActionAnnouncements] = useState<ActionAnnouncement[]>([]);
  const [availableClaimsForClient, setAvailableClaimsForClient] = useState<Claim[] | null>(null);
  const [localChiOptionsForClient, setLocalChiOptionsForClient] = useState<Tile[][] | null>(null);
  const hasAutoDrawnThisTurnRef = useRef(false);
  const [showFinalMatchResultsModalStep, setShowFinalMatchResultsModalStep] = useState<'roundResult' | 'finalScore'>('roundResult');


  useEffect(() => {
    setGameState(initialGameState);
    setChatMessages([]);
    setActionAnnouncements([]);
    setAvailableClaimsForClient(null);
    setLocalChiOptionsForClient(null);
    hasAutoDrawnThisTurnRef.current = false;
    setShowFinalMatchResultsModalStep('roundResult');
    console.log(`[GameBoard] Initial game state updated for room ${initialGameState.roomId}, round ${initialGameState.currentRound}. Voice Enabled: ${initialGameState.voiceEnabled}`);
  }, [initialGameState.roomId, initialGameState.currentRound, initialGameState.voiceEnabled]);

  useEffect(() => {
    const handleGameStateUpdate = (newGameState: GameState) => {
      setGameState(newGameState);
      if (newGameState.gamePhase !== GamePhase.AWAITING_ALL_CLAIMS_RESPONSE) {
        setAvailableClaimsForClient(null);
        setLocalChiOptionsForClient(null);
        setIsSelectingChiCombo(false);
      }
      if (isSelectingChiCombo && newGameState.gamePhase !== GamePhase.AWAITING_ALL_CLAIMS_RESPONSE) {
          setIsSelectingChiCombo(false);
      }
      if (newGameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES && newGameState.matchOver &&
          gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES) {
          setShowFinalMatchResultsModalStep('roundResult');
      }
    };

    const handleGameChatMessage = (message: ChatMessage) => {
      setChatMessages(prev => [...prev, message]);
    };

    const handleActionAnnouncement = (announcementFromServer: ServerActionAnnouncementData) => {
       const numPlayers = NUM_PLAYERS;
       const offset = (announcementFromServer.playerId - clientPlayerId + numPlayers) % numPlayers;
       let uiPosition: 'top' | 'bottom' | 'left' | 'right';

       switch (offset) {
           case 0: uiPosition = 'bottom'; break;
           case 1: uiPosition = 'right'; break;
           case 2: uiPosition = 'top'; break;
           case 3: uiPosition = 'left'; break;
           default:
             uiPosition = 'bottom';
             console.warn(`[GameBoard] 計算動作宣告的 offset 時發生錯誤: ${offset}。伺服器玩家ID: ${announcementFromServer.playerId}, 客戶端玩家ID: ${clientPlayerId}。預設為 'bottom'。`);
             break;
       }

       const clientSideAnnouncement: ActionAnnouncement = {
           id: announcementFromServer.id,
           text: announcementFromServer.text,
           playerId: announcementFromServer.playerId,
           position: uiPosition,
           isMultiHuTarget: announcementFromServer.isMultiHuTarget,
       };

       setActionAnnouncements(prev => [...prev, clientSideAnnouncement]);
       let soundActionText = clientSideAnnouncement.text;
       let tileKindForSound: TileKind | undefined = undefined;
       const isTileKind = TILE_KIND_ENUM_VALUES.some(kind => kind === clientSideAnnouncement.text);
       if (isTileKind) {
           soundActionText = "打牌";
           tileKindForSound = clientSideAnnouncement.text as TileKind;
       }
       const specialActionsForSound = ["碰", "吃", "槓", "明槓", "暗槓", "加槓", "胡", "自摸", "天胡", "一炮多響"];
       if (specialActionsForSound.includes(soundActionText) || soundActionText === "打牌") {
         playActionSound(soundActionText, tileKindForSound);
       }
       const isHuAction = ["胡", "自摸", "天胡"].includes(clientSideAnnouncement.text);
       if (isHuAction && clientSideAnnouncement.isMultiHuTarget) {
           playActionSound("一炮多響");
       }
       const animationDuration = (isHuAction && clientSideAnnouncement.isMultiHuTarget) ? 3000 : 2500;
       setTimeout(() => {
            setActionAnnouncements(prevMsgs => prevMsgs.filter(m => m.id !== clientSideAnnouncement.id));
       }, animationDuration);
    };

    const handleAvailableClaimsNotification = (data: { claims: Claim[], chiOptions?: Tile[][] }) => {
        console.log(`[GameBoard] Received availableClaimsNotification for client ${clientPlayerId}:`, data);
        const clientSpecificClaims = data.claims.filter(claim => claim.playerId === clientPlayerId);
        setAvailableClaimsForClient(clientSpecificClaims.length > 0 ? clientSpecificClaims : null);
        if (clientSpecificClaims.some(c => c.action === 'Chi') && data.chiOptions) {
            setLocalChiOptionsForClient(data.chiOptions);
        } else {
            setLocalChiOptionsForClient(null);
        }
    };

    socket.on('gameStateUpdate', handleGameStateUpdate);
    socket.on('gameChatMessage', handleGameChatMessage);
    socket.on('actionAnnouncement', handleActionAnnouncement as (data: any) => void);
    socket.on('availableClaimsNotification', handleAvailableClaimsNotification);

    return () => {
      socket.off('gameStateUpdate', handleGameStateUpdate);
      socket.off('gameChatMessage', handleGameChatMessage);
      socket.off('actionAnnouncement', handleActionAnnouncement as (data: any) => void);
      socket.off('availableClaimsNotification', handleAvailableClaimsNotification);
    };
  }, [socket, TILE_KIND_ENUM_VALUES, clientPlayerId, isSelectingChiCombo, gameState.gamePhase]);

  const humanPlayer = gameState.players.find(p => p.id === clientPlayerId && p.isHuman);
  const currentPlayer = gameState.players.length > 0 ? gameState.players[gameState.currentPlayerIndex] : null;
  const isHumanHost = humanPlayer?.isHost;

  useEffect(() => {
    const currentLDT = gameState.lastDrawnTile;
    const previousLDT = prevLastDrawnTileRef.current;
    const humanPlayerIsCurrent = humanPlayer && currentPlayer?.id === humanPlayer.id;
    const isDealerInitialTurn = currentPlayer?.isDealer &&
                                gameState.turnNumber === 1 &&
                                gameState.players.length > 0 &&
                                currentPlayer.id === gameState.players[gameState.dealerIndex].id;
    const shouldConsiderAutoSelect = currentLDT && humanPlayerIsCurrent &&
      ( gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
        (gameState.gamePhase === GamePhase.AWAITING_DISCARD && isDealerInitialTurn) );

    if (shouldConsiderAutoSelect) {
      const ldtHasChangedSignificantly = (!previousLDT && currentLDT) || (previousLDT && currentLDT && previousLDT.id !== currentLDT.id);
      if (ldtHasChangedSignificantly) {
         setSelectedTileId(currentLDT!.id);
      }
    }
    prevLastDrawnTileRef.current = currentLDT;
  }, [humanPlayer, currentPlayer, gameState.gamePhase, gameState.lastDrawnTile, gameState.turnNumber, selectedTileId, gameState.dealerIndex, gameState.players]);

  const emitPlayerAction = useCallback((action: GameActionPayload) => {
    if (!gameState.roomId) {
        console.error("[GameBoard] 無法發送玩家動作：roomId 為 null。");
        addNotification("發生錯誤：房間 ID 未設定，無法執行動作。", 'error');
        return;
    }
    setIsSubmitting(true);
    socket.emit('gamePlayerAction', gameState.roomId, action);
    if (action.type === 'DISCARD_TILE') setSelectedTileId(null);
    if (action.type === 'SUBMIT_CLAIM_DECISION') {
      setAvailableClaimsForClient(null);
      setIsSelectingChiCombo(false);
    }
    setTimeout(() => setIsSubmitting(false), 500);
  }, [socket, gameState.roomId, addNotification]);

  useEffect(() => {
    const shouldAutoDraw =
      gameState.gamePhase === GamePhase.PLAYER_TURN_START &&
      humanPlayer &&
      humanPlayer.isOnline &&
      gameState.currentPlayerIndex === humanPlayer.id &&
      !hasAutoDrawnThisTurnRef.current &&
      !isSubmitting;

    if (shouldAutoDraw) {
      const timerId = setTimeout(() => {
        if (
          gameState.gamePhase === GamePhase.PLAYER_TURN_START &&
          humanPlayer &&
          humanPlayer.isOnline &&
          gameState.currentPlayerIndex === humanPlayer.id &&
          !hasAutoDrawnThisTurnRef.current &&
          !isSubmitting
        ) {
          console.log(`[GameBoard] 為 ${humanPlayer.name} (座位: ${humanPlayer.id}) 自動摸牌 (延遲後)。`);
          emitPlayerAction({ type: 'DRAW_TILE' });
        }
      }, 150);

      return () => clearTimeout(timerId);
    }
  }, [gameState.gamePhase, gameState.currentPlayerIndex, humanPlayer, emitPlayerAction, isSubmitting]);

  useEffect(() => {
    const isMyTurnAndPhase = (phase: GamePhase) =>
      gameState.gamePhase === phase &&
      humanPlayer?.id === gameState.currentPlayerIndex;

    if (isMyTurnAndPhase(GamePhase.PLAYER_TURN_START)) {
      if (hasAutoDrawnThisTurnRef.current) {
        hasAutoDrawnThisTurnRef.current = false;
        console.log(`[GameBoard] 重置 hasAutoDrawnThisTurnRef for ${humanPlayer?.name} (PLAYER_TURN_START)`);
      }
    } else if (isMyTurnAndPhase(GamePhase.PLAYER_DRAWN)) {
      if (!hasAutoDrawnThisTurnRef.current) {
        hasAutoDrawnThisTurnRef.current = true;
        console.log(`[GameBoard] 設定 hasAutoDrawnThisTurnRef for ${humanPlayer?.name} (PLAYER_DRAWN)`);
      }
    } else {
      if (hasAutoDrawnThisTurnRef.current) {
        hasAutoDrawnThisTurnRef.current = false;
        console.log(`[GameBoard] 重置 hasAutoDrawnThisTurnRef for ${humanPlayer?.name || 'player'} (非我的摸牌或已摸牌階段)`);
      }
    }
  }, [gameState.gamePhase, gameState.currentPlayerIndex, humanPlayer]);

  const handleTileClick = useCallback((tile: Tile) => {
    if (humanPlayer && currentPlayer?.id === humanPlayer.id && gameState.players.find(p => p.id === humanPlayer.id)?.isHuman) {
        if (gameState.gamePhase === GamePhase.PLAYER_DRAWN || gameState.gamePhase === GamePhase.AWAITING_DISCARD) {
            setSelectedTileId(currentSelectedId => (currentSelectedId === tile.id ? null : tile.id));
        }
    }
  }, [humanPlayer, currentPlayer, gameState.gamePhase, gameState.players]);

  const handleDiscard = () => {
    if (selectedTileId) {
      emitPlayerAction({ type: 'DISCARD_TILE', tileId: selectedTileId });
    }
  };

  const handlePassClaimDecision = () => {
    if (!humanPlayer) return;
    emitPlayerAction({
        type: 'SUBMIT_CLAIM_DECISION',
        decision: {
            playerId: clientPlayerId!,
            action: 'Pass'
        }
    });
  };

  const handleChiSelect = (chiOption: Tile[]) => {
    if (gameState.lastDiscardedTile && humanPlayer) {
      emitPlayerAction({
        type: 'SUBMIT_CLAIM_DECISION',
        decision: {
          playerId: clientPlayerId!,
          action: 'Chi',
          chiCombination: chiOption
        }
      });
    }
  };

  const handleSendChatMessage = (messageText: string) => {
    if (!humanPlayer || !gameState.roomId) return;
    socket.emit('gameSendChatMessage', gameState.roomId, messageText);
  };

  const handleStartGameFromModal = () => {
    if (isHumanHost && gameState.roomId) {
      setIsSubmitting(true);
      socket.emit('gameRequestStart', gameState.roomId);
      setTimeout(() => setIsSubmitting(false), 1000);
    }
  };

  const handleConfirmNextRound = () => {
    if (humanPlayer && gameState.roomId) {
        emitPlayerAction({ type: 'PLAYER_CONFIRM_NEXT_ROUND', playerId: humanPlayer.id });
    }
  };

  const handleVoteRematch = () => {
    if (humanPlayer && gameState.roomId) {
        emitPlayerAction({type: 'PLAYER_VOTE_REMATCH', vote: 'yes'});
    }
  };

  const renderPlayer = (playerDisplayPosition: 'bottom' | 'left' | 'top' | 'right') => {
    if (gameState.players.length === 0) {
      return <div className={`p-2 rounded-lg shadow-inner bg-slate-700/30 min-h-[100px] w-full flex items-center justify-center text-slate-500 text-xs`}>等待玩家資料...</div>;
    }
    let displayPlayerIndex = -1;
    const numGamePlayers = gameState.players.length >= NUM_PLAYERS ? gameState.players.length : NUM_PLAYERS;
    if (clientPlayerId === null || numGamePlayers === 0) return <div className="p-2">等待玩家資訊...</div>;
    switch (playerDisplayPosition) {
        case 'bottom': displayPlayerIndex = clientPlayerId; break;
        case 'right': displayPlayerIndex = (clientPlayerId + 1) % numGamePlayers; break;
        case 'top': displayPlayerIndex = (clientPlayerId + 2) % numGamePlayers; break;
        case 'left': displayPlayerIndex = (clientPlayerId + 3) % numGamePlayers; break;
    }
    if (displayPlayerIndex < 0 || displayPlayerIndex >= gameState.players.length) {
       return <div className={`p-2 rounded-lg shadow-inner bg-slate-700/30 min-h-[100px] w-full flex items-center justify-center text-slate-500 text-xs`}>玩家席位 (空位或錯誤 ID: {displayPlayerIndex})</div>;
    }
    const targetPlayerToDisplay = gameState.players[displayPlayerIndex];
    if (!targetPlayerToDisplay) {
         return <div className={`p-2 rounded-lg shadow-inner bg-slate-700/30 min-h-[100px] w-full flex items-center justify-center text-slate-500 text-xs`}>玩家席位 (錯誤)</div>;
    }
    return (
      <PlayerDisplay
        player={targetPlayerToDisplay}
        isCurrentPlayer={
            targetPlayerToDisplay.id === currentPlayer?.id ||
            (gameState.gamePhase === GamePhase.AWAITING_ALL_CLAIMS_RESPONSE &&
             !!availableClaimsForClient?.find(c => c.playerId === targetPlayerToDisplay.id) &&
             targetPlayerToDisplay.id === clientPlayerId)
        }
        isHumanPlayerView={playerDisplayPosition === 'bottom'}
        onTileClick={playerDisplayPosition === 'bottom' ? handleTileClick : undefined}
        selectedTileId={playerDisplayPosition === 'bottom' ? selectedTileId : null}
        position={playerDisplayPosition}
        gamePhase={gameState.gamePhase}
      />
    );
  };

  let canHumanPlayerDraw = false;
  let canHumanPlayerDiscard = false;

  if (humanPlayer &&
      gameState.gamePhase !== GamePhase.GAME_OVER &&
      gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS &&
      gameState.gamePhase !== GamePhase.ROUND_OVER &&
      gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES &&
      gameState.gamePhase !== GamePhase.AWAITING_ALL_CLAIMS_RESPONSE
    ) {
    const humanIsCurrentPlayer = currentPlayer?.id === humanPlayer.id;
    if (humanIsCurrentPlayer) {
        if (gameState.gamePhase === GamePhase.PLAYER_TURN_START) {
            canHumanPlayerDraw = true;
        }
        if (gameState.gamePhase === GamePhase.PLAYER_DRAWN && gameState.lastDrawnTile) {
            canHumanPlayerDiscard = true;
        }
        if (gameState.gamePhase === GamePhase.AWAITING_DISCARD) {
            canHumanPlayerDiscard = true;
        }
    }
  }
  const phaseDisplayName = GamePhaseTranslations[gameState.gamePhase] || gameState.gamePhase;
  const isTimerActiveForHuman = humanPlayer && gameState.actionTimer !== null && gameState.actionTimer > 0 &&
                                ( (gameState.actionTimerType === 'turn' && currentPlayer?.id === humanPlayer.id) ||
                                  (gameState.actionTimerType === 'global_claim' && !!availableClaimsForClient && availableClaimsForClient.length > 0)
                                );
  const maxTimerValue = gameState.actionTimerType === 'global_claim' || gameState.actionTimerType === 'claim'
                        ? CLAIM_DECISION_TIMEOUT_SECONDS
                        : PLAYER_TURN_ACTION_TIMEOUT_SECONDS;

  let gameOverModalTitle = "遊戲結束";
  let gameOverModalContent: React.ReactNode = <p>遊戲已結束。</p>;
  let roundOverModalDetails: Parameters<typeof NextRoundConfirmModal>[0]['roundOverDetails'] = null;
  let lastRoundResultTitle = "本局結果";
  let lastRoundResultContent: React.ReactNode = <p>本局已結束。</p>;


  if (gameState.gamePhase === GamePhase.GAME_OVER || gameState.gamePhase === GamePhase.ROUND_OVER || gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES) {
    let resultMessage = "";
    if (gameState.winnerId !== null) {
        const winner = gameState.players.find(p => p.id === gameState.winnerId);
        if (winner) {
            roundOverModalDetails = { winnerName: winner.name, winType: gameState.winType, winningTileKind: gameState.winningDiscardedTile?.kind || gameState.lastDrawnTile?.kind };
            if (gameState.winType === 'selfDrawn') {
                resultMessage = `恭喜 ${winner.name}，自摸獲勝！${roundOverModalDetails.winningTileKind ? ` (胡 ${roundOverModalDetails.winningTileKind})` : ''}`;
            } else if (gameState.winType === 'discard' && gameState.winningDiscardedTile && gameState.winningTileDiscarderId !== null) {
                const discarder = gameState.players.find(p => p.id === gameState.winningTileDiscarderId);
                resultMessage = `恭喜 ${winner.name}！胡了由 ${discarder?.name || '某玩家'} 打出的【${gameState.winningDiscardedTile.kind}】。`;
                roundOverModalDetails.discarderName = discarder?.name || '某玩家';
            } else {
                resultMessage = `恭喜 ${winner.name} 獲勝！`;
            }
        }
    } else if (gameState.isDrawGame) {
        resultMessage = "無人胡牌，本局為流局。";
        roundOverModalDetails = { isDrawGame: true };
    }

    lastRoundResultContent = <p className="text-lg text-slate-200 mb-4">{resultMessage || "本局已結束。"}</p>;

    if (gameState.gamePhase === GamePhase.ROUND_OVER) {
        gameOverModalTitle = `第 ${gameState.currentRound} 局結束`;
        lastRoundResultTitle = `第 ${gameState.currentRound} 局結果`;
    } else if (gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES && gameState.matchOver) {
        gameOverModalTitle = `比賽結束 (共 ${gameState.numberOfRounds || initialGameState.numberOfRounds || 1} 局)`;
        lastRoundResultTitle = "最後一局結果";
        const sortedPlayersByScore = [...gameState.players].sort((a, b) => b.score - a.score);
        gameOverModalContent = (
          <div className="text-left mt-4">
            <p className="mb-3 text-slate-100 text-lg">最終總積分榜：</p>
            <ul className="space-y-1 max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-500 scrollbar-track-slate-700/50">
              {sortedPlayersByScore.map((p, index) => (
                <li
                  key={p.id}
                  className={`flex justify-between items-center p-2.5 rounded-md text-base
                    ${index === 0 ? 'bg-amber-500/40 text-amber-100 ring-2 ring-amber-400' :
                     (index === 1 ? 'bg-gray-400/40 text-gray-50 ring-2 ring-gray-300' :
                      (index === 2 ? 'bg-orange-600/40 text-orange-100 ring-2 ring-orange-500' :
                       'bg-slate-700/60 text-slate-200'))}`}
                >
                  <span className="font-semibold">
                    {index === 0 ? '🏆 ' : (index === 1 ? '🥈 ' : (index === 2 ? '🥉 ' : ` ${index + 1}. `))}
                    {p.name}
                  </span>
                  <span className="font-bold">{p.score.toLocaleString()} 分</span>
                </li>
              ))}
            </ul>
          </div>
        );
    }
  }


  if (gameState.gamePhase === GamePhase.LOADING && gameState.players.length === 0) {
    return <div className="w-full h-full flex items-center justify-center text-xl">等待伺服器同步遊戲狀態...</div>;
  }

  const humanPlayerVote = humanPlayer && gameState.rematchVotes?.find(v => v.playerId === humanPlayer.id)?.vote;

  return (
    <div className="w-full h-full max-w-7xl max-h-[1000px] bg-slate-800 shadow-2xl rounded-xl p-3 grid grid-cols-[180px_1fr_180px] grid-rows-[180px_1fr_180px] gap-2 relative landscape-mode">
      <div className="absolute top-3 right-3 z-50 flex items-center space-x-3">
        {/* --- 麥克風按鈕邏輯開始 --- */}
        {roomSettings.voiceEnabled && isVoiceChatSupported && localAudioStream && (
            <button
                onClick={onToggleMute}
                className={`p-2 rounded-full transition-colors text-white ${
                    isMicrophoneMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
                }`}
                aria-label={isMicrophoneMuted ? "取消靜音" : "靜音麥克風"}
                title={isMicrophoneMuted ? "取消靜音" : "靜音麥克風"}
            >
                {isMicrophoneMuted ? <MicrophoneOffIcon className="w-5 h-5" /> : <MicrophoneOnIcon className="w-5 h-5" />}
            </button>
        )}
        {/* 顯示為禁用狀態的麥克風按鈕 */}
        {(!roomSettings.voiceEnabled || (roomSettings.voiceEnabled && (!isVoiceChatSupported || !localAudioStream))) && (
            <button
                className="p-2 bg-slate-500 rounded-full text-slate-400 cursor-not-allowed"
                aria-label={!roomSettings.voiceEnabled ? "房間語音已禁用" : (isVoiceChatSupported && localAudioStream ? "麥克風" : "麥克風不可用")}
                title={!roomSettings.voiceEnabled ? "此房間已禁用遊戲語音" : (!isVoiceChatSupported ? "瀏覽器不支援語音或未授權" : "麥克風串流未獲取")}
                disabled
            >
                <MicrophoneOffIcon className="w-5 h-5" />
            </button>
        )}
        {/* --- 麥克風按鈕邏輯結束 --- */}
        <button
            onClick={toggleSettingsPanel}
            className="p-2 bg-slate-700/50 hover:bg-slate-600 rounded-full text-white transition-colors"
            aria-label="開啟設定"
            title="設定"
        >
            <SettingsIcon className="w-5 h-5" />
        </button>
        <ActionButton
            label="離開房間"
            onClick={onQuitGame}
            variant="secondary"
            size="sm"
            disabled={isSubmitting}
            className="!px-3 !py-1.5 text-xs"
        />
      </div>

      {actionAnnouncements
        .filter(ann => {
          const specialActions = ["碰", "吃", "槓", "明槓", "暗槓", "加槓", "胡", "自摸", "天胡", "一炮多響"];
          return specialActions.includes(ann.text);
        })
        .map(ann => (
        <ActionAnnouncer key={ann.id} announcement={ann} />
      ))}

      {/* MODIFIED: 移除 gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES 條件 */}
      {gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS && (
        <>
          <div className="col-start-2 row-start-1 flex">
            {renderPlayer('top')}
          </div>
          <div className="col-start-1 row-start-2 flex justify-center items-center">
            {renderPlayer('left')}
          </div>
          <div className="col-start-3 row-start-2 flex justify-center items-center">
            {renderPlayer('right')}
          </div>
          <div className="col-start-2 row-start-3 flex flex-row items-stretch">
            {renderPlayer('bottom')}
            {humanPlayer &&
                currentPlayer?.id === humanPlayer.id &&
                gameState.gamePhase === GamePhase.PLAYER_DRAWN &&
                gameState.lastDrawnTile && (
                <div className="ml-2 flex items-center justify-center relative z-10">
                    <TileDisplay
                        tile={gameState.lastDrawnTile}
                        onClick={() => handleTileClick(gameState.lastDrawnTile!)}
                        isSelected={selectedTileId === gameState.lastDrawnTile.id}
                        size="medium"
                    />
                </div>
            )}
          </div>
        </>
      )}

      {gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS &&
       gameState.gamePhase !== GamePhase.ROUND_OVER &&
       gameState.gamePhase !== GamePhase.GAME_OVER &&
       gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES &&
       (
          <div className="col-start-2 row-start-2 bg-green-900/50 rounded-lg shadow-inner p-4 flex flex-col items-center justify-between relative overflow-hidden">
            <div className="absolute top-3 left-3 z-10 w-[calc(100%-24px)] flex justify-between items-start">
                <div className="text-base text-slate-200 p-2 bg-black/50 rounded shadow-md">
                    <div>房間: <span className="font-semibold text-amber-200">{roomSettings.roomName}</span></div>
                    <div>局: <span className="font-semibold text-amber-200">{gameState.currentRound}/{gameState.numberOfRounds || initialGameState.numberOfRounds || 1}</span> | 回合: <span className="font-semibold text-amber-200">{gameState.turnNumber}</span></div>
                    <div className="mt-1">狀態: <span className="font-semibold text-sky-300">{phaseDisplayName}</span></div>
                </div>

                {isTimerActiveForHuman && gameState.actionTimer !== null && (
                  <div className="flex flex-col items-center p-2 bg-black/50 rounded shadow-md">
                    <div className="text-base md:text-lg text-amber-300 font-semibold">
                        行動時間: {gameState.actionTimer}s
                    </div>
                    <ProgressBar
                        currentTime={gameState.actionTimer}
                        maxTime={maxTimerValue}
                        className="w-24 h-1.5 mt-1"
                    />
                  </div>
                )}
            </div>

            <div className="mt-10 flex items-center space-x-2 text-base text-slate-200 p-2 bg-black/50 rounded">
                <span>牌堆: {gameState.deck.length}</span>
                {gameState.deck.length > 0 && <TileDisplay tile={null} size="medium" isHidden={true} />}
            </div>

            <div className="w-full flex flex-col items-center my-2">
                <div className="h-[166px] w-full max-w-2xl p-1 bg-black/30 rounded flex flex-wrap justify-start items-start content-start overflow-y-auto scrollbar-thin scrollbar-thumb-slate-500 scrollbar-track-slate-700">
                {gameState.discardPile
                .slice()
                .reverse()
                .map((discardInfo: DiscardedTileInfo, index: number, reversedArray: DiscardedTileInfo[]) => (
                    <div key={`${discardInfo.tile.id}-discard-wrapper-${index}`} className="m-0.5">
                    <TileDisplay
                        tile={discardInfo.tile}
                        size="medium"
                        isDiscarded
                        isLatestDiscard={index === reversedArray.length - 1 && gameState.lastDiscardedTile?.id === discardInfo.tile.id}
                    />
                    </div>
                ))}
                </div>
            </div>

            <div className="flex-grow w-full flex flex-col items-center justify-center">
                {gameState.lastDiscardedTile &&
                 (gameState.gamePhase === GamePhase.TILE_DISCARDED ||
                  gameState.gamePhase === GamePhase.AWAITING_CLAIMS_RESOLUTION ||
                  gameState.gamePhase === GamePhase.AWAITING_ALL_CLAIMS_RESPONSE ||
                  gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION ||
                  gameState.gamePhase === GamePhase.ACTION_PENDING_CHI_CHOICE
                  ) && (
                    <div className="-mt-10 mb-2 p-1 bg-yellow-600/30 rounded flex flex-col items-center">
                        <span className="text-xs text-yellow-200 mb-0.5">最新棄牌 (待宣告):</span>
                        <TileDisplay tile={gameState.lastDiscardedTile} size="medium" isDiscarded isLatestDiscard={true} />
                    </div>
                )}
            </div>

            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 flex flex-wrap gap-2 justify-center items-center p-2 min-h-[50px] w-auto max-w-full">
                {canHumanPlayerDiscard && (
                <ActionButton label="打牌" onClick={handleDiscard} disabled={!selectedTileId || isSubmitting} variant="danger" />
                )}
                {gameState.gamePhase === GamePhase.AWAITING_ALL_CLAIMS_RESPONSE && availableClaimsForClient && humanPlayer && (
                <>
                    {availableClaimsForClient.map(claim => {
                        let label = '';
                        let actionType: 'Hu' | 'Peng' | 'Gang' | 'Chi' = claim.action;
                        switch(claim.action) {
                            case 'Hu': label = '胡牌'; break;
                            case 'Peng': label = '碰'; break;
                            case 'Gang': label = '槓'; break;
                            case 'Chi': label = '吃'; break;
                            default: return null;
                        }
                        return (
                            <ActionButton
                                key={claim.action}
                                label={label}
                                onClick={() => {
                                    if (claim.action === 'Chi') {
                                        if (localChiOptionsForClient && localChiOptionsForClient.length > 0) {
                                            setIsSelectingChiCombo(true);
                                        } else {
                                            console.warn("[GameBoard] 選擇「吃」但無可用組合。自動跳過。");
                                            handlePassClaimDecision();
                                        }
                                    } else {
                                        emitPlayerAction({
                                            type: 'SUBMIT_CLAIM_DECISION',
                                            decision: {
                                                playerId: clientPlayerId!,
                                                action: actionType,
                                                chosenPengGangTileKind: (claim.action === 'Peng' || claim.action === 'Gang') && gameState.lastDiscardedTile ? gameState.lastDiscardedTile.kind : undefined,
                                            }
                                        });
                                    }
                                }}
                                variant={claim.action === 'Hu' ? 'danger' : (claim.action === 'Chi' ? 'primary' : 'warning')}
                                disabled={isSubmitting}
                            />
                        );
                    })}
                    <ActionButton label="跳過" onClick={handlePassClaimDecision} variant="secondary" disabled={isSubmitting} />
                </>
                )}
                 { (gameState.gamePhase === GamePhase.PLAYER_TURN_START ||
                    gameState.gamePhase === GamePhase.PLAYER_DRAWN ||
                    (gameState.gamePhase === GamePhase.AWAITING_DISCARD && currentPlayer?.isDealer && gameState.turnNumber === 1)
                   ) && humanPlayer && currentPlayer?.id === humanPlayer.id && (
                    <>
                        {canDeclareAnGang(humanPlayer.hand, gameState.lastDrawnTile).map(kind => (
                            <ActionButton key={`an-gang-${kind}`} label={`暗槓 ${kind}`} onClick={() => emitPlayerAction({ type: 'DECLARE_AN_GANG', tileKind: kind })} variant="warning" disabled={isSubmitting} />
                        ))}
                        {gameState.lastDrawnTile && canDeclareMingGangFromHand(humanPlayer.hand, humanPlayer.melds, gameState.lastDrawnTile).map(gangOption => (
                            <ActionButton key={`ming-gang-hand-${gangOption.pengMeldKind}`} label={`加槓 ${gangOption.pengMeldKind}`} onClick={() => emitPlayerAction({ type: 'DECLARE_MING_GANG_FROM_HAND', tileKind: gangOption.pengMeldKind })} variant="warning" disabled={isSubmitting} />
                        ))}
                        {checkWinCondition(
                            gameState.gamePhase === GamePhase.PLAYER_DRAWN && gameState.lastDrawnTile ? [...humanPlayer.hand, gameState.lastDrawnTile] : humanPlayer.hand,
                            humanPlayer.melds
                        ).isWin && (
                            <ActionButton label="自摸" onClick={() => emitPlayerAction({ type: 'DECLARE_HU' })} variant="danger" disabled={isSubmitting} />
                        )}
                    </>
                )}
            </div>
          </div>
       )}

      <button
        onClick={() => setShowChatPanel(prev => !prev)}
        className="fixed bottom-4 right-4 z-30 p-3 bg-sky-600 hover:bg-sky-700 rounded-full text-white shadow-lg transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-sky-400"
        aria-label={showChatPanel ? "關閉聊天室" : "開啟聊天室"}
        title={showChatPanel ? "關閉聊天室" : "開啟聊天室"}
      >
        <ChatBubbleIcon className="w-6 h-6" />
      </button>

      <ChatPanel
        isOpen={showChatPanel}
        onClose={() => setShowChatPanel(false)}
        messages={chatMessages}
        onSendMessage={handleSendChatMessage}
        currentPlayerName={humanPlayer?.name || `玩家${clientPlayerId}`}
      />

      {isSelectingChiCombo && localChiOptionsForClient && localChiOptionsForClient.length > 0 && humanPlayer && gameState.lastDiscardedTile && (
        <GameModal isOpen={isSelectingChiCombo} title="選擇吃的組合" onClose={() => { setIsSelectingChiCombo(false); handlePassClaimDecision();  }}>
          <div className="space-y-3">
            <p className="text-slate-300 mb-3">請選擇您要與【{gameState.lastDiscardedTile.kind}】組合成順子的手牌：</p>
            {localChiOptionsForClient.map((handTilesOption, index) => {
              const fullShunziCandidate: Tile[] = [...handTilesOption, gameState.lastDiscardedTile!];
              const displayedShunzi = [...fullShunziCandidate].sort((a, b) =>
                TILE_KIND_DETAILS[b.kind].orderValue - TILE_KIND_DETAILS[a.kind].orderValue
              );

              return (
                <div
                  key={index}
                  className="flex items-center justify-start space-x-1.5 p-2 bg-slate-700 rounded-md hover:bg-slate-600 cursor-pointer transition-colors"
                  onClick={() => handleChiSelect(handTilesOption)}
                >
                  {displayedShunzi.map(tileInShunzi => (
                    <TileDisplay
                      key={tileInShunzi.id}
                      tile={tileInShunzi}
                      size="small"
                      isChiTarget={tileInShunzi.id === gameState.lastDiscardedTile!.id}
                    />
                  ))}
                </div>
              );
            })}
            <div className="mt-5 flex justify-end">
                 <ActionButton label="取消 (跳過)" onClick={() => { setIsSelectingChiCombo(false); handlePassClaimDecision(); }} variant="secondary" />
            </div>
          </div>
        </GameModal>
      )}

      {gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS && (
        <WaitingRoomModal
            isOpen={true}
            onStartGame={handleStartGameFromModal}
            onQuitGame={onQuitGame}
            players={gameState.players}
            roomSettings={roomSettings}
            isHost={!!isHumanHost}
            dealerName={gameState.players.find(p => p.isDealer)?.name}
            currentRound={gameState.currentRound}
            numberOfRounds={gameState.numberOfRounds || initialGameState.numberOfRounds || 1}
        />
      )}
      {gameState.gamePhase === GamePhase.ROUND_OVER && !gameState.matchOver && (
          <NextRoundConfirmModal
            isOpen={true}
            title={gameOverModalTitle}
            countdown={gameState.nextRoundCountdown}
            isHumanPlayer={!!humanPlayer}
            humanPlayerId={humanPlayer?.id}
            humanPlayersReadyForNextRound={gameState.humanPlayersReadyForNextRound}
            onConfirmNextRound={handleConfirmNextRound}
            onQuitGame={onQuitGame}
            roundOverDetails={roundOverModalDetails}
          />
      )}
      {gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES && gameState.matchOver && (
          <GameModal
              isOpen={true}
              title={gameOverModalTitle}
              onClose={showFinalMatchResultsModalStep === 'finalScore' ? onQuitGame : undefined}
              backdropOpacityClass="bg-black/40"
          >
              {showFinalMatchResultsModalStep === 'roundResult' && (
                  <>
                      <h3 className="text-xl font-semibold text-amber-300 mb-2">{lastRoundResultTitle}</h3>
                      {lastRoundResultContent}
                      <div className="mt-6 flex justify-center">
                          <ActionButton label="查看最終結果" onClick={() => setShowFinalMatchResultsModalStep('finalScore')} variant="primary" />
                      </div>
                  </>
              )}
              {showFinalMatchResultsModalStep === 'finalScore' && (
                  <>
                      {gameOverModalContent}
                      <div className="mt-6 text-center">
                          <p className="text-slate-300 mb-3">
                            {gameState.rematchCountdown !== null ? `再戰投票倒數: ${gameState.rematchCountdown}s` : (humanPlayerVote === 'yes' ? '已投票再戰，等待其他玩家...' : '是否開始新的一場比賽？')}
                          </p>
                          <div className="flex flex-col sm:flex-row justify-center gap-3">
                              <ActionButton
                                  label="離開房間"
                                  onClick={onQuitGame}
                                  variant="secondary"
                                  size="md"
                                  className="w-full sm:w-auto"
                              />
                              <ActionButton
                                  label={humanPlayerVote === 'yes' ? "已投票再戰" : "投票再戰"}
                                  onClick={handleVoteRematch}
                                  variant="primary"
                                  size="md"
                                  disabled={isSubmitting || humanPlayerVote === 'yes'}
                                  className="w-full sm:w-auto"
                              />
                          </div>
                      </div>
                  </>
              )}
          </GameModal>
      )}
    </div>
  );
};

export default GameBoard;