import React from 'react';

export const QuantumLoader: React.FC<{ text: string }> = ({ text }) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-4">
      <div className="relative w-16 h-16">
        <div className="absolute top-0 left-0 w-full h-full border-4 border-cyan-500/30 rounded-full animate-ping"></div>
        <div className="absolute top-0 left-0 w-full h-full border-t-4 border-cyan-400 rounded-full animate-spin"></div>
        <div className="absolute inset-2 border-r-4 border-purple-500/50 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '2s' }}></div>
      </div>
      <p className="text-cyan-400 font-mono text-sm animate-pulse">{text}</p>
    </div>
  );
};
