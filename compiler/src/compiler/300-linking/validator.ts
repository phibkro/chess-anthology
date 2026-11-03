import { DefaultDocumentValidator } from "langium";
import type { LangiumDocument, ValidationOptions } from "langium";
import * as v from "valibot";
import type { CancellationToken } from "vscode-languageserver";
/** Adapt framework diagnostics into stable compiler failure codes. */
export class ChessValidator extends DefaultDocumentValidator {
  /**
   * Run validation without cascading past lexical or syntax errors.
   * @param document - The source document.
   * @param options - Validator controls.
   * @param token - Cancellation from the editor.
   * @returns Diagnostics with stable compiler-owned linking codes.
   */
  override async validateDocument(
    document: LangiumDocument,
    options?: ValidationOptions,
    token?: CancellationToken
  ) {
    const diagnostics = await super.validateDocument(
      document,
      { ...options, stopAfterLexingErrors: true, stopAfterParsingErrors: true },
      token
    );
    return diagnostics.map((diagnostic) => {
      const data = v.safeParse(
        v.object({ code: v.optional(v.union([v.string(), v.number()])) }),
        diagnostic.data
      );
      const originalCode = data.success ? data.output.code : undefined;
      return {
        ...diagnostic,
        code:
          diagnostic.code ??
          (originalCode === "linking-error"
            ? "link/unresolved-game"
            : originalCode),
      };
    });
  }
}
