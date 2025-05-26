
import React, { useState } from 'react';
import ActionButton from './ActionButton'; // 引入動作按鈕組件

/**
 * @description HomePage 組件的 props 類型定義
 */
interface HomePageProps {
  /** @param {(playerName: string) => void} onEnterLobby - 點擊「進入遊戲大廳」按鈕後觸發的回調函數，參數為玩家輸入的名稱。 */
  onEnterLobby: (playerName: string) => void;
  /** @param {string} defaultPlayerName - 預設的玩家名稱 (例如從 localStorage 讀取)。 */
  defaultPlayerName: string;
}

/**
 * @description HomePage 組件，作為應用程式的起始頁面，讓使用者輸入名稱並進入大廳。
 * @param {HomePageProps} props - 組件的屬性。
 * @returns {React.FC} React 函數組件。
 */
const HomePage: React.FC<HomePageProps> = ({ onEnterLobby, defaultPlayerName }) => {
  // --- 狀態管理 ---
  /** @description 玩家名稱的狀態，初始值為 props傳入的 defaultPlayerName。 */
  const [playerName, setPlayerName] = useState(defaultPlayerName);

  /**
   * @description 處理點擊「進入遊戲大廳」按鈕的邏輯。
   */
  const handleEnter = () => {
    // 呼叫 onEnterLobby 回調函數，傳入玩家名稱 (去除前後空格，若為空則使用預設 "玩家")。
    onEnterLobby(playerName.trim() || "玩家"); 
  };

  return (
    // 主頁容器：彈性佈局，垂直排列，內容居中
    <div className="w-full h-full flex flex-col items-center justify-center text-center p-4">
      {/* 頁首區域：遊戲標題和副標題 */}
      <header className="mb-10">
        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-red-500 to-rose-500">
          象棋麻將激鬥
        </h1>
        <p className="mt-4 text-lg md:text-xl text-slate-300">
          與 AI 對戰，體驗策略與運氣的完美結合！ (此為多人版，但標語可保留)
        </p>
      </header>

      {/* 主要內容區域：玩家名稱輸入框和進入按鈕 */}
      <main className="mb-8 w-full max-w-xs sm:max-w-sm md:max-w-md">
        {/* 玩家名稱輸入 */}
        <div className="mb-6">
          <label htmlFor="playerName" className="block text-sm font-medium text-slate-300 mb-1 text-left">
            玩家名稱
          </label>
          <input
            type="text"
            id="playerName"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)} // 輸入時更新 playerName 狀態
            className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 text-base"
            placeholder="輸入你的暱稱"
            maxLength={15} // 最大長度限制
          />
        </div>
        {/* 進入大廳按鈕 */}
        <ActionButton
          label="進入遊戲大廳"
          onClick={handleEnter}
          variant="primary" // 主要按鈕風格
          size="lg"        // 大尺寸按鈕
          // 可選圖示 (目前註解掉)
          // icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" /><path fillRule="evenodd" d="M16.72 9.97a.75.75 0 0 1 1.06 0l.97.97a.75.75 0 0 1 0 1.06l-.97.97a.75.75 0 0 1-1.06 0l-.97-.97a.75.75 0 0 1 0-1.06l.97-.97ZM15.03 8.28a.75.75 0 0 1 1.06 0l.97.97a.75.75 0 0 1 0 1.06l-.97.97a.75.75 0 0 1-1.06-1.06l.97-.97a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>}
        />
      </main>

      {/* 頁腳區域：提示訊息和版權模擬 */}
      <footer className="text-xs text-slate-500 mt-auto pb-4">
        <p>請將您的裝置橫向放置以獲得最佳遊戲體驗。</p>
        <p>&copy; {new Date().getFullYear()} 象棋麻將激鬥. All rights reserved (simulated).</p>
      </footer>
    </div>
  );
};

export default HomePage;
