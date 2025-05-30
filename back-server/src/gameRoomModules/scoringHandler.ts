// 引入類型和常數
import { GameRoom } from '../GameRoom';
import { Player } from '../types'; // Player 類型可能需要

/**
 * @description 計算並應用本局結束時的玩家分數。
 * @param {GameRoom} room - GameRoom 實例。
 */
export const calculateAndApplyScores = (room: GameRoom): void => {
    // 如果有贏家
    if (room.gameState.winnerId !== null) {
        const winner = room.players.find(p => p.id === room.gameState.winnerId);
        if (winner) {
            let baseScore = 100; // 基礎得分

            // 自摸得分加倍 (可調整規則)
            if (room.gameState.winType === 'selfDrawn') {
                baseScore *= 6;
            }
            
            // TODO: 根據番種、牌型等計算額外分數
            // 例如：清一色、對對胡、大三元等，都會增加 baseScore
            // let fanValue = calculateFan(winner.hand, winner.melds, room.gameState.winType, room.gameState.winningDiscardedTile || room.gameState.lastDrawnTile);
            // baseScore += fanValue;

            winner.score += baseScore; // 為贏家加分
            room.addLog(`${winner.name} 本局獲勝，得分 ${baseScore}。總分: ${winner.score}`);

            // 如果是食胡，則放槍者扣分
            if (room.gameState.winType === 'discard' && room.gameState.winningTileDiscarderId !== null) {
                const discarder = room.players.find(p => p.id === room.gameState.winningTileDiscarderId);
                if (discarder) {
                    // 扣除與贏家得分相同的分數 (可調整規則，例如包賠)
                    discarder.score -= baseScore; 
                    room.addLog(`${discarder.name} 放槍，扣分 ${baseScore}。總分: ${discarder.score}`);
                }
            } 
            // 如果是自摸，則其他三家各扣除一定分數 (例如：baseScore / 3 或固定值)
            else if (room.gameState.winType === 'selfDrawn') {
                const scoreToDeduct = Math.ceil(baseScore / (room.players.length -1)); // 平均分配給其他玩家
                room.players.forEach(player => {
                    if (player.id !== winner.id) {
                        player.score -= scoreToDeduct;
                        room.addLog(`${player.name} 因 ${winner.name} 自摸，扣分 ${scoreToDeduct}。總分: ${player.score}`);
                    }
                });
            }
        }
    } else if (room.gameState.isDrawGame) {
        // 流局，無人得分變動 (可添加荒牌罰點等規則)
        room.addLog("本局流局，無人得分變動。");
    }
    // 注意：此處 room.updateGameStatePlayers() 和 room.broadcastGameState()
    // 應在調用此函數的 handleRoundEndFlow 中執行，以確保狀態同步。
};

// --- 預留的番種計算函數 (目前為空實作) ---
/**
 * @description (預留) 計算玩家胡牌的番數或額外得分。
 * @param {Tile[]} hand - 玩家的手牌 (可能包含胡的牌)。
 * @param {Meld[]} melds - 玩家已宣告的面子。
 * @param {'selfDrawn' | 'discard' | null} winType - 胡牌類型。
 * @param {Tile | null} winningTile - 胡的那張牌。
 * @returns {number} 番數或額外分數。
 */
// const calculateFan = (
//     hand: Tile[], 
//     melds: Meld[], 
//     winType: 'selfDrawn' | 'discard' | null, 
//     winningTile: Tile | null
// ): number => {
//     let fanScore = 0;
//     // TODO: 實現番種計算邏輯
//     // 例如：
//     // if (isQingYiSe(hand, melds)) fanScore += 50;
//     // if (isPengPengHu(hand, melds)) fanScore += 30;
//     // ...
//     return fanScore;
// };

// 預留的牌型判斷輔助函數
// const isQingYiSe = (hand: Tile[], melds: Meld[]): boolean => { /* ... */ return false; };
// const isPengPengHu = (hand: Tile[], melds: Meld[]): boolean => { /* ... */ return false; };
