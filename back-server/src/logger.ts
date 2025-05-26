
import fs from 'fs'; // 引入 Node.js 檔案系統模組
import path from 'path'; // 引入 Node.js 路徑處理模組
import { DEFAULT_LOG_DIRECTORY, LOG_LEVEL_NAMES, DEFAULT_LOG_LEVEL, LogLevel } from './constants'; // 引入相關常數
import { format } from 'util'; // 引入 util.format 用於格式化訊息

// --- 配置 ---
// 從環境變數獲取日誌目錄，若未設定則使用預設值
const LOG_DIR = process.env.LOG_DIRECTORY || DEFAULT_LOG_DIRECTORY;
// 從環境變數獲取日誌級別字串，並轉換為 LogLevel 枚舉值，若無效或未設定則使用預設級別
const configuredLogLevelName = process.env.LOG_LEVEL?.toUpperCase() || '';
const configuredLogLevel: LogLevel = LOG_LEVEL_NAMES[configuredLogLevelName] !== undefined
                                     ? LOG_LEVEL_NAMES[configuredLogLevelName]
                                     : DEFAULT_LOG_LEVEL;

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

// 保存原始的 console 方法，以便在 logger 初始化失敗時或內部使用
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

try {
  // 1. 確保日誌目錄存在
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true }); // 遞迴創建目錄
    originalConsoleLog(`[Logger] 日誌目錄已創建: ${LOG_DIR}`);
  }

  // 2. 創建可寫流到日誌檔案 (追加模式)
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  logStream.on('error', (err) => { // 監聽流的錯誤事件
    originalConsoleError(`[Logger] 寫入日誌檔案 ${logFilePath} 時發生錯誤:`, err);
    logStream = null; // 關閉流，避免後續嘗試寫入
  });
  originalConsoleLog(`[Logger] 日誌記錄已啟動。設定日誌級別: ${LogLevel[configuredLogLevel]}。日誌檔案: ${logFilePath}`);

} catch (err) { // 捕獲創建目錄或流時的錯誤
  originalConsoleError(`[Logger] 初始化日誌系統失敗:`, err);
  logStream = null; // 確保 logStream 為 null，後續日誌將僅輸出到控制台
}

// --- 格式化與寫入函數 ---
/**
 * @description 格式化日誌訊息，加上時間戳和日誌級別。
 * @param {LogLevel} level - 日誌的級別。
 * @param {any[]} args - 傳遞給 console 方法的參數陣列。
 * @returns {string} 格式化後的日誌字串。
 */
const formatLogMessage = (level: LogLevel, args: any[]): string => {
  const messageContent = format(...args); // 使用 util.format 將參數陣列轉換為單一字串
  return `[${getTimestampForLogEntry()}] [${LogLevel[level].padEnd(5)}] ${messageContent}\n`;
};

/**
 * @description 處理日誌輸出的核心邏輯。
 * @param {LogLevel} level - 該條日誌的級別。
 * @param {Function} originalConsoleMethod - 對應的原始 console 方法 (例如 originalConsoleLog)。
 * @param {any[]} args - 日誌內容參數。
 */
const handleLogOutput = (level: LogLevel, originalConsoleMethod: Function, args: any[]) => {
  // 只有當該日誌的級別高於或等於設定的輸出級別時，才進行處理
  if (level <= configuredLogLevel) {
    const formattedMessage = formatLogMessage(level, args);
    if (logStream && logStream.writable) { // 如果檔案流存在且可寫
      logStream.write(formattedMessage); // 寫入到檔案
    }
  }
  // 原始 console 方法的調用也應受日誌級別控制 (避免控制台過多輸出)
  if (level <= configuredLogLevel) {
    originalConsoleMethod.apply(console, args); // 同時輸出到原始控制台
  }
};


// --- 覆寫 console 方法 ---
console.error = (...args: any[]) => {
  handleLogOutput(LogLevel.ERROR, originalConsoleError, args);
};

console.warn = (...args: any[]) => {
  handleLogOutput(LogLevel.WARN, originalConsoleWarn, args);
};

console.info = (...args: any[]) => {
  handleLogOutput(LogLevel.INFO, originalConsoleInfo, args);
};

// console.log 通常被視為一般資訊或除錯資訊，此處將其對應到 INFO 級別
// 如果需要更細緻的 DEBUG 輸出，應使用 console.debug
console.log = (...args: any[]) => {
  handleLogOutput(LogLevel.INFO, originalConsoleLog, args);
};

// 新增 console.debug 方法
// 需要在使用前擴展 Console 接口 (在 .d.ts 檔案或此處)
declare global {
  interface Console {
    debug(...data: any[]): void;
  }
}
console.debug = (...args: any[]) => {
  handleLogOutput(LogLevel.DEBUG, originalConsoleLog, args); // DEBUG 級別也使用 originalConsoleLog 輸出到控制台
};


// --- 處理程序退出 ---
/**
 * @description 優雅關閉日誌流。
 */
const closeLogStream = () => {
  if (logStream) {
    const closingMessage = `[${getTimestampForLogEntry()}] [INFO ] [Logger] 伺服器關閉，日誌流結束。\n`;
    if (logStream.writable) {
        logStream.write(closingMessage);
    }
    logStream.end(() => {
      originalConsoleLog('[Logger] 日誌流已成功關閉。');
    });
    logStream = null; // 設為 null，避免重複關閉
  } else {
    originalConsoleLog('[Logger] 日誌流在嘗試關閉時已為 null。');
  }
};

// 監聽程序退出事件，確保日誌流被關閉
// Fix: Explicitly cast `process` to `NodeJS.Process` to ensure the `.on` method is recognized by the type checker.
(process as NodeJS.Process).on('exit', () => {
  originalConsoleLog('[Logger] 偵測到 \'exit\' 事件，準備關閉日誌流...');
  closeLogStream();
});

// 監聽 SIGINT (例如 Ctrl+C)，也嘗試關閉日誌流
// Fix: Explicitly cast `process` to `NodeJS.Process` to ensure the `.on` method is recognized by the type checker.
(process as NodeJS.Process).on('SIGINT', () => {
    originalConsoleLog('[Logger] 收到 SIGINT，嘗試關閉日誌流...');
    closeLogStream();
    // 允許 server.ts 中的 SIGINT 處理程序接管實際的程序退出
});

export {};
