import * as React from 'react';
import { Card, CardBody, CardTitle, Popover, Button, DescriptionList, DescriptionListTerm, DescriptionListGroup, DescriptionListDescription } from '@patternfly/react-core';
import { NetworkIcon, ServerIcon, TopologyIcon, CubeIcon } from '@patternfly/react-icons';

interface NodeVisualizationProps {
    nns: any; // NodeNetworkState resource
    cudns?: any[]; // ClusterUserDefinedNetwork resources
    nads?: any[]; // NetworkAttachmentDefinition resources
}

const NodeVisualization: React.FC<NodeVisualizationProps> = ({ nns, cudns = [], nads = [] }) => {
    const interfaces = nns?.status?.currentState?.interfaces || [];
    const ovn = nns?.status?.currentState?.ovn || {};
    const bridgeMappings = ovn['bridge-mappings'] || [];

    // Simple layout logic
    const width = 1400; // Increased width for new columns
    const height = 800;
    const padding = 50;
    const itemHeight = 80;
    const itemWidth = 160;
    const colSpacing = 220;

    // Identify controllers
    const controllerNames = new Set(interfaces.map((iface: any) => iface.controller || iface.master).filter(Boolean));

    // Group interfaces
    const ethInterfaces = interfaces.filter((iface: any) => iface.type === 'ethernet');
    const bondInterfaces = interfaces.filter((iface: any) => iface.type === 'bond');

    const isBridge = (iface: any) => {
        if (['linux-bridge', 'ovs-bridge'].includes(iface.type)) return true;
        // ovs-interface is a bridge if it is a controller AND does NOT have a patch
        if (iface.type === 'ovs-interface' && controllerNames.has(iface.name) && !iface.patch) return true;
        return false;
    };

    const bridgeInterfaces = interfaces.filter(isBridge);

    // Logical interfaces: ovs-interface that are NOT bridges
    const logicalInterfaces = interfaces.filter((iface: any) => iface.type === 'ovs-interface' && !isBridge(iface));

    const otherInterfaces = interfaces.filter((iface: any) => !['ethernet', 'bond'].includes(iface.type) && !isBridge(iface) && iface.type !== 'ovs-interface');

    // Calculate positions
    const nodePositions: { [name: string]: { x: number, y: number } } = {};

    ethInterfaces.forEach((iface: any, index: number) => {
        nodePositions[iface.name] = { x: padding, y: padding + (index * (itemHeight + 20)) };
    });

    bondInterfaces.forEach((iface: any, index: number) => {
        nodePositions[iface.name] = { x: padding + colSpacing, y: padding + (index * (itemHeight + 20)) };
    });

    bridgeInterfaces.forEach((iface: any, index: number) => {
        nodePositions[iface.name] = { x: padding + (colSpacing * 2), y: padding + (index * (itemHeight + 20)) };
    });

    logicalInterfaces.forEach((iface: any, index: number) => {
        nodePositions[iface.name] = { x: padding + (colSpacing * 3), y: padding + (index * (itemHeight + 20)) };
    });

    // OVN Mappings positions
    bridgeMappings.forEach((mapping: any, index: number) => {
        nodePositions[`ovn-${mapping.localnet}`] = { x: padding + (colSpacing * 4), y: padding + (index * (itemHeight + 20)) };
    });

    // Networks (CUDNs) positions
    cudns.forEach((cudn: any, index: number) => {
        nodePositions[`cudn-${cudn.metadata.name}`] = { x: padding + (colSpacing * 5), y: padding + (index * (itemHeight + 20)) };
    });

    // Dynamic height calculation
    const maxRows = Math.max(
        ethInterfaces.length,
        bondInterfaces.length,
        bridgeInterfaces.length,
        logicalInterfaces.length,
        bridgeMappings.length,
        cudns.length,
        Math.ceil(otherInterfaces.length / 4) + 2
    );
    const calculatedHeight = Math.max(600, padding + (maxRows * (itemHeight + 20)) + 200);

    const getIcon = (type: string) => {
        switch (type) {
            case 'ethernet': return <ServerIcon />;
            case 'bond': return <TopologyIcon />;
            case 'linux-bridge':
            case 'ovs-bridge': return <CubeIcon />;
            case 'ovs-interface': return <NetworkIcon />; // Logical
            case 'ovn-mapping': return <NetworkIcon />;
            case 'cudn': return <NetworkIcon />;
            default: return <NetworkIcon />;
        }
    };

    const renderConnector = (startNode: string, endNode: string) => {
        const start = nodePositions[startNode];
        const end = nodePositions[endNode];

        if (!start || !end) return null;

        const x1 = start.x + itemWidth;
        const y1 = start.y + (itemHeight / 2);
        const x2 = end.x;
        const y2 = end.y + (itemHeight / 2);

        return (
            <line
                key={`${startNode}-${endNode}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="#999"
                strokeWidth="2"
                markerEnd="url(#arrowhead)"
            />
        );
    };

    const renderInterfaceNode = (iface: any, x: number, y: number, color: string, typeOverride?: string) => {
        const type = typeOverride || iface.type;
        const Icon = getIcon(type);
        let displayName = iface.name;
        let displayType = type;
        let displayState = iface.state;

        if (type === 'ovn-mapping') {
            displayName = iface.localnet;
            displayType = 'OVN Localnet';
            displayState = `Bridge: ${iface.bridge}`;
        } else if (type === 'cudn') {
            displayName = iface.metadata.name;
            displayType = 'CUDN';
            displayState = iface.spec?.network?.topology || 'Unknown';
        }

        return (
            <g transform={`translate(${x}, ${y})`} style={{ cursor: 'pointer' }}>
                <title>{displayName} ({displayType})</title>
                <rect width={itemWidth} height={itemHeight} rx={5} fill={color} stroke="#333" strokeWidth={1} />
                <foreignObject x={10} y={10} width={20} height={20}>
                    <div style={{ color: '#fff' }}>{Icon}</div>
                </foreignObject>
                <text x={35} y={25} fontSize="12" fontWeight="bold" fill="#fff">{displayName}</text>
                <text x={10} y={45} fontSize="10" fill="#eee">{displayType}</text>
                <text x={10} y={60} fontSize="10" fill="#eee">{displayState}</text>
                {type !== 'ovn-mapping' && type !== 'cudn' && (
                    <circle cx={itemWidth - 15} cy={15} r={5} fill={iface.state === 'up' ? '#4CAF50' : '#F44336'} />
                )}
            </g>
        );
    };

    if (interfaces.length === 0) {
        return (
            <Card isFullHeight>
                <CardTitle>Network Topology Visualization</CardTitle>
                <CardBody>
                    No interfaces found in NodeNetworkState status.
                </CardBody>
            </Card>
        );
    }

    return (
        <Card isFullHeight>
            <CardTitle>Network Topology Visualization</CardTitle>
            <CardBody>
                <svg width="100%" height={calculatedHeight} viewBox={`0 0 ${width} ${calculatedHeight}`} style={{ border: '1px solid #ccc', background: '#f5f5f5' }}>
                    <defs>
                        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto">
                            <polygon points="0 0, 10 3.5, 0 7" fill="#999" />
                        </marker>
                    </defs>

                    {/* Connectors */}
                    {interfaces.map((iface: any) => {
                        const master = iface.controller || iface.master;
                        if (master && nodePositions[master]) {
                            return renderConnector(iface.name, master);
                        }
                        return null;
                    })}
                    {bridgeMappings.map((mapping: any) => {
                        if (mapping.bridge && nodePositions[mapping.bridge]) {
                            return renderConnector(mapping.bridge, `ovn-${mapping.localnet}`);
                        }
                        return null;
                    })}
                    {cudns.map((cudn: any) => {
                        // Connect CUDN to OVN Mapping
                        const physicalNetworkName = cudn.spec?.network?.localNet?.physicalNetworkName || cudn.spec?.network?.localnet?.physicalNetworkName;
                        if (physicalNetworkName && nodePositions[`ovn-${physicalNetworkName}`]) {
                            // Draw FROM CUDN TO OVN Mapping
                            return renderConnector(`cudn-${cudn.metadata.name}`, `ovn-${physicalNetworkName}`);
                        }
                        return null;
                    })}

                    {/* Layer 1: Physical Interfaces */}
                    <text x={padding} y={padding - 10} fontWeight="bold">Physical Interfaces</text>
                    {ethInterfaces.map((iface: any) =>
                        nodePositions[iface.name] && renderInterfaceNode(iface, nodePositions[iface.name].x, nodePositions[iface.name].y, '#0066CC')
                    )}

                    {/* Layer 2: Bonds */}
                    <text x={padding + colSpacing} y={padding - 10} fontWeight="bold">Bonds</text>
                    {bondInterfaces.map((iface: any) =>
                        nodePositions[iface.name] && renderInterfaceNode(iface, nodePositions[iface.name].x, nodePositions[iface.name].y, '#663399')
                    )}

                    {/* Layer 3: Bridges */}
                    <text x={padding + (colSpacing * 2)} y={padding - 10} fontWeight="bold">Bridges</text>
                    {bridgeInterfaces.map((iface: any) =>
                        nodePositions[iface.name] && renderInterfaceNode(iface, nodePositions[iface.name].x, nodePositions[iface.name].y, '#FF6600')
                    )}

                    {/* Layer 4: Logical Interfaces */}
                    <text x={padding + (colSpacing * 3)} y={padding - 10} fontWeight="bold">Logical Interfaces</text>
                    {logicalInterfaces.map((iface: any) =>
                        nodePositions[iface.name] && renderInterfaceNode(iface, nodePositions[iface.name].x, nodePositions[iface.name].y, '#0099CC')
                    )}

                    {/* Layer 5: OVN Mappings */}
                    <text x={padding + (colSpacing * 4)} y={padding - 10} fontWeight="bold">OVN Bridge Mappings</text>
                    {bridgeMappings.map((mapping: any) =>
                        nodePositions[`ovn-${mapping.localnet}`] && renderInterfaceNode(mapping, nodePositions[`ovn-${mapping.localnet}`].x, nodePositions[`ovn-${mapping.localnet}`].y, '#009900', 'ovn-mapping')
                    )}

                    {/* Layer 6: Networks (CUDNs) */}
                    <text x={padding + (colSpacing * 5)} y={padding - 10} fontWeight="bold">Networks</text>
                    {cudns.map((cudn: any) =>
                        nodePositions[`cudn-${cudn.metadata.name}`] && renderInterfaceNode(cudn, nodePositions[`cudn-${cudn.metadata.name}`].x, nodePositions[`cudn-${cudn.metadata.name}`].y, '#CC0099', 'cudn')
                    )}

                    {/* Layer 7: Others */}
                    <text x={padding} y={calculatedHeight - 150} fontWeight="bold">Other Interfaces</text>
                    <g transform={`translate(${padding}, ${calculatedHeight - 140})`}>
                        {otherInterfaces.map((iface: any, index: number) => {
                            const col = index % 4;
                            const row = Math.floor(index / 4);
                            return renderInterfaceNode(iface, col * (itemWidth + 20), row * (itemHeight + 20), '#666');
                        })}
                    </g>
                </svg>
            </CardBody>
        </Card>
    );
};

export default NodeVisualization;
