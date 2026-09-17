import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import type {Notification} from '@/types';
import {CompanionLauncher} from './CompanionLauncher';
const state=vi.hoisted(()=>({notifications:[] as Notification[],isLoading:false,error:null,unreadCount:1,markAsRead:vi.fn().mockResolvedValue(undefined)}));
const push=vi.hoisted(()=>vi.fn());
vi.mock('@/hooks/useNotifications',()=>({useNotifications:()=>state}));
vi.mock('next/navigation',()=>({useRouter:()=>({push})}));
vi.mock('@/hooks/useCompanionSchedule',()=>({useCompanionSchedule:()=>({greeting:null,dismiss:vi.fn()})}));
const props={userId:'u',isOpen:false,busy:false,onToggle:vi.fn(),onOpenNotifications:vi.fn()};
const request:Notification={id:'review',userId:'u',senderId:'v',senderName:'同僚',type:'review_requested',title:'確認依頼',message:'公開してよいか確認してください',taskName:'案内文',projectId:'p',taskId:'t',isRead:false,createdAt:new Date('2026-09-14T01:00:00Z'),data:{requiresResponse:true,urgency:'urgent',commentId:'comment',sourceTaskId:'t'}};
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();localStorage.clear();state.notifications=[request];});
afterEach(()=>vi.useRealTimers());
it('opens explicit urgent requests once, later keeps an unread bubble, read never submits an answer',async()=>{
 const ui=render(<CompanionLauncher {...props}/>);await act(async()=>{});
 expect(screen.getByRole('dialog')).toHaveTextContent('公開してよいか');
 fireEvent.click(screen.getByRole('button',{name:'あとで'}));expect(screen.queryByRole('dialog')).toBeNull();expect(state.markAsRead).not.toHaveBeenCalled();
 ui.unmount();render(<CompanionLauncher {...props}/>);await act(async()=>{});expect(screen.queryByRole('dialog')).toBeNull();
 expect(screen.getByRole('status')).toHaveTextContent('確認してほしい');expect(screen.queryByRole('button',{name:'吹き出しを閉じる'})).toBeNull();
 fireEvent.click(screen.getAllByRole('button',{name:'未読の通知1件を開く'})[0]);expect(state.markAsRead).toHaveBeenCalledWith('review');expect(push).toHaveBeenCalledWith(expect.stringContaining('comment=comment'));expect(request.data?.requiresResponse).toBe(true);
});
it('does not open a popup for AI-inferred priority, own requests, read or answered requests',async()=>{
 state.notifications=[{...request,id:'regular',data:{requiresResponse:true}},{...request,id:'own',senderId:'u'},{...request,id:'read',isRead:true},{...request,id:'answered',data:{urgency:'urgent',requiresResponse:false}}];
 render(<CompanionLauncher {...props}/>);await act(async()=>{});expect(screen.queryByRole('dialog')).toBeNull();
});
it('groups several urgent requests and isolates dismissed state by recipient',async()=>{
 state.notifications=[request,{...request,id:'review2',taskName:'名刺'}];const ui=render(<CompanionLauncher {...props}/>);await act(async()=>{});
 expect(screen.getAllByRole('button',{name:'依頼を見る'})).toHaveLength(2);fireEvent.click(screen.getByRole('button',{name:'あとで'}));
 state.notifications=[{...request,userId:'other'}];ui.rerender(<CompanionLauncher {...props} userId="other"/>);await act(async()=>{});expect(screen.getByRole('dialog')).toBeVisible();
});
