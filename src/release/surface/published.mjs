/**
 * The parts of the published surface read out of the TypeScript program: the
 * modules a server is written in, the CLI commands, the MCP tools and the
 * worker HTTP routes. Each reader refuses a surface it finds empty, because a
 * scan that resolves nothing is a broken scan, not a build that publishes
 * nothing.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { METHODS } from 'node:http';
import { join } from 'node:path';
import ts from 'typescript';

/** `<METHOD> /<path>`: a route literal names its method first. */
const ROUTE_LITERAL = /^(?<method>[A-Z]+) \/[A-Za-z]/;

/**
 * A server's entry file and every module with `extension` under the folder
 * that carries its parts, sorted. The published surface is read out of these
 * files, so the list follows the server's own shape rather than naming one
 * file: a server split into the families it serves keeps publishing them.
 */
export async function serverModules(root, entry, folder, extension) {
  const directory = join(root, folder);
  const modules = [join(root, entry)];
  if (!existsSync(directory)) return modules;
  const entries = await readdir(directory, {
    withFileTypes: true,
    recursive: true,
  });
  for (const found of entries)
    if (found.isFile() && found.name.endsWith(extension))
      modules.push(join(found.parentPath, found.name));
  return modules.sort();
}

/** The source file the program parsed at `path`, or the refusal naming it. */
function parsedSource(program, path, what) {
  const source = program.getSourceFile(path);
  if (!source) throw new Error(`${what} was not parsed: ${path}`);
  return source;
}

/** `weles <command>` for each member of the CLI's `CliCommand` union. */
export function cliCommands(program, root) {
  const cliSource = parsedSource(program, join(root, 'src/cli.ts'), 'the CLI');
  const commands = [];
  for (const node of cliSource.statements) {
    if (
      !ts.isTypeAliasDeclaration(node) ||
      node.name.text !== 'CliCommand' ||
      !ts.isUnionTypeNode(node.type)
    )
      continue;
    for (const member of node.type.types) {
      if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal))
        throw new Error('CliCommand contains a non-string member');
      commands.push(`cmd:weles ${member.literal.text}`);
    }
  }
  if (!commands.length) throw new Error('no Weles CLI commands resolved');
  return commands;
}

/**
 * Each MCP tool's name. Tool declarations are array literals typed
 * ToolDefinition[]; the exported list joins them by spreading, so a spread
 * member is a reference to a list this scan reads where it is declared.
 */
export function mcpTools(program, paths) {
  const tools = [];
  for (const path of paths) {
    const mcpSource = parsedSource(program, path, 'MCP module');
    const collect = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.type?.getText(mcpSource) === 'ToolDefinition[]' &&
        node.initializer &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        for (const element of node.initializer.elements) {
          if (ts.isSpreadElement(element)) continue;
          if (!ts.isObjectLiteralExpression(element))
            throw new Error(`${node.name.text} contains a non-object member`);
          const name = element.properties.find(
            (property) =>
              ts.isPropertyAssignment(property) &&
              property.name?.getText(mcpSource) === 'name',
          );
          if (
            !name ||
            !ts.isPropertyAssignment(name) ||
            !ts.isStringLiteral(name.initializer)
          )
            throw new Error('MCP tool has no static string name');
          tools.push(`mcp:${name.initializer.text}`);
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(mcpSource);
  }
  if (!tools.length)
    throw new Error(`no Weles MCP tools resolved in ${paths.length} module(s)`);
  return tools;
}

/**
 * Each route literal the worker API server's modules carry: a string that
 * names an HTTP method Node knows, then an absolute path.
 */
export function httpRoutes(program, paths) {
  const routes = [];
  const collect = (node) => {
    const method = ts.isStringLiteral(node)
      ? ROUTE_LITERAL.exec(node.text)?.groups?.method
      : undefined;
    if (method !== undefined && METHODS.includes(method))
      routes.push(`http:${node.text}`);
    ts.forEachChild(node, collect);
  };
  for (const path of paths)
    collect(parsedSource(program, path, 'worker API server module'));
  if (!routes.length) throw new Error('no worker HTTP routes resolved');
  return routes;
}
