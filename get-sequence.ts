export function getSequence(
    simpleNodes: {
        id: number;
        in: number[];
        out: number[];
    }[]
) {
    const allNodes = simpleNodes.slice();
    const startNodes = allNodes.filter((n) => n.in.length === 0);

    if (startNodes.length === 0) {
        throw new Error('No start node found');
    }

    const nextNodes = startNodes;
    const sequnece: number[] = [];
    const visitedNodes = new Set<number>();

    while (nextNodes.length > 0) {
        const node = nextNodes.shift();
        if (node) {
            sequnece.push(node.id);
            visitedNodes.add(node.id);
            const nextNodeIds = node.out;
            for (const nextNodeId of nextNodeIds) {
                const nextNode = simpleNodes.find((n) => n.id === nextNodeId);
                if (nextNode) {
                    if (nextNode.in.every((n) => visitedNodes.has(n))) {
                        nextNodes.push(nextNode);
                    }
                }
            }
        }
    }

    return sequnece;
}
