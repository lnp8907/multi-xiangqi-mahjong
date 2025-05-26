import React from 'react';

interface ProgressBarProps {
  currentTime: number;
  maxTime: number;
  className?: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ currentTime, maxTime, className = '' }) => {
  const percentage = maxTime > 0 ? (currentTime / maxTime) * 100 : 0;
  
  let barColorClass = 'bg-green-500'; // 預設綠色
  if (percentage <= 25) {
    barColorClass = 'bg-red-500 animate-pulse'; // 剩餘時間少於等於25%時變為紅色並脈衝
  } else if (percentage <= 50) {
    barColorClass = 'bg-yellow-500'; // 剩餘時間少於等於50%時變為黃色
  }

  return (
    <div className={`w-full bg-slate-600 rounded-full h-2.5 overflow-hidden ${className}`}>
      <div
        className={`h-2.5 rounded-full transition-all duration-300 ease-linear ${barColorClass}`}
        style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }}
        role="progressbar"
        aria-valuenow={currentTime}
        aria-valuemin={0}
        aria-valuemax={maxTime}
        aria-label="時間進度條"
      ></div>
    </div>
  );
};

export default ProgressBar;