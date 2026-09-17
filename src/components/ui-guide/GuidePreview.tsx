'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { CalendarDays, Check, List, MoreHorizontal, Sparkles, Sunrise } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PageHeading, Prose, HelpText } from '@/components/ui/typography';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ControlHint } from '@/components/ui/control-hint';
import { AsyncState } from '@/components/ui/async-state';
import { SettingField, settingSelect } from '@/components/ui/setting-field';
import { SettingsLayout, DetailFrame, DetailBody, detailHeader, detailContent, detailDialog } from '@/components/ui/screen-layouts';
import { TaskOutlineView } from '@/components/board/TaskOutlineView';
import { TaskTableView } from '@/components/board/TaskTableView';
import { OrganizationProposalCard } from '@/components/dashboard/OrganizationProposalCard';
import { CompanionBubble, GreetingContent } from '@/components/ai/CompanionBubble';
import { ExtendedPreview, extendedSamples } from './ExtendedPreviews';
import catalog from '@/lib/ui-guide/catalog.json';
import { guideSpecimenStatusLabel, guideSpecimenStatusMessage } from './GuideSpecimenStatus';
import { guideDescription, guideLists, guideNames, guideProposal, guideTasks, guideTitle } from './fixtures';

export interface PreviewOptions {
  sample: string; long: boolean; many: boolean; disabled: boolean; selected: boolean;
  fetchState: 'ready' | 'loading' | 'empty' | 'error'; variant: string; rowSpace?: number; cardSpace?: number; bubbleSpace?: number; buttonHeight?: number;
}
const navigation = [
  { id: 'today', label: '今日', icon: Sunrise }, { id: 'calendar', label: 'カレンダー', icon: CalendarDays },
  { id: 'list', label: 'タスク', icon: List }, { id: 'proposals', label: 'モアイの提案', icon: Sparkles },
] as const;

