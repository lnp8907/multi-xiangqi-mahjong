
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
  const handLayoutClasses = {
    bottom: 'flex-row space-x-1 justify-center',
    left: 'flex-col -space-y-8 items-center',
    top: 'flex-row-reverse space-x-1 space-x-reverse justify-center',
    right: 'flex-col-reverse -space-y-8 space-y-reverse items-center',
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
    if (detailsA.group !== detailsB.group) { // 注意：此處原文有誤，應為 detailsA.group !== detailsB.group
      return groupOrderValue(detailsA.group) - groupOrderValue(detailsB.group); // 修正為 groupOrderValue(detailsB.group)
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

    const handDisplay = (
      <div className={`flex ${handLayoutClasses[position]} justify-center min-h-[76px] relative z-0`}>
        {handToDisplay.map((item) => {
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
            return <div key={`${key}-wrapper`} className="transform rotate-90 origin-center mt-0 mx-10 flex-shrink-0">{tileElement}</div>;
          }
          if (position === 'right') {
            return <div key={`${key}-wrapper`} className="transform -rotate-90 origin-center mt-0 mx-10 flex-shrink-0">{tileElement}</div>;
          }
          if (position === 'top') {
            return <div key={`${key}-wrapper`} className="transform rotate-180 origin-center m-0 flex-shrink-0">{tileElement}</div>;
          }
          return <div key={`${key}-wrapper`} className="m-0.5 flex-shrink-0">{tileElement}</div>;
        })}
      </div>
    );

    const meldsDisplay = player.melds.length > 0 && (
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
          if (meld.designation === MeldDesignation.SHUNZI && meld.claimedTileId && displayTiles.length === 3) {
            const claimedIndex = displayTiles.findIndex(t => t.id === meld.claimedTileId);
            if (claimedIndex !== -1 && claimedIndex !== 1) {
              const claimedTile = displayTiles.splice(claimedIndex, 1)[0];
              displayTiles.splice(1, 0, claimedTile);
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
                    characterOrientation={tileCharOrientation}
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
    );

    const scrollableClasses = "overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800";

    if (position === 'left') {
      return <div className={`flex flex-col-reverse items-center justify-start space-y-2 ${scrollableClasses} h-full w-full p-1`}>{handDisplay}{meldsDisplay}</div>;
    } else if (position === 'right') {
      return <div className={`flex flex-col items-center justify-start space-y-2 ${scrollableClasses} h-full w-full p-1`}>{meldsDisplay}{handDisplay}</div>;
    } else if (position === 'bottom') {
      return <div className={`flex flex-col items-center justify-center w-full h-full p-1 space-y-1 ${scrollableClasses}`}>{meldsDisplay}{handDisplay}</div>;
    } else {
      return <div className={`flex flex-col items-center justify-center w-full h-full p-1 space-y-1 ${scrollableClasses}`}>{handDisplay}{meldsDisplay}</div>;
    }
  };

  const currentPlayerHighlightClass = isCurrentPlayer && gamePhase !== GamePhase.GAME_OVER && gamePhase !== GamePhase.ROUND_OVER
    ? 'animate-pulse-border-sky bg-sky-800/40 border-2 border-sky-500/80'
    : 'bg-slate-700/30';

  const voiceIconPositionClasses = {
    bottom: 'top-1 -right-1',
    top: 'bottom-1 -left-1',
    left: 'top-1 -left-1', // 如果是垂直佈局，可能需要調整
    right: 'top-1 -right-1', // 如果是垂直佈局，可能需要調整
  };


  return (
    <div className={`
      p-0 rounded-lg shadow-inner transition-all duration-300 h-full relative
      ${currentPlayerHighlightClass}
      ${(position === 'left' || position === 'right') ? 'w-auto flex flex-col items-center' : 'w-full flex flex-row items-stretch'}
    `}>
      {/* 語音狀態圖示 */}
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
