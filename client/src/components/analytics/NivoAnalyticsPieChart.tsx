import { ResponsivePie } from '@nivo/pie';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

interface PieChartProps {
  data: { id: string; label: string; value: number; color?: string }[];
  title: string;
  description: string;
  isLoading?: boolean;
  height?: number;
  showLegend?: boolean;
  centerText?: string;
}

export default function NivoAnalyticsPieChart({
  data,
  title,
  description,
  isLoading = false,
  height = 300,
  showLegend = true,
  centerText,
}: PieChartProps) {
  // Выбираем цвета в зависимости от платформ
  const getColorByPlatform = (platform: string) => {
    const colors: Record<string, string> = {
      vk: '#0077FF',
      instagram: '#E1306C',
      telegram: '#0088CC',
      facebook: '#1877F2',
      twitter: '#1DA1F2',
      youtube: '#FF0000',
      tiktok: '#000000',
    };
    return colors[platform.toLowerCase()] || '#6366F1';
  };

  // Процессим данные, чтобы добавить цвета
  const processedData = data.map((item) => ({
    ...item,
    color: item.color || getColorByPlatform(item.id),
  }));

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-[300px]">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex justify-center items-center h-[300px] text-muted-foreground">
            Нет данных для отображения
          </div>
        ) : (
          <div style={{ height: `${height}px` }}>
            <ResponsivePie
              data={processedData}
              margin={{ top: 40, right: 80, bottom: 80, left: 80 }}
              innerRadius={0.5}
              padAngle={0.7}
              cornerRadius={3}
              activeOuterRadiusOffset={8}
              colors={{ datum: 'data.color' }}
              borderWidth={1}
              borderColor={{ from: 'color', modifiers: [['darker', 0.2]] }}
              arcLinkLabelsSkipAngle={10}
              arcLinkLabelsTextColor="#333333"
              arcLinkLabelsThickness={2}
              arcLinkLabelsColor={{ from: 'color' }}
              arcLinkLabelsOffset={2}
              arcLinkLabel={d => `${d.value}`}
              arcLabelsSkipAngle={10}
              arcLabelsTextColor={{ from: 'color', modifiers: [['darker', 2]] }}
              layers={[
                'arcs',
                'arcLabels',
                'arcLinkLabels',
                showLegend ? 'legends' : null,
                centerText
                  ? ({ centerX, centerY }) => (
                      <text
                        x={centerX}
                        y={centerY}
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{
                          fontSize: '16px',
                          fontWeight: 'bold',
                          fill: '#333',
                        }}
                      >
                        {centerText}
                      </text>
                    )
                  : null,
              ].filter(Boolean)}
              legends={
                showLegend
                  ? [
                      {
                        anchor: 'bottom',
                        direction: 'row',
                        justify: false,
                        translateX: 0,
                        translateY: 56,
                        itemsSpacing: 0,
                        itemWidth: 100,
                        itemHeight: 18,
                        itemTextColor: '#333',
                        itemDirection: 'left-to-right',
                        itemOpacity: 1,
                        symbolSize: 18,
                        symbolShape: 'circle',
                        effects: [
                          {
                            on: 'hover',
                            style: {
                              itemTextColor: '#000',
                              itemOpacity: 1
                            }
                          }
                        ]
                      },
                    ]
                  : []
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}