
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
import WaitingRoomModal from './WaitingRoomModal'; 
import NextRoundConfirmModal from './NextRoundConfirmModal';
import ActionAnnouncer, { ActionAnnouncement } from './ActionAnnouncer'; 
import ProgressBar from './ProgressBar'; 
// 引入類型定義和常數
import { Tile, GamePhase, Claim, TileKind, Player, GameState, RoomSettings, ChatMessage, ServerToClientEvents, ClientToServerEvents, GameActionPayload, Suit, RematchVote } from '../types'; 
import { TILE_KIND_DETAILS, GamePhaseTranslations, INITIAL_HAND_SIZE_DEALER, PLAYER_TURN_ACTION_TIMEOUT_SECONDS, CLAIM_DECISION_TIMEOUT_SECONDS, NUM_PLAYERS, ALL_TILE_KINDS as TILE_KIND_ENUM_VALUES, NEXT_ROUND_COUNTDOWN_SECONDS } from '../constants'; 
// 引入遊戲規則相關的輔助函數 (主要用於 UI 判斷，伺服器為權威)
import { canDeclareAnGang, canDeclareMingGangFromHand, checkWinCondition, getChiOptions } from '../utils/gameRules'; 
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
    socket 
}) => {
  // --- 狀態管理 ---
  /** @description 當前的遊戲狀態，由 App.tsx 管理並透過 props傳入，此處為本地副本。 */
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  /** @description 當前選中的手牌 ID。 */
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  /** @description 是否正在選擇「吃」牌的組合 (用於控制吃牌選擇彈窗)。 */
  const [isSelectingChiCombo, setIsSelectingChiCombo] = useState(false);
  /** @description 是否顯示聊天面板。 */
  const [showChatPanel, setShowChatPanel] = useState(false); 
  /** @description 遊戲內的聊天訊息列表。 */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]); 
  /** @description 記錄上一次摸到的牌，用於 UI 輔助選擇。 */
  const prevLastDrawnTileRef = useRef<Tile | null | undefined>(undefined);
  /** @description 是否正在提交動作 (用於禁用按鈕，防止重複提交)。 */
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** @description 動作宣告的動畫訊息列表。 */
  const [actionAnnouncements, setActionAnnouncements] = useState<ActionAnnouncement[]>([]); 

  // --- 副作用 (useEffect) ---
  // 當 initialGameState (來自 props) 改變時 (例如加入新遊戲或新一局開始)，更新本地的 gameState
  useEffect(() => {
    setGameState(initialGameState); // 更新遊戲狀態
    setChatMessages([]); // 重置聊天訊息
    setActionAnnouncements([]); // 重置動作宣告動畫
    console.log(`[GameBoard] Initial game state updated for room ${initialGameState.roomId}, round ${initialGameState.currentRound}.`);
  }, [initialGameState.roomId, initialGameState.currentRound]); // 依賴 roomId 和 currentRound，確保房間或局數變化時重置

  // 監聽來自伺服器的 gameStateUpdate, gameChatMessage 和 actionAnnouncement 事件
  useEffect(() => {
    /**
     * @description 處理從伺服器收到的遊戲狀態更新。
     * @param {GameState} newGameState - 最新的遊戲狀態。
     */
    const handleGameStateUpdate = (newGameState: GameState) => {
      setGameState(newGameState);
      // 如果伺服器狀態改變導致「吃」牌選擇無效，則關閉選擇彈窗
      if (isSelectingChiCombo) {
        const { gamePhase, playerMakingClaimDecision, chiOptions, lastDiscardedTile } = newGameState;
        // 檢查是否仍然符合選擇「吃」牌的條件
        if (
            !(gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION &&
            playerMakingClaimDecision === clientPlayerId && // 是當前客戶端在做決定
            Array.isArray(chiOptions) && chiOptions.length > 0 && // 有可吃的選項
            !!lastDiscardedTile) // 有棄牌可吃
        ) {
            setIsSelectingChiCombo(false); // 條件不符，關閉彈窗
        }
      }
    };

    /**
     * @description 處理從伺服器收到的遊戲聊天訊息。
     * @param {ChatMessage} message - 收到的聊天訊息。
     */
    const handleGameChatMessage = (message: ChatMessage) => {
      setChatMessages(prev => [...prev, message]); // 將新訊息添加到列表中
    };
    
    /**
     * @description 處理從伺服器收到的動作宣告動畫事件。
     * @param {ServerActionAnnouncementData} announcementFromServer - 伺服器發送的宣告資料。
     */
    const handleActionAnnouncement = (announcementFromServer: ServerActionAnnouncementData) => {
       const numPlayers = NUM_PLAYERS; // 遊戲固定為4人
       
       // 計算宣告玩家相對於當前客戶端的 UI 位置
       // offset: 0=自己(bottom), 1=右邊(right), 2=對面(top), 3=左邊(left)
       const offset = (announcementFromServer.playerId - clientPlayerId + numPlayers) % numPlayers;
       let uiPosition: 'top' | 'bottom' | 'left' | 'right';
       
       switch (offset) {
           case 0: uiPosition = 'bottom'; break; 
           case 1: uiPosition = 'right'; break;  
           case 2: uiPosition = 'top'; break;    
           case 3: uiPosition = 'left'; break;   
           default: 
             uiPosition = 'bottom'; // 理論上不應發生，作為備用
             console.warn(`[GameBoard] 計算動作宣告的 offset 時發生錯誤: ${offset}。伺服器玩家ID: ${announcementFromServer.playerId}, 客戶端玩家ID: ${clientPlayerId}。預設為 'bottom'。`);
             break;
       }

       // 創建客戶端使用的宣告物件
       const clientSideAnnouncement: ActionAnnouncement = {
           id: announcementFromServer.id,
           text: announcementFromServer.text,
           playerId: announcementFromServer.playerId, // 保留原始ID供參考
           position: uiPosition, // 使用客戶端計算的相對位置
           isMultiHuTarget: announcementFromServer.isMultiHuTarget,
       };
       
       setActionAnnouncements(prev => [...prev, clientSideAnnouncement]); // 添加到宣告列表
       
       // --- 音效處理 ---
       let soundActionText = clientSideAnnouncement.text; // 宣告的文字
       let tileKindForSound: TileKind | undefined = undefined; // 相關的牌面 (用於打牌音效)

       // 檢查宣告文字是否為一種牌面 (例如，打牌時 text 為牌面)
       const isTileKind = TILE_KIND_ENUM_VALUES.some(kind => kind === clientSideAnnouncement.text);
       if (isTileKind) {
           soundActionText = "打牌"; // 若為牌面，則音效動作視為 "打牌"
           tileKindForSound = clientSideAnnouncement.text as TileKind; // 記錄牌面
       }
       
       // 需要播放音效的特殊動作列表
       const specialActionsForSound = ["碰", "吃", "槓", "明槓", "暗槓", "加槓", "胡", "自摸", "天胡", "一炮多響"];
       // 如果是特殊動作，或者是一般的 "打牌" 動作，則播放音效
       if (specialActionsForSound.includes(soundActionText) || soundActionText === "打牌") {
         playActionSound(soundActionText, tileKindForSound);
       }

       // 特殊處理「一炮多響」的胡牌音效
       const isHuAction = ["胡", "自摸", "天胡"].includes(clientSideAnnouncement.text);
       if (isHuAction && clientSideAnnouncement.isMultiHuTarget) {
           playActionSound("一炮多響"); 
       }

       // 設定動畫持續時間，並在動畫結束後移除宣告
       const animationDuration = (isHuAction && clientSideAnnouncement.isMultiHuTarget) ? 3000 : 2500; // 毫秒
       setTimeout(() => {
            setActionAnnouncements(prevMsgs => prevMsgs.filter(m => m.id !== clientSideAnnouncement.id));
       }, animationDuration);
    };

    // 監聽 Socket 事件
    socket.on('gameStateUpdate', handleGameStateUpdate);
    socket.on('gameChatMessage', handleGameChatMessage);
    socket.on('actionAnnouncement', handleActionAnnouncement as (data: any) => void); // 使用 any 轉型以匹配可能的類型差異，需確保邏輯正確

    // 清理函數：移除事件監聽器
    return () => {
      socket.off('gameStateUpdate', handleGameStateUpdate);
      socket.off('gameChatMessage', handleGameChatMessage);
      socket.off('actionAnnouncement', handleActionAnnouncement as (data: any) => void);
    };
  }, [socket, TILE_KIND_ENUM_VALUES, clientPlayerId, gameState.players.length, isSelectingChiCombo]); // 依賴項

  // --- 玩家相關衍生變數 (從 gameState 獲取) ---
  /** @description 當前客戶端的玩家物件 (如果存在且為真人)。 */
  const humanPlayer = gameState.players.find(p => p.id === clientPlayerId && p.isHuman);
  /** @description 當前回合的玩家物件。 */
  const currentPlayer = gameState.players.length > 0 ? gameState.players[gameState.currentPlayerIndex] : null;
  /** @description 正在做宣告決定的玩家物件。 */
  const playerMakingDecision = gameState.playerMakingClaimDecision !== null ? gameState.players.find(p => p.id === gameState.playerMakingClaimDecision) : null;
  /** @description 當前客戶端是否為房主。 */
  const isHumanHost = humanPlayer?.isHost;


  // UI 輔助：自動選中剛摸到的牌 (僅對真人玩家)
  useEffect(() => {
    const currentLDT = gameState.lastDrawnTile; // 當前摸到的牌
    const previousLDT = prevLastDrawnTileRef.current; // 上一次摸到的牌 (記錄用)
    // 當前客戶端是否為真人玩家且輪到其行動
    const humanPlayerIsCurrent = humanPlayer && currentPlayer?.id === humanPlayer.id;
    // 是否為莊家第一回合 (已發8張牌，等待打出第一張牌)
    const isDealerInitialTurn = currentPlayer?.isDealer && 
                                gameState.turnNumber === 1 && 
                                gameState.players.length > 0 && 
                                currentPlayer.id === gameState.players[gameState.dealerIndex].id;

    // 是否應該考慮自動選中牌的條件
    const shouldConsiderAutoSelect = currentLDT && humanPlayerIsCurrent &&
      ( gameState.gamePhase === GamePhase.PLAYER_DRAWN || // 玩家已摸牌，等待打牌
        (gameState.gamePhase === GamePhase.AWAITING_DISCARD && isDealerInitialTurn) ); // 莊家開局等待打牌

    if (shouldConsiderAutoSelect) {
      // 如果摸到的牌發生了顯著變化 (例如，從無到有，或ID不同)
      const ldtHasChangedSignificantly = (!previousLDT && currentLDT) || (previousLDT && currentLDT && previousLDT.id !== currentLDT.id);
      if (ldtHasChangedSignificantly) { // 移除了 `|| selectedTileId === null` 條件
         setSelectedTileId(currentLDT!.id); // 自動選中剛摸到的牌
      }
    }
    prevLastDrawnTileRef.current = currentLDT; // 更新記錄的上一次摸到的牌
  }, [humanPlayer, currentPlayer, gameState.gamePhase, gameState.lastDrawnTile, gameState.turnNumber, selectedTileId, gameState.dealerIndex, gameState.players]); // 依賴項

  /**
   * @description 向伺服器發送玩家動作。
   * @param {GameActionPayload} action - 要發送的動作及其負載。
   */
  const emitPlayerAction = useCallback((action: GameActionPayload) => {
    if (!gameState.roomId) { // 防禦性檢查：房間ID必須存在
        console.error("[GameBoard] 無法發送玩家動作：roomId 為 null。");
        alert("發生錯誤：房間 ID 未設定，無法執行動作。");
        return;
    }
    setIsSubmitting(true); // 設定為提交中，禁用按鈕
    socket.emit('gamePlayerAction', gameState.roomId, action); // 發送動作到伺服器
    // 伺服器將回應 gameStateUpdate 或 gameError
    // 對於打牌等動作，可以選擇樂觀地清除選中牌，或等待伺服器確認
    if (action.type === 'DISCARD_TILE') setSelectedTileId(null); // 打牌後清除選中
    // 短暫延遲後重新啟用按鈕，或根據伺服器回應來處理
    setTimeout(() => setIsSubmitting(false), 500); // 簡單的超時處理
  }, [socket, gameState.roomId]); // 依賴 socket 和 roomId


  // --- 自動摸牌功能 ---
  // 當輪到真人玩家行動且遊戲階段為 PLAYER_TURN_START 時，自動執行摸牌動作
  useEffect(() => {
    if (
      gameState.gamePhase === GamePhase.PLAYER_TURN_START && // 遊戲階段為玩家回合開始
      humanPlayer && // 客戶端是遊戲中的玩家
      humanPlayer.isOnline && // 且玩家在線
      gameState.currentPlayerIndex === humanPlayer.id // 且輪到此玩家行動
    ) {
      console.log(`[GameBoard] 為 ${humanPlayer.name} (座位: ${humanPlayer.id}) 自動摸牌。`);
      emitPlayerAction({ type: 'DRAW_TILE' }); // 發送摸牌動作
    }
  }, [gameState.gamePhase, gameState.currentPlayerIndex, humanPlayer, emitPlayerAction]); // 依賴項
  // --- 自動摸牌功能結束 ---

  /**
   * @description 處理手牌點擊事件。
   * @param {Tile} tile - 被點擊的牌。
   */
  const handleTileClick = useCallback((tile: Tile) => {
    // 僅当是真人玩家的回合，且遊戲階段允許選擇手牌時有效
    if (humanPlayer && currentPlayer?.id === humanPlayer.id && gameState.players.find(p => p.id === humanPlayer.id)?.isHuman) {
        if (gameState.gamePhase === GamePhase.PLAYER_DRAWN || gameState.gamePhase === GamePhase.AWAITING_DISCARD) {
            // 點擊已選中的牌則取消選中，否則選中該牌
            setSelectedTileId(currentSelectedId => (currentSelectedId === tile.id ? null : tile.id));
        }
    }
  }, [humanPlayer, currentPlayer, gameState.gamePhase, gameState.players]); // 依賴項 (gameState.players 加入以確保玩家資訊最新)

  // --- 玩家動作處理函數 ---
  /** @description 處理打牌動作。 */
  const handleDiscard = () => {
    if (selectedTileId) { // 必須有選中的牌才能打出
      // 打牌音效將由伺服器的 actionAnnouncement 事件觸發
      emitPlayerAction({ type: 'DISCARD_TILE', tileId: selectedTileId });
    }
  };

  /** @description 處理手動摸牌動作 (目前主要由自動摸牌觸發，此按鈕已註解)。 */
  const handleDrawTile = () => {
    setSelectedTileId(null); // 摸牌前清除選中牌
    // 摸牌音效通常不播放，或由伺服器宣告處理
    emitPlayerAction({ type: 'DRAW_TILE' });
  }
  /** @description 處理宣告胡牌動作。 */
  const handleDeclareHu = () => {
    // 胡牌音效將由伺服器的 actionAnnouncement 事件觸發
    emitPlayerAction({ type: 'DECLARE_HU' });
  }
  /** @description 處理跳過宣告動作。 */
  const handlePassClaim = () => {
    emitPlayerAction({ type: 'PASS_CLAIM' });
  }

  /** 
   * @description 處理選擇「吃」牌組合的動作。
   * @param {Tile[]} chiOption - 玩家選擇的用於「吃」的手牌組合 (兩張牌)。
   */
  const handleChiSelect = (chiOption: Tile[]) => {
    if (gameState.lastDiscardedTile) { // 必須有棄牌才能吃
      // 吃牌音效將由伺服器的 actionAnnouncement 事件觸發
      emitPlayerAction({ type: 'CLAIM_CHI', tilesToChiWith: chiOption, discardedTile: gameState.lastDiscardedTile });
      setIsSelectingChiCombo(false); // 選擇後關閉吃牌彈窗
    }
  };

  /** 
   * @description 處理發送遊戲聊天訊息。
   * @param {string} messageText - 要發送的訊息內容。
   */
  const handleSendChatMessage = (messageText: string) => {
    if (!humanPlayer || !gameState.roomId) return; // 必須是真人玩家且在房間內
    socket.emit('gameSendChatMessage', gameState.roomId, messageText);
    // 樂觀更新已移除，等待伺服器透過 'gameChatMessage' 事件廣播回來
  };
  
  /** @description 處理從等待房間彈窗中開始遊戲的動作 (僅房主可操作)。 */
  const handleStartGameFromModal = () => {
    if (isHumanHost && gameState.roomId) { // 必須是房主且有房間ID
      setIsSubmitting(true); // 禁用按鈕
      socket.emit('gameRequestStart', gameState.roomId); // 向伺服器請求開始遊戲
      // 伺服器會將遊戲階段變為 DEALING 並發送 gameStateUpdate
      setTimeout(() => setIsSubmitting(false), 1000); // 防止重複點擊
    }
  };
  
  /** @description 處理確認下一局的動作。 */
  const handleConfirmNextRound = () => {
    if (humanPlayer && gameState.roomId) { // 必須是真人玩家且有房間ID
        emitPlayerAction({ type: 'PLAYER_CONFIRM_NEXT_ROUND', playerId: humanPlayer.id });
    }
  };
  
  /** @description 處理投票同意再戰的動作。 */
  const handleVoteRematch = () => {
    if (humanPlayer && gameState.roomId) {
        emitPlayerAction({type: 'PLAYER_VOTE_REMATCH', vote: 'yes'});
    }
  };

  // --- 渲染輔助函數 ---
  /**
   * @description 根據指定的位置渲染玩家顯示區域。
   * @param {'bottom' | 'left' | 'top' | 'right'} playerDisplayPosition - 要渲染的玩家位置。
   * @returns {JSX.Element} 渲染的玩家顯示組件。
   */
  const renderPlayer = (playerDisplayPosition: 'bottom' | 'left' | 'top' | 'right') => {
    if (gameState.players.length === 0) { // 如果還沒有玩家資料
      return <div className={`p-2 rounded-lg shadow-inner bg-slate-700/30 min-h-[100px] w-full flex items-center justify-center text-slate-500 text-xs`}>等待玩家資料...</div>;
    }
    
    let displayPlayerIndex = -1; // 要顯示的玩家在 gameState.players 陣列中的索引
    // 使用 NUM_PLAYERS (遊戲固定人數) 計算相對位置，以確保一致性
    const numGamePlayers = gameState.players.length >= NUM_PLAYERS ? gameState.players.length : NUM_PLAYERS;

    if (clientPlayerId === null || numGamePlayers === 0) return <div className="p-2">等待玩家資訊...</div>;

    // 計算對應位置的玩家索引
    switch (playerDisplayPosition) {
        case 'bottom': displayPlayerIndex = clientPlayerId; break; // 底部是自己
        case 'right': displayPlayerIndex = (clientPlayerId + 1) % numGamePlayers; break; // 右邊是下家
        case 'top': displayPlayerIndex = (clientPlayerId + 2) % numGamePlayers; break;   // 對面是對家
        case 'left': displayPlayerIndex = (clientPlayerId + 3) % numGamePlayers; break;  // 左邊是上家
    }
    
    // 防禦性檢查：索引是否有效
    if (displayPlayerIndex < 0 || displayPlayerIndex >= gameState.players.length) { 
       return <div className={`p-2 rounded-lg shadow-inner bg-slate-700/30 min-h-[100px] w-full flex items-center justify-center text-slate-500 text-xs`}>玩家席位 (空位或錯誤 ID: {displayPlayerIndex})</div>;
    }

    const targetPlayerToDisplay = gameState.players[displayPlayerIndex]; // 獲取要顯示的玩家物件

    if (!targetPlayerToDisplay) { // 再次防禦：如果找不到玩家物件
         return <div className={`p-2 rounded-lg shadow-inner bg-slate-700/30 min-h-[100px] w-full flex items-center justify-center text-slate-500 text-xs`}>玩家席位 (錯誤)</div>;
    }
    
    // 渲染 PlayerDisplay 組件
    return (
      <PlayerDisplay
        player={targetPlayerToDisplay}
        // 是否為當前回合玩家 (包含正在做宣告決定的玩家)
        isCurrentPlayer={
            targetPlayerToDisplay.id === currentPlayer?.id || 
            (targetPlayerToDisplay.id === playerMakingDecision?.id && gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION) 
        }
        isHumanPlayerView={playerDisplayPosition === 'bottom'} // 底部視為真人玩家主視角
        onTileClick={playerDisplayPosition === 'bottom' ? handleTileClick : undefined} // 僅底部玩家可點擊手牌
        selectedTileId={playerDisplayPosition === 'bottom' ? selectedTileId : null} // 僅底部玩家顯示選中牌
        position={playerDisplayPosition} // 玩家位置
        gamePhase={gameState.gamePhase} // 當前遊戲階段
      />
    );
  };

  // --- UI 邏輯：根據遊戲狀態判斷按鈕是否啟用/顯示 ---
  let canHumanPlayerDraw = false; // 真人玩家是否可以摸牌
  let canHumanPlayerDiscard = false; // 真人玩家是否可以打牌
  let canHumanPlayerDeclareWin = false; // 真人玩家是否可以胡牌
  let winButtonLabel = "胡牌"; // 胡牌按鈕的文字
  const humanPlayerAnGangOptions: TileKind[] = []; // 真人玩家可暗槓的選項
  const humanPlayerMingGangFromHandOptions: {pengMeldKind: TileKind, drawnTile: Tile}[] = []; // 真人玩家可加槓的選項
  let humanPlayerClaimActions: Claim[] = []; // 真人玩家對棄牌可做的宣告

  // 僅在真人玩家存在且遊戲未結束/等待/本局結束/等待再戰投票 時計算
  if (humanPlayer && 
      gameState.gamePhase !== GamePhase.GAME_OVER && 
      gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS && 
      gameState.gamePhase !== GamePhase.ROUND_OVER &&
      gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES 
    ) {
    const humanIsCurrentPlayer = currentPlayer?.id === humanPlayer.id; // 是否輪到真人玩家
    const humanIsMakingClaimDecision = playerMakingDecision?.id === humanPlayer.id; // 是否是真人在做宣告決定

    if (humanIsCurrentPlayer) { // 如果輪到真人玩家
        if (gameState.gamePhase === GamePhase.PLAYER_TURN_START) { // 回合開始，等待摸牌
            const canWinBeforeDraw = checkWinCondition(humanPlayer.hand, humanPlayer.melds).isWin; // 檢查摸牌前是否可胡 (天胡)
            const anGangOptionsBeforeDraw = canDeclareAnGang(humanPlayer.hand, null); // 檢查摸牌前可否暗槓
            canHumanPlayerDraw = true; // 總是允許摸牌 (即使有天胡/暗槓選項，仍可選擇摸牌)
            if (canWinBeforeDraw) {
                canHumanPlayerDeclareWin = true;
                winButtonLabel = "天胡"; 
            }
            humanPlayerAnGangOptions.push(...anGangOptionsBeforeDraw);
        }
        if (gameState.gamePhase === GamePhase.PLAYER_DRAWN && gameState.lastDrawnTile) { // 已摸牌，等待打牌
            canHumanPlayerDiscard = true; // 可以打牌
            const handForWinCheck = gameState.lastDrawnTile ? [...humanPlayer.hand, gameState.lastDrawnTile] : humanPlayer.hand;
            if (checkWinCondition(handForWinCheck, humanPlayer.melds).isWin) { // 檢查是否自摸
                canHumanPlayerDeclareWin = true;
                winButtonLabel = "自摸";
            }
            humanPlayerAnGangOptions.push(...canDeclareAnGang(humanPlayer.hand, gameState.lastDrawnTile)); // 檢查暗槓 (含剛摸的牌)
            if (gameState.lastDrawnTile) { // 檢查加槓
                humanPlayerMingGangFromHandOptions.push(...canDeclareMingGangFromHand(humanPlayer.hand, humanPlayer.melds, gameState.lastDrawnTile));
            }
        }
        if (gameState.gamePhase === GamePhase.AWAITING_DISCARD) { // 等待打牌 (莊家開局或吃碰槓後)
            canHumanPlayerDiscard = true; // 可以打牌
            // 特殊情況：莊家開局第一回合，手牌8張，檢查是否胡牌或暗槓
            if (currentPlayer?.isDealer && gameState.turnNumber === 1 && gameState.lastDrawnTile && humanPlayer.hand.length +1 === INITIAL_HAND_SIZE_DEALER) { 
                 const dealerInitialHandForWinCheck = [...humanPlayer.hand, gameState.lastDrawnTile]; // 包含剛"摸"到的第8張牌
                 if (checkWinCondition(dealerInitialHandForWinCheck, humanPlayer.melds).isWin) {
                     canHumanPlayerDeclareWin = true;
                     winButtonLabel = "胡牌"; // 莊家開局胡牌
                 }
                 humanPlayerAnGangOptions.push(...canDeclareAnGang(dealerInitialHandForWinCheck, null)); // 莊家開局暗槓
            }
        }
    }

    // 如果是真人在做宣告決定，且有棄牌可供宣告
    if (humanIsMakingClaimDecision && gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && gameState.lastDiscardedTile) {
        humanPlayerClaimActions = humanPlayer.pendingClaims || []; // 從玩家物件中獲取可宣告的動作
    }
  }

  // 遊戲階段的中文名稱
  const phaseDisplayName = GamePhaseTranslations[gameState.gamePhase] || gameState.gamePhase;
  // 計時器是否對當前真人玩家有效
  const isTimerActiveForHuman = humanPlayer && gameState.actionTimer !== null && gameState.actionTimer > 0 &&
                                ((gameState.actionTimerType === 'claim' && playerMakingDecision?.id === humanPlayer.id) || 
                                 (gameState.actionTimerType === 'turn' && currentPlayer?.id === humanPlayer.id));
  // 計時器的最大值 (用於進度條)
  const maxTimerValue = gameState.actionTimerType === 'claim' ? CLAIM_DECISION_TIMEOUT_SECONDS : PLAYER_TURN_ACTION_TIMEOUT_SECONDS;


  // --- 遊戲/本局結束彈窗的內容 ---
  let gameOverModalTitle = "遊戲結束";
  let gameOverModalContent: React.ReactNode = <p>遊戲已結束。</p>;
  let roundOverModalDetails: Parameters<typeof NextRoundConfirmModal>[0]['roundOverDetails'] = null; // 用於 NextRoundConfirmModal 的詳細資訊

  // 條件調整：GAME_OVER 且 matchOver 才顯示最終結束彈窗，
  // ROUND_OVER 且有 nextRoundCountdown 顯示下一局確認彈窗，
  // AWAITING_REMATCH_VOTES 顯示再戰投票彈窗。
  if (gameState.gamePhase === GamePhase.GAME_OVER || gameState.gamePhase === GamePhase.ROUND_OVER || gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES) {
    if (gameState.winnerId !== null) { // 如果有贏家
        const winner = gameState.players.find(p => p.id === gameState.winnerId);
        if (winner) {
            roundOverModalDetails = { winnerName: winner.name, winType: gameState.winType, winningTileKind: gameState.winningDiscardedTile?.kind || gameState.lastDrawnTile?.kind };
            if (gameState.winType === 'selfDrawn') { // 自摸
                gameOverModalTitle = `${winner.name} 自摸!`;
                gameOverModalContent = <p>恭喜 {winner.name}，自摸獲勝！</p>;
            } else if (gameState.winType === 'discard' && gameState.winningDiscardedTile && gameState.winningTileDiscarderId !== null) { // 食胡
                const discarder = gameState.players.find(p => p.id === gameState.winningTileDiscarderId); // 放槍者
                gameOverModalTitle = `${winner.name} 胡牌!`;
                gameOverModalContent = <p>恭喜 {winner.name}！胡了由 ${discarder?.name || '某玩家'} 打出的【{gameState.winningDiscardedTile.kind}】。</p>;
                roundOverModalDetails.discarderName = discarder?.name || '某玩家';
            } else { // 其他胡牌情況 (理論上應為上述兩種之一)
                gameOverModalTitle = `${winner.name} 胡牌了!`; 
                gameOverModalContent = <p>恭喜 {winner.name}!</p>;
            }
        }
    } else if (gameState.isDrawGame) { // 流局
        gameOverModalTitle = "流局!";
        gameOverModalContent = <p>無人胡牌，本局為流局。</p>;
        roundOverModalDetails = { isDrawGame: true };
    }
    // 根據不同階段調整標題
    if (gameState.gamePhase === GamePhase.ROUND_OVER) { 
        gameOverModalTitle = `第 ${gameState.currentRound} 局結束`;
    } else if (gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES) {
        gameOverModalTitle = `比賽結束 (共 ${gameState.numberOfRounds || initialGameState.numberOfRounds || 1} 局)`; // 使用 gameState 或 initialGameState 的 numberOfRounds
        // gameOverModalContent 在 AWAITING_REMATCH_VOTES 階段由專門的彈窗處理
    }
  }
  
  // 初始載入狀態 (等待伺服器同步遊戲狀態)
  if (gameState.gamePhase === GamePhase.LOADING && gameState.players.length === 0) {
    return <div className="w-full h-full flex items-center justify-center text-xl">等待伺服器同步遊戲狀態...</div>;
  }

  const humanPlayerVote = humanPlayer && gameState.rematchVotes?.find(v => v.playerId === humanPlayer.id)?.vote;

  // --- JSX 渲染 ---
  return (
    // 遊戲板主容器：網格佈局，分為九宮格 (左、中、右欄；上、中、下排)
    <div className="w-full h-full max-w-7xl max-h-[1000px] bg-slate-800 shadow-2xl rounded-xl p-3 grid grid-cols-[180px_1fr_180px] grid-rows-[180px_1fr_180px] gap-2 relative landscape-mode">
      {/* 右上角按鈕區域：設定、離開房間 */}
      <div className="absolute top-3 right-3 z-50 flex items-center space-x-3">
        <button
            onClick={toggleSettingsPanel} // 開啟設定面板
            className="p-2 bg-slate-700/50 hover:bg-slate-600 rounded-full text-white transition-colors"
            aria-label="開啟設定"
            title="設定"
        >
            <SettingsIcon className="w-5 h-5" />
        </button>
        <ActionButton
            label="離開房間"
            onClick={onQuitGame} // 退出遊戲
            variant="secondary"
            size="sm"
            disabled={isSubmitting} // 提交中則禁用
            className="!px-3 !py-1.5 text-xs" // 強制覆寫部分樣式
        />
      </div>
      
      {/* 動作宣告動畫：僅顯示碰、吃、槓、胡等特殊宣告 */}
      {actionAnnouncements
        .filter(ann => { // 過濾要顯示的宣告類型
          const specialActions = ["碰", "吃", "槓", "明槓", "暗槓", "加槓", "胡", "自摸", "天胡", "一炮多響"];
          return specialActions.includes(ann.text);
        })
        .map(ann => (
        <ActionAnnouncer key={ann.id} announcement={ann} /> // 渲染宣告動畫組件
      ))}


      {/* 玩家顯示區域：僅在非等待玩家/等待再戰投票階段顯示 */}
      {gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS && gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES && (
        <>
          {/* 上方玩家 */}
          <div className="col-start-2 row-start-1 flex">
            {renderPlayer('top')}
          </div>
          {/* 左方玩家 */}
          <div className="col-start-1 row-start-2 flex justify-center items-center">
            {renderPlayer('left')}
          </div>
          {/* 右方玩家 */}
          <div className="col-start-3 row-start-2 flex justify-center items-center">
            {renderPlayer('right')}
          </div>
          {/* 下方玩家 (主視角) */}
          <div className="col-start-2 row-start-3 flex flex-row items-stretch">
            {renderPlayer('bottom')}
            {/* 如果是真人玩家的回合且已摸牌，在其右側顯示剛摸到的牌 */}
            {humanPlayer &&
                currentPlayer?.id === humanPlayer.id &&
                gameState.gamePhase === GamePhase.PLAYER_DRAWN && 
                gameState.lastDrawnTile && (
                <div className="ml-2 flex items-center justify-center relative z-10">
                    <TileDisplay
                        tile={gameState.lastDrawnTile}
                        onClick={() => handleTileClick(gameState.lastDrawnTile!)} // 點擊剛摸到的牌可選中它
                        isSelected={selectedTileId === gameState.lastDrawnTile.id} // 是否選中
                        size="medium"
                    />
                </div>
            )}
          </div>
        </>
      )}

      {/* 中央牌桌區域：顯示牌堆、棄牌堆、房間資訊、操作按鈕等 */}
      {gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS && 
       gameState.gamePhase !== GamePhase.ROUND_OVER && 
       gameState.gamePhase !== GamePhase.GAME_OVER && 
       gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES && 
       (
          // 背景、圓角、陰影、彈性佈局
          <div className="col-start-2 row-start-2 bg-green-900/50 rounded-lg shadow-inner p-4 flex flex-col items-center justify-between relative overflow-hidden">
            {/* 左上角房間資訊和右上角計時器 */}
            <div className="absolute top-3 left-3 z-10 w-[calc(100%-24px)] flex justify-between items-start">
                {/* 房間資訊 */}
                <div className="text-base text-slate-200 p-2 bg-black/50 rounded shadow-md">
                    <div>房間: <span className="font-semibold text-amber-200">{roomSettings.roomName}</span></div>
                    <div>局: <span className="font-semibold text-amber-200">{gameState.currentRound}/{gameState.numberOfRounds || initialGameState.numberOfRounds || 1}</span> | 回合: <span className="font-semibold text-amber-200">{gameState.turnNumber}</span></div>
                    <div className="mt-1">狀態: <span className="font-semibold text-sky-300">{phaseDisplayName}</span></div>
                </div>
                
                {/* 行動計時器 (僅對當前真人玩家顯示) */}
                {isTimerActiveForHuman && gameState.actionTimer !== null && (
                  <div className="flex flex-col items-center p-2 bg-black/50 rounded shadow-md">
                    <div className="text-base md:text-lg text-amber-300 font-semibold">
                        行動時間: {gameState.actionTimer}s
                    </div>
                    <ProgressBar 
                        currentTime={gameState.actionTimer} 
                        maxTime={maxTimerValue}
                        className="w-24 h-1.5 mt-1" // 進度條樣式
                    />
                  </div>
                )}
            </div>
            
            {/* 牌堆顯示 */}
            <div className="mt-20 flex items-center space-x-2 text-base text-slate-200 p-2 bg-black/50 rounded">
                <span>牌堆: {gameState.deck.length}</span>
                {gameState.deck.length > 0 && <TileDisplay tile={null} size="large" isHidden={true} />} {/* 顯示牌背代表牌堆 */}
            </div>

            {/* 棄牌堆顯示 */}
            <div className="w-full flex flex-col items-center my-2">
                <div className="h-[230px] w-full max-w-2xl p-1 bg-black/30 rounded flex flex-wrap justify-start items-start content-start overflow-y-auto scrollbar-thin scrollbar-thumb-slate-500 scrollbar-track-slate-700">
                {gameState.discardPile
                .slice() // 複製陣列以避免修改原狀態
                .reverse() // 反轉陣列，使最新棄牌顯示在最前面 (視覺上)
                .map((tile, index, reversedArray) => (
                    <div key={`${tile.id}-discard-wrapper-${index}`} className="m-0.5">
                    <TileDisplay 
                        tile={tile} 
                        size="medium" 
                        isDiscarded // 標記為棄牌
                        // 最新棄牌的判斷：是反轉後陣列的第一個，且其ID與 gameState.lastDiscardedTile?.id 相符
                        isLatestDiscard={index === reversedArray.length - 1 && gameState.lastDiscardedTile?.id === tile.id} 
                    />
                    </div>
                ))}
                </div>
            </div>

            {/* 最新棄牌 (等待宣告的牌) 的單獨顯示區域 */}
            <div className="flex-grow w-full flex flex-col items-center justify-center">
                {gameState.lastDiscardedTile && (gameState.gamePhase === GamePhase.TILE_DISCARDED || gameState.gamePhase === GamePhase.AWAITING_CLAIMS_RESOLUTION || gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION || gameState.gamePhase === GamePhase.ACTION_PENDING_CHI_CHOICE) && (
                    <div className="mb-2 p-1 bg-yellow-600/30 rounded flex flex-col items-center">
                        <span className="text-xs text-yellow-200 mb-0.5">最新棄牌 (待宣告):</span>
                        <TileDisplay tile={gameState.lastDiscardedTile} size="medium" isDiscarded isLatestDiscard={true} />
                    </div>
                )}
            </div>
        
            {/* 玩家操作按鈕區域 */}
            <div className="flex flex-wrap gap-2 justify-center items-center mt-auto p-2 min-h-[50px]">
                {/* 手動摸牌按鈕 (已為自動摸牌註解掉) */}
                {/*
                {canHumanPlayerDraw && (
                  <ActionButton label="摸牌" onClick={handleDrawTile} variant="primary" disabled={isSubmitting} />
                )}
                */}

                {/* 打牌按鈕 */}
                {canHumanPlayerDiscard && (
                <ActionButton label="打牌" onClick={handleDiscard} disabled={!selectedTileId || isSubmitting} variant="danger" />
                )}
                {/* 摸牌階段或莊家開局的可選動作：暗槓、加槓、胡牌 */}
                {(gameState.gamePhase === GamePhase.PLAYER_TURN_START || gameState.gamePhase === GamePhase.PLAYER_DRAWN || (gameState.gamePhase === GamePhase.AWAITING_DISCARD && currentPlayer?.isDealer && gameState.turnNumber ===1)) && humanPlayer && currentPlayer?.id === humanPlayer.id &&(
                <>
                    {/* 暗槓按鈕 (多個選項) */}
                    {humanPlayerAnGangOptions.map(kind => (
                    <ActionButton key={`an-gang-${kind}`} label={`暗槓 ${kind}`} onClick={() => emitPlayerAction({ type: 'DECLARE_AN_GANG', tileKind: kind })} variant="warning" disabled={isSubmitting} />
                    ))}
                    {/* 加槓按鈕 (多個選項) */}
                    {humanPlayerMingGangFromHandOptions.map(option => (
                    <ActionButton key={`ming-gang-${option.pengMeldKind}`} label={`加槓 ${option.pengMeldKind}`} onClick={() => emitPlayerAction({ type: 'DECLARE_MING_GANG_FROM_HAND', tileKind: option.pengMeldKind })} variant="warning" disabled={isSubmitting}/>
                    ))}
                    {/* 胡牌按鈕 (天胡/自摸) */}
                    {canHumanPlayerDeclareWin && ( 
                    <ActionButton label={winButtonLabel} onClick={handleDeclareHu} variant="danger" disabled={isSubmitting} />
                    )}
                </>
                )}
                {/* 宣告階段的按鈕：胡、碰、槓、吃、跳過 */}
                {gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && playerMakingDecision?.id === clientPlayerId && humanPlayerClaimActions.length > 0 && (
                <>
                    {humanPlayerClaimActions.map(claim => ( // 遍歷可宣告的動作
                    <ActionButton
                        key={claim.action}
                        label={claim.action === 'Hu' ? '胡牌' : claim.action === 'Peng' ? '碰' : claim.action === 'Gang' ? '槓' : '吃'}
                        onClick={() => {
                        if (!gameState.lastDiscardedTile) return; // 防禦：必須有棄牌才能宣告
                        // 根據宣告類型發送不同動作
                        if (claim.action === 'Hu') emitPlayerAction({ type: 'DECLARE_HU' });
                        else if (claim.action === 'Peng') emitPlayerAction({ type: 'CLAIM_PENG', tile: gameState.lastDiscardedTile });
                        else if (claim.action === 'Gang') emitPlayerAction({ type: 'CLAIM_GANG', tile: gameState.lastDiscardedTile });
                        else if (claim.action === 'Chi') {
                             // 如果伺服器提供了吃牌選項且輪到此玩家決定，則打開選擇彈窗
                             if (gameState.chiOptions && gameState.chiOptions.length > 0 && playerMakingDecision?.id === clientPlayerId) {
                               setIsSelectingChiCombo(true); // 打開吃牌組合選擇彈窗
                             } else {
                               console.warn("[GameBoard] 選擇「吃」但無可用選項或條件不符。自動跳過。");
                               handlePassClaim(); // 無法吃則跳過
                             }
                        }
                        }}
                        variant={claim.action === 'Hu' ? 'danger' : (claim.action === 'Chi' ? 'primary' : 'warning')} // 不同宣告用不同按鈕顏色
                        disabled={isSubmitting} // 提交中則禁用
                    />
                    ))}
                    {/* 跳過宣告按鈕 */}
                    <ActionButton label="跳過" onClick={handlePassClaim} variant="secondary" disabled={isSubmitting} />
                </>
                )}
            </div>
          </div>
      )}
      
      {/* 等待房間彈窗：當遊戲階段為 WAITING_FOR_PLAYERS 且有房間ID時顯示 */}
      {(gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS && gameState.roomId) && (
          <WaitingRoomModal
            isOpen={true} // 總是開啟 (因為外層已有條件判斷)
            onStartGame={handleStartGameFromModal} // 開始遊戲回調
            onQuitGame={onQuitGame} // 退出遊戲回調
            players={gameState.players} // 房間內玩家列表 (來自伺服器)
            roomSettings={{ // 房間設定 (從 gameState 和初始 roomSettings 組合)
                id: gameState.roomId,
                roomName: roomSettings.roomName,
                maxPlayers: roomSettings.maxPlayers,
                humanPlayers: roomSettings.humanPlayers,
                fillWithAI: roomSettings.fillWithAI,
                playerName: roomSettings.playerName, // 房主名稱
                numberOfRounds: gameState.numberOfRounds || NEXT_ROUND_COUNTDOWN_SECONDS,
            }}
            isHost={!!isHumanHost} // 是否為房主
            dealerName={gameState.players.find(p => p.isDealer)?.name} // 莊家名稱 (若已決定)
            currentRound={gameState.currentRound} // 當前局數
            numberOfRounds={gameState.numberOfRounds || initialGameState.numberOfRounds || 1} // 總局數
          />
      )}

      {/* 本局結束，等待下一局確認彈窗 */}
      {gameState.gamePhase === GamePhase.ROUND_OVER && gameState.nextRoundCountdown !== null && (
        <NextRoundConfirmModal
            isOpen={true} // 總是開啟
            title={`第 ${gameState.currentRound} 局結束`} // 彈窗標題
            countdown={gameState.nextRoundCountdown} // 倒數計時
            isHumanPlayer={!!humanPlayer} // 是否為真人玩家
            humanPlayerId={humanPlayer?.id} // 真人玩家ID
            humanPlayersReadyForNextRound={gameState.humanPlayersReadyForNextRound} // 已確認的真人玩家列表
            onConfirmNextRound={handleConfirmNextRound} // 確認下一局的回調
            onQuitGame={onQuitGame} // 退出遊戲的回調
            roundOverDetails={roundOverModalDetails} // 本局結束的詳細資訊 (贏家、方式等)
        />
      )}

      {/* 左下角遊戲訊息記錄 */}
      <div className="absolute bottom-2 left-2 w-[170px] h-32 overflow-y-auto bg-black/50 p-2 rounded text-xs text-slate-300 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
        {gameState.messageLog.slice(0, 10).map((msg, i) => <div key={i} className="mb-1">{msg}</div>)} {/* 最多顯示10條 */}
      </div>
      
      {/* 右下角聊天按鈕 */}
      <div className="absolute bottom-4 right-4 z-30">
        <button 
            onClick={() => setShowChatPanel(prev => !prev)} // 切換聊天面板顯示
            className="p-3 bg-sky-600 hover:bg-sky-700 rounded-full shadow-lg text-white transition-transform hover:scale-110 active:scale-95"
            aria-label={showChatPanel ? "關閉聊天室" : "開啟聊天室"}
            // 等待房間階段或提交中時禁用聊天按鈕
            disabled={isSubmitting || gameState.gamePhase === GamePhase.WAITING_FOR_PLAYERS}
        >
            <ChatBubbleIcon /> {/* 聊天圖示 */}
        </button>
      </div>
      {/* 聊天面板：當 showChatPanel 為 true，且是真人玩家，且不在等待房間階段時顯示 */}
      {showChatPanel && humanPlayer && gameState.gamePhase !== GamePhase.WAITING_FOR_PLAYERS && (
        <ChatPanel
          isOpen={showChatPanel}
          onClose={() => setShowChatPanel(false)} // 關閉面板回調
          messages={chatMessages} // 聊天訊息列表
          onSendMessage={handleSendChatMessage} // 發送訊息回調
          currentPlayerName={humanPlayer.name} // 當前玩家名稱
        />
      )}

       {/* 比賽結束後的再戰投票彈窗 */}
      <GameModal
        isOpen={gameState.gamePhase === GamePhase.AWAITING_REMATCH_VOTES}
        title={gameOverModalTitle} // 例如 "比賽結束 (共 N 局)"
        onClose={undefined} // 不允許點擊背景關閉
      >
        {/* 顯示最終結果 */}
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
            // Fix: Add onClick for disabled ActionButton
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


      {/* 遊戲結束 (最終) 彈窗 - 只有在 matchOver 且不是 AWAITING_REMATCH_VOTES 時顯示 */}
      <GameModal
        // Fix: Remove redundant gameState.gamePhase !== GamePhase.AWAITING_REMATCH_VOTES
        isOpen={gameState.gamePhase === GamePhase.GAME_OVER && gameState.matchOver}
        title={gameOverModalTitle}
        onClose={undefined} 
      >
        {gameOverModalContent}
        <div className="mt-4 flex justify-end space-x-2">
           {/* 此處不再有單獨的「再戰」按鈕，因為再戰邏輯已移至 AWAITING_REMATCH_VOTES 階段 */}
           <ActionButton label="回大廳" onClick={onQuitGame} variant="secondary" disabled={isSubmitting} />
        </div>
      </GameModal>


      {/* 選擇「吃」牌組合彈窗 */}
      <GameModal
        isOpen={ // 彈窗開啟條件
            isSelectingChiCombo && // 本地狀態控制是否嘗試開啟
            gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && // 伺服器等待此玩家做宣告決定
            // Fix: Correct typo from playerMakingClaimDecision to playerMakingClaimDecision
            playerMakingDecision?.id === clientPlayerId && // 確實是此客戶端在做決定
            Array.isArray(gameState.chiOptions) && gameState.chiOptions.length > 0 && // 伺服器提供了可吃的選項
            !!gameState.lastDiscardedTile // 有棄牌可吃
        }
        title="選擇吃牌組合" // 彈窗標題
        onClose={() => setIsSelectingChiCombo(false)} // 點擊背景關閉彈窗 (不執行跳過操作)
      >
        <div className="space-y-2">
          {gameState.chiOptions?.map((option, index) => { // 遍歷可吃的組合
            // 完整的吃牌組合 (手上兩張 + 棄牌一張)，並排序
            const fullChiSet = [...option, gameState.lastDiscardedTile!];
            fullChiSet.sort((a, b) => TILE_KIND_DETAILS[a.kind].orderValue - TILE_KIND_DETAILS[b.kind].orderValue); 
            
            return (
              <div key={index} className="flex items-center justify-between p-2 bg-slate-700 rounded hover:bg-slate-600">
                {/* 顯示吃牌組合 */}
                <div className="flex space-x-1">
                  {fullChiSet.map(tile => (
                    <TileDisplay 
                        key={tile.id} 
                        tile={tile} 
                        size="small" // 小尺寸牌
                        isDiscarded={tile.id === gameState.lastDiscardedTile!.id} // 標記被吃的棄牌
                    />
                  ))}
                </div>
                {/* 選擇此組合的按鈕 */}
                <ActionButton label="吃此組合" onClick={() => handleChiSelect(option)} size="sm" disabled={isSubmitting} />
              </div>
            );
          })}
           {/* 取消/跳過吃牌的按鈕 */}
           <div className="mt-4 flex justify-end">
            <ActionButton 
                label="取消 / 跳過吃" 
                onClick={() => { 
                    setIsSelectingChiCombo(false); // 關閉彈窗
                    // 如果伺服器仍然在等待此玩家做宣告決定，則執行跳過操作
                    if (gameState.gamePhase === GamePhase.AWAITING_PLAYER_CLAIM_ACTION && playerMakingDecision?.id === clientPlayerId) { 
                       handlePassClaim(); 
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
