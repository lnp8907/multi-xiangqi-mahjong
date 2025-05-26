
// 引入類型定義和常數
import { TileKind } from '../types';
import { TAIWANESE_HOKKIEN_TILE_NAMES } from '../constants';

// 預設動作音效的音量 (範圍 0.0 到 1.0)
let actionSoundVolume = 0.7;

// --- 一般動作的音效定義 ---
// "打牌" 和 "摸牌" 現在有特殊處理邏輯。
const soundMap: Record<string, string> = {
  "碰": "/audio/peng.mp3",         // 碰牌音效
  "吃": "/audio/吃.mp3",           // 吃牌音效
  "槓": "/audio/槓.mp3",           // 通用槓牌音效 (明槓、暗槓、加槓)
  "明槓": "/audio/槓.mp3",         // (與通用槓相同)
  "暗槓": "/audio/槓.mp3",         // (與通用槓相同)
  "加槓": "/audio/槓.mp3",         // (與通用槓相同)
  "胡牌": "/audio/胡牌.mp3",       // 通用胡牌音效 (主要用於食胡)
  "自摸": "/audio/自摸.mp3",       // 自摸音效
  "天胡": "/audio/天胡.mp3",       // 天胡音效 (若無此檔案，會嘗試播放通用胡牌音效)
  "一炮多響": "/audio/explosion_hu.mp3", // 新增：一炮多響的音效 (路徑預留)
  // "打牌": "/audio/discard.mp3", // 不再用於通用打牌音效，改用牌面音效
  // "摸牌": "/audio/draw.mp3",   // 不再用於摸牌音效 (摸牌通常無聲)
};

// --- 特定牌面的音效定義 ---
// 假設 public/audio/ 目錄下有對應的音效檔，例如 "將.mp3", "士.mp3" 等。
const tileSoundMap: Partial<Record<TileKind, string>> = {};
// 遍歷 TAIWANESE_HOKKIEN_TILE_NAMES (牌面台語/中文名稱對照表)
for (const kind in TAIWANESE_HOKKIEN_TILE_NAMES) {
    // 確保 kind 是 TAIWANESE_HOKKIEN_TILE_NAMES 的自有屬性
    if (Object.prototype.hasOwnProperty.call(TAIWANESE_HOKKIEN_TILE_NAMES, kind)) {
        const tileName = TAIWANESE_HOKKIEN_TILE_NAMES[kind as TileKind]; // 獲取牌面名稱
        // 確保 tileName 是適合做檔名的簡單字串 (基礎檢查)
        if (tileName && typeof tileName === 'string' && tileName.length <= 3) { 
             tileSoundMap[kind as TileKind] = `/audio/${tileName}.mp3`; // 設定音效路徑
        } else {
            console.warn(`[AudioManager] 無法為牌面 ${kind} (名稱: ${tileName}) 產生音效路徑。`);
        }
    }
}


// Audio 元素的快取，避免重複創建
const audioElements: Record<string, HTMLAudioElement> = {};

/**
 * @description 預加載一個音效檔案。
 *              創建一個 Audio 元素並將其加入快取中。
 * @param {string} src - 音效檔案的路徑。
 * @returns {HTMLAudioElement} 返回創建或已快取的 Audio 元素。
 */
const preloadAudio = (src: string): HTMLAudioElement => {
  if (!audioElements[src]) { // 如果快取中不存在
    const audio = new Audio(src); // 創建新的 Audio 元素
    audio.preload = 'auto'; // 建議瀏覽器自動加載音效檔案
    // 監聽錯誤事件
    audio.addEventListener('error', (e) => {
        const error = (e.target as HTMLAudioElement).error; // 獲取錯誤物件
        console.warn(`[AudioManager] 加載音效時發生錯誤: ${src}`, error ? `錯誤碼: ${error.code}, 訊息: ${error.message}` : '未知錯誤', e);
    });
    audioElements[src] = audio; // 加入快取
  }
  return audioElements[src]; // 返回 Audio 元素
};

// 模組加載時，預加載所有定義的音效
Object.values(soundMap).forEach(path => {
  if (path) preloadAudio(path); // 預加載一般動作音效
});
Object.values(tileSoundMap).forEach(path => {
  if (path) preloadAudio(path); // 預加載牌面音效
});


/**
 * @description 播放遊戲動作音效或特定牌面的音效。
 * @param {string} actionName - 動作的中文名稱，例如："打牌"、"碰"。
 * @param {TileKind} [tileKind] - (可選) 涉及的牌的種類，主要用於 "打牌" 動作。
 */
