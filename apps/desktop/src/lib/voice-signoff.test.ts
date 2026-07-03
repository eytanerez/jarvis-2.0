import { describe, expect, it } from 'vitest'

import { classifyVoiceSignoff } from './voice-signoff'

function signoff(transcript: string) {
  return classifyVoiceSignoff(transcript).isSignoff
}

describe('classifyVoiceSignoff - clear sign-offs', () => {
  const cases = [
    'okay, thanks',
    'thanks',
    'thank you',
    'thanks a lot',
    "great, I'll do that",
    'right on',
    'sounds good',
    'will do',
    'perfect',
    'got it',
    'bye',
    'goodbye',
    'see you later',
    'take care',
    "that's all",
    "we're good",
    "great, I'll send that",
    'cool',
    'great'
  ]

  for (const transcript of cases) {
    it(`"${transcript}" ends the conversation`, () => {
      expect(signoff(transcript)).toBe(true)
    })
  }
})

describe('classifyVoiceSignoff - questions and requests always get a reply', () => {
  const cases = [
    'can you send that too?',
    'one more thing, can you also check my calendar',
    'how about tomorrow instead',
    'what about the other file',
    "thanks, but can you double check that",
    'wait, actually one more thing'
  ]

  for (const transcript of cases) {
    it(`"${transcript}" is not a sign-off`, () => {
      expect(signoff(transcript)).toBe(false)
    })
  }
})

describe('classifyVoiceSignoff - continuations are not goodbyes', () => {
  const cases = ['okay, so the revenue is up', 'great, the meeting went well', 'well, the numbers came back strange']

  for (const transcript of cases) {
    it(`"${transcript}" is not a sign-off`, () => {
      expect(signoff(transcript)).toBe(false)
    })
  }
})

describe('classifyVoiceSignoff - commands are instructions, not farewells', () => {
  it('"great, send that email" is not a sign-off (instruction to the assistant)', () => {
    expect(signoff('great, send that email')).toBe(false)
  })

  it('"great, I\'ll send that" IS a sign-off (self-commit, not an instruction)', () => {
    expect(signoff("great, I'll send that")).toBe(true)
  })

  it('"okay, call the plumber" is not a sign-off', () => {
    expect(signoff('okay, call the plumber')).toBe(false)
  })
})

describe('classifyVoiceSignoff - look-alikes', () => {
  it('"we\'ll see you tomorrow" does not trigger on "well"/"see you" out of position', () => {
    expect(signoff("we'll see you tomorrow")).toBe(false)
  })

  it('"I feel ill" is never mistaken for "I\'ll" (no apostrophe, no match)', () => {
    expect(signoff('I feel ill')).toBe(false)
  })

  it('"ill send that later" (STT dropped the apostrophe) is not a false self-commit', () => {
    expect(signoff('ill send that later')).toBe(false)
  })
})

describe('classifyVoiceSignoff - closing acknowledgements (assistant asked, user declines/wraps)', () => {
  it('"I\'m ok thanks" IS a sign-off', () => {
    expect(signoff("I'm ok thanks")).toBe(true)
  })

  it('"I\'m good, thanks" IS a sign-off', () => {
    expect(signoff("I'm good, thanks")).toBe(true)
  })

  it('"no thanks" IS a sign-off', () => {
    expect(signoff('no thanks')).toBe(true)
  })

  it('"nope, that\'s all" IS a sign-off', () => {
    expect(signoff("nope, that's all")).toBe(true)
  })

  it('"nah I\'m good" IS a sign-off', () => {
    expect(signoff("nah I'm good")).toBe(true)
  })

  it('"that\'s all" IS a sign-off', () => {
    expect(signoff("that's all")).toBe(true)
  })

  it('"nothing else" IS a sign-off', () => {
    expect(signoff('nothing else')).toBe(true)
  })

  it('"that\'ll be all" IS a sign-off', () => {
    expect(signoff("that'll be all")).toBe(true)
  })

  it('"I\'m done" IS a sign-off', () => {
    expect(signoff("I'm done")).toBe(true)
  })

  it('"no, delete it" is a correction, not a sign-off', () => {
    expect(signoff('no, delete it')).toBe(false)
  })

  it('"no, use the other file" is a correction, not a sign-off', () => {
    expect(signoff('no, use the other file')).toBe(false)
  })

  it('"I\'m trying to fix the login bug" is not a sign-off', () => {
    expect(signoff("I'm trying to fix the login bug")).toBe(false)
  })
})

describe('classifyVoiceSignoff - length and edge cases', () => {
  it('empty transcript is not a sign-off', () => {
    expect(signoff('')).toBe(false)
  })

  it('a long sentence starting with a positive word is not a sign-off', () => {
    expect(signoff('great, thanks so much for walking me through all of that in so much detail today')).toBe(false)
  })

  it('a bare short positive alone is a sign-off', () => {
    expect(signoff('cool')).toBe(true)
  })

  it('the same positive word leading into more content is not a sign-off', () => {
    expect(signoff('cool, what time does the store close')).toBe(false)
  })
})
