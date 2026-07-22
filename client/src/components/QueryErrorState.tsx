import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  classifyQueryError,
  type ClassifiedQueryError,
} from '@/lib/query-error-classification';

interface QueryErrorStateProps {
  error: unknown;
  onRetry: () => void;
  /** True while a refetch is in flight — disables the retry button to prevent double-clicks. */
  isRefetching?: boolean;
  /** Optional override for the user-facing message; default uses the classifier output. */
  message?: string;
  /** Optional retry button label, default "Повторить". */
  retryLabel?: string;
  /** Optional title (e.g. context-specific), default uses generic error header. */
  title?: string;
  /** Variant: "card" (default, full-bleed) or "inline" (compact, fits inside another card). */
  variant?: 'card' | 'inline';
  /** Optional test id for the root element. */
  testId?: string;
}

/**
 * Renders a user-facing error state that **always** takes precedence over
 * empty/loading placeholders. The original server error is intentionally not
 * rendered — see `classifyQueryError` for details.
 */
export function QueryErrorState({
  error,
  onRetry,
  isRefetching = false,
  message,
  retryLabel = 'Повторить',
  title = 'Не удалось загрузить данные',
  variant = 'card',
  testId,
}: QueryErrorStateProps) {
  const classified: ClassifiedQueryError = React.useMemo(
    () => classifyQueryError(error),
    [error],
  );
  const displayMessage = message ?? classified.userMessage;

  if (variant === 'inline') {
    return (
      <div
        className="p-4 border rounded-lg bg-destructive/10 border-destructive/20 text-sm"
        data-testid={testId ?? 'query-error-inline'}
        role="alert"
      >
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-destructive">{title}</p>
            {displayMessage ? (
              <p className="text-muted-foreground mt-1">{displayMessage}</p>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={onRetry}
              disabled={isRefetching}
              data-testid="query-error-retry"
            >
              {isRefetching ? 'Загрузка...' : retryLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 p-8 text-center border rounded-lg bg-destructive/5 border-destructive/20 my-4"
      data-testid={testId ?? 'query-error-card'}
      role="alert"
    >
      <AlertCircle className="h-8 w-8 text-destructive" />
      <div>
        <p className="font-medium text-destructive mb-1">{title}</p>
        {displayMessage ? (
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {displayMessage}
          </p>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onRetry}
        disabled={isRefetching}
        data-testid="query-error-retry"
      >
        {isRefetching ? 'Загрузка...' : retryLabel}
      </Button>
    </div>
  );
}
