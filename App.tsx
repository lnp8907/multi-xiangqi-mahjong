
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
import { RoomSettings, RoomListData, GameState, ChatMessage, ServerToClientEvents, ClientToServerEvents, GamePhase, ClientRoomSettingsData, Player, VoiceChatUser } from './types';
// 引入遊戲固定玩家數量
import { NUM_PLAYERS } from './constants';
// 引入音效管理相關的函數
import { setActionSoundVolume, getActionSoundVolume } from './utils/audioManager';
// 引入 WebRTC 管理器
import WebRTCManager from './utils/WebRTCManager';

// 定義應用程式可能有的視圖類型
type GameView = 'home' | 'lobby' | 'game'; // 'home': 主頁, 'lobby': 大廳, 'game': 遊戲中

// 安全地存取環境變數
// Vite 使用 import.meta.env 來存取環境變數
const env = (import.meta as any).env;
// Socket.IO 伺服器的 URL，優先從環境變數讀取，若無則使用本地開發預設值
// const SOCKET_SERVER_URL = env?.VITE_SOCKET_SERVER_URL || 'http://localhost:3001';
const SOCKET_SERVER_URL = ""

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
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // --- 狀態管理 (useState) ---
  const [currentView, setCurrentView] = useState<GameView>('home');
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [clientPlayerId, setClientPlayerId] = useState<number | null>(null);
  const [currentGameState, setCurrentGameState] = useState<GameState | null>(null);
  const [playerName, setPlayerName] = useState<string>(localStorage.getItem('xiangqiMahjongPlayerName') || "玩家");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [attemptingToJoinRoomDetails, setAttemptingToJoinRoomDetails] = useState<RoomListData | null>(null);

  // --- 背景音樂相關狀態 ---
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.5);
  const audioRef = useRef<HTMLAudioElement>(null);

  // --- 遊戲音效相關狀態 ---
  const [isSoundEffectsEnabled, setIsSoundEffectsEnabled] = useState(true);
  const [soundEffectsVolume, setSoundEffectsVolume] = useState(getActionSoundVolume());

  // --- 其他狀態 ---
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>("處理中，請稍候...");
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [lobbyRooms, setLobbyRooms] = useState<RoomListData[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // --- WebRTC 相關狀態 ---
  const webRTCManagerRef = useRef<WebRTCManager | null>(null);
  const [localAudioStream, setLocalAudioStream] = useState<MediaStream | null>(null);
  const remoteAudioStreamsRef = useRef<Record<string, MediaStream>>({});
  const [isMicrophoneMuted, setIsMicrophoneMuted] = useState<boolean>(false);
  const [isVoiceChatSupported, setIsVoiceChatSupported] = useState<boolean>(true);
  const [playerSpeakingStates, setPlayerSpeakingStates] = useState<Record<string, boolean>>({}); // socketId -> isSpeaking
  const [playerMutedStates, setPlayerMutedStates] = useState<Record<string, boolean>>({});    // socketId -> isMuted
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});

  // --- 通知管理函數 ---
  const addNotification = useCallback((message: string, type: NotificationType, duration?: number) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2,9);
    setNotifications(prevNotifications => [...prevNotifications, { id, message, type, duration }]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prevNotifications => prevNotifications.filter(n => n.id !== id));
  }, []);

  // --- WebRTC 初始化與清理 ---
  const initializeWebRTC = useCallback(async (roomId: string) => {
    if (!socketRef.current) {
        addNotification("Socket 未連接，無法初始化語音聊天。", "error");
        return;
    }
    if (webRTCManagerRef.current) {
        console.log("[App.tsx] WebRTC Manager 已經初始化。");
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        setLocalAudioStream(stream);
        setIsVoiceChatSupported(true); // 確認支援麥克風

        const manager = new WebRTCManager(socketRef.current, stream, roomId, clientPlayerId || -1, addNotification);
        webRTCManagerRef.current = manager;

        manager.onRemoteStreamAdded = (socketId, remoteStream) => {
            console.log(`[App.tsx] 收到來自 ${socketId} 的遠端音訊流。`);
            remoteAudioStreamsRef.current = { ...remoteAudioStreamsRef.current, [socketId]: remoteStream };
            if (!audioElementsRef.current[socketId]) {
                const audioElement = new Audio();
                audioElement.srcObject = remoteStream;
                audioElement.autoplay = true;
                audioElementsRef.current[socketId] = audioElement;
                document.body.appendChild(audioElement);
                console.log(`[App.tsx] 為 ${socketId} 創建並播放 Audio 元素。`);
            } else {
                 audioElementsRef.current[socketId].srcObject = remoteStream;
                 console.log(`[App.tsx] 為 ${socketId} 更新 Audio 元素。`);
            }
        };
        manager.onRemoteStreamRemoved = (socketId) => {
            console.log(`[App.tsx] 來自 ${socketId} 的遠端音訊流已移除。`);
            const newRemoteStreams = { ...remoteAudioStreamsRef.current };
            delete newRemoteStreams[socketId];
            remoteAudioStreamsRef.current = newRemoteStreams;
            if (audioElementsRef.current[socketId]) {
                audioElementsRef.current[socketId].remove();
                delete audioElementsRef.current[socketId];
                console.log(`[App.tsx] 已移除 ${socketId} 的 Audio 元素。`);
            }
        };
        manager.onPlayerSpeaking = (socketId, speaking) => {
            setPlayerSpeakingStates(prev => ({ ...prev, [socketId]: speaking }));
        };
        manager.onPlayerMuted = (socketId, muted) => {
            setPlayerMutedStates(prev => ({ ...prev, [socketId]: muted }));
        };

        socketRef.current.emit('voiceChatJoinRoom', { roomId });
        console.log(`[App.tsx] WebRTC 初始化完成，已加入房間 ${roomId} 的語音聊天。`);
        if (isMicrophoneMuted) { // 如果進入時是靜音狀態，則主動靜音流
            webRTCManagerRef.current.toggleMute(true);
        }

    } catch (error) {
        console.error("[App.tsx] 獲取麥克風權限失敗:", error);
        addNotification("無法獲取麥克風權限，語音聊天功能將不可用。", "warning");
        setIsVoiceChatSupported(false);
        setLocalAudioStream(null);
    }
  }, [clientPlayerId, addNotification, isMicrophoneMuted]);

  const cleanupWebRTC = useCallback(() => {
    if (webRTCManagerRef.current) {
      webRTCManagerRef.current.closeAllConnections();
      webRTCManagerRef.current = null;
      console.log("[App.tsx] WebRTC Manager 已清理。");
    }
    if (localAudioStream) {
      localAudioStream.getTracks().forEach(track => track.stop());
      setLocalAudioStream(null);
      console.log("[App.tsx] 本地音訊流已釋放。");
    }
    Object.values(audioElementsRef.current).forEach(audioElement => audioElement.remove());
    audioElementsRef.current = {};
    remoteAudioStreamsRef.current = {};
    setPlayerMutedStates({});
    setPlayerSpeakingStates({});
  }, [localAudioStream]);


  // --- Socket.IO 連接管理 ---
  useEffect(() => {
    if (playerName && currentView !== 'home') {
      if (!socketRef.current) {
        console.log(`[App.tsx] 嘗試連接到 Socket.IO 伺服器: ${SOCKET_SERVER_URL}，玩家名稱: ${playerName}`);
        const newSocketInstance = io({
          query: { playerName },
          reconnectionAttempts: 3,
        });
        socketRef.current = newSocketInstance;
        setSocket(newSocketInstance);
      }
    } else {
      if (socketRef.current) {
        console.log('[App.tsx] 因視圖為 home 或 playerName 未設定，斷開 socket 連接。');
        cleanupWebRTC(); // 斷開 socket 時清理 WebRTC
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setIsConnected(false);
      }
    }
    return () => {
      if (socketRef.current && (currentView === 'home' || !playerName)) {
        console.log('[App.tsx] 從主要連接 effect 清理 socket 連接。');
        cleanupWebRTC(); // 清理 WebRTC
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setIsConnected(false);
      }
    };
  }, [playerName, currentView, cleanupWebRTC]);


  // --- Socket.IO 事件處理器 ---
  useEffect(() => {
    if (!socket) {
      setIsConnected(false);
      return;
    }

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
      cleanupWebRTC(); // Socket 斷線時清理 WebRTC
      addNotification('與伺服器斷線，請檢查網路連線或重新整理頁面。', 'error');
    };

    const onConnectError = (err: Error) => {
      console.error('[App.tsx] Socket.IO 連接錯誤:', err.message);
      setIsLoading(false);
      addNotification(`無法連接到遊戲伺服器: ${err.message}。請稍後再試。`, 'error');
    };

    const onLobbyRoomList = (rooms: RoomListData[]) => {
      setLobbyRooms(rooms);
    };

    const onJoinedRoom = (data: { gameState: GameState; roomId: string; clientPlayerId: number }) => {
      console.log('[App.tsx] 成功加入房間，收到數據:', data);
      setCurrentRoomId(data.roomId);
      setClientPlayerId(data.clientPlayerId);
      setCurrentGameState(data.gameState);
      setCurrentView('game');
      setIsLoading(false);
      initializeWebRTC(data.roomId); // 加入房間後初始化 WebRTC
    };

    const onGameStateUpdate = (updatedGameState: GameState) => {
        setCurrentGameState(prevGameState => {
            if (!prevGameState) return updatedGameState;

            const updatedPlayers = updatedGameState.players.map(player => {
                const playerSocketId = player.socketId || player.id.toString(); // 備用 ID
                const speaking = playerSpeakingStates[playerSocketId] || false;
                const muted = (player.id === clientPlayerId)
                              ? isMicrophoneMuted
                              : (playerMutedStates[playerSocketId] || false);
                return { ...player, isSpeaking: speaking, isMuted: muted };
            });
            return { ...updatedGameState, players: updatedPlayers };
        });
    };


    const onGamePlayerLeft = (data: { playerId: number; newHostId?: number; message?: string }) => {
      if(data.message) addNotification(data.message, 'info');
      // WebRTCManager 會透過 voiceChatUserLeft 間接處理
    };

    const onGameError = (message: string) => {
      if (currentRoomId === null && message === '房間已被解散。') {
        setIsLoading(false);
        return;
      }
      addNotification(`遊戲錯誤: ${message}`, 'error');
      setIsLoading(false);
    };

    const onLobbyError = (message: string) => {
      addNotification(`大廳錯誤: ${message}`, 'error');
      setIsLoading(false);
    };

    // --- WebRTC Socket 事件處理 ---
    const handleVoiceSignal = (data: { fromSocketId: string; signal: any }) => {
        webRTCManagerRef.current?.handleIncomingSignal(data.fromSocketId, data.signal);
    };
    const handleVoiceChatUserList = (data: { users: VoiceChatUser[] }) => {
        webRTCManagerRef.current?.connectToExistingPeers(data.users);
        const initialMutedStates: Record<string, boolean> = {};
        data.users.forEach(user => {
            initialMutedStates[user.socketId] = user.isMuted;
        });
        setPlayerMutedStates(prev => ({ ...prev, ...initialMutedStates }));
    };
    const handleVoiceChatUserJoined = (userData: VoiceChatUser) => {
        webRTCManagerRef.current?.connectToNewPeer(userData.socketId, userData.playerName, userData.playerId, userData.isMuted);
        setPlayerMutedStates(prev => ({...prev, [userData.socketId]: userData.isMuted}));
    };
    const handleVoiceChatUserLeft = (data: { socketId: string }) => {
        webRTCManagerRef.current?.handlePeerDisconnect(data.socketId);
        setPlayerSpeakingStates(prev => { const s = {...prev}; delete s[data.socketId]; return s; });
        setPlayerMutedStates(prev => { const s = {...prev}; delete s[data.socketId]; return s; });
    };
     const handleVoiceChatUserMuted = (data: { socketId: string; muted: boolean }) => {
        setPlayerMutedStates(prev => ({...prev, [data.socketId]: data.muted}));
    };
     const handleVoiceChatUserSpeaking = (data: { socketId: string; speaking: boolean }) => {
        setPlayerSpeakingStates(prev => ({...prev, [data.socketId]: data.speaking}));
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

    // WebRTC events
    socket.on('voiceSignal', handleVoiceSignal);
    socket.on('voiceChatUserList', handleVoiceChatUserList);
    socket.on('voiceChatUserJoined', handleVoiceChatUserJoined);
    socket.on('voiceChatUserLeft', handleVoiceChatUserLeft);
    socket.on('voiceChatUserMuted', handleVoiceChatUserMuted);
    socket.on('voiceChatUserSpeaking', handleVoiceChatUserSpeaking);


    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('lobbyRoomList', onLobbyRoomList);
      socket.off('joinedRoom', onJoinedRoom);
      socket.off('gameStateUpdate', onGameStateUpdate);
      socket.off('gamePlayerLeft', onGamePlayerLeft);
      socket.off('gameError', onGameError);
      socket.off('lobbyError', onLobbyError);

      // WebRTC events
      socket.off('voiceSignal', handleVoiceSignal);
      socket.off('voiceChatUserList', handleVoiceChatUserList);
      socket.off('voiceChatUserJoined', handleVoiceChatUserJoined);
      socket.off('voiceChatUserLeft', handleVoiceChatUserLeft);
      socket.off('voiceChatUserMuted', handleVoiceChatUserMuted);
      socket.off('voiceChatUserSpeaking', handleVoiceChatUserSpeaking);
    };
  }, [socket, currentView, clientPlayerId, playerName, currentRoomId, addNotification, initializeWebRTC, cleanupWebRTC, isMicrophoneMuted]);


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

    useEffect(() => {
        if (currentGameState) {
            setCurrentGameState(prevGameState => {
                if (!prevGameState) return null;
                const updatedPlayers = prevGameState.players.map(player => {
                    const playerSocketId = player.socketId || player.id.toString();
                    const speaking = playerSpeakingStates[playerSocketId] ?? player.isSpeaking ?? false;
                    const muted = (player.id === clientPlayerId)
                                  ? isMicrophoneMuted
                                  : (playerMutedStates[playerSocketId] ?? player.isMuted ?? false);
                    if (player.isSpeaking !== speaking || player.isMuted !== muted) {
                        return { ...player, isSpeaking: speaking, isMuted: muted };
                    }
                    return player;
                });
                // 只有在 players 實際發生變化時才更新 state，避免不必要的重渲染
                if (JSON.stringify(prevGameState.players) !== JSON.stringify(updatedPlayers)) {
                    return { ...prevGameState, players: updatedPlayers };
                }
                return prevGameState;
            });
        }
    }, [playerSpeakingStates, playerMutedStates, clientPlayerId, isMicrophoneMuted, currentGameState?.players.length]); // 確保依賴 gameState.players.length


  // --- 事件處理函數 ---
  const toggleMusicPlay = () => setIsMusicPlaying(!isMusicPlaying);
  const handleVolumeChange = (newVolume: number) => setMusicVolume(newVolume);

  const toggleSoundEffectsEnabled = () => setIsSoundEffectsEnabled(prev => !prev);
  const handleSoundEffectsVolumeChange = (newVolume: number) => setSoundEffectsVolume(newVolume);

  const handleToggleMute = useCallback(() => {
    if (webRTCManagerRef.current && localAudioStream) {
        const newMutedState = !isMicrophoneMuted;
        webRTCManagerRef.current.toggleMute(newMutedState);
        setIsMicrophoneMuted(newMutedState);
        if (socketRef.current) {
            socketRef.current.emit('voiceChatToggleMute', { muted: newMutedState });
        }
    } else {
        addNotification(localAudioStream ? "語音聊天尚未完全連接。" : "麥克風未啟用或未授權。", "warning");
    }
  }, [isMicrophoneMuted, localAudioStream, addNotification]);


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
    cleanupWebRTC(); // 退出遊戲時清理 WebRTC
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
  }, [currentRoomId, playerName, addNotification, cleanupWebRTC]);


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
            isMicrophoneMuted={isMicrophoneMuted}
            onToggleMute={handleToggleMute}
            isVoiceChatSupported={isVoiceChatSupported}
            localAudioStream={localAudioStream}
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
      <audio ref={audioRef} src="/audio/bgm_lobby_calm.mp3" loop />

      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-gray-900 text-slate-100">
        {renderView()}
      </div>

      {showCreateRoomModal && (
        <CreateRoomModal
          isOpen={showCreateRoomModal}
          onClose={() => setShowCreateRoomModal(false)}
          onCreate={handleCreateRoom}
          addNotification={addNotification}
        />
      )}
      {showPasswordModal && attemptingToJoinRoomDetails && (
        <PasswordInputModal
          isOpen={showPasswordModal}
          onClose={() => { setShowPasswordModal(false); setAttemptingToJoinRoomDetails(null); }}
          onSubmit={handlePasswordSubmit}
          roomName={attemptingToJoinRoomDetails.name}
        />
      )}
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
      {isLoading && (
        <div className="fixed inset-0 bg-black/60 flex flex-col items-center justify-center z-[100]">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-sky-400 mb-4"></div>
          <p className="text-lg text-slate-200">{loadingMessage}</p>
        </div>
      )}
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
