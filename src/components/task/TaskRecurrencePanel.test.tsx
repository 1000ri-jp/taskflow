import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TaskRecurrencePanel } from './TaskRecurrencePanel';
import type { List, Task } from '@/types';
const send=vi.hoisted(()=>vi.fn());vi.mock('@/lib/task/recurrenceClient',()=>({recurrenceRequest:send}));
const task={id:'t',projectId:'p',listId:'todo',updatedAt:new Date('2026-01-20'),dueDate:new Date('2026-01-31T00:00:00+09:00')} as Task;
const lists=[{id:'todo',name:'仕事'},{id:'done',name:'完了',autoCompleteOnEnter:true}] as List[];
beforeEach(()=>send.mockReset());
it('previews the next date and preserves editable input and request identity after a failed save',async()=>{
 send.mockRejectedValueOnce(new Error('通信に失敗しました。')).mockResolvedValue(undefined);
 render(<TaskRecurrencePanel task={task} lists={lists}/>);fireEvent.click(screen.getByRole('button',{name:'繰り返し'}));
 expect(screen.getByText('次回の期限：2026-02-28')).toBeVisible();expect(screen.queryByRole('option',{name:'完了'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'保存'}));expect(await screen.findByRole('alert')).toHaveTextContent('通信に失敗');
 expect(screen.getByLabelText('基準日（今回分）')).toHaveValue('2026-01-31');
 fireEvent.click(screen.getByRole('button',{name:'保存'}));await waitFor(()=>expect(send).toHaveBeenCalledTimes(2));expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);expect(await screen.findByRole('status')).toHaveTextContent('保存しました');
});
