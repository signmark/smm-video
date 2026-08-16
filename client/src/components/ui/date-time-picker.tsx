import * as React from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  instantToMoscowWall,
  moscowWallToInstant,
  SCHEDULE_DISPLAY_TIME_ZONE_LABEL,
} from "@/lib/schedule-timezone";

interface DateTimePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
}

/**
 * Выбор даты и времени публикации.
 *
 * AI-113: введённое время трактуется как МОСКОВСКОЕ, а не как время пояса
 * браузера. Раньше здесь стоял `setHours`, то есть применялся пояс устройства,
 * — и тот же ввод «10:00» через AI-команду (она всегда понимала время по
 * Москве) давал другой момент. Теперь оба пути дают один.
 *
 * Внутреннее состояние (`selectedDate`) — НЕ момент, а московские «настенные»
 * части, разложенные по локальным полям: календарю и полю времени нужны именно
 * локальные поля, а показывать они обязаны московское время. Наружу через
 * `onChange` уходит настоящий абсолютный момент.
 */
export function DateTimePicker({ value, onChange }: DateTimePickerProps) {
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(
    value ? instantToMoscowWall(value) : undefined
  );
  const [timeValue, setTimeValue] = React.useState(
    value ? format(instantToMoscowWall(value), "HH:mm") : ""
  );

  // Sync with external value changes
  React.useEffect(() => {
    if (value) {
      const wall = instantToMoscowWall(value);
      setSelectedDate(wall);
      setTimeValue(format(wall, "HH:mm"));
    }
  }, [value]);

  /** Московские части выбранного дня и времени → абсолютный момент. */
  const emit = (wallDay: Date, time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    onChange?.(
      moscowWallToInstant(
        wallDay.getFullYear(),
        wallDay.getMonth() + 1,
        wallDay.getDate(),
        hours,
        minutes
      )
    );
  };

  // Update the combined date and time when either changes
  const handleDateChange = (date: Date | undefined) => {
    setSelectedDate(date);
    if (date && timeValue) {
      emit(date, timeValue);
    } else if (date) {
      // Времени ещё нет: день выбран, момент считаем от полуночи по Москве —
      // иначе наружу ушёл бы день в поясе устройства.
      emit(date, "00:00");
    }
  };

  const handleTimeChange = (time: string) => {
    setTimeValue(time);
    if (selectedDate && time) {
      emit(selectedDate, time);
    }
  };

  return (
    <div className="flex gap-2">
      <Popover modal={true}>
        <PopoverTrigger asChild>
          <Button
            variant={"outline"}
            className={cn(
              "w-[240px] justify-start text-left font-normal",
              "bg-background dark:bg-background",
              "border-input dark:border-input",
              "hover:bg-accent dark:hover:bg-accent",
              "hover:text-accent-foreground dark:hover:text-accent-foreground",
              !selectedDate && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {selectedDate ? format(selectedDate, "PPP") : <span>Выберите дату</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 z-[100]" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateChange}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <div className="flex items-center gap-1">
        <Input
          type="time"
          value={timeValue}
          onChange={(e) => handleTimeChange(e.target.value)}
          className="w-[120px] bg-background dark:bg-background border-input dark:border-input"
          data-testid="input-schedule-time"
        />
        <span className="text-xs text-muted-foreground" data-testid="label-schedule-zone">
          {SCHEDULE_DISPLAY_TIME_ZONE_LABEL}
        </span>
      </div>
    </div>
  );
}
