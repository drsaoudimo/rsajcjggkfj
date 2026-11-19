
import React, { useState } from 'react';
import { MatrixMath } from '../utils/matrixMath';

interface MatrixVisualizerProps {
  data: number[][];
  title: string;
  color?: string;
}

export const MatrixVisualizer: React.FC<MatrixVisualizerProps> = ({ data, title, color = "bg-blue-500" }) => {
  const [isTransposed, setIsTransposed] = useState(false);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);

  const displayData = isTransposed ? MatrixMath.transpose(data) : data;
  const rows = displayData.length;
  const cols = displayData[0]?.length || 0;

  const flat = data.flat();
  const max = Math.max(...flat, 1e-6);
  const min = Math.min(...flat);

  const handleCellClick = (i: number, j: number) => {
    if (selectedRow === i && selectedCol === j) {
        setSelectedRow(null);
        setSelectedCol(null);
    } else {
        setSelectedRow(i);
        setSelectedCol(j);
    }
  };

  /**
   * Heatmap Color Function
   * Returns a background style based on normalized value intensity.
   */
  const getHeatmapColor = (val: number) => {
    const normalized = (val - min) / (max - min || 1);
    // Gradient: Slate -> Cyan/Indigo/Red
    const r = Math.floor(normalized * 150 + 20);
    const g = Math.floor(normalized * 220 + 30);
    const b = Math.floor(normalized * 255 + 50);
    const a = 0.3 + normalized * 0.7;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };

  return (
    <div className="flex flex-col gap-2 p-4 border border-gray-800 rounded-lg bg-black/40 backdrop-blur-md transition-all">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest" dir="ltr">
          {title} <span className="text-gray-600">[{isTransposed ? `${cols}x${rows}` : `${rows}x${cols}`}]</span>
        </h3>
        <div className="flex gap-2">
            <button 
            onClick={() => { setSelectedRow(null); setSelectedCol(null); }}
            className="text-[10px] px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-400 transition-colors"
            >
            Reset
            </button>
            <button 
            onClick={() => setIsTransposed(!isTransposed)}
            className="text-[10px] px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-cyan-500 transition-colors"
            >
            {isTransposed ? 'Original' : 'Transpose'}
            </button>
        </div>
      </div>
      
      <div 
        className="grid gap-px bg-gray-900 overflow-hidden rounded-md border border-slate-800"
        style={{ 
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`
        }}
        dir="ltr"
        onMouseLeave={() => { setHoverRow(null); setHoverCol(null); }}
      >
        {displayData.map((row, i) => (
          row.map((val, j) => {
            const isSelectedCell = selectedRow === i && selectedCol === j;
            const isSelectedRowCol = selectedRow === i || selectedCol === j;
            const isHovered = hoverRow === i || hoverCol === j;
            const isActive = (selectedRow !== null) ? isSelectedRowCol : isHovered;

            return (
              <div 
                key={`${i}-${j}`}
                onMouseEnter={() => { setHoverRow(i); setHoverCol(j); }}
                onClick={() => handleCellClick(i, j)}
                className={`h-4 w-full transition-all duration-300 relative group cursor-crosshair`}
                style={{ 
                  backgroundColor: isActive ? 'rgba(255,255,255,0.1)' : undefined,
                  border: isSelectedCell ? '1px solid #fff' : undefined,
                  zIndex: isSelectedCell ? 10 : 0
                }}
              >
                {/* Heatmap Layer */}
                <div 
                  className="absolute inset-0" 
                  style={{ backgroundColor: getHeatmapColor(val) }} 
                />
                
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none z-10 whitespace-nowrap border border-slate-700 font-mono shadow-xl">
                  {val.toFixed(2)} <span className="text-slate-500">[{i},{j}]</span>
                </div>
              </div>
            );
          })
        ))}
      </div>
      
      {/* Legend */}
      <div className="flex justify-between text-[9px] text-gray-600 px-1 mt-1 font-mono uppercase">
        <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: getHeatmapColor(min) }} />
            <span>MIN: {min.toFixed(1)}</span>
        </div>
        <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: getHeatmapColor(max) }} />
            <span>MAX: {max.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
};
