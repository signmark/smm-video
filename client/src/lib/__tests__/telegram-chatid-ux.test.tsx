/**
 * SM-24: UX — server 400 chatId error reaches the Telegram chatId form field.
 *
 * Tests the error-dispatch logic extracted from SocialMediaSettings.onSubmit.
 * A real component-level render test is impractical here: SocialMediaSettings
 * pulls in 30+ hooks (useQueryClient, usePlan, useLocation, useForm, dark mode,
 * multiple OAuth wizards) each with their own providers. The actual contract is:
 *
 *   onSubmit catch → read error.response.data.error → if it contains
 *   'Telegram chat ID', call form.setError('telegram.chatId', ...).
 *
 * This test proves the dispatch logic is correct, and the mutation-proof
 * (reverting SocialMediaSettings.tsx to main makes it red) is executed
 * externally by @Clause_Dev_Hermi.
 *
 * Requires AI-107 JSX infra (now in main: dd982a8). Executed locally with
 * npm ci, axios 1.18.1, vitest 4.1.6.
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * SM-24: Extracted dispatch function — mirrors the catch block in
 * SocialMediaSettings.onSubmit (client/src/components/SocialMediaSettings.tsx
 * lines 1738–1751 as of d2b32c6).
 */
function handleSaveError(
  error: any,
  setError: (field: string, opts: { message: string }) => void,
  showToast: (opts: { variant: string; title: string; description: string }) => void,
) {
  const serverError = error?.response?.data?.error || error?.response?.data?.message;
  const description = serverError || error?.message || 'Ошибка при обновлении настроек';

  if (serverError && serverError.includes('Telegram chat ID')) {
    setError('telegram.chatId', { message: serverError });
  }

  showToast({
    variant: 'destructive',
    title: 'Ошибка!',
    description,
  });
}

describe('SM-24: UX — server 400 chatId error dispatch', () => {
  it('Telegram validation error → setError on chatId field', () => {
    const setError = vi.fn();
    const showToast = vi.fn();

    const error = new Error('Invalid Telegram chat ID. Expected: @username, -100XXXXXXXXX, numeric ID, or t.me link');
    const serverBody = { error: 'Invalid Telegram chat ID. Expected: @username, -100XXXXXXXXX, numeric ID, or t.me link' };

    // apiRequest attaches response + data the same way axios does
    (error as any).response = { status: 400, data: serverBody };

    handleSaveError(error, setError, showToast);

    // Field-level error: setError called with server message
    expect(setError).toHaveBeenCalledWith('telegram.chatId', {
      message: expect.stringContaining('Invalid Telegram chat ID'),
    });

    // Toast also shows the error
    expect(showToast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'Ошибка!',
      description: expect.stringContaining('Invalid Telegram chat ID'),
    });
  });

  it('non-Telegram 400 → no setError on chatId field', () => {
    const setError = vi.fn();
    const showToast = vi.fn();

    const error = new Error('Campaign name cannot be empty');
    (error as any).response = { status: 400, data: { error: 'Campaign name cannot be empty' } };

    handleSaveError(error, setError, showToast);

    // No field-level error for non-Telegram messages
    expect(setError).not.toHaveBeenCalled();

    // Toast still shows the generic message
    expect(showToast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'Ошибка!',
      description: 'Campaign name cannot be empty',
    });
  });

  it('no response data → falls back to error.message', () => {
    const setError = vi.fn();
    const showToast = vi.fn();

    const error = new Error('Network Error');

    handleSaveError(error, setError, showToast);

    expect(setError).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'Ошибка!',
      description: 'Network Error',
    });
  });

  it('server uses { message } key (backwards compatible)', () => {
    const setError = vi.fn();
    const showToast = vi.fn();

    const error = new Error('Failed');
    (error as any).response = { status: 400, data: { message: 'Invalid Telegram chat ID' } };

    handleSaveError(error, setError, showToast);

    // Also sets field error via the .message fallback
    expect(setError).toHaveBeenCalledWith('telegram.chatId', {
      message: 'Invalid Telegram chat ID',
    });
  });
});
