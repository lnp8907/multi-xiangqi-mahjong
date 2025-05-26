
import React, { useState } from 'react';
import GameModal from './GameModal'; // 引入通用模態框組件
import ActionButton from './ActionButton'; // 引入動作按鈕組件
import { ClientRoomSettingsData } from '../types'; // 引入客戶端房間設定的類型定義
import { ROUND_OPTIONS, NUM_PLAYERS } from '../constants'; // 引入局數選項和固定玩家數

/**
 * @description CreateRoomModal 組件的 props 類型定義
 */
interface CreateRoomModalProps {
  /** @param {boolean} isOpen - 模態框是否開啟。 */
  isOpen: boolean;
  /** @param {() => void} onClose - 關閉模態框時觸發的回調函數。 */
  onClose: () => void;
  /** 
   * @param {(settings: Omit<ClientRoomSettingsData, 'maxPlayers'>) => void} onCreate - 
   *         點擊創建按鈕並驗證通過後觸發的回調函數。
   *         參數為房間設定物件 (不包含 maxPlayers，因其固定)。
   */
  onCreate: (settings: Omit<ClientRoomSettingsData, 'maxPlayers'>) => void; 
}

/**
 * @description CreateRoomModal 組件，用於讓使用者輸入並提交創建新房間的設定。
 * @param {CreateRoomModalProps} props - 組件的屬性。
 * @returns {React.FC | null} React 函數組件，或在 isOpen 為 false 時返回 null。
 */
const CreateRoomModal: React.FC<CreateRoomModalProps> = ({ isOpen, onClose, onCreate }) => {
  // --- 狀態管理 ---
  /** @description 房間名稱的狀態。 */
  const [roomName, setRoomName] = useState('');
  /** @description 房間密碼的狀態 (可選)。 */
  const [password, setPassword] = useState('');
  /** @description 遊戲最大玩家數 (固定值)。 */
  const maxPlayersFixed = NUM_PLAYERS; 
  /** @description 真人玩家數量的狀態。 */
  const [humanPlayers, setHumanPlayers] = useState<number>(1); // 預設至少1位真人玩家
  /** @description 遊戲總局數的狀態。 */
  const [numberOfRounds, setNumberOfRounds] = useState<number>(ROUND_OPTIONS[0].value); // 預設為第一個局數選項

  /**
   * @description 處理表單提交（創建房間）的邏輯。
   */
  const handleSubmit = () => {
    // 驗證房間名稱是否為空
    if (roomName.trim() === '') {
      alert('請輸入房間名稱！');
      return;
    }
    // 呼叫 onCreate 回調函數，傳遞房間設定
    onCreate({
      roomName: roomName.trim(), // 去除房間名稱前後空格
      password: password.trim() || undefined, // 如果密碼為空，則傳遞 undefined
      humanPlayers: humanPlayers, // 真人玩家數量
      fillWithAI: true, // 若真人玩家不足，則總是嘗試用 AI 補齊 (伺服器端會根據 humanPlayers 和 maxPlayersFixed 計算 AI 數量)
      numberOfRounds: numberOfRounds, // 總局數
    });
  };

  // 如果模態框未開啟，則不渲染任何內容
  if (!isOpen) return null;

  return (
    <GameModal isOpen={isOpen} title="創建新房間" onClose={onClose}>
      <div className="space-y-4"> {/* 表單元素之間的垂直間距 */}
        {/* 房間名稱輸入 */}
        <div>
          <label htmlFor="roomName" className="block text-sm font-medium text-slate-300 mb-1">
            房間名稱
          </label>
          <input
            type="text"
            id="roomName"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
            placeholder="例如：我的麻將房"
            maxLength={20} // 最大長度限制
          />
        </div>

        {/* 房間密碼輸入 (可選) */}
        <div>
          <label htmlFor="roomPassword" className="block text-sm font-medium text-slate-300 mb-1">
            房間密碼 (可選)
          </label>
          <input
            type="password"
            id="roomPassword"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
            placeholder="留空則為公開房間"
            maxLength={20} // 最大長度限制
          />
        </div>
        
        {/* 總局數選擇 */}
        <div>
          <label htmlFor="numberOfRounds" className="block text-sm font-medium text-slate-300 mb-1">
            總局數
          </label>
          <select
            id="numberOfRounds"
            value={numberOfRounds}
            onChange={(e) => setNumberOfRounds(parseInt(e.target.value))}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100"
          >
            {ROUND_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        {/* 真人玩家數量選擇 */}
        <div>
          <label htmlFor="humanPlayers" className="block text-sm font-medium text-slate-300 mb-1">
            真人玩家數量
          </label>
          <select
            id="humanPlayers"
            value={humanPlayers}
            onChange={(e) => setHumanPlayers(parseInt(e.target.value))}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100"
          >
            {/* 產生 1 到 maxPlayersFixed 的選項 */}
            {[...Array(maxPlayersFixed).keys()].map(i => i + 1).map(num => (
              <option key={num} value={num}>{num} 人</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1 px-1">遊戲為四人制。若真人玩家不足四人，將由 AI 自動補齊空位。</p>
        </div>
      </div>
      {/* 底部按鈕區域：取消和創建房間 */}
      <div className="mt-6 flex justify-end space-x-3">
        <ActionButton label="取消" onClick={onClose} variant="secondary" />
        <ActionButton label="創建房間" onClick={handleSubmit} variant="primary" />
      </div>
    </GameModal>
  );
};

export default CreateRoomModal;
