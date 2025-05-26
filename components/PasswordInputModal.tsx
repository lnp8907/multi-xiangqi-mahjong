
import React, { useState } from 'react';
import GameModal from './GameModal'; // 引入通用模態框組件
import ActionButton from './ActionButton'; // 引入動作按鈕組件

/**
 * @description PasswordInputModal 組件的 props 類型定義
 */
interface PasswordInputModalProps {
  /** @param {boolean} isOpen - 模態框是否開啟。 */
  isOpen: boolean;
  /** @param {() => void} onClose - 關閉模態框時觸發的回調函數。 */
  onClose: () => void;
  /** @param {(password: string) => void} onSubmit - 提交密碼時觸發的回調函數，參數為使用者輸入的密碼。 */
  onSubmit: (password: string) => void;
  /** @param {string} roomName - 要加入的房間的名稱，用於在標題中顯示。 */
  roomName: string;
}

/**
 * @description PasswordInputModal 組件，用於讓使用者輸入密碼以加入受保護的房間。
 * @param {PasswordInputModalProps} props - 組件的屬性。
 * @returns {React.FC | null} React 函數組件，或在 isOpen 為 false 時返回 null。
 */
const PasswordInputModal: React.FC<PasswordInputModalProps> = ({ isOpen, onClose, onSubmit, roomName }) => {
  // --- 狀態管理 ---
  /** @description 密碼輸入框的內容狀態。 */
  const [password, setPassword] = useState('');

  /**
   * @description 處理提交密碼的邏輯。
   */
  const handleSubmit = () => {
    onSubmit(password); // 呼叫 onSubmit 回調，傳遞輸入的密碼
    // 注意：此處不清空密碼狀態 (setPassword(''))，
    // 讓 App.tsx 或父組件根據伺服器回應決定是否需要重試或清除。
  };

  // 如果模態框未開啟，則不渲染任何內容
  if (!isOpen) return null;

  return (
    <GameModal isOpen={isOpen} title={`加入房間: ${roomName}`} onClose={onClose}>
      <div className="space-y-4">
        {/* 密碼輸入區域 */}
        <div>
          <label htmlFor="roomEntryPassword" className="block text-sm font-medium text-slate-300 mb-1">
            房間密碼
          </label>
          <input
            type="password" // 輸入類型為 password，會隱藏輸入內容
            id="roomEntryPassword"
            value={password}
            onChange={(e) => setPassword(e.target.value)} // 輸入時更新密碼狀態
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
            placeholder="請輸入房間密碼"
            autoFocus // 自動聚焦到此輸入框
          />
        </div>
      </div>
      {/* 底部按鈕區域：取消和確認加入 */}
      <div className="mt-6 flex justify-end space-x-3">
        <ActionButton label="取消" onClick={onClose} variant="secondary" />
        <ActionButton label="確認加入" onClick={handleSubmit} variant="primary" />
      </div>
    </GameModal>
  );
};

export default PasswordInputModal;
