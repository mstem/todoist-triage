const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const getProjectQueue = () => request('/projects/review-queue');
export const getTaskQueue = () => request('/tasks/review-queue');

export const getProjectList = () => request('/projects/list');

export const projectAction = (id, action, body) =>
  request(`/projects/${id}/${action}`, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

export const moveProject = (id, parentId) =>
  request(`/projects/${id}/move`, { method: 'POST', body: JSON.stringify({ parentId }) });

export const taskAction = (id, action, body) =>
  request(`/tasks/${id}/${action}`, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

export const updateTask = (id, body) =>
  request(`/tasks/${id}/update`, { method: 'POST', body: JSON.stringify(body) });

export const moveTask = (id, projectId) =>
  request(`/tasks/${id}/move`, { method: 'POST', body: JSON.stringify({ projectId }) });

export const rescheduleTask = (id, days, due) =>
  request(`/tasks/${id}/reschedule`, { method: 'POST', body: JSON.stringify({ days, due }) });

export const aiProject = payload =>
  request('/ai/project', { method: 'POST', body: JSON.stringify(payload) });

export const aiTask = payload =>
  request('/ai/task', { method: 'POST', body: JSON.stringify(payload) });
