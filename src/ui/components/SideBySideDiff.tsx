import { diffLines, diffWords } from "diff";
import type { Theme } from "../theme.js";

interface SideBySideDiffProps {
  oldStr: string;
  newStr: string;
  filePath?: string;
  theme: Theme;
  maxWidth?: number;
}

interface LinePair {
  left: DiffLine | null;
  right: DiffLine | null;
}

interface DiffLine {
  lineNum: number;
  content: string;
  type: "unchanged" | "added" | "removed" | "modified";
}

interface Token {
  text: string;
  type: "keyword" | "string" | "comment" | "number" | "operator" | "function" | "type" | "plain";
}

// Detect language from file extension
function detectLanguage(filePath?: string): string {
  if (!filePath) return "plain";
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
    json: "json", yaml: "yaml", yml: "yaml", md: "markdown",
    sh: "bash", bash: "bash", zsh: "bash",
  };
  return langMap[ext] ?? "plain";
}

// Simple syntax tokenizer
function tokenize(line: string, language: string): Token[] {
  const tokens: Token[] = [];
  
  if (language === "plain" || !line.trim()) {
    return [{ text: line, type: "plain" }];
  }

  // Keywords by language
  const keywords: Record<string, string[]> = {
    typescript: ["const", "let", "var", "function", "class", "interface", "type", "import", "export", "from", "return", "if", "else", "for", "while", "async", "await", "new", "this", "extends", "implements", "private", "public", "protected", "static", "readonly", "enum", "namespace", "module", "declare", "abstract", "as", "is", "in", "of", "typeof", "keyof", "infer", "never", "unknown", "any", "void", "null", "undefined", "true", "false", "try", "catch", "finally", "throw", "default", "case", "switch", "break", "continue"],
    javascript: ["const", "let", "var", "function", "class", "import", "export", "from", "return", "if", "else", "for", "while", "async", "await", "new", "this", "extends", "true", "false", "null", "undefined", "try", "catch", "finally", "throw", "default", "case", "switch", "break", "continue"],
    python: ["def", "class", "import", "from", "return", "if", "elif", "else", "for", "while", "try", "except", "finally", "with", "as", "lambda", "yield", "raise", "pass", "break", "continue", "and", "or", "not", "in", "is", "None", "True", "False", "self", "async", "await", "global", "nonlocal"],
    go: ["func", "package", "import", "type", "struct", "interface", "const", "var", "return", "if", "else", "for", "range", "switch", "case", "default", "break", "continue", "go", "defer", "chan", "map", "make", "new", "nil", "true", "false", "select", "fallthrough"],
    rust: ["fn", "let", "mut", "const", "struct", "enum", "impl", "trait", "pub", "use", "mod", "crate", "self", "super", "return", "if", "else", "for", "while", "loop", "match", "break", "continue", "move", "ref", "async", "await", "dyn", "where", "type", "as", "in", "unsafe", "extern", "true", "false", "Some", "None", "Ok", "Err"],
  };

  const types: Record<string, string[]> = {
    typescript: ["string", "number", "boolean", "object", "Array", "Promise", "Map", "Set", "Record", "Partial", "Required", "Readonly", "Pick", "Omit", "Exclude", "Extract", "ReturnType", "Parameters", "React", "JSX"],
    javascript: ["Array", "Object", "String", "Number", "Boolean", "Promise", "Map", "Set", "Date", "RegExp", "Error", "Function"],
    python: ["int", "str", "float", "bool", "list", "dict", "tuple", "set", "bytes", "None", "Optional", "List", "Dict", "Tuple", "Set", "Any", "Union", "Callable"],
    go: ["int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "float32", "float64", "complex64", "complex128", "string", "bool", "byte", "rune", "error", "any"],
    rust: ["i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "f32", "f64", "bool", "char", "str", "String", "Vec", "Box", "Rc", "Arc", "Cell", "RefCell", "Option", "Result"],
  };

  const langKeywords = keywords[language] ?? keywords.typescript ?? [];
  const langTypes = types[language] ?? types.typescript ?? [];
  
  // Regex patterns for tokenization
  const patterns: Array<{ regex: RegExp; type: Token["type"] }> = [
    // Comments
    { regex: /^(\/\/.*|#.*|\/\*[\s\S]*?\*\/)/, type: "comment" },
    // Strings
    { regex: /^("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|`[^`\\]*(?:\\.[^`\\]*)*`)/, type: "string" },
    // Numbers
    { regex: /^(\d+\.?\d*(?:e[+-]?\d+)?|0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+)/, type: "number" },
    // Operators
    { regex: /^(=>|->|::|\.\.\.?|[+\-*/%=<>!&|^~?:;,.()\[\]{}]+)/, type: "operator" },
    // Identifiers (will be classified as keyword, type, function, or plain)
    { regex: /^([a-zA-Z_$][a-zA-Z0-9_$]*)/, type: "plain" },
    // Whitespace and other
    { regex: /^(\s+)/, type: "plain" },
    // Anything else
    { regex: /^(.)/, type: "plain" },
  ];

  let remaining = line;
  while (remaining.length > 0) {
    let matched = false;
    
    for (const { regex, type } of patterns) {
      const match = remaining.match(regex);
      if (match) {
        const text = match[1];
        let tokenType = type;
        
        // Classify identifiers
        if (type === "plain" && /^[a-zA-Z_$]/.test(text)) {
          if (langKeywords.includes(text)) {
            tokenType = "keyword";
          } else if (langTypes.includes(text)) {
            tokenType = "type";
          } else if (remaining.slice(text.length).match(/^\s*[(<]/)) {
            tokenType = "function";
          }
        }
        
        tokens.push({ text, type: tokenType });
        remaining = remaining.slice(text.length);
        matched = true;
        break;
      }
    }
    
    if (!matched) {
      tokens.push({ text: remaining[0], type: "plain" });
      remaining = remaining.slice(1);
    }
  }

  return tokens;
}

// Compute word-level diff for modified lines
function computeWordDiff(oldLine: string, newLine: string): { left: Array<{ text: string; highlighted: boolean }>; right: Array<{ text: string; highlighted: boolean }> } {
  const changes = diffWords(oldLine, newLine);
  
  const left: Array<{ text: string; highlighted: boolean }> = [];
  const right: Array<{ text: string; highlighted: boolean }> = [];
  
  for (const change of changes) {
    if (change.added) {
      right.push({ text: change.value, highlighted: true });
    } else if (change.removed) {
      left.push({ text: change.value, highlighted: true });
    } else {
      left.push({ text: change.value, highlighted: false });
      right.push({ text: change.value, highlighted: false });
    }
  }
  
  return { left, right };
}

// Build side-by-side line pairs
function buildLinePairs(oldStr: string, newStr: string): LinePair[] {
  const changes = diffLines(oldStr, newStr);
  const pairs: LinePair[] = [];
  
  let leftLineNum = 1;
  let rightLineNum = 1;
  
  let pendingRemoved: DiffLine[] = [];
  let pendingAdded: DiffLine[] = [];
  
  const flushPending = () => {
    // Match removed and added lines as "modified" pairs
    const maxLen = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let i = 0; i < maxLen; i++) {
      const left = pendingRemoved[i] ?? null;
      const right = pendingAdded[i] ?? null;
      
      // If both exist, mark as modified for word-level highlighting
      if (left && right) {
        left.type = "modified";
        right.type = "modified";
      }
      
      pairs.push({ left, right });
    }
    pendingRemoved = [];
    pendingAdded = [];
  };
  
  for (const change of changes) {
    const lines = change.value.replace(/\n$/, "").split("\n");
    
    if (change.added) {
      for (const line of lines) {
        pendingAdded.push({
          lineNum: rightLineNum++,
          content: line,
          type: "added",
        });
      }
    } else if (change.removed) {
      for (const line of lines) {
        pendingRemoved.push({
          lineNum: leftLineNum++,
          content: line,
          type: "removed",
        });
      }
    } else {
      // Context line - flush pending first
      flushPending();
      
      for (const line of lines) {
        pairs.push({
          left: { lineNum: leftLineNum++, content: line, type: "unchanged" },
          right: { lineNum: rightLineNum++, content: line, type: "unchanged" },
        });
      }
    }
  }
  
  flushPending();
  
  return pairs;
}

// Render syntax-highlighted tokens as spans (must be used inside a <text>)
function syntaxTokenSpans(content: string, language: string, theme: Theme): Array<{ text: string; color: string }> {
  const tokens = tokenize(content, language);
  
  const colorMap: Record<Token["type"], string> = {
    keyword: theme.colors.accent,
    string: theme.colors.success,
    comment: theme.colors.muted,
    number: theme.colors.warning,
    operator: theme.colors.muted,
    function: theme.colors.info,
    type: theme.colors.secondary,
    plain: theme.colors.info,
  };
  
  return tokens.map(token => ({ text: token.text, color: colorMap[token.type] }));
}

// Render a diff line with word-level highlighting
function DiffLineContent({ 
  line, 
  otherLine,
  side,
  language, 
  theme,
  width,
}: { 
  line: DiffLine | null;
  otherLine: DiffLine | null;
  side: "left" | "right";
  language: string;
  theme: Theme;
  width: number;
}) {
  if (!line) {
    // Empty placeholder
    return (
      <box width={width} backgroundColor={theme.colors.borderDim}>
        <text fg={theme.colors.muted}>{" ".repeat(Math.max(0, width - 2))}</text>
      </box>
    );
  }
  
  const lineNumWidth = 4;
  const contentWidth = Math.max(1, width - lineNumWidth - 3);
  
  // Background colors for different states
  const bgColors: Record<DiffLine["type"], string | undefined> = {
    unchanged: undefined,
    added: "#1a3d1a",
    removed: "#3d1a1a",
    modified: side === "left" ? "#3d2a1a" : "#1a3d2a",
  };
  
  const bg = bgColors[line.type];
  const lineNumColor = theme.colors.muted;
  
  // For modified lines, show word-level diff
  if (line.type === "modified" && otherLine) {
    const { left, right } = computeWordDiff(otherLine.content, line.content);
    const words = side === "left" ? left : right;
    
    const highlightBg = side === "left" ? "#5c2a2a" : "#2a5c2a";
    
    return (
      <box width={width} backgroundColor={bg}>
        <text>
          <span fg={lineNumColor}>{String(line.lineNum).padStart(lineNumWidth)} </span>
          {words.map((word, i) => (
            <span key={i} bg={word.highlighted ? highlightBg : undefined} fg={theme.colors.info}>
              {word.text}
            </span>
          ))}
        </text>
      </box>
    );
  }
  
  const syntaxSpans = syntaxTokenSpans(line.content, language, theme);
  
  return (
    <box width={width} backgroundColor={bg}>
      <text>
        <span fg={lineNumColor}>{String(line.lineNum).padStart(lineNumWidth)} </span>
        {syntaxSpans.map((s, i) => (
          <span key={i} fg={s.color}>{s.text}</span>
        ))}
      </text>
    </box>
  );
}

export function SideBySideDiff({ oldStr, newStr, filePath, theme, maxWidth }: SideBySideDiffProps) {
  const pairs = buildLinePairs(oldStr, newStr);
  const language = detectLanguage(filePath);
  
  // Calculate panel widths
  const totalWidth = maxWidth ?? 120;
  const panelWidth = Math.floor((totalWidth - 3) / 2); // -3 for separator
  
  // Count changes for header
  const additions = pairs.filter(p => p.right && (p.right.type === "added" || p.right.type === "modified") && !p.left).length;
  const deletions = pairs.filter(p => p.left && (p.left.type === "removed" || p.left.type === "modified") && !p.right).length;
  const modifications = pairs.filter(p => p.left?.type === "modified" && p.right?.type === "modified").length;
  
  return (
    <box flexDirection="column" marginTop={1}>
      {/* Header */}
      <box marginBottom={1}>
        <text>
          <span fg={theme.colors.info}><b>📄 {filePath ?? "diff"}</b></span>
          <span fg={theme.colors.muted}>  </span>
          {additions > 0 && <span fg={theme.colors.success}>+{additions} </span>}
          {deletions > 0 && <span fg={theme.colors.error}>-{deletions} </span>}
          {modifications > 0 && <span fg={theme.colors.warning}>~{modifications} </span>}
        </text>
      </box>
      
      {/* Column headers */}
      <box flexDirection="row" marginBottom={1}>
        <box width={panelWidth}>
          <text fg={theme.colors.muted}><b>  Original</b></text>
        </box>
        <box width={3}>
          <text fg={theme.colors.borderDim}> │ </text>
        </box>
        <box width={panelWidth}>
          <text fg={theme.colors.muted}><b>  Modified</b></text>
        </box>
      </box>
      
      {/* Diff content */}
      <box 
        flexDirection="column" 
        borderStyle="single" 
        borderColor={theme.colors.borderDim}
      >
        {pairs.map((pair, idx) => (
          <box key={idx} flexDirection="row">
            <DiffLineContent 
              line={pair.left}
              otherLine={pair.right}
              side="left"
              language={language}
              theme={theme}
              width={panelWidth}
            />
            <box width={3}>
              <text fg={theme.colors.borderDim}> │ </text>
            </box>
            <DiffLineContent 
              line={pair.right}
              otherLine={pair.left}
              side="right"
              language={language}
              theme={theme}
              width={panelWidth}
            />
          </box>
        ))}
      </box>
    </box>
  );
}
