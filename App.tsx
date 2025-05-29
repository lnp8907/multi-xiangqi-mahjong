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
import { SettingsPanel } from './components/SettingsPanel'; // 設定面板組件
import SettingsIcon from './components/icons/SettingsIcon'; // 設定圖示組件
import NotificationToast, { NotificationType } from './components/NotificationToast'; // 引入新的通知組件和類型
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

// 定義通知物件的結構
interface AppNotification {
  id: string;
  message: string;
  type: NotificationType;
  duration?: number;
}

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
  /** @description 通知列表狀態 */
  const [notifications, setNotifications] = useState<AppNotification[]>([]);


  // --- 通知管理函數 ---
  /**
   * @description 新增一個通知到列表。
   * @param {string} message - 通知的訊息內容。
   * @param {NotificationType} type - 通知的類型 (success, error, warning, info)。
   * @param {number} [duration] - 通知顯示的持續時間 (毫秒)，可選。
   */
  const addNotification = useCallback((message: string, type: NotificationType, duration?: number) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2,9); // 產生唯一ID
    setNotifications(prevNotifications => [...prevNotifications, { id, message, type, duration }]);
  }, []);

  /**
   * @description 從列表中移除一個通知。
   * @param {string} id - 要移除的通知的 ID。
   */
  const removeNotification = useCallback((id: string) => {
    setNotifications(prevNotifications => prevNotifications.filter(n => n.id !== id));
  }, []);


  // --- Socket.IO 連接管理 ---
  useEffect(() => {
    if (playerName && currentView !== 'home') {
      if (!socketRef.current) { 
        console.log(`[App.tsx] 嘗試連接到 Socket.IO 伺服器: ${SOCKET_SERVER_URL}，玩家名稱: ${playerName}`);
        const newSocketInstance = io(SOCKET_SERVER_URL, {
          query: { playerName }, 
          reconnectionAttempts: 3, 
        });
        socketRef.current = newSocketInstance; 
        setSocket(newSocketInstance); 
      } else if (socketRef.current.connected) {
        // 已連接時的處理邏輯 (如果需要)
      }
    } else {
      if (socketRef.current) {
        console.log('[App.tsx] 因視圖為 home 或 playerName 未設定，斷開 socket 連接。');
        socketRef.current.disconnect();
        socketRef.current = null; 
        setSocket(null); 
        setIsConnected(false); 
      }
    }
    return () => {
      if (socketRef.current && (currentView === 'home' || !playerName)) {
        console.log('[App.tsx] 從主要連接 effect 清理 socket 連接。');
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setIsConnected(false);
      }
    };
  }, [playerName, currentView]); 


  // --- Socket.IO 事件處理器 ---
  useEffect(() => {
    if (!socket) { 
      setIsConnected(false); 
      return; 
    }

    // console.log(`[App.tsx] 為 socket (ID: ${socket.id}) 附加事件監聽器。`);

    const onConnect = () => {
      console.log('[App.tsx] Socket.IO 連接成功，ID:', socket.id);
      setIsConnected(true);
      setIsLoading(false);
      if (currentView === 'lobby') { 
        socket.emit('userSetName', playerName, (ack) => { 
          if (ack.success) {
            console.log(`[App.tsx] 玩家名稱 '${playerName}' 已在伺服器設定，並已加入 'lobby' 群組。`);
            socket.emit('lobbyGetRooms'); 
          } else {
            console.warn(`[App.tsx] 連接後在伺服器設定玩家名稱失敗: ${ack.message}`);
            addNotification(`設定玩家名稱失敗: ${ack.message}`, 'error');
          }
        });
      }
    };

    const onDisconnect = (reason: string) => {
      console.warn('[App.tsx] Socket.IO 連接斷開:', reason);
      setIsConnected(false);
      setIsLoading(false);
      addNotification('與伺服器斷線，請檢查網路連線或重新整理頁面。', 'error');
    };

    const onConnectError = (err: Error) => {
      console.error('[App.tsx] Socket.IO 連接錯誤:', err.message);
      setIsLoading(false);
      addNotification(`無法連接到遊戲伺服器: ${err.message}。請稍後再試。`, 'error');
    };
    
    const onLobbyRoomList = (rooms: RoomListData[]) => {
      console.log(`[App.tsx] 客戶端 ${socket?.id} 收到 lobbyRoomList。目前視圖: ${currentView}。房間:`, rooms);
      setLobbyRooms(rooms); 
    };

    const onJoinedRoom = (data: { gameState: GameState; roomId: string; clientPlayerId: number }) => {
      console.log('[App.tsx] 成功加入房間，收到數據:', data);
      setCurrentRoomId(data.roomId); 
      setClientPlayerId(data.clientPlayerId); 
      setCurrentGameState(data.gameState); 
      setCurrentView('game'); 
      setIsLoading(false); 
    };
    
    const onGameStateUpdate = (updatedGameState: GameState) => {
      setCurrentGameState(updatedGameState); 
    };

    const onGamePlayerLeft = (data: { playerId: number; newHostId?: number; message?: string }) => {
      console.log('[App.tsx] 玩家離開遊戲 (透過 gamePlayerLeft 事件):', data);
      if(data.message) addNotification(data.message, 'info');
    };
    
    const onGameError = (message: string) => {
      if (currentRoomId === null && message === '房間已被解散。') {
        console.log('[App.tsx] 收到 "房間已解散" 錯誤，但已離開房間視圖，忽略此訊息。');
        setIsLoading(false); 
        return; 
      }
      console.error('[App.tsx] 來自伺服器的遊戲錯誤:', message);
      addNotification(`遊戲錯誤: ${message}`, 'error');
      setIsLoading(false); 
    };

    const onLobbyError = (message: string) => {
      console.error('[App.tsx] 來自伺服器的大廳錯誤:', message);
      addNotification(`大廳錯誤: ${message}`, 'error');
      setIsLoading(false); 
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('lobbyRoomList', onLobbyRoomList);
    socket.on('joinedRoom', onJoinedRoom);
    socket.on('gameStateUpdate', onGameStateUpdate);
    socket.on('gamePlayerLeft', onGamePlayerLeft);
    socket.on('gameError', onGameError);
    socket.on('lobbyError', onLobbyError);

    return () => {
      // console.log(`[App.tsx] 從 socket (ID: ${socket.id}) 移除事件監聽器。`);
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
  }, [socket, currentView, clientPlayerId, currentGameState, playerName, currentRoomId, addNotification]); 


  // --- 副作用處理 (useEffect) ---
  useEffect(() => {
    if (audioRef.current) { 
      audioRef.current.volume = musicVolume; 
      if (isMusicPlaying) {
        audioRef.current.play().catch(error => console.warn("[App.tsx] 背景音樂自動播放失敗:", error)); 
      } else {
        audioRef.current.pause(); 
      }
    }
  }, [isMusicPlaying, musicVolume]); 

  useEffect(() => {
    setActionSoundVolume(isSoundEffectsEnabled ? soundEffectsVolume : 0); 
  }, [isSoundEffectsEnabled, soundEffectsVolume]); 

  // --- 事件處理函數 ---
  const toggleMusicPlay = () => setIsMusicPlaying(!isMusicPlaying);
  const handleVolumeChange = (newVolume: number) => setMusicVolume(newVolume);

  const toggleSoundEffectsEnabled = () => setIsSoundEffectsEnabled(prev => !prev);
  const handleSoundEffectsVolumeChange = (newVolume: number) => setSoundEffectsVolume(newVolume);

  const handleEnterLobby = useCallback((name: string) => {
    const newPlayerName = name.trim() || "玩家"; 
    setPlayerName(newPlayerName); 
    localStorage.setItem('xiangqiMahjongPlayerName', newPlayerName); 
    setCurrentView('lobby'); 
    if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('userSetName', newPlayerName, (ack) => {
            if (ack.success) {
              console.log("[App.tsx] 現有連接的玩家名稱已在伺服器設定。");
              socketRef.current!.emit('lobbyGetRooms'); 
            } else {
              console.warn("[App.tsx] 現有連接的玩家名稱在伺服器設定失敗:", ack.message);
              addNotification(`設定玩家名稱失敗: ${ack.message}`, 'error');
            }
        });
    }
  }, [addNotification]); 

  const handleCreateRoom = useCallback(async (settingsFromModal: Omit<ClientRoomSettingsData, 'maxPlayers'>) => {
    if (!socketRef.current || !isConnected) {
      addNotification("未連接到伺服器，無法創建房間。", "error");
      return;
    }
    setIsLoading(true); 
    setLoadingMessage("正在創建房間...");
    
    const roomCreationDataWithPlayerName = {
        ...settingsFromModal,
        playerName: playerName, 
    };

    socketRef.current.emit('lobbyCreateRoom', roomCreationDataWithPlayerName, (ack) => {
      setIsLoading(false); 
      if (ack.success && ack.roomId) {
        console.log("[App.tsx] 房間創建成功 (來自伺服器):", ack.roomId, "使用設定:", settingsFromModal);
        setShowCreateRoomModal(false); 
        addNotification("房間創建成功！正在加入...", "success", 2000);
      } else {
        addNotification(`創建房間失敗: ${ack.message || '未知錯誤'}`, 'error');
      }
    });
  }, [isConnected, playerName, addNotification]); 

  const handleJoinRoom = useCallback(async (roomToJoin: RoomListData) => {
    if (!socketRef.current || !isConnected) {
      addNotification("未連接到伺服器，無法加入房間。", "error");
      return;
    }
    console.log("[App.tsx] 嘗試加入房間:", roomToJoin.name, roomToJoin.id, "，使用名稱:", playerName);
    if (roomToJoin.passwordProtected) {
      setAttemptingToJoinRoomDetails(roomToJoin); 
      setShowPasswordModal(true); 
    } else {
      setIsLoading(true); 
      setLoadingMessage(`正在加入房間: ${roomToJoin.name}...`);
      socketRef.current.emit('lobbyJoinRoom', { roomId: roomToJoin.id, playerName: playerName }, (ack) => { 
        setIsLoading(false); 
        if (!ack.success) {
          addNotification(`加入房間失敗: ${ack.message || '未知錯誤'}`, 'error');
        }
      });
    }
  }, [isConnected, playerName, addNotification]); 

  const handlePasswordSubmit = useCallback((password: string) => {
    if (!socketRef.current || !isConnected || !attemptingToJoinRoomDetails) {
      addNotification("無法提交密碼：連接或房間資訊遺失。", "error");
      return;
    }
    setIsLoading(true); 
    setLoadingMessage(`正在使用密碼加入房間: ${attemptingToJoinRoomDetails.name}...`);
    setShowPasswordModal(false); 
    socketRef.current.emit('lobbyJoinRoom', {
      roomId: attemptingToJoinRoomDetails.id,
      password: password,
      playerName: playerName
    }, (ack) => {
      setIsLoading(false); 
      if (ack.success) {
        // joinedRoom 事件會處理後續
      } else {
        addNotification(`加入房間失敗: ${ack.message || '密碼錯誤或未知問題'}`, 'error');
        setAttemptingToJoinRoomDetails(null); 
      }
    });
  }, [isConnected, attemptingToJoinRoomDetails, playerName, addNotification]);

  const handleQuitGame = useCallback(() => {
    if (socketRef.current && currentRoomId) {
      socketRef.current.emit('gameQuitRoom', currentRoomId); 
      console.log(`[App.tsx] 玩家 ${playerName} 請求退出房間 ${currentRoomId}。`);
    }
    setCurrentRoomId(null);
    setCurrentGameState(null);
    setClientPlayerId(null);
    setCurrentView('lobby'); 
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('userSetName', playerName, (ack) => { 
          if (ack.success) {
            console.log(`[App.tsx] 玩家名稱 '${playerName}' 重新設定，並重新加入 'lobby'。`);
            socketRef.current!.emit('lobbyGetRooms'); 
          } else {
            console.warn(`[App.tsx] 返回大廳後設定玩家名稱失敗: ${ack.message}`);
          }
      });
    }
    addNotification("已離開遊戲房間。", "info");
  }, [socketRef, currentRoomId, playerName, addNotification]); 


  // --- 渲染邏輯 ---
  const renderView = () => {
    switch (currentView) {
      case 'home':
        return <HomePage onEnterLobby={handleEnterLobby} defaultPlayerName={playerName} />;
      case 'lobby':
        return socket && isConnected ? (
          <Lobby
            onCreateRoomClick={() => setShowCreateRoomModal(true)}
            onJoinRoomClick={handleJoinRoom}
            onReturnToHome={() => {
              if (socketRef.current) socketRef.current.emit('lobbyLeave');
              setCurrentView('home');
            }}
            currentPlayerName={playerName}
            lobbyRooms={lobbyRooms}
            socket={socket}
          />
        ) : (
          <div className="text-center p-8">
            <h2 className="text-2xl text-slate-300 mb-4">正在連接到大廳...</h2>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400 mx-auto"></div>
            {!isConnected && <p className="text-sm text-amber-400 mt-4">提示：如果長時間無法連接，請檢查您的網路或稍後再試。</p>}
          </div>
        );
      case 'game':
        return currentGameState && socket && clientPlayerId !== null ? (
          <GameBoard
            roomSettings={{
              id: currentGameState.roomId!,
              roomName: currentGameState.roomName,
              maxPlayers: NUM_PLAYERS,
              humanPlayers: currentGameState.configuredHumanPlayers,
              fillWithAI: currentGameState.configuredFillWithAI,
              hostName: currentGameState.hostPlayerName,
              numberOfRounds: currentGameState.numberOfRounds,
            }}
            initialGameState={currentGameState}
            clientPlayerId={clientPlayerId}
            onQuitGame={handleQuitGame}
            toggleSettingsPanel={() => setShowSettingsPanel(prev => !prev)}
            socket={socket}
            addNotification={addNotification}
            // setShowFinalReviewModal prop 已移除
          />
        ) : (
          <div className="text-center p-8">
            <h2 className="text-2xl text-slate-300 mb-4">正在載入遊戲...</h2>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400 mx-auto"></div>
          </div>
        );
      default:
        return <HomePage onEnterLobby={handleEnterLobby} defaultPlayerName={playerName} />;
    }
  };

  // --- 主 JSX 結構 ---
  return (
    <>
      {/* 背景音樂播放器 */}
      <audio ref={audioRef} src="/audio/bgm_lobby_calm.mp3" loop />
      
      {/* 應用程式主內容 */}
      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-gray-900 text-slate-100">
        {renderView()}
      </div>

      {/* 創建房間彈出視窗 */}
      {showCreateRoomModal && (
        <CreateRoomModal
          isOpen={showCreateRoomModal}
          onClose={() => setShowCreateRoomModal(false)}
          onCreate={handleCreateRoom}
          addNotification={addNotification}
        />
      )}
      {/* 輸入密碼彈出視窗 */}
      {showPasswordModal && attemptingToJoinRoomDetails && (
        <PasswordInputModal
          isOpen={showPasswordModal}
          onClose={() => { setShowPasswordModal(false); setAttemptingToJoinRoomDetails(null); }}
          onSubmit={handlePasswordSubmit}
          roomName={attemptingToJoinRoomDetails.name}
        />
      )}
      {/* 設定面板 */}
      <SettingsPanel
        isOpen={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
        isMusicPlaying={isMusicPlaying}
        onToggleMusicPlay={toggleMusicPlay}
        musicVolume={musicVolume}
        onVolumeChange={handleVolumeChange}
        isSoundEffectsEnabled={isSoundEffectsEnabled}
        onToggleSoundEffectsEnabled={toggleSoundEffectsEnabled}
        soundEffectsVolume={soundEffectsVolume}
        onSoundEffectsVolumeChange={handleSoundEffectsVolumeChange}
      />
      {/* 載入中遮罩 */}
      {isLoading && (
        <div className="fixed inset-0 bg-black/60 flex flex-col items-center justify-center z-[100]">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-sky-400 mb-4"></div>
          <p className="text-lg text-slate-200">{loadingMessage}</p>
        </div>
      )}
      {/* 通知列表容器 */}
      <div className="fixed top-4 right-4 z-[90] w-full max-w-sm space-y-2">
        {notifications.map((n) => (
          <NotificationToast
            key={n.id}
            id={n.id}
            message={n.message}
            type={n.type}
            duration={n.duration}
            onDismiss={removeNotification}
          />
        ))}
      </div>
    </>
  );
};

export default App;