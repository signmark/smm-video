import { ResponsiveBar } from '@nivo/bar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

interface BarChartProps {
  data: Array<Record<string, unknown>>;
  title: string;
  description: string;
  isLoading?: boolean;
  height?: number;
  keys?: string[];
  indexBy?: string;
  groupMode?: 'grouped' | 'stacked';
  layout?: 'horizontal' | 'vertical';
  colors?: string[] | ((bar: any) => string);
  colorMapping?: (bar: any) => string;
}

export default function NivoAnalyticsBarChart({
  data,
  title,
  description,
  isLoading = false,
  height = 400,
  keys = ['value'],
  indexBy = 'id',
  groupMode = 'grouped',
  layout = 'vertical',
  colors,
  colorMapping,
}: BarChartProps) {
  // Выбираем цвета в зависимости от платформ
  const getColorByPlatform = (platform: string): string => {
    const colors: Record<string, string> = {
      vk: '#0077FF',
      instagram: '#E1306C',
      telegram: '#0088CC',
      facebook: '#1877F2',
      twitter: '#1DA1F2',
      youtube: '#FF0000',
      tiktok: '#000000',
      views: '#3498db',
      likes: '#e74c3c',
      comments: '#2ecc71', 
      shares: '#f39c12',
    };
    return colors[platform.toLowerCase()] || '#6366F1';
  };

  // Функция для создания цветовой схемы
  const getColors = (bar: any) => {
    // Если предоставлен colorMapping, используем его
    if (colorMapping) {
      return colorMapping(bar);
    }
    
    if (typeof colors === 'function') {
      return colors(bar);
    }
    
    if (Array.isArray(colors)) {
      return colors[bar.index % colors.length];
    }

    // Если у нас есть поле color в данных
    if (bar.data.color) {
      return bar.data.color;
    }

    // Если у нас есть поле 'platform', используем его для цвета
    if (bar.data.platform) {
      return getColorByPlatform(bar.data.platform);
    }

    // Если у нас есть поле id, которое соответствует платформе
    if (typeof bar.id === 'string') {
      return getColorByPlatform(bar.id);
    }

    return '#6366F1'; // Фиолетовый цвет по умолчанию
  };

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
        ) : data.length === 0 ? (
          <div className="flex justify-center items-center h-[400px] text-muted-foreground">
            Нет данных для отображения
          </div>
        ) : (
          <div className="w-full" style={{ height: `${height}px` }}>
            <ResponsiveBar
              data={data}
              keys={keys}
              indexBy={indexBy}
              margin={{ top: 30, right: 80, bottom: 70, left: 60 }}
              padding={0.4}
              layout={layout}
              groupMode={groupMode}
              colors={getColors}
              borderColor={{ from: 'color', modifiers: [['darker', 1.6]] }}
              axisTop={null}
              axisRight={null}
              axisBottom={{
                tickSize: 5,
                tickPadding: 5,
                tickRotation: 0,
                legend: layout === 'vertical' ? '' : 
                  (keys[0] === 'engagementRate' ? 'Вовлеченность (%)' : 
                   keys[0] === 'views' ? 'Просмотры' :
                   keys[0] === 'likes' ? 'Лайки' :
                   keys[0] === 'comments' ? 'Комментарии' :
                   keys[0] === 'shares' ? 'Репосты' : ''),
                legendPosition: 'middle',
                legendOffset: 32,
                format: value => typeof value === 'string' ? 
                  (value === 'vk' ? 'ВКонтакте' : 
                   value === 'telegram' ? 'Телеграм' :
                   value === 'instagram' ? 'Инстаграм' :
                   value === 'facebook' ? 'Фейсбук' : value) : String(value)
              }}
              axisLeft={{
                tickSize: 5,
                tickPadding: 5,
                tickRotation: 0,
                legend: layout === 'vertical' ? 
                  (keys[0] === 'engagementRate' ? 'Вовлеченность (%)' : 
                   keys[0] === 'views' ? 'Просмотры' :
                   keys[0] === 'likes' ? 'Лайки' :
                   keys[0] === 'comments' ? 'Комментарии' :
                   keys[0] === 'shares' ? 'Репосты' : '') : '',
                legendPosition: 'middle',
                legendOffset: -40,
                format: value => String(value)
              }}
              labelSkipWidth={12}
              labelSkipHeight={12}
              labelTextColor={{ from: 'color', modifiers: [['darker', 1.6]] }}
              legends={[
                {
                  dataFrom: 'keys',
                  anchor: 'bottom',
                  direction: 'row',
                  justify: false,
                  translateX: 0,
                  translateY: 65,
                  itemsSpacing: 10,
                  itemWidth: 90,
                  itemHeight: 18,
                  itemDirection: 'left-to-right',
                  itemOpacity: 0.9,
                  symbolSize: 16,
                  symbolShape: 'square',
                  effects: [
                    {
                      on: 'hover',
                      style: {
                        itemOpacity: 1,
                        itemTextColor: '#333',
                      },
                    },
                  ],
                },
              ]}
              role="application"
              ariaLabel={`${title} график`}
              barAriaLabel={(e) => `${e.id}: ${e.formattedValue} для ${e.indexValue}`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}