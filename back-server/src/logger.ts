
import fs from 'fs'; // 引入 Node.js 檔案系統模組
import path from 'path'; // 引入 Node.js 路徑處理模組
import { DEFAULT_LOG_DIRECTORY } from './constants'; // 引入預設日誌目錄常數
import { format } from 'util'; // 引入 util.format 用於格式化訊息

// --- 配置 ---
// 從環境變數獲取日誌目錄，若未設定則使用預設值
const LOG_DIR = process.env.LOG_DIRECTORY || DEFAULT_LOG_DIRECTORY;

// --- 輔助函數 ---
/**
 * @description 獲取當前時間並格式化為 YYYYMMDDHHMMSS 字串，用於日誌檔名。
 * @returns {string} 格式化後的時間字串。
 */
const getTimestampForFilename = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0'); // 月份從0開始，所以+1
  const day = now.getDate().toString().padStart(2, '0');
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
};

/**
 * @description 獲取當前本地時間並格式化為 YYYY-MM-DD HH:MM:SS.mmm 字串，用於日誌條目時間戳。
 * @returns {string} 格式化後的本地時間字串。
 */
const getTimestampForLogEntry = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const milliseconds = now.getMilliseconds().toString().padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
};

// --- 初始化日誌 ---
let logStream: fs.WriteStream | null = null; // 日誌檔案的可寫流
const logFilename = `${getTimestampForFilename()}.log`; // 產生本次運行的日誌檔名
const logFilePath = path.join(LOG_DIR, logFilename); // 完整的日誌檔案路徑

try {
  // 1. 確保日誌目錄存在
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true }); // 遞迴創建目錄
    console.log(`[Logger] 日誌目錄已創建: ${LOG_DIR}`);
  }

  // 2. 創建可寫流到日誌檔案 (追加模式)
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  logStream.on('error', (err) => { // 監聽流的錯誤事件
    // 發生錯誤時，回退到原始 console.error
    originalConsoleError(`[Logger] 寫入日誌檔案 ${logFilePath} 時發生錯誤:`, err);
    logStream = null; // 關閉流，避免後續嘗試寫入
  });
  console.log(`[Logger] 日誌記錄已啟動。日誌檔案: ${logFilePath}`);

} catch (err) { // 捕獲創建目錄或流時的錯誤
  // 使用原始 console.error 輸出，因為此時自訂 logger 可能尚未完全初始化
  console.error(`[Logger] 初始化日誌系統失敗:`, err);
  logStream = null; // 確保 logStream 為 null，後續日誌將僅輸出到控制台
}

// --- 覆寫 console 方法 ---
// 保存原始的 console 方法，以便仍然可以輸出到標準控制台
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

/**
 * @description 格式化日誌訊息，加上時間戳和日誌級別。
 * @param {string} level - 日誌級別 (LOG, INFO, WARN, ERROR)。
 * @param {any[]} args - 傳遞給 console 方法的參數陣列。
 * @returns {string} 格式化後的日誌字串。
 */
const formatLogMessage = (level: string, args: any[]): string => {
  // 使用 util.format 將參數陣列轉換為單一字串 (類似 printf)
  const messageContent = format(...args);
  return `[${getTimestampForLogEntry()}] [${level}] ${messageContent}\n`;
};

// 覆寫 console.log
console.log = (...args: any[]) => {
  const formattedMessage = formatLogMessage('LOG', args);
  if (logStream && logStream.writable) { // 如果流存在且可寫
    logStream.write(formattedMessage); // 寫入到檔案
  }
  originalConsoleLog.apply(console, args); // 同時輸出到原始控制台
};

// 覆寫 console.info
console.info = (...args: any[]) => {
  const formattedMessage = formatLogMessage('INFO', args);
  if (logStream && logStream.writable) {
    logStream.write(formattedMessage);
  }
  originalConsoleInfo.apply(console, args);
};

// 覆寫 console.warn
console.warn = (...args: any[]) => {
  const formattedMessage = formatLogMessage('WARN', args);
  if (logStream && logStream.writable) {
    logStream.write(formattedMessage);
  }
  originalConsoleWarn.apply(console, args);
};

// 覆寫 console.error
console.error = (...args: any[]) => {
  const formattedMessage = formatLogMessage('ERROR', args);
  if (logStream && logStream.writable) {
    logStream.write(formattedMessage);
  }
  originalConsoleError.apply(console, args);
};

// --- 處理程序退出 ---
/**
 * @description 優雅關閉日誌流。
 */
const closeLogStream = () => {
  if (logStream) {
    logStream.end(() => { // 等待流完成寫入
      originalConsoleLog('[Logger] 日誌流已關閉。');
    });
    logStream = null; // 設為 null，避免重複關閉
  }
};

// 監聽程序退出事件，確保日誌流被關閉
// Fix: Cast 'process' to 'any' to allow calling 'on'
(process as any).on('exit', closeLogStream);
// 監聽 SIGINT (例如 Ctrl+C)，也嘗試關閉日誌流
// 注意：SIGINT 處理中直接退出可能導致流未完全關閉，
// server.ts 中已有的 SIGINT 處理會更優雅地關閉整個伺服器。
// 此處保留一個簡單的 closeLogStream 呼叫作為備用。
// Fix: Cast 'process' to 'any' to allow calling 'on'
(process as any).on('SIGINT', () => {
    originalConsoleLog('[Logger] 收到 SIGINT，嘗試關閉日誌流...');
    closeLogStream();
    // 允許 server.ts 中的 SIGINT 處理程序接管退出邏輯
    // process.exit(); // 不在此處直接退出
});

// 導出一個空物件或特定函數 (如果需要從外部控制 logger)
// 目前，logger 在引入時自動初始化並覆寫 console，無需顯式導出。
export {};