export const playActionSound = (actionName: string, tileKind?: TileKind): void => {
  // 獲取牌面的台語/中文名稱 (如果提供了 tileKind)
  const tileNameInHokkien = tileKind ? (TAIWANESE_HOKKIEN_TILE_NAMES[tileKind] || tileKind.toString()) : '';
  // 構建控制台日誌訊息
  let consoleMessage = `[音效事件]: ${actionName}`;
  if (tileKind) {
    consoleMessage += `，牌面: ${tileNameInHokkien}`;
  }

  let soundPath: string | undefined = undefined; // 音效檔案路徑
  let playSound = true; // 是否播放音效的標記

  if (actionName === "摸牌") {
    consoleMessage += " (無音效)";
    playSound = false; // "摸牌" 動作不播放音效
  } else if (actionName === "打牌" && tileKind) {
    // 如果是 "打牌" 動作且提供了牌面，則嘗試播放特定牌面的音效
    soundPath = tileSoundMap[tileKind];
    if (!soundPath) { // 如果找不到對應的牌面音效
      consoleMessage += ` (無對應牌面音效: ${tileNameInHokkien})`;
      playSound = false; // 不播放音效
    } else {
      consoleMessage += ` (播放牌面音效: ${tileNameInHokkien}.mp3)`;
    }
  } else {
    // 其他動作，嘗試從 soundMap 中尋找音效
    soundPath = soundMap[actionName];
    if (!soundPath) { // 如果找不到對應的動作音效
      // 特殊處理：如果 "天胡" 音效未找到，則嘗試播放通用的 "胡牌" 音效
      if (actionName === "天胡" && soundMap["胡牌"]) {
          console.log(consoleMessage + " (天胡音效未找到，播放通用胡牌音效)");
          playActionSound("胡牌", tileKind); // 遞迴調用播放 "胡牌" 音效
          return; // 已處理，直接返回
      }
      consoleMessage += " (無對應動作音效)";
      playSound = false; // 不播放音效
    } else {
       consoleMessage += ` (播放動作音效: ${actionName}.mp3)`;
    }
  }
  
  console.log(consoleMessage); // 打印日誌訊息

  // 如果不需播放音效或沒有找到音效路徑，則返回
  if (!playSound || !soundPath) {
    return;
  }

  // 從快取中獲取 Audio 元素，如果不存在則預加載
  const audio = audioElements[soundPath] || preloadAudio(soundPath); 

  if (audio) {
    // 檢查 Audio 元素的狀態是否已準備好播放 (readyState >= 2 表示有當前數據)
    if (audio.readyState >= 2 && audio.currentSrc) { 
        audio.volume = actionSoundVolume; // 設定音量
        audio.currentTime = 0; // 從頭開始播放
        // 播放音效，並捕獲可能的錯誤
        audio.play().catch(error => {
          console.error(`[AudioManager] 播放音效 ${soundPath} 時發生錯誤:`, error.message, error);
        });
    } else {
        // 如果音效尚未加載完成，則手動觸發加載，並在準備好後播放
        audio.load(); 
        const playOnceReady = () => { // 準備好播放時的回調
            if (audio.volume !== actionSoundVolume) audio.volume = actionSoundVolume; // 再次確認音量
            audio.currentTime = 0;
            audio.play().catch(error => {
                console.error(`[AudioManager] 明確加載後播放音效 ${soundPath} 時發生錯誤:`, error.message, error);
            });
            // 移除事件監聽器，避免重複觸發
            audio.removeEventListener('canplaythrough', playOnceReady);
            audio.removeEventListener('error', onErrorLoading);
        };
        const onErrorLoading = (e: Event) => { // 加載錯誤時的回調
            const error = (e.target as HTMLAudioElement).error;
            console.error(`[AudioManager] 明確加載 ${soundPath} 時發生錯誤:`, error ? `錯誤碼: ${error.code}, 訊息: ${error.message}` : '未知錯誤', e);
            audio.removeEventListener('canplaythrough', playOnceReady);
            audio.removeEventListener('error', onErrorLoading);
        };
        // 添加事件監聽器
        audio.addEventListener('canplaythrough', playOnceReady); // 'canplaythrough' 事件表示可以無緩衝播放完畢
        audio.addEventListener('error', onErrorLoading);
    }
  }
};

/**
 * @description 設定所有動作音效的音量。
 * @param {number} volume - 音量值，範圍 0.0 (靜音) 到 1.0 (最大音量)。
 */
export const setActionSoundVolume = (volume: number): void => {
  actionSoundVolume = Math.max(0, Math.min(1, volume)); // 將音量限制在 0 到 1 之間
  console.log(`[AudioManager] 動作音效音量已設定為: ${actionSoundVolume * 100}%`);
};

/**
 * @description 獲取當前動作音效的音量。
 * @returns {number} 返回當前的音量值 (0.0 到 1.0)。
 */
export const getActionSoundVolume = (): number => {
  return actionSoundVolume;
};
