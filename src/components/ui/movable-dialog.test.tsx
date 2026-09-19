import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog } from './dialog';
import { MovableDialogContent } from './movable-dialog';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('moves with the keyboard, stays reachable, resets to center and leaves body input alone',()=>{
 render(<Dialog open><MovableDialogContent title="整理" description="説明"><input aria-label="メモ" /></MovableDialogContent></Dialog>);
 const dialog=screen.getByRole('dialog');
 vi.spyOn(dialog,'getBoundingClientRect').mockImplementation(()=>({left:parseFloat(dialog.style.left)||100,top:parseFloat(dialog.style.top)||100,width:600,height:400} as DOMRect));
 const handle=screen.getByRole('button',{name:'画面を移動'});
 fireEvent.keyDown(handle,{key:'ArrowRight'});expect(dialog.style.left).toBe('120px');
 fireEvent.keyDown(screen.getByLabelText('メモ'),{key:'ArrowRight'});expect(dialog.style.left).toBe('120px');
 for(let i=0;i<20;i++)fireEvent.keyDown(handle,{key:'ArrowUp',shiftKey:true});
 expect(dialog.style.top).toBe('8px');
 fireEvent.keyDown(handle,{key:'Home'});expect(dialog.style.left).toBe('');expect(dialog.style.translate).toBe('');
});
