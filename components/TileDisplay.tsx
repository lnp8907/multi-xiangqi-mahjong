
import React from 'react';
import { Tile, TileKind, Suit } from '../types'; // 引入類型定義
import { TILE_KIND_DETAILS } from '../constants'; // 引入牌的詳細設定

/**
 * @description TileDisplay 組件的 props 類型定義
 */
interface TileDisplayProps {
  /** @param {Tile | null} tile - 要顯示的牌物件，若為 null 或 isHidden 為 true，則顯示牌背或錯誤狀態。 */
  tile: Tile | null; 
  /** @param {(tile: Tile) => void} [onClick] - 點擊牌時觸發的回調函數。 */
  onClick?: (tile: Tile) => void; 
  /** @param {boolean} [isSelected=false] - 牌是否被選中 (例如在手牌中)。 */
  isSelected?: boolean; 
  /** @param {boolean} [isDiscarded=false] - 牌是否為棄牌。 */
  isDiscarded?: boolean; 
  /** @param {boolean} [isRevealedMeld=false] - 牌是否為已公開的面子的一部分。 */
  isRevealedMeld?: boolean; 
  /** @param {'small' | 'medium' | 'large'} [size='medium'] - 牌的大小。 */
  size?: 'small' | 'medium' | 'large'; 
  /** @param {boolean} [isHidden=false] - 是否顯示為牌背 (隱藏牌面)。 */
  isHidden?: boolean; 
  /** @param {'vertical' | 'horizontal'} [characterOrientation='vertical'] - 牌面文字的顯示方向。 */
  characterOrientation?: 'vertical' | 'horizontal'; 
  /** @param {boolean} [isLatestDiscard=false] - 是否為最新打出的棄牌 (用於特殊高亮)。 */
  isLatestDiscard?: boolean;
}

/**
 * @description TileDisplay 組件，用於渲染單張麻將牌的視覺表示。
 * @param {TileDisplayProps} props - 組件的屬性。
 * @returns {React.FC} React 函數組件。
 */
