
import React from 'react';
import { Player, Tile, Meld, Suit, GamePhase, MeldDesignation } from '../types'; // 引入類型定義
import TileDisplay from './TileDisplay'; // 引入牌顯示組件
import { TILE_KIND_DETAILS } from '../constants'; // 引入牌的詳細設定

/**
 * @description PlayerDisplay 組件的 props 類型定義
 */
interface PlayerDisplayProps {
  /** @param {Player} player - 要顯示的玩家物件。 */
  player: Player; 
  /** @param {boolean} isCurrentPlayer - 此玩家是否為當前回合玩家。 */
  isCurrentPlayer: boolean; 
  /** @param {boolean} isHumanPlayerView - 是否為真人玩家的主視角 (決定是否顯示手牌)。 */
  isHumanPlayerView: boolean; 
  /** @param {(tile: Tile) => void} [onTileClick] - 當玩家點擊手牌時的回調函數 (僅對主視角的真人玩家有效)。 */
  onTileClick?: (tile: Tile) => void; 
  /** @param {string | null} [selectedTileId] - 當前選中的手牌ID。 */
  selectedTileId?: string | null; 
  /** @param {'bottom' | 'left' | 'top' | 'right'} position - 玩家在遊戲桌上的相對位置。 */
  position: 'bottom' | 'left' | 'top' | 'right'; 
  /** @param {GamePhase} gamePhase - 當前的遊戲階段。 */
  gamePhase: GamePhase; 
}

/**
 * @description PlayerDisplay 組件，用於在遊戲板上渲染單個玩家的資訊、手牌和已公開的面子。
 * @param {PlayerDisplayProps} props - 組件的屬性。
 * @returns {React.FC} React 函數組件。
 */
