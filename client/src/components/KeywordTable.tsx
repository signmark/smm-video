import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Trash2, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useState } from "react";

type SortField = 'keyword' | 'frequency';
type SortDirection = 'asc' | 'desc';

interface KeywordTableProps {
  keywords: any[];
  searchResults: any[];
  isLoading: boolean;
  onDelete: (id: string) => void;
  onKeywordToggle?: (index: number) => void;
  onSelectAll?: (checked: boolean) => void;
  onSaveSelected?: () => void;
}

export function KeywordTable({
  keywords = [],
  searchResults = [],
  isLoading,
  onDelete,
  onKeywordToggle,
  onSelectAll,
  onSaveSelected
}: KeywordTableProps) {

  
  // Состояние для сортировки результатов поиска
  const [searchSortField, setSearchSortField] = useState<SortField>('keyword');
  const [searchSortDirection, setSearchSortDirection] = useState<SortDirection>('asc');
  
  // Состояние для сортировки добавленных ключевых слов
  const [keywordsSortField, setKeywordsSortField] = useState<SortField>('keyword');
  const [keywordsSortDirection, setKeywordsSortDirection] = useState<SortDirection>('asc');
  
  // Функции для переключения сортировки
  const toggleSearchSort = (field: SortField) => {
    if (searchSortField === field) {
      setSearchSortDirection(searchSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSearchSortField(field);
      setSearchSortDirection('asc');
    }
  };
  
  const toggleKeywordsSort = (field: SortField) => {
    if (keywordsSortField === field) {
      setKeywordsSortDirection(keywordsSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setKeywordsSortField(field);
      setKeywordsSortDirection('asc');
    }
  };
  
  // Сортировка результатов поиска
  const sortedSearchResults = [...searchResults].sort((a, b) => {
    if (searchSortField === 'keyword') {
      return searchSortDirection === 'asc' 
        ? a.keyword.localeCompare(b.keyword) 
        : b.keyword.localeCompare(a.keyword);
    } else { // frequency
      const freqA = a.trend || 0;
      const freqB = b.trend || 0;
      return searchSortDirection === 'asc' ? freqA - freqB : freqB - freqA;
    }
  });
  
  // Сортировка добавленных ключевых слов
  const sortedKeywords = [...keywords].sort((a, b) => {
    if (keywordsSortField === 'keyword') {
      return keywordsSortDirection === 'asc' 
        ? a.keyword.localeCompare(b.keyword) 
        : b.keyword.localeCompare(a.keyword);
    } else { // frequency
      const freqA = a.trend_score || 0;
      const freqB = b.trend_score || 0;
      return keywordsSortDirection === 'asc' ? freqA - freqB : freqB - freqA;
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Результаты поиска */}
      {searchResults.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Результаты поиска</h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all"
                  checked={searchResults.every(kw => kw.selected)}
                  onCheckedChange={(checked) => onSelectAll?.(!!checked)}
                />
                <label htmlFor="select-all" className="text-sm">
                  Выбрать все
                </label>
              </div>
              <Button
                onClick={onSaveSelected}
                disabled={!searchResults.some(kw => kw.selected)}
              >
                Добавить выбранные ({searchResults.filter(kw => kw.selected).length})
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]"></TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSearchSort('keyword')}>
                  <div className="flex items-center">
                    Ключевое слово
                    {searchSortField === 'keyword' && (
                      searchSortDirection === 'asc' 
                        ? <ArrowUp className="ml-2 h-4 w-4" /> 
                        : <ArrowDown className="ml-2 h-4 w-4" />
                    )}
                    {searchSortField !== 'keyword' && <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSearchSort('frequency')}>
                  <div className="flex items-center">
                    Частота
                    {searchSortField === 'frequency' && (
                      searchSortDirection === 'asc' 
                        ? <ArrowUp className="ml-2 h-4 w-4" /> 
                        : <ArrowDown className="ml-2 h-4 w-4" />
                    )}
                    {searchSortField !== 'frequency' && <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />}
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedSearchResults.map((keyword) => (
                <TableRow key={keyword.keyword}>
                  <TableCell>
                    <Checkbox
                      checked={keyword.selected}
                      onCheckedChange={() => {
                        // Находим оригинальный индекс в исходном массиве searchResults
                        const originalIndex = searchResults.findIndex(
                          kw => kw.keyword === keyword.keyword
                        );
                        if (originalIndex !== -1) {
                          onKeywordToggle?.(originalIndex);
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell>{keyword.keyword}</TableCell>
                  <TableCell>{keyword.trend}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Добавленные ключевые слова */}
      {keywords.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Добавленные ключевые слова</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer" onClick={() => toggleKeywordsSort('keyword')}>
                  <div className="flex items-center">
                    Ключевое слово
                    {keywordsSortField === 'keyword' && (
                      keywordsSortDirection === 'asc' 
                        ? <ArrowUp className="ml-2 h-4 w-4" /> 
                        : <ArrowDown className="ml-2 h-4 w-4" />
                    )}
                    {keywordsSortField !== 'keyword' && <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleKeywordsSort('frequency')}>
                  <div className="flex items-center">
                    Частота
                    {keywordsSortField === 'frequency' && (
                      keywordsSortDirection === 'asc' 
                        ? <ArrowUp className="ml-2 h-4 w-4" /> 
                        : <ArrowDown className="ml-2 h-4 w-4" />
                    )}
                    {keywordsSortField !== 'frequency' && <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />}
                  </div>
                </TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedKeywords.map((keyword) => (
                <TableRow key={keyword.id}>
                  <TableCell>{keyword.keyword}</TableCell>
                  <TableCell>{keyword.trend_score}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(keyword.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {keywords.length === 0 && searchResults.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          Нет ключевых слов
        </div>
      )}
    </div>
  );
}