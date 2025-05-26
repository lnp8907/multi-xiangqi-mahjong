
import React from 'react';
import ActionButton from './ActionButton'; // 引入動作按鈕組件
// 移除未使用的 GamePhase 和 Player 類型導入 (如果未使用)
// import { GamePhase, Player } from '../types'; 

/**
 * @description NextRoundConfirmModal 組件的 props 類型定義
 */
interface NextRoundConfirmModalProps {
  /** @param {boolean} isOpen - 模態框是否開啟。 */
  isOpen: boolean;
  /** @param {string} title - 模態框的標題 (通常包含當前局數)。 */
  title: string;
  /** @param {number | null} countdown - 下一局開始的倒數計時秒數，若為 null 則不顯示倒數。 */
  countdown: number | null;
  /** @param {boolean} isHumanPlayer - 當前客戶端是否為真人玩家。 */
  isHumanPlayer: boolean;
  /** @param {number | undefined} humanPlayerId - 如果是真人玩家，其在遊戲中的 ID (座位索引)。 */
  humanPlayerId: number | undefined;
  /** @param {number[]} humanPlayersReadyForNextRound - 已確認準備好下一局的真人玩家 ID 列表。 */
  humanPlayersReadyForNextRound: number[];
  /** @param {(playerId: number) => void} onConfirmNextRound - 玩家點擊「確認下一局」時觸發的回調函數，參數為玩家 ID。 */
  onConfirmNextRound: (playerId: number) => void;
  /** @param {() => void} onQuitGame - 玩家點擊「離開房間」時觸發的回調函數。 */
  onQuitGame: () => void;
  /** 
   * @param {object | null} roundOverDetails - 本局結束的詳細資訊，用於顯示結果。
   * @param {string} [roundOverDetails.winnerName] - 贏家名稱。
   * @param {'selfDrawn' | 'discard' | null} [roundOverDetails.winType] - 胡牌類型。
   * @param {string} [roundOverDetails.discarderName] - 放槍者名稱 (若為食胡)。
   * @param {string} [roundOverDetails.winningTileKind] - 胡的牌的種類。
   * @param {boolean} [roundOverDetails.isDrawGame] - 是否為流局。
   */
  roundOverDetails: {
    winnerName?: string;
    winType?: 'selfDrawn' | 'discard' | null;
    discarderName?: string;
    winningTileKind?: string;
    isDrawGame?: boolean;
  } | null;
}

/**
 * @description NextRoundConfirmModal 組件，用於在一局結束後，顯示結果、倒數計時，並讓真人玩家確認是否準備好下一局。
 * @param {NextRoundConfirmModalProps} props - 組件的屬性。
 * @returns {React.FC | null} React 函數組件，或在 isOpen 為 false 時返回 null。
 */
const NextRoundConfirmModal: React.FC<NextRoundConfirmModalProps> = ({
  isOpen,
  title,
  countdown,
  isHumanPlayer,
  humanPlayerId,
  humanPlayersReadyForNextRound,
  onConfirmNextRound,
  onQuitGame,
  roundOverDetails,
}) => {
  // 如果模態框未開啟，則不渲染任何內容
  if (!isOpen) return null;

  // 判斷當前真人玩家是否已確認下一局
  const humanPlayerHasConfirmed = humanPlayerId !== undefined && humanPlayersReadyForNextRound.includes(humanPlayerId);

  // 構建本局結果的顯示訊息
  let resultMessage = "";
  if (roundOverDetails) {
    if (roundOverDetails.winnerName) { // 如果有贏家
      if (roundOverDetails.winType === 'selfDrawn') { // 自摸
        resultMessage = `恭喜 ${roundOverDetails.winnerName}，自摸獲勝！`;
        if (roundOverDetails.winningTileKind) { // 顯示胡的牌
            resultMessage += ` (胡 ${roundOverDetails.winningTileKind})`;
        }
      } else if (roundOverDetails.winType === 'discard' && roundOverDetails.discarderName && roundOverDetails.winningTileKind) { // 食胡
        resultMessage = `恭喜 ${roundOverDetails.winnerName}！胡了由 ${roundOverDetails.discarderName} 打出的【${roundOverDetails.winningTileKind}】。`;
      } else { // 其他胡牌情況 (理論上應為上述兩種之一)
        resultMessage = `恭喜 ${roundOverDetails.winnerName} 獲勝！`;
      }
    } else if (roundOverDetails.isDrawGame) { // 流局
      resultMessage = "本局為流局。";
    }
  }


  return (
    // 模態框背景遮罩
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
      {/* 模態框內容容器 */}
      <div className="bg-slate-800/90 p-6 rounded-lg shadow-xl max-w-md w-full border border-slate-600 text-center">
        {/* 標題 */}
        <h2 className="text-2xl font-semibold text-sky-300 mb-4">{title}</h2>
        
        {/* 本局結果訊息 */}
        {resultMessage && (
            <p className="text-slate-200 mb-4 text-lg">{resultMessage}</p>
        )}

        {/* 下一局倒數計時 */}
        {countdown !== null && (
          <p className="text-xl text-amber-300 mb-6 animate-pulse">
            下一局開始倒數: {countdown}s
          </p>
        )}

        {/* 操作按鈕區域 */}
        <div className="space-y-3 sm:space-y-0 sm:space-x-3 flex flex-col sm:flex-row justify-center">
          {/* 確認下一局按鈕 (僅對未確認的真人玩家顯示，且倒數計時存在時) */}
          {isHumanPlayer && humanPlayerId !== undefined && !humanPlayerHasConfirmed && countdown !== null && (
            <ActionButton
              label="確認下一局"
              onClick={() => onConfirmNextRound(humanPlayerId)} // 點擊時傳入玩家ID
              variant="primary"
              size="md"
              className="w-full sm:w-auto" // 響應式寬度
            />
          )}
          {/* 已確認提示 (對已確認的真人玩家顯示，且倒數計時存在時) */}
          {isHumanPlayer && humanPlayerHasConfirmed && countdown !== null && (
            <p className="text-sm text-green-400 py-2 px-4 rounded bg-slate-700 w-full sm:w-auto">
              已確認，等待其他玩家或倒數結束...
            </p>
          )}
          {/* 離開房間按鈕 */}
          <ActionButton
            label="離開房間"
            onClick={onQuitGame}
            variant="secondary"
            size="md"
            className="w-full sm:w-auto"
          />
        </div>
      </div>
    </div>
  );
};

export default NextRoundConfirmModal;
