/**
 * Validation utilities for AI tools
 * Provides schema validation for task date fields and dependency checks
 */

import { hasCircularDependency } from '@/lib/utils/task';
import { taskDateError } from '@/lib/task/dateValidation';
import type { Task } from '@/types';

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Arguments for date field validation
 */
export interface DateFieldValidationArgs {
  startDate?: string | null;
  dueDate?: string | null;
  durationDays?: number | null;
  isDueDateFixed?: boolean;
}

/**
 * Validates task date field combinations
 *
 * Rules:
 * - durationDays without startDate -> error
 * - isDueDateFixed: true without dueDate -> error
 * - dueDate < startDate -> error
 *
 * @param args Date field arguments to validate
 * @returns ValidationResult with errors and warnings
 */
export function validateTaskDateFields(args: DateFieldValidationArgs): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { startDate, dueDate, durationDays, isDueDateFixed } = args;

  // Check: durationDays without startDate
  if (durationDays !== undefined && durationDays !== null && !startDate) {
    errors.push('所要日数（durationDays）を指定する場合は開始日（startDate）も指定してください。');
  }

  // Check: isDueDateFixed: true without dueDate
  if (isDueDateFixed === true && !dueDate) {
    errors.push('期限固定（isDueDateFixed: true）を指定する場合は期限（dueDate）も指定してください。');
  }

  // Check: dueDate < startDate
  const dateError = taskDateError({ startDate, dueDate });
  if (dateError) errors.push(dateError);

  // Warning: durationDays with explicit dueDate (will be ignored if startDate is set)
  if (durationDays !== undefined && durationDays !== null && dueDate && startDate) {
    warnings.push('開始日と所要日数が指定されているため、指定された期限は無視され自動計算されます。');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Arguments for dependency validation
 */
export interface DependencyValidationArgs {
  taskId?: string; // For updates - the task being updated
  dependsOnTaskIds: string[];
  allTasks: Task[];
}

/**
 * Validates task dependencies for circular references and existence
 *
 * @param args Dependency validation arguments
 * @returns ValidationResult with errors and warnings
 */
export function validateDependencies(args: DependencyValidationArgs): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { taskId, dependsOnTaskIds, allTasks } = args;

  if (!dependsOnTaskIds || dependsOnTaskIds.length === 0) {
    return { valid: true, errors, warnings };
  }

  // Create a map for quick lookups
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  // Check each dependency
  for (const depId of dependsOnTaskIds) {
    // Check if dependency task exists
    const depTask = taskMap.get(depId);
    if (!depTask) {
      errors.push(`依存タスク（ID: ${depId}）が見つかりません。`);
      continue;
    }

    // Check for circular dependency (only if we have a taskId - for updates)
    if (taskId) {
      if (hasCircularDependency(taskId, depId, allTasks)) {
        errors.push(`タスク「${depTask.title}」への依存は循環参照を発生させます。`);
      }
    }
  }

  // Warning for completed dependency tasks
  const completedDeps = dependsOnTaskIds
    .map(id => taskMap.get(id))
    .filter((t): t is Task => t !== undefined && t.isCompleted);

  if (completedDeps.length > 0) {
    const titles = completedDeps.map(t => t.title).join('、');
    warnings.push(`依存タスク「${titles}」は既に完了しています。`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Combined validation for task creation/update
 */
export interface TaskValidationArgs {
  taskId?: string;
  startDate?: string | null;
  dueDate?: string | null;
  durationDays?: number | null;
  isDueDateFixed?: boolean;
  dependsOnTaskIds?: string[];
  allTasks?: Task[];
}

/**
 * Performs all task validations
 *
 * @param args Combined validation arguments
 * @returns ValidationResult with all errors and warnings
 */
export function validateTask(args: TaskValidationArgs): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate date fields
  const dateValidation = validateTaskDateFields({
    startDate: args.startDate,
    dueDate: args.dueDate,
    durationDays: args.durationDays,
    isDueDateFixed: args.isDueDateFixed,
  });
  errors.push(...dateValidation.errors);
  warnings.push(...dateValidation.warnings);

  // Validate dependencies if provided
  if (args.dependsOnTaskIds && args.allTasks) {
    const depValidation = validateDependencies({
      taskId: args.taskId,
      dependsOnTaskIds: args.dependsOnTaskIds,
      allTasks: args.allTasks,
    });
    errors.push(...depValidation.errors);
    warnings.push(...depValidation.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if predicted end date exceeds fixed due date
 *
 * @param predictedEndDate The predicted end date based on dependencies
 * @param fixedDueDate The fixed due date
 * @returns Warning message if deadline would be overdue, null otherwise
 */
export function checkDeadlineOverdue(
  predictedEndDate: Date,
  fixedDueDate: Date
): string | null {
  if (predictedEndDate > fixedDueDate) {
    const daysDiff = Math.ceil(
      (predictedEndDate.getTime() - fixedDueDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    return `依存タスクの完了予定日により、期限を${daysDiff}日超過する見込みです。期限の延長または所要日数の短縮を検討してください。`;
  }
  return null;
}
