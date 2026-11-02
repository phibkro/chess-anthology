import { DefaultValueConverter, type CstNode } from "langium";
// STRING's grammar accepts JSON strings only; the conversion is shared by CLI and LSP.
class JsonValueConverter extends DefaultValueConverter {
  override convert(input: string, node: CstNode) {
    if (input.startsWith('"')) {
      const value: unknown = JSON.parse(input);
      if (typeof value === "string") return value;
    }
    return super.convert(input, node);
  }
}
export const jsonParserModule = {
  parser: { ValueConverter: () => new JsonValueConverter() },
};
