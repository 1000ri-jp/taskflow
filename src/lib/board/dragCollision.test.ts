import { describe, expect, it } from 'vitest';
import { rectIntersection, type CollisionDetection } from '@dnd-kit/core';
import { boardDragCollision } from './dragCollision';

type Args = Parameters<CollisionDetection>[0];
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height });
function scenario(pointerCoordinates: Args['pointerCoordinates'], collisionRect = rect(340, 90, 240, 60), type = 'task'): Args {
  const boxes = new Map([
    ['source', rect(0, 0, 300, 400)],
    ['list-source', rect(0, 60, 300, 340)],
    ['moving', rect(10, 90, 240, 60)],
    ['target', rect(320, 0, 300, 400)],
    ['list-target', rect(320, 60, 300, 340)],
    ['target-card', rect(340, 90, 240, 60)],
    ['empty', rect(640, 0, 300, 400)],
    ['list-empty', rect(640, 60, 300, 340)],
  ]);
  return {
    active: { id: type === 'list' ? 'source' : 'moving', data: { current: { type } }, rect: { current: { initial: boxes.get('moving')!, translated: collisionRect } } },
    collisionRect, pointerCoordinates, droppableRects: boxes,
    droppableContainers: [...boxes].map(([id, box]) => ({ id, key: id, disabled: false, node: { current: null }, rect: { current: box }, data: { current: {} } })),
  };
}
const listIds = ['source', 'target', 'empty'];
describe('Kanban drop targets', () => {
  it('chooses the column under the pointer when dragging from the right edge of a card', () => {
    const args = scenario({ x: 345, y: 115 }, rect(105, 90, 240, 60));
    expect(rectIntersection(args)[0].id).toBe('moving');
    expect(boardDragCollision(args, listIds)[0].id).toBe('target-card');
  });
  it('accepts an empty column even if the card still mostly overlaps the previous column', () => {
    const args = scenario({ x: 650, y: 115 }, rect(410, 90, 240, 60));
    expect(rectIntersection(args)[0].id).toBe('target-card');
    expect(['empty', 'list-empty']).toContain(boardDragCollision(args, listIds)[0].id);
  });
  it('does not drop onto a card when the mouse is outside all columns or in the gap', () => {
    for (const point of [{ x: 310, y: 115 }, { x: 500, y: 430 }]) {
      const args = scenario(point);
      expect(rectIntersection(args).length).toBeGreaterThan(0);
      expect(boardDragCollision(args, listIds)).toEqual([]);
    }
  });
  it('retains rectangle-based keyboard dragging', () => {
    const args = scenario(null);
    expect(boardDragCollision(args, listIds)[0].id).toBe('target-card');
  });
  it('keeps list moves separate from the task cards and inner drop zones', () => {
    const mouse = scenario({ x: 345, y: 115 }, undefined, 'list');
    expect(boardDragCollision(mouse, listIds).map(item => item.id)).toEqual(['target']);
    const keyboard = scenario(null, undefined, 'list');
    expect(boardDragCollision(keyboard, listIds).map(item => item.id)).toEqual(['target']);
  });
});
