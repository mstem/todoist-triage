const TODOIST_BASE = 'https://api.todoist.com/api/v1';

const COMMON_RULES = `Do not skip steps, and do not say any tools or steps are "unavailable" — just complete the curl request below using Bash.

When you're done, post your plan as a single Todoist comment using curl:

curl -s -X POST ${TODOIST_BASE}/comments -H "Authorization: Bearer $TODOIST_API_TOKEN" -H "Content-Type: application/json" -d '<JSON body>'

The JSON body must be a single object with the id field shown below and a "content" field containing your plan as a markdown string (escape it correctly for JSON). Confirm the curl response contains an "id" field — if it doesn't, fix the request and retry once. Do not take any other action.`;

export function buildProjectPrompt({ todoistId, projectName, parentName, openTasks = [] }) {
  const taskList = openTasks.length
    ? openTasks
        .map(t => {
          const desc = (t.description || '').trim();
          return desc ? `- ${t.content}\n    ${desc.replace(/\n/g, '\n    ')}` : `- ${t.content}`;
        })
        .join('\n')
    : '(no open tasks)';

  return `You are helping plan a Todoist project. PLAN ONLY — do not do any of the work in this project, and do not modify, complete, or comment on any individual tasks.

Project: "${projectName}"${parentName ? ` (inside "${parentName}")` : ''}

Open tasks in this project:
${taskList}

Review the tasks above and propose a concrete next-step plan: what's the single next action, what can be batched together, what looks stale and could be dropped, and a rough sequencing for the rest. Keep it to a few short paragraphs or a short bulleted list — concise and actionable.

${COMMON_RULES}

Use "project_id": "${todoistId}" in the JSON body.`;
}

export function buildTaskPrompt({ todoistId, content, description, projectName, parentProjectName }) {
  const location = [parentProjectName, projectName].filter(Boolean).join(' / ');

  return `You are helping plan a Todoist task. PLAN ONLY — do not do the task itself.

Task: "${content}"${location ? ` (in ${location})` : ''}
${description ? `Description: ${description}` : 'Description: (none)'}

Propose a concrete breakdown of next steps to get this task done: the very first action, the likely sub-steps, and anything that needs research or a decision before starting. Keep it to a few short paragraphs or a short bulleted list — concise and actionable.

${COMMON_RULES}

Use "task_id": "${todoistId}" in the JSON body.`;
}
