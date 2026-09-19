'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Bell,
  X,
  Settings,
  AlertCircle,
  Calendar,
  FileText,
  BarChart3,
  MessageCircle,
  MessageSquareText,
  MessageSquarePlus,
  Loader2,
  Trash2,
  Plus,
  Sun,
  ClipboardList,
  Search,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useProjects } from '@/hooks/useProjects';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import { useUnifiedConversation } from '@/hooks/useUnifiedConversation';
import { useCompanionState } from '@/hooks/useCompanionState';
import { useUnifiedConversations } from '@/hooks/useUnifiedConversations';
import { getAuthHeaders } from '@/lib/firebase/authToken';
import { filterProjectsForAI, isAIProjectAllowed } from '@/lib/ai/projectAccess';
import { fitPanelBounds, resizePanelBounds, type PanelBounds, type PanelResizeCorner } from '@/lib/ai/panelResize';
import { ChatInput } from './ChatInput';
import { CompanionLauncher } from './CompanionLauncher';
import { CompanionTaskChecks } from './CompanionTaskChecks';
import { CompanionAvatar } from './CompanionAvatar';
import { NotificationList } from '@/components/common/NotificationList';
import { HistoryPane } from '@/components/common/HistoryPane';
import { CompanionComments } from './CompanionComments';
import { useNotifications } from '@/hooks/useNotifications';
import { ChatMessage } from './ChatMessage';
import { ToolConfirmDialog } from './ToolConfirmDialog';
import { AIContext, PROVIDER_DISPLAY_NAMES } from '@/types/ai';
import { ToolCall } from '@/lib/ai/tools/types';
import { useRouter } from 'next/navigation';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { ScopedConversation } from './ScopedConversation';
import { AISupportAdjust } from './AISupportAdjust';
import { FeatureRequestDialog } from './FeatureRequestDialog';
import PurchaseReportDialog from './PurchaseReportDialog';
import MeetingIntakeDialog from '@/components/dashboard/MeetingIntakeDialog';

// Quick action button types
interface QuickAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  message: string;
}

interface CompanionAIProps {
  projectId: string | null;
  autoGreeting?: boolean;
  quickCheckEnabled?: boolean;
}

