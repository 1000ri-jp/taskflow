import {recordReportToolDefinition,recordReportHandler} from './recordReport';
import { AITool, RegisteredTool, ToolHandler } from './types';
import {
  createTaskToolDefinition,
  createTasksToolDefinition,
  createTaskHandler,
  createTasksHandler,
} from './createTask';
import {
  updateTaskToolDefinition,
  updateTaskHandler,
} from './updateTask';
import {
  deleteTaskToolDefinition,
  deleteTaskHandler,
  restoreTaskToolDefinition,
  restoreTaskHandler,
} from './deleteTask';
import {
  completeTaskToolDefinition,
  completeTaskHandler,
  moveTaskToolDefinition,
  moveTaskHandler,
  assignTaskToolDefinition,
  assignTaskHandler,
  copyTaskToProjectToolDefinition,
  copyTaskToProjectHandler,
} from './taskTools';
import {
  getTasksToolDefinition,
  getTasksHandler,
  getTaskDetailsToolDefinition,
  getTaskDetailsHandler,
  getProjectSummaryToolDefinition,
  getProjectSummaryHandler,
  getMyTasksToolDefinition,
  getMyTasksHandler,
  getOverdueTasksToolDefinition,
  getOverdueTasksHandler,
} from './queryTasks';
import {
  getListsToolDefinition,
  getListsHandler,
  getMembersToolDefinition,
  getMembersHandler,
  getLabelsToolDefinition,
  getLabelsHandler,
} from './projectQueries';
import {
  suggestScheduleChangesToolDefinition,
  suggestScheduleChangesHandler,
  notifyDependencyDelaysToolDefinition,
  notifyDependencyDelaysHandler,
} from './scheduleAnalysis';
import {
  generateTaskPlanToolDefinition,
  generateTaskPlanHandler,
  executeTaskPlanToolDefinition,
  executeTaskPlanHandler,
} from './planGeneration';
import {
  suggestImprovementsToolDefinition,
  suggestImprovementsHandler,
} from './qualityAssistance';
import {
  getMyTasksAcrossProjectsToolDefinition,
  getMyTasksAcrossProjectsHandler,
  getWorkloadSummaryToolDefinition,
  getWorkloadSummaryHandler,
  suggestWorkPriorityToolDefinition,
  suggestWorkPriorityHandler,
  generateDailyReportToolDefinition,
  generateDailyReportHandler,
} from './personalTools';

/**
 * Unified registry of all available AI tools (project + personal)
 */
export const unifiedToolRegistry: Map<string, RegisteredTool> = new Map();
unifiedToolRegistry.set(recordReportToolDefinition.name,{definition:recordReportToolDefinition,handler:recordReportHandler,scope:'both'});

// ============================================
// Project-scope Tools
// ============================================

