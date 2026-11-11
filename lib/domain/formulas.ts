import { check, InputError, type Cell } from './types';
export function colName(col: number) { let name = ''; while (col > 0) { col--; name = String.fromCharCode(65 + col % 26) + name; col = Math.floor(col / 26); } return name; }
export function coordinates(address: string): [number, number] {
  check(typeof address === 'string' && /^[A-Z]{1,3}[1-9][0-9]*$/.test(address), 'Choose a valid cell address.');
  const [, letters, row] = address.match(/^([A-Z]+)([0-9]+)$/)!;
  return [Number(row), [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)];
}
type Tree = { kind: string; value?: any; children?: Tree[] };
const token = /\s*(?:(?<ref>(?:(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_ .]*)!)?\$?[A-Za-z]{1,3}\$?[1-9][0-9]*)|(?<error>\#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|CYCLE!))|(?<num>(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?)|(?<name>[A-Za-z_]+)|(?<op>[+*/^%(),:\-]))/y;
export function parse(formula: string): Tree {
  const tokens: [string, string][] = [], expression = formula.slice(1).trim(); let position = 0, i = 0;
  while (position < expression.length) {
    token.lastIndex = position; const match = token.exec(expression);
    check(match, 'Use cell references, arithmetic, percentages, and SUM.');
    const entry = Object.entries(match.groups!).find(([, v]) => v !== undefined)!;
    tokens.push(entry as [string, string]); position = token.lastIndex;
  }
  tokens.push(['end', '']);
  const peek = () => tokens[i]?.[1] ?? '';
  function atom(): Tree {
    const [kind, value] = tokens[i++] ?? ['end', '']; let result: Tree;
    if (kind === 'num') result = { kind, value: Number(value) };
    else if (kind === 'error') result = { kind, value };
    else if (kind === 'ref') {
      result = { kind, value };
      if (peek() === ':') { i++; check(tokens[i]?.[0] === 'ref', 'A range needs two cell addresses.'); result = { kind: 'range', value: [value, tokens[i++][1]] }; }
    } else if (value === '+' || value === '-') result = { kind: 'unary', value, children: [expr(35)] };
    else if (value === '(') { result = expr(0); check(peek() === ')', 'Missing closing parenthesis.'); i++; }
    else if (kind === 'name') {
      check(value.toUpperCase() === 'SUM', 'This table supports arithmetic and SUM formulas.');
      check(peek() === '(', 'SUM needs parentheses.'); i++; const children = [];
      if (peek() !== ')') { while (true) { children.push(expr(0)); if (peek() !== ',') break; i++; } }
      check(peek() === ')', 'Missing closing parenthesis.'); i++; result = { kind: 'sum', children };
    } else throw new InputError('Incomplete formula.');
    while (peek() === '%') { result = { kind: 'percent', children: [result] }; i++; }
    return result;
  }
  function expr(minimum: number): Tree {
    let left = atom();
    while (true) {
      const op = peek(), precedence = ({ '+': 10, '-': 10, '*': 20, '/': 20, '^': 30 } as Record<string, number>)[op] ?? -1;
      if (precedence < minimum) break;
      i++; const right = expr(precedence + (op === '^' ? 0 : 1)); left = { kind: 'op', value: op, children: [left, right] };
    }
    return left;
  }
  const tree = expr(0); check(tokens[i]?.[0] === 'end', 'Unexpected formula content.'); return tree;
}
export function reference(text: string, sheet: string): [string, string] {
  if (text.includes('!')) { const index = text.lastIndexOf('!'); sheet = text.slice(0, index).replace(/^'+|'+$/g, '').replaceAll("''", "'"); text = text.slice(index + 1); }
  return [sheet, text.replaceAll('$', '').toUpperCase()];
}
export function* references(tree: Tree, sheet: string): Generator<[string, string]> {
  if (tree.kind === 'ref') yield reference(tree.value, sheet);
  else if (tree.kind === 'range') {
    const [name, start] = reference(tree.value[0], sheet), [other, end] = reference(tree.value[1], name);
    check(name === other, 'Ranges must stay in one worksheet.'); const [r1, c1] = coordinates(start), [r2, c2] = coordinates(end);
    check((Math.abs(r2 - r1) + 1) * (Math.abs(c2 - c1) + 1) <= 100000, 'Range is too large.');
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) yield [name, colName(c) + r];
  } else for (const child of tree.children ?? []) yield* references(child, sheet);
}
class FormulaError extends Error {}
function number(v: any): number {
  if (typeof v === 'string' && v.startsWith('#')) throw new FormulaError(v);
  if (v == null || v === '') return 0;
  if (Array.isArray(v) || !['string', 'number', 'boolean'].includes(typeof v) || Number.isNaN(Number(v))) throw new FormulaError('#VALUE!');
  return Number(v);
}
export class Calculator {
  values = new Map<string, any>(); visiting = new Set<string>(); parsed = new Map<string, Tree>();
  constructor(public sheets: Record<string, Record<string, Pick<Cell, 'input' | 'formula'>>>) {}
  cell(sheet: string, address: string): any {
    const key = sheet + '!' + address;
    if (this.values.has(key)) return this.values.get(key);
    if (this.visiting.has(key)) return '#CYCLE!';
    const cell = this.sheets[sheet]?.[address]; if (!cell) return null; if (!cell.formula) return cell.input;
    this.visiting.add(key); let result;
    try {
      if (!this.parsed.has(cell.formula)) this.parsed.set(cell.formula, parse(cell.formula));
      result = this.evaluate(this.parsed.get(cell.formula)!, sheet);
      if (Array.isArray(result)) throw new FormulaError('#VALUE!');
      if (typeof result === 'number' && !Number.isFinite(result)) throw new FormulaError('#NUM!');
      result ??= 0;
    } catch (error) {
      if (error instanceof FormulaError) result = error.message;
      else if (error instanceof InputError || error instanceof RangeError) result = '#VALUE!';
      else throw error;
    } finally { this.visiting.delete(key); }
    this.values.set(key, result); return result;
  }
  evaluate(tree: Tree, sheet: string): any {
    const children = tree.children ?? [];
    switch (tree.kind) {
      case 'num': return tree.value;
      case 'error': throw new FormulaError(tree.value);
      case 'ref': return this.cell(...reference(tree.value, sheet));
      case 'range': return [...references(tree, sheet)].map(([s, a]) => this.cell(s, a));
      case 'sum': return children.reduce((sum, child) => {
        const value = this.evaluate(child, sheet); for (const v of Array.isArray(value) ? value : [value]) { if (typeof v === 'string' && v.startsWith('#')) throw new FormulaError(v); if (typeof v === 'number') sum += v; } return sum;
      }, 0);
      case 'unary': return number(this.evaluate(children[0], sheet)) * (tree.value === '-' ? -1 : 1);
      case 'percent': return number(this.evaluate(children[0], sheet)) / 100;
      default: {
        const a = number(this.evaluate(children[0], sheet)), b = number(this.evaluate(children[1], sheet));
        switch (tree.value) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': if (b === 0) throw new FormulaError('#DIV/0!'); return a / b; case '^': return a ** b; }
        throw new FormulaError('#NAME?');
      }
    }
  }
}
