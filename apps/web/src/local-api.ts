import type {
  Project,
  ProjectDetail,
  ProjectInput,
  Selection,
  ImportOptions,
  ImportResult,
} from '@shouwei/contracts'
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        'x-shouwei-request': 'local',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new Error('本机服务没有响应，请检查启动终端后重试。')
  }
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('请使用包含本地服务的启动命令，单独网页预览不能保存真实材料。')
  }
  if (!response.ok || !result.ok)
    throw new Error(result.error?.userMessage ?? '本机操作失败，请重试。')
  return result.data as T
}
export const localAPI = {
  list: () => request<Project[]>('/projects'),
  create: (input: ProjectInput) => request<Project>('/projects', 'POST', input),
  detail: (id: string) => request<ProjectDetail>(`/projects/${id}`),
  update: (id: string, expectedRevision: number, input: ProjectInput) =>
    request<Project>(`/projects/${id}`, 'PATCH', { expectedRevision, input }),
  select: (id: string, name: string, base64: string) =>
    request<Selection>(`/projects/${id}/selections`, 'POST', { name, base64 }),
  import: (id: string, token: string, options: ImportOptions) =>
    request<ImportResult>(`/projects/${id}/imports`, 'POST', { token, ...options }),
  parse: (id: string, snapshotId: string, expectedRevision: number) =>
    request<ProjectDetail>(`/projects/${id}/parse`, 'POST', { snapshotId, expectedRevision }),
}
export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('无法读取此文件，请重新选择。'))
    reader.readAsDataURL(file)
  })
}
