

import React, { useEffect, useState } from 'react';

export interface ActionAnnouncement {
  id: number;
  text: string;
  playerId: number; // 用於定位，但目前直接使用 position
  position: 'top' | 'bottom' | 'left' | 'right'; // 特效顯示的相對位置
  isMultiHuTarget?: boolean; // 新增：是否為「一炮多響」的目標
}

interface ActionAnnouncerProps {
  announcement: ActionAnnouncement;
}

const ActionAnnouncer: React.FC<ActionAnnouncerProps> = ({ announcement }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    const duration = (announcement.isMultiHuTarget && (announcement.text === "胡" || announcement.text === "自摸" || announcement.text === "天胡")) ? 3000 : 2000;
    const timer = setTimeout(() => {
      setIsVisible(false);
    }, duration); 
    return () => clearTimeout(timer);
  }, [announcement.id, announcement.isMultiHuTarget, announcement.text]); 

  if (!isVisible) return null;

  // 定位邏輯
  let positionClasses = '';
  let textRotationClass = '';
  switch (announcement.position) {
    case 'bottom':
      positionClasses = 'bottom-[20%] left-1/2 -translate-x-1/2';
      break;
    case 'top':
      positionClasses = 'top-[20%] left-1/2 -translate-x-1/2';
      textRotationClass = 'rotate-180'; 
      break;
    case 'left':
      positionClasses = 'top-1/2 -translate-y-1/2 left-[15%]';
      textRotationClass = 'rotate-90';
      break;
    case 'right':
      positionClasses = 'top-1/2 -translate-y-1/2 right-[15%]';
      textRotationClass = '-rotate-90';
      break;
  }
  
  let textColor = 'text-yellow-300'; 
  let textShadow = 'shadow-[0_0_10px_rgba(253,224,71,0.8)]'; 
  let animationName = 'animate-action-bounce-fade';
  let animationDuration = '2s';

  const isHuAction = ['胡', '自摸', '天胡'].includes(announcement.text);

  if (isHuAction) {
    if (announcement.isMultiHuTarget) {
      textColor = 'text-red-500'; // 更鮮豔的紅色
      textShadow = 'shadow-[0_0_25px_rgba(255,0,0,1),_0_0_15px_rgba(255,100,100,0.8)]'; // 強烈紅色爆炸輝光
      animationName = 'animate-action-explode-fade'; 
      animationDuration = '3s';
    } else {
      textColor = 'text-red-400';
      textShadow = 'shadow-[0_0_15px_rgba(248,113,113,0.9)]'; 
      animationName = 'animate-action-pulse-fade'; 
      animationDuration = '2.5s';
    }
  } else if (['槓', '明槓', '暗槓', '加槓'].includes(announcement.text)) {
    textColor = 'text-orange-400';
    textShadow = 'shadow-[0_0_10px_rgba(251,146,60,0.8)]'; 
  } else if (announcement.text === '碰') {
    textColor = 'text-sky-400';
    textShadow = 'shadow-[0_0_10px_rgba(56,189,248,0.8)]'; 
  } else if (announcement.text === '吃') {
    textColor = 'text-green-400';
    textShadow = 'shadow-[0_0_10px_rgba(74,222,128,0.8)]'; 
  }


  return (
    <div 
        className={`absolute ${positionClasses} z-[60] transform transition-all duration-500 pointer-events-none`}
    >
      <span 
        className={`text-5xl sm:text-6xl md:text-7xl font-black ${textColor} ${textShadow} ${textRotationClass} ${animationName} inline-block`}
        style={{
            WebkitTextStroke: '1.5px black', 
            paintOrder: 'stroke fill',
            animationDuration: animationDuration, 
        }}
      >
        {announcement.text}!
      </span>
      <style>
        {`
        @keyframes action-bounce-fade {
          0% { transform: scale(0.5) translateY(20px); opacity: 0; }
          20% { transform: scale(1.2) translateY(-10px); opacity: 1; }
          40% { transform: scale(0.9) translateY(5px); opacity: 1; }
          60% { transform: scale(1.1) translateY(-5px); opacity: 1; }
          80% { transform: scale(1.0) translateY(0); opacity: 1; }
          100% { transform: scale(0.8) translateY(10px); opacity: 0; }
        }
        @keyframes action-pulse-fade {
          0%, 100% { opacity: 0; transform: scale(0.8); }
          10%, 90% { opacity: 1; transform: scale(1); }
          20% { transform: scale(1.3); }
          30% { transform: scale(1); }
          40% { transform: scale(1.2); }
          50%, 80% { opacity: 1; transform: scale(1); }
        }
        @keyframes action-explode-fade {
          0% { transform: scale(0.3) rotate(-15deg); opacity: 0; }
          15% { transform: scale(1.5) rotate(10deg); opacity: 1; text-shadow: 0 0 30px rgba(255,50,50,1), 0 0 20px rgba(255,150,150,0.9); }
          30% { transform: scale(1.0) rotate(-5deg); opacity: 1; }
          45% { transform: scale(1.3) rotate(5deg); opacity: 1; text-shadow: 0 0 25px rgba(255,0,0,1), 0 0 15px rgba(255,100,100,0.8); }
          60% { transform: scale(0.9) rotate(0deg); opacity: 1; }
          80% { transform: scale(1.1); opacity: 1;}
          100% { transform: scale(0.5) rotate(15deg); opacity: 0; }
        }
        .animate-action-bounce-fade {
          animation: action-bounce-fade 2s ease-in-out forwards;
        }
        .animate-action-pulse-fade {
          animation: action-pulse-fade 2.5s cubic-bezier(0.68, -0.55, 0.27, 1.55) forwards;
        }
        .animate-action-explode-fade {
          animation: action-explode-fade 3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}
      </style>
    </div>
  );
};

export default ActionAnnouncer;