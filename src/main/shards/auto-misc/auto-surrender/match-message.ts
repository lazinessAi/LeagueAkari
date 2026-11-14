/** OCR commonly inserts spaces between Chinese characters. Punctuation/vote counts are irrelevant. */
export function matchesSurrenderMessage(text: string) {
  return /军团同意投降/u.test(text.normalize('NFKC').replace(/[\s\p{P}\p{Cf}]/gu, ''))
}
