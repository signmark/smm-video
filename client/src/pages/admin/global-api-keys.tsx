import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Check, X, AlertCircle, Import, FileUp } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';
// Правильный импорт типов сервисов API
import { ApiServiceName } from '@/lib/api-service-types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
// Для ясности, мы не используем здесь импорт api из @/lib/api, так как нам нужны прямые вызовы axios
import { getServiceDisplayName } from '@/lib/utils';

interface GlobalApiKey {
  id: string;
  service_name: string;
  api_key: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

interface ImportKeysDialogProps {
  token: string;
  onImportComplete: () => void;
}

function ImportKeysDialog({ token, onImportComplete }: ImportKeysDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userKeys, setUserKeys] = useState<ApiKey[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>({});
  const [isImporting, setIsImporting] = useState(false);
  const { toast } = useToast();

  // Получение списка ключей пользователя
  const loadUserKeys = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Запрашиваем личные API ключи пользователя из API
      const response = await axios.get('/api/user-api-keys', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Проверяем результат запроса
      if (response.data && response.data.data) {
        const apiKeys = response.data.data;
        setUserKeys(apiKeys);
        
        // Инициализация состояния выбранных ключей
        const initialSelectedState: Record<string, boolean> = {};
        apiKeys.forEach((key: ApiKey) => {
          initialSelectedState[key.id] = false;
        });
        setSelectedKeys(initialSelectedState);
      } else {
        setError('Не удалось получить список личных API ключей');
        toast({
          variant: 'destructive',
          title: 'Ошибка загрузки',
          description: 'Не удалось получить список личных API ключей'
        });
      }
    } catch (err: any) {
      console.error('Ошибка при загрузке личных API ключей:', err);
      setError(err.message || 'Ошибка при загрузке личных API ключей');
      toast({
        variant: 'destructive',
        title: 'Ошибка загрузки',
        description: err.message || 'Ошибка при загрузке личных API ключей'
      });
    } finally {
      setLoading(false);
    }
  };

  // Обработка изменения состояния чекбокса
  const handleCheckboxChange = (keyId: string, isChecked: boolean) => {
    setSelectedKeys(prev => ({
      ...prev,
      [keyId]: isChecked
    }));
  };

