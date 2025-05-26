
import React from 'react';
import GameModal from './GameModal'; // 引入通用模態框組件
import ActionButton from './ActionButton'; // 引入動作按鈕組件

/**
 * @description SettingsPanel 組件的 props 類型定義
 */
interface SettingsPanelProps {
  /** @param {boolean} isOpen - 設定面板是否開啟。 */
  isOpen: boolean;
  /** @param {() => void} onClose - 關閉設定面板時觸發的回調函數。 */
  onClose: () => void;
  /** @param {boolean} isMusicPlaying - 背景音樂是否正在播放。 */
  isMusicPlaying: boolean;
  /** @param {() => void} onToggleMusicPlay - 切換背景音樂播放/暫停狀態的回調函數。 */
  onToggleMusicPlay: () => void;
  /** @param {number} musicVolume - 背景音樂的音量 (0.0 - 1.0)。 */
  musicVolume: number;
  /** @param {(volume: number) => void} onVolumeChange - 改變背景音樂音量的回調函數。 */
  onVolumeChange: (volume: number) => void;
  /** @param {boolean} isSoundEffectsEnabled - 遊戲音效是否啟用。 */
  isSoundEffectsEnabled: boolean;
  /** @param {() => void} onToggleSoundEffectsEnabled - 切換遊戲音效啟用/禁用狀態的回調函數。 */
  onToggleSoundEffectsEnabled: () => void;
  /** @param {number} soundEffectsVolume - 遊戲音效的音量 (0.0 - 1.0)。 */
  soundEffectsVolume: number;
  /** @param {(volume: number) => void} onSoundEffectsVolumeChange - 改變遊戲音效音量的回調函數。 */
  onSoundEffectsVolumeChange: (volume: number) => void;
  // onLogout: () => void; // 登出功能 (預留，目前未使用)
}

/**
 * @description SettingsPanel 組件，提供遊戲的各種設定選項，如音樂、音效等。
 * @param {SettingsPanelProps} props - 組件的屬性。
 * @returns {React.FC | null} React 函數組件，或在 isOpen 為 false 時返回 null。
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  isMusicPlaying,
  onToggleMusicPlay,
  musicVolume,
  onVolumeChange,
  isSoundEffectsEnabled,
  onToggleSoundEffectsEnabled,
  soundEffectsVolume,
  onSoundEffectsVolumeChange,
}) => {
  // 如果設定面板未開啟，則不渲染任何內容
  if (!isOpen) return null;

  return (
    // 使用 GameModal 作為基礎模態框
    <GameModal isOpen={isOpen} title="遊戲設定" onClose={onClose}>
      <div className="space-y-6 text-slate-200"> {/* 內容垂直間距 */}
        {/* 音樂設定區塊 */}
        <div className="border-b border-slate-700 pb-4"> {/* 底部邊框分隔 */}
          <h3 className="text-lg font-semibold text-sky-300 mb-3">音樂</h3>
          {/* 背景音樂開關 */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-300">背景音樂</span>
            <button
              onClick={onToggleMusicPlay}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isMusicPlaying 
                  ? 'bg-sky-500 hover:bg-sky-600 text-white' 
                  : 'bg-slate-600 hover:bg-slate-500 text-slate-300'
              }`}
              aria-pressed={isMusicPlaying}
            >
              {isMusicPlaying ? '播放中' : '已暫停'}
            </button>
          </div>
          {/* 背景音樂音量調整 */}
          <div className="flex items-center space-x-2">
            <span className="text-sm text-slate-300 w-12">音量</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={musicVolume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className={`w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-sky-500 ${!isMusicPlaying ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={!isMusicPlaying}
              aria-label="背景音樂音量"
            />
            <span className="text-sm text-slate-300 w-10 text-right">{Math.round(musicVolume * 100)}%</span>
          </div>
        </div>

        {/* 音效設定區塊 */}
        <div className="border-b border-slate-700 pb-4">
          <h3 className="text-lg font-semibold text-sky-300 mb-3">遊戲音效</h3>
          {/* 遊戲音效開關 */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-300">遊戲音效</span>
            <button
              onClick={onToggleSoundEffectsEnabled}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isSoundEffectsEnabled
                  ? 'bg-sky-500 hover:bg-sky-600 text-white'
                  : 'bg-slate-600 hover:bg-slate-500 text-slate-300'
              }`}
              aria-pressed={isSoundEffectsEnabled}
            >
              {isSoundEffectsEnabled ? '已啟用' : '已禁用'}
            </button>
          </div>
          {/* 遊戲音效音量調整 */}
          <div className="flex items-center space-x-2">
            <span className="text-sm text-slate-300 w-12">音量</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={soundEffectsVolume}
              onChange={(e) => onSoundEffectsVolumeChange(parseFloat(e.target.value))}
              className={`w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-sky-500 ${!isSoundEffectsEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={!isSoundEffectsEnabled}
              aria-label="遊戲音效音量"
            />
            <span className="text-sm text-slate-300 w-10 text-right">{Math.round(soundEffectsVolume * 100)}%</span>
          </div>
        </div>
        
        {/* 關閉按鈕 */}
        <div className="mt-6 pt-4 flex justify-end">
          <ActionButton label="完成" onClick={onClose} variant="primary" />
        </div>
      </div>
    </GameModal>
  );
};
