
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
import MicrophoneOnIcon from './icons/MicrophoneOnIcon'; // 新增
import MicrophoneOffIcon from './icons/MicrophoneOffIcon'; // 新增
import WaitingRoomModal from './WaitingRoomModal';
import NextRoundConfirmModal from './NextRoundConfirmModal';
import ActionAnnouncer, { ActionAnnouncement } from './ActionAnnouncer';
import ProgressBar from './ProgressBar';
// 引入類型定義和常數
import { Tile, GamePhase, Claim, TileKind, Player, GameState, RoomSettings, ChatMessage, ServerToClientEvents, ClientToServerEvents, GameActionPayload, Suit, RematchVote, DiscardedTileInfo, NotificationType } from '../types';
import { TILE_KIND_DETAILS, GamePhaseTranslations, INITIAL_HAND_SIZE_DEALER, PLAYER_TURN_ACTION_TIMEOUT_SECONDS, CLAIM_DECISION_TIMEOUT_SECONDS, NUM_PLAYERS, ALL_TILE_KINDS as TILE_KIND_ENUM_VALUES, NEXT_ROUND_COUNTDOWN_SECONDS } from '../constants';
// 引入遊戲規則相關的輔助函數 (主要用於 UI 判斷，伺服器為權威)
import { canDeclareAnGang, canDeclareMingGangFromHand, checkWinCondition } from '../utils/gameRules'; // getChiOptions 已被伺服器端 chiOptions 取代
// 引入音效播放函數
import { playActionSound } from '../utils/audioManager';

/**
 * @description GameBoard 組件的 props 類型定義
 */
interface GameBoardProps {
  /** @param {Omit<RoomSettings, 'aiPlayers' | 'hostSocketId'>} roomSettings - 房間設定 (精簡版，主要用於顯示)。 */
  roomSettings: Omit<RoomSettings, 'aiPlayers' | 'hostSocketId'>;
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
  isMicrophoneMuted: boolean; // 新增：麥克風是否靜音
  onToggleMute: () => void;    // 新增：切換靜音的回調
  isVoiceChatSupported: boolean; // 新增：語音聊天是否受瀏覽器支援
  localAudioStream: MediaStream | null; // 新增：本地音訊流，用於判斷是否可切換靜音
}

/**
 * @description 伺服器發送的動作宣告資料類型 (用於 actionAnnouncement 事件)。
 */