  // Импорт выбранных ключей
  const handleImport = async () => {
    const keysToImport = userKeys.filter(key => selectedKeys[key.id]);
    
    if (keysToImport.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Необходимо выбрать хотя бы один ключ для импорта'
      });
      return;
    }
    
    setIsImporting(true);
    
    try {
      // Отправляем запросы на добавление каждого ключа
      const importPromises = keysToImport.map(key => {
        return axios.post('/api/global-api-keys', {
          service: key.service_name,
          apiKey: key.api_key
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      });
      
      const results = await Promise.allSettled(importPromises);
      
      // Проверяем результаты импорта
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      if (successful > 0) {
        toast({
          title: 'Успешно',
          description: `Импортировано ${successful} ключей${failed > 0 ? `, не удалось импортировать ${failed} ключей` : ''}`
        });
        
        // Вызываем колбэк для обновления списка ключей
        onImportComplete();
      } else {
        toast({
          variant: 'destructive',
          title: 'Ошибка',
          description: 'Не удалось импортировать ключи'
        });
      }
    } catch (err: any) {
      console.error('Ошибка при импорте ключей:', err);
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: err.message || 'Ошибка при импорте ключей'
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Загружаем ключи пользователя при открытии диалога
  useEffect(() => {
    loadUserKeys();
  }, []);

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Импорт личных API ключей</DialogTitle>
        <DialogDescription>
          Выберите личные API ключи, которые вы хотите добавить в систему глобальных ключей
        </DialogDescription>
      </DialogHeader>
      
      <div className="py-4">
        {loading ? (
          <div className="flex justify-center items-center p-4">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Загрузка ключей...</span>
          </div>
        ) : error ? (
          <div className="bg-red-50 text-red-800 p-4 rounded-md">
            <p className="font-medium">Ошибка загрузки ключей</p>
            <p>{error}</p>
          </div>
        ) : userKeys.length === 0 ? (
          <div className="bg-gray-50 p-4 rounded-md text-center">
            <p>У вас нет личных API ключей</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px] pr-4">
            <div className="space-y-4">
              {userKeys.map((key) => (
                <div key={key.id} className="flex items-start space-x-2">
                  <Checkbox
                    id={`key-${key.id}`}
                    checked={!!selectedKeys[key.id]}
                    onCheckedChange={(checked) => handleCheckboxChange(key.id, !!checked)}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label
                      htmlFor={`key-${key.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {getServiceDisplayName(key.service_name)}
                    </label>
                    <p className="text-sm text-gray-500 font-mono">
                      {key.api_key.length > 20
                        ? `${key.api_key.slice(0, 10)}...${key.api_key.slice(-10)}`
                        : key.api_key}
                      <span className="ml-2 text-xs">({key.api_key.length} символов)</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
      
      <DialogFooter className="flex justify-between sm:justify-between">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Отмена
          </Button>
        </DialogClose>
        <Button 
          onClick={handleImport} 
          disabled={isImporting || loading || userKeys.length === 0 || Object.values(selectedKeys).every(v => !v)}
        >
          {isImporting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Импорт...
            </>
          ) : (
            <>Импортировать выбранные</>  
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

interface ApiKey {
  id: string;
  service_name: string;
  api_key: string;
}

export default function GlobalApiKeysPage() {
  const { token, isAdmin, checkIsAdmin } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [adminChecked, setAdminChecked] = useState(false);
  const [keys, setKeys] = useState<GlobalApiKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  
  // Принудительная проверка статуса администратора при загрузке страницы
  useEffect(() => {
    const verifyAdmin = async () => {
      try {
        console.log('Проверка статуса администратора перед загрузкой страницы API ключей');
        const isAdminResult = await checkIsAdmin();
        console.log('Результат проверки админа:', isAdminResult);
        setAdminChecked(true);
        if (!isAdminResult) {
          setError('Доступ запрещен. У вас недостаточно прав для управления глобальными API ключами.');
        } else {
          loadKeys();
        }
      } catch (err) {
        console.error('Ошибка при проверке прав администратора:', err);
        setError('Ошибка при проверке прав доступа');
        setAdminChecked(true);
      }
    };
    
    verifyAdmin();
  }, [token]); // Убрал checkIsAdmin из зависимостей - функция стабильна
  
  // Состояние для новых ключей
  const [newService, setNewService] = useState<string>('');
  const [newApiKey, setNewApiKey] = useState<string>('');
  const [isAddingKey, setIsAddingKey] = useState(false);

  // Загрузка списка глобальных ключей
  const loadKeys = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Проверка на наличие токена
      if (!token) {
        console.error('Нет доступного токена авторизации для загрузки ключей');
        setError('Ошибка авторизации: токен не найден. Пожалуйста, перезайдите в систему.');
        return;
      }
      
      console.log('Отправка запроса на получение глобальных API ключей с токеном', token.substring(0, 10) + '...');
      const response = await axios.get('/api/global-api-keys', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      console.log('Получен ответ от сервера:', response.data);
      if (response.data.success) {
        setKeys(response.data.data || []);
      } else {
        setError(response.data.message || 'Ошибка при загрузке глобальных API ключей');
        toast({
          variant: 'destructive',
          title: 'Ошибка загрузки',
          description: response.data.message || 'Ошибка при загрузке глобальных API ключей'
        });
      }
    } catch (err: any) {
      console.error('Ошибка при загрузке глобальных API ключей:', err);
      setError(err.response?.data?.message || err.message || 'Ошибка при загрузке глобальных API ключей');
      toast({
        variant: 'destructive',
        title: 'Ошибка загрузки',
        description: err.response?.data?.message || err.message || 'Ошибка при загрузке глобальных API ключей'
      });
    } finally {
      setLoading(false);
    }
  };

  // Добавление нового глобального ключа
  const addKey = async () => {
    if (!newService || !newApiKey) {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: 'Необходимо указать сервис и API ключ'
      });
      return;
    }
    
    if (!token) {
      toast({
        variant: 'destructive',
        title: 'Ошибка авторизации',
        description: 'Отсутствует токен авторизации. Пожалуйста, перезайдите в систему.'
      });
      return;
    }
    
    setIsAddingKey(true);
    
    try {
      const response = await axios.post('/api/global-api-keys', {
        service: newService,
        apiKey: newApiKey
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        toast({
          title: 'Успешно',
          description: `Глобальный API ключ для сервиса ${newService} добавлен`
        });
        
        // Сбрасываем форму
        setNewService('');
        setNewApiKey('');
        
        // Перезагружаем список ключей
        loadKeys();
      } else {
        toast({
          variant: 'destructive',
          title: 'Ошибка',
          description: response.data.message || 'Ошибка при добавлении API ключа'
        });
      }
    } catch (err: any) {
      console.error('Ошибка при добавлении API ключа:', err);
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: err.response?.data?.message || err.message || 'Ошибка при добавлении API ключа'
      });
    } finally {
      setIsAddingKey(false);
    }
  };

  // Состояние для хранения статуса обновления ключей
  const [updatingKeyId, setUpdatingKeyId] = useState<string | null>(null);

  // Обновление статуса активности ключа
  const toggleKeyActive = async (key: GlobalApiKey) => {
    try {
      setUpdatingKeyId(key.id);
      
      console.log(`Отправляем запрос на обновление статуса ключа ${key.id}, текущий статус: ${key.is_active}`);
      
      // Исправлено имя поля active на is_active, чтобы соответствовало серверной модели
      const response = await axios.put(`/api/global-api-keys/${key.id}`, {
        is_active: !key.is_active
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        // Обновляем ключ локально, не перезагружая весь список
        setKeys(currentKeys => currentKeys.map(k => 
          k.id === key.id ? { ...k, is_active: !k.is_active } : k
        ));
        
        toast({
          title: 'Успешно',
          description: `Статус ключа для ${key.service_name} изменен`
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Ошибка',
          description: response.data.message || 'Ошибка при обновлении статуса ключа'
        });
      }
    } catch (err: any) {
      console.error('Ошибка при обновлении статуса ключа:', err);
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: err.response?.data?.message || err.message || 'Ошибка при обновлении статуса ключа'
      });
    } finally {
      setUpdatingKeyId(null);
    }
  };

  // Состояние для хранения статуса удаления ключа
  const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);

  // Удаление глобального ключа
  const deleteKey = async (key: GlobalApiKey) => {
    if (!confirm(`Вы уверены, что хотите удалить глобальный API ключ для сервиса ${key.service_name}?`)) {
      return;
    }
    
    try {
      setDeletingKeyId(key.id);
      
      // Используем DELETE запрос вместо PUT для полного удаления ключа
      const response = await axios.delete(`/api/global-api-keys/${key.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        toast({
          title: 'Успешно',
          description: `Глобальный API ключ для сервиса ${key.service_name} удален`
        });
        
        // Обновляем список ключей
        await loadKeys();
      } else {
        toast({
          variant: 'destructive',
          title: 'Ошибка',
          description: response.data.message || 'Ошибка при удалении API ключа'
        });
      }
    } catch (err: any) {
      console.error('Ошибка при удалении API ключа:', err);
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: err.response?.data?.message || err.message || 'Ошибка при удалении API ключа'
      });
    } finally {
      setDeletingKeyId(null);
    }
  };

  // Загружаем список ключей при монтировании компонента
  useEffect(() => {
    if (token) {
      loadKeys();
    }
  }, [token]);

  // Если пользователь не администратор, показываем сообщение об ошибке
  if (!isAdmin) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardHeader>
            <CardTitle>Доступ запрещен</CardTitle>
            <CardDescription>
              Для управления глобальными API ключами необходимы права администратора
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center p-4 bg-amber-50 text-amber-800 rounded-md">
              <AlertCircle className="h-5 w-5 mr-2" />
              <p>У вас нет доступа к этой странице. Пожалуйста, обратитесь к администратору системы.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-3xl font-bold mb-6">Управление глобальными API ключами</h1>
      
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Добавить новый глобальный API ключ</CardTitle>
          <CardDescription>
            Глобальные API ключи используются всеми пользователями системы, у которых нет персональных ключей
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="service">Название переменной (Сервис)</Label>
                <div className="flex gap-2">
                  <Input
                    id="service"
                    value={newService}
                    onChange={(e) => setNewService(e.target.value)}
                    placeholder="Введите название переменной (например, PERPLEXITY)"
                  />
                  <Select onValueChange={setNewService}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Шаблоны" />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]">
                      <SelectItem value="SERPAPI_KEY">SERPAPI_KEY</SelectItem>
                      {Object.values(ApiServiceName).map((service) => (
                        <SelectItem key={service} value={service}>
                          {service}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div>
                <Label htmlFor="apiKey">API Ключ</Label>
                <Input
                  id="apiKey"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="Введите API ключ"
                />
              </div>
            </div>
            
            <div className="flex justify-end">
              <Button onClick={addKey} disabled={isAddingKey || !newService || !newApiKey}>
                {isAddingKey ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Добавление...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Добавить ключ
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle>Список глобальных API ключей</CardTitle>
            <CardDescription>
              Управление существующими глобальными API ключами
            </CardDescription>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto">
                <FileUp className="h-4 w-4 mr-2" />
                Импортировать мои ключи
              </Button>
            </DialogTrigger>
            {token && <ImportKeysDialog token={token} onImportComplete={loadKeys} />}
          </Dialog>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center items-center p-4">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка ключей...</span>
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-800 p-4 rounded-md">
              <p className="font-medium">Ошибка загрузки ключей</p>
              <p>{error}</p>
            </div>
          ) : keys.length === 0 ? (
            <div className="bg-gray-50 p-4 rounded-md text-center">
              <p>Глобальные API ключи не найдены</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="p-2 text-left border">Сервис</th>
                    <th className="p-2 text-left border">API Ключ</th>
                    <th className="p-2 text-center border">Активен</th>
                    <th className="p-2 text-center border">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id} className={key.is_active ? '' : 'text-gray-400'}>
                      <td className="p-2 border">{key.service_name}</td>
                      <td className="p-2 border">
                        <span className="font-mono">
                          {key.api_key.length > 20
                            ? `${key.api_key.slice(0, 10)}...${key.api_key.slice(-10)}`
                            : key.api_key}
                        </span>
                        <span className="ml-2 text-gray-400 text-xs">
                          ({key.api_key.length} символов)
                        </span>
                      </td>
                      <td className="p-2 border text-center">
                        <div className="flex justify-center items-center gap-2">
                          {updatingKeyId === key.id ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <>
                              <Switch
                                checked={key.is_active}
                                onCheckedChange={() => toggleKeyActive(key)}
                                disabled={updatingKeyId !== null}
                                className="my-1.5"
                              />
                              <span className={`text-sm font-medium ${key.is_active ? 'text-green-600' : 'text-gray-400'}`}>
                                {key.is_active ? 'Активен' : 'Отключен'}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="p-2 border text-center">
                        {deletingKeyId === key.id ? (
                          <div className="flex justify-center items-center">
                            <Loader2 className="h-5 w-5 animate-spin text-red-500" />
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteKey(key)}
                            disabled={!key.is_active || deletingKeyId !== null || updatingKeyId !== null}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
