import React from "react";

interface BarChartProps {
  data: {
    name: string;
    value: number;
    color: string;
  }[];
  width?: number;
  height?: number;
  maxBarWidth?: number;
}

const AnalyticsBarChart: React.FC<BarChartProps> = ({
  data,
  width = 500,
  height = 300,
  maxBarWidth = 60,
}) => {
  // Constants for chart dimensions
  const margin = { top: 20, right: 30, bottom: 50, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  
  // Find max value for scaling
  const maxValue = Math.max(...data.map(item => item.value), 0);
  
  // If no data or all values are 0
  if (data.length === 0 || maxValue === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Нет данных для отображения
      </div>
    );
  }
  
  // Calculate bar width based on available space
  const barWidth = Math.min(maxBarWidth, chartWidth / data.length - 10);
  
  // Generate bars
  const bars = data.map((item, index) => {
    const barHeight = (item.value / maxValue) * chartHeight;
    const x = margin.left + (chartWidth / data.length) * index + (chartWidth / data.length - barWidth) / 2;
    const y = margin.top + chartHeight - barHeight;
    
    return {
      x,
      y,
      width: barWidth,
      height: barHeight,
      color: item.color,
      name: item.name,
      value: item.value,
    };
  });
  
  // Generate Y-axis ticks (5 ticks)
  const yTicks = Array.from({ length: 6 }, (_, i) => {
    const value = maxValue * (i / 5);
    const y = margin.top + chartHeight - (value / maxValue) * chartHeight;
    return { value, y };
  });
  
  return (
    <div className="relative">
      <svg width={width} height={height}>
        {/* X-axis */}
        <line
          x1={margin.left}
          y1={margin.top + chartHeight}
          x2={margin.left + chartWidth}
          y2={margin.top + chartHeight}
          stroke="#ccc"
          strokeWidth="1"
        />
        
        {/* Y-axis */}
        <line
          x1={margin.left}
          y1={margin.top}
          x2={margin.left}
          y2={margin.top + chartHeight}
          stroke="#ccc"
          strokeWidth="1"
        />
        
        {/* Horizontal grid lines */}
        {yTicks.map((tick, i) => (
          <React.Fragment key={`grid-${i}`}>
            <line
              x1={margin.left}
              y1={tick.y}
              x2={margin.left + chartWidth}
              y2={tick.y}
              stroke="#eee"
              strokeWidth="1"
              strokeDasharray="5,5"
            />
            <text
              x={margin.left - 10}
              y={tick.y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="12"
              fill="#888"
            >
              {Math.round(tick.value)}
            </text>
          </React.Fragment>
        ))}
        
        {/* Bars */}
        {bars.map((bar, index) => (
          <g key={`bar-${index}`}>
            <rect
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              fill={bar.color}
              rx="2"
              ry="2"
            />
            <text
              x={bar.x + bar.width / 2}
              y={bar.y - 5}
              textAnchor="middle"
              fontSize="12"
              fill="#888"
            >
              {bar.value}
            </text>
            <text
              x={bar.x + bar.width / 2}
              y={margin.top + chartHeight + 20}
              textAnchor="middle"
              fontSize="12"
              fill="#888"
              style={{ maxWidth: bar.width }}
            >
              {bar.name}
            </text>
          </g>
        ))}
      </svg>
      
      {/* Legend */}
      <div className="flex flex-wrap gap-4 justify-center mt-4">
        {data.map((item, index) => (
          <div key={`legend-${index}`} className="flex items-center">
            <div
              className="w-3 h-3 mr-1"
              style={{ backgroundColor: item.color }}
            ></div>
            <span className="text-xs">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AnalyticsBarChart;