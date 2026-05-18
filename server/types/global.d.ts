import { EventEmitter } from 'events';

declare global {
  var directusEventEmitter: EventEmitter;
}

export {};