const PlayerDisplay: React.FC<PlayerDisplayProps> = ({
  player,
  isCurrentPlayer,
  isHumanPlayerView,
  onTileClick,
  selectedTileId,
  position,
  gamePhase,
}) => {
  // 手牌區域的佈局 CSS class，根據玩家位置而定
  const handLayoutClasses = {
    bottom: 'flex-row space-x-1 justify-center', // 底部玩家：水平排列，間距1，居中
    left: 'flex-col -space-y-8 items-center',   // 左側玩家：垂直排列，負間距 (重疊)，居中
    top: 'flex-row-reverse space-x-1 space-x-reverse justify-center', // 頂部玩家：水平反向排列，間距1，居中
    right: 'flex-col-reverse -space-y-8 space-y-reverse items-center', // 右側玩家：垂直反向排列，負間距，居中
  };

  // 已公開面子區域的佈局 CSS class
  const meldsContainerLayoutClasses = {
    bottom: 'flex-row space-x-2 justify-center', // 底部玩家：水平排列，間距2，居中
    left: 'flex-col space-y-2 items-center',    // 左側玩家：垂直排列，間距2，居中
    top: 'flex-row-reverse space-x-2 space-x-reverse justify-center items-center', // 頂部玩家：水平反向，間距2，居中
    right: 'flex-col-reverse space-y-2 space-y-reverse items-center', // 右側玩家：垂直反向，間距2，居中
  };
  
  // 原始手牌數據，進行有效性過濾
  const originalHand = player.hand || [];
  const validHandTiles = originalHand.filter(tile => tile && tile.kind && tile.kind in TILE_KIND_DETAILS);

  // 如果過濾前後手牌數量不一致，表示有無效牌，打印錯誤日誌
  if (validHandTiles.length !== originalHand.length) {
    console.error(`[PlayerDisplay] 玩家 ${player.name} (ID: ${player.id}) 手牌中包含無效牌。原數量: ${originalHand.length}, 有效數量: ${validHandTiles.length}. 無效牌:`,
      originalHand.filter(tile => !(tile && tile.kind && tile.kind in TILE_KIND_DETAILS))
    );
  }

  // 對有效手牌進行排序，以便顯示
  const sortedHand = [...validHandTiles].sort((a, b) => {
    // 由於已過濾，此處存取 TILE_KIND_DETAILS 是安全的
    const detailsA = TILE_KIND_DETAILS[a.kind];
    const detailsB = TILE_KIND_DETAILS[b.kind];
    // 先按花色排序 (黑牌在前)
    if (detailsA.suit !== detailsB.suit) {
      return detailsA.suit === Suit.BLACK ? -1 : 1; 
    }
    // 再按牌組排序 (group 1 -> group 2 -> group 0)
    const groupOrderValue = (group: 0 | 1 | 2) => {
      if (group === 1) return 1; // 將士象組
      if (group === 2) return 2; // 車馬包組
      if (group === 0) return 3; // 兵卒組
      return 4; // 其他 (理論上不應發生)
    };
    if (detailsA.group !== detailsB.group) {
      return groupOrderValue(detailsA.group) - groupOrderValue(detailsB.group);
    }
    // 同花色同組內，按順序值降序排列 (orderValue 大的牌在前)
    return detailsB.orderValue - detailsA.orderValue;
  });

  // 當前回合玩家指示文字
  let currentPlayerIndicatorText = '';
  if (isCurrentPlayer && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER) {
    // 僅為底部 (主視角) 的真人玩家顯示 "(輪到你)"
    if (player.isHuman && (position === 'bottom')) { 
      currentPlayerIndicatorText = '(輪到你)';
    } else if (!player.isHuman || (player.isHuman && !player.isOnline)) { 
      // AI 玩家或離線由電腦代管的真人玩家顯示 "(思考中)"
      currentPlayerIndicatorText = '(思考中)';
    }
  }

  /**
   * @description 根據玩家位置獲取牌面文字的顯示方向。
   * @returns {'vertical' | 'horizontal'} 牌面文字方向。
   */
  const getCharacterOrientationForTile = (): 'vertical' | 'horizontal' => {
    // 左右兩側玩家的牌，文字水平顯示以配合旋轉
    if (position === 'left' || position === 'right') {
      return 'horizontal'; 
    }
    // 上下兩側玩家的牌，文字垂直顯示
    return 'vertical'; 
  };

  const tileCharOrientation = getCharacterOrientationForTile(); // 獲取當前位置的牌面文字方向
  
  // 處理玩家名稱顯示：如果是離線的真人玩家，則在其名稱後附加 "(電腦代管)"
  const displayName = player.isHuman && !player.isOnline 
    ? `${player.name} (電腦代管)` 
    : player.name;

  /**
   * @description 渲染玩家的手牌和已公開面子。
   * @returns {JSX.Element} 渲染的內容。
   */
  const renderContent = () => {
    // 是否顯示真實手牌：主視角玩家，或者遊戲/本局結束時，或者在等待再戰投票時
    const showRealHand = isHumanPlayerView || 
                         gamePhase === GamePhase.GAME_OVER || 
                         gamePhase === GamePhase.ROUND_OVER ||
                         gamePhase === GamePhase.AWAITING_REMATCH_VOTES;
    // 要顯示的手牌陣列：若是顯示真實手牌，則用排序後的手牌；否則用佔位符代表牌背
    const handToDisplay = showRealHand ? sortedHand : Array.from({ length: player.hand?.length || 0 }).map((_, idx) => `hidden-${player.id}-${idx}`);
    
    // 渲染手牌
    const handDisplay = (
      <div className={`flex ${handLayoutClasses[position]} justify-center min-h-[76px] relative z-0`}>
        {handToDisplay.map((item) => {
          const tile = showRealHand ? item as Tile : null; // 若顯示真實手牌，則 item 為 Tile 物件
          const key = showRealHand ? (item as Tile).id : item as string; // key 值
          
          // 創建 TileDisplay 組件實例
          const tileElement = (
            <TileDisplay
              key={key}
              tile={tile}
              // 點擊事件：僅對主視角、真人玩家、非遊戲結束/本局結束/等待再戰階段、底部位置的牌有效
              onClick={showRealHand && isHumanPlayerView && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER && gamePhase !== GamePhase.AWAITING_REMATCH_VOTES && position === 'bottom' ? onTileClick : undefined}
              // 是否選中：同上條件，且牌ID與選中ID相符
              isSelected={showRealHand && isHumanPlayerView && tile?.id === selectedTileId && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER && gamePhase !== GamePhase.AWAITING_REMATCH_VOTES && position === 'bottom'}
              size="medium" // 手牌大小
              isHidden={!showRealHand} // 是否顯示為牌背
              characterOrientation={tileCharOrientation} // 牌面文字方向
            />
          );

          // 根據玩家位置對牌進行旋轉和定位 (wrapper div 用於處理 transform)
          if (position === 'left') {
            return <div key={`${key}-wrapper`} className="transform rotate-90 origin-center mt-0 mx-10 flex-shrink-0">{tileElement}</div>;
          }
          if (position === 'right') {
            return <div key={`${key}-wrapper`} className="transform -rotate-90 origin-center mt-0 mx-10 flex-shrink-0">{tileElement}</div>;
          }
          if (position === 'top') {
            return <div key={`${key}-wrapper`} className="transform rotate-180 origin-center m-0 flex-shrink-0">{tileElement}</div>;
          }
          // 底部玩家不需旋轉
          return <div key={`${key}-wrapper`} className="m-0.5 flex-shrink-0">{tileElement}</div>;
        })}
      </div>
    );

    // 渲染已公開的面子 (如果有的話)
    const meldsDisplay = player.melds.length > 0 && (
      <div className={`flex ${meldsContainerLayoutClasses[position]} justify-center`}>
        {player.melds.map((meld) => {
          // 單個面子的佈局 class
          let oneMeldLayoutClass = "space-x-0.5"; // 預設水平排列
          if (position === 'left') { 
             oneMeldLayoutClass = "flex-col -space-y-4 items-center"; // 左側：垂直，負間距
          } else if (position === 'right') {
             oneMeldLayoutClass = "flex-col-reverse -space-y-4 space-y-reverse items-center"; // 右側：垂直反向，負間距
          }
          else if (position === 'top') {
            oneMeldLayoutClass = "space-x-0.5 flex-row-reverse"; // 頂部：水平反向
          }

          // 處理順子中被吃的牌的顯示順序：將被吃的牌放在中間
          let displayTiles = [...meld.tiles]; 
          if (meld.designation === MeldDesignation.SHUNZI && meld.claimedTileId && displayTiles.length === 3) {
            const claimedIndex = displayTiles.findIndex(t => t.id === meld.claimedTileId);
            if (claimedIndex !== -1 && claimedIndex !== 1) { // 如果被吃的牌存在且不在中間
              const claimedTile = displayTiles.splice(claimedIndex, 1)[0]; // 取出被吃的牌
              displayTiles.splice(1, 0, claimedTile); // 將其插入到中間位置
            }
          }
          
          return (
            // 單個面子的容器
            <div key={meld.id} className={`flex ${oneMeldLayoutClass} p-0.5 bg-slate-600/50 rounded`}>
              {displayTiles.map((tile) => {
                // 面子中的牌
                const meldTileElement = (
                  <TileDisplay 
                    key={tile.id} 
                    tile={tile} 
                    size="small" // 面子牌用小尺寸
                    isRevealedMeld // 標記為已公開面子的一部分
                    characterOrientation={tileCharOrientation} // 牌面文字方向
                    isHidden={false} // 面子牌總是顯示牌面
                  />
                );
                
                // 同手牌邏輯，根據位置旋轉面子中的牌
                if (position === 'left') {
                  return <div key={`${tile.id}-wrapper-meld`} className="transform rotate-90 origin-center mt-0.5 mx-2.5 flex-shrink-0">{meldTileElement}</div>;
                }
                if (position === 'right') {
                  return <div key={`${tile.id}-wrapper-meld`} className="transform -rotate-90 origin-center mt-0.5 mx-2.5 flex-shrink-0">{meldTileElement}</div>;
                }
                if (position === 'top') {
                  return <div key={`${tile.id}-wrapper-meld`} className="transform rotate-180 origin-center m-0.5 flex-shrink-0">{meldTileElement}</div>;
                }
                return <div key={`${tile.id}-wrapper-meld`} className="m-0.5 flex-shrink-0">{meldTileElement}</div>;
              })}
            </div>
          );
        })}
      </div>
    );

    // 可滾動區域的 CSS class (用於手牌/面子過多時)
    const scrollableClasses = "overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800";
    
    // 根據位置組合手牌和面子顯示，並應用滾動樣式
    if (position === 'left') {
      // 左側：面子在手牌下方 (視覺上)，先渲染手牌再渲染面子 (因 flex-col-reverse)
      return <div className={`flex flex-col-reverse items-center justify-start space-y-2 ${scrollableClasses} h-full w-full p-1`}>{handDisplay}{meldsDisplay}</div>;
    } else if (position === 'right') {
      // 右側：面子在手牌上方 (視覺上)，先渲染面子再渲染手牌
      return <div className={`flex flex-col items-center justify-start space-y-2 ${scrollableClasses} h-full w-full p-1`}>{meldsDisplay}{handDisplay}</div>;
    } else if (position === 'bottom') {
      // 底部：面子在手牌上方 (視覺上)
      return <div className={`flex flex-col items-center justify-center w-full h-full p-1 space-y-1 ${scrollableClasses}`}>{meldsDisplay}{handDisplay}</div>;
    } else { // position === 'top'
      // 頂部：面子在手牌下方 (視覺上)
      return <div className={`flex flex-col items-center justify-center w-full h-full p-1 space-y-1 ${scrollableClasses}`}>{handDisplay}{meldsDisplay}</div>;
    }
  };

  // 當前回合玩家高亮樣式：帶有呼吸燈效果的邊框和背景
  const currentPlayerHighlightClass = isCurrentPlayer && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER 
    ? 'animate-pulse-border-sky bg-sky-800/40 border-2 border-sky-500/80' 
    : 'bg-slate-700/30'; // 非當前回合玩家的背景

  return (
    // 玩家顯示區域的根容器
    <div className={`
      p-0 rounded-lg shadow-inner transition-all duration-300 h-full
      ${currentPlayerHighlightClass} 
      ${(position === 'left' || position === 'right') ? 'w-auto flex flex-col items-center' : 'w-full flex flex-row items-stretch'} 
    `}>
      {/* 玩家資訊區塊 (頭像、名稱、分數、莊家指示等) */}
      <div className={`
        ${(position === 'bottom' || position === 'top') ? 'w-28 flex-shrink-0 flex flex-col items-center justify-center p-1 border-r border-slate-600/50' : 'flex flex-col items-center space-y-1 py-1'}
        text-sm font-semibold
        ${isCurrentPlayer && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER ? 'text-sky-200' : 'text-slate-300'}
      `}>
        {/* 頭像：顯示玩家名稱首字，邊框顏色指示在線狀態 */}
        <div className={`w-12 h-12 md:w-14 md:h-14 rounded-full bg-slate-500 flex items-center justify-center text-lg md:text-xl text-white shadow-md mb-1
                        ${player.isHuman && player.isOnline ? 'ring-2 ring-green-400' : (player.isHuman && !player.isOnline ? 'ring-2 ring-orange-400' : 'ring-1 ring-slate-400')}`}>
          {player.name.substring(0, 1)}
        </div>
        {/* 名稱 & 分數 */}
        <div className="flex flex-col items-center text-center">
            <span className="text-xs md:text-sm truncate max-w-[calc(theme(spacing.28)-8px)] leading-tight" title={displayName}>{displayName}</span>
            <span className="text-xs text-amber-300 mt-0.5">積分: {player.score.toLocaleString()}</span>
        </div>
        {/* 莊家 & 當前回合指示 */}
        <div className="flex flex-col items-center space-y-0.5 mt-1 text-xs">
            {player.isDealer && <span className="px-1 py-0.5 bg-amber-500 text-black rounded-sm shadow">(莊)</span>}
            {currentPlayerIndicatorText && <span className="text-sky-300 text-center">{currentPlayerIndicatorText}</span>}
        </div>
      </div>

      {/* 手牌和面子內容的容器 */}
      <div className={`
        ${(position === 'bottom' || position === 'top') ? 'flex-grow overflow-hidden flex flex-col justify-center' : 'flex-grow w-full overflow-hidden'}
      `}>
        {renderContent()} {/* 渲染手牌和面子 */}
      </div>
    </div>
  );
};

export default PlayerDisplay;
