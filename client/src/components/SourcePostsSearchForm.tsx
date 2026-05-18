import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CheckCircle, ThumbsUp, MessageSquare, Eye, Clock, ArrowUpIcon, ArrowDownIcon } from "lucide-react";

interface SourcePostsSearchFormProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  sortField: string;
  setSortField: (value: any) => void;
  sortDirection: 'asc' | 'desc';
  setSortDirection: (value: 'asc' | 'desc') => void;
  selectedPeriod: string;
  setSelectedPeriod: (value: string) => void;
  isValidPeriod?: (value: string) => boolean;
}

export function SourcePostsSearchForm({ 
  searchQuery, 
  setSearchQuery, 
  sortField, 
  setSortField, 
  sortDirection, 
  setSortDirection,
  selectedPeriod,
  setSelectedPeriod,
  isValidPeriod = () => true
}: SourcePostsSearchFormProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 mb-4">
      <div className="flex items-center gap-2">
        <div className="text-sm text-muted-foreground mr-1">Период:</div>
        <Select 
          defaultValue="7days" 
          value={selectedPeriod}
          onValueChange={(value) => {
            if (isValidPeriod(value)) {
              setSelectedPeriod(value);
            }
          }}
        >
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="Выберите период" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3days">За 3 дня</SelectItem>
            <SelectItem value="7days">За неделю</SelectItem>
            <SelectItem value="14days">За 2 недели</SelectItem>
            <SelectItem value="30days">За месяц</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="flex items-center gap-2">
        <div className="text-sm text-muted-foreground mr-1">Сортировка:</div>
        <Select 
          defaultValue="none" 
          value={sortField}
          onValueChange={(value) => setSortField(value)}
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="Выберите поле">
              {sortField === 'none' && (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  <span>По умолчанию</span>
                </div>
              )}
              {sortField === 'reactions' && (
                <div className="flex items-center gap-2">
                  <ThumbsUp className="h-4 w-4 text-blue-500" />
                  <span>По лайкам</span>
                </div>
              )}
              {sortField === 'comments' && (
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-green-500" />
                  <span>По комментариям</span>
                </div>
              )}
              {sortField === 'views' && (
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-purple-500" />
                  <span>По просмотрам</span>
                </div>
              )}
              {sortField === 'date' && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span>По дате</span>
                </div>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
                <span>По умолчанию</span>
              </div>
            </SelectItem>
            <SelectItem value="reactions">
              <div className="flex items-center gap-2">
                <ThumbsUp className="h-4 w-4 text-blue-500" />
                <span>По лайкам</span>
              </div>
            </SelectItem>
            <SelectItem value="comments">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-green-500" />
                <span>По комментариям</span>
              </div>
            </SelectItem>
            <SelectItem value="views">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-purple-500" />
                <span>По просмотрам</span>
              </div>
            </SelectItem>
            <SelectItem value="date">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-500" />
                <span>По дате</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        {sortField !== 'none' && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
            className="h-9 w-9"
          >
            {sortDirection === 'asc' ? (
              <ArrowUpIcon className="h-4 w-4" />
            ) : (
              <ArrowDownIcon className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="text-sm text-muted-foreground mr-1">Поиск:</div>
        <Input
          placeholder="Поиск по содержимому"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 w-[200px]"
        />
      </div>
    </div>
  );
}