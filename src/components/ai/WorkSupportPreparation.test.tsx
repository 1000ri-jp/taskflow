import {fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {WorkSupportPreparation} from './WorkSupportPreparation';
import {requestWorkSupport} from '@/lib/ai/support/workClient';
import {viewTask} from '@/test/taskViewFixtures';
vi.mock('@/lib/ai/support/workClient',()=>({requestWorkSupport:vi.fn()}));
vi.mock('@/stores/aiSettingsStore',()=>({useAISettingsStore:()=>({provider:'gemini',getActiveModel:()=> 'model'})}));
const task=viewTask({id:'work',assigneeIds:['worker']});
const props={task,tasks:[task],userId:'worker',purpose:'展示会の準備',preferenceKey:'one',once:'もっと短く',onConsumed:vi.fn(),disabled:false};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(requestWorkSupport).mockResolvedValue({text:'確認する点を用意しました',role:'作業担当',intent:'着手',preparedAt:'2026-09-13'});});
it('prepares for the selected work without typing context and consumes a once-only instruction on success',async()=>{
 const ui=render(<WorkSupportPreparation {...props}/>);
 expect(requestWorkSupport).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'AIで次の一歩を整理'}));
 await screen.findByText('確認する点を用意しました');expect(requestWorkSupport).toHaveBeenCalledExactlyOnceWith('worker','project-1','work','gemini','model','もっと短く');expect(props.onConsumed).toHaveBeenCalledOnce();
 ui.rerender(<WorkSupportPreparation {...props} preferenceKey="changed"/>);expect(screen.queryByText('確認する点を用意しました')).not.toBeInTheDocument();
});
it('keeps the once-only instruction available on failure and never shows late content after source or permission changes',async()=>{
 vi.mocked(requestWorkSupport).mockRejectedValueOnce(new Error('接続できません'));
 const ui=render(<WorkSupportPreparation {...props}/>);fireEvent.click(screen.getByRole('button',{name:'AIで次の一歩を整理'}));await screen.findByRole('alert');expect(props.onConsumed).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'AIで次の一歩を整理'}));await screen.findByText('確認する点を用意しました');
 ui.rerender(<WorkSupportPreparation {...props} disabled/>);expect(screen.queryByText('確認する点を用意しました')).not.toBeInTheDocument();
});
