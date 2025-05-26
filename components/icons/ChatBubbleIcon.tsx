
import React from 'react';

/**
 * @description ChatBubbleIcon 組件，提供一個聊天氣泡的 SVG 圖示。
 * @param {React.SVGProps<SVGSVGElement>} props - 標準 SVG 元素屬性，可包含 className, fill 等。
 * @returns {JSX.Element} SVG 圖示元素。
 */
const ChatBubbleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  // SVG 元素，設定基本屬性
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" // SVG 的可視區域
    fill="currentColor" // 填充顏色繼承自父元素或 CSS
    className="w-6 h-6"  // 預設 Tailwind CSS 大小，可被 props.className 覆蓋
    {...props} // 將傳入的其他 SVG 相關 props 展開到此元素上
  >
    {/* SVG 圖形路徑定義 - 第一個氣泡 */}
    <path 
      fillRule="evenodd" // 填充規則
      d="M4.804 21.644A6.707 6.707 0 0 0 6 21.75a6.75 6.75 0 0 0 6.75-6.75v-2.5A6.75 6.75 0 0 0 6 5.75a6.75 6.75 0 0 0-6.75 6.75v2.5A6.75 6.75 0 0 0 4.804 21.644ZM5.25 12.5c0-.414.336-.75.75-.75h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1-.75-.75Zm.75 2.25c-.414 0-.75.336-.75.75v.008c0 .414.336.75.75.75h2.25a.75.75 0 0 0 0-1.5H6Z" 
      clipRule="evenodd" // 裁剪規則
    />
    {/* SVG 圖形路徑定義 - 第二個氣泡 (部分重疊) */}
    <path 
      d="M15.25 12.25a.75.75 0 0 0 .75.75h.008a.75.75 0 0 0 .75-.75v-2.5a.75.75 0 0 0-.75-.75h-.008a.75.75 0 0 0-.75.75v2.5ZM15 5.872a8.25 8.25 0 0 1 6.632 12.443l1.874 1.873a.75.75 0 1 1-1.06 1.06l-1.873-1.873A8.25 8.25 0 0 1 15.75 19.5v-2.82a6.777 6.777 0 0 0 1.453-1.018A6.75 6.75 0 0 0 15 5.872Z" 
    />
  </svg>
);

export default ChatBubbleIcon;
