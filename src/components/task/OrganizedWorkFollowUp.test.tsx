import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { OrganizedWorkFollowUp, organizedOpenWork } from './OrganizedWorkFollowUp';
import type { OrganizationPreview } from '@/lib/task/organizationTypes';
const records=[{id:'r1',projectId:'p',status:'applied',createdAt:'2026-09-15',changes:[{taskId:'a',title:'古い名前'}]},{id:'r2',projectId:'p',status:'applied',createdAt:'2026-09-14',changes:[{taskId:'a',title:'古い名前'}]}] as OrganizationPreview[];
afterEach(cleanup);
it('deduplicates applied work, displays live state and disappears on completion',()=>{
 const task={id:'a',projectId:'p',title:'現在の名前',isCompleted:false,workState:{status:'hold' as const,reason:'返事待ち',resumeCondition:'返事が来たら',reviewAt:'2026-09-20'}};
 const props={records,tasks:[task],projects:[{id:'p',name:'展示会'}]};
 const {rerender}=render(<OrganizedWorkFollowUp {...props} />);
 expect(screen.getAllByRole('link')).toHaveLength(1);
 expect(screen.getByRole('link')).toHaveAttribute('href','/projects/p/board?task=a');
 expect(screen.getByText('現在の名前')).toBeVisible();expect(screen.queryByText('古い名前')).not.toBeInTheDocument();
 expect(screen.getByText('保留')).toBeVisible();expect(screen.getByText('見直し 2026-09-20')).toBeVisible();
 rerender(<OrganizedWorkFollowUp {...props} tasks={[{...task,isCompleted:true}]} />);
 expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
it('does not infer unfinished work from a missing snapshot or match the same task id in another project',()=>{
 expect(organizedOpenWork(records,[{id:'a',projectId:'q',title:'他の案件',isCompleted:false},{id:'a',projectId:'p',title:'状態不明'}])).toEqual([]);
 expect(organizedOpenWork(records,[{id:'a',projectId:'p',title:'中止',isCompleted:false,isAbandoned:true}])).toEqual([]);
});
