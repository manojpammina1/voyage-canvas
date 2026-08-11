'use client';

import type { Port } from '@voyage/shared';

interface CaribbeanRouteMapProps {
  ports: Port[];
  sailingLabel: string;
}

export function CaribbeanRouteMap({ ports, sailingLabel }: CaribbeanRouteMapProps) {
  if (ports.length < 2) return null;

  const xs = ports.map((p) => p.canvasX);
  const ys = ports.map((p) => p.canvasY);
  const minX = Math.min(...xs) - 40;
  const maxX = Math.max(...xs) + 40;
  const minY = Math.min(...ys) - 40;
  const maxY = Math.max(...ys) + 40;
  const w = maxX - minX;
  const h = maxY - minY;

  const points = ports.map((p) => `${p.canvasX - minX},${p.canvasY - minY}`).join(' ');

  return (
    <div className="vc-route-map" role="img" aria-label={`Route map for ${sailingLabel}`}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="routeGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--primary-container)" stopOpacity="0.3" />
            <stop offset="50%" stopColor="var(--primary)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="var(--secondary-container)" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <polyline
          className="vc-route-path"
          points={points}
          stroke="url(#routeGlow)"
        />
        {ports.map((port, i) => {
          const x = port.canvasX - minX;
          const y = port.canvasY - minY;
          const active = i > 0 && i < ports.length - 1;
          return (
            <g
              key={port.id}
              className={`vc-route-port${active ? ' vc-route-port--active' : ''}`}
            >
              <circle cx={x} cy={y} r={active ? 8 : 6} />
              <text x={x} y={y - 14} textAnchor="middle">
                {port.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
