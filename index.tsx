
// 引入 React 函式庫，用於建構使用者介面
import React from 'react';
// 引入 ReactDOM，用於將 React 組件渲染到 DOM 中
import ReactDOM from 'react-dom/client';
// 引入主要的應用程式組件 App
import App from './App';

// 獲取 HTML 中的根元素，React 應用將會掛載到此元素上
const rootElement = document.getElementById('root');
// 如果找不到根元素，拋出錯誤，因為應用無法掛載
if (!rootElement) {
  throw new Error("找不到根元素 (root element)，無法掛載 React 應用。");
}

// 使用獲取到的根元素創建一個 React 根容器
const root = ReactDOM.createRoot(rootElement);
// 將 App 組件渲染到根容器中
// React.StrictMode 用於在開發模式下檢查潛在問題
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
