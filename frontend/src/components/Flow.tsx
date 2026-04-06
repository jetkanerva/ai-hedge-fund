import {
  Background,
  BackgroundVariant,
  ColorMode,
  Connection,
  Edge,
  EdgeChange,
  MarkerType,
  NodeChange,
  ReactFlow,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useNodes,
  useEdges
} from '@xyflow/react';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useRef, useState } from 'react';

import '@xyflow/react/dist/style.css';

import { useFlowContext } from '@/contexts/flow-context';
import { useEnhancedFlowActions } from '@/hooks/use-enhanced-flow-actions';
import { useFlowHistory } from '@/hooks/use-flow-history';
import { useFlowConnectionState } from '@/hooks/use-flow-connection';
import { useFlowKeyboardShortcuts, useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useToastManager } from '@/hooks/use-toast-manager';
import { AppNode } from '@/nodes/types';
import { edgeTypes } from '../edges';
import { nodeTypes } from '../nodes';
import { TooltipProvider } from './ui/tooltip';

type FlowProps = {
  className?: string;
};

export function Flow({ className = '' }: FlowProps) {
  const { resolvedTheme } = useTheme();
  
  // Use the resolved theme for ReactFlow ColorMode
  const colorMode: ColorMode = resolvedTheme === 'light' ? 'light' : 'dark';
  
  const [isInitialized, setIsInitialized] = useState(false);
  const proOptions = { hideAttribution: true };
  
  const { currentFlowId, reactFlowInstance } = useFlowContext();
  
  const nodes = useNodes<AppNode>();
  const edges = useEdges();
  
  // Get enhanced flow actions for complete state persistence
  const { saveCurrentFlowWithCompleteState } = useEnhancedFlowActions();
  
  // Get toast manager
  const { success, error } = useToastManager();

  // Initialize flow history (each flow maintains its own separate history)
  const { takeSnapshot, undo, redo } = useFlowHistory({ flowId: currentFlowId });

  // Create debounced auto-save function
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedFlowIdRef = useRef<number | null>(null);
  
  const autoSave = useCallback(async (flowIdToSave?: number | null) => {
    // Use the provided flowId or fall back to current flow ID
    const targetFlowId = flowIdToSave !== undefined ? flowIdToSave : currentFlowId;
    
    // Clear any existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    // Set new timeout for debounced save
    autoSaveTimeoutRef.current = setTimeout(async () => {
      // Double-check that we're still saving to the correct flow
      if (!targetFlowId) {
        return;
      }
      
      // If the current flow has changed since this auto-save was scheduled, skip it
      if (targetFlowId !== currentFlowId) {
        return;
      }
      
      try {
        await saveCurrentFlowWithCompleteState();
        lastSavedFlowIdRef.current = targetFlowId;
      } catch (error) {
        console.error(`[Auto-save] Failed to save flow ${targetFlowId}:`, error);
      }
    }, 1000); // 1 second debounce
  }, [currentFlowId, saveCurrentFlowWithCompleteState]);

  // Enhanced onNodesChange handler with auto-save for specific change types
  const handleNodesChange = useCallback((changes: NodeChange<AppNode>[]) => {
    // Manually apply changes to internal store in uncontrolled mode
    reactFlowInstance.setNodes((nds) => applyNodeChanges(changes, nds));

    // Check if any of the changes should trigger auto-save
    const shouldAutoSave = changes.some(change => {
      switch (change.type) {
        case 'add':
          return true;
        case 'remove':
          return true;
        case 'position':
          // Only auto-save position changes when dragging is complete
          if (!change.dragging) {
            return true;
          }
          return false;
        default:
          return false;
      }
    });

    // Trigger auto-save if needed and flow is initialized
    // IMPORTANT: Capture the current flow ID at the time of the change
    if (shouldAutoSave && isInitialized && currentFlowId) {
      const flowIdAtTimeOfChange = currentFlowId;
      autoSave(flowIdAtTimeOfChange);
    }
  }, [autoSave, isInitialized, currentFlowId, reactFlowInstance]);

  // Enhanced onEdgesChange handler with auto-save for edge removal
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    // Manually apply changes to internal store in uncontrolled mode
    reactFlowInstance.setEdges((eds) => applyEdgeChanges(changes, eds));

    // Check if any of the changes should trigger auto-save
    const shouldAutoSave = changes.some(change => {
      switch (change.type) {
        case 'remove':
          return true;
        default:
          return false;
      }
    });

    // Trigger auto-save if needed and flow is initialized
    // IMPORTANT: Capture the current flow ID at the time of the change
    if (shouldAutoSave && isInitialized && currentFlowId) {
      const flowIdAtTimeOfChange = currentFlowId;
      autoSave(flowIdAtTimeOfChange);
    }
  }, [autoSave, isInitialized, currentFlowId, reactFlowInstance]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  // Cancel pending auto-saves when flow changes to prevent cross-flow saves
  useEffect(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
  }, [currentFlowId]);

  // Take initial snapshot when flow is initialized
  useEffect(() => {
    if (isInitialized && nodes.length === 0 && edges.length === 0) {
      takeSnapshot();
    }
  }, [isInitialized, takeSnapshot, nodes.length, edges.length]);

  // Take snapshot when nodes or edges change (debounced)
  useEffect(() => {
    if (!isInitialized) return;
    
    const timeoutId = setTimeout(() => {
      takeSnapshot();
    }, 500); // Debounce snapshots by 500ms

    return () => clearTimeout(timeoutId);
  }, [nodes, edges, takeSnapshot, isInitialized]);

  // // Auto-save when nodes or edges change (debounced with longer delay)
  // useEffect(() => {
  //   if (!isInitialized) return;
    
  //   const timeoutId = setTimeout(async () => {
  //     try {
  //       await saveCurrentFlowWithCompleteState();
  //       // Don't show success toast for auto-save to avoid spam
  //     } catch (err) {
  //       // Only show error notifications for auto-save failures
  //       error('Auto-save failed', 'auto-save-error');
  //     }
  //   }, 1000); // Debounce auto-save by 1 second (longer than undo/redo)

  //   return () => clearTimeout(timeoutId);
  // }, [nodes, edges, saveCurrentFlowWithCompleteState, error, isInitialized]);

  // Connect keyboard shortcuts to save flow with toast
  useFlowKeyboardShortcuts(async () => {
    try {
      const savedFlow = await saveCurrentFlowWithCompleteState();
      if (savedFlow) {
        success(`"${savedFlow.name}" saved!`, 'flow-save');
      } else {
        error('Failed to save flow', 'flow-save-error');
      }
    } catch (err) {
      error('Failed to save flow', 'flow-save-error');
    }
  });

  // Automatically save flow when connection state becomes 'completed'
  const connectionState = useFlowConnectionState(currentFlowId ? currentFlowId.toString() : null);
  useEffect(() => {
    if (connectionState?.state === 'completed') {
      // Auto-save the flow state including output data when processing finishes
      autoSave();
    }
  }, [connectionState?.state, autoSave]);

  // Add undo/redo keyboard shortcuts
  useKeyboardShortcuts({
    shortcuts: [
      {
        key: 'z',
        ctrlKey: true,
        metaKey: true,
        callback: undo,
        preventDefault: true,
      },
      {
        key: 'z',
        ctrlKey: true,
        metaKey: true,
        shiftKey: true,
        callback: redo,
        preventDefault: true,
      },
    ],
  });
  
  // Initialize the flow when it first renders
  const onInit = useCallback(() => {
    if (!isInitialized) {
      setIsInitialized(true);
    }
  }, [isInitialized]);

  // Connect two nodes with marker
  const onConnect = useCallback(
    (connection: Connection) => {
      // Create a new edge with a marker and unique ID
      const newEdge: Edge = {
        ...connection,
        id: `edge-${Date.now()}`, // Add unique ID
        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
      };
      reactFlowInstance.setEdges((eds: Edge[]) => addEdge(newEdge, eds));
      
      // Auto-save new connections immediately (structural change)
      if (currentFlowId) {
        // IMPORTANT: Capture the current flow ID at the time of the change
        const flowIdAtTimeOfChange = currentFlowId;
        
        // Clear any pending debounced saves and save immediately
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
        }
        
        // Use setTimeout to ensure the edge is added to state first
        setTimeout(async () => {
          // Double-check that we're still saving to the correct flow
          if (flowIdAtTimeOfChange !== currentFlowId) {
            return;
          }
          
          try {
            await saveCurrentFlowWithCompleteState();
          } catch (error) {
            console.error(`[Auto-save] Failed to save new connection for flow ${flowIdAtTimeOfChange}:`, error);
          }
        }, 100);
      }
    },
    [reactFlowInstance, currentFlowId, saveCurrentFlowWithCompleteState]
  );

  // Theme-aware background colors
  const backgroundStyle = {
    backgroundColor: 'hsl(var(--background))'
  };
  
  const gridColor = resolvedTheme === 'light' ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))';

  return (
    <div className={`w-full h-full ${className}`}>
      <TooltipProvider>
        <ReactFlow
          defaultNodes={[]}
          defaultEdges={[]}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          edgeTypes={edgeTypes}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onInit={onInit}
          colorMode={colorMode}
          proOptions={proOptions}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background 
            variant={BackgroundVariant.Dots}
            gap={13}
            color={gridColor}
            style={backgroundStyle}
          />
          {/* <CustomControls onReset={resetFlow} /> */}
        </ReactFlow>
      </TooltipProvider>
    </div>
  );
} 