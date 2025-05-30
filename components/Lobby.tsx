
import React, { useState, useEffect } from 'react';
import ActionButton from './ActionButton'; // 引入動作按鈕組件
import LockIcon from './icons/LockIcon';   // 引入鎖圖示組件
import MicrophoneOnIcon from './icons/MicrophoneOnIcon'; // 引入麥克風開啟圖示
import MicrophoneOffIcon from './icons/MicrophoneOffIcon'; // 引入麥克風關閉圖示
import SettingsIcon from './icons/SettingsIcon'; // *** 新增：引入設定圖示 ***
import LobbyLeaderboard from './LobbyLeaderboard'; // 新增排行榜組件
import LobbyChatPanel from './LobbyChatPanel';   // 新增聊天面板組件
import { RoomListData, ChatMessage, ServerToClientEvents, ClientToServerEvents } from '../types'; // 引入類型定義
import type { Socket } from 'socket.io-client'; // 引入 Socket.IO 客戶端類型

/**
 * @description Lobby 組件的 props 類型定義
 */
interface LobbyProps {
  /** @param {() => void} onCreateRoomClick - 點擊「創建新房間」按鈕時觸發的回調函數。 */
  onCreateRoomClick: () => void;
  /** @param {(room: RoomListData) => void} onJoinRoomClick - 點擊「加入房間」按鈕時觸發的回調函數，參數為要加入的房間資訊。 */
  onJoinRoomClick: (room: RoomListData) => void;
  /** @param {() => void} onReturnToHome - 點擊「返回主頁」按鈕時觸發的回調函數。 */
  onReturnToHome: () => void;
  /** @param {string} currentPlayerName - 當前玩家的名稱。 */
  currentPlayerName: string; 
  /** @param {RoomListData[]} lobbyRooms - 從伺服器獲取的大廳房間列表。 */
  lobbyRooms: RoomListData[];
  /** @param {Socket<ServerToClientEvents, ClientToServerEvents>} socket - Socket.IO 連接實例。 */
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  /** @param {() => void} onToggleSettingsPanel - *** 新增：切換設定面板顯示的回調函數。 *** */
  onToggleSettingsPanel: () => void;
}

/**
 * @description Lobby 組件，用於顯示遊戲大廳界面，包括房間列表、創建/加入房間按鈕、排行榜和聊天功能。
 * @param {LobbyProps} props - 組件的屬性。
 * @returns {React.FC} React 函數組件。
 */
