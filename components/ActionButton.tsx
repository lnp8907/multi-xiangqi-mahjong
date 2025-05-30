
import React from 'react';

/**
 * @description ActionButton 組件的 props 類型定義
 */
interface ActionButtonProps {
  /** @param {string} label - 按鈕上顯示的文字。 */
  label: string;
  /** @param {() => void} onClick - 點擊按鈕時觸發的函數。 */
  onClick: () => void;
  /** @param {boolean} [disabled=false] - 按鈕是否禁用。 */
  disabled?: boolean;
  /** @param {'primary' | 'secondary' | 'danger' | 'warning'} [variant='primary'] - 按鈕的風格變體。 */
  variant?: 'primary' | 'secondary' | 'danger' | 'warning';
  /** @param {'sm' | 'md' | 'lg'} [size='md'] - 按鈕的大小。 */
  size?: 'sm' | 'md' | 'lg';
  /** @param {React.ReactNode} [icon] - 按鈕中可選的圖示。 */
  icon?: React.ReactNode;
  /** @param {string} [title] - 按鈕的 HTML title 屬性，用於滑鼠懸停提示和輔助功能。 */
  title?: string;
  /** @param {string} [className] - 允許外部傳入額外的 CSS class 來自訂樣式。 */
  className?: string;
}

/**
 * @description ActionButton 是一個通用的按鈕組件，提供多種風格、大小和禁用狀態。
 * @param {ActionButtonProps} props - 組件的屬性。
 * @returns {React.FC} React 函數組件。
 */
const ActionButton: React.FC<ActionButtonProps> = ({
  label,
  onClick,
  disabled = false, // 預設為不禁用
  variant = 'primary', // 預設風格為 primary (主要)
  size = 'lg', // 預設大小為 md (中等)
  icon,
  title, // 解構 title 屬性
  className = '', // 解構 className 屬性，預設為空字串
}) => {
  // 基礎 CSS class：字體、圓角、陰影、焦點樣式、過渡效果
  const baseClasses = "font-semibold rounded-lg shadow focus:outline-none focus:ring-2 focus:ring-opacity-75 transition-all duration-150 ease-in-out";
  
  // 不同大小的 CSS class
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",      // 小尺寸
    md: "px-4 py-2 text-sm",       // 中等尺寸
    lg: "px-6 py-3 text-base",     // 大尺寸
  };

  // 不同風格變體的 CSS class (包含禁用時的樣式)
  const variantClasses = {
    primary: `bg-sky-500 hover:bg-sky-600 text-white focus:ring-sky-400 ${disabled ? 'bg-sky-300 hover:bg-sky-300 cursor-not-allowed' : ''}`,       // 主要風格 (藍天色)
    secondary: `bg-slate-500 hover:bg-slate-600 text-white focus:ring-slate-400 ${disabled ? 'bg-slate-300 hover:bg-slate-300 cursor-not-allowed' : ''}`, // 次要風格 (石板灰)
    danger: `bg-red-500 hover:bg-red-600 text-white focus:ring-red-400 ${disabled ? 'bg-red-300 hover:bg-red-300 cursor-not-allowed' : ''}`,         // 危險/重要風格 (紅色)
    warning: `bg-amber-500 hover:bg-amber-600 text-white focus:ring-amber-400 ${disabled ? 'bg-amber-300 hover:bg-amber-300 cursor-not-allowed' : ''}`,   // 警告風格 (琥珀色)
  };

  return (
    <button
      onClick={onClick} // 點擊事件處理函數
      disabled={disabled} // 設定按鈕的禁用狀態
      // 組合所有 CSS class：基礎、大小、風格變體，以及外部傳入的 className
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      title={title} // 設定 HTML title 屬性
    >
      {/* 如果有圖示，則顯示圖示，並在右側留出一些間距 */}
      {icon && <span className="mr-2">{icon}</span>}
      {/* 顯示按鈕文字 */}
      {label}
    </button>
  );
};

export default ActionButton;
