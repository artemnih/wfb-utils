import { CwlScript, Dictionary, NodeBinding, PluginX, State } from '@polus-wfb/common';
import { simplifyGraph } from './simplify-graph';
import { getSequence } from './get-sequence';
import { isDirectory } from './is-dir';
import { cleanString } from './clean-string';
import { getCwlNodeId } from './get-cwl-node-id';
import { getNodeUiConfig } from './get-node-ui-config';

export function getCwlInputType(input: NodeBinding) {
    const isDir = isDirectory(input);

    if (isDir) {
        return 'Directory';
    }

    switch (input.type) {
        case 'string':
            return 'string';
        case 'number':
            return 'int';
        case 'boolean':
            return 'boolean';
        case 'file':
            return 'File';
        case 'file[]':
            return 'File[]';
        default:
            return 'string';
    }
}

export function toCwl(state: State, plugins: PluginX[]): CwlScript {
    const pluginMap = new Map<string, PluginX>();
    plugins.forEach((p) => pluginMap.set(p.pid, p));

    const nodes = state.nodes;
    const links = state.links;

    // inline dag
    const simpleGraph = simplifyGraph(state);
    const sequenceIds = getSequence(simpleGraph);
    const sequence = sequenceIds.map((id) => nodes.find((n) => n.id === id)!);

    // provision missing settings
    for (const node of sequence) {
        node.settings ??= {};
        node.settings.inputs ??= {};
        node.settings.outputs ??= {};
    }

    // auto-generate values for node outputs (unless there is an explicit UI input for that)
    for (const node of sequence) {
        const plugin = pluginMap.get(node.pluginId)!;
        const { ui, outputs } = getNodeUiConfig(plugin);
        const cleanName = cleanString(node.name);
        const cwlNodeId = getCwlNodeId(cleanName, node.id);

        // Artem: TODO: is this still needed or all outputs are non-ui?
        const nonUiOutputs = (outputs || []).filter((output) => !ui.find((u) => u.key === `outputs.${output.name}`));
        nonUiOutputs.forEach((output) => {
            node.settings.outputs ??= {};
            node.settings.outputs[output.name] = `${cwlNodeId}-${output.name}`;
        });
    }

    // extract values from internal nodes
    for (const link of links) {
        const sourceNode = nodes.find((n) => n.id === link.sourceId)!;
        if (sourceNode.internal) {
            const targetNode = nodes.find((n) => n.id === link.targetId)!;
            const targetUiConfig = getNodeUiConfig(pluginMap.get(targetNode.pluginId)!);
            const sourceUiConfig = getNodeUiConfig(pluginMap.get(sourceNode.pluginId)!);
            const sourceProp = sourceUiConfig.outputs[link.outletIndex].name;
            const targetProp = targetUiConfig.inputs[link.inletIndex].name;
            targetNode.settings.inputs = targetNode.settings.inputs || {};
            targetNode.settings.inputs[targetProp] = sourceNode.settings.outputs![sourceProp];
        }
    }

    const nonInternalNodes = sequence.filter((node) => !node.internal);
    const cwlJobInputs = {} as any;
    const inputs = {} as any;
    const outputs = {} as any;
    const steps = {} as any;

    // nodes to steps
    for (const node of nonInternalNodes) {
        const plugin = plugins.find((p) => p.pid === node.pluginId);
        if (!plugin) {
            throw new Error(`Plugin ${node?.pluginId} not found`);
        }
        const cleanName = cleanString(node.name);
        const cwlNodeId = getCwlNodeId(cleanName, node.id);

        const step = {
            in: {} as Dictionary<{ source: string }>,
            run: {
                baseCommand: plugin.baseCommand ?? [],
                class: 'CommandLineTool',
                cwlVersion: 'v1.2', // TODO: get from plugin
                inputs: {} as any,
                outputs: {} as any,
                requirements: {
                    DockerRequirement: {
                        // are all nodes dockerized?
                        dockerPull: plugin.container,
                    },
                    InitialWorkDirRequirement: {
                        listing: [] as any,
                    },
                    InlineJavascriptRequirement: {},
                },
            } as any,
            out: [] as any,
        };

        // order of keys is important - it affects the order of steps in the workflow
        steps[cwlNodeId] = step;

        // handle inputs
        plugin.inputs.forEach((input: NodeBinding) => {
            const isDir = isDirectory(input);
            const name = input.name;
            const type = getCwlInputType(input);
            const key = `${cwlNodeId}_${name}`;
            const val = node.settings.inputs![name];

            // step.run.inputs
            step.run.inputs[name] = {
                inputBinding: {
                    prefix: `--${name}`,
                },
                type: input.required ? type : `${type}?`,
            };

            if (!val) {
                return;
            }

            // cwl.cwlJobInputs
            const value = isDir
                ? {
                      class: 'Directory',
                      location: val,
                  }
                : val;
            cwlJobInputs[key] = value;

            // cwl.inputs
            inputs[key] = {
                type: type,
            };

            // step.in
            step.in[name] = {
                source: key,
            };
        });

        // handle outputs
        plugin.outputs.forEach((output: NodeBinding) => {
            const isDir = isDirectory(output);
            const name = output.name;
            const val = node.settings.outputs![name];
            const type = isDir ? 'Directory' : 'string';
            const key = `${cwlNodeId}_${name}`;

            // step.run.inputs
            step.run.inputs[name] = {
                inputBinding: {
                    prefix: `--${name}`,
                },
                type: type,
            };

            // step.run.outputs
            step.run.outputs[name] = {
                outputBinding: {
                    glob: `$(inputs.${name}.basename)`,
                },
                type: type,
            };

            // cwl.cwlJobInputs
            const value = isDir
                ? {
                      class: 'Directory',
                      location: val,
                  }
                : val;
            cwlJobInputs[key] = value;

            // cwl.inputs
            inputs[key] = {
                type: type,
            };

            // cwl.outputs
            const outputSource = `${cwlNodeId}/${name}`;
            outputs[key] = {
                type: type,
                outputSource: outputSource,
            };

            // step.in
            step.in[name] = {
                source: key,
            };

            // step.out
            step.out.push(name);

            // step.run.requirements
            step.run.requirements.InitialWorkDirRequirement.listing.push({
                entry: `$(inputs.${name})`,
                writable: true,
            });
        });

        // step.in: handle dirs that come from other nodes
        for (const link of links) {
            const source = nodes.find((n) => n.id === link.sourceId)!;
            if (source.internal) {
                continue;
            }

            // find incoming link
            if (link.targetId === node.id) {
                const sourceNode = nodes.find((n) => n.id === link.sourceId)!;
                const sourceUiConfig = getNodeUiConfig(pluginMap.get(sourceNode.pluginId)!);
                const targetUiConfig = getNodeUiConfig(pluginMap.get(node.pluginId)!);
                const sourceProp = sourceUiConfig.outputs[link.outletIndex].name;
                const targetProp = targetUiConfig.inputs[link.inletIndex].name;
                const cleanSourceName = cleanString(sourceNode.name);
                const sourceCwlNodeId = getCwlNodeId(cleanSourceName, sourceNode.id);

                step.in[targetProp] = {
                    source: `${sourceCwlNodeId}/${sourceProp}`,
                };
            }
        }
    }

    const cwl = {
        name: '',
        cwlVersion: 'v1.0',
        driver: '',
        class: 'Workflow',
        $namespaces: {
            edam: 'https://edamontology.org/',
        },
        $schemas: ['https://raw.githubusercontent.com/edamontology/edamontology/master/EDAM_dev.owl'],
    } as any;
    cwl.cwlJobInputs = cwlJobInputs;
    cwl.inputs = inputs;
    cwl.outputs = outputs;
    cwl.steps = steps;

    return cwl;
}