const Lobby: React.FC<LobbyProps> = ({ 
    onCreateRoomClick, 
    onJoinRoomClick, 
    onReturnToHome, 
    currentPlayerName,
    lobbyRooms, // 房間列表現在由 App.tsx 透過 props 傳入
    socket,
    onToggleSettingsPanel // *** 新增：解構 onToggleSettingsPanel prop ***
}) => {
  // isLoadingRooms 狀態用於可能的初始加載提示，但房間列表主要依賴 props
  const [isLoadingRooms, setIsLoadingRooms] = useState(false); 
  // 大廳聊天訊息列表狀態
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  // --- 副作用 (useEffect) ---
  // 監聽來自伺服器的大廳聊天訊息，並在組件卸載時移除監聽器
  useEffect(() => {
    /**
     * @description 處理從伺服器收到的大廳聊天訊息。
     * @param {ChatMessage} message - 收到的聊天訊息。
     */
    const handleLobbyChatMessage = (message: ChatMessage) => {
      setChatMessages(prev => [...prev, message]); // 將新訊息添加到聊天列表中
    };
    socket.on('lobbyChatMessage', handleLobbyChatMessage); // 監聽 'lobbyChatMessage' 事件
    
    // 初始時請求房間列表的邏輯已移至 App.tsx 的 onConnect 或 handleEnterLobby 中，此處可選。
    // socket.emit('lobbyGetRooms'); 

    // 模擬初始的系統訊息
    setChatMessages([
        { id: 'lobby-sys-1', senderName: '系統管理員', text: '歡迎來到象棋麻將大廳！請遵守遊戲禮儀。', timestamp: Date.now() - 20000, type: 'system' },
    ]);

    // 清理函數：組件卸載時移除監聽器
    return () => {
      socket.off('lobbyChatMessage', handleLobbyChatMessage);
    };
  }, [socket]); // 依賴 socket 實例

  /**
   * @description 處理發送大廳聊天訊息的邏輯。
   * @param {string} text - 要發送的訊息內容。
   */
  const handleSendLobbyMessage = (text: string) => {
    // 伺服器會將訊息廣播回來，所以客戶端無需進行樂觀更新 (或可選擇性地做)
    // const newMessage: ChatMessage = {
    //   id: `lobby-${Date.now()}-${Math.random()}`, // 臨時客戶端 ID
    //   senderName: currentPlayerName,
    //   text,
    //   timestamp: Date.now(),
    //   type: 'player',
    // };
    // setChatMessages(prev => [...prev, newMessage]); // 如果要樂觀更新則取消註解此行
    socket.emit('lobbySendChatMessage', text); // 向伺服器發送訊息
    console.log(`[大廳聊天發送] ${currentPlayerName}: ${text}`);
  };

  return (
    // 大廳主容器：彈性佈局，在中大螢幕上為橫向排列，小螢幕為縱向
    <div className="w-full h-full flex flex-col md:flex-row p-4 gap-4 max-w-6xl mx-auto max-h-[calc(100vh-80px)] relative"> {/* 新增 relative */}
      {/* *** 新增：右上角設定按鈕 *** */}
      <div className="absolute top-4 right-4 z-20">
        <button
            onClick={onToggleSettingsPanel}
            className="p-2 bg-slate-700/50 hover:bg-slate-600 rounded-full text-white transition-colors"
            aria-label="開啟設定"
            title="設定"
        >
            <SettingsIcon className="w-5 h-5" />
        </button>
      </div>
      {/* 左側區域：操作按鈕和房間列表 */}
      <div className="flex flex-col w-full md:w-2/3 space-y-4">
        {/* 操作按鈕區域 */}
        <div className="flex space-x-4">
            <ActionButton
                label="返回主頁"
                onClick={onReturnToHome}
                variant="secondary"
                size="md"
                className="flex-1 sm:flex-initial" // 小螢幕佔滿，大螢幕自適應
            />
            <ActionButton
                label="創建新房間"
                onClick={onCreateRoomClick}
                variant="primary"
                size="md"
                className="flex-1 sm:flex-initial"
            />
        </div>

        {/* 房間列表區域 */}
        <div className="flex-grow bg-slate-700/70 p-3 sm:p-4 rounded-lg shadow-inner overflow-hidden flex flex-col">
          <h3 className="text-lg sm:text-xl font-semibold text-slate-200 mb-3 sm:mb-4 text-center">可加入的房間</h3>
          {/* 載入中或無房間的提示 */}
          {isLoadingRooms && lobbyRooms.length === 0 ? ( 
            <p className="text-slate-400 text-center py-4 animate-pulse">正在載入房間列表...</p>
          ) : lobbyRooms.length === 0 ? (
            <p className="text-slate-400 text-center py-4">目前沒有可加入的房間，快來創建一個吧！</p>
          ) : (
            // 房間列表 (可滾動)
            <ul className="space-y-2 sm:space-y-3 overflow-y-auto pr-1 sm:pr-2 scrollbar-thin scrollbar-thumb-slate-500 scrollbar-track-slate-600/50 flex-grow">
              {lobbyRooms.map((room) => (
                // 單個房間項目
                <li
                  key={room.id}
                  className="flex items-center justify-between p-2 sm:p-3 bg-slate-600/70 hover:bg-slate-500/70 rounded-md transition-colors"
                >
                  {/* 房間資訊 */}
                  <div className="flex items-center space-x-2">
                    {room.passwordProtected && <span title="有密碼鎖"><LockIcon className="w-4 h-4 text-amber-400 flex-shrink-0" /></span>}
                    {room.voiceEnabled ? 
                        <span title="語音已啟用"><MicrophoneOnIcon className="w-4 h-4 text-green-400 flex-shrink-0" /></span> : 
                        <span title="語音已禁用"><MicrophoneOffIcon className="w-4 h-4 text-red-400 flex-shrink-0" /></span>
                    }
                    <div>
                      <p className="font-semibold text-sky-200 text-sm sm:text-base">{room.name}</p>
                      <p className="text-xs sm:text-sm text-slate-300">
                        局數: {room.numberOfRounds || '未定'} | 真人: {room.currentHumanPlayers}/{room.targetHumanPlayers} | 狀態: {room.status}
                      </p>
                    </div>
                  </div>
                  {/* 加入按鈕 */}
                  <ActionButton
                    // 按鈕文字根據房間狀態和是否有密碼而變化
                    label={room.status === '等待中' ? (room.passwordProtected ? '加入 (需密碼)' : '加入房間') : '觀戰(禁用)'}
                    onClick={() => room.status === '等待中' && onJoinRoomClick(room)} // 僅在等待中狀態下可加入
                    // 禁用條件：非等待中狀態，或房間真人玩家已滿
                    disabled={room.status !== '等待中' || room.currentHumanPlayers >= room.targetHumanPlayers}
                    size="sm"
                    // 按鈕顏色：可加入時為主要顏色，否則為次要顏色
                    variant={room.status === '等待中' && room.currentHumanPlayers < room.targetHumanPlayers ? 'primary' : 'secondary'}
                    // 滑鼠懸停提示
                    title={room.currentHumanPlayers >= room.targetHumanPlayers && room.status === '等待中' ? '房間真人玩家已滿' : (room.status !== '等待中' ? '遊戲已開始或結束' : `加入 ${room.name}`)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 右側區域：排行榜和聊天面板 */}
      <div className="flex flex-col w-full md:w-1/3 space-y-4">
        <LobbyLeaderboard /> {/* 排行榜組件 */}
        <LobbyChatPanel
            messages={chatMessages} // 聊天訊息
            onSendMessage={handleSendLobbyMessage} // 發送訊息函數
            currentPlayerName={currentPlayerName} // 當前玩家名稱
        />
      </div>
    </div>
  );
};

export default Lobby;