export function CompanionAI({ projectId, autoGreeting = true, quickCheckEnabled = true }: CompanionAIProps) {
  const router = useRouter();
  const { user, firebaseUser } = useAuth();
  // Derive userId/displayName with firebaseUser fallback (when Firestore is inaccessible)
  const userId = user?.id || firebaseUser?.uid || '';
  const displayName = user?.displayName || firebaseUser?.displayName || '';
  const { projects, isLoading: projectsLoading, error: projectsError } = useProjects();
  const {
    provider,
    isConfigured,
    allowedProjectIds,
    projectAccessLoaded,
    setAllowedProjectIds,
    setProjectAccessLoaded,
  } = useAISettingsStore();
  const {
    timePeriod,
    currentHour,
    shouldShowMorningGreeting,
    shouldShowEveningReport,
    markMorningGreeted,
    markEveningReported,
  } = useCompanionState();

  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return localStorage.getItem('companionAIPanelOpen') === 'true';
  });
  const [purchaseSession,setPurchaseSession] = useState<{userId:string;open:boolean;file:File|null;text:string;id:string}|null>(null);
  const [purchaseSent,setPurchaseSent] = useState<{id:string;content:string}|undefined>();
  const [showFeatureRequest, setShowFeatureRequest] = useState(false);
  const [meetingSession, setMeetingSession] = useState<{ userId: string; open: boolean } | null>(null);
  const [supportOnce, setSupportOnce] = useState<{ userId: string; conversationId: string | null; instruction: string } | null>(null);
  const [activePanel, setActivePanel] = useState<'chat' | 'notifications' | 'comments'>('chat');
  const [commentsOwner, setCommentsOwner] = useState<string | null>(null);
  const { unreadCount, isLoading: notificationsLoading, error: notificationsError } = useNotifications();
  const suppressAutoGreetingRef = useRef(false);
  const openNotifications = useCallback(() => {
    suppressAutoGreetingRef.current = true;
    setActivePanel('notifications');
    setIsOpen(true);
  }, []);
  useEffect(() => {
    const openAssistant = () => { suppressAutoGreetingRef.current = true; setActivePanel('chat'); setIsOpen(true); };
    window.addEventListener('taskflow-open-assistant', openAssistant);
    return () => window.removeEventListener('taskflow-open-assistant', openAssistant);
  }, []);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [scopedMode, setScopedMode] = useState<'description' | 'draft' | null>(null);
  const scopedModeRef = useRef<'description' | 'draft' | null>(null);
  useEffect(() => { scopedModeRef.current = scopedMode; }, [scopedMode]);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.userId !== userId || typeof detail.conversationId !== 'string' || !['description', 'draft'].includes(detail.mode)) return;
      scopedModeRef.current = detail.mode;
      setSelectedConversationId(detail.conversationId); setScopedMode(detail.mode); setActivePanel('chat'); setIsOpen(true);
    };
    window.addEventListener('taskflow-open-conversation', open);
    return () => window.removeEventListener('taskflow-open-conversation', open);
  }, [userId]);
  const [showToolConfirm, setShowToolConfirm] = useState(false);
  const [pendingTools, setPendingTools] = useState<ToolCall[] | null>(null);
  const [projectAccessError, setProjectAccessError] = useState<string | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = localStorage.getItem('companionAIPanelPosition');
      return stored ? (JSON.parse(stored) as { x: number; y: number }) : null;
    } catch {
      return null;
    }
  });
  const [panelSize, setPanelSize] = useState<{ width: number; height: number }>(() => {
    if (typeof window === 'undefined') return { width: 420, height: 600 };
    try {
      const stored = localStorage.getItem('companionAIPanelSize');
      if (!stored) return { width: 420, height: 600 };
      const parsed = JSON.parse(stored) as { width?: unknown; height?: unknown };
      if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
        return {
          width: Math.min(Math.max(320, parsed.width), Math.max(320, window.innerWidth - 36)),
          height: Math.min(Math.max(360, parsed.height), Math.max(360, window.innerHeight - 108)),
        };
      }
    } catch {
      // Ignore malformed or unavailable local storage.
    }
    return { width: 420, height: 600 };
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const projectAccessRequestedRef = useRef(false);
  const dragStateRef = useRef<{
    startClientX: number;
    startClientY: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);
  const latestPositionRef = useRef<{ x: number; y: number } | null>(panelPosition);
  const latestSizeRef = useRef(panelSize);
  const resizeStateRef = useRef<{
    startClientX: number;
    startClientY: number;
    start: PanelBounds;
    corner: PanelResizeCorner;
  } | null>(null);

  const handlePanelDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, a')) return;
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragStateRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPosX: rect.left,
      startPosY: rect.top,
    };
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, []);

  const handlePanelResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>, corner: PanelResizeCorner) => {
    if (e.button !== 0 || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    resizeStateRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      start: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      corner,
    };
    // Pin the current rectangle, including panels initially anchored bottom/right.
    const position = { x: rect.left, y: rect.top };
    latestPositionRef.current = position;
    latestSizeRef.current = { width: rect.width, height: rect.height };
    setPanelPosition(position);
    dragStateRef.current = null;
    document.body.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
  }, []);

  useEffect(() => {
    const clamp = (x: number, y: number) => {
      const w = panelRef.current?.offsetWidth ?? 420;
      const h = panelRef.current?.offsetHeight ?? 600;
      const maxX = Math.max(0, window.innerWidth - w);
      const maxY = Math.max(0, window.innerHeight - h);
      return {
        x: Math.min(Math.max(0, x), maxX),
        y: Math.min(Math.max(0, y), maxY),
      };
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!dragStateRef.current) return;
      const { startClientX, startClientY, startPosX, startPosY } = dragStateRef.current;
      const next = clamp(
        startPosX + (event.clientX - startClientX),
        startPosY + (event.clientY - startClientY)
      );
      latestPositionRef.current = next;
      setPanelPosition(next);
    };

    const finishDrag = () => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      document.body.style.userSelect = '';
      const finalPos = latestPositionRef.current;
      if (finalPos) {
        try {
          localStorage.setItem('companionAIPanelPosition', JSON.stringify(finalPos));
        } catch {
          // localStorage may be unavailable (private mode, quota); ignore
        }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', finishDrag);
    window.addEventListener('blur', finishDrag);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', finishDrag);
      window.removeEventListener('blur', finishDrag);
    };
  }, []);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!resizeStateRef.current) return;
      const { startClientX, startClientY, start, corner } = resizeStateRef.current;
      const next = resizePanelBounds(
        start,
        corner,
        { x: event.clientX - startClientX, y: event.clientY - startClientY },
        { width: window.innerWidth, height: window.innerHeight }
      );
      const position = { x: next.x, y: next.y };
      const size = { width: next.width, height: next.height };
      latestPositionRef.current = position;
      latestSizeRef.current = size;
      setPanelPosition(position);
      setPanelSize(size);
    };

    const finishResize = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.style.userSelect = '';
      try {
        localStorage.setItem('companionAIPanelSize', JSON.stringify(latestSizeRef.current));
        localStorage.setItem('companionAIPanelPosition', JSON.stringify(latestPositionRef.current));
      } catch {
        // localStorage may be unavailable (private mode, quota); ignore
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', finishResize);
    window.addEventListener('blur', finishResize);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', finishResize);
      window.removeEventListener('blur', finishResize);
      if (resizeStateRef.current) {
        resizeStateRef.current = null;
        document.body.style.userSelect = '';
      }
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      const position = latestPositionRef.current;
      const next = fitPanelBounds(
        { x: position?.x ?? 0, y: position?.y ?? 0, ...latestSizeRef.current },
        {
          width: window.innerWidth - (position ? 0 : 24),
          height: window.innerHeight - (position ? 0 : 96),
        }
      );
      const size = { width: next.width, height: next.height };
      latestSizeRef.current = size;
      setPanelSize(size);
      if (position) {
        const nextPosition = { x: next.x, y: next.y };
        latestPositionRef.current = nextPosition;
        setPanelPosition(nextPosition);
      }
    };
    if (isOpen) onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen]);

  useEffect(() => {
    projectAccessRequestedRef.current = false;
    setProjectAccessError(null);
    setProjectAccessLoaded(false);
  }, [firebaseUser?.uid, setProjectAccessLoaded]);

  useEffect(() => {
    if (!firebaseUser || projectAccessLoaded || projectAccessRequestedRef.current) {
      return;
    }

    projectAccessRequestedRef.current = true;

    void (async () => {
      try {
        setProjectAccessError(null);
        const headers = await getAuthHeaders();
        const response = await fetch('/api/ai/settings', { headers });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'AIアクセス設定の取得に失敗しました');
        }

        const data = await response.json();
        setAllowedProjectIds(
          Array.isArray(data.allowedProjectIds) ? data.allowedProjectIds : null
        );
        setProjectAccessLoaded(true);
      } catch (error) {
        setProjectAccessError(
          error instanceof Error ? error.message : 'AIアクセス設定の取得に失敗しました'
        );
      }
    })();
  }, [
    firebaseUser,
    projectAccessLoaded,
    setAllowedProjectIds,
    setProjectAccessLoaded,
  ]);

  // Find current project details
  const currentProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId]
  );
  const accessibleProjects = useMemo(
    () => filterProjectsForAI(projects, allowedProjectIds),
    [projects, allowedProjectIds]
  );
  const isCurrentProjectAllowed = useMemo(
    () => isAIProjectAllowed(projectId, allowedProjectIds),
    [projectId, allowedProjectIds]
  );
  const projectIds = useMemo(
    () => accessibleProjects.map((project) => project.id),
    [accessibleProjects]
  );
  const isProjectAccessBlocked = Boolean(
    projectAccessLoaded &&
      (
        (!projectId && projectIds.length === 0) ||
        (projectId && !isCurrentProjectAllowed)
      )
  );
  const effectiveUserId = projectAccessLoaded && !isProjectAccessBlocked ? userId : '';

  // Build context dynamically based on projectId
  const companionContext: AIContext = useMemo(() => {
    if (projectId && currentProject && isCurrentProjectAllowed) {
      return {
        scope: 'companion' as const,
        project: {
          id: currentProject.id,
          name: currentProject.name,
          description: currentProject.description || '',
          lists: [],
          members: [],
        },
        projects: accessibleProjects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description || '',
          lists: [],
          members: [],
        })),
        user: {
          id: userId,
          displayName,
        },
        currentHour,
      };
    }
    return {
      scope: 'companion' as const,
      projects: accessibleProjects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description || '',
        lists: [],
        members: [],
      })),
      user: {
        id: userId,
        displayName,
      },
      currentHour,
    };
  }, [
    accessibleProjects,
    currentHour,
    currentProject,
    displayName,
    isCurrentProjectAllowed,
    projectId,
    userId,
  ]);

  // Dynamic quick actions based on context
  const quickActions: QuickAction[] = useMemo(() => {
    const overdueAction: QuickAction = {
      id: 'overdue',
      label: '期限切れ確認',
      icon: <Clock className="h-4 w-4" />,
      message: '期限切れのタスクはありますか？',
    };
    if (projectId) {
      // Project page actions
      return [
        {
          id: 'create_task',
          label: 'タスク作成',
          icon: <ClipboardList className="h-4 w-4" />,
          message: '新しいタスクを作成してください',
        },
        {
          id: 'summary',
          label: 'プロジェクト概要',
          icon: <Search className="h-4 w-4" />,
          message: 'このプロジェクトの概要を教えてください',
        },
        overdueAction,
        {
          id: 'report',
          label: '日報生成',
          icon: <FileText className="h-4 w-4" />,
          message: '今日の日報を生成してください',
        },
      ];
    }

    // Dashboard actions (time-aware)
    const planAction: QuickAction = {
      id: 'plan',
      label: '今日の計画',
      icon: <Sun className="h-4 w-4" />,
      message: '今日のタスクを整理して、優先順位を教えてください',
    };
    const reportAction: QuickAction = {
      id: 'report',
      label: '日報生成',
      icon: <FileText className="h-4 w-4" />,
      message: '今日の日報を生成してください',
    };
    const priorityAction: QuickAction = {
      id: 'priority',
      label: '優先順位',
      icon: <Calendar className="h-4 w-4" />,
      message: '今日取り組むべきタスクを優先順位付けして教えてください',
    };
    const workloadAction: QuickAction = {
      id: 'workload',
      label: '負荷確認',
      icon: <BarChart3 className="h-4 w-4" />,
      message: '現在のワークロードを分析してください',
    };

    if (timePeriod === 'morning' || timePeriod === 'afternoon') {
      return [planAction, priorityAction, workloadAction, overdueAction, reportAction];
    }
    return [reportAction, priorityAction, workloadAction, overdueAction, planAction];
  }, [projectId, timePeriod]);

  // Conversations list (filtered by projectId context)
  const {
    conversations,
    isLoading: conversationsLoading,
    deleteConversationById,
  } = useUnifiedConversations({
    userId: (isE2EMockAuthEnabled() ? userId : effectiveUserId) || null,
    projectId: projectId ?? null,
  });

  // Conversation hook
  const {
    messages,
    isLoading,
    error,
    sendMessage,
    confirmToolExecution,
    cancelToolExecution,
    clearMessages,
  } = useUnifiedConversation({
    userId: scopedMode ? '' : effectiveUserId,
    projectId: isProjectAccessBlocked ? null : projectId,
    projectIds,
    context: companionContext,
    conversationId: scopedMode ? null : selectedConversationId,
    onConversationCreated: (id) => { if (!scopedModeRef.current) setSelectedConversationId(id); },
    onToolConfirmRequired: (toolCalls) => {
      if (scopedModeRef.current) return;
      setPendingTools(toolCalls);
      setShowToolConfirm(true);
    },
  });

  useEffect(() => {
    if (scopedMode) { cancelToolExecution(); queueMicrotask(() => { setPendingTools(null); setShowToolConfirm(false); }); }
  }, [scopedMode, cancelToolExecution]);

  // Reset conversation when projectId changes
  useEffect(() => {
    queueMicrotask(() => {
      setSelectedConversationId(null);
      setScopedMode(null);
      clearMessages();
    });
  }, [projectId, userId, clearMessages]);

  // Close panel on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if ((e.target as Element).closest?.('[data-companion-toggle], [data-companion-greeting]')) return;
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
          return;
        }
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close panel on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !e.defaultPrevented && !document.querySelector('[role="dialog"]')) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('companionAIPanelOpen', String(isOpen));
  }, [isOpen]);

  // Handle sending a message
  const handleSendMessage = useCallback(async (content: string) => {
    if (!effectiveUserId || isProjectAccessBlocked || !projectAccessLoaded) return;
    const instruction = supportOnce?.userId === userId && supportOnce.conversationId === selectedConversationId ? supportOnce.instruction : '';
    if (instruction) await sendMessage(content, instruction);
    else await sendMessage(content);
    setSupportOnce(null);
  }, [effectiveUserId, isProjectAccessBlocked, projectAccessLoaded, sendMessage, supportOnce, userId, selectedConversationId]);

  // Handle quick action
  const handleQuickAction = useCallback((action: QuickAction) => {
    handleSendMessage(action.message);
  }, [handleSendMessage]);

  // Handle new conversation
  const handleNewConversation = useCallback(() => {
    setScopedMode(null);
    setSelectedConversationId(null);
    clearMessages();
  }, [clearMessages]);

  // Handle selecting a conversation
  const handleSelectConversation = useCallback((id: string) => {
    setScopedMode(conversations.find(c => c.id === id)?.mode ?? null);
    setSelectedConversationId(id);
  }, [conversations]);

  // Handle deleting a conversation
  const handleDeleteConversation = useCallback(async (id: string) => {
    await deleteConversationById(id);
    if (selectedConversationId === id) {
      setSelectedConversationId(null);
      setScopedMode(null);
      clearMessages();
    }
  }, [deleteConversationById, selectedConversationId, clearMessages]);

  // Handle tool execution confirmation
  const handleToolConfirm = useCallback(async () => {
    if (!pendingTools) return;

    const tools = pendingTools;
    setShowToolConfirm(false);
    // 実行中にAIが次の確認を要求すると pendingTools が再セットされるため、
    // await 後にクリアすると新しい確認内容を上書きしてしまう。必ず実行前にクリアする。
    setPendingTools(null);
    await confirmToolExecution(tools);
  }, [pendingTools, confirmToolExecution]);

  // Handle tool cancellation
  const handleToolCancel = useCallback(() => {
    setShowToolConfirm(false);
    setPendingTools(null);
    cancelToolExecution();
  }, [cancelToolExecution]);

  // Navigate to settings
  const handleGoToSettings = useCallback(() => {
    setIsOpen(false);
    router.push('/settings/ai');
  }, [router]);

  const isApiConfigured = isConfigured();

  // Header title
  const headerTitle = useMemo(() => {
    if (projectId && currentProject) {
      return `相棒 - ${currentProject.name}`;
    }
    if (timePeriod === 'morning') return '相棒 - 朝の準備';
    if (timePeriod === 'evening') return '相棒 - 今日の振り返り';
    return '相棒';
  }, [projectId, currentProject, timePeriod]);

  // Disable check - need either projects (dashboard) or projectId (project page)
  const isProjectAccessLoading = !projectAccessLoaded && !projectAccessError;
  const isDisabled =
    isProjectAccessLoading ||
    isProjectAccessBlocked ||
    (!projectId && projectIds.length === 0);
  const accessStateCopy = useMemo(() => {
    if (projectAccessError) {
      return {
        title: 'AIアクセス設定を読み込めませんでした',
        description: projectAccessError,
      };
    }

    if (projectId && !isCurrentProjectAllowed) {
      return {
        title: 'このプロジェクトではAIアクセスが無効です',
        description: 'AI設定でこのプロジェクトを有効にすると、相棒AIが再び利用できます。',
      };
    }

    return {
      title: 'AIアクセス対象のプロジェクトがありません',
      description: 'AI設定で少なくとも1つのプロジェクトを有効にしてください。',
    };
  }, [isCurrentProjectAllowed, projectAccessError, projectId]);

  // Auto-greeting on panel open (dashboard only)
  const autoGreetSentRef = useRef(false);
  useEffect(() => {
    if (
      isOpen &&
      activePanel === 'chat' &&
      autoGreeting &&
      !suppressAutoGreetingRef.current &&
      !projectId &&
      messages.length === 0 &&
      !selectedConversationId &&
      isApiConfigured &&
      projectAccessLoaded &&
      projectIds.length > 0 &&
      !isProjectAccessBlocked &&
      !autoGreetSentRef.current
    ) {
      if (shouldShowMorningGreeting) {
        autoGreetSentRef.current = true;
        markMorningGreeted();
        const timer = setTimeout(() => {
          sendMessage('おはようございます！今日のタスクを整理して、優先順位を教えてください。');
        }, 500);
        return () => clearTimeout(timer);
      } else if (shouldShowEveningReport) {
        autoGreetSentRef.current = true;
        markEveningReported();
        const timer = setTimeout(() => {
          sendMessage('お疲れ様でした！今日の日報を作成してください。');
        }, 500);
        return () => clearTimeout(timer);
      }
    }
    if (!isOpen || selectedConversationId) {
      autoGreetSentRef.current = false;
    }
  }, [
    activePanel,
    autoGreeting,
    isApiConfigured,
    isOpen,
    isProjectAccessBlocked,
    markEveningReported,
    markMorningGreeted,
    messages.length,
    projectAccessLoaded,
    projectId,
    projectIds.length,
    selectedConversationId,
    sendMessage,
    shouldShowEveningReport,
    shouldShowMorningGreeting,
  ]);

  const supportAdjust = <AISupportAdjust key={`support:${userId}:${selectedConversationId ?? 'new'}`} inline userId={userId} disabled={isLoading || isDisabled}
    pendingInstruction={supportOnce?.userId === userId && supportOnce.conversationId === selectedConversationId ? supportOnce.instruction : undefined}
    onApplyOnce={instruction => setSupportOnce(instruction ? { userId, conversationId: selectedConversationId, instruction } : null)} />;
  const renderQuickActions = (compact: boolean) => <div role="group" aria-label="相棒の操作" className={compact ? 'flex flex-wrap items-center gap-2 border-t px-3 py-2' : 'mt-4 flex flex-wrap items-center justify-center gap-2'}>
    {quickActions.map(action => <button key={action.id} onClick={() => handleQuickAction(action)} disabled={isLoading || projectsLoading || isDisabled}
      className="flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-xs transition-colors hover:bg-muted disabled:opacity-50">
      <span aria-hidden="true" className="shrink-0">{action.icon}</span>{action.label}
    </button>)}
  </div>;

  if (!firebaseUser) return null;

  return (
    <>
      <CompanionTaskChecks userId={userId} enabled={quickCheckEnabled}>{quickCheck => <CompanionLauncher key={userId} userId={userId} isOpen={isOpen} busy={isLoading} quickCheck={quickCheck} onOpenNotifications={openNotifications} onToggle={() => {
        suppressAutoGreetingRef.current = true;
        setIsOpen(value => !value);
      }} />}</CompanionTaskChecks>

      {/* Chat Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          data-testid="companion-ai-panel"
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-background shadow-xl',
            !panelPosition && 'bottom-[200px] right-6'
          )}
          style={{
            width: panelSize.width,
            height: panelSize.height,
            maxHeight: panelPosition ? 'calc(100dvh - 72px)' : 'calc(100dvh - 272px)',
            ...(panelPosition
              ? { left: panelPosition.x, top: Math.max(64, panelPosition.y) }
              : {}),
          }}
        >
          {/* Header (drag handle) */}
          <div
            className="flex cursor-move select-none items-center justify-between border-b py-3 pl-8 pr-4"
            onMouseDown={handlePanelDragStart}
          >
            <div className="flex items-center gap-2 min-w-0">
              <CompanionAvatar className="h-6 w-6" />
              <span className="truncate font-medium">
                {activePanel === 'notifications' ? '相棒 - 通知' : activePanel === 'comments' ? '相棒 - コメント' : headerTitle}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {activePanel === 'chat' && panelSize.width >= 480 && `(${PROVIDER_DISPLAY_NAMES[provider]})`}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="AI設定を開く"
                onClick={handleGoToSettings}
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="AIアシスタントを閉じる" title="AIアシスタントを閉じる" onClick={() => {
                setIsOpen(false);
                requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-companion-toggle]')?.focus({ preventScroll: true }));
              }}><X className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
          </div>

          <div role="group" aria-label="相棒の表示" className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-2">
            <Button variant={activePanel === 'chat' ? 'secondary' : 'ghost'} size="sm" className="h-8 gap-1.5 px-2 text-xs has-[>svg]:px-2" aria-pressed={activePanel === 'chat'} onClick={() => setActivePanel('chat')}><MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />会話</Button>
            <Button variant={activePanel === 'comments' ? 'secondary' : 'ghost'} size="sm" className="h-8 gap-1.5 px-2 text-xs has-[>svg]:px-2" aria-pressed={activePanel === 'comments'} onClick={() => { setCommentsOwner(userId); setActivePanel('comments'); }}><MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />コメント</Button>
            {supportAdjust}
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs has-[>svg]:px-2" disabled={!userId} onClick={() => setShowFeatureRequest(true)}><MessageSquarePlus aria-hidden="true" className="h-3.5 w-3.5" />要望を送る</Button>
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs has-[>svg]:px-2" disabled={!userId} onClick={() => setMeetingSession({ userId, open: true })}><ClipboardList aria-hidden="true" className="h-3.5 w-3.5" />メモから整理</Button>
            <Button variant={activePanel === 'notifications' ? 'secondary' : 'ghost'} size="icon" aria-label={notificationsError ? '通知：取得エラー' : notificationsLoading ? '通知：読み込み中' : unreadCount > 0 ? `通知：未読${unreadCount}件` : '通知'} title="通知" className={cn('relative ml-auto h-8 w-8 shrink-0', !notificationsLoading && !notificationsError && unreadCount > 0 && 'font-semibold text-red-700 bg-red-50 hover:bg-red-100')} aria-pressed={activePanel === 'notifications'} onClick={openNotifications}>
              <Bell className="h-4 w-4" aria-hidden="true" />
              {!notificationsLoading && !notificationsError && unreadCount > 0 && <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold tabular-nums text-white" aria-label={`未読${unreadCount}件`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
              {notificationsError && <span aria-label="通知の取得エラー" className="absolute -top-1 right-0 text-xs font-bold text-destructive">!</span>}
            </Button>
          </div>
          {commentsOwner === userId && <div hidden={activePanel !== 'comments'} className={cn('flex min-h-0 min-w-0 flex-1', activePanel !== 'comments' && 'hidden')}>
            <CompanionComments key={`comments:${userId}`} onNavigate={() => setIsOpen(false)} />
          </div>}
          <section aria-label="相棒の通知" hidden={activePanel !== 'notifications'} className={cn('flex min-h-0 min-w-0 flex-1', activePanel !== 'notifications' && 'hidden')}>
            <NotificationList key={`notices:${userId}`} asHistory onNavigate={() => setIsOpen(false)} />
          </section>
          <div hidden={activePanel !== 'chat'} className={cn('flex min-h-0 min-w-0 flex-1', activePanel !== 'chat' && 'hidden')}>
            {/* Keep each reading area mounted so changing tabs retains the selected item and drafts. */}
            <HistoryPane label="会話履歴" actions={<Button variant="ghost" size="icon" className="h-6 w-6" aria-label="新しい会話" onClick={handleNewConversation}><Plus className="h-4 w-4" /></Button>} list={<>
{conversationsLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : conversations.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                        会話履歴はありません
                      </div>
                    ) : (
                      conversations.map((conv) => (
                        <div
                          key={conv.id}
                          className={cn(
                            'group flex items-center justify-between gap-1 border-b px-2 py-2 text-xs hover:bg-muted',
                            selectedConversationId === conv.id && 'bg-muted'
                          )}
                        >
                          <button type="button" className="min-w-0 flex-1 truncate rounded text-left focus-visible:outline-2 focus-visible:outline-ring" title={conv.title} aria-current={selectedConversationId === conv.id ? 'true' : undefined} onClick={() => handleSelectConversation(conv.id)}>{conv.title}</button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                            aria-label={`会話を削除: ${conv.title}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteConversation(conv.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))
                    )}
            </>}>

          {scopedMode && selectedConversationId ? <ScopedConversation key={`${userId}:${selectedConversationId}`} userId={userId} mode={scopedMode} conversationId={selectedConversationId} onBack={handleNewConversation} /> : !isApiConfigured ? (
            /* API Key Not Configured */
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
              <AlertCircle className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <h3 className="font-medium">APIキーが設定されていません</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  AI機能を使用するには、設定画面でAPIキーを設定してください。
                </p>
              </div>
              {isE2EMockAuthEnabled() && <Button onClick={()=>setPurchaseSession({userId,open:true,file:null,text:'',id:crypto.randomUUID()})}>購入報告を隔離テスト</Button>}
              <Button onClick={handleGoToSettings}>
                <Settings className="mr-2 h-4 w-4" />
                設定画面へ
              </Button>
            </div>
          ) : isProjectAccessLoading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
              <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
              <div className="text-center">
                <h3 className="font-medium">AIアクセス設定を読み込み中です</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  プロジェクトごとのAI利用設定を確認しています。
                </p>
              </div>
            </div>
          ) : projectAccessError || isProjectAccessBlocked ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
              <AlertCircle className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <h3 className="font-medium">{accessStateCopy.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {accessStateCopy.description}
                </p>
              </div>
              {isE2EMockAuthEnabled() && <Button onClick={()=>setPurchaseSession({userId,open:true,file:null,text:'',id:crypto.randomUUID()})}>購入報告を隔離テスト</Button>}
              <Button onClick={handleGoToSettings}>
                <Settings className="mr-2 h-4 w-4" />
                設定画面へ
              </Button>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1">
              {/* Main Chat Area */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/* Context Preview (project page with task selected) */}
                {projectId && companionContext.task && companionContext.project && (
                  <div className="border-b bg-muted/30 px-4 py-2">
                    <div className="text-xs text-muted-foreground">
                      コンテキスト: {companionContext.project.name}
                    </div>
                    <div className="truncate text-sm font-medium">
                      {companionContext.task.title}
                    </div>
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto">
                  {messages.length === 0 ? (
                    <div className="flex min-h-full flex-col items-center justify-center p-6 text-center">
                      <div className="mb-4 p-4">
                        <CompanionAvatar className="h-40 w-40" label="相棒" />
                      </div>
                      <h3 className="font-medium">
                        {projectId
                          ? `${currentProject?.name || 'プロジェクト'}のサポート`
                          : timePeriod === 'morning'
                            ? 'おはようございます！'
                            : timePeriod === 'evening'
                              ? 'お疲れ様です！'
                              : '相棒'}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {projectId
                          ? 'タスクやプロジェクトについて何でも聞いてください'
                          : timePeriod === 'morning'
                            ? '今日のタスクを整理しましょう'
                            : timePeriod === 'afternoon'
                              ? '午後も頑張りましょう'
                              : timePeriod === 'evening'
                                ? '今日の振り返りをしませんか？'
                                : '何かお手伝いできることはありますか？'}
                      </p>

                      {/* Quick Actions */}
                      {renderQuickActions(false)}

                      {isDisabled && !projectsLoading && (
                        <p className="mt-4 text-xs text-muted-foreground">
                          プロジェクトがありません。まずプロジェクトを作成してください。
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      {messages
                        .filter((message, index) => {
                          if (message.role === 'tool') return false;
                          if (message.role === 'assistant' && !message.content) {
                            const isLastMessage = index === messages.length - 1;
                            return isLastMessage && isLoading;
                          }
                          return true;
                        })
                        .map((message, index, filteredMessages) => (
                          <ChatMessage
                            key={message.id || index}
                            message={message}
                            isStreaming={
                              isLoading &&
                              index === filteredMessages.length - 1 &&
                              message.role === 'assistant'
                            }
                          />
                        ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>

                {/* Error display */}
                {error && (
                  <div className="border-t bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}

                {/* Quick Actions Bar (visible when messages exist) */}
                {messages.length > 0 && renderQuickActions(true)}

                {/* Input */}
                <ChatInput
                  key={`${userId}:${selectedConversationId ?? 'new'}`}
                  draftKey={`${userId}:${selectedConversationId ?? 'new'}`}
                  onImage={(file,text)=>setPurchaseSession({userId,open:true,file,text,id:crypto.randomUUID()})}
                  sentInput={purchaseSent}
                  onSend={message=>{if(/(?:注文|購入|発送|受け取).*(?:したよ|しました|済み|ったよ)/.test(message)&&!/[?？]|どう|方法|したら/.test(message)){setPurchaseSession({userId,open:true,file:null,text:message,id:crypto.randomUUID()});return Promise.resolve(false);}return handleSendMessage(message);}}
                  isLoading={isLoading}
                  disabled={isDisabled}
                  placeholder={
                    projectId
                      ? 'プロジェクトについて質問...'
                      : '相談、報告、これやっといて。画像も貼れます。'
                  }
                />
              </div>
            </div>
          )}
            </HistoryPane>
          </div>
          <div
            role="separator"
            aria-label="AIパネルのサイズを左上から変更"
            aria-orientation="horizontal"
            title="左上をドラッグしてサイズ変更"
            className="absolute left-0 top-0 z-10 flex h-6 w-6 cursor-nwse-resize select-none items-start justify-start p-1 text-xs text-muted-foreground hover:text-foreground"
            onMouseDown={(event) => handlePanelResizeStart(event, 'nw')}
          >
            <span aria-hidden="true">↖</span>
          </div>
          <div
            role="separator"
            aria-label="AIパネルのサイズを変更"
            aria-orientation="horizontal"
            title="右下をドラッグしてサイズ変更"
            className="absolute bottom-0 right-0 z-10 flex h-6 w-6 cursor-se-resize select-none items-end justify-end p-1 text-xs text-muted-foreground hover:text-foreground"
            onMouseDown={(event) => handlePanelResizeStart(event, 'se')}
          >
            <span aria-hidden="true">↘</span>
          </div>
        </div>
      )}

      {purchaseSession?.userId===userId&&<PurchaseReportDialog key={purchaseSession.id} userId={userId} open={purchaseSession.open} initialFile={purchaseSession.file} initialText={purchaseSession.text} onOpenChange={open=>setPurchaseSession({...purchaseSession,open})} onRecorded={()=>setPurchaseSent({id:purchaseSession.id,content:purchaseSession.text})}/>}
      {meetingSession?.userId === userId && <MeetingIntakeDialog key={`meeting:${userId}`} open={meetingSession.open} onOpenChange={open => setMeetingSession({ userId, open })} />}
      <FeatureRequestDialog key={`request:${userId}`} open={showFeatureRequest} onOpenChange={setShowFeatureRequest} userId={userId} projects={projects} projectsLoading={projectsLoading} projectsFailed={!!projectsError} />

      {/* Tool Confirmation Dialog */}
      <ToolConfirmDialog
        open={showToolConfirm}
        onOpenChange={setShowToolConfirm}
        toolCalls={pendingTools || []}
        onConfirm={handleToolConfirm}
        onCancel={handleToolCancel}
        isExecuting={isLoading}
      />
    </>
  );
}
