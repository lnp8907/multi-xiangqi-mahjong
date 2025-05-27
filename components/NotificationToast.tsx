import React, { useEffect, useState } from 'react';

// 定義通知的可能類型
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

// NotificationToast 元件的 props 類型定義
export interface NotificationToastProps {
  id: string; // 通知的唯一標識符
  message: string; // 要顯示的訊息內容
  type: NotificationType; // 通知的類型
  duration?: number; // 自動關閉的持續時間 (毫秒)，可選
  onDismiss: (id: string) => void; // 關閉通知時的回調函數
}

/**
 * @description NotificationToast 元件，用於顯示一個可自動消失或手動關閉的提示訊息。
 * @param {NotificationToastProps} props - 組件的屬性。
 * @returns {React.FC} React 函數組件。
 */
const NotificationToast: React.FC<NotificationToastProps> = ({
  id,
  message,
  type,
  duration = 5000, // 預設自動關閉時間為 5 秒
  onDismiss,
}) => {
  // 控制通知是否可見 (用於進入動畫)
  const [isVisible, setIsVisible] = useState(false);
  // 控制通知是否正在退出 (用於離開動畫)
  const [isExiting, setIsExiting] = useState(false);

  // 副作用：當元件掛載後，設定為可見以觸發進入動畫
  useEffect(() => {
    setIsVisible(true);
    // 設定計時器，在指定時間後開始關閉通知
    const timer = setTimeout(() => {
      handleDismiss();
    }, duration);
    // 清理函數：當元件卸載或依賴項改變時清除計時器
    return () => clearTimeout(timer);
  }, [id, duration, onDismiss]); // 依賴項包含 onDismiss 以符合 React Hook 規則

  /**
   * @description 處理關閉通知的邏輯。
   *              首先觸發離開動畫，然後在動畫結束後調用 onDismiss 回調。
   */
  const handleDismiss = () => {
    setIsExiting(true); // 標記為正在退出，觸發離開動畫
    // 等待動畫播放完成 (300ms，應與 CSS transition duration 匹配)
    setTimeout(() => {
      onDismiss(id); // 實際移除通知
    }, 300);
  };

  // 根據通知類型選擇不同的樣式
  let bgColorClass = '';
  let textColorClass = 'text-white'; // 預設文字顏色
  let borderColorClass = '';
  let iconSymbol = ''; // 簡易圖示符號

  switch (type) {
    case 'success':
      bgColorClass = 'bg-green-600';
      borderColorClass = 'border-green-700';
      iconSymbol = '✓'; // 成功符號
      break;
    case 'error':
      bgColorClass = 'bg-red-600';
      borderColorClass = 'border-red-700';
      iconSymbol = '✕'; // 錯誤符號
      break;
    case 'warning':
      bgColorClass = 'bg-amber-500';
      textColorClass = 'text-slate-800'; // 警告使用深色文字以提高對比度
      borderColorClass = 'border-amber-600';
      iconSymbol = '⚠'; // 警告符號
      break;
    case 'info':
    default:
      bgColorClass = 'bg-sky-600';
      borderColorClass = 'border-sky-700';
      iconSymbol = 'ℹ'; // 資訊符號
      break;
  }

  // 動畫相關的 CSS class，根據 isVisible 和 isExiting 狀態切換
  const animationClasses = isVisible && !isExiting
    ? 'opacity-100 translate-x-0' // 進入動畫：完全可見，水平位置正常
    : 'opacity-0 translate-x-full'; // 離開動畫：完全透明，向右移出視窗

  return (
    // 通知主容器：相對定位，寬度，最大寬度，邊距，溢出隱藏，圓角，陰影，邊框，背景色，動畫過渡
    <div
      className={`relative w-full max-w-sm p-4 mb-3 overflow-hidden rounded-lg shadow-xl border ${bgColorClass} ${borderColorClass} ${animationClasses} transition-all duration-300 ease-in-out`}
      role="alert" // ARIA 角色：提示
      aria-live="assertive" // ARIA 屬性：動態內容應立即通知輔助技術
    >
      <div className="flex items-start">
        {/* 圖示區域 (簡易文字圖示) */}
        <div className={`flex-shrink-0 ${textColorClass} text-xl font-bold mr-3`}>
          {iconSymbol}
        </div>
        {/* 訊息內容區域 */}
        <div className={`w-0 flex-1 pt-0.5 ${textColorClass}`}>
          <p className="text-sm font-medium break-words">{message}</p>
        </div>
        {/* 關閉按鈕區域 */}
        <div className="ml-4 flex flex-shrink-0">
          <button
            onClick={handleDismiss}
            className={`inline-flex rounded-md p-1 ${
              type === 'warning' ? 'text-slate-800 hover:bg-slate-800/20' : 'text-white hover:bg-white/20'
            } focus:outline-none focus:ring-2 focus:ring-white/80`}
          >
            <span className="sr-only">關閉</span> {/* 輔助技術：按鈕描述 */}
            {/* 關閉圖示 (X) */}
            <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationToast;
