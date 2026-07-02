// Conservative, deterministic "is this turn just a goodbye?" classifier for
// the voice-conversation loop. Runs on the final transcript BEFORE any model
// call - a clear sign-off ends the turn silently (no reply, no round trip);
// everything else falls through to a normal reply.
//
// Deliberately biased toward "keep replying" - going silent on a turn that
// wanted a reply reads as broken, while the occasional missed goodbye is
// just the old (unremarkable) behavior. Only the caller should decide
// *whether* to consult this at all (see the "first turn" note below); this
// module only classifies text.
//
// Not a model - a small set of word lists and thresholds, tuned against the
// cases below. When a real goodbye slips through or a real reply gets
// swallowed, add the phrase to the right list and add a case to the test
// file (voice-signoff.test.ts) so the fix can't silently regress.

/** Words that can lead a sign-off ("okay, thanks") without being part of it.
 * Also doubles as a bare one-word signoff when it's the entire utterance
 * (see SIGNOFF_CORE_PHRASES) - "great" alone ends a turn, "great, send that
 * email" treats "great" as filler and judges the rest on its own. */
const SIGNOFF_LEAD_WORDS = new Set([
  'okay',
  'ok',
  'alright',
  'right',
  'great',
  'cool',
  'awesome',
  'nice',
  'yeah',
  'yep',
  'yup',
  'sure',
  'well'
])

/** A sign-off phrase must actually be present, as the trailing part of the
 * utterance (anything before it must itself be SIGNOFF_LEAD_WORDS, capped at
 * two). Longest phrases are tried first so "thank you so much" doesn't
 * partial-match "thank you". */
const SIGNOFF_CORE_PHRASES = [
  'thank you so much',
  'thanks so much',
  'thanks a lot',
  'thank you',
  'thanks',
  'got it',
  'sounds good',
  'will do',
  'perfect',
  'great',
  'cool',
  'awesome',
  "that's all",
  "that's it",
  'all set',
  "we're good",
  "i'm good",
  'appreciate it',
  'much appreciated',
  'nice one',
  'right on',
  'goodbye',
  'bye bye',
  'bye',
  'see you later',
  'see you',
  'see ya',
  'take care',
  'later'
]

/** Any of these anywhere in the utterance means the person wants something
 * back - always reply normally, regardless of anything else matched. */
const QUESTION_VETO_PHRASES = [
  'can you',
  'could you',
  'would you',
  'will you',
  'how about',
  'what about',
  'one more thing',
  'one more',
  'also',
  'wait',
  'actually',
  'hold on',
  'quick question'
]

/** A bare imperative right after the filler ("send", "do", "call", ...) is
 * an instruction to the assistant, not a farewell - "great, send that
 * email" continues; "great, I'll send that" (SELF_COMMIT_LEADS) is still a
 * sign-off because the person is doing it themselves. */
const COMMAND_VERB_LEADS = new Set([
  'send',
  'do',
  'make',
  'call',
  'text',
  'email',
  'remind',
  'schedule',
  'book',
  'cancel',
  'check',
  'tell',
  'ask',
  'set',
  'add',
  'create',
  'delete',
  'open',
  'play',
  'pause',
  'stop',
  'turn',
  'show',
  'find',
  'search',
  'get',
  'buy',
  'order',
  'update',
  'change',
  'move',
  'start'
])

/** First-person commitments after a leading filler are still a sign-off
 * ("great, I'll send that") - matched with the apostrophe intact so it can
 * never be confused with the bare word "ill" (as in "I feel ill"). */
const SELF_COMMIT_LEADS = ["i'll", 'i will', "i'm going to", 'im going to']

/** Real goodbyes are brief - a longer sentence is almost always leading into
 * something else, even if it starts with a positive word. */
const MAX_SIGNOFF_WORDS = 8

export type VoiceSignoffReason = 'command' | 'no-match' | 'phrase' | 'question' | 'self-commit' | 'too-long'

export interface VoiceSignoffResult {
  isSignoff: boolean
  reason: VoiceSignoffReason
}

function tokenize(lower: string): string[] {
  return lower.match(/[a-z']+/g) ?? []
}

const phrasesByLength = [...SIGNOFF_CORE_PHRASES].sort((a, b) => b.split(' ').length - a.split(' ').length)

/**
 * Classify a final voice-turn transcript as a sign-off (stay silent, end the
 * conversation gracefully) or not (proceed with a normal reply).
 *
 * Callers should only consult this from the *second* turn of a conversation
 * onward - the assistant hasn't said anything yet on the first turn, so
 * there's nothing to sign off from (never let the very first utterance get
 * swallowed as a goodbye).
 */
export function classifyVoiceSignoff(transcript: string): VoiceSignoffResult {
  const trimmed = transcript.trim()

  if (!trimmed) {
    return { isSignoff: false, reason: 'no-match' }
  }

  const lower = trimmed.toLowerCase()

  if (lower.includes('?')) {
    return { isSignoff: false, reason: 'question' }
  }

  for (const cue of QUESTION_VETO_PHRASES) {
    if (new RegExp(`\\b${cue.replace(/ /g, '\\s+')}\\b`).test(lower)) {
      return { isSignoff: false, reason: 'question' }
    }
  }

  const tokens = tokenize(lower)

  if (tokens.length === 0 || tokens.length > MAX_SIGNOFF_WORDS) {
    return { isSignoff: false, reason: 'too-long' }
  }

  // Self-commit / command checks look at what's left after stripping up to
  // two leading filler words ("yeah, okay, thanks" style run-ups).
  let leadEnd = 0

  while (leadEnd < 2 && leadEnd < tokens.length && SIGNOFF_LEAD_WORDS.has(tokens[leadEnd]!)) {
    leadEnd++
  }

  const afterLead = tokens.slice(leadEnd)
  const afterLeadText = afterLead.join(' ')

  if (afterLead.length > 0) {
    for (const lead of SELF_COMMIT_LEADS) {
      if (afterLeadText === lead || afterLeadText.startsWith(`${lead} `)) {
        return { isSignoff: true, reason: 'self-commit' }
      }
    }

    if (COMMAND_VERB_LEADS.has(afterLead[0]!)) {
      return { isSignoff: false, reason: 'command' }
    }
  }

  // Try the core phrase as a *trailing* match over the full token list
  // (not `afterLead`) - the filler-word set and the phrase list overlap on
  // purpose ("great" alone is a signoff; "great" + more is just a filler),
  // and this is the one check that needs to see the whole utterance to
  // capture bare two-word phrases like "right on".
  for (const phrase of phrasesByLength) {
    const phraseTokens = phrase.split(' ')

    if (tokens.length < phraseTokens.length) {
      continue
    }

    const suffix = tokens.slice(tokens.length - phraseTokens.length)

    if (suffix.join(' ') !== phrase) {
      continue
    }

    const prefix = tokens.slice(0, tokens.length - phraseTokens.length)

    if (prefix.length <= 2 && prefix.every(word => SIGNOFF_LEAD_WORDS.has(word))) {
      return { isSignoff: true, reason: 'phrase' }
    }
  }

  return { isSignoff: false, reason: 'no-match' }
}
