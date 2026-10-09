import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Compile the actual application types; ordinary field additions need no MCP tool.
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile).config;
const options = ts.parseJsonConfigFileContent(config, ts.sys, process.cwd()).options;
const entries = {
  Task: 'src/types/index.ts', Checklist: 'src/types/index.ts', ChecklistItem: 'src/types/index.ts',
  Comment: 'src/types/index.ts', Attachment: 'src/types/index.ts', CommentAttachment: 'src/types/index.ts',
  TaskWorkState: 'src/types/index.ts', ChecklistItemMutation: 'src/lib/utils/checklist-item.ts', WorkflowInput: 'src/lib/task/workflow.ts',
  ReviewRequestInput: 'src/lib/task/commentSubmission.ts', RecurrenceSettings: 'src/lib/task/recurrence.ts',
  AllChildrenCompletionPolicy: 'src/lib/task/automationTypes.ts',
  CoordinationPolicy: 'src/lib/mcp/coordinatorTypes.ts', CoordinationExecutionInput: 'src/lib/mcp/coordinatorTypes.ts', CoordinationPlanInput: 'src/lib/mcp/coordinatorTypes.ts',
  CoordinationCheckpointInput: 'src/lib/mcp/coordinatorTypes.ts', CoordinationWaitInput: 'src/lib/mcp/coordinatorTypes.ts', CoordinationResumeInput: 'src/lib/mcp/coordinatorTypes.ts',
};
const program = ts.createProgram([...new Set(Object.values(entries))], options);
const checker = program.getTypeChecker();
function schema(type, depth = 0) {
  if (depth > 20) throw new Error('Recursive task type requires an explicit contract');
  if (type.symbol?.name === 'Date') return { type: 'string', format: 'task-date', 'x-date': true };
  if (type.isUnion()) {
    const values = type.types.filter(t => !(t.flags & ts.TypeFlags.Undefined));
    if (values.every(t => t.flags & ts.TypeFlags.BooleanLiteral)) return { type: 'boolean' };
    if (values.every(t => t.isLiteral())) return { enum: values.map(t => t.value) };
    return { anyOf: values.map(t => schema(t, depth + 1)) };
  }
  if (type.flags & ts.TypeFlags.Null) return { type: 'null' };
  if (type.isLiteral()) return { const: type.value };
  if (type.flags & ts.TypeFlags.BooleanLiteral) return { const: type.intrinsicName === 'true' };
  if (type.flags & ts.TypeFlags.String) return { type: 'string', maxLength: 20000 };
  if (type.flags & ts.TypeFlags.Number) return { type: 'number' };
  if (type.flags & ts.TypeFlags.Boolean) return { type: 'boolean' };
  if (checker.isArrayType(type)) return { type: 'array', maxItems: 1000, items: schema(checker.getTypeArguments(type)[0], depth + 1) };
  if (type.flags & ts.TypeFlags.Object || type.isIntersection()) {
    const properties = {}, required = [];
    for (const prop of checker.getPropertiesOfType(type)) {
      const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
      properties[prop.name] = schema(checker.getTypeOfSymbolAtLocation(prop, declaration), depth + 1);
      const description = ts.displayPartsToString(prop.getDocumentationComment(checker));
      if (description) properties[prop.name].description = description;
      if (!(prop.flags & ts.SymbolFlags.Optional)) required.push(prop.name);
    }
    const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    return { type: 'object', properties, required, additionalProperties: index ? schema(index, depth + 1) : false };
  }
  throw new Error(`Unsupported task type: ${checker.typeToString(type)}`);
}
const models = {};
for (const [name, path] of Object.entries(entries)) {
  const file = program.getSourceFile(path);
  const symbol = checker.getExportsOfModule(checker.getSymbolAtLocation(file)).find(s => s.name === name);
  if (!symbol) throw new Error(`Missing type ${name}`);
  models[name] = schema(checker.getDeclaredTypeOfSymbol(symbol));
}
const version = createHash('sha256').update(JSON.stringify(models)).digest('hex');
const output = JSON.stringify({ version, models }, null, 2) + '\n';
const target = 'src/lib/mcp/task-contract.generated.json';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Task contract is stale. Run npm run mcp:contract.');
} else writeFileSync(target, output);
const eventFields = Object.keys(models.Task.properties).filter(key => !['id', 'projectId', 'createdAt', 'updatedAt', 'hasChecklistDeadlines'].includes(key));
const eventSource = '// Generated from Task. Run npm run mcp:contract.\nexport const TASK_EVENT_FIELDS = ' + JSON.stringify(eventFields) + ';\n';
const eventTarget = 'scripts/mcp-events/task-fields.generated.mjs';
if (process.argv.includes('--check')) {
  if (readFileSync(eventTarget, 'utf8') !== eventSource) throw new Error('Task event fields are stale.');
} else writeFileSync(eventTarget, eventSource);
console.log(`Task contract: ${Object.keys(models.Task.properties).length} fields, ${version.slice(0, 12)}`);
