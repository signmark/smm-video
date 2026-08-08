import React from 'react';

/**
 * AI-86: Unified page content wrapper for consistent loading states.
 *
 * Rules:
 * 1. Frame (header, filters, buttons) renders immediately — they don't depend on data.
 * 2. Placeholder only in the data area, never a full-page spinner.
 * 3. Counters don't show 0 until response arrives (use undefined, not 0).
 * 4. Loading and empty are different states — never show both simultaneously.
 *
 * Usage:
 *   <PageContent isLoading={isLoading} isEmpty={data?.length === 0}>
 *     {data.map(item => <Row key={item.id} />)}
 *   </PageContent>
 */

interface PageContentProps {
  isLoading: boolean;
  isEmpty: boolean;
  children: React.ReactNode;
  emptyMessage?: string;
}

export function PageContent({
  isLoading,
  isEmpty,
  children,
  emptyMessage = 'Нет данных',
}: PageContentProps) {
  // Both loading and "has data" — show data (may be stale-while-revalidate)
  if (!isLoading && !isEmpty) {
    return <>{children}</>;
  }

  // Loading with unknown emptiness — show skeleton
  if (isLoading && !isEmpty) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-muted/40 rounded-lg" />
        ))}
      </div>
    );
  }

  // Loading but we already know it's empty (shouldn't happen per rule 4)
  // or: not loading and empty — show empty state
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
      <p className="text-muted-foreground">{emptyMessage}</p>
    </div>
  );
}
