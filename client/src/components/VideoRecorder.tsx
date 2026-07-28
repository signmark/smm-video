

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Video, Square, Pause, Play, Download, Mic, MicOff, Monitor, Camera, BookOpen, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/store';
import { useQuery } from '@tanstack/react-query';

interface RecordingConfig {
  includeAudio: boolean;
  includeSystemAudio: boolean;
  quality: 'low' | 'medium' | 'high';
  format: 'webm' | 'mp4';
}

interface VideoRecorderProps {
  onRecordingComplete?: (blob: Blob, filename: string) => void;
  className?: string;
}

export default function VideoRecorder({ onRecordingComplete, className }: VideoRecorderProps) {
  
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [hasAudioPermission, setHasAudioPermission] = useState(false);
  const [isTestingAudio, setIsTestingAudio] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [volumeGain, setVolumeGain] = useState(2.5);
  const [config, setConfig] = useState<RecordingConfig>({
    includeAudio: true,
    includeSystemAudio: true,
    quality: 'high',
    format: 'webm'
  });

  // Администраторские функции - получаем из auth store
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);
  const { data: adminData } = useQuery({
    queryKey: ['/api/users/is-admin', token],
    queryFn: async () => {
      if (!token) return { isAdmin: false };
      const response = await fetch('/api/users/is-admin', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) return { isAdmin: false };
      return response.json();
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });
  const isAdmin = adminData?.isAdmin || false;
  const [showDocumentationDialog, setShowDocumentationDialog] = useState(false);
  const [isUploadingToDocumentation, setIsUploadingToDocumentation] = useState(false);
  const [tutorialForm, setTutorialForm] = useState({
    title: '',
    description: '',
    category: 'basics' as 'basics' | 'content' | 'publishing' | 'analytics' | 'advanced',
    duration: ''
  });

  // Проверяем доступность микрофона и роль пользователя при загрузке компонента
  useEffect(() => {
    // Проверяем разрешения без запроса доступа
    navigator.permissions?.query({ name: 'microphone' as PermissionName })
      .then(permission => {
        console.log('🎤 Статус разрешения микрофона:', permission.state);
        if (permission.state === 'granted') {
          setHasAudioPermission(true);
        }
      })
      .catch(err => {
        console.log('⚠️ Не удалось проверить разрешения:', err);
      });

    // Проверяем роль пользователя (админ или нет)
    console.log('🚀 useEffect CALLING checkUserRole...');
    checkUserRole();
  }, []);

  // Проверка роли пользователя
  const checkUserRole = async () => {
    // Функция отключена, так как вызывала 404 ошибки в консоли
    console.log('🔥 checkUserRole() is disabled to prevent console errors');
  };

  // Логирование состояния кнопок для отладки
  useEffect(() => {
    console.log('🎯 КНОПКИ STATE DEBUG:', {
      hasRecordingBlob: !!recordingBlob,
      blobSize: recordingBlob?.size,
      isAdmin: isAdmin,
      isRecording: isRecording,
      shouldShowDownload: recordingBlob && recordingBlob.size > 0 && !isRecording,
      shouldShowSaveToDoc: isAdmin && recordingBlob && recordingBlob.size > 0 && !isRecording
    });
  }, [recordingBlob, isAdmin, isRecording]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioTestStreamRef = useRef<MediaStream | null>(null);
  const audioTestIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Функции для сохранения в документацию
  const saveToDocumentation = async () => {
    if (!recordingBlob || !isAdmin) return;

    setIsUploadingToDocumentation(true);
    try {
      // 1. Получаем URL для загрузки видео
      const token = localStorage.getItem('auth_token');
      const uploadResponse = await fetch('/api/video-tutorials/upload-url', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          mimeType: 'video/webm',
          sizeBytes: recordingBlob.size,
          title: tutorialForm.title,
          description: tutorialForm.description,
          category: tutorialForm.category
        })
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.error || 'Не удалось получить URL для загрузки');
      }

      const { data } = await uploadResponse.json();
      const { uploadUrl, fileKey } = data;

      // 2. Загружаем видео в Object Storage
      const uploadToStorage = await fetch(uploadUrl, {
        method: 'PUT',
        body: recordingBlob,
        headers: {
          'Content-Type': recordingBlob.type
        }
      });

      if (!uploadToStorage.ok) {
        throw new Error('Не удалось загрузить видео');
      }

      // 3. Создаем tutorial metadata в базе данных
      const tutorialData = {
        title: tutorialForm.title,
        description: tutorialForm.description,
        category: tutorialForm.category,
        videoPath: fileKey,
        mimeType: 'video/webm',
        sizeBytes: recordingBlob.size,
        isActive: true,
        tutorialId: `tutorial_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Уникальный ID
        uploadedBy: userId || 'anonymous' // Обязательное поле
      };

      const createResponse = await fetch('/api/video-tutorials', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(tutorialData)
      });

      if (!createResponse.ok) {
        throw new Error('Не удалось сохранить данные в базу');
      }

      // Обновляем кеш списка видео
      const { queryClient } = await import('@/lib/queryClient');
      queryClient.invalidateQueries({ queryKey: ['public-tutorials'] });
      queryClient.invalidateQueries({ queryKey: ['/api/video-tutorials'] });
      
      toast({
        title: "✅ Видео сохранено!",
        description: `Инструкция "${tutorialForm.title}" добавлена в документацию`,
      });

      // Сбрасываем форму, запись и закрываем диалог
      setTutorialForm({
        title: '',
        description: '',
        category: 'basics',
        duration: ''
      });
      setRecordingBlob(null);
      setShowDocumentationDialog(false);

    } catch (error) {
      console.error('Error saving to documentation:', error);
      toast({
        title: "❌ Ошибка",
        description: (error as Error).message || "Не удалось сохранить видео в документацию",
        variant: "destructive"
      });
    } finally {
      setIsUploadingToDocumentation(false);
    }
  };

  // Проверить доступ к микрофону
  const checkMicrophonePermission = useCallback(async () => {
    try {
      console.log('🎤 Принудительный запрос доступа к микрофону...');
      
      // Простой запрос без сложных настроек
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true
      });
      
      const audioTracks = stream.getAudioTracks();
      console.log('✅ Микрофон доступен:', {
        tracksCount: audioTracks.length,
        trackLabel: audioTracks[0]?.label || 'Unknown',
        trackEnabled: audioTracks[0]?.enabled,
        trackReadyState: audioTracks[0]?.readyState
      });
      
      // Останавливаем тестовый поток
      stream.getTracks().forEach(track => {
        console.log('🛑 Остановка тестового трека:', track.label);
        track.stop();
      });
      
      setHasAudioPermission(true);
      
      toast({
        title: "✅ Микрофон готов",
        description: `Микрофон "${audioTracks[0]?.label || 'Default'}" готов к записи`,
      });
      
      return true;
    } catch (error: any) {
      console.error('❌ Ошибка доступа к микрофону:', error);
      setHasAudioPermission(false);
      
      let errorMessage = "Разрешите доступ к микрофону в браузере";
      if (error.name === 'NotAllowedError') {
        errorMessage = "Доступ к микрофону запрещен. Нажмите на иконку замка в адресной строке браузера и разрешите доступ к микрофону";
      } else if (error.name === 'NotFoundError') {
        errorMessage = "Микрофон не найден. Подключите микрофон к устройству";
      } else if (error.name === 'NotReadableError') {
        errorMessage = "Микрофон занят другим приложением";
      }
      
      toast({
        title: "❌ Нет доступа к микрофону",
        description: errorMessage,
        variant: "destructive"
      });
      
      return false;
    }
  }, [toast]);

  // Тестировать запись звука
  const testAudioRecording = useCallback(async () => {
    if (isTestingAudio) {
      // Остановить тест
      setIsTestingAudio(false);
      setAudioLevel(0);
      
      if (audioTestStreamRef.current) {
        audioTestStreamRef.current.getTracks().forEach(track => {
          track.stop();
          console.log('🛑 Остановка тестового аудио трека:', track.label);
        });
        audioTestStreamRef.current = null;
      }
      
      if (audioTestIntervalRef.current) {
        clearInterval(audioTestIntervalRef.current);
        audioTestIntervalRef.current = null;
      }
      
      toast({
        title: "Тест звука остановлен",
        description: "Проверка микрофона завершена",
      });
      
      return;
    }

    try {
      console.log('🎤 Начинаем тест записи звука...');
      
      // Принудительно запрашиваем разрешения
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true
      });
      
      audioTestStreamRef.current = stream;
      
      const audioTracks = stream.getAudioTracks();
      console.log('✅ Аудио треки для теста:', {
        tracksCount: audioTracks.length,
        trackLabels: audioTracks.map(t => t.label),
        trackStates: audioTracks.map(t => t.readyState)
      });
      
      // Создаем AudioContext для анализа уровня звука
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      source.connect(analyser);
      
      setIsTestingAudio(true);
      setHasAudioPermission(true);
      
      // Функция для измерения уровня звука
      const measureAudioLevel = () => {
        if (audioTestStreamRef.current) {
          analyser.getByteFrequencyData(dataArray);
          
          // Вычисляем средний уровень
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          const normalizedLevel = Math.min(100, (average / 255) * 100);
          
          setAudioLevel(normalizedLevel);
        }
      };
      
      // Запускаем измерение каждые 100ms
      audioTestIntervalRef.current = setInterval(measureAudioLevel, 100);
      
      toast({
        title: "🎤 Тест звука запущен",
        description: "Говорите в микрофон. Уровень звука должен отображаться ниже",
      });
      
      // Автоматически останавливаем тест через 30 секунд
      setTimeout(() => {
        if (isTestingAudio) {
          testAudioRecording();
        }
      }, 30000);
      
    } catch (error: any) {
      console.error('❌ Ошибка теста звука:', error);
      setIsTestingAudio(false);
      setHasAudioPermission(false);
      
      let errorMessage = "Не удалось получить доступ к микрофону";
      if (error.name === 'NotAllowedError') {
        errorMessage = "Доступ к микрофону запрещен. Разрешите доступ в браузере";
      } else if (error.name === 'NotFoundError') {
        errorMessage = "Микрофон не найден. Подключите микрофон к устройству";
      } else if (error.name === 'NotReadableError') {
        errorMessage = "Микрофон занят другим приложением";
      }
      
      toast({
        title: "❌ Ошибка теста звука",
        description: errorMessage,
        variant: "destructive"
      });
    }
  }, [isTestingAudio, toast]);

  // Начать запись
  const startRecording = useCallback(async () => {
    try {
      let microphoneStream: MediaStream | null = null;
      
      // 1. ПРИНУДИТЕЛЬНО запрашиваем микрофон ПЕРЕД началом записи
      if (config.includeAudio) {
        console.log('🎤 ПРИНУДИТЕЛЬНЫЙ запрос микрофона...');
        
        try {
          // Всегда запрашиваем микрофон заново - самый надёжный способ
          // Получаем базовый поток микрофона
          const basicMicStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: false, // Отключаем для лучшей громкости
              autoGainControl: false, // Отключаем автоуправление
              sampleRate: 44100,
              channelCount: 2
            }
          });

          // Используем Web Audio API для усиления звука
          const audioContext = new AudioContext();
          audioContextRef.current = audioContext; // Сохраняем для cleanup
          
          const source = audioContext.createMediaStreamSource(basicMicStream);
          const gainNode = audioContext.createGain();
          
          // Регулируемое усиление громкости
          gainNode.gain.value = volumeGain;
          
          // Создаем выходной поток
          const destination = audioContext.createMediaStreamDestination();
          source.connect(gainNode);
          gainNode.connect(destination);
          
          // Используем усиленный поток
          microphoneStream = destination.stream;
          
          const tracks = microphoneStream.getAudioTracks();
          console.log('🎤 ✅ МИКРОФОН ЗАХВАЧЕН:', {
            tracksCount: tracks.length,
            trackLabels: tracks.map(t => t.label),
            trackStates: tracks.map(t => t.readyState),
            trackEnabled: tracks.map(t => t.enabled),
            trackMuted: tracks.map(t => t.muted)
          });
          
          if (tracks.length === 0) {
            throw new Error('Нет аудио треков');
          }
          
          // Принудительно активируем все треки
          tracks.forEach(track => {
            track.enabled = true;
            console.log(`🎤 ✅ Трек активирован: ${track.label}`);
          });
          
          setHasAudioPermission(true);
          
          toast({
            title: "🎤 Микрофон подключён",
            description: `Готов к записи: ${tracks[0]?.label || 'Default Microphone'}`,
          });
          
        } catch (micError: any) {
          console.error('❌ КРИТИЧЕСКАЯ ОШИБКА МИКРОФОНА:', micError);
          microphoneStream = null;
          
          let errorMsg = "Микрофон недоступен";
          if (micError.name === 'NotAllowedError') {
            errorMsg = "Доступ к микрофону запрещён. Разрешите в браузере и попробуйте снова";
          } else if (micError.name === 'NotFoundError') {
            errorMsg = "Микрофон не найден. Подключите микрофон";
          } else if (micError.name === 'NotReadableError') {
            errorMsg = "Микрофон занят другим приложением";
          }
          
          // Показываем ошибку и ОСТАНАВЛИВАЕМ запись
          toast({
            title: "❌ Ошибка микрофона",
            description: errorMsg,
            variant: "destructive"
          });
          
          // Если пользователь хочет микрофон, но его нет - не записываем
          const continueWithoutMic = confirm(`Ошибка микрофона: ${errorMsg}\n\nПродолжить запись БЕЗ микрофона?`);
          if (!continueWithoutMic) {
            return; // Прерываем запись полностью
          }
        }
      }

      // 2. Запрашиваем доступ к экрану
      const displayMediaOptions: any = {
        video: {
          mediaSource: 'screen',
          width: { ideal: config.quality === 'high' ? 1920 : config.quality === 'medium' ? 1280 : 854 },
          height: { ideal: config.quality === 'high' ? 1080 : config.quality === 'medium' ? 720 : 480 },
          frameRate: { ideal: 30 }
        }
      };

      // Добавляем системный звук
      if (config.includeSystemAudio) {
        displayMediaOptions.audio = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 2,
          sampleRate: 44100
        };
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      console.log('✅ Экран захвачен:', {
        video: displayStream.getVideoTracks().length,
        audio: displayStream.getAudioTracks().length
      });

      // 3. Создаем финальный поток
      const finalStream = new MediaStream();
      
      // Добавляем видео
      displayStream.getVideoTracks().forEach(track => {
        finalStream.addTrack(track);
        console.log('📹 Добавлена видео дорожка:', track.label);
      });

      // 4. СУПЕР ПРОСТАЯ АУДИО ЛОГИКА
      const hasSystemAudio = config.includeSystemAudio && displayStream.getAudioTracks().length > 0;
      const hasMicrophoneAudio = config.includeAudio && microphoneStream && microphoneStream.getAudioTracks().length > 0;
      
      console.log('🔊 ФИНАЛЬНАЯ настройка аудио:', {
        wantSystemAudio: config.includeSystemAudio,
        wantMicrophoneAudio: config.includeAudio,
        hasSystemAudio,
        hasMicrophoneAudio,
        systemTracksCount: displayStream.getAudioTracks().length,
        micTracksCount: microphoneStream?.getAudioTracks().length || 0
      });
      
      // ПРОСТАЯ СТРАТЕГИЯ: Приоритет микрофону, потом системному звуку
      if (hasMicrophoneAudio) {
        console.log('🎤 ✅ ДОБАВЛЯЕМ МИКРОФОН (приоритет)');
        const micTracks = microphoneStream!.getAudioTracks();
        micTracks.forEach(track => {
          track.enabled = true;
          finalStream.addTrack(track);
          console.log(`🎤 ✅ Микрофон добавлен: ${track.label} (готов: ${track.readyState})`);
        });
        
        // Если есть и микрофон и системный звук, используем только микрофон для простоты
        if (hasSystemAudio) {
          console.log('🔊 ⚠️ Системный звук пропущен (микрофон имеет приоритет)');
        }
      } else if (hasSystemAudio) {
        console.log('🔊 ✅ ДОБАВЛЯЕМ СИСТЕМНЫЙ ЗВУК');
        const systemTracks = displayStream.getAudioTracks();
        systemTracks.forEach(track => {
          finalStream.addTrack(track);
          console.log(`🔊 ✅ Системный звук добавлен: ${track.label}`);
        });
      } else {
        console.log('🔇 ⚠️ НЕТ АУДИО - только видео');
      }

      streamRef.current = finalStream;

      // 5. Выбираем MIME тип с ОБЯЗАТЕЛЬНОЙ аудио поддержкой
      let mimeType;
      const hasAnyAudio = finalStream.getAudioTracks().length > 0;
      
      console.log('🎬 Выбор MIME типа:', {
        format: config.format,
        hasAudio: hasAnyAudio,
        audioTracksCount: finalStream.getAudioTracks().length,
        videoTracksCount: finalStream.getVideoTracks().length
      });
      
      if (config.format === 'webm') {
        // Приоритет форматам с аудио
        if (hasAnyAudio && MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
          mimeType = 'video/webm;codecs=vp9,opus';
          console.log('🎬 ✅ Выбран формат: video/webm;codecs=vp9,opus');
        } else if (hasAnyAudio && MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
          mimeType = 'video/webm;codecs=vp8,opus';
          console.log('🎬 ✅ Выбран формат: video/webm;codecs=vp8,opus');
        } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
          mimeType = 'video/webm;codecs=vp9';
          console.log('🎬 ⚠️ Выбран формат без аудио кодека: video/webm;codecs=vp9');
        } else {
          mimeType = 'video/webm';
          console.log('🎬 ⚠️ Выбран базовый формат: video/webm');
        }
      } else {
        if (hasAnyAudio && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E,mp4a.40.2')) {
          mimeType = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
          console.log('🎬 ✅ Выбран формат: video/mp4;codecs=avc1.42E01E,mp4a.40.2');
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4';
          console.log('🎬 ⚠️ Выбран базовый формат: video/mp4');
        } else {
          mimeType = 'video/webm'; // Fallback
          console.log('🎬 ⚠️ Fallback к video/webm');
        }
      }

      console.log('📹 Финальная конфигурация:', {
        mimeType,
        videoTracks: finalStream.getVideoTracks().length,
        audioTracks: finalStream.getAudioTracks().length,
        supportedType: MediaRecorder.isTypeSupported(mimeType)
      });

      // 6. Создаем MediaRecorder с улучшенными настройками
      const recorderOptions: MediaRecorderOptions = {
        mimeType: mimeType
      };
      
      // Добавляем битрейты только если формат поддерживает
      if (hasAnyAudio) {
        recorderOptions.audioBitsPerSecond = 320000; // Максимальное качество аудио для лучшей громкости
      }
      recorderOptions.videoBitsPerSecond = 2500000;
      
      console.log('🎬 Настройки MediaRecorder:', recorderOptions);
      
      const recorder = new MediaRecorder(finalStream, recorderOptions);

      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
          console.log('📊 Получен chunk данных:', event.data.size, 'байт');
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { 
          type: recorder.mimeType || 'video/webm' 
        });
        
        console.log('🎬 SETTING recordingBlob:', {
          blobSize: blob.size,
          blobType: blob.type,
          currentIsAdmin: isAdmin
        });
        
        setRecordingBlob(blob);
        
        // ПРИНУДИТЕЛЬНАЯ проверка состояния после установки blob
        setTimeout(() => {
          console.log('🎯 ПРИНУДИТЕЛЬНАЯ ПРОВЕРКА КНОПОК ПОСЛЕ SETRECORDINGBLOB:', {
            blobExists: !!blob,
            blobSize: blob.size,
            isAdminState: isAdmin,
            isRecordingState: isRecording,
            shouldShowButtons: !!blob && blob.size > 0 && !isRecording
          });
        }, 100);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `smm-tutorial-${timestamp}.${config.format}`;
        
        onRecordingComplete?.(blob, filename);
        
        console.log('✅ Запись завершена:', {
          size: `${(blob.size / 1024 / 1024).toFixed(1)} MB`,
          type: blob.type,
          chunks: chunksRef.current.length
        });
        
        // Очищаем ресурсы (audioContext будет очищен автоматически)
        
        toast({
          title: "Запись завершена!",
          description: `Видео готово к скачиванию (${(blob.size / 1024 / 1024).toFixed(1)} MB)`,
        });
      };

      recorder.onerror = (event) => {
        console.error('❌ Ошибка MediaRecorder:', event);
        toast({
          title: "Ошибка записи",
          description: "Произошла ошибка при записи видео",
          variant: "destructive"
        });
      };

      // Обработка окончания показа экрана
      displayStream.getVideoTracks()[0].onended = () => {
        console.log('🔚 Пользователь завершил показ экрана');
        stopRecording();
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // Сохраняем данные каждую секунду

      setIsRecording(true);
      setRecordingTime(0);

      // Запускаем таймер
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      const audioInfo = finalStream.getAudioTracks().length > 0 ? '+ звук' : 'без звука';
      toast({
        title: "Запись началась",
        description: `Записывается: видео ${audioInfo}`,
      });

    } catch (error) {
      console.error('❌ Ошибка начала записи:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось начать запись экрана",
        variant: "destructive"
      });
    }
  }, [config, onRecordingComplete, toast, checkMicrophonePermission]);

  // Остановить запись
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);

      // Останавливаем все треки
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          track.stop();
          console.log('🛑 Остановлена дорожка:', track.kind, track.label);
        });
      }

      // Останавливаем таймер
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      // Закрываем AudioContext для предотвращения утечек памяти
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
        console.log('🎤 ✅ AudioContext закрыт');
      }
    }
  }, [isRecording]);

  // Пауза/возобновление
  const togglePause = useCallback(() => {
    if (mediaRecorderRef.current) {
      if (isPaused) {
        mediaRecorderRef.current.resume();
        timerRef.current = setInterval(() => {
          setRecordingTime(prev => prev + 1);
        }, 1000);
      } else {
        mediaRecorderRef.current.pause();
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      }
      setIsPaused(!isPaused);
    }
  }, [isPaused]);

  // Скачать записанное видео
  const downloadRecording = useCallback(() => {
    if (recordingBlob) {
      const url = URL.createObjectURL(recordingBlob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `smm-tutorial-${Date.now()}.${config.format}`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }
  }, [recordingBlob, config.format]);

  // Форматирование времени
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="h-5 w-5" />
          Запись видео-инструкции
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ПРОВЕРКА МИКРОФОНА - ОБЯЗАТЕЛЬНО ПЕРЕД ЗАПИСЬЮ */}
        <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl space-y-4 shadow-lg">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-bold flex items-center gap-2 text-blue-800">
              <Mic className="h-6 w-6" />
              🎤 ПРОВЕРКА МИКРОФОНА
            </h4>
            <Badge 
              variant={hasAudioPermission ? "default" : "destructive"} 
              className={hasAudioPermission ? "bg-green-500 text-white" : "bg-red-500 text-white"}
            >
              {hasAudioPermission ? "✅ ГОТОВ" : "❌ НЕ НАСТРОЕН"}
            </Badge>
          </div>
          
          <div className="flex items-center gap-4 flex-wrap">
            <Button 
              onClick={checkMicrophonePermission}
              variant={hasAudioPermission ? "outline" : "default"}
              size="lg"
              disabled={isRecording || isTestingAudio}
              className={`px-6 py-3 text-base font-semibold ${
                hasAudioPermission 
                  ? "text-green-700 border-green-400 hover:bg-green-50" 
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              {hasAudioPermission ? (
                <>
                  <Mic className="h-5 w-5 mr-2 text-green-600" />
                  🔄 Проверить доступ заново
                </>
              ) : (
                <>
                  <MicOff className="h-5 w-5 mr-2" />
                  🔓 ПОЛУЧИТЬ ДОСТУП К МИКРОФОНУ
                </>
              )}
            </Button>
            
            <Button 
              onClick={testAudioRecording}
              variant={isTestingAudio ? "destructive" : "default"}
              size="lg"
              disabled={isRecording || !hasAudioPermission}
              className={`px-6 py-3 text-base font-semibold ${
                isTestingAudio 
                  ? "bg-red-600 hover:bg-red-700 text-white" 
                  : hasAudioPermission 
                    ? "bg-green-600 hover:bg-green-700 text-white" 
                    : "bg-gray-400 text-gray-600 cursor-not-allowed"
              }`}
            >
              {isTestingAudio ? (
                <>
                  <Square className="h-5 w-5 mr-2" />
                  ⏹️ ОСТАНОВИТЬ ТЕСТ
                </>
              ) : (
                <>
                  <Mic className="h-5 w-5 mr-2" />
                  🎙️ ТЕСТ ЗАПИСИ ЗВУКА
                </>
              )}
            </Button>
            
            {hasAudioPermission && !isTestingAudio && (
              <div className="flex items-center gap-2 px-4 py-2 bg-green-100 rounded-lg">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium text-green-800">
                  ✅ Микрофон готов к работе
                </span>
              </div>
            )}
            
            {!hasAudioPermission && (
              <div className="flex items-center gap-2 px-4 py-2 bg-red-100 rounded-lg">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <span className="text-sm font-medium text-red-800">
                  ❌ Требуется разрешение
                </span>
              </div>
            )}
          </div>
          
          {/* Регулятор громкости */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">🔊 Усиление громкости:</span>
              <span className="text-sm text-gray-600 dark:text-gray-400">{volumeGain.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.1"
              value={volumeGain}
              onChange={(e) => setVolumeGain(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
              disabled={isRecording || isTestingAudio}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              💡 Рекомендуется: 2.0-3.0 для четкого звука
            </p>
          </div>
          
          {/* Индикатор уровня звука во время теста */}
          {isTestingAudio && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Уровень звука:</span>
                <span className="text-sm text-gray-600 dark:text-gray-400">{Math.round(audioLevel)}%</span>
              </div>
              <Progress value={audioLevel} className="h-2" />
              <p className="text-xs text-gray-600 dark:text-gray-400">
                📢 Говорите в микрофон. Полоска должна двигаться при звуке
              </p>
            </div>
          )}
          
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {hasAudioPermission 
              ? "✅ Микрофон готов. Используйте 'Тест записи звука' чтобы проверить работу. При записи экрана также включите 'Поделиться звуком системы'" 
              : "⚠️ Нажмите 'Получить доступ' для разрешения использования микрофона"
            }
          </p>
        </div>

        {/* Настройки записи */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h4 className="font-semibold">Качество:</h4>
            <div className="flex gap-2">
              {(['low', 'medium', 'high'] as const).map((quality) => (
                <Button
                  key={quality}
                  variant={config.quality === quality ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setConfig(prev => ({ ...prev, quality }))}
                  disabled={isRecording}
                >
                  {quality === 'low' ? '480p' : quality === 'medium' ? '720p' : '1080p'}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold">Формат:</h4>
            <div className="flex gap-2">
              {(['webm', 'mp4'] as const).map((format) => (
                <Button
                  key={format}
                  variant={config.format === format ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setConfig(prev => ({ ...prev, format }))}
                  disabled={isRecording}
                >
                  {format.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Настройки аудио */}
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.includeAudio}
              onChange={(e) => setConfig(prev => ({ ...prev, includeAudio: e.target.checked }))}
              disabled={isRecording}
              className="rounded"
            />
            <Mic className="h-4 w-4" />
            Записывать с микрофона
          </label>
          
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.includeSystemAudio}
              onChange={(e) => setConfig(prev => ({ ...prev, includeSystemAudio: e.target.checked }))}
              disabled={isRecording}
              className="rounded"
            />
            <Monitor className="h-4 w-4" />
            Звук системы
          </label>
        </div>

        {/* Статус записи */}
        {isRecording && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                <span className="font-semibold text-red-700">
                  {isPaused ? 'Пауза' : 'Идет запись'}
                </span>
              </div>
              <Badge variant="outline" className="bg-white">
                {formatTime(recordingTime)}
              </Badge>
            </div>
            <Progress value={(recordingTime % 60) * 100 / 60} className="h-2" />
          </div>
        )}

        {/* Кнопки управления */}
        <div className="flex items-center gap-3">
          {!isRecording ? (
            <Button 
              onClick={startRecording} 
              className="bg-red-600 hover:bg-red-700"
              disabled={config.includeAudio && !hasAudioPermission}
            >
              <Video className="h-4 w-4 mr-2" />
              Начать запись
            </Button>
          ) : (
            <>
              <Button onClick={togglePause} variant="outline">
                {isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
                {isPaused ? 'Продолжить' : 'Пауза'}
              </Button>
              <Button onClick={stopRecording} variant="destructive">
                <Square className="h-4 w-4 mr-2" />
                Остановить
              </Button>
            </>
          )}

          {/* Логирование состояния вынесено в useEffect */}

          {/* Кнопка скачивания - показывается когда есть запись */}
          {recordingBlob && recordingBlob.size > 0 && !isRecording && (
            <Button onClick={downloadRecording} variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Скачать видео
            </Button>
          )}

          {/* Кнопка сохранения в документацию - ВСЕГДА для админов */}
          {isAdmin && (
                <Dialog open={showDocumentationDialog} onOpenChange={setShowDocumentationDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 dark:hover:bg-blue-900 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100">
                      <BookOpen className="h-4 w-4 mr-2" />
                      Сохранить в документацию
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>📹 Сохранить видео-инструкцию</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="title">Название</Label>
                        <Input
                          id="title"
                          placeholder="Начало работы с SMM Manager"
                          value={tutorialForm.title}
                          onChange={(e) => setTutorialForm({...tutorialForm, title: e.target.value})}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="description">Описание</Label>
                        <Textarea
                          id="description"
                          placeholder="Подробное описание инструкции..."
                          value={tutorialForm.description}
                          onChange={(e) => setTutorialForm({...tutorialForm, description: e.target.value})}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="category">Категория</Label>
                        <Select 
                          value={tutorialForm.category} 
                          onValueChange={(value) => setTutorialForm({...tutorialForm, category: value as any})}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="basics">Основы</SelectItem>
                            <SelectItem value="content">Контент</SelectItem>
                            <SelectItem value="publishing">Публикация</SelectItem>
                            <SelectItem value="analytics">Аналитика</SelectItem>
                            <SelectItem value="advanced">Продвинутое</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="flex gap-3 pt-4">
                        <Button 
                          onClick={saveToDocumentation} 
                          disabled={isUploadingToDocumentation || !tutorialForm.title}
                          className="flex-1"
                        >
                          {isUploadingToDocumentation ? (
                            <>
                              <Upload className="h-4 w-4 mr-2 animate-spin" />
                              Сохранение...
                            </>
                          ) : (
                            <>
                              <BookOpen className="h-4 w-4 mr-2" />
                              Сохранить
                            </>
                          )}
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={() => setShowDocumentationDialog(false)}
                          disabled={isUploadingToDocumentation}
                        >
                          Отмена
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
          )}
        </div>

        {/* Подсказки */}
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">💡 Советы для качественной записи:</h4>
          <ul className="text-sm space-y-1 text-gray-700 dark:text-gray-300">
            <li>• Обязательно нажмите "Проверить" микрофон перед записью</li>
            <li>• При выборе экрана включите опцию "Поделиться звуком системы"</li>
            <li>• Говорите четко и не торопитесь</li>
            <li>• Объясняйте каждое действие перед его выполнением</li>
            <li>• Делайте паузы между шагами</li>
            <li>• Используйте максимальное разрешение экрана</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
