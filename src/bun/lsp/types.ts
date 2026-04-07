// ─── LSP Protocol Types ───────────────────────────────────────────────────────
// Minimal subset of LSP 3.17 types needed for the lsp tool.

export interface Position {
  /** 0-based line number */
  line: number;
  /** 0-based character offset */
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface LocationLink {
  originSelectionRange?: Range;
  targetUri: string;
  targetRange: Range;
  targetSelectionRange: Range;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

// ─── Initialize ───────────────────────────────────────────────────────────────

export interface ClientCapabilities {
  textDocument?: {
    definition?: { linkSupport?: boolean };
    references?: {};
    hover?: {};
    documentSymbol?: { hierarchicalDocumentSymbolSupport?: boolean };
    implementation?: { linkSupport?: boolean };
    callHierarchy?: {};
  };
  workspace?: {
    symbol?: {};
  };
}

export interface InitializeParams {
  processId: number | null;
  rootUri: string;
  capabilities: ClientCapabilities;
  workspaceFolders?: Array<{ uri: string; name: string }> | null;
}

export interface ServerCapabilities {
  definitionProvider?: boolean | object;
  referencesProvider?: boolean | object;
  hoverProvider?: boolean | object;
  documentSymbolProvider?: boolean | object;
  workspaceSymbolProvider?: boolean | object;
  implementationProvider?: boolean | object;
  callHierarchyProvider?: boolean | object;
}

export interface InitializeResult {
  capabilities: ServerCapabilities;
}

// ─── textDocument/hover ───────────────────────────────────────────────────────

export interface MarkupContent {
  kind: "markdown" | "plaintext";
  value: string;
}

export interface Hover {
  contents: MarkupContent | string | { language: string; value: string } | Array<{ language: string; value: string }>;
  range?: Range;
}

// ─── textDocument/documentSymbol ─────────────────────────────────────────────

export interface DocumentSymbol {
  name: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

export interface SymbolInformation {
  name: string;
  kind: number;
  location: Location;
  containerName?: string;
}

// ─── workspace/symbol ────────────────────────────────────────────────────────

export interface WorkspaceSymbolParams {
  query: string;
}

// ─── textDocument/references ─────────────────────────────────────────────────

export interface ReferenceContext {
  includeDeclaration: boolean;
}

export interface ReferenceParams extends TextDocumentPositionParams {
  context: ReferenceContext;
}

// ─── Call Hierarchy ───────────────────────────────────────────────────────────

export interface CallHierarchyItem {
  name: string;
  kind: number;
  uri: string;
  range: Range;
  selectionRange: Range;
  detail?: string;
}

export interface CallHierarchyIncomingCall {
  from: CallHierarchyItem;
  fromRanges: Range[];
}

export interface CallHierarchyOutgoingCall {
  to: CallHierarchyItem;
  fromRanges: Range[];
}

// ─── SymbolKind ───────────────────────────────────────────────────────────────

export const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
  6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
  11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
  15: "String", 16: "Number", 17: "Boolean", 18: "Array", 19: "Object",
  20: "Key", 21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
  25: "Operator", 26: "TypeParameter",
};
