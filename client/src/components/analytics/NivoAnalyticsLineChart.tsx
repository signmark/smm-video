import { ResponsiveLine } from '@nivo/line';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

interface LineChartProps {
  data: Array<{
    id: string;
    color?: string;
    data: Array<{ x: string | number; y: number }>;
  }>;
  title: string;
  description: string;
  isLoading?: boolean;
  height?: number;
  yAxisLegend?: string;
  xAxisLegend?: string;
}

export default function NivoAnalyticsLineChart({
  data,
  title,
  description,
  isLoading = false,
  height = 400,
  yAxisLegend = 'Значение',
  xAxisLegend = 'Период',
}: LineChartProps) {
  // Выбираем цвета в зависимости от платформ/показателей
  const getColorByMetric = (metricId: string): string => {
    const colors: Record<string, string> = {
      views: '#3498db',
      likes: '#e74c3c',
      comments: '#2ecc71',
      shares: '#f39c12',
      engagement: '#9b59b6',
      vk: '#0077FF',
      instagram: '#E1306C',
      telegram: '#0088CC',
      facebook: '#1877F2',
      twitter: '#1DA1F2',
      youtube: '#FF0000',
      tiktok: '#000000',
    };
    return colors[metricId.toLowerCase()] || '#6366F1';
  };

  // Процессим данные, чтобы добавить цвета
  const processedData = data.map((series) => ({
    ...series,
    color: series.color || getColorByMetric(series.id),
  }));

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-[400px]">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : processedData.length === 0 || processedData.some((d) => d.data.length === 0) ? (
          <div className="flex justify-center items-center h-[400px] text-muted-foreground">
            Нет данных для отображения
          </div>
        ) : (
          <div style={{ height: `${height}px` }}>
            <ResponsiveLine
              data={processedData}
              margin={{ top: 50, right: 110, bottom: 50, left: 60 }}
              xScale={{ type: 'point' }}
              yScale={{
                type: 'linear',
                min: 'auto',
                max: 'auto',
                stacked: false,
                reverse: false,
              }}
              yFormat=" >-.2f"
              axisTop={null}
              axisRight={null}
              axisBottom={{
                tickSize: 5,
                tickPadding: 5,
                tickRotation: 0,
                legend: xAxisLegend,
                legendOffset: 36,
                legendPosition: 'middle',
              }}
              axisLeft={{
                tickSize: 5,
                tickPadding: 5,
                tickRotation: 0,
                legend: yAxisLegend,
                legendOffset: -40,
                legendPosition: 'middle',
              }}
              colors={{ datum: 'color' }}
              pointSize={10}
              pointColor={{ theme: 'background' }}
              pointBorderWidth={2}
              pointBorderColor={{ from: 'serieColor' }}
              pointLabelYOffset={-12}
              useMesh={true}
              legends={[
                {
                  anchor: 'bottom-right',
                  direction: 'column',
                  justify: false,
                  translateX: 100,
                  translateY: 0,
                  itemsSpacing: 0,
                  itemDirection: 'left-to-right',
                  itemWidth: 80,
                  itemHeight: 20,
                  itemOpacity: 0.75,
                  symbolSize: 12,
                  symbolShape: 'circle',
                  symbolBorderColor: 'rgba(0, 0, 0, .5)',
                  effects: [
                    {
                      on: 'hover',
                      style: {
                        itemBackground: 'rgba(0, 0, 0, .03)',
                        itemOpacity: 1,
                      },
                    },
                  ],
                },
              ]}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}