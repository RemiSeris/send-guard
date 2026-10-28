import type { Register } from 'claude-code'

// Send Guard: an email to anyone only leaves if its exact version (recipients,
// subject, body, attachments) was read by a context-free verifier, and the user
// said yes. The verdict is a hint, not a veto: what blocks is a missing check.
// / Un mail ne part que si sa version exacte a été lue par un vérificateur sans
// contexte, et si l'utilisateur a dit oui. Le verdict est un indice, pas un veto.

// The Gmail connector is not named the same everywhere ("Gmail" in Cowork, an id in the
// desktop app): the gate matches the verb, whatever the server.
// Note: any MCP server exposing send_message/reply/forward goes through the gate; better a refusal too many than a send too many.
const verbOf = (tool: string) => /^mcp__.+__(send_message|reply|forward)$/.exec(tool)?.[1]
const VERIFY_TOOL = 'mcp__dent-send-guard__verify_send'
const AGENT = 'dent-send-guard:verifier'

const VERIFIER_PROMPT = `You are a context-free verifier. You know neither the sender nor their decisions: that is on purpose.
You are given an email ready to go, exactly as it will be sent, what is known about the recipient, and the raw sources.
Check:
1. Every number, name, date, place and fact against the sources given. Anything without a source: "not verifiable".
2. Read the email as the recipient will: what they won't understand, what rings false, the tone and register, what is promised without proof in hand.
3. Internal traces: brackets, working notes, placeholder text, details that were not meant to leave.
Answer briefly, in the language of the "What is known about the recipient" notes: one VERDICT line (OK, REVISE or BLOCKING), then numbered points, each quoting the email exactly.`

type Rec = { when: string; tool: string; to: string[]; verdict: string }

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function list(v: unknown): string[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new Error('recipients not an array')
  return v.map(x => String(x).trim().toLowerCase()).sort()
}

function attachmentsOf(a: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(a.attachments) ? (a.attachments as Record<string, unknown>[]) : []
}

// The text of a readable attachment (text, md, csv, html); null for a binary.
function readAttachment(p: Record<string, unknown>): string | null {
  if (!(String(p.mimeType ?? '').startsWith('text/') || /\.(md|txt|csv|html)$/i.test(String(p.filename ?? '')))) return null
  // base64 or base64url (- and _), with or without padding.
  const b64 = String(p.content ?? '').replace(/-/g, '+').replace(/_/g, '/')
  try { return new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0))) } catch { return '(unreadable)' }
}

// Everyone a send reaches, including those Gmail adds by itself:
// the original sender of a reply with no "to", the thread's copies on a reply-all.
function recipientsOf(tool: string, a: Record<string, unknown>): string[] {
  const t = [...list(a.to), ...list(a.cc), ...list(a.bcc)]
  if (verbOf(tool) === 'reply') {
    if (list(a.to).length === 0) t.push('(sender of the original message)')
    // An empty cc counts as no cc for Gmail: the thread's copies are kept.
    if (a.replyAll === true && list(a.cc).length === 0) t.push('(thread copies, reply-all)')
  }
  return t
}

// Fingerprint of the version sent: everything the recipient will receive.
export async function fingerprint(tool: string, a: Record<string, unknown>): Promise<string> {
  const att = await Promise.all(attachmentsOf(a).map(async p => ({
    name: p.filename ?? '', type: p.mimeType ?? '', inline: p.inline ?? false, content: await sha(String(p.content ?? '')) })))
  return sha(JSON.stringify({
    tool: verbOf(tool) ?? tool, to: list(a.to), cc: list(a.cc), ccGiven: a.cc !== undefined, bcc: list(a.bcc),
    subject: a.subject ?? '', body: a.body ?? '', htmlBody: a.htmlBody ?? '',
    forwardText: a.forwardText ?? '', messageId: a.messageId ?? '',
    replyThreadId: a.replyThreadId ?? '', replyToMessageId: a.replyToMessageId ?? '',
    replyAll: a.replyAll ?? false, includeSignature: a.includeSignature ?? false, att,
  }))
}

