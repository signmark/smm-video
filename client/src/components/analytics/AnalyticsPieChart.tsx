import React from "react";

interface PieChartProps {
  data: {
    name: string;
    value: number;
    color: string;
  }[];
  width?: number;
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
}

const AnalyticsPieChart: React.FC<PieChartProps> = ({
  data,
  width = 300,
  height = 300,
  innerRadius = 0,
  outerRadius = 100,
}) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const total = data.reduce((sum, entry) => sum + entry.value, 0);

  // Calculate slices
  const slices = [];
  let startAngle = 0;
  
  for (const entry of data) {
    if (entry.value <= 0) continue;
    
    const percentage = entry.value / total;
    const angle = percentage * 360;
    const endAngle = startAngle + angle;
    
    // Convert to radians
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    
    // Calculate path
    const x1 = centerX + outerRadius * Math.sin(startRad);
    const y1 = centerY - outerRadius * Math.cos(startRad);
    const x2 = centerX + outerRadius * Math.sin(endRad);
    const y2 = centerY - outerRadius * Math.cos(endRad);
    
    // Determine if the slice is large (more than 180 degrees)
    const largeArcFlag = angle > 180 ? 1 : 0;
    
    // Create path
    const path = [
      `M ${centerX} ${centerY}`,
      `L ${x1} ${y1}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
      'Z'
    ].join(' ');
    
    slices.push({
      path,
      color: entry.color,
      name: entry.name,
      value: entry.value,
      percentage: percentage * 100,
      startAngle,
      endAngle,
    });
    
    startAngle = endAngle;
  }

  // Generate labels with lines
  const labels = slices.map((slice) => {
    const midAngle = (slice.startAngle + slice.endAngle) / 2;
    const midRad = (midAngle * Math.PI) / 180;
    
    // Position for label (a bit outside the pie)
    const labelRadius = outerRadius * 1.2;
    const labelX = centerX + labelRadius * Math.sin(midRad);
    const labelY = centerY - labelRadius * Math.cos(midRad);
    
    // Line from pie to label
    const lineEndRadius = outerRadius * 1.1;
    const lineEndX = centerX + lineEndRadius * Math.sin(midRad);
    const lineEndY = centerY - lineEndRadius * Math.cos(midRad);
    
    return {
      x: labelX,
      y: labelY,
      textAnchor: labelX > centerX ? "start" : "end",
      line: {
        x1: centerX + outerRadius * Math.sin(midRad),
        y1: centerY - outerRadius * Math.cos(midRad),
        x2: lineEndX,
        y2: lineEndY,
      },
      text: `${slice.name} (${slice.percentage.toFixed(0)}%)`,
      color: slice.color,
    };
  });

  // Generate legend items
  const legendItems = data.map((entry, index) => ({
    name: entry.name,
    color: entry.color,
    value: entry.value,
    percentage: (entry.value / total) * 100,
  }));

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Нет данных для отображения
      </div>
    );
  }

  return (
    <div className="relative">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Pie slices */}
        {slices.map((slice, index) => (
          <path
            key={`slice-${index}`}
            d={slice.path}
            fill={slice.color}
            stroke="white"
            strokeWidth="1"
          />
        ))}
        
        {/* Lines to labels */}
        {labels.map((label, index) => (
          <line
            key={`line-${index}`}
            x1={label.line.x1}
            y1={label.line.y1}
            x2={label.line.x2}
            y2={label.line.y2}
            stroke={label.color}
            strokeWidth="1"
          />
        ))}
        
        {/* Labels */}
        {labels.map((label, index) => (
          <text
            key={`label-${index}`}
            x={label.x}
            y={label.y}
            textAnchor={label.textAnchor}
            dominantBaseline="middle"
            fontSize="12"
            fill={label.color}
          >
            {label.text}
          </text>
        ))}
      </svg>
      
      {/* Legend */}
      <div className="flex flex-wrap gap-4 justify-center mt-4">
        {legendItems.map((item, index) => (
          <div key={`legend-${index}`} className="flex items-center">
            <div
              className="w-3 h-3 mr-1"
              style={{ backgroundColor: item.color }}
            ></div>
            <span className="text-xs">{item.name}: {Math.round(item.percentage)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AnalyticsPieChart;