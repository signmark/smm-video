import React, { forwardRef } from 'react';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';

interface DraggableWrapperProps {
  children: React.ReactNode;
  position?: { x: number; y: number };
  onDrag?: (e: DraggableEvent, data: DraggableData) => void | false;
  onStop?: (e: DraggableEvent, data: DraggableData) => void | false;
  disabled?: boolean;
  bounds?: string | { left?: number; top?: number; right?: number; bottom?: number };
  nodeRef?: React.RefObject<HTMLElement>;
  [key: string]: any;
}

/**
 * Безопасная обертка для react-draggable, которая устраняет warning findDOMNode
 * Использует nodeRef для избежания устаревшего API
 */
const DraggableWrapper = forwardRef<HTMLDivElement, DraggableWrapperProps>(
  ({ children, nodeRef, ...props }, ref) => {
    const internalRef = React.useRef<HTMLDivElement>(null);
    const draggableRef = nodeRef || internalRef;

    // Клонируем children и добавляем к ним ref
    const childrenWithRef = React.cloneElement(children as React.ReactElement, {
      ref: draggableRef
    });

    return (
      <Draggable nodeRef={draggableRef} {...props}>
        {childrenWithRef}
      </Draggable>
    );
  }
);

DraggableWrapper.displayName = 'DraggableWrapper';

export default DraggableWrapper;