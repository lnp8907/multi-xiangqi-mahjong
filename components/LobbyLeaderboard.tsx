import React from 'react';

// 模擬排行榜數據
const mockLeaderboardData = [
  { rank: 1, name: '棋聖小蝦米', score: 12580, gamesPlayed: 150 },
  { rank: 2, name: '麻將大俠客', score: 11920, gamesPlayed: 130 },
  { rank: 3, name: '幸運星新手', score: 10500, gamesPlayed: 90 },
  { rank: 4, name: '隔壁老王', score: 9800, gamesPlayed: 200 },
  { rank: 5, name: '路過的醬油', score: 8750, gamesPlayed: 75 },
  { rank: 6, name: '神秘高手X', score: 8500, gamesPlayed: 60 },
  { rank: 7, name: '常勝將軍', score: 8200, gamesPlayed: 110 },
  { rank: 8, name: '新手上路', score: 7900, gamesPlayed: 50 },
  { rank: 9, name: '一夜致富夢', score: 7500, gamesPlayed: 80 },
  { rank: 10, name: '牌桌小旋風', score: 7200, gamesPlayed: 95 },
    { rank: 11, name: '牌桌大聖', score: 7100, gamesPlayed: 95 },
];

const LobbyLeaderboard: React.FC = () => {
  return (
    <div className="bg-slate-700/70 p-3 sm:p-4 rounded-lg shadow-inner md:flex-grow flex flex-col max-h-80">
      <h3 className="text-xl sm:text-2xl font-semibold text-slate-200 mb-3 sm:mb-4 text-center">積分排行榜 (模擬)</h3>
      <div className="overflow-y-auto scrollbar-thin scrollbar-thumb-slate-500 scrollbar-track-slate-600/50 max-h-80 flex-grow"> {/* MODIFIED: Increased max-h-60 to max-h-96 and added flex-grow */}
        {mockLeaderboardData.length === 0 ? (
          <p className="text-slate-400 text-center py-4">暫無排行數據。</p>
        ) : (
          <table className="w-full text-slate-300">
            <thead className="text-base text-sky-300 uppercase bg-slate-600/50 sticky top-0 z-10"> {/* Added z-10 for sticky header */}
              <tr>
                <th scope="col" className="px-3 py-2 text-center">排名</th>
                <th scope="col" className="px-3 py-2">玩家名稱</th>
                <th scope="col" className="px-3 py-2 text-right">積分</th>
              </tr>
            </thead>
            <tbody>
              {mockLeaderboardData.map((player) => (
                <tr key={player.rank} className="border-b border-slate-600 hover:bg-slate-500/30">
                  <td className="px-3 py-2 text-center font-medium text-base">{player.rank}</td>
                  <td className="px-3 py-2 text-base truncate max-w-xs" title={player.name}>{player.name}</td>
                  <td className="px-3 py-2 text-right text-amber-300 text-base">{player.score.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-2 text-center flex-shrink-0"> {/* Added flex-shrink-0 */}
        註：此為模擬排行榜資料。
      </p>
    </div>
  );
};

export default LobbyLeaderboard;