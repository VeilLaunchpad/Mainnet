/**
 * House style: no em dashes.
 *
 * Models reach for them constantly, so stripping has to happen where the whole
 * string is available rather than mid-stream: a dash often arrives in its own
 * delta, with the spaces around it in the ones before and after, so a
 * per-chunk replacement leaves "word , word" behind.
 *
 * Punctuation is chosen by context instead of swapping one glyph for another.
 * A dash between words is doing the work of a comma; a dash between numbers is
 * a range and becomes a hyphen; a dash opening a line is a bullet.
 */
export function deDash(text: string): string {
  if (!text) return text;

  return (
    text
      // A range, written with a dash between two numbers.
      .replace(/(\d)\s*[\u2014\u2013]\s*(\d)/g, "$1-$2")
      // Leading a line, it is being used as a bullet.
      .replace(/^([ \t]*)[\u2014\u2013][ \t]+/gm, "$1- ")
      // Between words, it is parenthetical or appositive: a comma carries it.
      .replace(/\s*\u2014\s*/g, ", ")
      // En dashes elsewhere are almost always a plain hyphen.
      .replace(/\s*\u2013\s*/g, " - ")
      // A comma inherited from the dash should not collide with real ones.
      .replace(/,\s*,/g, ",")
      .replace(/,\s*([.!?;:])/g, "$1")
  );
}