const TileDisplay: React.FC<TileDisplayProps> = ({
  tile,
  onClick,
  isSelected = false, 
  isDiscarded = false, 
  isRevealedMeld = false, 
  size = 'medium', 
  isHidden = false, 
  characterOrientation = 'vertical', 
  isLatestDiscard = false,
}) => {
  // 如果 tile 不存在且非隱藏狀態，則不渲染任何內容
  if (!tile && !isHidden) return null;

  // 定義不同尺寸的 CSS class
  const sizeClasses = {
    small: 'w-8 h-12 text-lg p-1',       // 小尺寸牌
    medium: 'w-12 h-[72px] text-2xl p-1.5', // 中尺寸牌 (預設)
    large: 'w-16 h-24 text-3xl p-2',    // 大尺寸牌
  };

  // --- 防禦性檢查：無效的牌種類 ---
  if (tile && !(tile.kind in TILE_KIND_DETAILS)) {
    console.error("[TileDisplay] 偵測到無效的牌種類:", tile);
    return (
      <div 
        className={`${sizeClasses[size]} rounded-md border-2 border-red-500 bg-red-200 text-red-700 font-bold flex items-center justify-center p-1 text-xs`}
        title={`錯誤: 無效的牌面 ${tile.kind?.toString()}`} // 滑鼠懸停提示錯誤
      >
        錯誤牌: {tile.kind?.toString().substring(0,3)} {/* 顯示錯誤牌面前幾個字元 */}
      </div>
    );
  }
  // --- 防禦性檢查結束 ---

  // 獲取牌的花色和牌面文字
  const tileSuit = tile ? TILE_KIND_DETAILS[tile.kind].suit : Suit.BLACK; // 預設為黑色以防 tile 為 null
  const character = tile ? tile.kind : ''; // 牌面文字

  // 基礎 CSS class：圓角、邊框、陰影、彈性佈局、過渡效果、文字樣式
  const baseClasses = `
    rounded-md border-2 shadow-md flex items-center justify-center 
    transition-all duration-200 ease-in-out select-none 
    font-bold
  `;

  // 顏色相關的 CSS class
  let colorClasses = ''; 
  if (isHidden) {
    // 牌背樣式
    colorClasses = 'bg-slate-700 border-slate-500 text-slate-400 cursor-default';
  } else if (tileSuit === Suit.RED) {
    // 紅色牌樣式
    colorClasses = 'bg-red-100 border-red-400 text-red-700 hover:bg-red-200';
  } else {
    // 黑色牌樣式
    colorClasses = 'bg-slate-100 border-slate-400 text-slate-800 hover:bg-slate-200';
  }
  
  // 如果可點擊且非棄牌/面子牌/牌背，則添加滑鼠指針樣式
  if (onClick && !isDiscarded && !isRevealedMeld && !isHidden) {
    colorClasses += ' cursor-pointer';
  } else {
    colorClasses += ' cursor-default';
  }
  
  // 選中牌的樣式：光環、放大、向上提昇、增加 z-index
  const selectedClasses = isSelected 
    ? 'ring-4 ring-sky-300 ring-offset-2 scale-110 shadow-xl -translate-y-2 z-10' 
    : '';
  
  // 棄牌效果的樣式
  let discardedEffectClasses = '';
  if (isDiscarded) {
    if (isLatestDiscard) {
      // 最新棄牌的高亮樣式：更亮的邊框、輕微放大、更強的陰影，並帶有動畫提示
      discardedEffectClasses = 'opacity-100 ring-2 ring-amber-400 ring-offset-1 scale-105 shadow-lg border-amber-500 animate-pulse-border-amber';
    } else {
      // 一般棄牌樣式：降低透明度、較小陰影
      discardedEffectClasses = 'opacity-80 shadow-sm';
    }
  }

  // 已公開面子的牌的樣式
  const revealedMeldClasses = isRevealedMeld ? 'shadow-sm' : ''; // 輕微陰影

  /**
   * @description 處理牌的點擊事件。
   * 僅在牌存在、onClick回調存在、且非棄牌/面子牌/牌背時觸發。
   */
  const handleClick = () => {
    if (tile && onClick && !isDiscarded && !isRevealedMeld && !isHidden) {
      onClick(tile);
    }
  };

  // 文字方向的 CSS style object
  const textStyle: React.CSSProperties = {};
  if (characterOrientation === 'vertical' && !isHidden) {
    textStyle.writingMode = 'vertical-rl'; // 文字垂直由右至左排列
    textStyle.textOrientation = 'upright';  // 文字保持直立
  }

  return (
    <div
      // 組合所有 CSS class
      className={`${baseClasses} ${sizeClasses[size]} ${colorClasses} ${selectedClasses} ${discardedEffectClasses} ${revealedMeldClasses}`}
      onClick={handleClick} // 點擊事件
      title={isHidden ? '隱藏牌' : (tile ? `${tile.kind} (${tile.suit === Suit.RED ? '紅' : '黑'})` : '牌')} // 滑鼠懸停提示
      aria-hidden={isHidden} //輔助技術：是否隱藏
      role={onClick && !isHidden ? "button" : "img"} // 輔助技術：角色 (按鈕或圖片)
      tabIndex={onClick && !isHidden ? 0 : -1} // 輔助技術：Tab 鍵順序
      onKeyDown={(e) => { // 鍵盤事件：Enter 或 Space 鍵觸發點擊
        if (e.key === 'Enter' || e.key === ' ') handleClick();
      }}
    >
      {isHidden ? (
        // 牌背圖示 (使用 SVG)
        <div className="flex items-center justify-center w-full h-full">
          <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* SVG 路徑繪製牌背圖案 */}
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
          </svg>
        </div>
      ) : (
        // 牌面文字
        <span style={textStyle}>
          {character}
        </span>
      )}
    </div>
  );
};

export default TileDisplay;
