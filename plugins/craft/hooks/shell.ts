export type Word = { text: string; start: number; end: number }
export type Segment = { start: number; end: number; words: Word[]; writes: Word[] }
type Heredoc = { delimiter: string; stripTabs: boolean }

const LEADING_KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', 'time', '!', '{', '}', 'command', 'builtin', 'exec', 'nohup'])
const REDIRECT_OPERATOR = /^(&>>|&>|>>|>&|>\||<&|<>|<<<|>|<)/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const WRITE_OPERATOR = /^(&>>|&>|>>|>&|>\||<>|>)$/
const DESCRIPTOR_TARGET = /^(\d+|-)$/

export function commandStart(segment: Segment): Word | undefined {
  return segment.words.find(w => !LEADING_KEYWORDS.has(w.text))
}

export function commandWords(segment: Segment): Word[] {
  const first = segment.words.findIndex(w => !LEADING_KEYWORDS.has(w.text) && !ASSIGNMENT.test(w.text))
  return first === -1 ? [] : segment.words.slice(first)
}

function readHeredocOperator(command: string, at: number): { heredoc: Heredoc; end: number } {
  let i = at + 2
  const stripTabs = command[i] === '-'
  if (stripTabs) i++
  while (command[i] === ' ' || command[i] === '\t') i++
  const quote = command[i]
  if (quote === "'" || quote === '"') {
    const close = command.indexOf(quote, i + 1)
    const end = close === -1 ? command.length : close
    return { heredoc: { delimiter: command.slice(i + 1, end), stripTabs }, end: end + 1 }
  }
  const start = i
  while (i < command.length && /[^\s;&|<>()]/.test(command[i] ?? '')) i++
  return { heredoc: { delimiter: command.slice(start, i).replace(/\\/g, ''), stripTabs }, end: i }
}

function skipHeredocBodies(command: string, from: number, heredocs: Heredoc[]): number {
  let pos = from
  for (const { delimiter, stripTabs } of heredocs) {
    while (pos < command.length) {
      const newline = command.indexOf('\n', pos)
      const lineEnd = newline === -1 ? command.length : newline
      const line = command.slice(pos, lineEnd)
      pos = lineEnd + 1
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) break
    }
  }
  return Math.min(pos, command.length)
}

function skipDoubleQuoted(command: string, at: number): number {
  let i = at + 1
  while (i < command.length && command[i] !== '"') {
    if (command[i] === '\\') i += 2
    else if (command.startsWith('$(', i)) i = skipSubstitution(command, i + 1)
    else if (command[i] === '`') i = skipBacktick(command, i)
    else i++
  }
  return i + 1
}

function skipBacktick(command: string, at: number): number {
  let i = at + 1
  while (i < command.length && command[i] !== '`') i += command[i] === '\\' ? 2 : 1
  return i + 1
}

function skipSubstitution(command: string, openParen: number): number {
  let depth = 1
  let pending: Heredoc[] = []
  let i = openParen + 1
  while (i < command.length && depth > 0) {
    const c = command[i]
    if (c === '\\') i += 2
    else if (c === "'") i = (command.indexOf("'", i + 1) + 1 || command.length + 1)
    else if (c === '"') i = skipDoubleQuoted(command, i)
    else if (c === '`') i = skipBacktick(command, i)
    else if (command.startsWith('<<', i) && command[i + 2] !== '<') {
      const { heredoc, end } = readHeredocOperator(command, i)
      pending.push(heredoc)
      i = end
    } else if (c === '\n' && pending.length > 0) {
      i = skipHeredocBodies(command, i + 1, pending)
      pending = []
    } else {
      if (c === '(') depth++
      if (c === ')') depth--
      i++
    }
  }
  return Math.min(i, command.length)
}

export function parseSegments(command: string): Segment[] {
  const segments: Segment[] = []
  let words: Word[] = []
  let writes: Word[] = []
  let segmentStart = 0
  let word: { text: string; start: number } | undefined
  let pending: Heredoc[] = []
  let redirect: string | undefined
  let i = 0

  const endWord = (at: number) => {
    if (word && redirect !== undefined) {
      const isDuplicate = redirect.endsWith('&') && DESCRIPTOR_TARGET.test(word.text)
      if (WRITE_OPERATOR.test(redirect) && !isDuplicate) writes.push({ text: word.text, start: word.start, end: at })
      redirect = undefined
    } else if (word) words.push({ text: word.text, start: word.start, end: at })
    word = undefined
  }
  const endSegment = (at: number, nextStart: number) => {
    endWord(at)
    if (words.length > 0 || writes.length > 0) segments.push({ start: segmentStart, end: at, words, writes })
    words = []
    writes = []
    redirect = undefined
    segmentStart = nextStart
  }
  const append = (text: string, at: number) => {
    word ??= { text: '', start: at }
    word.text += text
  }
  const appendRaw = (from: number, to: number) => {
    append(command.slice(from, to), from)
    i = to
  }

  while (i < command.length) {
    const c = command[i] ?? ''
    const next = command[i + 1]
    if (c === '\\') {
      if (next !== '\n') append(next ?? '', i)
      i += 2
    } else if (c === "'") {
      const close = command.indexOf("'", i + 1)
      const end = close === -1 ? command.length : close
      append(command.slice(i + 1, end), i)
      i = end + 1
    } else if (c === '"') {
      const end = skipDoubleQuoted(command, i)
      append(command.slice(i + 1, end - 1).replace(/\\(["\\$`])/g, '$1'), i)
      i = end
    } else if (c === '`') {
      appendRaw(i, skipBacktick(command, i))
    } else if (c === '$' && next === '(') {
      appendRaw(i, skipSubstitution(command, i + 1))
    } else if ((c === '<' || c === '>') && next === '(') {
      appendRaw(i, skipSubstitution(command, i + 1))
    } else if (c === '<' && next === '<' && command[i + 2] !== '<') {
      endWord(i)
      const { heredoc, end } = readHeredocOperator(command, i)
      pending.push(heredoc)
      i = end
    } else if (c === '>' || c === '<' || (c === '&' && next === '>')) {
      const operator = REDIRECT_OPERATOR.exec(command.slice(i))?.[0] ?? c
      const isFileDescriptor = word !== undefined && /^\d+$/.test(word.text) && word.start + word.text.length === i
      if (isFileDescriptor) word = undefined
      else endWord(i)
      redirect = operator
      i += operator.length
    } else if (c === '#' && !word) {
      const newline = command.indexOf('\n', i)
      i = newline === -1 ? command.length : newline
    } else if (c === '\n') {
      if (pending.length > 0) {
        const end = skipHeredocBodies(command, i + 1, pending)
        pending = []
        endSegment(end, end)
        i = end
      } else {
        endSegment(i, i + 1)
        i++
      }
    } else if (c === ' ' || c === '\t') {
      endWord(i)
      i++
    } else if (c === ';' || c === '(' || c === ')') {
      endSegment(i, i + 1)
      i++
    } else if (c === '&' && next === '&') {
      endSegment(i, i + 2)
      i += 2
    } else if (c === '&') {
      endSegment(i, i + 1)
      i++
    } else if (c === '|') {
      const width = next === '|' || next === '&' ? 2 : 1
      endSegment(i, i + width)
      i += width
    } else {
      append(c, i)
      i++
    }
  }
  endSegment(command.length, command.length)
  return segments
}
