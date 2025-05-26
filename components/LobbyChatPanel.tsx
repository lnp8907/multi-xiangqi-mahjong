
import React, { useState, useRef, useEffect } from 'react';
import ActionButton from './ActionButton';
import { ChatMessage } from '../types';
import { SYSTEM_SENDER_NAME_FRONTEND } from '../constants'; // 引入常數

interface LobbyChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (messageText: string) => void;
  currentPlayerName: string;
}

const LobbyChatPanel: React.FC<LobbyChatPanelProps> = ({ messages, onSendMessage, currentPlayerName }) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const handleSend = () => {
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText('');
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="bg-slate-700/70 p-3 sm:p-4 rounded-lg shadow-inner md:flex-grow flex flex-col min-h-[200px]"> {/* MODIFIED: Added min-h for better distribution with flex-grow */}
      <h3 className="text-lg sm:text-xl font-semibold text-slate-200 mb-3 text-center flex-shrink-0">大廳聊天室</h3>
      
      <div className="flex-grow space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-700/50 mb-3 pr-1"> {/* MODIFIED: Changed max-h-56 to flex-grow */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex text-sm ${msg.senderName === currentPlayerName ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] p-1.5 rounded-md ${
                msg.senderName === currentPlayerName
                  ? 'bg-sky-700 text-white'
                  : (msg.senderName === SYSTEM_SENDER_NAME_FRONTEND ? 'bg-amber-600 text-white' : 'bg-slate-500 text-slate-100')
              }`}
            >
              <p className="font-semibold text-xs mb-0.5 opacity-80">
                {msg.senderName === currentPlayerName ? "你" : msg.senderName}
                <span className="text-xs opacity-70 ml-2">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </p>
              <p className="text-xs sm:text-sm break-words">{msg.text}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="mt-auto flex items-center space-x-2 flex-shrink-0">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="在這裡輸入訊息..."
          className="flex-grow px-3 py-2 bg-slate-600 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 text-sm"
          aria-label="大廳聊天訊息輸入框"
          maxLength={100}
        />
        <ActionButton label="發送" onClick={handleSend} size="sm" />
      </div>
    </div>
  );
};

export default LobbyChatPanel;
