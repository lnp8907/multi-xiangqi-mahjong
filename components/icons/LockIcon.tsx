
import React from 'react';

/**
 * @description LockIcon 組件，提供一個鎖頭的 SVG 圖示。
 * @param {React.SVGProps<SVGSVGElement>} props - 標準 SVG 元素屬性，可包含 className, fill 等。
 * @returns {JSX.Element} SVG 圖示元素。
 */
const LockIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  // SVG 元素，設定基本屬性
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 20 20" // SVG 的可視區域
    fill="currentColor" // 填充顏色繼承自父元素或 CSS
    className="w-5 h-5"  // 預設 Tailwind CSS 大小，可被 props.className 覆蓋
    {...props} // 將傳入的其他 SVG 相關 props 展開到此元素上
  >
    {/* SVG 圖形路徑定義 - 鎖頭的形狀 */}
    <path 
      fillRule="evenodd" // 填充規則
      d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" 
      clipRule="evenodd" // 裁剪規則
    />
  </svg>
);

export default LockIcon;
