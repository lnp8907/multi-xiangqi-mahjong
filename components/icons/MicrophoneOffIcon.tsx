
import React from 'react';

const MicrophoneOffIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className="w-5 h-5" // 預設大小
    {...props}
  >
    <path d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4z" />
    <path
      fillRule="evenodd"
      d="M5.5 8.5A.5.5 0 016 8h4a.5.5 0 010 1H6a.5.5 0 01-.5-.5z"
      clipRule="evenodd"
    />
    <path
      fillRule="evenodd"
      d="M10 3a1 1 0 00-1 1v4a1 1 0 102 0V4a1 1 0 00-1-1zM3 8a.5.5 0 000 1h1.536A4.002 4.002 0 0110 12.5c0 1.431-.764 2.688-1.904 3.385C7.096 16.418 7 16.965 7 17.5V17a.5.5 0 001 0v.106A5.002 5.002 0 0015 12.5c0-2.123-1.308-3.935-3.174-4.638A3.5 3.5 0 0010 3.5 3.5 3.5 0 006.5 8H3z"
      clipRule="evenodd"
    />
    {/* Diagonal line for "off" state */}
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      d="M5 15L15 5"
      stroke="currentColor" // 線條顏色與填充顏色一致
    />
  </svg>
);

export default MicrophoneOffIcon;
