/** Recognize supported narrative URIs without loading a parser.
 * @param uri - Canonical source URI.
 * @returns Whether the filename is a supported narrative.
 */
export const isNarrative = (uri: string) =>
  /\.(?:chess-story|chess\.md)$/u.test(new URL(uri).pathname);
