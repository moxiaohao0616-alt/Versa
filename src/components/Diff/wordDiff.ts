import type { DiffLine } from '../../store'

export type CharSeg = { type: 'eq' | 'del' | 'add'; text: string }

/** Strip a single trailing newline; libgit2 includes one per line. */
function stripNL(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s
}

/** Character-level LCS diff of two strings. Returns coalesced segments. */
export function diffChars(a: string, b: string): { aSegs: CharSeg[]; bSegs: CharSeg[] } {
  const m = a.length
  const n = b.length

  // Bail out on pathologically long lines — LCS is O(m*n) memory
  if (m > 500 || n > 500) {
    return {
      aSegs: [{ type: 'del', text: a }],
      bSegs: [{ type: 'add', text: b }],
    }
  }

  // dp[i][j] = LCS length of a[0..i] vs b[0..j]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack, building per-side segment lists
  const aRev: CharSeg[] = []
  const bRev: CharSeg[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      aRev.push({ type: 'eq', text: a[i - 1] })
      bRev.push({ type: 'eq', text: b[j - 1] })
      i--; j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      aRev.push({ type: 'del', text: a[i - 1] })
      i--
    } else {
      bRev.push({ type: 'add', text: b[j - 1] })
      j--
    }
  }
  while (i > 0) { aRev.push({ type: 'del', text: a[i - 1] }); i-- }
  while (j > 0) { bRev.push({ type: 'add', text: b[j - 1] }); j-- }

  return {
    aSegs: coalesce(aRev.reverse()),
    bSegs: coalesce(bRev.reverse()),
  }
}

function coalesce(segs: CharSeg[]): CharSeg[] {
  const out: CharSeg[] = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (last && last.type === s.type) last.text += s.text
    else out.push({ ...s })
  }
  return out
}

/**
 * Walk through a flat hunk-line list and pair consecutive `-` runs with the
 * immediately following `+` runs. For each paired index, returns the inline
 * char-segments (red highlights on `-` side, green on `+` side).
 */
export function buildHunkInlineDiffs(lines: DiffLine[]): Map<number, CharSeg[]> {
  const out = new Map<number, CharSeg[]>()

  let i = 0
  while (i < lines.length) {
    if (lines[i].origin !== '-') {
      i++
      continue
    }
    const delStart = i
    while (i < lines.length && lines[i].origin === '-') i++
    const delEnd = i

    if (i >= lines.length || lines[i].origin !== '+') continue

    const addStart = i
    while (i < lines.length && lines[i].origin === '+') i++
    const addEnd = i

    // Only inline-diff lines that are paired 1:1 by position within the run.
    // If counts differ, unmatched lines fall through to a plain whole-line tint.
    const pairCount = Math.min(delEnd - delStart, addEnd - addStart)
    for (let k = 0; k < pairCount; k++) {
      const delIdx = delStart + k
      const addIdx = addStart + k
      const aText = stripNL(lines[delIdx].content)
      const bText = stripNL(lines[addIdx].content)
      // Skip if either side is empty — nothing meaningful to highlight
      if (!aText || !bText) continue
      // Skip if strings are wildly dissimilar (LCS would just be tiny)
      const { aSegs, bSegs } = diffChars(aText, bText)
      const totalEq = aSegs.filter(s => s.type === 'eq').reduce((sum, s) => sum + s.text.length, 0)
      const minLen = Math.min(aText.length, bText.length)
      // Heuristic: if less than 25% of the shorter line matched, treat as
      // unrelated lines — inline diff just adds noise.
      if (minLen > 0 && totalEq / minLen < 0.25) continue
      out.set(delIdx, aSegs)
      out.set(addIdx, bSegs)
    }
  }
  return out
}
