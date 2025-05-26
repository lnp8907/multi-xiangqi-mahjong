
// 引入 React 相關的鉤子和功能
import React, { useState, useRef, useEffect } from 'react';
// 引入動作按鈕組件
import ActionButton from './ActionButton';
// 引入聊天訊息的類型定義
import { ChatMessage } from '../types'; 

/**
 * @description ChatPanel 組件的 props 類型定義
 */
interface ChatPanelProps {
  /** @param {boolean} isOpen - 聊天面板是否開啟。 */
  isOpen: boolean;
  /** @param {() => void} onClose - 關閉聊天面板時觸發的回調函數。 */
  onClose: () => void;
  /** @param {ChatMessage[]} messages - 要顯示的聊天訊息陣列。 */
  messages: ChatMessage[];
  /** @param {(messageText: string) => void} onSendMessage - 發送訊息時觸發的回調函數。 */
  onSendMessage: (messageText: string) => void;
  /** @param {string} currentPlayerName - 當前玩家的名稱，用於判斷訊息是否為自己發送。 */
  currentPlayerName: string;
}

/**
 * @description ChatPanel 組件，用於遊戲中或大廳的聊天功能。
 * @param {ChatPanelProps} props - 組件的屬性。
 * @returns {React.FC | null} React 函數組件，或在不應渲染時返回 null。
 */
const ChatPanel: React.FC<ChatPanelProps> = ({ isOpen, onClose, messages, onSendMessage, currentPlayerName }) => {
  // --- 狀態管理 ---
  /** @description 輸入框中的文字內容狀態。 */
  const [inputText, setInputText] = useState('');
  /** @description 指向訊息列表底部的 ref，用於自動滾動。 */
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** @description 控制組件是否實際渲染到 DOM (用於出場動畫)。 */
  const [shouldRender, setShouldRender] = useState(isOpen);

  /**
   * @description 將訊息列表滾動到底部。
   */
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); // 平滑滾動
  };

  // --- 副作用 (useEffect) ---
  // 當 messages 陣列更新時，自動滾動到底部
  useEffect(scrollToBottom, [messages]);

  // 處理面板的顯示/隱藏及出場動畫
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true); // 開啟時立即渲染
    } else {
      // 關閉時延遲設定為不可渲染，以等待出場動畫結束 (300ms)
      const timer = setTimeout(() => setShouldRender(false), 300); 
      return () => clearTimeout(timer); // 清理計時器
    }
  }, [isOpen]); // 依賴 isOpen 狀態

  /**
   * @description 處理發送訊息的邏輯。
   */
  const handleSend = () => {
    // 確保輸入框內容非空 (去除前後空白後)
    if (inputText.trim()) {
      onSendMessage(inputText.trim()); // 呼叫父組件傳入的發送訊息函數
      setInputText(''); // 清空輸入框
    }
  };

  /**
   * @description 處理輸入框中的鍵盤按下事件 (Enter鍵發送)。
   * @param {React.KeyboardEvent<HTMLInputElement>} event - 鍵盤事件物件。
   */
  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { // 如果按下的是 Enter 鍵
      handleSend(); // 發送訊息
    }
  };

  // 如果不應渲染，則返回 null
  if (!shouldRender) return null;

  return (
    // 聊天面板主容器：固定定位，背景，邊框，陰影，彈性佈局，過渡動畫
    <div 
        className={`fixed bottom-16 right-4 w-80 h-[400px] bg-slate-800/90 backdrop-blur-sm border border-slate-700 rounded-lg shadow-xl flex flex-col z-40
                    transition-all duration-300 ease-in-out
                    ${isOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10 pointer-events-none'}`} // 開啟/關閉時的動畫效果
        aria-modal="true" // 輔助功能：標識為模態對話框
        role="dialog"     // 輔助功能：角色為對話框
        aria-labelledby="chat-panel-title" // 輔助功能：標題關聯
    >
      {/* 面板頭部：標題和關閉按鈕 */}
      <div className="flex justify-between items-center p-3 border-b border-slate-700">
        <h3 id="chat-panel-title" className="text-lg font-semibold text-sky-300">聊天室</h3>
        <button
          onClick={onClose} // 關閉按鈕
          className="text-slate-400 hover:text-slate-200 text-xl p-1 -mr-1 rounded-full focus:outline-none focus:ring-2 focus:ring-sky-500"
          aria-label="關閉聊天室"
        >
          &times; {/* 關閉圖示 */}
        </button>
      </div>

      {/* 訊息顯示區域：可滾動 */}
      <div className="flex-grow p-3 space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-700">
        {messages.map((msg) => (
          // 單條訊息容器：根據發送者決定靠左或靠右顯示
          <div
            key={msg.id} // 每條訊息的唯一 key
            className={`flex ${msg.senderName === currentPlayerName ? 'justify-end' : 'justify-start'}`}
          >
            {/* 訊息內容框 */}
            <div
              className={`max-w-[75%] p-2 rounded-lg text-sm ${
                // 根據是否為當前玩家發送，以及是否為系統訊息，設定不同背景色
                msg.senderName === currentPlayerName
                  ? 'bg-sky-600 text-white' // 自己發送的訊息
                  : (msg.type === 'system' ? 'bg-amber-600 text-white' : 'bg-slate-600 text-slate-100') // 他人或系統訊息
              }`}
            >
              {/* 發送者名稱 (如果是自己則顯示 "你") */}
              <p className="font-semibold text-xs mb-0.5 opacity-80">
                {msg.senderName === currentPlayerName ? "你" : msg.senderName}
              </p>
              {/* 訊息文本 */}
              <p>{msg.text}</p>
              {/* 時間戳 */}
              <p className="text-xs opacity-60 mt-1 text-right">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        {/* 用於自動滾動的空 div */}
        <div ref={messagesEndRef} />
      </div>

      {/* 輸入區域：輸入框和發送按鈕 */}
      <div className="p-3 border-t border-slate-700 flex items-center space-x-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={handleKeyPress} // 監聽 Enter 鍵
          placeholder="輸入訊息..."
          className="flex-grow px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
          aria-label="聊天訊息輸入框"
        />
        <ActionButton label="發送" onClick={handleSend} size="sm" />
      </div>
    </div>
  );
};

export default ChatPanel;
