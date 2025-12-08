import * as React from 'react';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    Position,
    MarkerType,
    Node,
    Edge,
    ConnectionLineType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { Card, CardBody, CardTitle, Button, EmptyState, Title, EmptyStateBody, Popover, DescriptionList, DescriptionListTerm, DescriptionListGroup, DescriptionListDescription } from '@patternfly/react-core';
import { NetworkIcon, ServerIcon, TopologyIcon, CubeIcon, RouteIcon, InfrastructureIcon, LinuxIcon, ResourcePoolIcon, PficonVcenterIcon, MigrationIcon, TagIcon } from '@patternfly/react-icons';

interface NodeVisualizationProps {
    nns: any; // NodeNetworkState resource
    cudns?: any[]; // ClusterUserDefinedNetwork resources
    nads?: any[]; // NetworkAttachmentDefinition resources
}

const nodeWidth = 180;
const nodeHeight = 60;

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    const isHorizontal = direction === 'LR';
    dagreGraph.setGraph({ rankdir: direction });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    nodes.forEach((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        node.targetPosition = isHorizontal ? Position.Left : Position.Top;
        node.sourcePosition = isHorizontal ? Position.Right : Position.Bottom;

        // We are shifting the dagre node position (anchor=center center) to the top left
        // so it matches the React Flow node anchor point (top left).
        node.position = {
            x: nodeWithPosition.x - nodeWidth / 2,
            y: nodeWithPosition.y - nodeHeight / 2,
        };

        return node;
    });

    return { nodes, edges };
};