function SettingDemo({ long, disabled }: { long: boolean; disabled: boolean }) {
  const [value, setValue] = useState('guide-aya');
  const [saved, setSaved] = useState('guide-aya');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [failNext, setFailNext] = useState(true);
  const guard = useRef(false);
  async function save() {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError(''); setMessage('');
    await new Promise(resolve => setTimeout(resolve, 900));
    if (failNext) { setError('保存できませんでした。選択は残っています。同じ「主担当を保存」で再試行できます。'); setFailNext(false); }
    else { setSaved(value); setMessage('保存しました（この見本の中だけ）。'); }
    setBusy(false); guard.current = false;
  }
  return <div className="space-y-4">
    <SettingField id="guide-default-assignee" label="主担当（新規タスクの初期値）" saveLabel="主担当を保存" busy={busy} disabled={disabled} error={error} message={message} onSave={() => void save()}
      description={long ? guideDescription(true) : '担当を変更して保存すると、最初の1回は失敗し、次の保存は成功します。'}>
      <select id="guide-default-assignee" className={settingSelect} value={value} disabled={disabled || busy} onChange={event => { setValue(event.target.value); setError(''); setMessage(''); }}>
        <option value="">担当未設定</option>{Object.entries(guideNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </SettingField>
    <HelpText>保存済みの値：{guideNames[saved as keyof typeof guideNames] || '担当未設定'} ／ 入力中の値：{guideNames[value as keyof typeof guideNames] || '担当未設定'}</HelpText>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={failNext} disabled={busy} onChange={event => setFailNext(event.target.checked)} />次の保存を失敗させる</label>
  </div>;
}

function DetailDemo({ long, many, disabled, open: initialOpen = false, onClose }: { long: boolean; many: boolean; disabled: boolean; open?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(initialOpen);
  const changeOpen = (next: boolean) => { setOpen(next); if (!next) onClose?.(); };
  const [title, setTitle] = useState(guideTitle(long));
  const [description, setDescription] = useState(guideDescription(long));
  return <>
    <Card density="compact"><CardHeader><CardTitle>{guideTitle(long)}</CardTitle><CardDescription>見出し → 説明・担当・経緯 → 下部の操作</CardDescription></CardHeader><CardContent><Button onClick={() => setOpen(true)}>架空タスクの詳細を開く</Button></CardContent></Card>
    <Dialog open={open} onOpenChange={changeOpen}><DialogContent className={detailDialog}>
      <DetailFrame><DialogHeader className={detailHeader}><DialogTitle>架空タスクの詳細</DialogTitle><DialogDescription>実画面と同じ詳細の枠組みです。ここでの入力は見本の中だけに残ります。</DialogDescription></DialogHeader>
        <DetailBody><div className={detailContent}><label htmlFor="guide-detail-title">タスク名</label><Input id="guide-detail-title" value={title} disabled={disabled} onChange={event => setTitle(event.target.value)} />
          <label htmlFor="guide-detail-description">説明</label><Textarea id="guide-detail-description" value={description} disabled={disabled} rows={5} onChange={event => setDescription(event.target.value)} />
          <SettingDemo long={false} disabled={disabled} />
          <details><summary className="cursor-pointer py-3">経緯・変更履歴を見る</summary>{Array.from({ length: many ? 12 : 2 }, (_, index) => <Prose key={index}>9月{index + 1}日：{guideDescription(long)}</Prose>)}</details>
        </div></DetailBody>
        <div className="tf-detail-footer flex shrink-0 justify-end border-t py-3"><Button variant="ghost" onClick={() => changeOpen(false)}>閉じる</Button></div>
      </DetailFrame>
    </DialogContent></Dialog>
  </>;
}

export function GuidePreview(options: PreviewOptions) {
  const { sample, long, many, disabled, selected, variant } = options;
  const entry = catalog.entries.find(item => item.id === sample);
  const [view, setView] = useState<'today' | 'calendar' | 'list' | 'proposals'>(selected ? 'list' : 'today');
  const [text, setText] = useState(guideTitle(long));
  const [checked, setChecked] = useState(selected);
  const [notice, setNotice] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [fetchState, setFetchState] = useState(options.fetchState);
  const [detail, setDetail] = useState<string | null>(null);
  const [proposalState, setProposalState] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(true);
  const tasks = guideTasks(long, many, variant !== 'plain');
  const style = { ...(options.rowSpace === undefined ? {} : { '--tf-row-block': `${options.rowSpace}px` }), ...(options.cardSpace === undefined ? {} : { '--tf-card-block': `${options.cardSpace}px` }) } as CSSProperties;
  const buttonStyle: CSSProperties | undefined = options.buttonHeight === undefined ? undefined : { height: `${options.buttonHeight}px`, paddingBlock: 0 };
  async function proposalAction(action: string) {
    if (busy) return;
    setBusy(true); setProposalState('');
    await new Promise(resolve => setTimeout(resolve, 800));
    if (failure) { setNotice('保存できませんでした。提案は残っています。もう一度操作できます。'); setFailure(false); }
    else { setNotice(''); setProposalState(`${action}しました（架空データ）。`); }
    setBusy(false);
  }
  const rows = fetchState !== 'ready'
    ? <AsyncState state={fetchState} message={fetchState === 'loading' ? 'タスクを読み込み中…' : fetchState === 'empty' ? '表示条件に合うタスクはありません。' : 'タスクを取得できませんでした。'} onRetry={() => setFetchState('ready')} />
    : sample === 'table' || sample === 'list-layout' && variant === 'table'
      ? <TaskTableView tasks={tasks} allTasks={tasks} lists={guideLists} viewerId="guide-aya" names={guideNames} onTaskClick={setDetail} />
      : <TaskOutlineView projectId="guide-project" viewerId="guide-aya" tasks={tasks} lists={guideLists} names={guideNames} onTaskClick={setDetail} />;
  return <main data-guide-preview={sample} style={style} className="min-w-0 bg-background p-3 text-foreground">
    {extendedSamples.includes(sample) && <><div className="mb-4 rounded-md border bg-muted p-3 text-sm"><strong>{guideSpecimenStatusLabel(entry)}</strong><p className="mt-1">{guideSpecimenStatusMessage(entry)}</p></div><ExtendedPreview {...options} /></>}
    {sample === 'text' && <div className="space-y-4"><PageHeading>{long ? '読みやすさと押しやすさを確かめるための長い日本語の見出し' : '今日の仕事'}</PageHeading><CardTitle>説明と経緯</CardTitle><Prose>{guideDescription(long)}</Prose><HelpText>期限・担当者など、主情報を補う説明です。</HelpText><div className="flex flex-wrap gap-3">{['background','foreground','primary','muted','border','destructive'].map(color => <span key={color} className="flex items-center gap-1 text-xs"><span className="inline-block size-5 rounded border" style={{ background: `var(--${color})` }} />{color}</span>)}</div></div>}
    {sample === 'button' && <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><Button style={buttonStyle} disabled={disabled} onClick={() => setNotice('保存操作を受け付けました（架空データ）。')}>{long ? '確認した内容を保存する' : '保存'}</Button><Button style={buttonStyle} variant="outline" disabled={disabled} onClick={() => setNotice('キャンセルしました。')}>キャンセル</Button><Button style={buttonStyle} variant="ghost" disabled={disabled} aria-pressed={checked} onClick={() => setChecked(!checked)}>{checked && <Check aria-hidden className="size-4" />}選択</Button><ControlHint label="表示の確認"><Button variant="ghost" size="icon" aria-label="表示の確認" disabled={disabled} onClick={() => setNotice('アイコンにも操作名があります。')}><MoreHorizontal className="size-4" /></Button></ControlHint></div><p role="status" className="text-sm">{notice || '押すと、この場所に結果を表示します。'}</p></div>}
    {sample === 'input' && <div className="space-y-4"><label className="block space-y-1"><span>タスク名</span><Input value={text} disabled={disabled} onChange={event => setText(event.target.value)} /></label><label className="block space-y-1"><span>説明</span><Textarea defaultValue={guideDescription(long)} disabled={disabled} rows={4} /></label><label className="flex items-center gap-2"><Checkbox checked={checked} disabled={disabled} onCheckedChange={value => setChecked(value === true)} />{long ? 'この長い説明文の内容を読んで、選択したことが分かる表示を確認します' : '確認しました'}</label></div>}
    {sample === 'navigation' && (variant === 'menu' ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" disabled={disabled}>表示メニュー<MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent>{navigation.map(item => <DropdownMenuCheckboxItem key={item.id} checked={view === item.id} onCheckedChange={() => setView(item.id)}>{item.label}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu> : variant === 'tabs' ? <Tabs defaultValue="list"><TabsList><TabsTrigger value="list" disabled={disabled}>一覧</TabsTrigger><TabsTrigger value="history" disabled={disabled}>履歴</TabsTrigger></TabsList><TabsContent value="list"><Prose>一覧の内容です。</Prose></TabsContent><TabsContent value="history"><Prose>履歴の内容です。</Prose></TabsContent></Tabs> : <><ViewSwitcher label="タスクの表示" value={view} options={navigation} onChange={setView} disabled={disabled} /><Prose>選択中：{navigation.find(item => item.id === view)?.label}</Prose></>)}
    {sample === 'card' && <Card density={variant === 'standard' ? 'default' : 'compact'}><CardHeader><CardTitle>{guideTitle(long)}</CardTitle><CardDescription>見出し・補足・入力を近くにまとめます。</CardDescription></CardHeader><CardContent><Prose>{guideDescription(long)}</Prose><Input aria-label="カード内の入力" defaultValue="表示を確かめる" disabled={disabled} /></CardContent></Card>}
    {sample === 'states' && <AsyncState state={fetchState === 'ready' ? 'empty' : fetchState} message={fetchState === 'loading' ? '取得中…' : fetchState === 'error' ? '取得できませんでした。' : '現在は表示する項目がありません。'} onRetry={() => { setFetchState('empty'); }} />}
    {['outline','table','list-layout'].includes(sample) && <fieldset disabled={disabled} className="min-w-0">{rows}</fieldset>}
    {detail && <DetailDemo key={detail} long={long} many={many} disabled={disabled} open onClose={() => setDetail(null)} />}
    {sample === 'proposal' && <>{proposalState ? <p role="status">{proposalState}<Button variant="ghost" onClick={() => { setProposalState(''); setFailure(true); }}>見本を戻す</Button></p> : <OrganizationProposalCard record={guideProposal(long)} projectName="案内プロジェクト（架空）" locations={['準備']} tasks={tasks} context={{ members: Object.entries(guideNames).map(([id, displayName]) => ({ id, displayName })), lists: guideLists }} disabled={disabled} busy={busy} error={notice} onApply={() => void proposalAction('反映')} onHold={() => void proposalAction('保留')} onSkip={() => void proposalAction('見送り')} onAdjust={() => setNotice('ここでは表示・保存状態を確認します。業務の編集画面は開きません。')} />}</>}
    {sample === 'bubble' && (dismissed ? <Button variant="outline" onClick={() => setDismissed(false)}>吹き出しをもう一度表示</Button> : <CompanionBubble variant="greeting" style={options.bubbleSpace === undefined ? undefined : { padding: `${options.bubbleSpace}px` }}><GreetingContent message={long ? guideDescription(true) : '案内の期限が変わりました。必要なときに内容を見られます。'} onDismiss={() => setDismissed(true)} /></CompanionBubble>)}
    {sample === 'setting' && <SettingDemo long={long} disabled={disabled} />}
    {sample === 'detail-layout' && <DetailDemo long={long} many={many} disabled={disabled} />}
    {sample === 'settings-layout' && <SettingsLayout><PageHeading>プロジェクト設定</PageHeading><Card density="compact"><CardHeader><CardTitle>基本設定</CardTitle></CardHeader><CardContent><SettingDemo long={long} disabled={disabled} /></CardContent></Card>{Array.from({ length: many ? 5 : 1 }, (_, index) => <Card density="compact" key={index}><CardHeader><CardTitle>{index ? `追加の設定 ${index}` : '説明'}</CardTitle></CardHeader><CardContent><Prose>{guideDescription(long)}</Prose></CardContent></Card>)}</SettingsLayout>}
  </main>;
}
