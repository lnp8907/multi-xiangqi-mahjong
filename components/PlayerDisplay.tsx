
import React from 'react';
import { Player, Tile, Meld, Suit, GamePhase, MeldDesignation } from '../types'; // 引入類型定義
import TileDisplay from './TileDisplay'; // 引入牌顯示組件
import SpeakerIcon from './icons/SpeakerIcon'; // 新增：引入喇叭圖示
import MicrophoneOffIcon from './icons/MicrophoneOffIcon'; // 引入麥克風關閉圖示
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
  /** @param {Tile | null} lastDrawnTileForPlayer - 特定玩家摸到的牌。*/
  lastDrawnTileForPlayer: Tile | null;
  /** @param {boolean} isPlayerTurnAndDrawn - 是否輪到此玩家且已摸牌。*/
  isPlayerTurnAndDrawn: boolean;
  /** @param {boolean} [isSimulatingDraw] - 是否正在為此 AI 玩家模擬摸牌動畫。 */
  isSimulatingDraw?: boolean;
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
  lastDrawnTileForPlayer,
  isPlayerTurnAndDrawn,
  isSimulatingDraw, // 新增 prop
}) => {
  // --- 佈局 CSS Class 定義 ---
  // 根據玩家位置 (position) 決定手牌區的 flex 排列方式和間距
  // 例如：底部玩家 (bottom) 手牌是橫向排列 (flex-row)，牌之間有水平間距 (space-x-1)
  // 左側玩家 (left) 手牌是縱向排列 (flex-col)，牌之間有垂直負間距 (-space-y-7) 以達到堆疊效果
  const handLayoutClasses = {
    bottom: 'flex-row space-x-1 justify-center', // 底部玩家：橫向排列，水平間距，居中
    left: 'flex-col -space-y-7 items-center', // 左側玩家：縱向排列，垂直負間距 (堆疊)，項目居中
    top: 'flex-row-reverse space-x-1 space-x-reverse justify-center', // 上方玩家：反向橫向排列，反向水平間距，居中
    right: 'flex-col-reverse -space-y-7 space-y-reverse items-center', // 右側玩家：反向縱向排列，反向垂直負間距 (堆疊)，項目居中
  };

  // 根據玩家位置決定面子區 (已公開的牌組) 的 flex 排列方式和間距
  const meldsContainerLayoutClasses = {
    bottom: 'flex-row space-x-2 justify-center', // 底部玩家：橫向排列，水平間距，居中
    left: 'flex-col space-y-2 items-center',    // 左側玩家：縱向排列，垂直間距，項目居中
    top: 'flex-row-reverse space-x-2 space-x-reverse justify-center items-center', // 上方玩家：反向橫向排列，反向水平間距，居中
    right: 'flex-col-reverse space-y-2 space-y-reverse items-center', // 右側玩家：反向縱向排列，反向垂直間距，項目居中
  };

  // --- 手牌數據處理 ---
  // 獲取原始手牌，如果 player.hand 未定義則為空陣列
  const originalHand = player.hand || [];
  // 過濾無效的手牌 (例如，牌種不存在於 TILE_KIND_DETAILS 中)
  const validHandTiles = originalHand.filter(tile => tile && tile.kind && tile.kind in TILE_KIND_DETAILS);

  // 如果過濾後的有效手牌數量與原始手牌數量不符，則記錄錯誤
  if (validHandTiles.length !== originalHand.length) {
    console.error(`[PlayerDisplay] 玩家 ${player.name} (ID: ${player.id}) 手牌中包含無效牌。原數量: ${originalHand.length}, 有效數量: ${validHandTiles.length}. 無效牌:`,
      originalHand.filter(tile => !(tile && tile.kind && tile.kind in TILE_KIND_DETAILS))
    );
  }

  // 對有效手牌進行排序，排序規則：花色 -> 組別 -> 牌面大小 (orderValue)
  const sortedHand = [...validHandTiles].sort((a, b) => {
    const detailsA = TILE_KIND_DETAILS[a.kind];
    const detailsB = TILE_KIND_DETAILS[b.kind];
    // 1. 按花色排序 (黑牌在前)
    if (detailsA.suit !== detailsB.suit) {
      return detailsA.suit === Suit.BLACK ? -1 : 1;
    }
    // 輔助函數，定義牌組的排序優先級
    const groupOrderValue = (group: 0 | 1 | 2) => {
      if (group === 1) return 1; // 將士象組
      if (group === 2) return 2; // 車馬包組
      if (group === 0) return 3; // 兵卒組
      return 4; // 預留，理論上不應出現
    };
    // 2. 按牌組排序
    if (detailsA.group !== detailsB.group) { 
      return groupOrderValue(detailsA.group) - groupOrderValue(detailsB.group); 
    }
    // 3. 同花色同組內，按 orderValue 降序排列 (orderValue 大的牌在前)
    return detailsB.orderValue - detailsA.orderValue;
  });

  // --- 當前玩家指示文字 ---
  // 根據是否為當前回合玩家、是否為真人、是否在線等條件，決定顯示的指示文字 (例如：輪到你、思考中)
  let currentPlayerIndicatorText = '';
  if (isCurrentPlayer && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER) {
    if (player.isHuman && (position === 'bottom')) {
      currentPlayerIndicatorText = '(輪到你)';
    } else if (!player.isHuman || (player.isHuman && !player.isOnline)) {
      currentPlayerIndicatorText = '(思考中)';
    }
  }

  // --- 牌面文字方向 ---
  // 根據玩家位置決定牌面文字是垂直顯示還是水平顯示
  const getCharacterOrientationForTile = (): 'vertical' | 'horizontal' => {
    if (position === 'left' || position === 'right') {
      return 'horizontal'; // 左右兩側玩家的牌，文字水平顯示 (因牌已旋轉90度)
    }
    return 'vertical'; // 上下兩側玩家的牌，文字垂直顯示
  };
  const tileCharOrientation = getCharacterOrientationForTile();

  // --- 玩家名稱顯示 ---
  // 如果是真人玩家但已離線，則在名稱後加上 "(電腦代管)"
  const displayName = player.isHuman && !player.isOnline
    ? `${player.name} (電腦代管)`
    : player.name;

  // --- 核心渲染邏輯 ---
  const renderContent = () => {
    // 決定是否顯示真實手牌：
    // 1. 是真人玩家的主視角 (isHumanPlayerView)
    // 2. 或 遊戲已結束相關階段 (GAME_OVER, ROUND_OVER, AWAITING_REMATCH_VOTES)
    const showRealHand = isHumanPlayerView ||
                         gamePhase === GamePhase.GAME_OVER ||
                         gamePhase === GamePhase.ROUND_OVER ||
                         gamePhase === GamePhase.AWAITING_REMATCH_VOTES;
    
    // 根據 showRealHand 決定要顯示的手牌數據 (真實牌物件或佔位符字串)
    const handToDisplay = showRealHand ? sortedHand : Array.from({ length: player.hand?.length || 0 }).map((_, idx) => `hidden-${player.id}-${idx}`);

    // 遍歷手牌數據，生成每個牌的顯示元素
    const handDisplayElements = handToDisplay.map((item) => {
      const tile = showRealHand ? item as Tile : null; // 如果顯示真實手牌，則 item 是 Tile 物件
      const key = showRealHand ? (item as Tile).id : item as string; // key 值

      // 創建 TileDisplay 組件實例
      const tileElement = (
        <TileDisplay
          key={key}
          tile={tile}
          // 點擊事件：僅在特定條件下啟用 (真實手牌、主視角、非遊戲結束階段、底部玩家)
          onClick={showRealHand && isHumanPlayerView && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER && gamePhase !== GamePhase.AWAITING_REMATCH_VOTES && position === 'bottom' ? onTileClick : undefined}
          // 是否選中：僅在特定條件下高亮選中牌
          isSelected={showRealHand && isHumanPlayerView && tile?.id === selectedTileId && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER && gamePhase !== GamePhase.AWAITING_REMATCH_VOTES && position === 'bottom'}
          size="medium" // 牌的大小
          isHidden={!showRealHand} // 是否隱藏牌面 (顯示牌背)
          characterOrientation={tileCharOrientation} // 牌面文字方向
        />
      );

      // 根據玩家位置對牌進行旋轉和定位調整
      // 使用 flex-shrink-0 避免牌在 flex 容器中被壓縮
      if (position === 'left') {
        // 左側玩家：牌旋轉90度，調整外邊距以模擬堆疊
        return <div key={`${key}-wrapper`} className="transform rotate-90 origin-center mx-10 flex-shrink-0">{tileElement}</div>;
      }
      if (position === 'right') {
        // 右側玩家：牌旋轉-90度，調整外邊距
        return <div key={`${key}-wrapper`} className="transform -rotate-90 origin-center mx-10 flex-shrink-0">{tileElement}</div>;
      }
      if (position === 'top') {
        // 上方玩家：牌旋轉180度
        return <div key={`${key}-wrapper`} className="transform rotate-180 origin-center m-0 flex-shrink-0">{tileElement}</div>;
      }
      // 底部玩家：無旋轉，微小外邊距
      return <div key={`${key}-wrapper`} className="m-0.5 flex-shrink-0">{tileElement}</div>;
    });
    
    // 手牌區塊容器：使用上面定義的 handLayoutClasses 進行佈局，並設定最小高度和相對定位 (z-0)
    const handDisplayContainer = (
      <div className={`flex ${handLayoutClasses[position]} justify-center min-h-[76px] relative z-0`}>
        {handDisplayElements}
      </div>
    );
    
    // 摸牌區塊邏輯
    let drawnTileDisplayElement: JSX.Element | null = null;
    // 優先處理 AI 摸牌模擬動畫 (isSimulatingDraw 為 true 且非底部玩家)
    if (isSimulatingDraw && position !== 'bottom') {
        // 創建一個牌背的 TileDisplay
        const tileElement = (
            <TileDisplay
                key={`simulated-draw-${player.id}`}
                tile={null} // tile 為 null 表示牌背
                size="medium"
                characterOrientation={tileCharOrientation}
                isHidden={true} // 強制顯示牌背
            />
        );
        // 根據位置進行旋轉
        let tileRotationWrapper: JSX.Element = tileElement;
        if (position === 'left') {
            tileRotationWrapper = <div className="transform rotate-90 origin-center">{tileElement}</div>;
        } else if (position === 'right') {
            tileRotationWrapper = <div className="transform -rotate-90 origin-center">{tileElement}</div>;
        } else if (position === 'top') {
            tileRotationWrapper = <div className="transform rotate-180 origin-center">{tileElement}</div>;
        }
        // 包裹在 flex 容器中，用於居中和固定大小
        drawnTileDisplayElement = (
            <div className="flex-shrink-0 flex items-center justify-center">
                {tileRotationWrapper}
            </div>
        );
    }
    // 如果不是 AI 摸牌模擬，則處理實際摸到的牌 (對非底部玩家，強制顯示牌背)
    // isPlayerTurnAndDrawn: 是否輪到此玩家且已摸牌
    // lastDrawnTileForPlayer: 該玩家摸到的牌
    else if (isPlayerTurnAndDrawn && lastDrawnTileForPlayer && position !== 'bottom') {
        const tileElement = (
            <TileDisplay
                key={`drawn-${lastDrawnTileForPlayer.id}`}
                tile={lastDrawnTileForPlayer}
                size="medium"
                characterOrientation={tileCharOrientation}
                isHidden={true} // 強制顯示牌背給其他玩家
            />
        );
        
        // 根據位置進行旋轉
        let tileRotationWrapper: JSX.Element = tileElement;
        if (position === 'left') {
            tileRotationWrapper = <div className="transform rotate-90 origin-center">{tileElement}</div>;
        } else if (position === 'right') {
            tileRotationWrapper = <div className="transform -rotate-90 origin-center">{tileElement}</div>;
        } else if (position === 'top') {
            tileRotationWrapper = <div className="transform rotate-180 origin-center">{tileElement}</div>;
        }
        
        drawnTileDisplayElement = (
            <div className="flex-shrink-0 flex items-center justify-center">
                {tileRotationWrapper}
            </div>
        );
    }


    // 面子區塊 (已公開的吃碰槓牌組)
    const meldsDisplay = player.melds.length > 0 ? (
      // 使用上面定義的 meldsContainerLayoutClasses 進行佈局
      <div className={`flex ${meldsContainerLayoutClasses[position]} justify-center`}>
        {player.melds.map((meld) => {
          // 根據玩家位置決定單個面子內部的牌的排列方式
          let oneMeldLayoutClass = "space-x-0.5"; // 預設為橫向排列
          if (position === 'left') {
             oneMeldLayoutClass = "flex-col -space-y-4 items-center"; // 左側：縱向堆疊
          } else if (position === 'right') {
             oneMeldLayoutClass = "flex-col-reverse -space-y-4 space-y-reverse items-center"; // 右側：反向縱向堆疊
          }
          else if (position === 'top') {
            oneMeldLayoutClass = "space-x-0.5 flex-row-reverse"; // 上方：反向橫向排列
          }

          // 複製一份面子中的牌，用於可能的排序調整
          let displayTiles = [...meld.tiles];
          // 特殊處理：如果是吃牌形成的順子，且被吃的牌 (claimedTileId) 存在，嘗試將其顯示在中間
          if (meld.designation === MeldDesignation.SHUNZI && meld.claimedTileId && displayTiles.length === 3) {
            const claimedIndex = displayTiles.findIndex(t => t.id === meld.claimedTileId);
            if (claimedIndex !== -1 && claimedIndex !== 1) { // 如果被吃的牌不在中間 (索引1)
              const claimedTile = displayTiles.splice(claimedIndex, 1)[0]; // 先移除
              displayTiles.splice(1, 0, claimedTile); // 再插入到中間位置
            }
          }

          // 渲染單個面子
          return (
            // 單個面子的容器，應用佈局 class，並加上背景和圓角
            <div key={meld.id} className={`flex ${oneMeldLayoutClass} p-0.5 bg-slate-600/50 rounded`}>
              {displayTiles.map((tile) => {
                // 決定此張面子牌是否應顯示為牌背 (暗槓且非自己主視角，且非遊戲結束階段)
                const tileShouldBeHidden = !meld.isOpen && !isHumanPlayerView && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER && gamePhase !== GamePhase.AWAITING_REMATCH_VOTES;
                // 創建 TileDisplay 組件實例
                const meldTileElement = (
                  <TileDisplay
                    key={tile.id}
                    tile={tile}
                    size="small" // 面子牌通常較小
                    isRevealedMeld // 標記為已公開的面子牌
                    // 左右兩側玩家的面子牌，文字強制垂直 (因牌本身已旋轉)；其他位置同手牌
                    characterOrientation={(position === 'left' || position === 'right') ? 'vertical' : tileCharOrientation}
                    isHidden={tileShouldBeHidden} // 根據條件決定是否隱藏牌面
                  />
                );
                // 根據玩家位置對面子牌進行旋轉和定位調整
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
    ) : null; // 如果沒有面子，則 meldsDisplay 為 null

    // --- 最終佈局組合 ---
    // 主內容容器的通用 CSS Class (可滾動、flex、居中、內邊距)
    const scrollableClasses = "overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800";
    const mainContentContainerClasses = `${scrollableClasses} flex items-center justify-center w-full h-full p-1`;

    // 定義牌的寬度和高度作為間隔參考 (CSS class 名稱用於語義，實際值在 CSS 中定義)
    const tileWidthGap = "mr-12"; // 約一張牌的寬度
    const tileHeightGap = "mb-[72px]"; // 約一張牌的高度

    // 根據玩家位置 (position) 決定面子區、摸牌區、手牌區的排列順序
    if (position === 'left') {
      // 左方玩家：(視覺由上至下) 手牌區 -> 摸牌區 -> 面子區
      return (
        <div className={`${mainContentContainerClasses} flex-col justify-start`}> {/* 垂直排列，從上方開始 */}
          {/* 手牌區，如果下方有摸牌區或面子區，則增加底部間隔 */}
          {handDisplayContainer && <div className={`${drawnTileDisplayElement || meldsDisplay ? tileHeightGap : ''}`}>{handDisplayContainer}</div>}
          {/* 摸牌區，如果下方有面子區，則增加底部間隔 */}
          {drawnTileDisplayElement && <div className={`${meldsDisplay ? tileHeightGap : ''}`}>{drawnTileDisplayElement}</div>}
          {/* 面子區 */}
          {meldsDisplay}
        </div>
      );
    } else if (position === 'right') {
      // 右方玩家：(視覺由上至下) 面子區 -> 摸牌區 -> 手牌區
      return (
        <div className={`${mainContentContainerClasses} flex-col justify-start`}>
          {meldsDisplay && <div className={`${drawnTileDisplayElement || handDisplayContainer ? tileHeightGap : ''}`}>{meldsDisplay}</div>}
          {drawnTileDisplayElement && <div className={`${handDisplayContainer ? tileHeightGap : ''}`}>{drawnTileDisplayElement}</div>}
          {handDisplayContainer}
        </div>
      );
    } else if (position === 'top') {
      // 上方玩家：(視覺由左至右) 面子區 -> 摸牌區 -> 手牌區
      return (
        <div className={`${mainContentContainerClasses} flex-row justify-start`}> {/* 水平排列，從左方開始 */}
          {meldsDisplay && <div className={`${drawnTileDisplayElement || handDisplayContainer ? tileWidthGap : ''}`}>{meldsDisplay}</div>}
          {drawnTileDisplayElement && <div className={`${handDisplayContainer ? tileWidthGap : ''}`}>{drawnTileDisplayElement}</div>}
          {handDisplayContainer}
        </div>
      );
    } else { // position === 'bottom' (底部玩家)
      // 底部玩家：(視覺由上至下) 面子區 -> 手牌區。摸牌區由 GameBoard.tsx 在手牌右側單獨處理。
      return (
        <div className={`${mainContentContainerClasses} flex-col justify-start space-y-1`}> {/* 垂直排列，組件間有微小垂直間距 */}
            {meldsDisplay}
            {handDisplayContainer}
        </div>
      );
    }
  };

  // --- 玩家資訊區塊的樣式 ---
  // 當前回合玩家的高亮樣式 (呼吸燈效果、背景色、邊框)
  const currentPlayerHighlightClass = isCurrentPlayer && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER
    ? 'animate-pulse-border-sky bg-sky-800/40 border-2 border-sky-500/80' // 自訂動畫 class 和 Tailwind class
    : 'bg-slate-700/30'; // 非當前回合玩家的背景

  // 語音圖示 (喇叭/麥克風關閉) 的定位 class
  const voiceIconPositionClasses = {
    bottom: 'top-1 -right-1', // 底部玩家：右上角
    top: 'bottom-1 -left-1',  // 上方玩家：左下角
    left: 'top-1 -left-1',    // 左側玩家：左上角
    right: 'top-1 -right-1',   // 右側玩家：右上角
  };

  // --- 組件最終渲染 ---
  return (
    // 玩家顯示區的總容器：內邊距、圓角、陰影、過渡效果、高度撐滿、相對定位
    // 應用當前回合高亮 class
    // 根據玩家位置 (position) 決定 flex 排列方向 (橫向或縱向) 和對齊方式
    <div className={`
      p-0 rounded-lg shadow-inner transition-all duration-300 h-full relative
      ${currentPlayerHighlightClass}
      ${(position === 'left' || position === 'right') ? 'w-auto flex flex-col items-center' : 'w-full flex flex-row items-stretch'}
    `}>
      {/* 語音狀態圖示：絕對定位，根據玩家位置調整 */}
      <div className={`absolute ${voiceIconPositionClasses[position]} z-20 p-0.5 rounded-full`}>
        {/* 如果玩家正在說話且未靜音，顯示喇叭圖示並帶有脈衝動畫 */}
        {player.isSpeaking && !player.isMuted && (
          <div className="bg-green-500 rounded-full p-0.5 animate-pulse">
            <SpeakerIcon className="w-3 h-3 text-white" />
          </div>
        )}
        {/* 如果玩家已靜音，顯示麥克風關閉圖示 */}
        {player.isMuted && (
          <div className="bg-red-500 rounded-full p-0.5">
            <MicrophoneOffIcon className="w-3 h-3 text-white" />
          </div>
        )}
      </div>

      {/* 玩家資訊區塊 (頭像、名稱、分數、狀態) */}
      {/* 根據玩家位置調整寬度、排列方式、邊框等 */}
      <div className={`
        ${(position === 'bottom' || position === 'top') ? 'w-28 flex-shrink-0 flex flex-col items-center justify-center p-1 border-r border-slate-600/50' : 'flex flex-col items-center space-y-1 py-1'}
        text-sm font-semibold
        ${isCurrentPlayer && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER ? 'text-sky-200' : 'text-slate-300'}
      `}>
        {/* 模擬頭像：圓形背景，顯示玩家名稱首字 */}
        <div className={`w-12 h-12 md:w-14 md:h-14 rounded-full bg-slate-500 flex items-center justify-center text-lg md:text-xl text-white shadow-md mb-1
                        ${player.isHuman && player.isOnline ? 'ring-2 ring-green-400' : (player.isHuman && !player.isOnline ? 'ring-2 ring-orange-400' : 'ring-1 ring-slate-400')}`}>
          {player.name.substring(0, 1)}
        </div>
        {/* 玩家名稱和分數 */}
        <div className="flex flex-col items-center text-center">
            {/* 玩家名稱，限制最大寬度並截斷溢出文字 */}
            <span className="text-xs md:text-sm truncate max-w-[calc(theme(spacing.28)-8px)] leading-tight" title={displayName}>{displayName}</span>
            {/* 玩家分數 */}
            <span className="text-xs text-amber-300 mt-0.5">積分: {player.score.toLocaleString()}</span>
        </div>
        {/* 莊家和當前回合指示 */}
        <div className="flex flex-col items-center space-y-0.5 mt-1 text-xs">
            {player.isDealer && <span className="px-1 py-0.5 bg-amber-500 text-black rounded-sm shadow">(莊)</span>}
            {currentPlayerIndicatorText && <span className="text-sky-300 text-center">{currentPlayerIndicatorText}</span>}
        </div>
      </div>

      {/* 牌區 (手牌、面子、摸牌) 的容器 */}
      {/* 根據玩家位置調整 flex 佈局和溢出處理 */}
      <div className={`
        ${(position === 'bottom' || position === 'top') ? 'flex-grow overflow-hidden flex flex-col justify-center' : 'flex-grow w-full overflow-hidden'}
      `}>
        {renderContent()} {/* 渲染上面定義的牌區內容 */}
      </div>
    </div>
  );
};

export default PlayerDisplay;