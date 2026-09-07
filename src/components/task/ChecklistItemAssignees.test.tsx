import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChecklistItemAssignees } from './ChecklistItemAssignees';
import { CHECKLIST_ASSIGNEE_STORAGE_KEY as KEY, useChecklistAssigneeStore as store, type ChecklistAssigneeScope } from '@/stores/checklistAssigneeStore';
const scope:ChecklistAssigneeScope=['v','p','t','c','i'];
const members={users:[{id:'a',displayName:'こずえ'},{id:'b',displayName:'かおり'}],isLoading:false,hasError:false};
const ui=(options={})=><ChecklistItemAssignees scope={scope} itemText="チケット購入" members={members} disabled={false} {...options}/>;
describe('ChecklistItemAssignees', () => {
  beforeEach(() => {vi.restoreAllMocks();localStorage.removeItem(KEY);store.setState({byItem:{},hydrated:true,persistenceFailed:false});});
  it('selects multiple members, restores the saved IDs, and clears only this item', () => {
    const {unmount}=render(ui());
    fireEvent.click(screen.getByRole('button',{name:'チケット購入の担当者（このブラウザのみ）'}));
    fireEvent.click(screen.getByRole('checkbox',{name:'こずえ'}));fireEvent.click(screen.getByRole('checkbox',{name:'かおり'}));
    expect(screen.getByRole('button',{name:'チケット購入の担当者（このブラウザのみ）'})).not.toHaveTextContent('こずえ・かおり');
    expect(screen.getByTitle('こずえ')).toBeInTheDocument();
    unmount();store.setState({byItem:{}});store.getState().hydrate();render(ui());
    fireEvent.click(screen.getByRole('button',{name:'チケット購入の担当者（このブラウザのみ）'}));
    expect(screen.getByRole('checkbox',{name:'こずえ'})).toBeChecked();
    expect(screen.getByRole('checkbox',{name:'かおり'})).toBeChecked();
    fireEvent.click(screen.getByRole('button',{name:'担当者を解除'}));
    expect(screen.getByRole('checkbox',{name:'こずえ'})).not.toBeChecked();
  });
  it('does not offer members from a prior failed/loading scope', () => {
    render(ui({members:{...members,users:[],hasError:true}}));
    fireEvent.click(screen.getByRole('button',{name:'チケット購入の担当者（このブラウザのみ）'}));
    expect(screen.getByRole('alert')).toHaveTextContent('メンバーを取得できません');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
  it('shows a warning if browser persistence fails without losing current selections', () => {
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
    render(ui());fireEvent.click(screen.getByRole('button',{name:'チケット購入の担当者（このブラウザのみ）'}));
    fireEvent.click(screen.getByRole('checkbox',{name:'こずえ'}));
    expect(screen.getByRole('alert')).toHaveTextContent('ブラウザに保存できません');
    expect(screen.getByRole('checkbox',{name:'こずえ'})).toBeChecked();
  });
});
