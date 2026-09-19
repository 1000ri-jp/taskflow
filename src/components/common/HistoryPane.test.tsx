import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HistoryPane } from './HistoryPane';

let containerWidth = 800;
let onResize: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  containerWidth = 800;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: containerWidth } as DOMRect));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { onResize = callback; }
    observe() {} disconnect = disconnect;
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = () => render(<HistoryPane label="通知履歴" list={<button>選んだ通知</button>}><textarea aria-label="下書き" defaultValue="途中の文" /></HistoryPane>);

it('resizes by dragging, preserves the reading area and stops on pointer release', () => {
  mount(); const divider = screen.getByRole('separator', { name: '通知履歴と本文の幅を調整' });
  fireEvent.pointerDown(divider, { pointerId: 1, button: 0, clientX: 200 });
  fireEvent.pointerMove(divider, { pointerId: 2, clientX: 600 });
  expect(divider).toHaveAttribute('aria-valuenow', '176');
  fireEvent.pointerMove(divider, { pointerId: 1, clientX: 320 });
  expect(divider).toHaveAttribute('aria-valuenow', '296');
  fireEvent.pointerUp(divider, { pointerId: 1 });
  fireEvent.pointerMove(divider, { pointerId: 1, clientX: 350 });
  expect(divider).toHaveAttribute('aria-valuenow', '296');
  expect(screen.getByRole('textbox')).toHaveValue('途中の文');
});

it('keeps space for the body and supports keyboard, reset and cancelled drags', () => {
  mount(); const divider = screen.getByRole('separator');
  fireEvent.keyDown(divider, { key: 'End' }); expect(divider).toHaveAttribute('aria-valuenow', '552');
  fireEvent.keyDown(divider, { key: 'ArrowRight' }); expect(divider).toHaveAttribute('aria-valuenow', '552');
  fireEvent.keyDown(divider, { key: 'Home' }); expect(divider).toHaveAttribute('aria-valuenow', '96');
  fireEvent.keyDown(divider, { key: 'ArrowLeft' }); expect(divider).toHaveAttribute('aria-valuenow', '96');
  fireEvent.keyDown(divider, { key: 'ArrowRight', shiftKey: true }); expect(divider).toHaveAttribute('aria-valuenow', '128');
  fireEvent.doubleClick(divider); expect(divider).toHaveAttribute('aria-valuenow', '176');
  fireEvent.pointerDown(divider, { pointerId: 1, button: 0, clientX: 200 });
  fireEvent.pointerCancel(divider, { pointerId: 1 });
  fireEvent.pointerMove(divider, { pointerId: 1, clientX: 400 });
  expect(divider).toHaveAttribute('aria-valuenow', '176');
});

it('constrains the list when the outer panel shrinks and restores its preference when widened', () => {
  const ui = mount(); const divider = screen.getByRole('separator');
  fireEvent.keyDown(divider, { key: 'End' });
  act(() => { containerWidth = 600; onResize(); });
  expect(divider).toHaveAttribute('aria-valuenow', '352');
  act(() => { containerWidth = 800; onResize(); });
  expect(divider).toHaveAttribute('aria-valuenow', '552');
  ui.unmount(); expect(disconnect).toHaveBeenCalled();
});
