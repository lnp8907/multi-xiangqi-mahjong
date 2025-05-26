
import React, { useEffect, useState } from 'react';

/**
 * @description GameModal 組件的 props 類型定義
 */
interface GameModalProps {
  /** @param {boolean} isOpen - 模態框是否開啟。 */
  isOpen: boolean;
  /** @param {string} title - 模態框的標題。 */
  title: string;
  /** @param {React.ReactNode} children - 模態框的內容，可以是任何 React 節點。 */
  children: React.ReactNode;
  /** @param {() => void} [onClose] - 可選的關閉模態框時觸發的回調函數。 */
  onClose?: () => void;
}

/**
 * @description GameModal 是一個通用的模態框組件，用於顯示彈出式內容。
 * @param {GameModalProps} props - 組件的屬性。
 * @returns {React.FC | null} React 函數組件，或在不應渲染時返回 null。
 */
const GameModal: React.FC<GameModalProps> = ({ isOpen, title, children, onClose }) => {
  // `shouldRender` 狀態用於控制模態框在 DOM 中的實際渲染，以便在 `isOpen` 變為 false 後仍能播放出場動畫。
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      // 如果模態框要開啟，則立即設定為可渲染。
      setShouldRender(true);
    } else {
      // 如果模態框要關閉，延遲一段時間後再設定為不可渲染，以等待出場動畫播放完畢。
      // 延遲時間 (300ms) 應與 CSS transition duration 一致。
      const timer = setTimeout(() => setShouldRender(false), 300); 
      return () => clearTimeout(timer); // 清理函數：組件卸載或 isOpen 再次改變時清除計時器。
    }
  }, [isOpen]); // 依賴 `isOpen` 狀態。

  // 如果不應該渲染 (例如已關閉且出場動畫已結束)，則返回 null。
  if (!shouldRender) return null;

  return (
    // 模態框的背景遮罩層
    <div 
      className={`fixed inset-0 flex items-center justify-center z-[70] p-4
                  transition-opacity duration-300 ease-in-out
                  ${isOpen ? 'opacity-100 bg-black/75' : 'opacity-0 bg-black/0 pointer-events-none'}`}
      // 如果提供了 onClose 回調，則點擊背景遮罩時觸發關閉 (e.target === e.currentTarget 確保點擊的是遮罩本身而非內容)。
      onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined} 
      aria-modal="true" // 輔助功能：標識為模態對話框。
      role="dialog"     // 輔助功能：角色為對話框。
    >
      {/* 模態框的內容容器 */}
      <div 
        className={`bg-slate-800 p-6 rounded-lg shadow-xl max-w-md w-full border border-slate-600
                    transition-all duration-300 ease-in-out
                    ${isOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-5'}`}
        // 阻止點擊模態框內容區域時觸發背景遮罩的 onClick 事件 (事件冒泡)。
        onClick={(e) => e.stopPropagation()} 
      >
        {/* 模態框頭部：標題和關閉按鈕 */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-semibold text-sky-300">{title}</h2>
          {/* 如果提供了 onClose 回調，則顯示關閉按鈕。 */}
          {onClose && (
            <button 
              onClick={onClose} 
              className="text-slate-400 hover:text-slate-200 text-2xl p-1 -mr-2 rounded-full focus:outline-none focus:ring-2 focus:ring-sky-500"
              aria-label="關閉視窗" // 輔助功能：按鈕的描述。
            >
              &times; {/* Unicode 乘號，常用作關閉圖示。 */}
            </button>
          )}
        </div>
        {/* 模態框的主體內容 */}
        <div className="text-slate-200">{children}</div>
      </div>
    </div>
  );
};

export default GameModal;
