/**
 * ui/lib/setTree.ts
 *
 * Sets are grouped by "/" in their names ("theme/dark"). A group can also be
 * a set itself when a set is named exactly like the group path.
 */

export type TreeNode =
  | { kind: "group"; path: string; label: string; children: TreeNode[]; setId?: string }
  | { kind: "set"; fullName: string; label: string; setId: string };

type GroupNode = Extract<TreeNode, { kind: "group" }>;

/** Build the tree preserving the sets' order (Penpot's precedence order). */
export function buildSetTree(sets: { id: string; name: string }[]): TreeNode[] {
  const groupPaths = new Set<string>();
  const setsByName = new Map(sets.map((s) => [s.name, s]));
  for (const set of sets) {
    const parts = set.name.split("/");
    for (let i = 1; i < parts.length; i++) groupPaths.add(parts.slice(0, i).join("/"));
  }

  const groups = new Map<string, GroupNode>();
  const roots: TreeNode[] = [];

  function group(path: string): GroupNode {
    const existing = groups.get(path);
    if (existing) return existing;
    const parts = path.split("/");
    const node: GroupNode = {
      kind: "group",
      path,
      label: parts[parts.length - 1],
      children: [],
      setId: setsByName.get(path)?.id,
    };
    groups.set(path, node);
    if (parts.length === 1) roots.push(node);
    else group(parts.slice(0, -1).join("/")).children.push(node);
    return node;
  }

  for (const set of sets) {
    if (groupPaths.has(set.name)) {
      group(set.name);
      continue;
    }
    const parts = set.name.split("/");
    const leaf: TreeNode = { kind: "set", fullName: set.name, label: parts[parts.length - 1], setId: set.id };
    if (parts.length === 1) roots.push(leaf);
    else group(parts.slice(0, -1).join("/")).children.push(leaf);
  }
  return roots;
}