type ServerActionAnnouncementData = {
  text: string; // 宣告的文字，例如 "碰"、"胡" 或牌面
  playerId: number; // 執行動作的玩家在伺服器端的絕對座位索引
  position: 'top' | 'bottom' | 'left' | 'right'; // 伺服器視角的玩家位置 (客戶端將忽略此值，自行計算相對位置)
  id: number; // 宣告的唯一ID，用於動畫管理
  isMultiHuTarget?: boolean; // 是否為「一炮多響」的目標之一
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
    isMicrophoneMuted, // 新增
    onToggleMute,      // 新增
    isVoiceChatSupported, // 新增
    localAudioStream, // 新增
}) => {
  // --- 狀態管理 ---
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


  // --- 副作用 (useEffect) ---
  useEffect(() => {
    setGameState(initialGameState);
    setChatMessages([]);
    setActionAnnouncements([]);
    setAvailableClaimsForClient(null);
    setLocalChiOptionsForClient(null);
    hasAutoDrawnThisTurnRef.current = false;
    console.log(`[GameBoard] Initial game state updated for room ${initialGameState.roomId}, round ${initialGameState.currentRound}.`);
  }, [initialGameState.roomId, initialGameState.currentRound]);

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
  }, [socket, TILE_KIND_ENUM_VALUES, clientPlayerId, isSelectingChiCombo]);

  const humanPlayer = gameState.players.find(p => p.id === clientPlayerId && p.isHuman);
  const currentPlayer = gameState.players.length > 0 ? gameState.players[gameState.currentPlayerIndex] : null;
  const playerMakingDecision = gameState.playerMakingClaimDecision !== null ? gameState.players.find(p => p.id === gameState.playerMakingClaimDecision) : null;
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
    const canAutoDrawCurrentPlayer =
        gameState.gamePhase === GamePhase.PLAYER_TURN_START &&
        humanPlayer &&
        humanPlayer.isOnline &&
        gameState.currentPlayerIndex === humanPlayer.id;

    if (!canAutoDrawCurrentPlayer) {
        hasAutoDrawnThisTurnRef.current = false;
    }
  }, [gameState.gamePhase, gameState.currentPlayerIndex, humanPlayer]);

  useEffect(() => {
    if (
      gameState.gamePhase === GamePhase.PLAYER_TURN_START &&
      humanPlayer &&
      humanPlayer.isOnline &&
      gameState.currentPlayerIndex === humanPlayer.id &&
      !hasAutoDrawnThisTurnRef.current
    ) {
      console.log(`[GameBoard] 為 ${humanPlayer.name} (座位: ${humanPlayer.id}) 自動摸牌。`);
      hasAutoDrawnThisTurnRef.current = true;
      emitPlayerAction({ type: 'DRAW_TILE' });
    }
  }, [gameState.gamePhase, gameState.currentPlayerIndex, humanPlayer, emitPlayerAction]);

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

  if (gameState.gamePhase === GamePhase.GAME_OVER || gameState.gamePhase === GamePhase.ROUND_OVER || gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES) {
    if (gameState.winnerId !== null) {
        const winner = gameState.players.find(p => p.id === gameState.winnerId);
        if (winner) {
            roundOverModalDetails = { winnerName: winner.name, winType: gameState.winType, winningTileKind: gameState.winningDiscardedTile?.kind || gameState.lastDrawnTile?.kind };
            if (gameState.winType === 'selfDrawn') {
                gameOverModalTitle = `${winner.name} 自摸!`;
                gameOverModalContent = <p>恭喜 {winner.name}，自摸獲勝！</p>;
            } else if (gameState.winType === 'discard' && gameState.winningDiscardedTile && gameState.winningTileDiscarderId !== null) {
                const discarder = gameState.players.find(p => p.id === gameState.winningTileDiscarderId);
                gameOverModalTitle = `${winner.name} 胡牌!`;
                gameOverModalContent = <p>恭喜 {winner.name}！胡了由 ${discarder?.name || '某玩家'} 打出的【{gameState.winningDiscardedTile.kind}】。</p>;
                roundOverModalDetails.discarderName = discarder?.name || '某玩家';
            } else {
                gameOverModalTitle = `${winner.name} 胡牌了!`;
                gameOverModalContent = <p>恭喜 {winner.name}!</p>;
            }
        }
    } else if (gameState.isDrawGame) {
        gameOverModalTitle = "流局!";
        gameOverModalContent = <p>無人胡牌，本局為流局。</p>;
        roundOverModalDetails = { isDrawGame: true };
    }
    if (gameState.gamePhase === GamePhase.ROUND_OVER) {
        gameOverModalTitle = `第 ${gameState.currentRound} 局結束`;
    } else if (gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES) {
        gameOverModalTitle = `比賽結束 (共 ${gameState.numberOfRounds || initialGameState.numberOfRounds || 1} 局)`;
    }
  }

  if (gameState.gamePhase === GamePhase.LOADING && gameState.players.length === 0) {
    return <div className="w-full h-full flex items-center justify-center text-xl">等待伺服器同步遊戲狀態...</div>;
  }

  const humanPlayerVote = humanPlayer && gameState.rematchVotes?.find(v => v.playerId === humanPlayer.id)?.vote;

  // --- JSX 渲染 ---
  return (
    <div className="w-full h-full max-w-7xl max-h-[1000px] bg-slate-800 shadow-2xl rounded-xl p-3 grid grid-cols-[180px_1fr_180px] grid-rows-[180px_1fr_180px] gap-2 relative landscape-mode">
      <div className="absolute top-3 right-3 z-50 flex items-center space-x-3">
        {/* 麥克風按鈕 */}
        {isVoiceChatSupported && localAudioStream && (
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
         {/* 禁用狀態的麥克風按鈕 */}
        {(!isVoiceChatSupported || !localAudioStream) && (
            <button
                className="p-2 bg-slate-500 rounded-full text-slate-400 cursor-not-allowed"
                aria-label="麥克風不可用"
                title="麥克風不可用或未授權"
                disabled
            >
                <MicrophoneOffIcon className="w-5 h-5" />
            </button>
        )}
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


      {gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS && gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES && (
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

            <div className="mt-20 flex items-center space-x-2 text-base text-slate-200 p-2 bg-black/50 rounded">
                <span>牌堆: {gameState.deck.length}</span>
                {gameState.deck.length > 0 && <TileDisplay tile={null} size="large" isHidden={true} />}
            </div>

            <div className="w-full flex flex-col items-center my-2">
                <div className="h-[230px] w-full max-w-2xl p-1 bg-black/30 rounded flex flex-wrap justify-start items-start content-start overflow-y-auto scrollbar-thin scrollbar-thumb-slate-500 scrollbar-track-slate-700">
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
                  gameState.gamePhase === GamePhase.ACTION_PENDING_CHI_CHOICE) && (
                    <div className="mb-2 p-1 bg-yellow-600/30 rounded flex flex-col items-center">
                        <span className="text-xs text-yellow-200 mb-0.5">最新棄牌 (待宣告):</span>
                        <TileDisplay tile={gameState.lastDiscardedTile} size="medium" isDiscarded isLatestDiscard={true} />
                    </div>
                )}
            </div>

            <div className="flex flex-wrap gap-2 justify-center items-center mt-auto p-2 min-h-[50px]">
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
                        {gameState.lastDrawnTile && canDeclareMingGangFromHand(humanPlayer.hand, humanPlayer.melds, gameState.lastDrawnTile).map(option => (
                            <ActionButton key={`ming-gang-${option.pengMeldKind}`} label={`加槓 ${option.pengMeldKind}`} onClick={() => emitPlayerAction({ type: 'DECLARE_MING_GANG_FROM_HAND', tileKind: option.pengMeldKind })} variant="warning" disabled={isSubmitting}/>
                        ))}
                        { (gameState.gamePhase === GamePhase.PLAYER_TURN_START && checkWinCondition(humanPlayer.hand, humanPlayer.melds).isWin) && (
                            <ActionButton label={"天胡"} onClick={() => emitPlayerAction({ type: 'DECLARE_HU' })} variant="danger" disabled={isSubmitting} />
                        )}
                        { (gameState.gamePhase === GamePhase.PLAYER_DRAWN && gameState.lastDrawnTile && checkWinCondition([...humanPlayer.hand, gameState.lastDrawnTile], humanPlayer.melds).isWin) && (
                            <ActionButton label={"自摸"} onClick={() => emitPlayerAction({ type: 'DECLARE_HU' })} variant="danger" disabled={isSubmitting} />
                        )}
                         { (gameState.gamePhase === GamePhase.AWAITING_DISCARD && currentPlayer?.isDealer && gameState.turnNumber === 1 && gameState.lastDrawnTile && checkWinCondition([...humanPlayer.hand, gameState.lastDrawnTile], humanPlayer.melds).isWin) && (
                            <ActionButton label={"胡牌"} onClick={() => emitPlayerAction({ type: 'DECLARE_HU' })} variant="danger" disabled={isSubmitting} />
                         )}
                    </>
                )}
            </div>
          </div>
      )}

      {(gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS && gameState.roomId) && (
          <WaitingRoomModal
            isOpen={true}
            onStartGame={handleStartGameFromModal}
            onQuitGame={onQuitGame}
            players={gameState.players}
            roomSettings={{
                id: gameState.roomId!,
                roomName: roomSettings.roomName,
                maxPlayers: roomSettings.maxPlayers,
                humanPlayers: roomSettings.humanPlayers,
                fillWithAI: roomSettings.fillWithAI,
                hostName: roomSettings.hostName,
                numberOfRounds: roomSettings.numberOfRounds,
            }}
            isHost={!!isHumanHost}
            dealerName={gameState.players.find(p => p.isDealer)?.name}
            currentRound={gameState.currentRound}
            numberOfRounds={gameState.numberOfRounds || initialGameState.numberOfRounds || 1}
          />
      )}

      {gameState.gamePhase === GamePhase.ROUND_OVER && gameState.nextRoundCountdown !== null && (
        <NextRoundConfirmModal
            isOpen={true}
            title={`第 ${gameState.currentRound} 局結束`}
            countdown={gameState.nextRoundCountdown}
            isHumanPlayer={!!humanPlayer}
            humanPlayerId={humanPlayer?.id}
            humanPlayersReadyForNextRound={gameState.humanPlayersReadyForNextRound}
            onConfirmNextRound={handleConfirmNextRound}
            onQuitGame={onQuitGame}
            roundOverDetails={roundOverModalDetails}
        />
      )}

      <div className="absolute bottom-2 left-2 w-[170px] h-32 overflow-y-auto bg-black/50 p-2 rounded text-xs text-slate-300 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
        {gameState.messageLog.slice(0, 10).map((msg, i) => <div key={i} className="mb-1">{msg}</div>)}
      </div>

      <div className="absolute bottom-4 right-4 z-30">
        <button
            onClick={() => setShowChatPanel(prev => !prev)}
            className="p-3 bg-sky-600 hover:bg-sky-700 rounded-full shadow-lg text-white transition-transform hover:scale-110 active:scale-95"
            aria-label={showChatPanel ? "關閉聊天室" : "開啟聊天室"}
            disabled={isSubmitting || gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS}
        >
            <ChatBubbleIcon />
        </button>
      </div>
      {showChatPanel && humanPlayer && gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS && (
        <ChatPanel
          isOpen={showChatPanel}
          onClose={() => setShowChatPanel(false)}
          messages={chatMessages}
          onSendMessage={handleSendChatMessage}
          currentPlayerName={humanPlayer.name}
        />
      )}

      <GameModal
        isOpen={gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES}
        title={gameOverModalTitle}
        onClose={undefined}
      >
        {gameOverModalContent}
        <hr className="my-4 border-slate-600" />

        <h3 className="text-lg font-semibold text-sky-300 mb-2">是否再戰一場？</h3>
        {gameState.rematchCountdown !== null && (
          <p className="text-amber-300 mb-3 animate-pulse">
            決定時間: {gameState.rematchCountdown}s
          </p>
        )}

        <div className="space-y-2 mb-4 max-h-32 overflow-y-auto">
            {gameState.players.filter(p => p.isHuman && p.isOnline).map(p => {
                const voteStatus = gameState.rematchVotes?.find(v => v.playerId === p.id)?.vote;
                return (
                    <div key={p.id} className="flex justify-between items-center text-sm">
                        <span>{p.name}{p.id === clientPlayerId ? " (你)" : ""}</span>
                        <span
                            className={`px-2 py-0.5 rounded text-xs ${
                                voteStatus === 'yes' ? 'bg-green-500 text-white'
                                : 'bg-slate-600 text-slate-300'
                            }`}
                        >
                            {voteStatus === 'yes' ? '已同意' : '考慮中...'}
                        </span>
                    </div>
                );
            })}
        </div>

        <div className="mt-4 flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-2">
          {humanPlayer && humanPlayerVote !== 'yes' && (
            <ActionButton
              label="同意再戰"
              onClick={handleVoteRematch}
              variant="primary"
              disabled={isSubmitting}
              className="w-full sm:w-auto"
            />
          )}
           {humanPlayer && humanPlayerVote === 'yes' && (
            <ActionButton
              label="已同意"
              onClick={() => {}}
              variant="primary"
              disabled={true}
              className="w-full sm:w-auto opacity-70 cursor-not-allowed"
            />
          )}
          <ActionButton
            label="返回大廳"
            onClick={onQuitGame}
            variant="secondary"
            disabled={isSubmitting}
            className="w-full sm:w-auto"
          />
        </div>
      </GameModal>

      <GameModal
        isOpen={gameState.gamePhase === GamePhase.GAME_OVER && gameState.matchOver}
        title={gameOverModalTitle}
        onClose={undefined}
      >
        {gameOverModalContent}
        <div className="mt-4 flex justify-end space-x-2">
           <ActionButton label="回大廳" onClick={onQuitGame} variant="secondary" disabled={isSubmitting} />
        </div>
      </GameModal>

      <GameModal
        isOpen={
            isSelectingChiCombo &&
            gameState.gamePhase === GamePhase.AWAITING_ALL_CLAIMS_RESPONSE &&
            !!availableClaimsForClient?.find(c => c.action === 'Chi') &&
            Array.isArray(localChiOptionsForClient) && localChiOptionsForClient.length > 0 &&
            !!gameState.lastDiscardedTile
        }
        title="選擇吃牌組合"
        onClose={() => setIsSelectingChiCombo(false)}
      >
        <div className="space-y-2">
          {localChiOptionsForClient?.map((option, index) => {
            const currentLastDiscardedTileForThisOption = gameState.lastDiscardedTile;

            if (!currentLastDiscardedTileForThisOption) {
                console.warn(`[GameBoard] Chi option ${index}: lastDiscardedTile became null before forming fullChiSet.`);
                return null;
            }

            const fullChiSet = [...option, currentLastDiscardedTileForThisOption];

            fullChiSet.sort((a, b) => {
                if (!a || !b ) {
                     console.error("[GameBoard] Sorting Chi set: unexpected null tile.", {a,b, optionIndex: index});
                     return 0;
                }
                if (!a.kind || !TILE_KIND_DETAILS[a.kind] || !b.kind || !TILE_KIND_DETAILS[b.kind]) {
                    console.error("[GameBoard] Sorting Chi set: tile has invalid or missing 'kind', or 'kind' not in TILE_KIND_DETAILS.", {a, b, optionIndex: index});
                    return 0;
                }
                return TILE_KIND_DETAILS[b.kind].orderValue - TILE_KIND_DETAILS[a.kind].orderValue;
            });

            return (
              <div key={index} className="flex items-center justify-between p-2 bg-slate-700 rounded hover:bg-slate-600">
                <div className="flex space-x-1">
                  {fullChiSet.map(tile => (
                    <TileDisplay
                        key={tile.id}
                        tile={tile}
                        size="small"
                        isDiscarded={tile.id === currentLastDiscardedTileForThisOption.id}
                    />
                  ))}
                </div>
                <ActionButton
                    label="吃此組合"
                    onClick={() => handleChiSelect(option)}
                    size="sm"
                    disabled={isSubmitting}
                />
              </div>
            );
          })}
           <div className="mt-4 flex justify-end">
            <ActionButton
                label="取消 / 跳過吃"
                onClick={() => {
                    setIsSelectingChiCombo(false);
                    if (gameState.gamePhase === GamePhase.AWAITING_ALL_CLAIMS_RESPONSE && availableClaimsForClient) {
                       handlePassClaimDecision();
                    }
                }}
                variant="secondary"
                size="sm"
                disabled={isSubmitting}
            />
          </div>
        </div>
      </GameModal>
    </div>
  );
};

export default GameBoard;
