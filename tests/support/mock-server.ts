import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'

export interface MockHit {
  method: string
  url: string
  auth: string | undefined
  body: unknown
}

export type MockBehavior =
  | 'invalid-json'
  | 'unauthorized'
  | 'hang'
  | 'success'
  | 'repair-success'
  | 'repair-hang'
  | 'no-usage'
  | 'json-null'
  | 'rate-limited'

/** 本地 mock 模型服务：记录请求数并按指定行为响应。 */
export class MockModelServer {
  readonly hits: MockHit[]
  private readonly server: Server
  readonly baseUrl: string

  private constructor(server: Server, port: number, hits: MockHit[]) {
    this.server = server
    this.hits = hits
    this.baseUrl = `http://127.0.0.1:${port}/v1`
  }

  static start(
    behavior: MockBehavior | ((body: unknown) => unknown),
    port = 0,
  ): Promise<MockModelServer> {
    const hits: MockHit[] = []
    const server = createServer((req, res) => {
      void handle(req, res, behavior, hits)
    })
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        const port = (server.address() as { port: number }).port
        resolve(new MockModelServer(server, port, hits))
      })
    })
  }

  async close(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  behavior: MockBehavior | ((body: unknown) => unknown),
  hits: MockHit[],
): Promise<void> {
  const body = await readBody(req)
  hits.push({
    method: req.method ?? 'GET',
    url: req.url ?? '',
    auth: req.headers.authorization,
    body,
  })

  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'test-model' }] }))
    return
  }

  if (behavior === 'unauthorized' || behavior === 'rate-limited') {
    res.writeHead(behavior === 'unauthorized' ? 401 : 429, {
      'content-type': 'application/json',
    })
    res.end(
      JSON.stringify({
        error: {
          message: behavior === 'unauthorized' ? 'invalid api key' : 'rate limit',
          code: behavior === 'unauthorized' ? 'invalid_api_key' : 'rate_limit',
        },
      }),
    )
    return
  }

  if (behavior === 'hang' || (behavior === 'repair-hang' && hits.length > 1)) {
    // 保持连接不响应，模拟模型长时间不返回。
    return
  }

  const content =
    typeof behavior === 'function'
      ? JSON.stringify(behavior(body))
      : behavior === 'json-null'
        ? 'null'
        : behavior === 'no-usage'
          ? '{"ok":true}'
          : behavior === 'success' || (behavior === 'repair-success' && hits.length > 1)
            ? '{"ok":true}'
            : '我不会输出 JSON，只能说点闲话。'

  const streamed =
    typeof body === 'object' && body !== null && (body as { stream?: boolean }).stream === true
  if (streamed) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const event = (data: unknown): void => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }
    event({
      id: 'mock',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
    })
    event({
      id: 'mock',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      ...(behavior === 'no-usage'
        ? {}
        : { usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }),
    })
    res.write('data: [DONE]\n\n')
    res.end()
  } else {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [
          { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      }),
    )
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return Buffer.concat(chunks).toString('utf8')
  }
}
