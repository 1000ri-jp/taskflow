/**
 * AI Tool definitions for Function Calling
 */

// JSON Schema types for tool parameters
export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

/**
 * Tool definition interface
 */
export interface AITool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/**
 * Tool call from AI response
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  // Gemini 3 specific: thought signature for function calls
  thoughtSignature?: string;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  toolCallId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * AI Scope type - determines the context of AI operations
 */
export type AIScope = 'project' | 'personal' | 'companion';

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  sourceUserMessage?: {id:string;content:string};
  scope: AIScope;
  projectId: string;      // For project scope (required for backward compatibility)
  projectIds?: string[];  // For personal scope (all user's project IDs)
  userId: string;
  listId?: string;        // Default list for task creation
}

/**
 * Tool handler function type
 */
export type ToolHandler<TArgs = Record<string, unknown>, TResult = unknown> = (
  args: TArgs,
  context: ToolExecutionContext
) => Promise<TResult>;

/**
 * Tool scope - determines when a tool is available
 */
export type ToolScope = 'project' | 'personal' | 'both';

/**
 * Registered tool with handler
 */
export interface RegisteredTool {
  definition: AITool;
  handler: ToolHandler;
  scope: ToolScope;
}

// Create task tool argument types
export interface CreateTaskArgs {
  assigneeIds?: string[];
  title: string;
  description?: string;
  priority?: 'high' | 'medium' | 'low';
  startDate?: string; // ISO 8601 format - task start date for Gantt
  durationDays?: number; // Duration in days - if set with startDate, dueDate is auto-calculated
  dueDate?: string; // ISO 8601 format - task end/due date (auto-calculated if durationDays is set)
  isDueDateFixed?: boolean; // If true, due date is fixed (duration changes won't auto-adjust it)
  listId?: string; // Target list ID, falls back to context.listId if not provided
  dependsOnTaskIds?: string[]; // Task IDs that must be completed before this task
}

export interface CreateTaskResult {
  taskId: string;
  title: string;
  success: boolean;
  suggestedStartDate?: string; // Auto-suggested start date based on dependencies
  warnings?: string[]; // Warnings about date calculations, deadline overdue, etc.
}

// Multiple tasks creation
export interface CreateTasksArgs {
  tasks: CreateTaskArgs[];
}

export interface CreateTasksResult {
  tasks: CreateTaskResult[];
  totalCreated: number;
}
