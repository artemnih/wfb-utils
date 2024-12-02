import { State } from '@polus-wfb/common/src/types';

export function simplifyGraph(graph: State) {
    const simpleNodes: {
        id: number;
        in: number[];
        out: number[];
    }[] = graph.nodes.map((n) => ({ id: n.id, in: [], out: [] }));

    for (const link of graph.links) {
        const sourceNode = simpleNodes.find((n) => n.id === link.sourceId);
        const targetNode = simpleNodes.find((n) => n.id === link.targetId);

        if (sourceNode && targetNode) {
            // check if the link already exists, in case of duplicate links with different inlets
            if (sourceNode.out.includes(targetNode.id)) {
                continue;
            }

            sourceNode.out.push(targetNode.id);
            targetNode.in.push(sourceNode.id);
        }
    }

    return simpleNodes;
}
