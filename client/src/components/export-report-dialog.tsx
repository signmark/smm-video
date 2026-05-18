import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Download, FileText, Table, Calendar as CalendarIcon, Loader2 } from 'lucide-react';
import { format as formatDate } from 'date-fns';
import { ru, enUS, es, type Locale } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const locales: Record<string, Locale> = {
  ru,
  en: enUS,
  es
};

interface ExportReportDialogProps {
  campaignId: string;
  disabled?: boolean;
}

type ReportFormat = 'pdf' | 'excel';

export function ExportReportDialog({ campaignId, disabled }: ExportReportDialogProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reportFormat, setReportFormat] = useState<ReportFormat>('pdf');
  const [fromDate, setFromDate] = useState<Date | undefined>(
    new Date(new Date().setDate(new Date().getDate() - 30))
  );
  const [toDate, setToDate] = useState<Date | undefined>(new Date());
  const [isExporting, setIsExporting] = useState(false);

  const locale = locales[i18n.language] || ru;

  const handleExport = async () => {
    if (!fromDate || !toDate) {
      toast({
        title: t('reports.error'),
        description: t('reports.selectDates'),
        variant: 'destructive'
      });
      return;
    }

    if (fromDate > toDate) {
      toast({
        title: t('reports.error'),
        description: t('reports.invalidDateRange'),
        variant: 'destructive'
      });
      return;
    }

    setIsExporting(true);

    try {
      const token = localStorage.getItem('auth_token');
      console.log('[EXPORT-DEBUG] Token from localStorage:', token ? 'EXISTS' : 'MISSING');
      
      if (!token) {
        toast({
          title: t('reports.error'),
          description: 'Необходимо войти в систему. Токен отсутствует.',
          variant: 'destructive'
        });
        setIsExporting(false);
        return;
      }

      const queryParams = new URLSearchParams({
        format: reportFormat,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        locale: i18n.language
      });

      const response = await fetch(
        `/api/reports/${campaignId}/export?${queryParams}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate report');
      }

      // Получаем blob из ответа
      const blob = await response.blob();
      
      // Создаем ссылку для скачивания
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const filename = `report_${campaignId}_${formatDate(fromDate, 'yyyy-MM-dd')}_${formatDate(toDate, 'yyyy-MM-dd')}.${reportFormat === 'pdf' ? 'pdf' : 'xlsx'}`;
      link.download = filename;
      
      // Программно кликаем на ссылку для скачивания
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Освобождаем объект URL
      window.URL.revokeObjectURL(url);

      toast({
        title: "✅ " + t('reports.success'),
        description: t('reports.downloadStarted'),
      });

      setOpen(false);
    } catch (error: any) {
      console.error('Export error:', error);
      toast({
        title: "❌ " + t('reports.error'),
        description: error.message || t('reports.exportFailed'),
        variant: 'destructive'
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="default"
          size="default"
          disabled={disabled || !campaignId}
          className="flex items-center gap-2"
          data-testid="button-export-report"
        >
          <Download className="h-4 w-4" />
          {t('reports.export')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {t('reports.exportReport')}
          </DialogTitle>
          <DialogDescription>
            {t('reports.exportDescription')}
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-6 py-4">
          {/* Формат экспорта */}
          <div className="space-y-3">
            <Label>{t('reports.format')}</Label>
            <RadioGroup value={reportFormat} onValueChange={(value) => setReportFormat(value as ReportFormat)}>
              <div className="flex items-center space-x-3 rounded-lg border p-3 hover:bg-accent transition-colors">
                <RadioGroupItem value="pdf" id="pdf" data-testid="radio-format-pdf" />
                <Label htmlFor="pdf" className="flex-1 cursor-pointer flex items-center gap-2">
                  <FileText className="h-4 w-4 text-red-500" />
                  <div>
                    <div className="font-medium">PDF</div>
                    <div className="text-sm text-muted-foreground">{t('reports.pdfDescription')}</div>
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-3 rounded-lg border p-3 hover:bg-accent transition-colors">
                <RadioGroupItem value="excel" id="excel" data-testid="radio-format-excel" />
                <Label htmlFor="excel" className="flex-1 cursor-pointer flex items-center gap-2">
                  <Table className="h-4 w-4 text-green-500" />
                  <div>
                    <div className="font-medium">Excel</div>
                    <div className="text-sm text-muted-foreground">{t('reports.excelDescription')}</div>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Период */}
          <div className="space-y-3">
            <Label>{t('reports.period')}</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">{t('reports.from')}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal mt-1",
                        !fromDate && "text-muted-foreground"
                      )}
                      data-testid="button-select-from-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {fromDate ? formatDate(fromDate, 'dd MMM yyyy', { locale }) : t('reports.selectDate')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={fromDate}
                      onSelect={setFromDate}
                      initialFocus
                      locale={locale}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{t('reports.to')}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal mt-1",
                        !toDate && "text-muted-foreground"
                      )}
                      data-testid="button-select-to-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {toDate ? formatDate(toDate, 'dd MMM yyyy', { locale }) : t('reports.selectDate')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={toDate}
                      onSelect={setToDate}
                      initialFocus
                      locale={locale}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          {/* Быстрые периоды */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{t('reports.quickPeriods')}</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const today = new Date();
                  setToDate(today);
                  setFromDate(new Date(today.setDate(today.getDate() - 7)));
                }}
                data-testid="button-period-7days"
              >
                {t('reports.last7Days')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const today = new Date();
                  setToDate(today);
                  setFromDate(new Date(today.setDate(today.getDate() - 30)));
                }}
                data-testid="button-period-30days"
              >
                {t('reports.last30Days')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const today = new Date();
                  setToDate(today);
                  setFromDate(new Date(today.setDate(today.getDate() - 90)));
                }}
                data-testid="button-period-90days"
              >
                {t('reports.last90Days')}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isExporting}
            data-testid="button-cancel-export"
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            onClick={handleExport}
            disabled={isExporting || !fromDate || !toDate}
            data-testid="button-confirm-export"
          >
            {isExporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isExporting ? t('reports.exporting') : t('reports.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
