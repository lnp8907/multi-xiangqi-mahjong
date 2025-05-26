
import React from 'react';
import GameModal from './GameModal'; // 引入通用模態框組件
import ActionButton from './ActionButton'; // 引入動作按鈕組件
import { Player, RoomSettings } from '../types'; // 引入類型定義

/**
 * @description WaitingRoomModal 組件的 props 類型定義
 */
interface WaitingRoomModalProps {
  /** @param {boolean} isOpen - 模態框是否開啟。 */
  isOpen: boolean;
  /** @param {() => void} onStartGame - 點擊「開始遊戲」按鈕時觸發的回調函數 (僅房主可見)。 */
  onStartGame: () => void;
  /** @param {() => void} onQuitGame - 點擊「退出房間」按鈕時觸發的回調函數。 */
  onQuitGame: () => void;
  /** @param {Player[]} players - 當前房間內的玩家列表。 */
  players: Player[];
  /** @param {RoomSettings} roomSettings - 當前房間的設定資訊。 */
  roomSettings: RoomSettings;
  /** @param {boolean} isHost - 當前客戶端是否為房主。 */
  isHost: boolean;
  /** @param {string} [dealerName] - (可選) 本局莊家的名稱。 */
  dealerName?: string;
  /** @param {number} [currentRound] - (可選) 當前局數。 */
  currentRound?: number;
  /** @param {number} [numberOfRounds] - (可選) 總局數。 */
  numberOfRounds?: number;
}

/**
 * @description WaitingRoomModal 組件，用於玩家加入房間後、遊戲開始前的等待界面。
 *              顯示房間資訊、已加入玩家列表，並提供開始遊戲 (房主) 或退出房間的操作。
 * @param {WaitingRoomModalProps} props - 組件的屬性。
 * @returns {React.FC | null} React 函數組件，或在 isOpen 為 false 時返回 null。
 */
const WaitingRoomModal: React.FC<WaitingRoomModalProps> = ({
  isOpen,
  onStartGame,
  onQuitGame,
  players,
  roomSettings,
  isHost,
  dealerName,
  currentRound,
  numberOfRounds,
}) => {
  // 如果模態框未開啟，則不渲染任何內容
  if (!isOpen) return null;

  // 計算當前在線的真人玩家數量
  const onlineHumanPlayersCount = players.filter(p => p.isHuman && p.isOnline).length;
  // 從房間設定中獲取目標真人玩家數量
  const targetHumanPlayers = roomSettings.humanPlayers; 
  // 判斷是否可以開始遊戲：必須是房主，且在線真人玩家數達到目標數
  const canStartGame = isHost && onlineHumanPlayersCount >= targetHumanPlayers;
  // 彈窗標題：如果提供了局數資訊，則顯示當前局數
  const title = (currentRound && numberOfRounds) ? `房間準備中 (第 ${currentRound}/${numberOfRounds} 局)` : "房間準備中";

  // 「開始遊戲」按鈕的提示文字
  let startButtonTitle = "開始遊戲";
  if (!canStartGame && isHost) { // 如果是房主但不能開始遊戲
    if (onlineHumanPlayersCount < targetHumanPlayers) { // 如果真人玩家不足
      startButtonTitle = `尚需 ${targetHumanPlayers - onlineHumanPlayersCount} 位真人玩家`;
    } else { // 其他情況 (理論上不應發生，因為 AI 填充是在開始遊戲請求時處理)
      startButtonTitle = `等待伺服器處理或人數已達 ${targetHumanPlayers}`;
    }
  } else if (!isHost) { // 如果不是房主
    startButtonTitle = "等待房主開始";
  }


  return (
    // 使用 GameModal 作為基礎模態框
    // 如果是房主，點擊背景遮罩可以觸發 onQuitGame (關閉即退出)；否則不處理背景點擊
    <GameModal isOpen={isOpen} title={title} onClose={isHost ? onQuitGame : undefined}>
      <div className="space-y-6 text-slate-200"> {/* 內容垂直間距 */}
        {/* 房間資訊區塊 */}
        <div>
          <h3 className="text-lg font-semibold text-sky-300 mb-2">房間資訊</h3>
          <p>名稱: <span className="font-medium text-slate-100">{roomSettings.roomName}</span></p>
          <p>真人玩家: <span className="font-medium text-slate-100">{onlineHumanPlayersCount} / {targetHumanPlayers}</span></p>
          {(currentRound && numberOfRounds) && <p>局數: <span className="font-medium text-slate-100">{currentRound} / {numberOfRounds}</span></p>}
          {dealerName && <p>本局莊家: <span className="font-medium text-slate-100">{dealerName}</span></p>}
          {/* 非房主時的提示 */}
          {!isHost && <p className="text-sm text-amber-300 mt-1">等待主持人開始遊戲...</p>}
        </div>

        {/* 已加入玩家列表區塊 */}
        <div>
          <h3 className="text-lg font-semibold text-sky-300 mb-2">已加入玩家 ({players.filter(p => p.isHuman && p.isOnline).length}位真人)</h3>
          {players.length > 0 ? (
            // 玩家列表 (可滾動)
            <ul className="space-y-2 max-h-48 overflow-y-auto bg-slate-700/50 p-3 rounded-md scrollbar-thin scrollbar-thumb-slate-500 scrollbar-track-slate-600">
              {players.map((player) => (
                // 單個玩家項目，莊家有特殊背景色
                <li key={player.id} className={`p-2 rounded ${player.isDealer ? 'bg-sky-700/70' : 'bg-slate-600/70'}`}>
                  <span className="font-medium text-slate-50">{player.name}</span>
                  <span className="text-xs text-slate-300 ml-2">({player.isHuman ? (player.isOnline ? '真人' : '真人 (離線)') : '電腦AI'})</span>
                  {player.isDealer && <span className="text-xs text-amber-300 ml-2">(莊家)</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-400">目前沒有玩家...</p>
          )}
        </div>
        
        {/* 底部按鈕區域 */}
        <div className="mt-8 flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-3">
          <ActionButton
            label="退出房間"
            onClick={onQuitGame}
            variant="secondary"
            size="md"
          />
          {/* 開始遊戲按鈕 (僅房主可見) */}
          {isHost && (
            <ActionButton
              label="開始遊戲"
              onClick={onStartGame}
              disabled={!canStartGame} // 如果不滿足開始條件則禁用
              variant="primary"
              size="md"
              title={startButtonTitle} // 滑鼠懸停提示
            />
          )}
        </div>
        {/* 非房主且真人玩家未滿時的提示 */}
        {!isHost && onlineHumanPlayersCount < targetHumanPlayers && (
            <p className="text-xs text-slate-400 text-center mt-2">
                尚有空位，等待其他真人玩家加入。
            </p>
        )}
      </div>
    </GameModal>
  );
};

export default WaitingRoomModal;
