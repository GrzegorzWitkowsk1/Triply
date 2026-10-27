import ts from "typescript";

export interface CoverageFinding { file: string; line: number; text: string; kind: "text" | "attribute" | "expression" | "configuration" }
export interface TranslationException { file: string; text: string; reason: string }
export interface LiteralUsage { file: string; line: number; namespace: string; key: string }
const attributes = new Set(["label", "title", "placeholder", "aria-label", "aria-description", "alt", "helperText"]);

/** Heuristic source audit. Dynamic data and indirect labels still need runtime review. */
export function auditSource(file: string, text: string, exceptions: readonly TranslationException[] = []): CoverageFinding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings: CoverageFinding[] = [];
  const literalArrays = new Map<string, ts.StringLiteralLike[]>();
  function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      literalArrays.set(node.name.text, node.initializer.elements.filter(ts.isStringLiteralLike));
    }
    ts.forEachChild(node, collect);
  }
  collect(source);
  function report(node: ts.Node, value: string, kind: CoverageFinding["kind"]) {
    value = value.replace(/\s+/g, " ").trim();
    const words = value.replace(/{{.*?}}|&[a-z]+;/g, "").trim();
    if (!/[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{2}/.test(words) || /^[\s·.,:/()%0-9€$–—-]*(km|min|hr|hrs|px|MB)?[\s·.,:/()%0-9€$–—-]*$/.test(words)) return;
    if (exceptions.some(entry => entry.file === file && entry.text === value && entry.reason.trim())) return;
    findings.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: value, kind });
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && /^(?:i18n\.)?t$/.test(node.expression.getText(source))) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map") {
      const literals = literalArrays.get(node.expression.expression.getText(source));
      const callback = node.arguments[0];
      if (literals?.length && callback && ts.isArrowFunction(callback)) {
        const parameter = callback.parameters[0]?.name.getText(source);
        let renderedDirectly = false;
        function check(child: ts.Node) {
          if (ts.isJsxExpression(child) && child.expression && ts.isIdentifier(child.expression) && child.expression.text === parameter && !ts.isJsxAttribute(child.parent)) renderedDirectly = true;
          ts.forEachChild(child, check);
        }
        check(callback.body);
        if (renderedDirectly) for (const literal of literals) report(literal, literal.text, "configuration");
      }
    }
    if (ts.isJsxText(node)) report(node, node.getText(source), "text");
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
      const value = ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map(span => "{{value}}" + span.literal.text).join("") : node.text;
      if (ts.isJsxAttribute(node.parent) && attributes.has(node.parent.name.getText(source))) report(node, value, "attribute");
      else if (ts.isPropertyAssignment(node.parent) && node.parent.initializer === node && /^(label|title|helper|description|text|message|placeholder|alt|"aria-label"|"aria-description")$/.test(node.parent.name.getText(source))) {
        // Semantic keys are intentionally kept in local state and translated on render.
        if (!/^[\w/-]+:[\w.{}]+$/.test(value)) report(node, value, "configuration");
      }
      else if (ts.isCallExpression(node.parent) && /^(?:toast|alert|confirm|window\.alert|window\.confirm)$/.test(node.parent.expression.getText(source)) && node.parent.arguments[0] === node) report(node, value, "expression");
      else {
        let parent: ts.Node = node.parent;
        let visible = false, technical = false;
        while (parent && !ts.isSourceFile(parent)) {
          if (ts.isJsxAttribute(parent) && !attributes.has(parent.name.getText(source))) { technical = true; break; }
          if (ts.isArrayLiteralExpression(parent) || ts.isTypeNode(parent)) { technical = true; break; }
          if (ts.isBinaryExpression(parent) && parent.operatorToken.kind !== ts.SyntaxKind.PlusToken && parent.operatorToken.kind !== ts.SyntaxKind.BarBarToken && parent.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) { technical = true; break; }
          if (ts.isCallExpression(parent) && /\.t$|^(t|useTranslation)$/.test(parent.expression.getText(source))) { technical = true; break; }
          if (ts.isJsxExpression(parent)) {
            if (ts.isJsxAttribute(parent.parent)) visible = attributes.has(parent.parent.name.getText(source));
            else visible = ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent);
            break;
          }
          parent = parent.parent;
        }
        if (visible && !technical) report(node, value, "expression");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return findings;
}

export function literalTranslationUsages(file: string, text: string): LiteralUsage[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const usages: LiteralUsage[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && /^(i18n\.t|t)$/.test(node.expression.getText(source)) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      let key = node.arguments[0].text;
      let namespace: string | undefined;
      if (key.includes(":")) [namespace, key] = key.split(":", 2);
      const options = node.arguments[1];
      if (!namespace && options && ts.isObjectLiteralExpression(options)) {
        const ns = options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "ns");
        if (ns && ts.isPropertyAssignment(ns) && ts.isStringLiteralLike(ns.initializer)) namespace = ns.initializer.text;
      }
      if (!namespace && node.expression.getText(source) === "i18n.t") namespace = "common";
      if (!namespace) {
        let scope: ts.Node = node;
        while (scope.parent && !ts.isFunctionDeclaration(scope) && !ts.isFunctionExpression(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
        namespace = /useTranslation\(\s*(?:\[\s*)?["']([^"']+)["']/.exec(scope.getText(source))?.[1];
      }
      if (namespace) usages.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, namespace, key });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return usages;
}
