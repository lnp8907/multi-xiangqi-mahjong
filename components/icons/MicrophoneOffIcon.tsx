import React from 'react';

const MicrophoneOffIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    // className="w-5 h-5" // 預設大小由 GameBoard 控制
    {...props}
  >
    {/* Outer Circle */}
    <circle cx="12" cy="12" r="9.5" />

    {/* Microphone Capsule (Filled) */}
    <path
      d="M12 6.5C10.6193 6.5 9.5 7.61929 9.5 9V12C9.5 13.3807 10.6193 14.5 12 14.5C13.3807 14.5 14.5 13.3807 14.5 12V9C14.5 7.61929 13.3807 6.5 12 6.5Z"
      fill="currentColor"
      stroke="none"
    />

    {/* Microphone U-Bend (Stroke) */}
    <path d="M9 12.5C9 14.1569 10.3431 15.5 12 15.5C13.6569 15.5 15 14.1569 15 12.5V12" /> {/* Adjusted V12 for U shape */}
    
    {/* Microphone Stem (Stroke) */}
    <line x1="12" y1="15.5" x2="12" y2="17" />

    {/* Microphone Base (Stroke) */}
    <line x1="10" y1="17" x2="14" y2="17" />

    {/* Slash Line (Stroke) */}
    <line x1="7.5" y1="7.5" x2="16.5" y2="16.5" />
  </svg>
);

export default MicrophoneOffIcon;