'use client';

import { useMemo } from 'react';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useNotifications } from '@/hooks/useNotifications';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { buildTaskFlowBrief, buildTaskFlowUpcoming } from '@/lib/dashboard/brief';
import type { BriefTaskScope } from '@/stores/briefDisplayStore';
import { MAX_UPCOMING_DAYS } from '@/lib/dashboard/upcoming-range';
import {
  buildCalendarBriefRow,
  buildCalendarUpcomingDays,
} from '@/lib/dashboard/calendar';

export function useTaskFlowBrief(scope: BriefTaskScope = 'mine') {
  const { tasks, allProjectTasks, isLoading: tasksLoading, error: tasksError } = useMyTasks();
  const { notifications, isLoading: notificationsLoading } = useNotifications();
  const googleCalendar = useGoogleCalendar();
  const isSample = isE2EMockAuthEnabled();

  const data = useMemo(
    () => {
      if (isSample) return null;

      const brief = buildTaskFlowBrief(tasks, allProjectTasks, notifications, new Date(), scope);
      if (googleCalendar.status === 'connected') {
        brief.rows[1] = buildCalendarBriefRow(googleCalendar.events);
      }
      return brief;
    },
    [
      allProjectTasks,
      googleCalendar.events,
      googleCalendar.status,
      isSample,
      notifications,
      tasks,
      scope,
    ]
  );
  const upcomingDays = useMemo(
    () => buildTaskFlowUpcoming(allProjectTasks, new Date(), MAX_UPCOMING_DAYS),
    [allProjectTasks]
  );
  const upcomingCalendarDays = useMemo(
    () => buildCalendarUpcomingDays(googleCalendar.events, new Date(), MAX_UPCOMING_DAYS),
    [googleCalendar.events]
  );

  return {
    allProjectTasks,
    tasksError,
    data,
    upcomingDays,
    upcomingCalendarDays,
    isLoading: !isSample && (tasksLoading || notificationsLoading),
    areTasksLoading: !isSample && tasksLoading,
    calendarStatus: googleCalendar.status,
    calendarError: googleCalendar.error,
    connectCalendar: googleCalendar.connect,
    isSample,
  };
}
