
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
  const handLayoutClasses = {
    bottom: 'flex-row space-x-1 justify-center',
    left: 'flex-col -space-y-7 items-center', // 手牌內部堆疊
    top: 'flex-row-reverse space-x-1 space-x-reverse justify-center',
    right: 'flex-col-reverse -space-y-7 space-y-reverse items-center', // 手牌內部堆疊
  };

  const meldsContainerLayoutClasses = {
    bottom: 'flex-row space-x-2 justify-center',
    left: 'flex-col space-y-2 items-center',
    top: 'flex-row-reverse space-x-2 space-x-reverse justify-center items-center',
    right: 'flex-col-reverse space-y-2 space-y-reverse items-center',
  };

  const originalHand = player.hand || [];
  const validHandTiles = originalHand.filter(tile => tile && tile.kind && tile.kind in TILE_KIND_DETAILS);

  if (validHandTiles.length !== originalHand.length) {
    console.error(`[PlayerDisplay] 玩家 ${player.name} (ID: ${player.id}) 手牌中包含無效牌。原數量: ${originalHand.length}, 有效數量: ${validHandTiles.length}. 無效牌:`,
      originalHand.filter(tile => !(tile && tile.kind && tile.kind in TILE_KIND_DETAILS))
    );
  }

  const sortedHand = [...validHandTiles].sort((a, b) => {
    const detailsA = TILE_KIND_DETAILS[a.kind];
    const detailsB = TILE_KIND_DETAILS[b.kind];
    if (detailsA.suit !== detailsB.suit) {
      return detailsA.suit === Suit.BLACK ? -1 : 1;
    }
    const groupOrderValue = (group: 0 | 1 | 2) => {
      if (group === 1) return 1;
      if (group === 2) return 2;
      if (group === 0) return 3;
      return 4;
    };
    if (detailsA.group !== detailsB.group) { 
      return groupOrderValue(detailsA.group) - groupOrderValue(detailsB.group); 
    }
    return detailsB.orderValue - detailsA.orderValue;
  });

  let currentPlayerIndicatorText = '';
  if (isCurrentPlayer && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER) {
    if (player.isHuman && (position === 'bottom')) {
      currentPlayerIndicatorText = '(輪到你)';
    } else if (!player.isHuman || (player.isHuman && !player.isOnline)) {
      currentPlayerIndicatorText = '(思考中)';
    }
  }

  const getCharacterOrientationForTile = (): 'vertical' | 'horizontal' => {
    if (position === 'left' || position === 'right') {
      return 'horizontal';
    }
    return 'vertical';
  };

  const tileCharOrientation = getCharacterOrientationForTile();

  const displayName = player.isHuman && !player.isOnline
    ? `${player.name} (電腦代管)`
    : player.name;

  const renderContent = () => {
    const showRealHand = isHumanPlayerView ||
                         gamePhase === GamePhase.GAME_OVER ||
                         gamePhase === GamePhase.ROUND_OVER ||
                         gamePhase === GamePhase.AWAITING_REMATCH_VOTES;
    
    const handToDisplay = showRealHand ? sortedHand : Array.from({ length: player.hand?.length || 0 }).map((_, idx) => `hidden-${player.id}-${idx}`);

    const handDisplayElements = handToDisplay.map((item) => {
      const tile = showRealHand ? item as Tile : null;
      const key = showRealHand ? (item as Tile).id : item as string;

      const tileElement = (
        <TileDisplay
          key={key}
          tile={tile}
          onClick={showRealHand && isHumanPlayerView && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER && gamePhase !== GamePhase.AWAITING_REMATCH_VOTES && position === 'bottom' ? onTileClick : undefined}
          isSelected={showRealHand && isHumanPlayerView && tile?.id === selectedTileId && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER && gamePhase !== GamePhase.AWAITING_REMATCH_VOTES && position === 'bottom'}
          size="medium"
          isHidden={!showRealHand}
          characterOrientation={tileCharOrientation}
        />
      );

      if (position === 'left') {
        return <div key={`${key}-wrapper`} className="transform rotate-90 origin-center mx-10 flex-shrink-0">{tileElement}</div>;
      }
      if (position === 'right') {
        return <div key={`${key}-wrapper`} className="transform -rotate-90 origin-center mx-10 flex-shrink-0">{tileElement}</div>;
      }
      if (position === 'top') {
        return <div key={`${key}-wrapper`} className="transform rotate-180 origin-center m-0 flex-shrink-0">{tileElement}</div>;
      }
      return <div key={`${key}-wrapper`} className="m-0.5 flex-shrink-0">{tileElement}</div>;
    });
    
    // 手牌區塊
    const handDisplayContainer = (
      <div className={`flex ${handLayoutClasses[position]} justify-center min-h-[76px] relative z-0`}>
        {handDisplayElements}
      </div>
    );
    
    // 摸牌區塊
    let drawnTileDisplayElement: JSX.Element | null = null;
    // 優先處理 AI 摸牌模擬
    if (isSimulatingDraw && position !== 'bottom') {
        const tileElement = (
            <TileDisplay
                key={`simulated-draw-${player.id}`}
                tile={null} 
                size="medium"
                characterOrientation={tileCharOrientation}
                isHidden={true} 
            />
        );
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
    // 如果不是 AI 摸牌模擬，則顯示實際摸到的牌 (對於非底部玩家，強制顯示牌背)
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


    // 面子區塊
    const meldsDisplay = player.melds.length > 0 ? (
      <div className={`flex ${meldsContainerLayoutClasses[position]} justify-center`}>
        {player.melds.map((meld) => {
          let oneMeldLayoutClass = "space-x-0.5";
          if (position === 'left') {
             oneMeldLayoutClass = "flex-col -space-y-4 items-center";
          } else if (position === 'right') {
             oneMeldLayoutClass = "flex-col-reverse -space-y-4 space-y-reverse items-center";
          }
          else if (position === 'top') {
            oneMeldLayoutClass = "space-x-0.5 flex-row-reverse";
          }

          let displayTiles = [...meld.tiles];
          // 如果是吃牌形成的順子，且被吃的牌存在，嘗試將其放在中間
          if (meld.designation === MeldDesignation.SHUNZI && meld.claimedTileId && displayTiles.length === 3) {
            const claimedIndex = displayTiles.findIndex(t => t.id === meld.claimedTileId);
            if (claimedIndex !== -1 && claimedIndex !== 1) { // 如果被吃的牌不在中間
              const claimedTile = displayTiles.splice(claimedIndex, 1)[0];
              displayTiles.splice(1, 0, claimedTile); // 插入到中間位置
            }
          }


          return (
            <div key={meld.id} className={`flex ${oneMeldLayoutClass} p-0.5 bg-slate-600/50 rounded`}>
              {displayTiles.map((tile) => {
                const meldTileElement = (
                  <TileDisplay
                    key={tile.id}
                    tile={tile}
                    size="small"
                    isRevealedMeld
                    characterOrientation={(position === 'left' || position === 'right') ? 'vertical' : tileCharOrientation}
                    isHidden={false}
                  />
                );

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

    const scrollableClasses = "overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800";
    const mainContentContainerClasses = `${scrollableClasses} flex items-center justify-center w-full h-full p-1`;

    // 牌的寬度約 w-12 (3rem / 48px)，高度約 h-[72px] (4.5rem / 72px)
    const tileWidthGap = "mr-12"; // 48px
    const tileHeightGap = "mb-[72px]"; // 72px

    if (position === 'left') {
      // 左方玩家：手牌區 (最上方視覺)，摸牌區 (中)，面子區 (最下方視覺)
      // 容器垂直排列，內容水平居中
      return (
        <div className={`${mainContentContainerClasses} flex-col justify-start`}>
          {handDisplayContainer && <div className={`${drawnTileDisplayElement || meldsDisplay ? tileHeightGap : ''}`}>{handDisplayContainer}</div>}
          {drawnTileDisplayElement && <div className={`${meldsDisplay ? tileHeightGap : ''}`}>{drawnTileDisplayElement}</div>}
          {meldsDisplay}
        </div>
      );
    } else if (position === 'right') {
      // 右方玩家：面子區 (最上方視覺)，摸牌區 (中)，手牌區 (最下方視覺)
      // 容器垂直排列，內容水平居中
      return (
        <div className={`${mainContentContainerClasses} flex-col justify-start`}>
          {meldsDisplay && <div className={`${drawnTileDisplayElement || handDisplayContainer ? tileHeightGap : ''}`}>{meldsDisplay}</div>}
          {drawnTileDisplayElement && <div className={`${handDisplayContainer ? tileHeightGap : ''}`}>{drawnTileDisplayElement}</div>}
          {handDisplayContainer}
        </div>
      );
    } else if (position === 'top') {
      // 上方玩家：面子區 (最左方視覺)，摸牌區 (中)，手牌區 (最右方視覺)
      // 容器水平排列，內容垂直居中
      return (
        <div className={`${mainContentContainerClasses} flex-row justify-start`}>
          {meldsDisplay && <div className={`${drawnTileDisplayElement || handDisplayContainer ? tileWidthGap : ''}`}>{meldsDisplay}</div>}
          {drawnTileDisplayElement && <div className={`${handDisplayContainer ? tileWidthGap : ''}`}>{drawnTileDisplayElement}</div>}
          {handDisplayContainer}
        </div>
      );
    } else { // bottom (底部玩家)
      // 底部玩家：明牌區在手牌區上方。摸牌區由 GameBoard.tsx 單獨處理。
      return (
        <div className={`${mainContentContainerClasses} flex-col justify-start space-y-1`}>
            {meldsDisplay}
            {handDisplayContainer}
        </div>
      );
    }
  };


  const currentPlayerHighlightClass = isCurrentPlayer && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER
    ? 'animate-pulse-border-sky bg-sky-800/40 border-2 border-sky-500/80'
    : 'bg-slate-700/30';

  const voiceIconPositionClasses = {
    bottom: 'top-1 -right-1',
    top: 'bottom-1 -left-1',
    left: 'top-1 -left-1', 
    right: 'top-1 -right-1', 
  };


  return (
    <div className={`
      p-0 rounded-lg shadow-inner transition-all duration-300 h-full relative
      ${currentPlayerHighlightClass}
      ${(position === 'left' || position === 'right') ? 'w-auto flex flex-col items-center' : 'w-full flex flex-row items-stretch'}
    `}>
      <div className={`absolute ${voiceIconPositionClasses[position]} z-20 p-0.5 rounded-full`}>
        {player.isSpeaking && !player.isMuted && (
          <div className="bg-green-500 rounded-full p-0.5 animate-pulse">
            <SpeakerIcon className="w-3 h-3 text-white" />
          </div>
        )}
        {player.isMuted && (
          <div className="bg-red-500 rounded-full p-0.5">
            <MicrophoneOffIcon className="w-3 h-3 text-white" />
          </div>
        )}
      </div>


      <div className={`
        ${(position === 'bottom' || position === 'top') ? 'w-28 flex-shrink-0 flex flex-col items-center justify-center p-1 border-r border-slate-600/50' : 'flex flex-col items-center space-y-1 py-1'}
        text-sm font-semibold
        ${isCurrentPlayer && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER ? 'text-sky-200' : 'text-slate-300'}
      `}>
        <div className={`w-12 h-12 md:w-14 md:h-14 rounded-full bg-slate-500 flex items-center justify-center text-lg md:text-xl text-white shadow-md mb-1
                        ${player.isHuman && player.isOnline ? 'ring-2 ring-green-400' : (player.isHuman && !player.isOnline ? 'ring-2 ring-orange-400' : 'ring-1 ring-slate-400')}`}>
          {player.name.substring(0, 1)}
        </div>
        <div className="flex flex-col items-center text-center">
            <span className="text-xs md:text-sm truncate max-w-[calc(theme(spacing.28)-8px)] leading-tight" title={displayName}>{displayName}</span>
            <span className="text-xs text-amber-300 mt-0.5">積分: {player.score.toLocaleString()}</span>
        </div>
        <div className="flex flex-col items-center space-y-0.5 mt-1 text-xs">
            {player.isDealer && <span className="px-1 py-0.5 bg-amber-500 text-black rounded-sm shadow">(莊)</span>}
            {currentPlayerIndicatorText && <span className="text-sky-300 text-center">{currentPlayerIndicatorText}</span>}
        </div>
      </div>

      <div className={`
        ${(position === 'bottom' || position === 'top') ? 'flex-grow overflow-hidden flex flex-col justify-center' : 'flex-grow w-full overflow-hidden'}
      `}>
        {renderContent()}
      </div>
    </div>
  );
};

export default PlayerDisplay;
    