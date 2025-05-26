

// 引入 React 相關的鉤子 (hooks) 和功能
import React, { useState, useEffect, useRef, useCallback } from 'react';
// 引入 socket.io-client 用於客戶端與伺服器的即時通訊
import { io, Socket } from 'socket.io-client';
// 引入各個 UI 組件
import GameBoard from './components/GameBoard'; // 遊戲主板組件
import Lobby from './components/Lobby';       // 遊戲大廳組件
import CreateRoomModal from './components/CreateRoomModal'; // 創建房間的彈出視窗組件
import HomePage from './components/HomePage';   // 主頁/開始頁面組件
import PasswordInputModal from './components/PasswordInputModal'; // 輸入密碼的彈出視窗組件
// Fix: Changed import for SettingsPanel to a named import as per the error message indicating no default export.
import { SettingsPanel } from './components/SettingsPanel'; // 設定面板組件
import SettingsIcon from './components/icons/SettingsIcon'; // 設定圖示組件
// 引入類型定義，確保數據結構的一致性
import { RoomSettings, RoomListData, GameState, ChatMessage, ServerToClientEvents, ClientToServerEvents, GamePhase, ClientRoomSettingsData } from './types';
// 引入遊戲固定玩家數量
import { NUM_PLAYERS } from './constants'; 
// 引入音效管理相關的函數
import { setActionSoundVolume, getActionSoundVolume } from './utils/audioManager';

// 定義應用程式可能有的視圖類型
type GameView = 'home' | 'lobby' | 'game'; // 'home': 主頁, 'lobby': 大廳, 'game': 遊戲中

// 安全地存取環境變數
// Vite 使用 import.meta.env 來存取環境變數
const env = (import.meta as any).env;
// Socket.IO 伺服器的 URL，優先從環境變數讀取，若無則使用本地開發預設值
const SOCKET_SERVER_URL = env?.VITE_SOCKET_SERVER_URL || 'http://localhost:3001';

/**
 * @description App 組件是整個應用程式的根組件，負責管理整體狀態、視圖切換和 Socket 連接。
 * @returns {React.FC} React 函數組件
 */