// Task Creation Tools
unifiedToolRegistry.set('create_task', {
  definition: createTaskToolDefinition,
  handler: createTaskHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('create_tasks', {
  definition: createTasksToolDefinition,
  handler: createTasksHandler as unknown as ToolHandler,
  scope: 'project',
});

// Task Modification Tools
unifiedToolRegistry.set('update_task', {
  definition: updateTaskToolDefinition,
  handler: updateTaskHandler as unknown as ToolHandler,
  scope: 'both',
});

unifiedToolRegistry.set('delete_task', {
  definition: deleteTaskToolDefinition,
  handler: deleteTaskHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('restore_task', {
  definition: restoreTaskToolDefinition,
  handler: restoreTaskHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('complete_task', {
  definition: completeTaskToolDefinition,
  handler: completeTaskHandler as unknown as ToolHandler,
  scope: 'both',
});

unifiedToolRegistry.set('move_task', {
  definition: moveTaskToolDefinition,
  handler: moveTaskHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('assign_task', {
  definition: assignTaskToolDefinition,
  handler: assignTaskHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('copy_task_to_project', {
  definition: copyTaskToProjectToolDefinition,
  handler: copyTaskToProjectHandler as unknown as ToolHandler,
  scope: 'both', // Can be used from both project and personal contexts
});

// Query Tools (Read-only)
unifiedToolRegistry.set('get_tasks', {
  definition: getTasksToolDefinition,
  handler: getTasksHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('get_task_details', {
  definition: getTaskDetailsToolDefinition,
  handler: getTaskDetailsHandler as unknown as ToolHandler,
  scope: 'both',
});

unifiedToolRegistry.set('get_project_summary', {
  definition: getProjectSummaryToolDefinition,
  handler: getProjectSummaryHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('get_my_tasks', {
  definition: getMyTasksToolDefinition,
  handler: getMyTasksHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('get_overdue_tasks', {
  definition: getOverdueTasksToolDefinition,
  handler: getOverdueTasksHandler as unknown as ToolHandler,
  scope: 'project',
});

// Project Structure Query Tools (Read-only)
unifiedToolRegistry.set('get_lists', {
  definition: getListsToolDefinition,
  handler: getListsHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('get_members', {
  definition: getMembersToolDefinition,
  handler: getMembersHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('get_labels', {
  definition: getLabelsToolDefinition,
  handler: getLabelsHandler as unknown as ToolHandler,
  scope: 'project',
});

// Schedule Analysis Tools
unifiedToolRegistry.set('suggest_schedule_changes', {
  definition: suggestScheduleChangesToolDefinition,
  handler: suggestScheduleChangesHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('notify_dependency_delays', {
  definition: notifyDependencyDelaysToolDefinition,
  handler: notifyDependencyDelaysHandler as unknown as ToolHandler,
  scope: 'project',
});

// Plan Generation Tools
unifiedToolRegistry.set('generate_task_plan', {
  definition: generateTaskPlanToolDefinition,
  handler: generateTaskPlanHandler as unknown as ToolHandler,
  scope: 'project',
});

unifiedToolRegistry.set('execute_task_plan', {
  definition: executeTaskPlanToolDefinition,
  handler: executeTaskPlanHandler as unknown as ToolHandler,
  scope: 'project',
});

// Quality Assistance Tools
unifiedToolRegistry.set('suggest_improvements', {
  definition: suggestImprovementsToolDefinition,
  handler: suggestImprovementsHandler as unknown as ToolHandler,
  scope: 'project',
});

// ============================================
// Personal-scope Tools (Cross-project)
// ============================================
unifiedToolRegistry.set('get_my_tasks_across_projects', {
  definition: getMyTasksAcrossProjectsToolDefinition,
  handler: getMyTasksAcrossProjectsHandler as unknown as ToolHandler,
  scope: 'personal',
});

unifiedToolRegistry.set('get_workload_summary', {
  definition: getWorkloadSummaryToolDefinition,
  handler: getWorkloadSummaryHandler as unknown as ToolHandler,
  scope: 'personal',
});

unifiedToolRegistry.set('suggest_work_priority', {
  definition: suggestWorkPriorityToolDefinition,
  handler: suggestWorkPriorityHandler as unknown as ToolHandler,
  scope: 'personal',
});

unifiedToolRegistry.set('generate_daily_report', {
  definition: generateDailyReportToolDefinition,
  handler: generateDailyReportHandler as unknown as ToolHandler,
  scope: 'personal',
});

// ============================================
// Unified API
// ============================================

/**
 * Get tool definitions based on context.
 * If projectId is provided, returns project + personal tools.
 * Otherwise, returns only personal tools.
 */
export function getToolDefinitions(options?: { projectId?: string | null }): AITool[] {
  const hasProject = options?.projectId;
  return Array.from(unifiedToolRegistry.values())
    .filter((tool) => hasProject ? true : tool.scope === 'personal' || tool.scope === 'both')
    .map((tool) => tool.definition);
}

/**
 * Get a tool from the unified registry
 */
export function getUnifiedTool(name: string): RegisteredTool | undefined {
  return unifiedToolRegistry.get(name);
}

/**
 * Get tool definitions formatted for OpenAI API
 */
export function getOpenAITools(options?: { projectId?: string | null }): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}> {
  const tools = getToolDefinitions(options);
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Get tool definitions formatted for Anthropic API
 */
export function getAnthropicTools(options?: { projectId?: string | null }): Array<{
  name: string;
  description: string;
  input_schema: object;
}> {
  const tools = getToolDefinitions(options);
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

/**
 * Get tool definitions formatted for Gemini API
 */
export function getGeminiTools(options?: { projectId?: string | null }): Array<{
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: object;
  }>;
}> {
  const tools = getToolDefinitions(options);
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: convertToGeminiSchema(tool.parameters),
      })),
    },
  ];
}

/**
 * Convert JSON Schema to Gemini format
 */
function convertToGeminiSchema(schema: object): object {
  // Gemini uses uppercase types
  return JSON.parse(
    JSON.stringify(schema).replace(/"type":\s*"(\w+)"/g, (_, type) => {
      return `"type":"${type.toUpperCase()}"`;
    })
  );
}

// Re-export types
export * from './types';
