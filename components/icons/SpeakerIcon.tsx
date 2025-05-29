
import React from 'react';

const SpeakerIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className="w-5 h-5" // 預設大小，可由 props.className 覆蓋
    {...props}
  >
    <path d="M10.75 2.75a.75.75 0 00-1.5 0v14.5a.75.75 0 001.5 0V2.75z" />
    <path d="M3.75 8.75a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z" />
    <path d="M16.25 6.75a.75.75 0 00-1.5 0v6.5a.75.75 0 001.5 0v-6.5z" />
    <path d="M13.75 4.75a.75.75 0 00-1.5 0v10.5a.75.75 0 001.5 0V4.75z" />
    <path d="M6.25 6.75a.75.75 0 00-1.5 0v6.5a.75.75 0 001.5 0v-6.5z" />
  </svg>
);

export default SpeakerIcon;
