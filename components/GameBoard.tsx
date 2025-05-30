
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
    // isSubmitting 應在動作完成後或超時後重置，此處不重置
    // hasAutoDrawnThisTurnRef 應在回合開始時或狀態改變時重置
    hasAutoDrawnThisTurnRef.current = false;
    console.log(`[GameBoard] Initial game state updated for room ${initialGameState.roomId}, round ${initialGameState.currentRound}.`);
  }, [initialGameState.roomId, initialGameState.currentRound]); // 確保只在這些關鍵 ID 改變時重置

  useEffect(() => {
    const handleGameStateUpdate = (newGameState: GameState) => {
      setGameState(newGameState);
      // 如果不是等待宣告回應的階段，則清除客戶端的宣告選項
      if (newGameState.gamePhase !== GamePhase.AWAITING_ALL_CLAIMS_RESPONSE) {
        setAvailableClaimsForClient(null);
        setLocalChiOptionsForClient(null);
        setIsSelectingChiCombo(false); // 確保關閉吃牌選擇
      }
      // 如果正在選擇吃牌組合，但遊戲階段已改變，則取消選擇
      if (isSelectingChiCombo && newGameState.gamePhase !== GamePhase.AWAITING_ALL_CLAIMS_RESPONSE) {
          setIsSelectingChiCombo(false);
      }
    };

    const handleGameChatMessage = (message: ChatMessage) => {
      setChatMessages(prev => [...prev, message]);
    };

    const handleActionAnnouncement = (announcementFromServer: ServerActionAnnouncementData) => {
       // 計算玩家在客戶端 UI 上的相對位置
       const numPlayers = NUM_PLAYERS; // 確保使用正確的玩家數量
       const offset = (announcementFromServer.playerId - clientPlayerId + numPlayers) % numPlayers;
       let uiPosition: 'top' | 'bottom' | 'left' | 'right';

       switch (offset) {
           case 0: uiPosition = 'bottom'; break;
           case 1: uiPosition = 'right'; break;
           case 2: uiPosition = 'top'; break;
           case 3: uiPosition = 'left'; break;
           default:
             // 預設或錯誤處理
             uiPosition = 'bottom'; // 或其他合理的預設值
             console.warn(`[GameBoard] 計算動作宣告的 offset 時發生錯誤: ${offset}。伺服器玩家ID: ${announcementFromServer.playerId}, 客戶端玩家ID: ${clientPlayerId}。預設為 'bottom'。`);
             break;
       }

       const clientSideAnnouncement: ActionAnnouncement = {
           id: announcementFromServer.id,
           text: announcementFromServer.text,
           playerId: announcementFromServer.playerId, // 保留伺服器端ID用於可能的邏輯
           position: uiPosition, // 使用計算出的客戶端相對位置
           isMultiHuTarget: announcementFromServer.isMultiHuTarget,
       };

       setActionAnnouncements(prev => [...prev, clientSideAnnouncement]);

       // --- 音效播放邏輯 ---
       let soundActionText = clientSideAnnouncement.text;
       let tileKindForSound: TileKind | undefined = undefined;

       // 檢查宣告文字是否為牌面本身 (例如 "將", "兵")
       const isTileKind = TILE_KIND_ENUM_VALUES.some(kind => kind === clientSideAnnouncement.text);
       if (isTileKind) {
           soundActionText = "打牌"; // 將動作歸類為 "打牌"
           tileKindForSound = clientSideAnnouncement.text as TileKind; // 記錄牌面
       }

       // 特定動作的音效
       const specialActionsForSound = ["碰", "吃", "槓", "明槓", "暗槓", "加槓", "胡", "自摸", "天胡", "一炮多響"];
       if (specialActionsForSound.includes(soundActionText) || soundActionText === "打牌") {
         playActionSound(soundActionText, tileKindForSound);
       }

       // 一炮多響的特殊音效
       const isHuAction = ["胡", "自摸", "天胡"].includes(clientSideAnnouncement.text);
       if (isHuAction && clientSideAnnouncement.isMultiHuTarget) {
           playActionSound("一炮多響"); // 假設有 "一炮多響.mp3" 或在 soundMap 中有對應
       }
       // --- 音效播放邏輯結束 ---

       // 自動移除宣告動畫
       const animationDuration = (isHuAction && clientSideAnnouncement.isMultiHuTarget) ? 3000 : 2500;
       setTimeout(() => {
            setActionAnnouncements(prevMsgs => prevMsgs.filter(m => m.id !== clientSideAnnouncement.id));
       }, animationDuration);
    };

    const handleAvailableClaimsNotification = (data: { claims: Claim[], chiOptions?: Tile[][] }) => {
        console.log(`[GameBoard] Received availableClaimsNotification for client ${clientPlayerId}:`, data);
        const clientSpecificClaims = data.claims.filter(claim => claim.playerId === clientPlayerId);
        setAvailableClaimsForClient(clientSpecificClaims.length > 0 ? clientSpecificClaims : null);

        // 如果有吃牌宣告，且伺服器提供了吃牌選項，則設定
        if (clientSpecificClaims.some(c => c.action === 'Chi') && data.chiOptions) {
            setLocalChiOptionsForClient(data.chiOptions);
        } else {
            setLocalChiOptionsForClient(null); // 否則清空
        }
    };

    socket.on('gameStateUpdate', handleGameStateUpdate);
    socket.on('gameChatMessage', handleGameChatMessage);
    socket.on('actionAnnouncement', handleActionAnnouncement as (data: any) => void); // 修正類型斷言
    socket.on('availableClaimsNotification', handleAvailableClaimsNotification);

    return () => {
      socket.off('gameStateUpdate', handleGameStateUpdate);
      socket.off('gameChatMessage', handleGameChatMessage);
      socket.off('actionAnnouncement', handleActionAnnouncement as (data: any) => void); // 修正類型斷言
      socket.off('availableClaimsNotification', handleAvailableClaimsNotification);
    };
  }, [socket, TILE_KIND_ENUM_VALUES, clientPlayerId, isSelectingChiCombo]); // 添加 TILE_KIND_ENUM_VALUES 和 isSelectingChiCombo 到依賴項

  const humanPlayer = gameState.players.find(p => p.id === clientPlayerId && p.isHuman);
  const currentPlayer = gameState.players.length > 0 ? gameState.players[gameState.currentPlayerIndex] : null;
  // const playerMakingDecision = gameState.playerMakingClaimDecision !== null ? gameState.players.find(p => p.id === gameState.playerMakingClaimDecision) : null; // 此變數可能不再主要使用
  const isHumanHost = humanPlayer?.isHost;

  // 自動選中摸到的牌
  useEffect(() => {
    const currentLDT = gameState.lastDrawnTile;
    const previousLDT = prevLastDrawnTileRef.current;
    const humanPlayerIsCurrent = humanPlayer && currentPlayer?.id === humanPlayer.id;
    // 檢查是否為莊家初始回合的特殊打牌階段
    const isDealerInitialTurn = currentPlayer?.isDealer &&
                                gameState.turnNumber === 1 &&
                                gameState.players.length > 0 && // 確保 players 陣列已填充
                                currentPlayer.id === gameState.players[gameState.dealerIndex].id;

    // 條件：是玩家回合且摸了牌，或者莊家開局等待打牌
    const shouldConsiderAutoSelect = currentLDT && humanPlayerIsCurrent &&
      ( gameState.gamePhase === GamePhase.PLAYER_DRAWN || // 玩家已摸牌
        (gameState.gamePhase === GamePhase.AWAITING_DISCARD && isDealerInitialTurn) ); // 莊家開局打牌前

    if (shouldConsiderAutoSelect) {
      // 只有當摸到的牌發生顯著變化時才自動選擇 (例如，從無到有，或者ID不同)
      const ldtHasChangedSignificantly = (!previousLDT && currentLDT) || (previousLDT && currentLDT && previousLDT.id !== currentLDT.id);
      if (ldtHasChangedSignificantly) {
         setSelectedTileId(currentLDT!.id); // 自動選中摸到的牌
      }
    }
    prevLastDrawnTileRef.current = currentLDT; // 更新上一張摸到的牌的 ref
  }, [humanPlayer, currentPlayer, gameState.gamePhase, gameState.lastDrawnTile, gameState.turnNumber, selectedTileId, gameState.dealerIndex, gameState.players]); // 添加 gameState.players 到依賴

  const emitPlayerAction = useCallback((action: GameActionPayload) => {
    if (!gameState.roomId) {
        console.error("[GameBoard] 無法發送玩家動作：roomId 為 null。");
        addNotification("發生錯誤：房間 ID 未設定，無法執行動作。", 'error');
        return;
    }
    setIsSubmitting(true); // 設定為正在提交，禁用按鈕
    socket.emit('gamePlayerAction', gameState.roomId, action);
    // 清理客戶端狀態 (例如，如果打牌，則取消選中)
    if (action.type === 'DISCARD_TILE') setSelectedTileId(null);
    if (action.type === 'SUBMIT_CLAIM_DECISION') {
      setAvailableClaimsForClient(null); // 清除可宣告選項
      setIsSelectingChiCombo(false);     // 關閉吃牌選擇
    }
    // 0.5秒後解除提交鎖定
    setTimeout(() => setIsSubmitting(false), 500);
  }, [socket, gameState.roomId, addNotification]);


  // --- 自動摸牌邏輯 ---
  useEffect(() => {
    // 條件：輪到真人玩家，是回合開始階段，且本回合尚未自動摸牌
    const shouldAutoDraw =
      gameState.gamePhase === GamePhase.PLAYER_TURN_START &&
      humanPlayer &&
      humanPlayer.isOnline &&
      gameState.currentPlayerIndex === humanPlayer.id &&
      !hasAutoDrawnThisTurnRef.current && // 檢查本回合是否已自動摸過牌
      !isSubmitting; // 檢查是否正在提交其他動作

    if (shouldAutoDraw) {
      console.log(`[GameBoard] 為 ${humanPlayer.name} (座位: ${humanPlayer.id}) 自動摸牌。`);
      // 注意：在發送 DRAW_TILE 之前 *不* 設定 hasAutoDrawnThisTurnRef.current = true
      // hasAutoDrawnThisTurnRef.current 的設定將移至 gameStateUpdate 的副作用中，
      // 當確認遊戲階段已變為 PLAYER_DRAWN 時才設定。
      emitPlayerAction({ type: 'DRAW_TILE' });
    }
  }, [gameState.gamePhase, gameState.currentPlayerIndex, humanPlayer, emitPlayerAction, isSubmitting, hasAutoDrawnThisTurnRef]);


  // 監控遊戲狀態，以確定 hasAutoDrawnThisTurnRef 的狀態
  useEffect(() => {
    const isMyTurnStartPhase =
      gameState.gamePhase === GamePhase.PLAYER_TURN_START &&
      humanPlayer?.id === gameState.currentPlayerIndex;
    const isMyTurnDrawnPhase =
      gameState.gamePhase === GamePhase.PLAYER_DRAWN &&
      humanPlayer?.id === gameState.currentPlayerIndex;

    if (isMyTurnStartPhase) {
      // 如果是我的回合開始階段 (新回合或槓牌後)，重置摸牌標記
      hasAutoDrawnThisTurnRef.current = false;
    } else if (isMyTurnDrawnPhase) {
      // 如果我已成功摸牌，設定標記
      hasAutoDrawnThisTurnRef.current = true;
    } else {
      // 如果不是我的回合開始，也不是我已摸牌的階段 (例如輪到別人，或進入宣告階段等)
      // 則重置此標記，以便輪到我時可以正確自動摸牌。
      hasAutoDrawnThisTurnRef.current = false;
    }
  }, [gameState.gamePhase, gameState.currentPlayerIndex, humanPlayer?.id]);
  // --- 自動摸牌邏輯結束 ---


  const handleTileClick = useCallback((tile: Tile) => {
    if (humanPlayer && currentPlayer?.id === humanPlayer.id && gameState.players.find(p => p.id === humanPlayer.id)?.isHuman) {
        // 只有在玩家已摸牌或等待出牌的階段才能選擇手牌
        if (gameState.gamePhase === GamePhase.PLAYER_DRAWN || gameState.gamePhase === GamePhase.AWAITING_DISCARD) {
            setSelectedTileId(currentSelectedId => (currentSelectedId === tile.id ? null : tile.id));
        }
    }
  }, [humanPlayer, currentPlayer, gameState.gamePhase, gameState.players]); // 添加 gameState.players 到依賴

  const handleDiscard = () => {
    if (selectedTileId) {
      emitPlayerAction({ type: 'DISCARD_TILE', tileId: selectedTileId });
    }
  };

  // 處理玩家提交 "跳過" 宣告
  const handlePassClaimDecision = () => {
    if (!humanPlayer) return; // 確保 humanPlayer 存在
    emitPlayerAction({
        type: 'SUBMIT_CLAIM_DECISION',
        decision: {
            playerId: clientPlayerId!, // 確保 clientPlayerId 已定義
            action: 'Pass'
        }
    });
  };

  // 處理玩家選擇吃牌組合
  const handleChiSelect = (chiOption: Tile[]) => {
    if (gameState.lastDiscardedTile && humanPlayer) { // 確保 humanPlayer 存在
      emitPlayerAction({
        type: 'SUBMIT_CLAIM_DECISION',
        decision: {
          playerId: clientPlayerId!, // 確保 clientPlayerId 已定義
          action: 'Chi',
          chiCombination: chiOption
        }
      });
    }
  };

  // 發送遊戲內聊天訊息
  const handleSendChatMessage = (messageText: string) => {
    if (!humanPlayer || !gameState.roomId) return; // 確保 humanPlayer 和 roomId 存在
    socket.emit('gameSendChatMessage', gameState.roomId, messageText);
  };

  // 房主從等待房間模態框開始遊戲
  const handleStartGameFromModal = () => {
    if (isHumanHost && gameState.roomId) {
      setIsSubmitting(true); // 開始提交
      socket.emit('gameRequestStart', gameState.roomId);
      setTimeout(() => setIsSubmitting(false), 1000); // 1秒後解除鎖定
    }
  };

  // 玩家確認下一局
  const handleConfirmNextRound = () => {
    if (humanPlayer && gameState.roomId) { // 確保 humanPlayer 和 roomId 存在
        emitPlayerAction({ type: 'PLAYER_CONFIRM_NEXT_ROUND', playerId: humanPlayer.id });
    }
  };

  // 玩家投票再戰
  const handleVoteRematch = () => {
    if (humanPlayer && gameState.roomId) { // 確保 humanPlayer 和 roomId 存在
        emitPlayerAction({type: 'PLAYER_VOTE_REMATCH', vote: 'yes'});
    }
  };

  // 渲染單個玩家的顯示區域
  const renderPlayer = (playerDisplayPosition: 'bottom' | 'left' | 'top' | 'right') => {
    if (gameState.players.length === 0) {
      // 若 gameState.players 為空，顯示等待訊息
      return <div className={`p-2 rounded-lg shadow-inner bg-slate-700/30 min-h-[100px] w-full flex items-center justify-center text-slate-500 text-xs`}>等待玩家資料...</div>;
    }

    let displayPlayerIndex = -1;
    // 確保使用正確的玩家數量進行模運算
    const numGamePlayers = gameState.players.length >= NUM_PLAYERS ? gameState.players.length : NUM_PLAYERS;

    if (clientPlayerId === null || numGamePlayers === 0) return <div className="p-2">等待玩家資訊...</div>;

    // 根據客戶端玩家ID和顯示位置計算目標玩家的索引
    switch (playerDisplayPosition) {
        case 'bottom': displayPlayerIndex = clientPlayerId; break;
        case 'right': displayPlayerIndex = (clientPlayerId + 1) % numGamePlayers; break;
        case 'top': displayPlayerIndex = (clientPlayerId + 2) % numGamePlayers; break;
        case 'left': displayPlayerIndex = (clientPlayerId + 3) % numGamePlayers; break;
    }

    // 檢查計算出的索引是否有效
    if (displayPlayerIndex < 0 || displayPlayerIndex >= gameState.players.length) {
       // 如果索引無效 (例如，玩家列表尚未完全填充或 clientPlayerId 異常)，顯示空位或錯誤提示
       return <div className={`p-2 rounded-lg shadow-inner bg-slate-700/30 min-h-[100px] w-full flex items-center justify-center text-slate-500 text-xs`}>玩家席位 (空位或錯誤 ID: {displayPlayerIndex})</div>;
    }

    const targetPlayerToDisplay = gameState.players[displayPlayerIndex];

    // 再次確認 targetPlayerToDisplay 是否存在
    if (!targetPlayerToDisplay) {
         return <div className={`p-2 rounded-lg shadow-inner bg-slate-700/30 min-h-[100px] w-full flex items-center justify-center text-slate-500 text-xs`}>玩家席位 (錯誤)</div>;
    }

    return (
      <PlayerDisplay
        player={targetPlayerToDisplay}
        isCurrentPlayer={
            targetPlayerToDisplay.id === currentPlayer?.id || // 是否為當前回合玩家
            // 或者，在等待宣告回應階段，且此玩家有可用宣告，且是本客戶端玩家
            (gameState.gamePhase === GamePhase.AWAITING_ALL_CLAIMS_RESPONSE &&
             !!availableClaimsForClient?.find(c => c.playerId === targetPlayerToDisplay.id) &&
             targetPlayerToDisplay.id === clientPlayerId)
        }
        isHumanPlayerView={playerDisplayPosition === 'bottom'} // 是否為主視角
        onTileClick={playerDisplayPosition === 'bottom' ? handleTileClick : undefined}
        selectedTileId={playerDisplayPosition === 'bottom' ? selectedTileId : null}
        position={playerDisplayPosition}
        gamePhase={gameState.gamePhase}
      />
    );
  };

  // --- 判斷當前真人玩家是否可以摸牌或打牌的邏輯 ---
  let canHumanPlayerDraw = false; // 是否可以摸牌
  let canHumanPlayerDiscard = false; // 是否可以打牌

  // 只有在遊戲進行中且非宣告階段，才判斷摸打牌權限
  if (humanPlayer &&
      gameState.gamePhase !== GamePhase.GAME_OVER &&
      gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS &&
      gameState.gamePhase !== GamePhase.ROUND_OVER &&
      gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES &&
      gameState.gamePhase !== GamePhase.AWAITING_ALL_CLAIMS_RESPONSE // 新增：宣告回應階段不能摸打
    ) {
    const humanIsCurrentPlayer = currentPlayer?.id === humanPlayer.id; // 當前是否輪到此真人玩家

    if (humanIsCurrentPlayer) { // 如果輪到此真人玩家
        if (gameState.gamePhase === GamePhase.PLAYER_TURN_START) {
            canHumanPlayerDraw = true; // 回合開始，可以摸牌
        }
        if (gameState.gamePhase === GamePhase.PLAYER_DRAWN && gameState.lastDrawnTile) {
            canHumanPlayerDiscard = true; // 已摸牌，可以打牌
        }
        // 如果是吃碰槓後等待出牌的階段
        if (gameState.gamePhase === GamePhase.AWAITING_DISCARD) {
            canHumanPlayerDiscard = true;
        }
    }
  }
  // --- 摸打牌權限判斷邏輯結束 ---

  // 獲取當前遊戲階段的顯示名稱
  const phaseDisplayName = GamePhaseTranslations[gameState.gamePhase] || gameState.gamePhase;

  // 判斷計時器是否對當前真人玩家激活
  const isTimerActiveForHuman = humanPlayer && gameState.actionTimer !== null && gameState.actionTimer > 0 &&
                                ( (gameState.actionTimerType === 'turn' && currentPlayer?.id === humanPlayer.id) || // 回合計時器
                                  (gameState.actionTimerType === 'global_claim' && !!availableClaimsForClient && availableClaimsForClient.length > 0) // 全局宣告計時器
                                );
  // 計時器的最大值
  const maxTimerValue = gameState.actionTimerType === 'global_claim' || gameState.actionTimerType === 'claim'
                        ? CLAIM_DECISION_TIMEOUT_SECONDS
                        : PLAYER_TURN_ACTION_TIMEOUT_SECONDS;


  // --- 遊戲結束/本局結束模態框的內容準備 ---
  let gameOverModalTitle = "遊戲結束";
  let gameOverModalContent: React.ReactNode = <p>遊戲已結束。</p>;
  let roundOverModalDetails: Parameters<typeof NextRoundConfirmModal>[0]['roundOverDetails'] = null; // 用於 NextRoundConfirmModal 的詳細資訊

  if (gameState.gamePhase === GamePhase.GAME_OVER || gameState.gamePhase === GamePhase.ROUND_OVER || gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES) {
    if (gameState.winnerId !== null) { // 如果有贏家
        const winner = gameState.players.find(p => p.id === gameState.winnerId);
        if (winner) {
            // 設定 NextRoundConfirmModal 的詳細資訊
            roundOverModalDetails = { winnerName: winner.name, winType: gameState.winType, winningTileKind: gameState.winningDiscardedTile?.kind || gameState.lastDrawnTile?.kind };
            if (gameState.winType === 'selfDrawn') { // 自摸
                gameOverModalTitle = `${winner.name} 自摸!`;
                gameOverModalContent = <p>恭喜 {winner.name}，自摸獲勝！</p>;
            } else if (gameState.winType === 'discard' && gameState.winningDiscardedTile && gameState.winningTileDiscarderId !== null) { // 食胡
                const discarder = gameState.players.find(p => p.id === gameState.winningTileDiscarderId);
                gameOverModalTitle = `${winner.name} 胡牌!`;
                gameOverModalContent = <p>恭喜 {winner.name}！胡了由 ${discarder?.name || '某玩家'} 打出的【{gameState.winningDiscardedTile.kind}】。</p>;
                roundOverModalDetails.discarderName = discarder?.name || '某玩家';
            } else { // 其他胡牌情況
                gameOverModalTitle = `${winner.name} 胡牌了!`;
                gameOverModalContent = <p>恭喜 {winner.name}!</p>;
            }
        }
    } else if (gameState.isDrawGame) { // 流局
        gameOverModalTitle = "流局!";
        gameOverModalContent = <p>無人胡牌，本局為流局。</p>;
        roundOverModalDetails = { isDrawGame: true };
    }
    // 根據不同階段設定模態框標題
    if (gameState.gamePhase === GamePhase.ROUND_OVER) {
        gameOverModalTitle = `第 ${gameState.currentRound} 局結束`;
    } else if (gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES) {
        gameOverModalTitle = `比賽結束 (共 ${gameState.numberOfRounds || initialGameState.numberOfRounds || 1} 局)`;
    }
  }
  // --- 模態框內容準備結束 ---

  // 初始載入時，如果玩家列表為空，顯示等待訊息
  if (gameState.gamePhase === GamePhase.LOADING && gameState.players.length === 0) {
    return <div className="w-full h-full flex items-center justify-center text-xl">等待伺服器同步遊戲狀態...</div>;
  }

  // 獲取當前真人玩家的再戰投票狀態
  const humanPlayerVote = humanPlayer && gameState.rematchVotes?.find(v => v.playerId === humanPlayer.id)?.vote;

  // --- JSX 渲染 ---
  return (
    <div className="w-full h-full max-w-7xl max-h-[1000px] bg-slate-800 shadow-2xl rounded-xl p-3 grid grid-cols-[180px_1fr_180px] grid-rows-[180px_1fr_180px] gap-2 relative landscape-mode">
      {/* 右上角控制按鈕區域 */}
      <div className="absolute top-3 right-3 z-50 flex items-center space-x-3">
        {/* 麥克風按鈕 - 只有在支援且本地流存在時才可操作 */}
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
         {/* 麥克風按鈕 - 禁用狀態 */}
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
        {/* 設定按鈕 */}
        <button
            onClick={toggleSettingsPanel}
            className="p-2 bg-slate-700/50 hover:bg-slate-600 rounded-full text-white transition-colors"
            aria-label="開啟設定"
            title="設定"
        >
            <SettingsIcon className="w-5 h-5" />
        </button>
        {/* 離開房間按鈕 */}
        <ActionButton
            label="離開房間"
            onClick={onQuitGame}
            variant="secondary"
            size="sm"
            disabled={isSubmitting} // 如果正在提交動作，則禁用
            className="!px-3 !py-1.5 text-xs" // 強制設定更小的內外邊距和字體大小
        />
      </div>

      {/* 動作宣告動畫顯示區域 (過濾只顯示主要動作) */}
      {actionAnnouncements
        .filter(ann => {
          // 只顯示明確的遊戲動作宣告，不顯示牌面本身 (打牌動作由牌桌中央的棄牌顯示)
          const specialActions = ["碰", "吃", "槓", "明槓", "暗槓", "加槓", "胡", "自摸", "天胡", "一炮多響"];
          return specialActions.includes(ann.text);
        })
        .map(ann => (
        <ActionAnnouncer key={ann.id} announcement={ann} />
      ))}


      {/* 玩家顯示區域 - 只有在非等待階段才渲染 */}
      {gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS && gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES && (
        <>
          {/* 上方玩家 */}
          <div className="col-start-2 row-start-1 flex">
            {renderPlayer('top')}
          </div>
          {/* 左側玩家 */}
          <div className="col-start-1 row-start-2 flex justify-center items-center">
            {renderPlayer('left')}
          </div>
          {/* 右側玩家 */}
          <div className="col-start-3 row-start-2 flex justify-center items-center">
            {renderPlayer('right')}
          </div>
          {/* 底部玩家 (真人主視角) */}
          <div className="col-start-2 row-start-3 flex flex-row items-stretch">
            {renderPlayer('bottom')}
            {/* 如果是真人玩家回合，且已摸牌，則在手牌旁邊顯示剛摸到的牌 */}
            {humanPlayer &&
                currentPlayer?.id === humanPlayer.id &&
                gameState.gamePhase === GamePhase.PLAYER_DRAWN &&
                gameState.lastDrawnTile && (
                <div className="ml-2 flex items-center justify-center relative z-10"> {/* 確保摸到的牌在最上層 */}
                    <TileDisplay
                        tile={gameState.lastDrawnTile}
                        onClick={() => handleTileClick(gameState.lastDrawnTile!)} // 點擊剛摸到的牌可以選中它
                        isSelected={selectedTileId === gameState.lastDrawnTile.id} // 是否被選中
                        size="medium"
                    />
                </div>
            )}
          </div>
        </>
      )}

      {/* 牌桌中央區域 - 只有在遊戲進行中才渲染 */}
      {gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS &&
       gameState.gamePhase !== GamePhase.ROUND_OVER &&
       gameState.gamePhase !== GamePhase.GAME_OVER &&
       gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES &&
       (
          <div className="col-start-2 row-start-2 bg-green-900/50 rounded-lg shadow-inner p-4 flex flex-col items-center justify-between relative overflow-hidden">
            {/* 左上角房間和遊戲資訊 */}
            <div className="absolute top-3 left-3 z-10 w-[calc(100%-24px)] flex justify-between items-start">
                <div className="text-base text-slate-200 p-2 bg-black/50 rounded shadow-md">
                    <div>房間: <span className="font-semibold text-amber-200">{roomSettings.roomName}</span></div>
                    <div>局: <span className="font-semibold text-amber-200">{gameState.currentRound}/{gameState.numberOfRounds || initialGameState.numberOfRounds || 1}</span> | 回合: <span className="font-semibold text-amber-200">{gameState.turnNumber}</span></div>
                    <div className="mt-1">狀態: <span className="font-semibold text-sky-300">{phaseDisplayName}</span></div>
                </div>

                {/* 右上角行動計時器 (如果激活) */}
                {isTimerActiveForHuman && gameState.actionTimer !== null && (
                  <div className="flex flex-col items-center p-2 bg-black/50 rounded shadow-md">
                    <div className="text-base md:text-lg text-amber-300 font-semibold">
                        行動時間: {gameState.actionTimer}s
                    </div>
                    <ProgressBar
                        currentTime={gameState.actionTimer}
                        maxTime={maxTimerValue} // 使用計算出的最大時間
                        className="w-24 h-1.5 mt-1" // 進度條寬度和高度
                    />
                  </div>
                )}
            </div>

            {/* 牌堆顯示 */}
            <div className="mt-10 flex items-center space-x-2 text-base text-slate-200 p-2 bg-black/50 rounded">
                <span>牌堆: {gameState.deck.length}</span>
                {/* 顯示一張牌背代表牌堆 */}
                {gameState.deck.length > 0 && <TileDisplay tile={null} size="medium" isHidden={true} />}
            </div>

            {/* 棄牌堆顯示 */}
            <div className="w-full flex flex-col items-center my-2">
                <div className="h-[166px] w-full max-w-2xl p-1 bg-black/30 rounded flex flex-wrap justify-start items-start content-start overflow-y-auto scrollbar-thin scrollbar-thumb-slate-500 scrollbar-track-slate-700">
                {gameState.discardPile
                .slice() // 創建副本以避免修改原陣列
                .reverse() // 反轉順序，最新的棄牌顯示在最前面 (邏輯上) 或最後面 (視覺上，取決於 flex-wrap)
                .map((discardInfo: DiscardedTileInfo, index: number, reversedArray: DiscardedTileInfo[]) => (
                    <div key={`${discardInfo.tile.id}-discard-wrapper-${index}`} className="m-0.5"> {/* 為每張棄牌添加外層 div 以應用 margin */}
                    <TileDisplay
                        tile={discardInfo.tile}
                        size="medium"
                        isDiscarded
                        // 最新棄牌的判斷：是反轉後陣列的最後一個元素，且其 ID 與 gameState.lastDiscardedTile 的 ID 相同
                        isLatestDiscard={index === reversedArray.length - 1 && gameState.lastDiscardedTile?.id === discardInfo.tile.id}
                    />
                    </div>
                ))}
                </div>
            </div>

            {/* 最新棄牌提示 (如果正在等待宣告) */}
            <div className="flex-grow w-full flex flex-col items-center justify-center">
                {gameState.lastDiscardedTile &&
                 (gameState.gamePhase === GamePhase.TILE_DISCARDED || // 舊的宣告階段
                  gameState.gamePhase === GamePhase.AWAITING_CLAIMS_RESOLUTION || // 正在解決宣告
                  gameState.gamePhase === GamePhase.AWAITING_ALL_CLAIMS_RESPONSE || // 等待所有宣告回應
                  gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION || // 等待特定玩家宣告 (舊流程)
                  gameState.gamePhase === GamePhase.ACTION_PENDING_CHI_CHOICE // 正在選擇吃牌組合
                  ) && (
                    <div className="-mt-10 mb-2 p-1 bg-yellow-600/30 rounded flex flex-col items-center">
                        <span className="text-xs text-yellow-200 mb-0.5">最新棄牌 (待宣告):</span>
                        <TileDisplay tile={gameState.lastDiscardedTile} size="medium" isDiscarded isLatestDiscard={true} />
                    </div>
                )}
            </div>

            {/* 操作按鈕區域 */}
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 flex flex-wrap gap-2 justify-center items-center p-2 min-h-[50px] w-auto max-w-full">
                {/* 打牌按鈕 (如果可以打牌) */}
                {canHumanPlayerDiscard && (
                <ActionButton label="打牌" onClick={handleDiscard} disabled={!selectedTileId || isSubmitting} variant="danger" />
                )}
                {/* 宣告按鈕 (如果處於宣告回應階段且有可用宣告) */}
                {gameState.gamePhase === GamePhase.AWAITING_ALL_CLAIMS_RESPONSE && availableClaimsForClient && humanPlayer && (
                <>
                    {availableClaimsForClient.map(claim => {
                        let label = '';
                        let actionType: 'Hu' | 'Peng' | 'Gang' | 'Chi' = claim.action; // 確保類型正確
                        switch(claim.action) {
                            case 'Hu': label = '胡牌'; break;
                            case 'Peng': label = '碰'; break;
                            case 'Gang': label = '槓'; break;
                            case 'Chi': label = '吃'; break;
                            default: return null; // 不應發生
                        }
                        return (
                            <ActionButton
                                key={claim.action}
                                label={label}
                                onClick={() => {
                                    if (claim.action === 'Chi') {
                                        // 如果是吃，且有可用的吃牌組合，則進入選擇組合的狀態
                                        if (localChiOptionsForClient && localChiOptionsForClient.length > 0) {
                                            setIsSelectingChiCombo(true);
                                        } else {
                                            // 理論上不應發生，因為 availableClaimsForClient 應該與 localChiOptionsForClient 同步
                                            console.warn("[GameBoard] 選擇「吃」但無可用組合。自動跳過。");
                                            handlePassClaimDecision(); // 作為備用，自動跳過
                                        }
                                    } else {
                                        // 其他宣告直接提交
                                        emitPlayerAction({
                                            type: 'SUBMIT_CLAIM_DECISION',
                                            decision: {
                                                playerId: clientPlayerId!,
                                                action: actionType,
                                                // 如果是碰或槓，記錄目標牌種
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
                    {/* 跳過宣告按鈕 */}
                    <ActionButton label="跳過" onClick={handlePassClaimDecision} variant="secondary" disabled={isSubmitting} />
                </>
                )}
                 {/* 摸牌前/後的自摸、暗槓、加槓按鈕 */}
                 { (gameState.gamePhase === GamePhase.PLAYER_TURN_START || // 回合開始 (摸牌前)
                    gameState.gamePhase === GamePhase.PLAYER_DRAWN ||       // 已摸牌
                    (gameState.gamePhase === GamePhase.AWAITING_DISCARD && currentPlayer?.isDealer && gameState.turnNumber === 1) // 莊家開局打第一張前
                   ) && humanPlayer && currentPlayer?.id === humanPlayer.id && (
                    <>
                        {/* 暗槓按鈕 (檢查手牌+摸到的牌) */}
                        {canDeclareAnGang(humanPlayer.hand, gameState.lastDrawnTile).map(kind => (
                            <ActionButton key={`an-gang-${kind}`} label={`暗槓 ${kind}`} onClick={() => emitPlayerAction({ type: 'DECLARE_AN_GANG', tileKind: kind })} variant="warning" disabled={isSubmitting} />
                        ))}
                        {/* 加槓按鈕 (檢查已碰面子和摸到的牌) */}
                        {gameState.lastDrawnTile && canDeclareMingGangFromHand(humanPlayer.hand, humanPlayer.melds, gameState.lastDrawnTile).map(gangOption => (
                            <ActionButton key={`ming-gang-hand-${gangOption.pengMeldKind}`} label={`加槓 ${gangOption.pengMeldKind}`} onClick={() => emitPlayerAction({ type: 'DECLARE_MING_GANG_FROM_HAND', tileKind: gangOption.pengMeldKind })} variant="warning" disabled={isSubmitting} />
                        ))}
                        {/* 自摸按鈕 */}
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

      {/* 聊天面板開關按鈕 */}
      <button
        onClick={() => setShowChatPanel(prev => !prev)}
        className="fixed bottom-4 right-4 z-30 p-3 bg-sky-600 hover:bg-sky-700 rounded-full text-white shadow-lg transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-sky-400"
        aria-label={showChatPanel ? "關閉聊天室" : "開啟聊天室"}
        title={showChatPanel ? "關閉聊天室" : "開啟聊天室"}
      >
        <ChatBubbleIcon className="w-6 h-6" />
      </button>

      {/* 聊天面板 */}
      <ChatPanel
        isOpen={showChatPanel}
        onClose={() => setShowChatPanel(false)}
        messages={chatMessages}
        onSendMessage={handleSendChatMessage}
        currentPlayerName={humanPlayer?.name || `玩家${clientPlayerId}`}
      />

      {/* 吃牌選擇模態框 */}
      {isSelectingChiCombo && localChiOptionsForClient && localChiOptionsForClient.length > 0 && humanPlayer && gameState.lastDiscardedTile && (
        <GameModal isOpen={isSelectingChiCombo} title="選擇吃的組合" onClose={() => { setIsSelectingChiCombo(false); handlePassClaimDecision(); /* 如果關閉視窗則視為跳過 */ }}>
          <div className="space-y-3">
            <p className="text-slate-300 mb-3">請選擇您要與【{gameState.lastDiscardedTile.kind}】組合成順子的手牌：</p>
            {localChiOptionsForClient.map((handTilesOption, index) => {
              // 將手牌和被吃的牌組合成完整順子
              const fullShunziCandidate: Tile[] = [...handTilesOption, gameState.lastDiscardedTile!];
              // 根據 orderValue 降序排列以獲得標準顯示順序 (例如 將, 士, 象)
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
                      // 如果這張牌是被吃的牌 (lastDiscardedTile)，則高亮它
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

      {/* 等待房間模態框 (僅在等待階段顯示) */}
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
      {/* 本局結束/下一局確認模態框 (僅在本局結束階段顯示，且不是最終比賽結束等待再戰投票時) */}
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
      {/* 比賽結束/再戰投票模態框 */}
      {gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES && gameState.matchOver && (
        <GameModal
            isOpen={true}
            title={gameOverModalTitle}
            // 再戰投票時不允許點擊背景關閉
        >
            <div className="text-center">
                {gameOverModalContent}
                <p className="mt-4 text-lg text-slate-100">
                    {gameState.rematchCountdown !== null
                        ? `再戰投票剩餘: ${gameState.rematchCountdown}s`
                        : "等待投票結果..."
                    }
                </p>
                {humanPlayer && humanPlayerVote === 'pending' && gameState.rematchCountdown !== null && (
                    <ActionButton label="同意再戰" onClick={handleVoteRematch} variant="primary" size="md" className="mt-6" />
                )}
                {humanPlayer && humanPlayerVote === 'yes' && (
                     <p className="mt-4 text-green-400">您已同意再戰，等待其他玩家...</p>
                )}
                 {!humanPlayer && (
                     <p className="mt-4 text-slate-400">AI 將自動處理再戰決定。</p>
                )}
                <ActionButton label="離開房間" onClick={onQuitGame} variant="secondary" size="md" className="mt-4" />
            </div>
        </GameModal>
      )}
    </div>
  );
};

export default GameBoard;