const NodeVisualization: React.FC<NodeVisualizationProps> = ({ nns, cudns = [], nads = [] }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    // State for Popover and Interaction
    const [activeNode, setActiveNode] = React.useState<any>(null);
    const [anchorElement, setAnchorElement] = React.useState<any>(null);
    const [highlightedPath, setHighlightedPath] = React.useState<Set<string>>(new Set());
    const [isHighlightActive, setIsHighlightActive] = React.useState<boolean>(false);

    const interfaces = nns?.status?.currentState?.interfaces || [];
    const ovn = nns?.status?.currentState?.ovn || {};
    const bridgeMappings = ovn['bridge-mappings'] || [];

    React.useEffect(() => {
        const initialNodes: Node[] = [];
        const initialEdges: Edge[] = [];

        // Helper to add node
        const addNode = (id: string, label: string, type: string, data: any = {}) => {
            let style = { border: '1px solid #777', padding: 10, borderRadius: 5, width: nodeWidth, background: '#fff' };

            // Custom styles based on type
            switch (type) {
                case 'ethernet': style.border = '2px solid #0066CC'; break;
                case 'bond': style.border = '2px solid #663399'; break;
                case 'vlan': style.border = '2px solid #9933CC'; break;
                case 'bridge': style.border = '2px solid #FF6600'; break;
                case 'logical': style.border = '2px solid #0099CC'; break;
                case 'ovn-mapping': style.border = '2px solid #009900'; style.background = '#f0fff0'; break;
                case 'cudn': style.border = '2px solid #CC0099'; style.background = '#fff0f5'; break;
                case 'attachment': style.border = '2px solid #F0AB00'; style.background = '#fffff0'; break;
            }

            initialNodes.push({
                id,
                data: { label: label, ...data },
                position: { x: 0, y: 0 }, // Position will be set by dagre
                style,
                type: 'default', // Using default type for now, can be custom
            });
        };

        // Helper to add edge
        const addEdge = (source: string, target: string, animated = false) => {
            initialEdges.push({
                id: `${source}-${target}`,
                source,
                target,
                type: 'smoothstep',
                animated,
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                },
            });
        };

        // 1. Interfaces
        interfaces.forEach((iface: any) => {
            let type = iface.type;
            if (['linux-bridge', 'ovs-bridge'].includes(iface.type)) type = 'bridge';
            else if (iface.type === 'ovs-interface') {
                // Check if it's a bridge controller or logical
                const isController = interfaces.some((i: any) => (i.controller === iface.name || i.master === iface.name));
                if (isController && !iface.patch) type = 'bridge';
                else type = 'logical';
            }

            addNode(iface.name, iface.name, type, { original: iface });

            // Upstream: master/controller
            const master = iface.controller || iface.master;
            if (master) addEdge(iface.name, master);

            // Upstream: base-iface (VLAN/MAC-VLAN)
            const baseIface = iface.vlan?.['base-iface'] || iface['mac-vlan']?.['base-iface'];
            if (baseIface) addEdge(baseIface, iface.name);
        });

        // 2. Bridge Mappings
        bridgeMappings.forEach((mapping: any) => {
            const ovnNodeId = `ovn-${mapping.localnet}`;
            addNode(ovnNodeId, `OVN: ${mapping.localnet}`, 'ovn-mapping', { original: mapping });
            if (mapping.bridge) addEdge(mapping.bridge, ovnNodeId);
        });

        // 3. CUDNs
        cudns.forEach((cudn: any) => {
            const cudnNodeId = `cudn-${cudn.metadata.name}`;
            addNode(cudnNodeId, cudn.metadata.name, 'cudn', { original: cudn });

            const physicalNetworkName = cudn.spec?.network?.localNet?.physicalNetworkName || cudn.spec?.network?.localnet?.physicalNetworkName;
            if (physicalNetworkName) {
                const ovnNodeId = `ovn-${physicalNetworkName}`;
                addEdge(ovnNodeId, cudnNodeId);
            }
        });

        // 4. Attachments
        cudns.forEach((cudn: any) => {
            const condition = cudn.status?.conditions?.find((c: any) => c.type === 'NetworkCreated' && c.status === 'True');
            if (condition && condition.message) {
                const match = condition.message.match(/\[(.*?)\]/);
                if (match && match[1]) {
                    const namespaces = match[1].split(',').map((ns: string) => ns.trim()).sort();
                    if (namespaces.length > 0) {
                        const attachmentNodeId = `attachment-${cudn.metadata.name}`;
                        const label = `NS: ${namespaces.length > 3 ? `${namespaces.slice(0, 3).join(', ')}...` : namespaces.join(', ')}`;
                        addNode(attachmentNodeId, label, 'attachment', { namespaces });
                        addEdge(`cudn-${cudn.metadata.name}`, attachmentNodeId, true);
                    }
                }
            }
        });

        // Apply Layout
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
            initialNodes,
            initialEdges
        );

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);

    }, [nns, cudns, bridgeMappings]);

    // Path Traversal Helper
    const getFlowPath = (startNodeId: string) => {
        const path = new Set<string>();
        const visited = new Set<string>();

        const traverse = (nodeId: string, direction: 'upstream' | 'downstream') => {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);
            path.add(nodeId);

            // Find connected edges
            const connectedEdges = edges.filter(edge =>
                direction === 'upstream' ? edge.target === nodeId : edge.source === nodeId
            );

            connectedEdges.forEach(edge => {
                path.add(edge.id);
                const nextNodeId = direction === 'upstream' ? edge.source : edge.target;
                traverse(nextNodeId, direction);
            });
        };

        traverse(startNodeId, 'upstream');
        visited.clear();
        traverse(startNodeId, 'downstream');

        return path;
    };

    const handlePopoverClose = () => {
        setActiveNode(null);
        setAnchorElement(null);
    };

    const handleBackgroundClick = () => {
        setIsHighlightActive(false);
        setHighlightedPath(new Set());
        handlePopoverClose();
    };

    if (interfaces.length === 0) {
        return (
            <Card isFullHeight>
                <CardTitle>Network Topology</CardTitle>
                <CardBody>
                    <EmptyState>
                        <div style={{ fontSize: '32px', marginBottom: '10px' }}>
                            <TopologyIcon />
                        </div>
                        <Title headingLevel="h4" size="lg">
                            No Network Interfaces Found
                        </Title>
                        <EmptyStateBody>
                            The NodeNetworkState does not contain any interfaces to visualize.
                        </EmptyStateBody>
                    </EmptyState>
                </CardBody>
            </Card>
        );
    }

    return (
        <Card isFullHeight style={{ height: '800px' }}>
            <CardTitle>Network Topology (React Flow)</CardTitle>
            <CardBody style={{ padding: 0, height: '100%' }}>
                <ReactFlow
                    nodes={nodes.map(node => ({
                        ...node,
                        style: {
                            ...node.style,
                            opacity: isHighlightActive ? (highlightedPath.has(node.id) ? 1 : 0.3) : 1
                        }
                    }))}
                    edges={edges.map(edge => ({
                        ...edge,
                        style: {
                            ...edge.style,
                            stroke: isHighlightActive ? (highlightedPath.has(edge.id) ? '#0066CC' : '#ccc') : '#b1b1b1',
                            strokeWidth: isHighlightActive ? (highlightedPath.has(edge.id) ? 3 : 1) : 1,
                            opacity: isHighlightActive ? (highlightedPath.has(edge.id) ? 1 : 0.1) : 1
                        },
                        animated: isHighlightActive && highlightedPath.has(edge.id)
                    }))}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeClick={(event, node) => {
                        // Extract original data for the popover
                        const originalData = node.data.original || {
                            name: node.data.label,
                            type: node.type === 'attachment' ? 'attachment' : 'unknown',
                            ...node.data
                        };

                        // Set anchor and active node
                        setAnchorElement(event.currentTarget);
                        setActiveNode(originalData);

                        // Highlight Path (using node.id)
                        const path = getFlowPath(node.id);
                        setHighlightedPath(path);
                        setIsHighlightActive(true);
                    }}
                    onPaneClick={handleBackgroundClick}
                    fitView
                    attributionPosition="bottom-right"
                >
                    <MiniMap />
                    <Controls />
                    <Background color="#aaa" gap={16} />
                </ReactFlow>

                <Popover
                    triggerRef={() => anchorElement}
                    isVisible={!!activeNode}
                    shouldClose={handlePopoverClose}
                    headerContent={<div>{activeNode?.name || activeNode?.localnet || activeNode?.metadata?.name}</div>}
                    bodyContent={
                        <DescriptionList isCompact>
                            <DescriptionListGroup>
                                <DescriptionListTerm>Type</DescriptionListTerm>
                                <DescriptionListDescription>{activeNode?.type || (activeNode?.localnet ? 'OVN Localnet' : 'CUDN')}</DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                                <DescriptionListTerm>State</DescriptionListTerm>
                                <DescriptionListDescription>{activeNode?.state || activeNode?.spec?.network?.topology || 'N/A'}</DescriptionListDescription>
                            </DescriptionListGroup>
                            {activeNode?.mac_address && (
                                <DescriptionListGroup>
                                    <DescriptionListTerm>MAC Address</DescriptionListTerm>
                                    <DescriptionListDescription>{activeNode.mac_address}</DescriptionListDescription>
                                </DescriptionListGroup>
                            )}
                            {activeNode?.mtu && (
                                <DescriptionListGroup>
                                    <DescriptionListTerm>MTU</DescriptionListTerm>
                                    <DescriptionListDescription>{activeNode.mtu}</DescriptionListDescription>
                                </DescriptionListGroup>
                            )}
                            {activeNode?.ipv4?.address && activeNode.ipv4.address.length > 0 && (
                                <DescriptionListGroup>
                                    <DescriptionListTerm>IPv4</DescriptionListTerm>
                                    <DescriptionListDescription>{activeNode.ipv4.address[0].ip}/{activeNode.ipv4.address[0].prefix_length}</DescriptionListDescription>
                                </DescriptionListGroup>
                            )}
                            {activeNode?.namespaces && (
                                <DescriptionListGroup>
                                    <DescriptionListTerm>Namespaces</DescriptionListTerm>
                                    <DescriptionListDescription>{activeNode.namespaces.join(', ')}</DescriptionListDescription>
                                </DescriptionListGroup>
                            )}
                        </DescriptionList>
                    }
                >
                    <div style={{ display: 'none' }} />
                </Popover>
            </CardBody>
        </Card>
    );
};

export default NodeVisualization;
