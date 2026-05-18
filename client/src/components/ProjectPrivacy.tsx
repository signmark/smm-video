
import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Shield, ShieldOff } from 'lucide-react';

export function ProjectPrivacy() {
  const [isPrivate, setIsPrivate] = useState(false);

  const togglePrivacy = async () => {
    try {
      const response = await fetch('/__replit/data/replPrivacy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isPrivate: !isPrivate }),
      });
      
      if (response.ok) {
        setIsPrivate(!isPrivate);
      }
    } catch (error) {
      console.error('Ошибка при изменении приватности:', error);
    }
  };

  useEffect(() => {
    // Получаем текущий статус приватности
    fetch('/__replit/data/replPrivacy')
      .then(res => res.json())
      .then(data => setIsPrivate(data.isPrivate))
      .catch(console.error);
  }, []);

  return (
    <Button 
      variant={isPrivate ? "default" : "outline"}
      onClick={togglePrivacy}
    >
      {isPrivate ? <Shield className="w-4 h-4 mr-2" /> : <ShieldOff className="w-4 h-4 mr-2" />}
      {isPrivate ? 'Приватный' : 'Публичный'}
    </Button>
  );
}