function argsOf(e: Record<string, unknown>): Record<string, unknown> {
  const { tool, tool_use_id, agentId, requestMeta, consent, ...rest } = e
  return rest
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.agent.register({
      name: 'verifier',
      description: 'Context-free verifier of outgoing emails (launched only by send-guard). / Vérificateur sans contexte des mails sortants (lancé seulement par send-guard).',
      prompt: VERIFIER_PROMPT,
      tools: [],
      omitClaudeMd: true,
    })
    await $.tool.register({
      name: 'verify_send',
      description: 'Pass an outgoing email to the context-free verifier, before sending. Give the EXACT arguments of the send: a send that differs from the verified version is refused. The verdict (a hint, not a veto) comes back as the verifier\'s report. / Passe un mail au vérificateur sans contexte avant envoi, avec les arguments EXACTS de l\'envoi.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          send_tool: { type: 'string', description: 'The exact name of the send tool that will be called (send_message, reply or forward of the session\'s Gmail server).' },
          arguments: { type: 'object', description: 'The exact arguments of the upcoming send call.' },
          recipient: { type: 'string', description: 'Who they are, what they already know, the relationship and register. Write it in the user\'s language.' },
          sources: { type: 'string', description: 'Raw sources for the facts and figures in the email (not a summary), and the original message for a reply or forward.' },
        },
        required: ['send_tool', 'arguments', 'recipient', 'sources'],
      },
    })
    return r
  })

  on('agent.offer', { agent: AGENT }, () => ({ isOffered: false }))

  // In auto mode the classifier gives no verdict on a subagent no user request launched,
  // so the verifier never started. The launch of this plugin's own verifier always asks
  // the user. Every other decision is left to Claude Code.
  on('tool.check', { tool: 'Agent' }, ($, e, next) => {
    const i = (e.input ?? {}) as Record<string, unknown>
    if (next.origin.plugin === 'dent-send-guard' && (i.subagent_type ?? i.subagentType) === AGENT) {
      return { decision: 'ask', reason: 'send-guard: launch its context-free verifier on this email?' }
    }
    return next(e)
  })

  // Truly context-free: text other plugins inject into every subagent (SubagentStart) does not reach it.
  on('classic.SubagentStart', async ($, e, next) => {
    const r = await next(e)
    return e.agent_type === AGENT ? { ...r, additionalContext: [] } : r
  })

  // The verdict is stored when the verifier finishes, not in verify_send: a hook only has
  // 10 s of its own, and waiting for the verdict went past it.
  on('turn.complete', async ($, e, next) => {
    const w = e.agentId ? (await $.store.get(`waiting:${e.agentId}`)) as { h: string; rec: Omit<Rec, 'verdict'> } | undefined : undefined
    if (w) {
      await $.store.set(`verified:${w.h}`, { ...w.rec, verdict: e.answer })
      await $.store.delete(`waiting:${e.agentId}`)
      await $.store.delete(`pending:${w.h}`)
    }
    return next(e)
  })

  // The verifier: launched by the code, on the exact version.
  on('tool.call', { tool: VERIFY_TOOL }, async ($, e) => {
    const x = e as unknown as { send_tool: string; arguments: Record<string, unknown>; recipient: string; sources: string }
    const sendTool = String(x.send_tool)
    if (!verbOf(sendTool)) return { deny: `send-guard: unknown send tool ${sendTool} / outil d'envoi inconnu` }
    if (x.arguments?.draftId) return { deny: 'send-guard: a draft cannot be verified; pass the text itself. / Un brouillon ne se vérifie pas ; passer le texte lui-même.' }
    const a = x.arguments ?? {}
    const pieces = attachmentsOf(a).map((p, i) => {
      const type = String(p.mimeType ?? '')
      return `Attachment ${i + 1}: ${p.filename ?? '(no name)'} [${type || 'unknown type'}${p.inline ? ', inline' : ''}]\n${readAttachment(p) ?? '(binary content not shown)'}`
    })
    const text = [
      `Tool: ${sendTool}`,
      `To: ${list(a.to).join(', ') || '(none: for a reply, the original sender)'}`,
      `Cc: ${a.cc === undefined ? '(not given: for a reply, the thread copies if reply-all)' : list(a.cc).join(', ')}`,
      `Bcc: ${list(a.bcc).join(', ')}`,
      `Reply-all: ${a.replyAll === true ? 'yes' : 'no'}`,
      `Original message (id): ${a.messageId ?? a.replyToMessageId ?? a.replyThreadId ?? '(none)'}`,
      `Subject: ${a.subject ?? '(reply or forward)'}`,
      `Text body:\n${a.body ?? a.forwardText ?? '(empty)'}`,
      `HTML body (what most mail apps show):\n${a.htmlBody ?? '(none)'}`,
      `Attachments: ${pieces.length}\n${pieces.join('\n\n')}`,
      `\nWhat is known about the recipient:\n${x.recipient}`, `\nRaw sources:\n${x.sources}`,
    ].join('\n')
    const sp = await $.agent.spawn({ subagentType: AGENT, prompt: text, description: 'check before sending' }) as { agentId?: string; deny?: string }
    const { agentId, deny } = sp
    if (deny || !agentId) return { deny: `send-guard: verifier not launched (${deny ?? 'no id'}) / vérificateur non lancé` }
    const h = await fingerprint(sendTool, a)
    const rec = { when: new Date().toISOString(), tool: sendTool, to: [...list(a.to), ...list(a.cc), ...list(a.bcc)] }
    await $.store.set(`waiting:${agentId}`, { h, rec })
    // Note: a verifier that dies without turn.complete leaves "pending"; calling verify_send again overwrites it.
    await $.store.set(`pending:${h}`, agentId)
    return { result: `Verification started (fingerprint ${h.slice(0, 12)}…). The verdict comes back as the verifier's report: read it before sending. This exact version passes the gate once the verdict is in; any edit to the text needs a new pass. / Vérification lancée : lire le rapport du vérificateur avant d'envoyer ; toute retouche demande un nouveau passage.` }
  })

  // The gate: every send must match a verified version, then get the user's yes.
  {
    on('tool.call', async ($, e, next) => {
      const tool = e.tool
      if (!verbOf(tool)) return next(e)
      const a = argsOf(e as unknown as Record<string, unknown>)
      const log = async (decision: string) => {
        const j = ((await $.store.get('log')) as unknown[] | undefined) ?? []
        await $.store.set('log', [...j, { when: new Date().toISOString(), tool, decision }].slice(-200))
      }
      if (a.draftId) {
        await log('refused: draft')
        return { deny: `send-guard: sending a draft by id is refused; send the text itself, after ${VERIFY_TOOL}. / Envoi d'un brouillon refusé ; envoyer le texte lui-même, après vérification.` }
      }
      const to = recipientsOf(tool, a)
      const h = await fingerprint(tool, a)
      const rec = (await $.store.get(`verified:${h}`)) as Rec | undefined
      if (!rec && await $.store.get(`pending:${h}`)) {
        await log(`refused: verification in progress (${to.join(', ')})`)
        return { deny: `send-guard: the check of this version is in progress. Wait for the verifier's report, read it, then send again; with no report, call ${VERIFY_TOOL} again. / Vérification en cours : attendre le rapport du vérificateur.` }
      }
      if (!rec) {
        await log(`refused: not verified (${to.join(', ')})`)
        return { deny: `send-guard: this version has not been through the verifier. Call ${VERIFY_TOOL} with exactly the same arguments, read the verdict, then send again. / Cette version n'est pas passée par le vérificateur. (Recipients / Destinataires : ${to.join(', ')})` }
      }
      // The user's yes, asked by the code in the app's question window: the model cannot answer for them.
      const preview = String(a.body ?? a.forwardText ?? a.htmlBody ?? '').slice(0, 300)
      let yes = false
      try {
        const rep = await $.ui.ask(`Send this email to ${to.join(', ')}? / Envoyer ce mail ? Subject / Objet : ${a.subject ?? '(reply or forward)'}. « ${preview} »`, { options: ['Send / Envoyer', 'Don\'t send / Ne pas envoyer'], header: 'Send' })
        yes = rep === 'Send / Envoyer'
      } catch { /* nobody to answer (-p, scheduled task) or question closed: no */ }
      if (!yes) {
        await log(`refused: no yes from the user (${to.join(', ')})`)
        return { deny: `send-guard: the user did not say yes to this send (${to.join(', ')}). Ask them in the conversation, then send again: the question will be asked again. / L'utilisateur n'a pas dit oui à cet envoi.` }
      }
      await log(`sent: verified ${rec.when} (${rec.verdict.split('\n').find(l => /^\W*verdict\b/i.test(l)) ?? rec.verdict.split('\n')[0]}), user said yes`)
      return next(e)
    }).catch(($, e, next) => next.called || !verbOf(e.tool) ? next(e) : { deny: 'send-guard: the guard failed, send refused. / La garde a échoué, envoi refusé.' })
  }
}
