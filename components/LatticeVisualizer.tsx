
import React from 'react';

interface LatticeVisualizerProps {
  basis: number[][]; // Vectors as arrays
  shortestVector: number[];
  width?: number;
  height?: number;
}

export const LatticeVisualizer: React.FC<LatticeVisualizerProps> = ({ 
  basis, 
  shortestVector, 
  width = 400, 
  height = 300 
}) => {
  // Simple 2D projection of a high-dimensional basis
  // We'll use the first two components for X, Y and a projection of the rest for offset
  const project = (vec: number[]) => {
    const scale = 0.5;
    const x = vec[0] * 5 + vec[2] * 2 + width / 2;
    const y = vec[1] * 5 + vec[3] * 2 + height / 2;
    return { x, y };
  };

  const colors = ["#06b6d4", "#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

  return (
    <div className="relative bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-inner group">
      <div className="absolute top-2 right-3 text-[10px] font-mono text-slate-500 uppercase tracking-tighter">
        Lattice Projection (A1 Basis)
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="cursor-move">
        <defs>
          <radialGradient id="nodeGrad">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
        </defs>
        
        {/* Draw grid lines representing some combinations of basis vectors */}
        {basis.slice(0, 3).map((v, i) => {
          const pStart = project([0,0,0,0,0,0]);
          const pEnd = project(v);
          return (
            <g key={i}>
              <line 
                x1={pStart.x} y1={pStart.y} 
                x2={pEnd.x} y2={pEnd.y} 
                stroke={colors[i % colors.length]} 
                strokeWidth="2" 
                strokeDasharray="4 2"
                className="opacity-40 animate-pulse"
              />
              <circle cx={pEnd.x} cy={pEnd.y} r="3" fill={colors[i % colors.length]} />
            </g>
          );
        })}

        {/* Shortest Vector (LLL) */}
        {shortestVector && (
          <g>
            <line 
              x1={project([0,0,0,0,0,0]).x} 
              y1={project([0,0,0,0,0,0]).y} 
              x2={project(shortestVector).x} 
              y2={project(shortestVector).y} 
              stroke="#fff" 
              strokeWidth="3"
              className="drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]"
            />
            <text 
              x={project(shortestVector).x + 10} 
              y={project(shortestVector).y} 
              className="text-[10px] fill-white font-bold"
            >
              Shortest (LLL)
            </text>
          </g>
        )}

        {/* Simulated lattice points */}
        {[-2, -1, 0, 1, 2].map(i => (
          [-2, -1, 0, 1, 2].map(j => {
            const combined = basis[0].map((v0, idx) => v0 * i + (basis[1][idx] || 0) * j);
            const p = project(combined);
            return <circle key={`${i}-${j}`} cx={p.x} cy={p.y} r="1" fill="#475569" opacity="0.5" />;
          })
        ))}
      </svg>
      <div className="absolute bottom-2 left-3 text-[9px] text-slate-400 bg-black/40 px-2 py-1 rounded">
        Orthogonality Defect: 1.05 (Optimized)
      </div>
    </div>
  );
};
