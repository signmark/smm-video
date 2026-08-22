/**
 * Pure function: build the request body for POST /videos.
 *
 * Extracted from Create.tsx so that collapsible panels cannot silently
 * change what is sent to the server.  The component collects form state;
 * this function maps it to the API contract.
 */

export interface CreateRequestInput {
  /** 'topic' | 'custom' | 'url' */
  inputMode: 'topic' | 'custom' | 'url';
  topic: string;
  customScenario: string;
  landingUrl: string;
  additionalDetails: string;
  title: string;
  format: string;
  duration: number;
  language: 'ru' | 'en';
  animationModel: string;
  heygenAvatar: string;
  subtitleStyle: string;
  voice: string;
  clipDuration: 5 | 10;
  subtitleFont: string;
  subtitleSize: string;
  subtitleColor: string;
  musicStyle: string;
  musicVolume: number;
  scriptMode: 'standard' | 'viral';
  /** Models that support clip duration selection */
  clipDurationModels: Set<string>;
}

export interface CreateRequestBody {
  title: string;
  format: string;
  duration: number;
  language: 'ru' | 'en';
  animationModel: string;
  heygenAvatar?: string;
  subtitleStyle: string;
  voice: string;
  clipDuration?: 5 | 10;
  subtitleFont?: string;
  subtitleSize?: string;
  subtitleColor?: string;
  musicStyle: string;
  musicVolume?: number;
  topic: string;
  customScenario?: string;
  landingUrl?: string;
  additionalDetails?: string;
  scriptMode?: 'viral';
}

export function buildCreateRequest(input: CreateRequestInput): CreateRequestBody {
  const {
    inputMode, topic, customScenario, landingUrl, additionalDetails,
    title, format, duration, language, animationModel, heygenAvatar,
    subtitleStyle, voice, clipDuration, subtitleFont, subtitleSize,
    subtitleColor, musicStyle, musicVolume, scriptMode, clipDurationModels,
  } = input;

  const defaultTitle =
    inputMode === 'custom' ? 'Пользовательский сценарий'
    : inputMode === 'url' ? 'Промо-видео'
    : topic.trim();

  const body: CreateRequestBody = {
    title: title.trim() || defaultTitle,
    format,
    duration,
    language,
    animationModel,
    heygenAvatar: animationModel === 'heygen-avatar' ? heygenAvatar : undefined,
    subtitleStyle,
    voice,
    clipDuration: clipDurationModels.has(animationModel) ? clipDuration : undefined,
    subtitleFont: subtitleStyle !== 'none' ? subtitleFont : undefined,
    subtitleSize: subtitleStyle !== 'none' ? subtitleSize : undefined,
    subtitleColor: subtitleStyle !== 'none' ? subtitleColor : undefined,
    musicStyle,
    musicVolume: musicStyle !== 'none' ? musicVolume : undefined,
    topic: '',
  };

  if (inputMode === 'custom') {
    body.customScenario = customScenario.trim();
    body.topic = title.trim() || 'Пользовательский сценарий';
  } else if (inputMode === 'url') {
    body.landingUrl = landingUrl.trim();
    body.topic = title.trim() || defaultTitle;
    if (additionalDetails.trim()) body.additionalDetails = additionalDetails.trim();
  } else {
    body.topic = topic.trim();
    if (additionalDetails.trim()) body.additionalDetails = additionalDetails.trim();
  }

  if (scriptMode === 'viral') body.scriptMode = 'viral';

  return body;
}
