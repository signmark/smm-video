import React, { useState } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';

type GeneratedImage = {
  url: string;
  model: string;
};

const AiImageTester: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [model, setModel] = useState('schnell'); // По умолчанию используем быструю модель Schnell
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [numImages, setNumImages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [availableModels, setAvailableModels] = useState<Array<{id: string, name: string, description: string}>>([
    { id: 'schnell', name: 'Schnell', description: 'Быстрая базовая модель FAL.AI (рекомендуется)' },
    { id: 'fal-ai/fast-sdxl', name: 'Fast SDXL', description: 'Быстрая генерация с высоким качеством' },
    { id: 'fal-ai/lcm-sdxl', name: 'LCM-SDXL', description: 'Сверхбыстрая генерация (ниже качество)' },
    { id: 'rundiffusion-fal/juggernaut-flux-lora', name: 'Juggernaut Flux Lora', description: 'Высочайшее качество изображений' },
    { id: 'rundiffusion-fal/juggernaut-flux/lightning', name: 'Juggernaut Flux Lightning', description: 'Баланс скорости и качества' },
    { id: 'fal-ai/flux-lora', name: 'Flux Lora', description: 'Альтернативная Flux модель' },
    { id: 'fooocus', name: 'Fooocus', description: 'Продвинутая композиция' },
    { id: 'fal-ai/juggernaut-xl-v9', name: 'Juggernaut XL', description: 'Детализированные реалистичные изображения' },
    { id: 'fal-ai/illusion-xl-v1', name: 'Illusion XL', description: 'Художественные и креативные изображения' }
  ]);
  
  // Загружаем список моделей при монтировании компонента
  React.useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/fal-ai-models');
        if (response.data.success && Array.isArray(response.data.models)) {
          setAvailableModels(response.data.models);
        }
      } catch (err) {
        console.error('Failed to load AI models:', err);
      }
    };
    
    fetchModels();
  }, []);

  const generateImage = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setIsLoading(true);
    setError('');
    
    try {
      const response = await axios.post('/api/fal-ai-images', {
        prompt,
        negativePrompt: negativePrompt || undefined,
        width,
        height,
        numImages,
        model
      });

      if (response.data.success && Array.isArray(response.data.images)) {
        const images = response.data.images.map((url: string) => ({
          url,
          model
        }));
        
        setGeneratedImages([...images, ...generatedImages].slice(0, 10)); // Отображаем максимум 10 изображений
      } else {
        setError('No images were generated. Try a different prompt or model.');
      }
    } catch (err: any) {
      setError(`Error: ${err.response?.data?.error || err.message || 'Unknown error occurred'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">AI Image Generator</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Generate Image</CardTitle>
            <CardDescription>
              Use the FAL.AI API to generate images from text prompts
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} - {m.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                placeholder="Enter your prompt here..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="negativePrompt">Negative Prompt (optional)</Label>
              <Textarea
                id="negativePrompt"
                placeholder="Elements to exclude from the image..."
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label>Image Size: {width}x{height}</Label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="width">Width</Label>
                  <Slider 
                    id="width"
                    min={512} 
                    max={1536} 
                    step={64} 
                    value={[width]} 
                    onValueChange={(value) => setWidth(value[0])} 
                  />
                </div>
                <div>
                  <Label htmlFor="height">Height</Label>
                  <Slider 
                    id="height"
                    min={512} 
                    max={1536} 
                    step={64} 
                    value={[height]} 
                    onValueChange={(value) => setHeight(value[0])} 
                  />
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="numImages">Number of Images: {numImages}</Label>
              <Slider 
                id="numImages"
                min={1} 
                max={4} 
                step={1} 
                value={[numImages]} 
                onValueChange={(value) => setNumImages(value[0])} 
              />
            </div>
          </CardContent>
          
          <CardFooter>
            <Button 
              onClick={generateImage} 
              disabled={isLoading || !prompt.trim()}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate Image'
              )}
            </Button>
          </CardFooter>
        </Card>
        
        <div className="col-span-1">
          <h2 className="text-xl font-semibold mb-4">Generated Images</h2>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
          <div className="space-y-4">
            {generatedImages.length === 0 && !isLoading ? (
              <div className="text-center p-8 bg-gray-100 rounded-lg">
                No images generated yet. Enter a prompt and click Generate!
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {generatedImages.map((image, index) => (
                  <div key={index} className="rounded-lg overflow-hidden border">
                    <img
                      src={image.url}
                      alt={`Generated image ${index + 1}`}
                      className="w-full h-auto"
                    />
                    <div className="p-2 bg-gray-100 text-xs text-gray-700">
                      Model: {availableModels.find(m => m.id === image.model)?.name || image.model}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiImageTester;