import { expect, test } from 'claude-code/testing'
import { fingerprint } from './register'

// Simulated engine: an in-memory store, a launched agent, a send that "leaves".
// answer: what the user clicks in the question window; null = nobody to answer.
function engine(on: any, answer?: string | null) {
  const store = new Map<string, unknown>()
  const sent: unknown[] = []
  const asked: any[] = []
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_: unknown, e: any) => { store.delete(e.key); return { value: undefined } })
  on('agent.register', () => ({ value: { agent: 'dent-send-guard:verifier' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__dent-send-guard__verify_send' } }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'verif-1', value: { model: 'm', agentId: 'verif-1' } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      asked.push(e)
      if (answer == null) return { deny: 'nobody to answer' }
      return { result: { answers: { [e.questions?.[0]?.question ?? '']: answer } } }
    }
    sent.push(e); return { result: { id: 'msg' } }
  })
  return { store, sent, asked }
}

const SEND = 'mcp__Gmail__send_message'
const MAIL = { to: ['test@example.com'], subject: 'Hello', body: 'Verified text.' }
const START = { cwd: '/', surface: 'desktop', isInteractive: true }
const verified = async (m: { store: Map<string, unknown> }, tool: string, a: Record<string, unknown>) =>
  m.store.set(`verified:${await fingerprint(tool, a)}`, { when: 'x', tool, to: a.to, verdict: 'VERDICT: OK' })

test('a send to test@example.com without verification is refused', async ($, on) => {
  const m = engine(on, 'Send / Envoyer')
  await $.session.start(START as any)
  const r = await $.tool.call({ tool: SEND, ...MAIL } as any)
  expect(r.deny ?? r.text).toMatch(/has not been through the verifier/)
  expect(m.sent.length).toBe(0)
  expect(JSON.stringify(m.store.get('log'))).toMatch(/refused: not verified/)
})

test('the verified version passes with the user\'s yes; an edited version is refused', async ($, on) => {
  const m = engine(on, 'Send / Envoyer')
  await verified(m, SEND, MAIL)
  await $.session.start(START as any)
  await $.tool.call({ tool: SEND, ...MAIL } as any)
  expect(m.sent.length).toBe(1)
  const r = await $.tool.call({ tool: SEND, ...MAIL, body: 'Edited after.' } as any)
  expect(r.deny ?? r.text).toMatch(/has not been through the verifier/)
  const r2 = await $.tool.call({ tool: SEND, ...MAIL, cc: ['other@example.com'] } as any)
  expect(r2.deny ?? r2.text).toMatch(/has not been through the verifier/)
  expect(m.sent.length).toBe(1)
})

test('verified but the user says no: refused', async ($, on) => {
  const m = engine(on, 'Don\'t send / Ne pas envoyer')
  await verified(m, SEND, MAIL)
  await $.session.start(START as any)
  const r = await $.tool.call({ tool: SEND, ...MAIL } as any)
  expect(r.deny ?? r.text).toMatch(/did not say yes/)
  expect(m.asked.length).toBe(1)
  expect(m.sent.length).toBe(0)
})

test('nobody to answer (scheduled task, -p): refused', async ($, on) => {
  const m = engine(on, null)
  await verified(m, SEND, MAIL)
  await $.session.start(START as any)
  const r = await $.tool.call({ tool: SEND, ...MAIL } as any)
  expect(r.deny ?? r.text).toMatch(/did not say yes/)
  expect(m.sent.length).toBe(0)
})

// The test bench gives the plugin no agent id from a spawn: seed what verify_send leaves.
test('verification started: send refused until the verdict is in, then it passes', async ($, on) => {
  const m = engine(on, 'Send / Envoyer')
  const h = await fingerprint(SEND, MAIL)
  m.store.set('waiting:verif-1', { h, rec: { when: 'x', tool: SEND, to: MAIL.to } })
  m.store.set(`pending:${h}`, 'verif-1')
  await $.session.start(START as any)
  const r = await $.tool.call({ tool: SEND, ...MAIL } as any)
  expect(r.deny ?? r.text).toMatch(/in progress/)
  await $.turn.complete({ agentId: 'verif-1', answer: 'VERDICT: OK' } as any)
  expect((m.store.get(`verified:${h}`) as any)?.verdict).toBe('VERDICT: OK')
  expect(m.store.has(`pending:${h}`) || m.store.has('waiting:verif-1')).toBe(false)
  await $.tool.call({ tool: SEND, ...MAIL } as any)
  expect(m.sent.length).toBe(1)
})

// The allow only holds for a launch by send-guard itself ($.agent.spawn): the bench
// cannot play that origin, it is checked for real after install.
test('outside send-guard, launching the verifier (or another agent) keeps the engine\'s decision', async ($, on) => {
  engine(on)
  on('tool.check', () => ({ decision: 'deny', reason: 'no verdict' }))
  await $.session.start(START as any)
  const v = await $.tool.check({ tool: 'Agent', input: { subagent_type: 'dent-send-guard:verifier', prompt: 'x', description: 'v' } })
  expect(v.decision).toBe('deny')
  const other = await $.tool.check({ tool: 'Agent', input: { subagent_type: 'general-purpose', prompt: 'x', description: 'v' } })
  expect(other.decision).toBe('deny')
})

test('sending a draft by id is refused', async ($, on) => {
  const m = engine(on, 'Send / Envoyer')
  await $.session.start(START as any)
  const r = await $.tool.call({ tool: SEND, draftId: 'd1' } as any)
  expect(r.deny ?? r.text).toMatch(/draft/)
  expect(m.sent.length).toBe(0)
})

test('a reply with no "to", or reply-all with an empty cc, still reaches people: refused', async ($, on) => {
  const m = engine(on, 'Send / Envoyer')
  await $.session.start(START as any)
  const r = await $.tool.call({ tool: 'mcp__Gmail__reply', messageId: 'm1', body: 'x' } as any)
  expect(r.deny ?? r.text).toMatch(/sender of the original message/)
  const r2 = await $.tool.call({ tool: 'mcp__Gmail__reply', messageId: 'm1', to: ['a@example.com'], cc: [], replyAll: true, body: 'x' } as any)
  expect(r2.deny ?? r2.text).toMatch(/thread copies/)
  expect(m.sent.length).toBe(0)
})

test('a Gmail server named by an id, a forward, recipients not in an array: refused', async ($, on) => {
  const m = engine(on, 'Send / Envoyer')
  await $.session.start(START as any)
  const r = await $.tool.call({ tool: 'mcp__00000000-0000-0000-0000-000000000000__forward', messageId: 'm1', to: ['test@example.com'] } as any)
  expect(r.deny ?? r.text).toMatch(/has not been through the verifier/)
  const r2 = await $.tool.call({ tool: SEND, to: 'test@example.com', body: 'x' } as any)
  expect(r2.deny ?? r2.text).toMatch(/send-guard/)
  expect(m.sent.length).toBe(0)
})

test('the verifier does not get text other plugins inject into subagents; other agents do', async ($, on) => {
  engine(on)
  on('classic.SubagentStart', () => ({ additionalContext: ['OTHER PLUGIN TEXT'] }))
  await $.session.start(START as any)
  const v = await $.classic.SubagentStart({ agent_id: 'v', agent_type: 'dent-send-guard:verifier' } as any)
  expect(v.additionalContext ?? []).toEqual([])
  const other = await $.classic.SubagentStart({ agent_id: 'x', agent_type: 'general-purpose' } as any)
  expect(other.additionalContext).toEqual(['OTHER PLUGIN TEXT'])
})
