/** OCR commonly inserts spaces between Chinese characters. Punctuation/vote counts are irrelevant. */
export function matchesSurrenderMessage(text: string) {
  return /军团同意投降/u.test(text.normalize('NFKC').replace(/[\s\p{P}\p{Cf}]/gu, ''))
}

/** Small/blurred titles can be read as 发起投的 by Windows OCR. */
export function matchesSurrenderVoteTitle(text: string) {
  return /发起投[降的]/u.test(text.normalize('NFKC').replace(/[\s\p{P}\p{Cf}]/gu, ''))
}