const App: React.FC = () => {
  // --- Socket.IO 相關狀態 ---
  /** @description Socket.IO 連接的實例 (使用 ref 以避免不必要的重渲染) */
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  /** @description Socket.IO 連接的實例 (使用 state 以觸發需要 socket 的組件重渲染) */
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  /** @description Socket.IO 是否已連接 */
  const [isConnected, setIsConnected] = useState(false);

  // --- 狀態管理 (useState) ---
  /** @description 當前應用程式的視圖 (例如：主頁、大廳、遊戲中) */
  const [currentView, setCurrentView] = useState<GameView>('home'); // 預設為 'home' (主頁)
  /** @description 是否顯示創建房間的彈出視窗 */
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  
  /** @description 當前所在的房間 ID */
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  /** @description 客戶端玩家在遊戲中的 ID (通常是座位索引) */
  const [clientPlayerId, setClientPlayerId] = useState<number | null>(null);
  /** @description 當前的遊戲狀態 */
  const [currentGameState, setCurrentGameState] = useState<GameState | null>(null);

  /** @description 玩家名稱，從 localStorage 讀取或預設為 "玩家" */
  const [playerName, setPlayerName] = useState<string>(localStorage.getItem('xiangqiMahjongPlayerName') || "玩家"); 

  /** @description 是否顯示輸入密碼的彈出視窗 */
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  /** @description 嘗試加入的房間的詳細資訊 (用於需要密碼的房間) */
  const [attemptingToJoinRoomDetails, setAttemptingToJoinRoomDetails] = useState<RoomListData | null>(null);

  // --- 背景音樂相關狀態 ---
  /** @description 背景音樂是否正在播放 */
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  /** @description 背景音樂音量 (0.0 到 1.0) */
  const [musicVolume, setMusicVolume] = useState(0.5); 
  /** @description HTMLAudioElement 的參照，用於控制背景音樂 */
  const audioRef = useRef<HTMLAudioElement>(null);

  // --- 遊戲音效相關狀態 ---
  /** @description 遊戲音效是否啟用 */
  const [isSoundEffectsEnabled, setIsSoundEffectsEnabled] = useState(true);
  /** @description 遊戲音效音量 (從 audioManager 獲取初始值) */
  const [soundEffectsVolume, setSoundEffectsVolume] = useState(getActionSoundVolume());

  // --- 其他狀態 ---
  /** @description 是否正在載入 (例如：連接伺服器、創建/加入房間) */
  const [isLoading, setIsLoading] = useState(false);
  /** @description 載入時顯示的訊息 */
  const [loadingMessage, setLoadingMessage] = useState<string>("處理中，請稍候...");
  /** @description 是否顯示設定面板 */
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  /** @description 大廳中的房間列表 */
  const [lobbyRooms, setLobbyRooms] = useState<RoomListData[]>([]);


  // --- Socket.IO 連接管理 ---
  // 此 useEffect 負責根據 playerName 和 currentView 狀態來建立或斷開 Socket.IO 連接
  useEffect(() => {
    // 只有當 playerName存在 且 不在 'home' 頁面時，才嘗試連接
    if (playerName && currentView !== 'home') {
      // 如果 socketRef.current (即 socket 連接實例) 不存在，則建立新連接
      if (!socketRef.current) { 
        console.log(`[App.tsx] 嘗試連接到 Socket.IO 伺服器: ${SOCKET_SERVER_URL}，玩家名稱: ${playerName}`);
        const newSocketInstance = io(SOCKET_SERVER_URL, {
          query: { playerName }, // 在查詢參數中傳遞玩家名稱，用於伺服器端初始設定
          reconnectionAttempts: 3, // 嘗試重新連接3次
        });
        socketRef.current = newSocketInstance; // 將新連接實例存儲到 ref
        setSocket(newSocketInstance); // 更新 state 以便其他 effect 或組件使用 socket
      } else if (socketRef.current.connected) {
        // 如果已經連接，但 playerName 或視圖上下文可能已更改
        // 則需要確保伺服器端知道這些變更 (例如，如果 playerName 在現有會話中更改)
        // onConnect 中的 userSetName 或 handleEnterLobby 會處理大廳上下文的此情況
      }
    } else {
      // 如果不在大廳/遊戲中，或者沒有 playerName，則斷開現有連接
      if (socketRef.current) {
        console.log('[App.tsx] 因視圖為 home 或 playerName 未設定，斷開 socket 連接。');
        socketRef.current.disconnect();
        socketRef.current = null; // 清除 ref
        setSocket(null); // 清除 state
        setIsConnected(false); // 更新連接狀態
      }
    }
    // 清理函數：當組件卸載，或回到 'home'，或 playerName 清空時，確保斷開連接
    return () => {
      if (socketRef.current && (currentView === 'home' || !playerName)) {
        console.log('[App.tsx] 從主要連接 effect 清理 socket 連接。');
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setIsConnected(false);
      }
    };
  }, [playerName, currentView]); // 依賴 playerName 和 currentView 來管理連接的建立與斷開


  // --- Socket.IO 事件處理器 ---
  // 此 useEffect 負責為 socket 實例附加和移除事件監聽器
  useEffect(() => {
    // 如果 socket state 為 null (表示 socketRef.current 也是 null 或剛被設為 null)
    if (!socket) { 
      setIsConnected(false); // 確保 isConnected 狀態正確
      return; // 不執行後續操作
    }

    // 從這裡開始，socket 保證是有效的實例
    console.log(`[App.tsx] 為 socket (ID: ${socket.id}) 附加事件監聽器。`);

    /**
     * @description 當 Socket.IO 連接成功時觸發。
     */
    const onConnect = () => {
      console.log('[App.tsx] Socket.IO 連接成功，ID:', socket.id);
      setIsConnected(true);
      setIsLoading(false);
      // 如果用戶在連接時的意圖是進入大廳
      if (currentView === 'lobby') { 
        // 向伺服器發送 userSetName 事件，設定玩家名稱
        socket.emit('userSetName', playerName, (ack) => { 
          if (ack.success) {
            console.log(`[App.tsx] 玩家名稱 '${playerName}' 已在伺服器設定，並已加入 'lobby' 群組。`);
            socket.emit('lobbyGetRooms'); // 設定成功後，獲取大廳房間列表
          } else {
            console.warn(`[App.tsx] 連接後在伺服器設定玩家名稱失敗: ${ack.message}`);
            alert(`設定玩家名稱失敗: ${ack.message}`);
          }
        });
      }
    };

    /**
     * @description 當 Socket.IO 連接斷開時觸發。
     * @param {string} reason - 連接斷開的原因。
     */
    const onDisconnect = (reason: string) => {
      console.warn('[App.tsx] Socket.IO 連接斷開:', reason);
      setIsConnected(false);
      setIsLoading(false);
      alert('與伺服器斷線，請檢查網路連線或重新整理頁面。');
    };

    /**
     * @description 當 Socket.IO 連接發生錯誤時觸發。
     * @param {Error} err - 錯誤物件。
     */
    const onConnectError = (err: Error) => {
      console.error('[App.tsx] Socket.IO 連接錯誤:', err.message);
      setIsLoading(false);
      alert(`無法連接到遊戲伺服器: ${err.message}。請稍後再試。`);
    };
    
    /**
     * @description 接收到大廳房間列表時觸發。
     * @param {RoomListData[]} rooms - 房間列表數據。
     */
    const onLobbyRoomList = (rooms: RoomListData[]) => {
      console.log(`[App.tsx] 客戶端 ${socket?.id} 收到 lobbyRoomList。目前視圖: ${currentView}。房間:`, rooms);
      setLobbyRooms(rooms); // 更新大廳房間列表狀態
    };

    /**
     * @description 成功加入房間後，伺服器發送此事件。
     * @param {object} data - 包含遊戲狀態、房間ID和客戶端玩家ID的數據。
     * @param {GameState} data.gameState - 初始遊戲狀態。
     * @param {string} data.roomId - 加入的房間ID。
     * @param {number} data.clientPlayerId - 客戶端在此房間中的玩家ID (座位索引)。
     */
    const onJoinedRoom = (data: { gameState: GameState; roomId: string; clientPlayerId: number }) => {
      console.log('[App.tsx] 成功加入房間，收到數據:', data);
      setCurrentRoomId(data.roomId); // 設定當前房間ID
      setClientPlayerId(data.clientPlayerId); // 設定客戶端玩家ID
      setCurrentGameState(data.gameState); // 設定初始遊戲狀態
      setCurrentView('game'); // 切換到遊戲視圖
      setIsLoading(false); // 停止載入狀態
    };
    
    /**
     * @description 遊戲狀態更新時觸發。
     * @param {GameState} updatedGameState - 最新的遊戲狀態。
     */
    const onGameStateUpdate = (updatedGameState: GameState) => {
      setCurrentGameState(updatedGameState); // 更新遊戲狀態
    };

    /**
     * @description 當有玩家離開遊戲時觸發 (例如斷線)。
     * @param {object} data - 包含離開玩家的資訊。
     * @param {number} data.playerId - 離開的玩家ID (座位索引)。
     * @param {number} [data.newHostId] - 如果房主離開，新的房主ID。
     * @param {string} [data.message] - 相關訊息。
     */
    const onGamePlayerLeft = (data: { playerId: number; newHostId?: number; message?: string }) => {
      console.log('[App.tsx] 玩家離開遊戲 (透過 gamePlayerLeft 事件):', data);
      // 處理玩家離開遊戲的邏輯，可能會影響此客戶端
    };
    
    /**
     * @description 遊戲過程中發生錯誤時，伺服器發送此事件。
     * @param {string} message - 錯誤訊息。
     */
    const onGameError = (message: string) => {
      // 如果客戶端已離開房間視圖 (currentRoomId 為 null)
      // 且錯誤訊息是關於房間已解散，則不顯示此錯誤給使用者，因為這是預期行為。
      if (currentRoomId === null && message === '房間已被解散。') {
        console.log('[App.tsx] 收到 "房間已解散" 錯誤，但已離開房間視圖，忽略此訊息。');
        setIsLoading(false); // 仍然確保停止載入狀態 (如果有的話)
        return; // 不顯示 alert
      }
      console.error('[App.tsx] 來自伺服器的遊戲錯誤:', message);
      alert(`遊戲錯誤: ${message}`);
      setIsLoading(false); // 停止載入狀態
    };

    /**
     * @description 在大廳操作時發生錯誤，伺服器發送此事件。
     * @param {string} message - 錯誤訊息。
     */
    const onLobbyError = (message: string) => {
      console.error('[App.tsx] 來自伺服器的大廳錯誤:', message);
      alert(`大廳錯誤: ${message}`);
      setIsLoading(false); // 停止載入狀態
    };

    // 為 socket 實例附加事件監聽器
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('lobbyRoomList', onLobbyRoomList);
    socket.on('joinedRoom', onJoinedRoom);
    socket.on('gameStateUpdate', onGameStateUpdate);
    socket.on('gamePlayerLeft', onGamePlayerLeft);
    socket.on('gameError', onGameError);
    socket.on('lobbyError', onLobbyError);

    // 清理函數：當 socket 實例改變或組件卸載時，移除這些監聽器
    return () => {
      console.log(`[App.tsx] 從 socket (ID: ${socket.id}) 移除事件監聽器。`);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('lobbyRoomList', onLobbyRoomList);
      socket.off('joinedRoom', onJoinedRoom);
      socket.off('gameStateUpdate', onGameStateUpdate);
      socket.off('gamePlayerLeft', onGamePlayerLeft);
      socket.off('gameError', onGameError);
      socket.off('lobbyError', onLobbyError);
    };
  }, [socket, currentView, clientPlayerId, currentGameState, playerName, currentRoomId]); // currentRoomId 加入依賴項以確保 onGameError 邏輯正確


  // --- 副作用處理 (useEffect) ---
  // 此 useEffect 負責根據 isMusicPlaying 和 musicVolume 狀態控制背景音樂的播放與音量
  useEffect(() => {
    if (audioRef.current) { 
      audioRef.current.volume = musicVolume; // 設定音量
      if (isMusicPlaying) {
        // 嘗試播放音樂，並捕獲可能的自動播放失敗錯誤
        audioRef.current.play().catch(error => console.warn("[App.tsx] 背景音樂自動播放失敗:", error)); 
      } else {
        audioRef.current.pause(); // 暫停音樂
      }
    }
  }, [isMusicPlaying, musicVolume]); // 依賴 isMusicPlaying 和 musicVolume 狀態

  // 此 useEffect 負責根據 isSoundEffectsEnabled 和 soundEffectsVolume 狀態設定遊戲音效的音量
  useEffect(() => {
    setActionSoundVolume(isSoundEffectsEnabled ? soundEffectsVolume : 0); // 若音效禁用，則音量設為0
  }, [isSoundEffectsEnabled, soundEffectsVolume]); // 依賴音效啟用狀態和音量

  // --- 事件處理函數 ---
  /** @description 切換背景音樂播放/暫停狀態 */
  const toggleMusicPlay = () => setIsMusicPlaying(!isMusicPlaying);
  /** 
   * @description 處理背景音樂音量變更
   * @param {number} newVolume - 新的音量值 (0.0 - 1.0)
   */
  const handleVolumeChange = (newVolume: number) => setMusicVolume(newVolume);

  /** @description 切換遊戲音效啟用/禁用狀態 */
  const toggleSoundEffectsEnabled = () => setIsSoundEffectsEnabled(prev => !prev);
  /** 
   * @description 處理遊戲音效音量變更
   * @param {number} newVolume - 新的音量值 (0.0 - 1.0)
   */
  const handleSoundEffectsVolumeChange = (newVolume: number) => setSoundEffectsVolume(newVolume);

  /** 
   * @description 處理進入大廳的邏輯
   * @param {string} name - 玩家輸入的名稱
   */
  const handleEnterLobby = useCallback((name: string) => {
    const newPlayerName = name.trim() || "玩家"; // 如果名稱為空，預設為 "玩家"
    setPlayerName(newPlayerName); // 更新玩家名稱狀態
    localStorage.setItem('xiangqiMahjongPlayerName', newPlayerName); // 將名稱存儲到 localStorage
    setCurrentView('lobby'); // 切換到大廳視圖
    // Socket 連接將由 useEffect 因 currentView/playerName 改變而處理
    // 如果 socket 已經連接 (例如，來自先前會話或快速導航)
    // 我們需要確保為新的大廳會話調用 userSetName
    if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('userSetName', newPlayerName, (ack) => {
            if (ack.success) {
              console.log("[App.tsx] 現有連接的玩家名稱已在伺服器設定。");
              socketRef.current!.emit('lobbyGetRooms'); // 在確認進入大廳後刷新房間列表
            } else {
              console.warn("[App.tsx] 現有連接的玩家名稱在伺服器設定失敗:", ack.message);
              alert(`設定玩家名稱失敗: ${ack.message}`);
            }
        });
    }
    // 如果未連接，useEffect 中的 onConnect 處理器將處理 userSetName 和 lobbyGetRooms
  }, []); // useCallback 的依賴項為空陣列，表示此函數的實例在組件生命週期中不會改變

  /** 
   * @description 處理創建房間的邏輯
   * @param {Omit<ClientRoomSettingsData, 'maxPlayers'>} settingsFromModal - 從創建房間彈窗獲取的設定 (不含 maxPlayers，因其固定)
   */
  const handleCreateRoom = useCallback(async (settingsFromModal: Omit<ClientRoomSettingsData, 'maxPlayers'>) => {
    if (!socketRef.current || !isConnected) {
      alert("未連接到伺服器，無法創建房間。");
      return;
    }
    setIsLoading(true); // 開始載入
    setLoadingMessage("正在創建房間...");
    
    // 將玩家名稱加入到房間創建數據中
    const roomCreationDataWithPlayerName = {
        ...settingsFromModal,
        playerName: playerName, // App 組件的 playerName 狀態
    };

    // 向伺服器發送 lobbyCreateRoom 事件
    socketRef.current.emit('lobbyCreateRoom', roomCreationDataWithPlayerName, (ack) => {
      setIsLoading(false); // 停止載入
      if (ack.success && ack.roomId) {
        console.log("[App.tsx] 房間創建成功 (來自伺服器):", ack.roomId, "使用設定:", settingsFromModal);
        setShowCreateRoomModal(false); // 關閉創建房間彈窗
        // 伺服器在創建成功後，會將創建者自動加入房間並發送 joinedRoom 事件
        // 客戶端無需在此處手動加入或切換視圖，等待 joinedRoom 事件即可
      } else {
        alert(`創建房間失敗: ${ack.message || '未知錯誤'}`);
      }
    });
  }, [isConnected, playerName]); // 依賴 isConnected 和 playerName

  /** 
   * @description 處理加入房間的邏輯
   * @param {RoomListData} roomToJoin - 要加入的房間的資訊
   */
  const handleJoinRoom = useCallback(async (roomToJoin: RoomListData) => {
    if (!socketRef.current || !isConnected) {
      alert("未連接到伺服器，無法加入房間。");
      return;
    }
    console.log("[App.tsx] 嘗試加入房間:", roomToJoin.name, roomToJoin.id, "，使用名稱:", playerName);
    // 如果房間有密碼保護
    if (roomToJoin.passwordProtected) {
      setAttemptingToJoinRoomDetails(roomToJoin); // 儲存嘗試加入的房間資訊
      setShowPasswordModal(true); // 顯示密碼輸入彈窗
    } else {
      // 如果房間沒有密碼
      setIsLoading(true); // 開始載入
      setLoadingMessage("正在加入房間...");
      // 向伺服器發送 lobbyJoinRoom 事件
      socketRef.current.emit('lobbyJoinRoom', { roomId: roomToJoin.id, playerName: playerName }, (ack) => {
        setIsLoading(false); // 停止載入
        if (ack.success) {
          console.log(`[App.tsx] 加入房間 ${roomToJoin.name} 請求已發送。等待伺服器回應...`);
          // 成功發送請求後，等待伺服器的 joinedRoom 事件來實際進入房間和遊戲視圖
        } else {
          alert(`加入房間失敗: ${ack.message || '無法加入房間'}`);
        }
      });
    }
  }, [isConnected, playerName]); // 依賴 isConnected 和 playerName

  /** 
   * @description 處理提交密碼以加入房間的邏輯
   * @param {string} enteredPassword - 使用者輸入的密碼
   */
  const handlePasswordSubmit = useCallback(async (enteredPassword: string) => {
    if (!socketRef.current || !isConnected || !attemptingToJoinRoomDetails) {
      alert("發生錯誤或未連接到伺服器。");
      setShowPasswordModal(false); // 關閉密碼彈窗
      setAttemptingToJoinRoomDetails(null); // 清除嘗試加入的房間資訊
      return;
    }
    setIsLoading(true); // 開始載入
    setLoadingMessage("正在驗證密碼並加入房間...");
    // 向伺服器發送 lobbyJoinRoom 事件，包含密碼
    socketRef.current.emit('lobbyJoinRoom', { 
        roomId: attemptingToJoinRoomDetails.id, 
        password: enteredPassword, 
        playerName: playerName // App 組件的 playerName 狀態
    }, (ack) => {
      setIsLoading(false); // 停止載入
      if (ack.success) {
        console.log(`[App.tsx] 加入加密房間 ${attemptingToJoinRoomDetails.name} 請求已發送。等待伺服器回應...`);
        setShowPasswordModal(false); // 關閉密碼彈窗         
        setAttemptingToJoinRoomDetails(null); // 清除嘗試加入的房間資訊
        // 成功發送請求後，等待伺服器的 joinedRoom 事件
      } else {
        alert(`加入房間失敗: ${ack.message || '密碼錯誤或房間無法加入'}`);
        // 密碼錯誤時，保持密碼彈窗開啟，讓用戶重試 (目前是直接關閉，可依需求調整)
      }
    });
  }, [isConnected, attemptingToJoinRoomDetails, playerName]); // 依賴 isConnected, attemptingToJoinRoomDetails 和 playerName

  /** 
   * @description 處理退出遊戲房間的核心邏輯
   */
  const handleQuitGameLogic = useCallback(() => {
    const previousRoomId = currentRoomId; // 記錄當前房間ID
    // 如果 socket 存在且在一個房間內
    if (socketRef.current && previousRoomId) {
        socketRef.current.emit('gameQuitRoom', previousRoomId); // 通知伺服器退出房間
    }
    setCurrentView('lobby'); // 切換回大廳視圖
    setCurrentRoomId(null); // 清除房間ID
    setCurrentGameState(null); // 清除遊戲狀態
    setClientPlayerId(null); // 清除客戶端玩家ID
    setIsLoading(false); // 停止載入
    // 返回大廳時，確保用戶已設定名稱並獲取房間列表
    if (socketRef.current && socketRef.current.connected) { 
        socketRef.current.emit('userSetName', playerName, (ack) => { // playerName 是 App 的狀態
            if (ack.success) {
                socketRef.current!.emit('lobbyGetRooms'); // 獲取大廳房間列表
            } else {
                console.warn("[App.tsx] 退出遊戲後在伺服器設定玩家名稱失敗:", ack.message);
            }
        });
    }
  }, [currentRoomId, playerName]); // 依賴 currentRoomId 和 playerName

  /** 
   * @description 處理退出遊戲房間的按鈕點擊事件 (帶有載入狀態)
   */
  const handleQuitGame = useCallback(() => {
    setIsLoading(true); // 開始載入
    setLoadingMessage("正在離開房間...");
    handleQuitGameLogic(); // 執行核心退出邏輯
  }, [handleQuitGameLogic]); // 依賴 handleQuitGameLogic

  /** 
   * @description 處理返回主頁的邏輯
   */
  const handleReturnToHome = useCallback(() => {
    // 如果 socket 已連接
    if (socketRef.current && isConnected) { 
        socketRef.current.emit('lobbyLeave'); // 通知伺服器離開大廳
        // Socket 連接的斷開將由主要的連接管理 useEffect 根據 currentView 改變來處理
    }
    setCurrentView('home');  // 切換回主頁視圖
    setCurrentRoomId(null); // 清除房間相關狀態
    setCurrentGameState(null);
    setClientPlayerId(null);
    setLobbyRooms([]); // 清空大廳房間列表
    // Socket 的斷開將由 view 切換到 'home' 時，主要的 socket 連接 useEffect 處理
  }, [isConnected]); // 依賴 isConnected

  /**
   * @description 渲染載入中的覆蓋層。
   * @returns {React.ReactNode | null} 若 isLoading 為 true，則渲染覆蓋層，否則返回 null。
   */
  const renderLoadingOverlay = () => {
    if (!isLoading) return null; // 如果不在載入中，則不渲染
    return (
      // 固定定位的覆蓋層，半透明黑色背景，置於最上層 (z-[100])
      <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[100]">
        {/* 顯示載入訊息，帶有脈搏動畫效果 */}
        <div className="text-white text-xl animate-pulse">{loadingMessage}</div>
      </div>
    );
  };

  // --- JSX 渲染 ---
  return (
    // 主容器：佔滿整個視窗，漸變背景色，文字白色，彈性佈局使內容居中
    <div className="w-full h-full bg-gradient-to-br from-slate-800 via-slate-900 to-black text-white flex flex-col items-center justify-center p-2 landscape-app relative overflow-hidden">
      {/* 渲染載入覆蓋層 */}
      {renderLoadingOverlay()}
      
      {/* 設定按鈕：僅在主頁或大廳視圖顯示 */}
      {(currentView === 'home' || currentView === 'lobby') && (
        <button
          onClick={() => setShowSettingsPanel(true)} // 點擊時顯示設定面板
          className="absolute top-4 right-4 z-50 p-2 bg-slate-700/70 hover:bg-slate-600 rounded-full text-white transition-colors"
          aria-label="開啟設定"
          title="設定" // 滑鼠懸停提示
        >
          <SettingsIcon className="w-6 h-6" /> {/* 設定圖示 */}
        </button>
      )}

      {/* 遊戲標題：不在主頁和遊戲中視圖顯示 (即僅在大廳顯示) */}
      {currentView !== 'home' && currentView !== 'game' && (
        <header className="absolute top-4 left-1/2 -translate-x-1/2 z-20 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-red-500 to-rose-600">
            象棋麻將激鬥
          </h1>
        </header>
      )}

      {/* 主要內容區域：根據 currentView 渲染不同組件 */}
      <div className="w-full h-full flex items-center justify-center">
        {/* 主頁視圖 */}
        {currentView === 'home' && (
          <HomePage onEnterLobby={handleEnterLobby} defaultPlayerName={playerName} />
        )}

        {/* 大廳視圖：需 socket 連接成功 */}
        {currentView === 'lobby' && socket && ( 
          <Lobby
            onCreateRoomClick={() => setShowCreateRoomModal(true)} // 點擊創建房間按鈕的處理函數
            onJoinRoomClick={handleJoinRoom} // 點擊加入房間按鈕的處理函數
            onReturnToHome={handleReturnToHome} // 返回主頁的處理函數
            currentPlayerName={playerName} // 當前玩家名稱
            lobbyRooms={lobbyRooms} // 大廳房間列表
            socket={socket} // Socket.IO 實例
          />
        )}

        {/* 遊戲視圖：需有房間ID、遊戲狀態、客戶端玩家ID和 socket 連接 */}
        {currentView === 'game' && currentRoomId && currentGameState && clientPlayerId !== null && socket && ( 
          <GameBoard
            // 房間設定，部分從 currentGameState 獲取，部分固定
            roomSettings={{ 
                id: currentRoomId,
                roomName: currentGameState.roomName, // 從遊戲狀態獲取房間名
                maxPlayers: NUM_PLAYERS, // 固定玩家數
                humanPlayers: currentGameState.configuredHumanPlayers, // 從遊戲狀態獲取配置的真人玩家數
                fillWithAI: currentGameState.configuredFillWithAI, // 從遊戲狀態獲取是否用AI填充
                playerName: currentGameState.hostPlayerName, // 從遊戲狀態獲取房主名稱
                numberOfRounds: currentGameState.numberOfRounds, // 從遊戲狀態獲取總局數
            }}
            initialGameState={currentGameState} // 初始遊戲狀態
            clientPlayerId={clientPlayerId} // 客戶端玩家ID
            onQuitGame={handleQuitGame} // 退出遊戲的處理函數
            toggleSettingsPanel={() => setShowSettingsPanel(s => !s)} // 切換設定面板的函數
            socket={socket} // Socket.IO 實例
          />
        )}
      </div>

      {/* 創建房間彈出視窗 */}
      {showCreateRoomModal && (
        <CreateRoomModal
          isOpen={showCreateRoomModal} // 是否開啟
          onClose={() => setShowCreateRoomModal(false)} // 關閉彈窗的處理函數
          onCreate={handleCreateRoom} // 創建房間的處理函數
        />
      )}

      {/* 輸入密碼彈出視窗 */}
      {showPasswordModal && attemptingToJoinRoomDetails && (
        <PasswordInputModal
          isOpen={showPasswordModal} // 是否開啟
          onClose={() => { // 關閉彈窗時重置相關狀態
            setShowPasswordModal(false);
            setAttemptingToJoinRoomDetails(null);
          }}
          onSubmit={handlePasswordSubmit} // 提交密碼的處理函數
          roomName={attemptingToJoinRoomDetails.name} // 房間名稱
        />
      )}
      
      {/* 設定面板 */}
      <SettingsPanel
        isOpen={showSettingsPanel} // 是否開啟
        onClose={() => setShowSettingsPanel(false)} // 關閉面板的處理函數
        isMusicPlaying={isMusicPlaying} // 背景音樂播放狀態
        onToggleMusicPlay={toggleMusicPlay} // 切換背景音樂播放狀態的函數
        musicVolume={musicVolume} // 背景音樂音量
        onVolumeChange={handleVolumeChange} // 改變背景音樂音量的函數
        isSoundEffectsEnabled={isSoundEffectsEnabled} // 遊戲音效啟用狀態
        onToggleSoundEffectsEnabled={toggleSoundEffectsEnabled} // 切換遊戲音效啟用狀態的函數
        soundEffectsVolume={soundEffectsVolume} // 遊戲音效音量
        onSoundEffectsVolumeChange={handleSoundEffectsVolumeChange} // 改變遊戲音效音量的函數
      />
      
      {/* 背景音樂播放器元素 */}
      <audio ref={audioRef} src="/audio/chinese-traditional-relaxed.mp3" loop preload="auto"></audio>

      {/* 頁腳：不在遊戲中視圖顯示 */}
      {currentView !== 'game' && (
         <footer className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 text-xs text-slate-400 text-center w-full px-4">
          <p>技巧與運氣的遊戲。請適度娛樂。</p>
           {/* 連接狀態提示：不在主頁顯示，且 Socket 未連接時顯示 */}
           {!isConnected && currentView !== 'home' && <p className="text-red-400 animate-pulse">與伺服器斷線或連接中...</p>}
        </footer>
      )}
    </div>
  );
};

export default App;
