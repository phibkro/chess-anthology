import { DefaultValueConverter } from "langium";
import type { CstNode } from "langium";
import * as v from "valibot";
// STRING's grammar accepts JSON strings only; the conversion is shared by CLI and LSP.
class JsonValueConverter extends DefaultValueConverter {
  override convert(input: string, node: CstNode) {
    if (input.startsWith('"')) {
      const value: unknown = JSON.parse(input);
      if (v.is(v.string(), value)) {
        return value;
      }
    }
    return super.convert(input, node);
  }
}
export const jsonParserModule = {
  parser: { ValueConverter: () => new JsonValueConverter() },
};
