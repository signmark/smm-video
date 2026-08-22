import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateRequest, CREATE_FORM_DEFAULTS, CLIP_DURATION_MODELS } from '../client/src/lib/create-request.ts';


/** Default form state — uses the same source of truth as Create.tsx. */
function defaults(overrides?: Record<string, unknown>) {
  return {
    ...CREATE_FORM_DEFAULTS,
    // Not part of CREATE_FORM_DEFAULTS: the real default is HEYGEN_AVATARS[0] in Create.tsx.
    heygenAvatar: 'Abigail Sofa Front',
    clipDurationModels: CLIP_DURATION_MODELS,
    ...overrides,
  };
}

describe('buildCreateRequest', () => {
  it('defaults: panels closed, topic mode — minimal body', () => {
    const body = buildCreateRequest(defaults({ topic: 'Продвижение продукта' }) as any);
    assert.equal(body.topic, 'Продвижение продукта');
    assert.equal(body.title, 'Продвижение продукта'); // falls back to topic
    assert.equal(body.format, '9:16');
    assert.equal(body.duration, 30);
    assert.equal(body.language, 'ru');
    assert.equal(body.animationModel, 'wan');
    assert.equal(body.subtitleStyle, 'karaoke');
    assert.equal(body.voice, 'alloy');
    assert.equal(body.musicStyle, 'ambient');
    assert.equal(body.musicVolume, 0.18);
    // clipDuration excluded for non-clip model
    assert.equal(body.clipDuration, undefined);
    // subtitle fields present when style !== 'none'
    assert.equal(body.subtitleFont, 'DejaVu Sans');
    assert.equal(body.subtitleSize, 'medium');
    assert.equal(body.subtitleColor, '#ffffff');
    // no scriptMode when standard
    assert.equal(body.scriptMode, undefined);
    // no optional fields
    assert.equal(body.customScenario, undefined);
    assert.equal(body.landingUrl, undefined);
    assert.equal(body.additionalDetails, undefined);
  });

  it('panels open with changed values: all fields populated', () => {
    const body = buildCreateRequest(defaults({
      inputMode: 'custom',
      customScenario: 'Ролик про новый продукт с демонстрацией функций',
      title: 'Мой ролик',
      format: '16:9',
      duration: 60,
      language: 'en',
      animationModel: 'kling',
      subtitleStyle: 'highlight',
      voice: 'nova',
      clipDuration: 5,
      subtitleFont: 'Arial',
      subtitleSize: 'large',
      subtitleColor: '#ff0000',
      musicStyle: 'corporate',
      musicVolume: 0.3,
      scriptMode: 'viral',
    }) as any);
    assert.equal(body.topic, 'Мой ролик'); // custom mode uses title
    assert.equal(body.title, 'Мой ролик');
    assert.equal(body.format, '16:9');
    assert.equal(body.duration, 60);
    assert.equal(body.language, 'en');
    assert.equal(body.animationModel, 'kling');
    assert.equal(body.subtitleStyle, 'highlight');
    assert.equal(body.voice, 'nova');
    assert.equal(body.clipDuration, 5); // kling is in clipDurationModels
    assert.equal(body.subtitleFont, 'Arial');
    assert.equal(body.subtitleSize, 'large');
    assert.equal(body.subtitleColor, '#ff0000');
    assert.equal(body.musicStyle, 'corporate');
    assert.equal(body.musicVolume, 0.3);
    assert.equal(body.scriptMode, 'viral');
    assert.equal(body.customScenario, 'Ролик про новый продукт с демонстрацией функций');
  });

  it('mutation: changing CREATE_FORM_DEFAULTS.musicStyle breaks this test', () => {
    // This test uses the shared constant, not a local copy.
    // If someone changes the default in create-request.ts, this test fails.
    const body = buildCreateRequest(defaults({ topic: 'test' }) as any);
    assert.equal(body.musicStyle, 'ambient');
  });

  it('subtitle fields omitted when style is none', () => {
    const body = buildCreateRequest(defaults({ subtitleStyle: 'none', topic: 'test' }) as any);
    assert.equal(body.subtitleStyle, 'none');
    assert.equal(body.subtitleFont, undefined);
    assert.equal(body.subtitleSize, undefined);
    assert.equal(body.subtitleColor, undefined);
  });

  it('musicVolume omitted when musicStyle is none', () => {
    const body = buildCreateRequest(defaults({ musicStyle: 'none', topic: 'test' }) as any);
    assert.equal(body.musicStyle, 'none');
    assert.equal(body.musicVolume, undefined);
  });

  it('heygenAvatar included only for heygen-avatar model', () => {
    const bodyHeygen = buildCreateRequest(defaults({ animationModel: 'heygen-avatar', heygenAvatar: 'anna', topic: 'test' }) as any);
    assert.equal(bodyHeygen.heygenAvatar, 'anna');

    const bodyWan = buildCreateRequest(defaults({ animationModel: 'wan', topic: 'test' }) as any);
    assert.equal(bodyWan.heygenAvatar, undefined);
  });

  it('url mode: landingUrl and topic fallback', () => {
    const body = buildCreateRequest(defaults({
      inputMode: 'url',
      landingUrl: 'https://example.com',
      title: '',
      topic: 'test',
    }) as any);
    assert.equal(body.landingUrl, 'https://example.com');
    assert.equal(body.topic, 'Промо-видео'); // defaultTitle for url mode
  });

  it('additionalDetails included only when non-empty', () => {
    const bodyWith = buildCreateRequest(defaults({ additionalDetails: 'Красный фон', topic: 'test' }) as any);
    assert.equal(bodyWith.additionalDetails, 'Красный фон');

    const bodyWithout = buildCreateRequest(defaults({ additionalDetails: '  ', topic: 'test' }) as any);
    assert.equal(bodyWithout.additionalDetails, undefined);
  });
});
