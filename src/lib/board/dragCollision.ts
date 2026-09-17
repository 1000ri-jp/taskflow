import { pointerWithin, rectIntersection, type CollisionDetection } from '@dnd-kit/core';

/** A mouse drop follows the pointer, even when most of the card remains in its old column. */
export function boardDragCollision(args: Parameters<CollisionDetection>[0], listIds: readonly string[]) {
  const candidates = args.active.data.current?.type === 'list'
    ? { ...args, droppableContainers: args.droppableContainers.filter(container => listIds.includes(String(container.id))) }
    : args;
  // Pointer drops outside the board must not fall back to an overlapping card.
  // Keyboard dragging has no pointer, so it uses the translated card rectangle.
  return args.pointerCoordinates ? pointerWithin(candidates) : rectIntersection(candidates);
}
